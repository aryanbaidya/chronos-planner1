import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  onAuthStateChanged, 
  User,
  setPersistence,
  browserLocalPersistence 
} from "firebase/auth";
import { 
  getFirestore, 
  collection, 
  onSnapshot, 
  query, 
  where, 
  addDoc, 
  updateDoc, 
  doc, 
  deleteDoc,
  setDoc,
  getDoc,
  Timestamp,
  getDocFromServer,
  enableMultiTabIndexedDbPersistence,
  initializeFirestore,
  onSnapshotsInSync
} from "firebase/firestore";
const firebaseConfig = {
  apiKey: "AIzaSyDU8WbUwRJ2dMw9vT9L5GpOepFP8dR78qA",
  authDomain: "chronos-planner-7a76c.firebaseapp.com",
  projectId: "chronos-planner-7a76c",
  storageBucket: "chronos-planner-7a76c.firebasestorage.app",
  messagingSenderId: "1017401652576",
  appId: "1:1017401652576:web:97f7245c36ba62d3c99a05",
  measurementId: "G-P2GCD318XB"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(console.error);

// Use initializeFirestore to force long-polling if needed (often helps in restricted iframe environments)
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false // fetch streams can sometimes cause issues in sandboxed environments
});

// Enable offline persistence
enableMultiTabIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    // Multiple tabs open, persistence can only be enabled in one tab at a a time.
    console.warn('Firestore persistence failed: Multiple tabs open');
  } else if (err.code === 'unimplemented') {
    // The current browser does not support all of the features required to enable persistence
    console.warn('Firestore persistence failed: Browser not supported');
  }
});

/**
 * Validates connection to Firestore backend
 * CRITICAL for debugging networking and provisioning issues.
 */
async function testConnection() {
  // Give the environment a moment to stabilize
  await new Promise(r => setTimeout(r, 2000));
  
  try {
    // Attempting to read a non-existent document from a known collection pattern
    // to verify the client can reach the backend.
    await getDocFromServer(doc(db, '_connection_test', 'status'));
    console.log("Firestore connection verified.");
  } catch (error: any) {
    if (error instanceof Error) {
      const isOffline = error.message.includes('the client is offline') || 
                        error.message.includes('Could not reach Cloud Firestore') ||
                        error.code === 'unavailable';
      
      if (isOffline) {
        console.warn("Firestore connectivity check: Client appears offline or connection restricted.", error.message);
      } else if (error.message.includes('permission-denied') || error.code === 'permission-denied') {
        console.log("Firestore reachability confirmed (permission check succeeded).");
      } else {
        console.warn("Firestore connection check produced an unexpected result:", error.code || error.message);
      }
    }
  }
}

testConnection();

const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);
export const signOut = () => auth.signOut();

export interface Task {
  id?: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  color: string;
  category?: "urgent" | "important" | "in-progress" | "none";
  tags: string[];
  completed: boolean;
  userId: string;
  reminder?: number; // Minutes before
  googleEventId?: string;
  recurring?: {
    type: "daily" | "weekly" | "monthly" | "none";
    until?: Date;
    count?: number;
    daysOfWeek?: number[]; // 0 for Sunday, 1 for Monday, etc.
  };
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: {
    userId: string;
    email: string;
    emailVerified: boolean;
    isAnonymous: boolean;
    providerInfo: { providerId: string; displayName: string; email: string; }[];
  }
}

export const handleFirestoreError = (error: any, operation: FirestoreErrorInfo['operationType'], path: string | null = null) => {
  if (error.code === 'permission-denied') {
    const errorInfo: FirestoreErrorInfo = {
      error: error.message,
      operationType: operation,
      path,
      authInfo: {
        userId: auth.currentUser?.uid || 'anonymous',
        email: auth.currentUser?.email || '',
        emailVerified: auth.currentUser?.emailVerified || false,
        isAnonymous: auth.currentUser?.isAnonymous || true,
        providerInfo: auth.currentUser?.providerData.map(p => ({
          providerId: p.providerId,
          displayName: p.displayName || '',
          email: p.email || '',
        })) || []
      }
    };
    throw new Error(JSON.stringify(errorInfo));
  }
  throw error;
};

export const subscribeTasks = (userId: string, callback: (tasks: Task[]) => void) => {
  const q = query(collection(db, "users", userId, "tasks"));
  return onSnapshot(q, (snapshot) => {
    const tasks = snapshot.docs.map(doc => {
      const data = doc.data();
      const task = {
        ...data,
        id: doc.id,
        startTime: data.startTime && 'toDate' in data.startTime ? data.startTime.toDate() : new Date(data.startTime),
        endTime: data.endTime && 'toDate' in data.endTime ? data.endTime.toDate() : new Date(data.endTime),
      } as Task;

      if (task.recurring?.until && 'toDate' in (task.recurring.until as any)) {
        task.recurring.until = (task.recurring.until as any).toDate();
      } else if (task.recurring?.until && typeof task.recurring.until === 'string') {
        task.recurring.until = new Date(task.recurring.until);
      }

      return task;
    });
    callback(tasks);
  }, (error) => handleFirestoreError(error, 'list', `/users/${userId}/tasks`));
};

export const addTask = async (userId: string, task: Omit<Task, "id" | "userId">) => {
  try {
    const taskToSave: any = {
      ...task,
      userId,
      startTime: Timestamp.fromDate(task.startTime),
      endTime: Timestamp.fromDate(task.endTime),
    };

    if (task.recurring?.until) {
      taskToSave.recurring = {
        ...task.recurring,
        until: Timestamp.fromDate(task.recurring.until)
      };
    }

    return await addDoc(collection(db, "users", userId, "tasks"), taskToSave);
  } catch (error) {
    return handleFirestoreError(error, 'create', `/users/${userId}/tasks`);
  }
};

export const updateTask = async (userId: string, taskId: string, updates: Partial<Task>) => {
  try {
    const taskRef = doc(db, "users", userId, "tasks", taskId);
    const firestoreUpdates: any = { ...updates };
    if (updates.startTime) firestoreUpdates.startTime = Timestamp.fromDate(updates.startTime);
    if (updates.endTime) firestoreUpdates.endTime = Timestamp.fromDate(updates.endTime);
    
    if (updates.recurring?.until) {
      firestoreUpdates.recurring = {
        ...updates.recurring,
        until: Timestamp.fromDate(updates.recurring.until)
      };
    }
    
    return await updateDoc(taskRef, firestoreUpdates);
  } catch (error) {
    return handleFirestoreError(error, 'update', `/users/${userId}/tasks/${taskId}`);
  }
};

export const deleteTask = async (userId: string, taskId: string) => {
  try {
    return await deleteDoc(doc(db, "users", userId, "tasks", taskId));
  } catch (error) {
    return handleFirestoreError(error, 'delete', `/users/${userId}/tasks/${taskId}`);
  }
};

export const saveUserProfile = async (userId: string, profile: any) => {
  return setDoc(doc(db, "users", userId, "profile", "settings"), profile, { merge: true });
};

export const getUserProfile = async (userId: string) => {
  const snapshot = await getDoc(doc(db, "users", userId, "profile", "settings"));
  return snapshot.exists() ? snapshot.data() : null;
};
