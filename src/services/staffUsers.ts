import { deleteUser, createUserWithEmailAndPassword, getAuth, inMemoryPersistence, setPersistence, signOut } from 'firebase/auth';
import { getApp, initializeApp, getApps } from 'firebase/app';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '@/services/firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import type { UserRole } from '@/config/permissions';

export interface StaffProfile {
  id: string;
  name: string;
  email: string;
  jobTitle?: string;
  role: UserRole;
  active: boolean;
  deleted?: boolean;
  createdAt?: { toDate: () => Date };
}

const STAFF_DOMAIN = '@sanbartolomeo.com';
export const usesStaffFunction = import.meta.env.VITE_STAFF_BACKEND === 'functions';
const slugPattern = /^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/;

export function staffEmail(localPart: string): string {
  const slug = localPart.trim().toLowerCase();
  if (!slugPattern.test(slug) || slug.includes('..')) {
    throw new Error('El usuario debe usar letras, números, puntos, guiones o guion bajo.');
  }
  return `${slug}${STAFF_DOMAIN}`;
}

function secondaryAuth() {
  const app = getApps().find(item => item.name === 'staff-creator')
    || initializeApp(getApp().options, 'staff-creator');
  return getAuth(app);
}

function eventBatch(action: string, targetUid: string, actorUid: string, actorEmail: string) {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'userEvents')), {
    action, targetUid, actorUid, actorEmail, createdAt: serverTimestamp(),
  });
  return batch;
}

export async function createStaffUser(input: {
  name: string; localPart: string; jobTitle: string; role: UserRole; password: string;
}, actorUid: string, actorEmail: string) {
  const name = input.name.trim();
  const jobTitle = input.jobTitle.trim();
  if (name.length < 2 || name.length > 100) throw new Error('Escribe el nombre del trabajador (2 a 100 caracteres).');
  if (jobTitle.length > 100) throw new Error('El cargo debe tener máximo 100 caracteres.');
  if (input.password.length < 10) throw new Error('La contraseña inicial debe tener al menos 10 caracteres.');
  const email = staffEmail(input.localPart);
  if (usesStaffFunction) {
    const call = httpsCallable(getFunctions(getApp(), 'southamerica-west1'), 'manageStaffUser');
    await call({ action: 'crear', name, email, jobTitle, role: input.role, password: input.password });
    return;
  }
  const staffAuth = secondaryAuth();
  await setPersistence(staffAuth, inMemoryPersistence);
  const credential = await createUserWithEmailAndPassword(staffAuth, email, input.password);
  try {
    const batch = eventBatch('crear', credential.user.uid, actorUid, actorEmail);
    batch.set(doc(db, 'users', credential.user.uid), {
      name, email, jobTitle, role: input.role, active: true, deleted: false,
      createdAt: serverTimestamp(), createdBy: actorUid,
    });
    await batch.commit();
  } catch (error) {
    await deleteUser(credential.user).catch(() => undefined);
    throw error;
  } finally {
    await signOut(staffAuth).catch(() => undefined);
  }
}

export async function updateStaffUser(
  uid: string, changes: { name?: string; jobTitle?: string; role?: UserRole; active?: boolean; deleted?: boolean },
  action: string, actorUid: string, actorEmail: string,
) {
  if (uid === actorUid) throw new Error('Tu propia cuenta de administrador no se puede modificar aquí.');
  if (usesStaffFunction) {
    const call = httpsCallable(getFunctions(getApp(), 'southamerica-west1'), 'manageStaffUser');
    await call({ action, uid, ...changes });
    return;
  }
  const batch = eventBatch(action, uid, actorUid, actorEmail);
  batch.update(doc(db, 'users', uid), { ...changes, updatedAt: serverTimestamp(), updatedBy: actorUid });
  await batch.commit();
}
