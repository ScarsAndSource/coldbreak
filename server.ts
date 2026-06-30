import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import dotenv from "dotenv";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import pptxgen from "pptxgenjs";
import * as pdfImport from "pdf-parse";
const pdf = (pdfImport as any).default || pdfImport;

async function parsePdfBuffer(buffer: Buffer): Promise<string> {
  let pdfParser = pdf;
  
  if (pdfParser && typeof pdfParser.PDFParse === "function") {
    const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const parserInstance = new pdfParser.PDFParse(uint8Array);
    const result = await parserInstance.getText();
    return result.text || "";
  }
  
  if (typeof pdfParser !== "function" && pdfParser && typeof (pdfParser as any).default === "function") {
    pdfParser = (pdfParser as any).default;
  }
  
  if (typeof pdfParser === "function") {
    const parsed = await pdfParser(buffer);
    return parsed.text || "";
  }
  
  throw new Error("No valid PDF parser found in pdf-parse module. Type of exported object: " + typeof pdfParser);
}

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ limit: "15mb", extended: true }));

// Initialize Gemini SDK with telemetry header as required
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Track which model actually ran (for UI display)
let lastModelUsed = "gemini-3.5-flash";

// Track models that have hit quota limits in-memory to avoid slow/failing calls
const exhaustedModels = new Set<string>();

// Robust Gemini content generation wrapper with exponential backoff and stable model fallback
async function generateContentWithRetry(params: any, retries = 3, delay = 1000): Promise<any> {
  const modelsToTry = Array.from(new Set([
    params.model,
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
  ].filter(Boolean)));

  // If we have exhausted models, push them to the very end of the list so we prioritize others
  modelsToTry.sort((a, b) => {
    const aExhausted = exhaustedModels.has(a) ? 1 : 0;
    const bExhausted = exhaustedModels.has(b) ? 1 : 0;
    return aExhausted - bExhausted;
  });
  
  for (const model of modelsToTry) {
    let currentRetries = retries;
    let currentDelay = delay;
    
    while (currentRetries >= 0) {
      try {
        console.log(`[Gemini API] Attempting generation with model: ${model}`);
        const apiParams = { ...params };
        if (apiParams.config) {
          apiParams.config = { ...apiParams.config };
        }
        
        // Strip thinkingConfig for models that do not support it (strictly 3.5 models)
        const supportsThinking = model.includes("3.5");
        if (!supportsThinking && apiParams.config?.thinkingConfig) {
          delete apiParams.config.thinkingConfig;
        }

        const response = await ai.models.generateContent({
          ...apiParams,
          model: model,
        });
        lastModelUsed = model;
        return response;
      } catch (error: any) {
        const status = error?.status || error?.error?.status || "";
        const code = error?.code || error?.error?.code || error?.status;
        const message = error?.message || error?.error?.message || "";
        
        const isQuotaExceeded = 
          code === 429 || 
          status === "RESOURCE_EXHAUSTED" || 
          message.includes("RESOURCE_EXHAUSTED") ||
          message.toLowerCase().includes("quota exceeded") ||
          message.toLowerCase().includes("rate limit") ||
          message.toLowerCase().includes("exceeded your current quota");

        const isServiceUnavailable = 
          status === "UNAVAILABLE" || 
          code === 503 || 
          message.includes("503") || 
          message.toLowerCase().includes("high demand") || 
          message.includes("UNAVAILABLE");

        if (isQuotaExceeded || isServiceUnavailable) {
          if (isQuotaExceeded) {
            exhaustedModels.add(model);
          }
          console.log(`[Gemini API] Model ${model} is temporarily unavailable (status 429/503). Transitioning to next model...`);
          if (model === modelsToTry[modelsToTry.length - 1]) {
            throw error;
          }
          break; // Break retry loop to try the next model
        }

        if (currentRetries > 0) {
          console.log(`[Gemini API] Request failed for model ${model}. Retrying in ${currentDelay}ms... (${currentRetries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, currentDelay));
          currentRetries--;
          currentDelay *= 2;
        } else {
          if (model === modelsToTry[modelsToTry.length - 1]) {
            console.log(`[Gemini API] Final model ${model} execution limit reached.`);
            throw error;
          }
          console.log(`[Gemini API] Model ${model} execution finished with warning. Trying next...`);
          break;
        }
      }
    }
  }
}

// A temporary server memory cache for tasks that require background watchdogs
// We can use this alongside Firestore to run timeouts / setInterval checks.
interface ActiveTaskWatchdog {
  taskId: string;
  deadline: string;
  recipient: string;
  accessToken: string;
  taskText: string;
  registeredAt: number; // epoch ms — used to compute proportional watchdog timing for short tasks
}
const activeWatchdogs: Record<string, ActiveTaskWatchdog> = {};

// Helper for Base64 URL Safe encoding (required for Gmail raw message send)
function base64UrlSafe(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Check background watchdogs periodically (every 10 seconds)
setInterval(async () => {
  const now = new Date();
  for (const taskId in activeWatchdogs) {
    const wd = activeWatchdogs[taskId];
    const deadlineDate = new Date(wd.deadline);

    // FIX: For very short tasks (< 45 min window), a fixed 45-min offset fires immediately.
    // Use proportional offset: min(45min, max(2min, 50% of total available window))
    // so a 30-min task fires 15min before deadline, a 2-hour task fires 45min before.
    const totalAvailableMs = deadlineDate.getTime() - (wd.registeredAt || Date.now());
    const watchdogOffsetMs = Math.min(
      45 * 60 * 1000,
      Math.max(2 * 60 * 1000, totalAvailableMs * 0.5)
    );
    const watchdogTime = new Date(deadlineDate.getTime() - watchdogOffsetMs);

    if (now >= watchdogTime) {
      console.log(`[Watchdog] Watchdog fired for task ${taskId}. Checking progress...`);
      // In a real database we would check if the task is completed.
      // Since this is in-memory / backend check, we can verify if it's still registered in our activeWatchdogs
      // If the user checked it off, the client should have deleted/removed it from activeWatchdogs.
      // Let's execute the crisis message trigger!
      try {
        await triggerCrisisMessage(wd);
      } catch (err) {
        console.error(`[Watchdog] Error triggering crisis message:`, err);
      }
      delete activeWatchdogs[taskId];
    }
  }
}, 10000);

// Helper to draft and send Gmail crisis message
async function triggerCrisisMessage(wd: ActiveTaskWatchdog) {
  console.log(`[Crisis] Drafting holding message for task: "${wd.taskText}" to recipient: ${wd.recipient}`);

  // Construct Gemini prompt with strict honesty constraints
  const prompt = `
    Draft a professional, honest holding email from a user who is procrastinating or running late on a task.
    
    Task description: "${wd.taskText}"
    Recipient: ${wd.recipient}
    
    CRITICAL HONESTY CONSTRAINTS:
    1. You may ONLY state that the user needs more time and provide a new estimated completion time (ETA).
    2. You must NEVER assert or lie about what the user has completed so far, what stage they are at, or invent a fake reason for the delay (e.g., do NOT say "I had a power cut" or "I was sick").
    3. Phrases like "almost done", "just finishing up", "wrapping up", "in the final stages", or "nearly there" are ABSOLUTELY PROHIBITED.
    4. Keep it brief, polite, and directly address that more time is needed with a reasonable new ETA (e.g., 2 hours later, or tomorrow morning).
    
    Return the drafted message in JSON format with the following keys:
    - subject: The email subject line.
    - body: The full body of the email.
  `;

  try {
    const response = await generateContentWithRetry({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            body: { type: Type.STRING },
          },
          required: ["subject", "body"],
        }
      }
    });

    const emailData = JSON.parse(response.text || "{}");
    const subject = emailData.subject || "Regarding our task update";
    const body = emailData.body || "I am writing to let you know that I need more time to complete this task. I estimate it will be ready soon.";

    console.log(`[Crisis] Drafted Subject: ${subject}`);
    console.log(`[Crisis] Drafted Body: \n${body}`);

    // Send using Gmail compose API
    // Construct Raw MIME message
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
    const emailLines = [
      `To: ${wd.recipient}`,
      `Subject: ${utf8Subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      body,
    ];
    const rawEmail = emailLines.join("\r\n");
    const encodedEmail = base64UrlSafe(rawEmail);

    if (wd.accessToken === "demo-token-12345" || wd.accessToken.startsWith("demo-")) {
      console.log(`[Crisis] [Simulated Demo Send] Crisis message would have been sent to ${wd.recipient}`);
      return;
    }

    const gmailRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${wd.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encodedEmail }),
    });

    if (!gmailRes.ok) {
      const errText = await gmailRes.text();
      throw new Error(`Gmail API failed: ${errText}`);
    }

    console.log(`[Crisis] Crisis message sent successfully to ${wd.recipient}`);
  } catch (err) {
    console.error(`[Crisis] Failed to send email via Gmail API:`, err);
    throw err;
  }
}


app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// RAG: PDF Parser Endpoint
app.post("/api/parse-pdf", async (req, res) => {
  const { base64Data, fileName } = req.body;
  if (!base64Data) {
    res.status(400).json({ error: "Missing required field: base64Data" });
    return;
  }

  try {
    const buffer = Buffer.from(base64Data, "base64");
    const fullText = await parsePdfBuffer(buffer);
    res.json({ text: fullText });
  } catch (err: any) {
    console.error(`[RAG Server] PDF parsing error for ${fileName || "document"}:`, err);
    res.status(500).json({ error: err.message || "Failed to extract text from PDF." });
  }
});

// RAG: Text Embedding Generation Endpoint
// Accepts an optional `taskType` field: 'RETRIEVAL_DOCUMENT' (default, for indexing)
// or 'RETRIEVAL_QUERY' (for search queries). Gemini's asymmetric embedding model
// produces different vector spaces for each — using the wrong type degrades cosine
// similarity scores and breaks retrieval quality.
app.post("/api/embed-text", async (req, res) => {
  const { text, taskType } = req.body;
  if (!text) {
    res.status(400).json({ error: "Missing required field: text" });
    return;
  }

  const validTaskTypes = ["RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY", "SEMANTIC_SIMILARITY", "CLASSIFICATION", "CLUSTERING"];
  const resolvedTaskType = validTaskTypes.includes(taskType) ? taskType : "RETRIEVAL_DOCUMENT";

  try {
    const response = await ai.models.embedContent({
      model: "gemini-embedding-2-preview",
      contents: text,
      config: {
        taskType: resolvedTaskType,
      }
    });
    // gemini-embedding-2-preview returns 3072-dim vectors
    const embedding = (response as any).embeddings?.[0]?.values ?? (response as any).embedding?.values ?? null;
    if (!embedding || embedding.length === 0) {
      throw new Error(`Embedding API returned an empty vector for taskType=${resolvedTaskType}. Check Gemini API response shape.`);
    }
    res.json({ embedding });
  } catch (err: any) {
    console.error("[RAG Server] Text embedding error:", err);
    res.status(500).json({ error: err.message || "Failed to generate text embedding." });
  }
});

// Returns which model actually processed the last Gemini call (for UI display)
app.get("/api/model-info", (req, res) => {
  res.json({ lastModelUsed });
});

// Mode 4: Behavioral Debrief — processes completion data, updates Gamma, generates insight
app.post("/api/debrief", async (req, res) => {
  const {
    hardestPart,
    actualStartTime,
    createdAt,
    deadline,
    rating,
    currentGamma,
    first_step_completion_timestamp,
    task_completed_timestamp,
    autoSubmitted
  } = req.body;

  if (!deadline) {
    res.status(400).json({ error: "Missing required field: deadline" });
    return;
  }

  try {
    // 1. Classify blocker type from free text
    let blockerType = "none_stated";
    if (hardestPart && hardestPart.trim().length > 3) {
      const classifyRes = await generateContentWithRetry({
        model: "gemini-3.5-flash",
        contents: `Classify this procrastination blocker description into EXACTLY ONE of these categories: distraction, perfectionism, unclear_scope, external_dependency, fatigue, none_stated. 
Description: "${hardestPart}"
Reply with only the single category word. No explanation. No punctuation.`,
      });
      const classified = (classifyRes.text?.trim().toLowerCase() || "none_stated").split(/\s+/)[0];
      const valid = ["distraction", "perfectionism", "unclear_scope", "external_dependency", "fatigue", "none_stated"];
      blockerType = valid.includes(classified) ? classified : "none_stated";
    }

    // 2. Compute start ratio: how far into the available window did user start?
    // start_ratio = time_remaining_at_start / total_window
    // High ratio (0.8) = started early. Low ratio (0.1) = started at last minute.
    const deadlineMs = new Date(deadline).getTime();
    const createdMs = createdAt ? new Date(createdAt).getTime() : Date.now() - 4 * 60 * 60 * 1000;
    
    let firstStepCompletedMs = first_step_completion_timestamp ? new Date(first_step_completion_timestamp).getTime() : null;
    const taskCompletedMs = task_completed_timestamp ? new Date(task_completed_timestamp).getTime() : Date.now();

    if (!firstStepCompletedMs || isNaN(firstStepCompletedMs)) {
      firstStepCompletedMs = taskCompletedMs;
    }

    const numerator = deadlineMs - firstStepCompletedMs;
    const denominator = deadlineMs - createdMs;
    
    const startRatio = denominator !== 0 ? Math.min(1, Math.max(0, numerator / denominator)) : 0.5;
    const hoursRemainingAtStart = Math.max(0, (deadlineMs - firstStepCompletedMs) / (1000 * 60 * 60));

    // 3. Update gamma: shift by (start_ratio - 0.5) * 0.05
    // Users who start early (startRatio > 0.5) get lower gamma (less procrastination)
    // Users who start late (startRatio < 0.5) get higher gamma
    const gammaDelta = (startRatio - 0.5) * 0.05;
    const newGamma = Math.max(0.05, Math.min(0.95, (Number(currentGamma) || 0.5) + gammaDelta));

    // 4. Generate the one-sentence behavioral insight
    const insightPrompt = `You are ColdBreak, a behavioral AI. Generate exactly ONE short insight sentence (under 20 words) for a user who just completed a task. 
Facts: They started ${hoursRemainingAtStart.toFixed(1)} hours before the deadline. Their session rating: ${rating || 3}/5. Main blocker: ${blockerType}.${autoSubmitted ? " Note: They missed their last viable time window and the task was auto-submitted via their emergency Cryo-Save." : ""}
Rules: Be specific to these facts. Do not be generic. Do not be preachy. Do not say "Great job". End with one actionable micro-observation if possible.
Example good outputs: "You started 45 minutes before the deadline — 15 minutes earlier than usual. The 3pm block may be working." or "Perfectionism showed up again here — the 25-min step limit for next time might help."
Output only the insight sentence. No quotes.`;

    const insightRes = await generateContentWithRetry({
      model: "gemini-3.5-flash",
      contents: insightPrompt,
    });
    const insight = insightRes.text?.trim() || `You started ${hoursRemainingAtStart.toFixed(1)}h before the deadline. Noted.`;

    console.log(`[Debrief] Blocker: ${blockerType}, StartRatio: ${startRatio.toFixed(2)}, OldGamma: ${currentGamma}, NewGamma: ${newGamma.toFixed(3)}, Insight: "${insight}"`);

    res.json({
      blockerType,
      startRatio,
      newGamma: Math.round(newGamma * 100) / 100,
      insight,
      hoursBeforeDeadline: Math.round(hoursRemainingAtStart * 10) / 10,
    });
  } catch (err: any) {
    console.error("[Debrief] Error:", err);
    res.status(500).json({ error: err.message || "Debrief processing failed" });
  }
});

// Configure Watchdog / Active Task registration from frontend
app.post("/api/watchdog/register", (req, res) => {
  const { taskId, deadline, recipient, accessToken, taskText, recipient_name } = req.body;
  if (!taskId || !deadline || !recipient || !accessToken || !taskText) {
    res.status(400).json({ error: "Missing required fields for watchdog registration" });
    return;
  }

  activeWatchdogs[taskId] = {
    taskId,
    deadline,
    recipient,
    accessToken,
    taskText,
    registeredAt: Date.now(), // Store creation time for proportional watchdog offset calculation
    recipient_name,
  } as any;

  console.log(`[Watchdog] Registered background watchdog check for task ${taskId}.`);
  res.json({ status: "registered" });
});

// Remove Watchdog (when task is marked complete)
app.post("/api/watchdog/cancel", (req, res) => {
  const { taskId } = req.body;
  if (taskId && activeWatchdogs[taskId]) {
    delete activeWatchdogs[taskId];
    console.log(`[Watchdog] Cancelled watchdog for task ${taskId}.`);
  }
  res.json({ status: "cancelled" });
});

// List active watchdogs — useful for demo script to re-register after server restart
app.get("/api/watchdog/list", (req, res) => {
  const list = Object.values(activeWatchdogs).map((wd: any) => ({
    taskId: wd.taskId,
    deadline: wd.deadline,
    recipient: wd.recipient,
    taskText: wd.taskText,
    registeredAt: wd.registeredAt,
    minutesToDeadline: Math.round((new Date(wd.deadline).getTime() - Date.now()) / 60000),
  }));
  res.json({ count: list.length, watchdogs: list });
});

// Force Watchdog Check (for instant user testing of crisis flow)
app.post("/api/watchdog/force-trigger", async (req, res) => {
  const { taskId } = req.body;
  const wd = activeWatchdogs[taskId];
  if (!wd) {
    res.status(404).json({ error: "No active watchdog found for task or it already fired" });
    return;
  }

  try {
    await triggerCrisisMessage(wd);
    delete activeWatchdogs[taskId];
    res.json({ status: "triggered", message: "Watchdog forced and email sent successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to trigger crisis message" });
  }
});

// POST /api/micro-decompose
app.post("/api/micro-decompose", async (req, res) => {
  const { step_text, duration_minutes, contexts } = req.body;
  if (!step_text) {
    res.status(400).json({ error: "Missing required field: step_text" });
    return;
  }

  const contextPrompt = contexts && contexts.length > 0 
    ? `SOURCE MATERIAL (use only this — do not invent information not present here):
${contexts.map((c: string, idx: number) => `${idx + 1}. ${c}`).join('\n')}\n\n`
    : "";

  const prompt = `${contextPrompt}TASK:
Break this task step into 2-3 concrete micro-actions, each under 3 minutes.
Step: ${step_text}. Estimated duration: ${duration_minutes || 10} minutes.

RULES:
Break this into 2–3 concrete micro-actions, each under 3 minutes. If source material above contains directly relevant procedures, terms, formulas, or steps, your micro-actions must reference and use them specifically — do not write generic actions when the source material gives you something concrete to act on.

Reminder: ground every micro-action in the source material above if it is provided.

Return only valid JSON with no other text: { "micro_steps": ["action 1", "action 2"] }`;

  try {
    const response = await generateContentWithRetry({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            micro_steps: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["micro_steps"]
        }
      }
    });

    const data = JSON.parse(response.text || "{}");
    res.json({ micro_steps: data.micro_steps || [] });
  } catch (err: any) {
    console.error("[Micro Decompose Error]:", err);
    res.status(500).json({ error: err.message || "Failed to decompose micro-steps", micro_steps: [] });
  }
});

// Full Crisis Protocol — frontend-initiated holding message sender
app.post("/api/crisis-trigger", async (req, res) => {
  const { recipient, deadline, accessToken, taskText, gracePeriodMinutes } = req.body;

  if (!recipient || !taskText) {
    res.status(400).json({ error: "Missing required fields: recipient, taskText" });
    return;
  }

  // Compute the new ETA from now + grace period
  const graceMins = Math.max(5, Number(gracePeriodMinutes) || 30);
  const newEtaMs = Date.now() + graceMins * 60 * 1000;
  const newEtaDisplay = new Date(newEtaMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Extract first name from email for personalization
  const firstNameRaw = recipient.split('@')[0].replace(/[._-]/g, ' ').split(' ')[0];
  const recipientFirstName = firstNameRaw.charAt(0).toUpperCase() + firstNameRaw.slice(1);

  // Honesty Gate-constrained prompt — identical logic to the watchdog path
  const prompt = `
    Draft a professional, honest holding email from a user who needs more time on a task.

    Task description: "${taskText}"
    Recipient first name: ${recipientFirstName}
    New estimated completion time: ${newEtaDisplay}

    CRITICAL HONESTY CONSTRAINTS:
    1. ONLY state that the user needs more time and provide the new ETA: ${newEtaDisplay}.
    2. NEVER assert what the user has completed, what stage they are at, or invent any reason for the delay.
    3. ABSOLUTELY PROHIBITED phrases: "almost done", "just finishing up", "wrapping up", "currently working on", "in the final stages", "nearly there".
    4. Keep it to 2-3 sentences. Brief, polite, honest.
    5. Do NOT apologise excessively. One brief apology is fine.

    Return JSON with:
    - subject: short email subject line
    - body: the full email body (2-3 sentences)
    - message: one summary sentence under 15 words of what was communicated
  `;

  try {
    const response = await generateContentWithRetry({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            body: { type: Type.STRING },
            message: { type: Type.STRING },
          },
          required: ["subject", "body", "message"],
        }
      }
    });

    const emailData = JSON.parse(response.text || "{}");
    const subject = emailData.subject || `Update on timeline`;
    const body = emailData.body || `Hi ${recipientFirstName}, I need a bit more time on this. I'll have it to you by ${newEtaDisplay}. Thanks for your patience.`;
    const message = emailData.message || `Honest holding update sent. New ETA: ${newEtaDisplay}.`;

    // Send via Gmail if a real token is present
    const token = accessToken || "";
    let sendStatus = "simulated";

    if (token && !token.startsWith("demo-")) {
      const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
      const emailLines = [
        `To: ${recipient}`,
        `Subject: ${utf8Subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/plain; charset=UTF-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        body,
      ];
      const rawEmail = emailLines.join("\r\n");
      const encodedEmail = base64UrlSafe(rawEmail);

      try {
        const gmailRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw: encodedEmail }),
        });

        if (gmailRes.ok) {
          sendStatus = "sent";
          console.log(`[Crisis Trigger] Message successfully sent to ${recipient}`);
        } else {
          const errText = await gmailRes.text();
          console.warn(`[Crisis Trigger] Gmail API returned error: ${errText}`);
          sendStatus = "gmail_error";
        }
      } catch (gmailErr) {
        console.warn(`[Crisis Trigger] Gmail fetch failed:`, gmailErr);
        sendStatus = "network_error";
      }
    } else {
      console.log(`[Crisis Trigger] [Demo/No Token] Simulated send to ${recipient}. Would have sent: "${subject}"`);
    }

    res.json({
      status: sendStatus,
      new_eta_ms: newEtaMs,
      new_eta_display: newEtaDisplay,
      message,
      subject,
      body,
    });
  } catch (err: any) {
    console.error("[Crisis Trigger Error]:", err);
    res.status(500).json({ error: err.message || "Failed to generate and send crisis message" });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Markdown parsing + rendering helpers for Cryo-Save document generation.
//
// Gemini is instructed to draft `content` as clean Markdown (## headings,
// **bold**, - bullets, 1. numbered lists). Without this layer, the PDF/DOCX/
// TXT generators below used to dump that raw text onto the page verbatim —
// so the output literally showed "##" and "**" characters instead of actual
// headings and bold text. These helpers parse that Markdown once and let
// each format's renderer turn it into real formatting.
// ─────────────────────────────────────────────────────────────────────────

type MdLineType = 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered' | 'paragraph' | 'blank';
interface MdLine { type: MdLineType; text: string; }

function parseMarkdownLines(content: string): MdLine[] {
  const rawLines = (content || "").replace(/\r\n/g, "\n").split("\n");
  const lines: MdLine[] = [];
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      lines.push({ type: 'blank', text: '' });
    } else if (/^###\s+/.test(trimmed)) {
      lines.push({ type: 'h3', text: trimmed.replace(/^###\s+/, '') });
    } else if (/^##\s+/.test(trimmed)) {
      lines.push({ type: 'h2', text: trimmed.replace(/^##\s+/, '') });
    } else if (/^#\s+/.test(trimmed)) {
      lines.push({ type: 'h1', text: trimmed.replace(/^#\s+/, '') });
    } else if (/^[-*]\s+/.test(trimmed)) {
      lines.push({ type: 'bullet', text: trimmed.replace(/^[-*]\s+/, '') });
    } else if (/^\d+[.)]\s+/.test(trimmed)) {
      lines.push({ type: 'numbered', text: trimmed.replace(/^\d+[.)]\s+/, '') });
    } else {
      lines.push({ type: 'paragraph', text: trimmed });
    }
  }
  return lines;
}

// Splits "some **bold** text" into [{text:"some ", bold:false}, {text:"bold", bold:true}, ...]
// so renderers can apply real bold styling instead of printing literal asterisks.
function splitBoldSegments(text: string): Array<{ text: string; bold: boolean }> {
  const segments: Array<{ text: string; bold: boolean }> = [];
  const re = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) segments.push({ text: text.slice(lastIndex, match.index), bold: false });
    segments.push({ text: match[1], bold: true });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), bold: false });
  if (segments.length === 0) segments.push({ text, bold: false });
  return segments;
}

function stripBold(text: string): string {
  return (text || "").replace(/\*\*(.+?)\*\*/g, '$1');
}

// Renders parsed Markdown into a PDFKit document with real headings/bold/bullets.
function renderMarkdownToPdf(doc: PDFKit.PDFDocument, content: string): void {
  const lines = parseMarkdownLines(content);
  let numberedCounter = 0;

  const writeLine = (prefix: string, text: string, fontSize: number, opts: any = {}) => {
    const segments = splitBoldSegments(text);
    doc.fontSize(fontSize).fillColor("#1a1a1a");
    if (prefix) doc.font("Helvetica").text(prefix, { continued: true, ...opts });
    segments.forEach((seg, idx) => {
      const isLast = idx === segments.length - 1;
      doc.font(seg.bold ? "Helvetica-Bold" : "Helvetica");
      doc.text(seg.text, { continued: !isLast, ...opts });
    });
  };

  for (const line of lines) {
    switch (line.type) {
      case 'blank':
        doc.moveDown(0.5);
        numberedCounter = 0;
        break;
      case 'h1':
        doc.moveDown(0.6);
        doc.font("Helvetica-Bold").fontSize(16).fillColor("#111111").text(line.text);
        doc.moveDown(0.3);
        numberedCounter = 0;
        break;
      case 'h2':
        doc.moveDown(0.5);
        doc.font("Helvetica-Bold").fontSize(13).fillColor("#111111").text(line.text);
        doc.moveDown(0.2);
        numberedCounter = 0;
        break;
      case 'h3':
        doc.moveDown(0.4);
        doc.font("Helvetica-Bold").fontSize(11.5).fillColor("#222222").text(line.text);
        doc.moveDown(0.15);
        numberedCounter = 0;
        break;
      case 'bullet':
        writeLine("  •  ", line.text, 11, { lineGap: 4 });
        numberedCounter = 0;
        break;
      case 'numbered':
        numberedCounter += 1;
        writeLine(`  ${numberedCounter}.  `, line.text, 11, { lineGap: 4 });
        break;
      default:
        numberedCounter = 0;
        writeLine("", line.text, 11, { align: "left", lineGap: 4 });
    }
  }
}

// Renders parsed Markdown into docx Paragraph objects with real heading styles,
// bold runs, and bullet formatting.
function markdownToDocxParagraphs(content: string): Paragraph[] {
  const lines = parseMarkdownLines(content);
  const paragraphs: Paragraph[] = [];
  let numberedCounter = 0;

  const toRuns = (text: string) =>
    splitBoldSegments(text).map(seg => new TextRun({ text: seg.text, bold: seg.bold }));

  for (const line of lines) {
    switch (line.type) {
      case 'blank':
        paragraphs.push(new Paragraph({ text: "" }));
        numberedCounter = 0;
        break;
      case 'h1':
        paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: toRuns(line.text) }));
        numberedCounter = 0;
        break;
      case 'h2':
        paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 }, children: toRuns(line.text) }));
        numberedCounter = 0;
        break;
      case 'h3':
        paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 }, children: toRuns(line.text) }));
        numberedCounter = 0;
        break;
      case 'bullet':
        paragraphs.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: toRuns(line.text) }));
        numberedCounter = 0;
        break;
      case 'numbered':
        numberedCounter += 1;
        paragraphs.push(new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: `${numberedCounter}. ` }), ...toRuns(line.text)],
        }));
        break;
      default:
        numberedCounter = 0;
        paragraphs.push(new Paragraph({ spacing: { after: 120 }, children: toRuns(line.text) }));
    }
  }
  return paragraphs;
}

// Strips Markdown syntax down to clean, readable plain text for the .txt fallback format.
function markdownToPlainText(content: string): string {
  const lines = parseMarkdownLines(content);
  const out: string[] = [];
  let numberedCounter = 0;
  for (const line of lines) {
    switch (line.type) {
      case 'blank':
        out.push('');
        numberedCounter = 0;
        break;
      case 'h1':
        out.push(line.text.toUpperCase());
        out.push('='.repeat(Math.min(Math.max(line.text.length, 3), 60)));
        numberedCounter = 0;
        break;
      case 'h2':
      case 'h3':
        out.push(stripBold(line.text));
        out.push('-'.repeat(Math.min(Math.max(line.text.length, 3), 60)));
        numberedCounter = 0;
        break;
      case 'bullet':
        out.push(`  • ${stripBold(line.text)}`);
        numberedCounter = 0;
        break;
      case 'numbered':
        numberedCounter += 1;
        out.push(`  ${numberedCounter}. ${stripBold(line.text)}`);
        break;
      default:
        numberedCounter = 0;
        out.push(stripBold(line.text));
    }
  }
  return out.join('\n');
}

// Part 6 — The new backend endpoint POST /api/cryo-save
app.post("/api/cryo-save", async (req, res) => {
  const {
    userId,
    taskText,
    assignmentInstructions,
    submissionFormat,
    recipient,
    accessToken,
    contexts,
    taskId,
  } = req.body;

  if (!recipient || !taskText || !submissionFormat) {
    res.status(400).json({ error: "Missing required fields: recipient, taskText, submissionFormat" });
    return;
  }

  console.log(`[Cryo-Save] Received ${contexts?.length || 0} context chunks for userId: ${userId}.`);

  try {
    // Step A: Content generation (Map-Reduce) using Gemini 3.5-flash
    const chunks = contexts || [];
    const batchSize = 5;
    const partialAnswers: string[] = [];
    
    // 1. Batch Map — draft grounded, specific partial answers per batch of context.
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const batchPrompts = batch.map((chunk: string, index: number) => `[Document Chunk ${index + 1}]:\n${chunk}`).join("\n\n");

      const batchPrompt = `
You are completing a real assignment for a student against a hard deadline. This is one batch of source material out of several being processed in parallel — other batches cover other parts of the source set.

ASSIGNMENT: "${taskText}"
${assignmentInstructions ? `SPECIFIC INSTRUCTIONS / QUESTIONS TO ANSWER: "${assignmentInstructions}"` : ""}

SOURCE CONTEXT FOR THIS BATCH:
${batchPrompts}

Using the context above, write direct, fully-worked answers for whichever parts of the assignment this context supports. Rules:
- Be concrete. Use the exact facts, numbers, definitions, formulas, steps, or code present in the context. Never write filler like "this is an important topic" or "this requires further study" — that is a failure.
- If the context only partially covers a question, use it as far as it goes and complete the rest with sound, correct general knowledge of the subject so the answer is whole and usable — blend it smoothly, don't flag the gap.
- If this batch's context has nothing relevant to a given question, simply don't address that question here (it will be covered by another batch or the final pass).
- Format with clean Markdown: "##" for a question or section heading, "**bold**" only for genuinely key terms or results, "-" for bullet lists, "1." for numbered steps. No code fences unless the answer is literally source code.
- No disclaimers, no hedging, no meta-commentary about being an AI or about these instructions.
`;

      const batchRes = await generateContentWithRetry({
        model: "gemini-3.5-flash",
        contents: batchPrompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        },
      });
      partialAnswers.push(batchRes.text || "");
    }
    
    // Add Guard: If no partial answers, error immediately
    if (partialAnswers.length === 0) {
      throw new Error("No document context was found for this task. Upload context documents before using Cryo-Save.");
    }

    // 2. Reduce Synthesis — merge batches into one complete, correctly-formatted submission.
    const formatGuidance = submissionFormat === "PPT"
      ? `This becomes a slide deck. Structure the ENTIRE "content" field as a sequence of slides using EXACTLY this pattern and nothing else:
Slide 1: <slide title>
- <bullet point>
- <bullet point>

Slide 2: <slide title>
- <bullet point>
...
Every slide must start with a line matching "Slide N: <title>" exactly, followed only by "- " bullet lines (no paragraphs). Keep each bullet under ~18 words. Use however many slides (typically 5-10) it takes to cover the assignment completely.`
      : `Structure "content" as a clean, well-organized document in Markdown:
- "##" for each major section or question heading — mirror the assignment's structure, with one heading per question if multiple questions were given
- "**bold**" sparingly for key terms or final results, never for whole sentences
- "-" for bullet lists and "1." for numbered steps where listing items helps clarity
- Short paragraphs (3-5 sentences), with a blank line between sections
- No tables, no code fences unless the content is literally source code`;

    const reducePrompt = `
You are finishing a real assignment submission for a student against an imminent deadline. The partial answers below were drafted from the student's own course materials across different batches — your job is to merge them into ONE complete, correct, specific final submission, not to summarize them.

ASSIGNMENT: "${taskText}"
${assignmentInstructions ? `SPECIFIC INSTRUCTIONS / QUESTIONS THAT MUST EACH BE FULLY ANSWERED: "${assignmentInstructions}"` : ""}

PARTIAL ANSWERS (from different batches of source material — merge them, remove duplication, and where they overlap keep the more specific/detailed version):
${partialAnswers.map((a, i) => `[Batch ${i + 1}]:\n${a}`).join("\n\n")}

HARD REQUIREMENTS:
1. Directly and completely answer every distinct question or requirement in the assignment instructions above. If multiple questions were given, address each one explicitly under its own heading — never collapse them into one vague answer.
2. Be specific and correct: preserve exact facts, numbers, formulas, definitions, or code from the partial answers. Never replace a specific answer with a generic restatement of the question.
3. You may use sound general subject-matter knowledge to smoothly fill any genuine gaps the partial answers leave, as long as it doesn't contradict them — but always prefer the specific material already present in the partial answers over a generic statement.
4. No disclaimers, no hedging ("this is a complex topic", "consult a professional"), no meta-commentary about being an AI or about these instructions.
5. ${formatGuidance}

Return a JSON object with exactly two fields:
- title: a short, specific, professional title that names the actual subject/topic of this submission (never the generic phrase "Emergency Submission").
- content: the full final submission text, formatted exactly per the rules above.
`;
    
    console.log(`[Cryo-Save] Generating content for format: ${submissionFormat}`);
    const response = await generateContentWithRetry({
      model: "gemini-3.5-flash",
      contents: reducePrompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            content: { type: Type.STRING },
          },
          required: ["title", "content"],
        }
      }
    });

    const parsedData = JSON.parse(response.text || "{}");
    const title = parsedData.title || "Emergency Submission";
    const content = parsedData.content || "";

    if (!content) {
      throw new Error("Gemini returned empty content for the submission.");
    }

    // Add support for draft review before sending
    if (req.body.reviewOnly || req.body.generateOnly) {
      res.json({
        status: "draft",
        title,
        content,
        format: submissionFormat
      });
      return;
    }

    // Step B: File creation based on submissionFormat
    let fileBuffer: Buffer;
    let extension = "txt";

    if (submissionFormat === "PDF") {
      extension = "pdf";
      fileBuffer = await new Promise<Buffer>((resolve, reject) => {
        const doc = new PDFDocument({ margins: { top: 56, bottom: 56, left: 56, right: 56 } });
        const chunks: Buffer[] = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", (err) => reject(err));

        // Title: 18pt bold Helvetica
        doc.font("Helvetica-Bold").fontSize(18).fillColor("#111111").text(title);
        doc.moveDown(1.2);

        // Body: parsed Markdown rendered with real headings, bold text, and bullets.
        renderMarkdownToPdf(doc, content);
        doc.end();
      });
    } else if (submissionFormat === "DOCX") {
      extension = "docx";
      const docxDocument = new Document({
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({
                text: title,
                heading: HeadingLevel.HEADING_1,
                spacing: { after: 200 },
              }),
              // Body: parsed Markdown rendered with real heading styles, bold runs, and bullets.
              ...markdownToDocxParagraphs(content),
            ],
          },
        ],
      });
      fileBuffer = await Packer.toBuffer(docxDocument);
    } else if (submissionFormat === "PPT") {
      extension = "pptx";
      const pptx = new pptxgen();
      
      const lines = content.split("\n");
      const slides: Array<{ title: string; body: string }> = [];
      let currentSlide: { title: string; body: string } | null = null;

      for (const line of lines) {
        const trimmed = line.trim();
        const slideMatch = trimmed.match(/^Slide\s+(\d+)\s*:\s*(.*)$/i);
        if (slideMatch) {
          if (currentSlide) {
            slides.push(currentSlide);
          }
          currentSlide = {
            title: slideMatch[2] ? slideMatch[2].trim() : `Slide ${slideMatch[1]}`,
            body: ""
          };
        } else {
          if (currentSlide) {
            currentSlide.body += (currentSlide.body ? "\n" : "") + line;
          } else if (trimmed) {
            currentSlide = {
              title: title || "Introduction",
              body: line
            };
          }
        }
      }
      if (currentSlide) {
        slides.push(currentSlide);
      }

      if (slides.length === 0) {
        slides.push({ title: title, body: content });
      }

      for (const s of slides) {
        const slide = pptx.addSlide();
        slide.background = { color: "FFFFFF" };
        slide.addText(stripBold(s.title), { x: 0.5, y: 0.4, w: 9, h: 0.9, fontSize: 24, bold: true, color: "1A1A2E" });

        // Strip leading "- " bullet markers and bold syntax, then let pptxgenjs
        // auto-bullet each line — instead of dumping raw "- text" lines onto the slide.
        const bodyText = s.body
          .split("\n")
          .map(l => stripBold(l.trim().replace(/^[-*]\s+/, "")))
          .filter(Boolean)
          .join("\n");

        if (bodyText) {
          slide.addText(bodyText, {
            x: 0.5, y: 1.4, w: 9, h: 5.2,
            fontSize: 16, color: "222222", align: "left", valign: "top",
            bullet: true,
            lineSpacingMultiple: 1.3,
          });
        }
      }

      fileBuffer = await pptx.write("nodebuffer" as any) as Buffer;
    } else {
      // Default / TXT format — Markdown syntax stripped down to clean plain text.
      extension = "txt";
      fileBuffer = Buffer.from(title + "\n" + "=".repeat(Math.min(Math.max(title.length, 3), 60)) + "\n\n" + markdownToPlainText(content), "utf-8");
    }

    // Step C: Send via Gmail with attachment
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9_\s-]/g, "").replace(/\s+/g, "_") || "submission";
    const filename = `${sanitizedTitle}.${extension}`;
    const token = accessToken || "";
    let sendStatus = "simulated";

    if (token && !token.startsWith("demo-")) {
      const boundary = "coldbreak_boundary";
      const subject = `Submission: ${title}`;
      const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;

      const emailLines = [
        `To: ${recipient}`,
        `Subject: ${utf8Subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset=UTF-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        `Please find attached my submission for: ${taskText}. This was submitted via ColdBreak's emergency protocol.`,
        ``,
        `--${boundary}`,
        `Content-Type: application/octet-stream`,
        `Content-Disposition: attachment; filename="${filename}"`,
        `Content-Transfer-Encoding: base64`,
        ``,
        fileBuffer.toString("base64"),
        `--${boundary}--`
      ];

      const rawEmail = emailLines.join("\r\n");
      const encodedEmail = base64UrlSafe(rawEmail);

      try {
        const gmailRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw: encodedEmail }),
        });

        if (gmailRes.ok) {
          sendStatus = "sent";
          console.log(`[Cryo-Save] Email sent to ${recipient} with attachment ${filename}`);
        } else {
          const errText = await gmailRes.text();
          console.warn(`[Cryo-Save] Gmail API error: ${errText}`);
          sendStatus = "gmail_error";
        }
      } catch (gmailErr) {
        console.warn(`[Cryo-Save] Gmail fetch failed:`, gmailErr);
        sendStatus = "network_error";
      }
    } else {
      console.log(`[Cryo-Save] [Demo Mode] Generation complete. Title: "${title}". File length: ${fileBuffer.length} bytes.`);
    }

    // Step D: Response
    res.json({
      status: sendStatus,
      sentTo: recipient,
      fileSize: fileBuffer.length,
      title,
      format: submissionFormat
    });
  } catch (err: any) {
    console.error("[Cryo-Save Endpoint Error]:", err);
    res.status(500).json({ error: err.message || "Failed to execute Cryo-Save" });
  }
});

// Issue 1: Stuck Suggestion Endpoint
app.post("/api/stuck-suggestion", async (req, res) => {
  const { current_step_text, task_name, difficulty } = req.body;
  
  if (!current_step_text) {
    res.status(400).json({ error: "Missing required field: current_step_text" });
    return;
  }

  const systemPrompt = `You are a micro-action coach. A user is paralyzed on a specific task
step and cannot begin it. Give them ONE concrete action they can do
right now that takes under 90 seconds and directly starts this step.

Hard rules:
- Be completely specific to the step text given — never give generic advice
- Never say 'just start', 'take a deep breath', or anything motivational
- The action must be physically observable: open a specific thing,
  write a specific thing, type a specific word, read a specific section
- Maximum 12 words
- Start with a verb
- No explanation, no encouragement, no punctuation beyond the sentence

Examples of correct output:
Step: 'Write the introduction for my history essay'
Output: Open a doc and type the year the event happened

Step: 'Review the Q2 spreadsheet before the meeting'
Output: Open the spreadsheet and scroll to the last row

Step: 'Send follow-up email to Priya about the proposal'
Output: Open Gmail and type Priya's name in the To field

Current step: '${current_step_text}'
Task name: '${task_name || ""}'
Difficulty: '${difficulty || "medium"}'

Output the single micro-action now. Nothing else.`;

  try {
    const response = await generateContentWithRetry({
      model: "gemini-3.5-flash",
      contents: "Generate the micro-action now.",
      config: {
        systemInstruction: systemPrompt,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.HIGH,
        },
      }
    });

    const suggestion = (response.text || "").trim();
    res.json({ suggestion });
  } catch (err: any) {
    console.error("[Stuck Suggestion Error]:", err);
    res.status(500).json({ error: err.message || "Failed to generate stuck suggestion" });
  }
});

// The Autonomous ReAct loop endpoint
const handleReactLoopTask = async (req: any, res: any) => {
  const {
    taskText, task_text,
    deadline, deadline_timestamp,
    recipient,
    stakeLevel,
    expectancy,
    value,
    gamma,
    archetype,
    accessToken,
    difficulty,
    importance,
    deadline_flexible, deadlineFlexible,
    step_depth,
    recipient_name,
    self_difficulty,
    user_time_estimate,
    contexts,
    step_count
  } = req.body;

  const finalTaskText = taskText || task_text;
  const finalDeadline = deadline || deadline_timestamp;

  if (!finalTaskText || !finalDeadline || !recipient) {
    res.status(400).json({ error: "Missing required fields taskText, deadline, or recipient" });
    return;
  }

  const finalDifficulty = difficulty || 'medium';
  const finalImportance = importance || 'someone_waiting';
  const finalDeadlineFlexible = deadline_flexible !== undefined ? deadline_flexible : (deadlineFlexible !== undefined ? deadlineFlexible : true);

  let ragContext = "";
  let ragAddedStep = false;

  // RAG personalization: the frontend retrieves relevant chunks client-side
  // (via rag-client.ts, against users/{uid}/context_chunks) and sends the
  // already-selected top-K chunk texts here.
  if (contexts && Array.isArray(contexts) && contexts.length > 0) {
    ragContext = `\n[PERSONALIZED DOCUMENT CONTEXT]\n${contexts.join('\n\n')}\n`;
  }

  const deadline_timestamp_ms = new Date(finalDeadline).getTime();
  let gapMinutes = (deadline_timestamp_ms - Date.now()) / (60 * 1000);

  // Map difficulty to E (Expectancy)
  let E = 0.70;
  if (finalDifficulty === 'easy') E = 0.88;
  else if (finalDifficulty === 'medium') E = 0.70;
  else if (finalDifficulty === 'hard') E = 0.52;

  // 4a. DIFFICULTY SELF-REPORT:
  if (self_difficulty === 'easy') {
    E = Math.min(E + 0.10, 0.90);
  } else if (self_difficulty === 'tough') {
    E = Math.max(E - 0.10, 0.45);
  } else if (self_difficulty === 'dreading') {
    E = Math.max(E - 0.18, 0.40);
  }

  // Map importance to V (Value)
  const V_MAP: Record<string, number> = {
    personal_only: 2.5,
    low_external: 4.5,
    someone_waiting: 7.0,
    high_consequence: 8.5,
    critical: 9.8
  };
  const V = V_MAP[finalImportance] ?? 7.0;
  console.log('[ColdBreak] Importance:', finalImportance, '→ V:', V);

  console.log('E:', E, 'V:', V, 'gap_mins:', gapMinutes);

  const formatTime = (ms: number) => {
    return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const getFallbackPlan = () => {
    const now_ms = Date.now();
    const fallbackMins1 = Math.min(5, Math.max(1, Math.floor(gapMinutes * 0.15)));
    const fallbackMins2 = Math.max(5, Math.floor(gapMinutes * 0.70));
    const fallbackMins3 = Math.min(5, Math.max(1, Math.floor(gapMinutes * 0.15)));

    const t1 = now_ms + 10 * 1000;
    const t2 = t1 + fallbackMins1 * 60 * 1000;
    const t3 = t2 + fallbackMins2 * 60 * 1000;

    const steps = [
      {
        id: `step-0-fallback-${Date.now()}`,
        time: formatTime(t1),
        action: 'If it is time, then I will set everything up and get oriented',
        durationMinutes: fallbackMins1,
        duration_minutes: fallbackMins1,
        completed: false,
        display_text: 'Set everything up and get oriented',
        display_time: 'Right now',
        trigger_time: formatTime(t1),
        trigger_time_unix_ms: t1,
        trigger_time_display: 'Right now',
        end_time_unix_ms: t1 + fallbackMins1 * 60 * 1000,
        implementation_intention: 'When I sit down, I will open everything I need',
      },
      {
        id: `step-1-fallback-${Date.now()}`,
        time: formatTime(t2),
        action: 'If it is time, then I will work through the main part without stopping',
        durationMinutes: fallbackMins2,
        duration_minutes: fallbackMins2,
        completed: false,
        display_text: 'Work through the main part without stopping',
        display_time: formatTime(t2),
        trigger_time: formatTime(t2),
        trigger_time_unix_ms: t2,
        trigger_time_display: formatTime(t2),
        end_time_unix_ms: t2 + fallbackMins2 * 60 * 1000,
        implementation_intention: 'When I start the timer, I will not switch tabs',
      },
      {
        id: `step-2-fallback-${Date.now()}`,
        time: formatTime(t3),
        action: 'If it is time, then I will review and finish',
        durationMinutes: fallbackMins3,
        duration_minutes: fallbackMins3,
        completed: false,
        display_text: 'Review and finish',
        display_time: formatTime(t3),
        trigger_time: formatTime(t3),
        trigger_time_unix_ms: t3,
        trigger_time_display: formatTime(t3),
        end_time_unix_ms: t3 + fallbackMins3 * 60 * 1000,
        implementation_intention: 'When I reach this step, I will check once and submit',
      }
    ];

    let mission_tier: 'critical' | 'standard' | 'training' = 'training';
    if (gapMinutes < 90) {
      mission_tier = 'critical';
    } else if (gapMinutes <= 240) {
      mission_tier = 'standard';
    }

    const crisis_buffer_minutes = finalDeadlineFlexible === false ? 60 : 30;
    const watchdogOffset = crisis_buffer_minutes * 60 * 1000;
    const watchdogTimeIso = new Date(deadline_timestamp_ms - watchdogOffset).toISOString();

    const fallbackLogs = [
      {
        step: 1,
        thought: "The autonomous agent has served an optimized fallback plan due to operational constraints.",
        tool: "serve_fallback_plan",
        result: "Fallback plan activated successfully.",
        timestamp: new Date().toISOString()
      }
    ];

    return {
      status: "active",
      task_id: req.body.userId || "demo-user-001",
      steps,
      logs: fallbackLogs,
      reactLog: fallbackLogs,
      watchdogTime: watchdogTimeIso,
      difficulty: finalDifficulty,
      importance: finalImportance,
      deadline_flexible: finalDeadlineFlexible,
      expectancy: E * 10,
      value: V,
      deadline_timestamp: deadline_timestamp_ms,
      mission_tier,
      estimated_difficulty: 'moderate' as const,
      total_duration_minutes: fallbackMins1 + fallbackMins2 + fallbackMins3,
      E,
      V,
    };
  };

  const logs: Array<{ step: number; thought: string; tool: string; result: string; timestamp: string }> = [];
  let currentStepNum = 1;

  function addLog(thought: string, tool: string, result: string) {
    logs.push({
      step: currentStepNum++,
      thought,
      tool,
      result,
      timestamp: new Date().toISOString(),
    });
  }

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('TIMEOUT')), 14000)
  );

  const mainGenerationPromise = (async () => {
    // 1. Tool: analyze_task
    addLog(
      "The user has submitted a procrastination task. I need to run the 'analyze_task' tool to extract task parameters and evaluate its urgency and stake levels.",
      "analyze_task",
      "Running analysis on the task payload..."
    );

    const analysisPrompt = `
      Analyze the following procrastination task:
      Task: "${finalTaskText}"
      Deadline: "${finalDeadline}"
      Stake level suggested: "${stakeLevel || 'medium'}"
      
      Determine the recipient, clean deadline description, and verify the stake level.
      Return a clean JSON.
    `;

    const analysisRes = await generateContentWithRetry({
      model: "gemini-3.5-flash",
      contents: analysisPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recipient: { type: Type.STRING },
            deadlineText: { type: Type.STRING },
            stakeLevel: { type: Type.STRING, enum: ["low", "medium", "high"] },
          },
          required: ["recipient", "deadlineText", "stakeLevel"],
        }
      }
    });

    const analysisResult = JSON.parse(analysisRes.text || "{}");
    addLog(
      "Task successfully analyzed. Extracted recipient, verified stake level, and set clean deadline values.",
      "analyze_task",
      JSON.stringify(analysisResult)
    );

    // 2. Tool: decompose_task
    addLog(
      `I need to decompose the task into action steps formatted as timed implementation intentions matching the user's procrastination archetype: "${archetype || 'deadline_dancer'}". The first step must be extremely small, strictly under 7 minutes, to bypass initial action paralysis.`,
      "decompose_task",
      "Generating timed implementation intentions..."
    );

    // Translate step_depth label to a concrete step count
    // (Frontend sends step_depth, not step_count — map here)
    const stepDepthToCount: Record<string, number> = {
      quick: 3,
      balanced: 5,
      thorough: 7,
    };
    const derivedStepCount = step_depth
      ? (stepDepthToCount[step_depth] ?? 5)
      : (step_count ?? 5);
    const requestedSteps = Math.min(Math.max(derivedStepCount, 3), 8);
    // If rag_used and document seems complex (ragContext.length > 600), 
    // allow +1 step beyond requested:
    const actualSteps = (ragContext.length > 600 && requestedSteps < 8)
      ? requestedSteps + 1
      : requestedSteps;
    ragAddedStep = actualSteps > requestedSteps;

    const stepCountInstructions = `Generate exactly ${actualSteps} steps.`;
    const firstStepMinutes = actualSteps >= 7 ? 4 : 7;

    let userEstimateRule = "";
    if (user_time_estimate) {
      userEstimateRule = `\nThe user estimates this task will take ${user_time_estimate}. Align your step durations so they sum approximately to this range. Do not exceed it significantly and do not be much shorter than it.`;
    }

    let contextGuideline = "";
    const effectiveContext = ragContext || (contexts && Array.isArray(contexts) && contexts.length > 0 ? `\n[PERSONALIZED DOCUMENT CONTEXT]\n${contexts.join('\n\n')}\n` : "");

    if (effectiveContext) {
      contextGuideline = `\n\nSOURCE MATERIAL:
${effectiveContext}

Every step you generate must be checked against the source material above. If the source material specifies a topic, format, rubric, question, or procedure, your steps must directly reference that specific content — not a generic paraphrase. If the source material is empty or irrelevant to this task, ignore it and proceed normally.\n`;
    }

    const decomposePrompt = `${contextGuideline}
      Decompose the task: "${finalTaskText}"
      Deadline: "${finalDeadline}"
      Archetype: "${archetype || 'deadline_dancer'}"
      Gamma procrastination coefficient: ${gamma || 0.5}
      Success expectancy (1-10): ${E * 10}
      Importance value (1-10): ${V}
      
      ARCHETYPE BEHAVIOR RULES:
      - Deadline Dancer: Cluster implementation steps very close to the deadline.
      - Overwhelmed Perfectionist: Break into many small, micro-decomposed steps to avoid choice fatigue.
      - Context Switcher: Structure steps in 25-minute Pomodoro blocks with brief breaks.
      - Paralyzed Planner: Focus heavily on the first tiny step. All steps should be clear but designed so only Step 1 is actioned initially.
      
      STEP COUNT RULE:
      - ${stepCountInstructions}
      
      CRITICAL INTRINSIC RULE:
      - Step 1 MUST be extremely tiny and take under ${firstStepMinutes} minutes to execute (e.g. "If it is 10:00 AM, then I will open the document and type just the title sentence").
      
      Format each action step EXACTLY as: "If it is [TIME], then I will [SPECIFIC ACTION]".
      ${userEstimateRule}
      Generate steps efficiently. Each step's display_text must be under 12 words. Avoid preamble. Return only the JSON structure requested. Do not explain your reasoning in the JSON — only in the ReAct log.
    `;

    const decomposeRes = await generateContentWithRetry({
      model: "gemini-3.5-flash",
      contents: decomposePrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              time: { type: Type.STRING, description: "Time of step, e.g. 10:30 AM" },
              action: { type: Type.STRING, description: "Action step in if-then format" },
              durationMinutes: { type: Type.INTEGER, description: "Duration of the action step" },
            },
            required: ["time", "action", "durationMinutes"],
          },
        }
      }
    });

    const stepsRaw = JSON.parse(decomposeRes.text || "[]");
    if (stepsRaw.length > 0) {
      stepsRaw[0].durationMinutes = Math.min(stepsRaw[0].durationMinutes, firstStepMinutes);
    }

    const stripActionPrefix = (actionStr: string): string => {
      const regex = /If it is .*?,?\s*then I will (.*)/i;
      const match = actionStr.match(regex);
      if (match && match[1]) {
        const actionText = match[1].trim();
        return actionText.charAt(0).toUpperCase() + actionText.slice(1);
      }
      const iWillIndex = actionStr.toLowerCase().indexOf("i will ");
      if (iWillIndex !== -1) {
        const actionText = actionStr.slice(iWillIndex + 7).trim();
        return actionText.charAt(0).toUpperCase() + actionText.slice(1);
      }
      return actionStr;
    };

    const steps = stepsRaw.map((s: any, idx: number) => {
      const display_text = stripActionPrefix(s.action);
      return {
        id: `step-${idx}-${Date.now()}`,
        time: s.time,
        action: s.action,
        durationMinutes: s.durationMinutes,
        duration_minutes: s.durationMinutes,
        completed: false,
        display_text: display_text,
        display_time: s.time,
        trigger_time: s.time,
      };
    });

    addLog(
      `Decomposition complete under the ${archetype} protocol. Generated ${steps.length} timed action steps. Step 1 duration is locked to ${steps[0]?.durationMinutes || 5} minutes to lower friction.`,
      "decompose_task",
      JSON.stringify(steps)
    );

    const now_ms = Date.now();
    const deadline_ms = deadline_timestamp_ms;
    const available_ms = deadline_ms - now_ms;

    if (archetype === 'context_switcher') {
      steps.forEach((step: any) => {
        step.durationMinutes = Math.min(step.durationMinutes, 25);
        step.duration_minutes = step.durationMinutes;
      });
    }

    const distributeTimestamps = (startOffsetMs: number) => {
      const first_step_start_ms = now_ms + startOffsetMs;
      const latest_end_ms = deadline_ms - (10 * 60 * 1000);
      const workable_ms = latest_end_ms - first_step_start_ms;

      const total_work_ms = steps.reduce(
        (sum: number, s: any) => sum + (s.durationMinutes * 60 * 1000), 0
      );

      const n_gaps = steps.length - 1;
      const raw_gap_ms = n_gaps > 0
        ? (workable_ms - total_work_ms) / n_gaps
        : 0;
      const gap_ms = Math.min(Math.max(raw_gap_ms, 5 * 60 * 1000), 20 * 60 * 1000);
      gapMinutes = gap_ms / 60000;

      let cursor_ms = first_step_start_ms;
      steps.forEach((step: any) => {
        step.trigger_time_unix_ms = cursor_ms;
        step.trigger_time_display = new Date(cursor_ms).toLocaleTimeString(
          'en-US', { hour: '2-digit', minute: '2-digit', hour12: true }
        );
        step.end_time_unix_ms = cursor_ms + (step.durationMinutes * 60 * 1000);
        cursor_ms = step.end_time_unix_ms + gap_ms;
      });
    };

    distributeTimestamps(8 * 60 * 1000);

    if (archetype === 'deadline_dancer') {
      distributeTimestamps(available_ms * 0.55);
    } else if (archetype === 'paralyzed_planner') {
      steps.forEach((step: any, idx: number) => {
        if (idx > 0) {
          step.trigger_time_display = null;
        }
      });
    }

    return { steps, logs };
  })();

  try {
    const result: any = await Promise.race([mainGenerationPromise, timeoutPromise]);
    
    let mission_tier: 'critical' | 'standard' | 'training' = 'training';
    if (gapMinutes < 90) {
      mission_tier = 'critical';
    } else if (gapMinutes <= 240) {
      mission_tier = 'standard';
    }

    let estimated_difficulty: 'straightforward' | 'moderate' | 'demanding' = 'moderate';
    if (E >= 0.80) {
      estimated_difficulty = 'straightforward';
    } else if (E >= 0.65) {
      estimated_difficulty = 'moderate';
    } else {
      estimated_difficulty = 'demanding';
    }

    const total_duration_minutes = result.steps.reduce((sum: number, s: any) => sum + (s.duration_minutes || s.durationMinutes), 0);

    const crisis_buffer_minutes = finalDeadlineFlexible === false ? 60 : 30;
    const watchdogOffset = crisis_buffer_minutes * 60 * 1000;
    const watchdogTimeIso = new Date(deadline_timestamp_ms - watchdogOffset).toISOString();

    res.json({
      status: "active",
      task_id: req.body.userId || "demo-user-001",
      steps: result.steps,
      logs: result.logs,
      reactLog: result.logs,
      watchdogTime: watchdogTimeIso,
      difficulty: finalDifficulty,
      importance: finalImportance,
      deadline_flexible: finalDeadlineFlexible,
      expectancy: E * 10,
      value: V,
      deadline_timestamp: deadline_timestamp_ms,
      mission_tier,
      estimated_difficulty,
      total_duration_minutes,
      E,
      V,
      rag_used: ragContext.length > 0,
      rag_added_step: ragAddedStep,
    });
  } catch (err: any) {
    if (err.message === 'TIMEOUT') {
      console.warn('Gemini timeout — serving fallback plan');
      res.json(getFallbackPlan());
    } else {
      console.error("[ReAct Loop Error]:", err);
      res.json(getFallbackPlan());
    }
  }
};

app.post("/api/tasks/react-loop", handleReactLoopTask);
app.post("/api/analyze-task", handleReactLoopTask);

app.post("/api/get-hint", async (req, res) => {
  const { state, step_display_text } = req.body;
  try {
    const prompt = `You are an elite operational coach. The user is currently in state/archetype: "${state || 'unknown'}". They need to execute this next step: "${step_display_text || 'their task'}". Give a highly tactical, 1-sentence micro-tip to bypass resistance and start instantly.`;
    const response = await generateContentWithRetry({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are an elite operational coach. Give exactly 1 sentence, highly motivating and micro-tactical."
      }
    });
    res.json({ tip: response.text?.trim() || "Just open it and focus for 2 minutes." });
  } catch (err: any) {
    console.error("[Get Hint Error]:", err);
    res.json({ tip: "Lower the friction: start with just 1 small action right now." });
  }
});

// Vite & Static assets hosting
async function bootstrap() {
  const isProduction = process.env.NODE_ENV === "production";
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`ColdBreak backend server running on http://localhost:${PORT}`);
  });
}
bootstrap();