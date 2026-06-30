/// <reference types="vite/client" />
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer, getDoc, setDoc, updateDoc, collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp } from 'firebase/firestore';

declare const __FIREBASE_CONFIG__: any;

const getFirebaseConfig = () => {
  const globalConfig = typeof __FIREBASE_CONFIG__ !== 'undefined' ? __FIREBASE_CONFIG__ : {};
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || globalConfig.apiKey || "",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || globalConfig.authDomain || "",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || globalConfig.projectId || "",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || globalConfig.storageBucket || "",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || globalConfig.messagingSenderId || "",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || globalConfig.appId || "",
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || globalConfig.measurementId || "",
    firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID || globalConfig.firestoreDatabaseId || 'ai-studio-coldbreak-e3b0ab28-f794-4634-8699-ef8fc48c9c41',
  };
};

const firebaseConfig = getFirebaseConfig();
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/gmail.compose');
provider.addScope('https://www.googleapis.com/auth/gmail.send');

let cachedAccessToken: string | null = null;
let isSigningIn = false;

// Initialize auth state listener. Call this on app load.
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      // Try in-memory first, then sessionStorage fallback for page-refresh resilience
      if (!cachedAccessToken) {
        try { cachedAccessToken = sessionStorage.getItem('cb_access_token'); } catch (_) {}
      }
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else {
        // Token not in memory or storage — user must re-authenticate
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      try { sessionStorage.removeItem('cb_access_token'); } catch (_) {}
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Google Auth');
    }
    cachedAccessToken = credential.accessToken;
    // Persist so page refreshes don't drop to demo mode
    try { sessionStorage.setItem('cb_access_token', cachedAccessToken); } catch (_) {}
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Sign-in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  try { sessionStorage.removeItem('cb_access_token'); } catch (_) {}
};

export const getAccessToken = (): string | null => {
  return cachedAccessToken;
};

export const setAccessToken = (token: string) => {
  cachedAccessToken = token;
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
      isAnonymous: auth.currentUser?.isAnonymous || null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate Firebase Firestore connection as requested by firestore skill
export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    } else {
      // Don't crash at startup if connection test fails, but log it
      console.warn("Firestore connection test failed, potentially pending rule deployments:", error);
    }
  }
}
testConnection();

export const getUserProfile = async () => {
  const uid = auth.currentUser?.uid || "demo-user-001";
  const path = `users/${uid}/profile/data`;
  const docRef = doc(db, 'users', uid, 'profile', 'data');
  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
  return null;
};

export const updateUserProfile = async (updates: object) => {
  const uid = auth.currentUser?.uid || "demo-user-001";
  const path = `users/${uid}/profile/data`;
  const docRef = doc(db, 'users', uid, 'profile', 'data');
  try {
    await setDoc(docRef, updates, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
};

export const getMissionHistory = async (limitNum: number) => {
  const uid = auth.currentUser?.uid || "demo-user-001";
  const path = `users/${uid}/missions`;
  const colRef = collection(db, 'users', uid, 'missions');
  const q = query(colRef, orderBy('createdAt', 'desc'), limit(limitNum));
  try {
    const querySnap = await getDocs(q);
    const missions: any[] = [];
    querySnap.forEach((docSnap) => {
      const data = docSnap.data();
      missions.push({
        id: docSnap.id,
        taskText: data.taskText || "",
        // Firestore serverTimestamp() returns a Timestamp object — convert it properly
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? null,
        xpEarned: data.xpEarned || 0,
        stepsCompleted: data.stepsCompleted || 0,
        stepsTotal: data.stepsTotal || 0,
        complete: data.complete ?? false,
      });
    });
    return missions;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
};

export const saveMissionToHistory = async (mission: any) => {
  const uid = auth.currentUser?.uid || "demo-user-001";
  const path = `users/${uid}/missions`;
  const colRef = collection(db, 'users', uid, 'missions');
  try {
    await addDoc(colRef, {
      ...mission,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
};

export const retrieveAllContextChunks = async (userId: string): Promise<string[]> => {
  try {
    const colRef = collection(db, 'users', userId, 'context_chunks');
    console.log(`[Cryo-Save] Fetching chunks from collection: ${colRef.path}`);
    const snap = await getDocs(colRef);
    console.log(`[Cryo-Save] Snapshot size: ${snap.size}`);
    
    const chunks: any[] = [];
    snap.forEach(docSnap => {
        const data = docSnap.data();
        console.log(`[Cryo-Save] Found chunk: ${docSnap.id}, fileId: ${data.fileId}, index: ${data.index}`);
        chunks.push(data);
    });
    
    console.log(`[Cryo-Save] Retrieved ${chunks.length} chunks.`);

    // Sort client-side to preserve document order
    chunks.sort((a, b) => {
      if (a.fileId < b.fileId) return -1;
      if (a.fileId > b.fileId) return 1;
      return a.index - b.index;
    });
    
    return chunks.map(c => c.text);
  } catch (err) {
    console.error(`[Cryo-Save] Failed to retrieve chunks:`, err);
    throw err;
  }
};

