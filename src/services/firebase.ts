import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { collection, doc, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// "Sistema Central" es el nombre visible; el ID tecnico permanece igual.
export const CENTRAL_FIREBASE_PROJECT_ID = 'villa-hermosa-lotes';
export const APP_PROJECT_KEY = 'san-bartolomeo';
export const AUTH_TENANT_ID = 'San-Bartolomeo-yp3kp';
export const projectStorageRoot = `projects/${APP_PROJECT_KEY}`;

// La configuracion web de Firebase es publica. Se comparte el backend, no los datos.
const app = initializeApp({
  apiKey: 'AIzaSyBlfKwKBkHBqxcT11Bkjqdt5dmEJL54LCY',
  authDomain: 'villa-hermosa-lotes.firebaseapp.com',
  projectId: CENTRAL_FIREBASE_PROJECT_ID,
  storageBucket: 'villa-hermosa-lotes.firebasestorage.app',
  messagingSenderId: '198410031009',
  appId: '1:198410031009:web:882500ac28ae119a3f45e0',
});

export const isFirebaseConfigured = true;
export const auth = getAuth(app);
auth.tenantId = AUTH_TENANT_ID;
export const db = getFirestore(app);
export const storage = getStorage(app);
export const isStorageEnabled = isFirebaseConfigured;

export const projectCollection = (name: string) => collection(db, projectStorageRoot, name);
export const projectDoc = (name: string, id: string) => doc(db, projectStorageRoot, name, id);

export default app;

