import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCE2inSOEE-dWIkNOND_hBGfkYeZbgopDw",
  authDomain: "the-trading-journal-f677a.firebaseapp.com",
  projectId: "the-trading-journal-f677a",
  storageBucket: "the-trading-journal-f677a.firebasestorage.app",
  messagingSenderId: "880225005027",
  appId: "1:880225005027:web:6802791e3e36c7761dc4d6",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
