export { initializeApp } from "firebase/app";
export {
  getAuth, signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword, signOut, connectAuthEmulator,
} from "firebase/auth";
export {
  getFirestore, connectFirestoreEmulator, doc, collection, query, where, orderBy, limit, onSnapshot,
  getDoc, getDocs, setDoc, deleteDoc, writeBatch, increment, serverTimestamp,
} from "firebase/firestore";
