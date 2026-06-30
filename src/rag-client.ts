import { db } from './firebase-client';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  writeBatch
} from 'firebase/firestore';
import type { ContextFile, ContextChunk } from './types';

// Minimum cosine similarity score to include a chunk in RAG context.
// Chunks scoring below this threshold are noise — don't inject them into the prompt.
const RELEVANCY_THRESHOLD = 0.25;

// Firestore hard limit: 500 ops per batch. Stay below it.
const FIRESTORE_BATCH_LIMIT = 490;

// Chunk text with overlap to preserve context across boundaries.
export function chunkText(text: string, chunkSize = 800, overlapSize = 150): string[] {
  const chunks: string[] = [];
  if (!text || text.trim().length === 0) return chunks;

  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + chunkSize, text.length);

    // Snap to word boundary only when not at the very end of the string
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(' ', end);
      if (lastSpace > i + chunkSize * 0.7) {
        end = lastSpace;
      }
    }

    const chunk = text.slice(i, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // Advance by (chunkSize - overlap). Guard: never go backwards.
    const next = end - overlapSize;
    i = next > i ? next : end;

    if (i >= text.length) break;
  }
  return chunks;
}

// Request the backend server to extract text from a base64-encoded PDF file.
export async function parsePdfOnServer(base64Data: string, fileName: string): Promise<string> {
  const res = await fetch('/api/parse-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Data, fileName }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error((errData as any).error || 'Failed to parse PDF on the server');
  }
  const data = await res.json() as any;
  return data.text || '';
}

/**
 * Request the backend server to generate an embedding for a text chunk.
 * @param text       The text to embed.
 * @param taskType   'RETRIEVAL_DOCUMENT' (indexing) or 'RETRIEVAL_QUERY' (search).
 *                   These produce different vector spaces in Gemini's asymmetric model —
 *                   ALWAYS use RETRIEVAL_QUERY when embedding a search query.
 */
export async function getEmbeddingOnServer(
  text: string,
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' = 'RETRIEVAL_DOCUMENT'
): Promise<number[]> {
  const res = await fetch('/api/embed-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, taskType }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error((errData as any).error || 'Failed to generate embedding on the server');
  }
  const data = await res.json() as any;
  if (!data.embedding || !Array.isArray(data.embedding) || data.embedding.length === 0) {
    throw new Error('Empty or missing embedding returned from server — the embedding API may have changed its response format.');
  }
  return data.embedding;
}

// Cosine similarity — in-memory, no deps.
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Commit a write batch. Automatically splits into multiple batches when the
 * operation count would exceed Firestore's 500-op hard limit.
 */
async function commitInBatches(
  operations: Array<{ ref: any; data?: any; type: 'set' | 'delete' }>
): Promise<void> {
  for (let start = 0; start < operations.length; start += FIRESTORE_BATCH_LIMIT) {
    const slice = operations.slice(start, start + FIRESTORE_BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const op of slice) {
      if (op.type === 'set') {
        batch.set(op.ref, op.data);
      } else {
        batch.delete(op.ref);
      }
    }
    await batch.commit();
  }
}

/**
 * Save a context file: parse → chunk → embed each chunk → persist metadata + chunks.
 *
 * @param originalFileSize  Raw byte size of the uploaded file (for display purposes).
 */
export async function saveContextFile(
  userId: string,
  fileName: string,
  fileType: string,
  rawContent: string,       // base64 for PDF; plain text for TXT/MD
  progressCallback?: (status: string) => void,
  originalFileSize?: number
): Promise<void> {
  const fileId = `file-${Date.now()}`;
  let text = '';

  if (fileType === 'application/pdf') {
    if (progressCallback) progressCallback('Extracting text from PDF...');
    text = await parsePdfOnServer(rawContent, fileName);
  } else {
    text = rawContent;
  }

  // Cap content at 15,000 chars to keep RAG latency tight.
  const MAX_CHARS = 15000;
  let wasTruncated = false;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    wasTruncated = true;
  }

  if (!text || text.trim().length === 0) {
    throw new Error('No readable text could be extracted from this document.');
  }

  if (progressCallback) progressCallback('Splitting document into context chunks...');
  const chunks = chunkText(text, 800, 150);

  if (chunks.length === 0) {
    throw new Error('Document was too short or did not contain valid chunks.');
  }

  if (progressCallback) progressCallback(`Generating AI vectors for ${chunks.length} chunks...`);

  const embeddedChunks: ContextChunk[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (progressCallback) {
      progressCallback(`Generating embedding ${i + 1}/${chunks.length}...`);
    }
    // Documents get RETRIEVAL_DOCUMENT embeddings at indexing time.
    const embedding = await getEmbeddingOnServer(chunks[i], 'RETRIEVAL_DOCUMENT');
    embeddedChunks.push({
      id: `${fileId}-chunk-${i}`,
      fileId,
      fileName,
      text: chunks[i],
      embedding,
      index: i,
    });
  }

  if (progressCallback) progressCallback('Writing metadata and vectors to Firestore...');

  // Build the file metadata document.
  const fileDocRef = doc(db, 'users', userId, 'context_files', fileId);
  const fileMeta: ContextFile = {
    id: fileId,
    fileName,            // Store the clean name; truncation is surfaced via wasTruncated field
    fileType,
    uploadedAt: new Date().toISOString(),
    charCount: text.length,
    originalFileSize: originalFileSize ?? undefined,
    wasTruncated,
  };

  // Write metadata first so partial failures are detectable (metadata present but no chunks).
  await setDoc(fileDocRef, fileMeta);

  // Write chunks in safe batches (handles files that produce many chunks).
  const chunkOps = embeddedChunks.map(chunk => ({
    type: 'set' as const,
    ref: doc(db, 'users', userId, 'context_chunks', chunk.id),
    data: chunk,
  }));
  await commitInBatches(chunkOps);

  if (progressCallback) progressCallback('Document stasis registration complete!');
}

/**
 * Delete a context file and ALL of its associated chunks atomically in a single
 * batched operation. The file metadata doc is included in the same batch — if the
 * batch fails, nothing is left half-deleted.
 */
export async function deleteContextFile(userId: string, fileId: string): Promise<void> {
  // Fetch all chunk docs for this file (filtered client-side to avoid composite index).
  const chunksColRef = collection(db, 'users', userId, 'context_chunks');
  const snap = await getDocs(chunksColRef);

  const ops: Array<{ ref: any; type: 'delete' }> = [];

  // Include the file metadata in the same batch.
  ops.push({ type: 'delete', ref: doc(db, 'users', userId, 'context_files', fileId) });

  snap.forEach(docSnap => {
    if (docSnap.data()?.fileId === fileId) {
      ops.push({ type: 'delete', ref: docSnap.ref });
    }
  });

  // Commit atomically (split into multiple batches if chunks > FIRESTORE_BATCH_LIMIT).
  await commitInBatches(ops);
}

/**
 * Delete ALL context files and chunks for a user (used by "Purge All").
 */
export async function purgeAllContextFiles(userId: string): Promise<void> {
  const filesColRef = collection(db, 'users', userId, 'context_files');
  const chunksColRef = collection(db, 'users', userId, 'context_chunks');

  const [filesSnap, chunksSnap] = await Promise.all([
    getDocs(filesColRef),
    getDocs(chunksColRef),
  ]);

  const ops: Array<{ ref: any; type: 'delete' }> = [];
  filesSnap.forEach(d => ops.push({ type: 'delete', ref: d.ref }));
  chunksSnap.forEach(d => ops.push({ type: 'delete', ref: d.ref }));

  if (ops.length === 0) return;
  await commitInBatches(ops);
}

/**
 * Retrieve relevant context chunks for a query using cosine similarity.
 *
 * Key correctness requirement: the query embedding MUST use RETRIEVAL_QUERY
 * task type. Using RETRIEVAL_DOCUMENT for queries breaks asymmetric embedding
 * optimization and produces systematically wrong similarity scores.
 */
export async function retrieveRelevantContexts(
  userId: string,
  queryText: string,
  topK = 4
): Promise<string[]> {
  try {
    // RETRIEVAL_QUERY — not RETRIEVAL_DOCUMENT — for search vectors.
    const queryVector = await getEmbeddingOnServer(queryText, 'RETRIEVAL_QUERY');

    const chunksColRef = collection(db, 'users', userId, 'context_chunks');
    const snap = await getDocs(chunksColRef);

    const candidates: { text: string; score: number }[] = [];
    snap.forEach(docSnap => {
      const chunkData = docSnap.data() as ContextChunk;
      if (chunkData?.embedding && chunkData.embedding.length > 0) {
        const score = cosineSimilarity(queryVector, chunkData.embedding);
        // Only keep chunks that are actually relevant.
        if (score >= RELEVANCY_THRESHOLD) {
          candidates.push({ text: chunkData.text, score });
        }
      }
    });

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, topK).map(c => c.text);
  } catch (err) {
    console.error('[RAG] Failed to retrieve context chunk vectors:', err);
    return [];
  }
}
