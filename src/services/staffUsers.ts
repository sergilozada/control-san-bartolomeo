import { deleteUser, createUserWithEmailAndPassword, getAuth, inMemoryPersistence, setPersistence, signOut } from 'firebase/auth';
import { getApp, initializeApp, getApps } from 'firebase/app';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { AUTH_TENANT_ID, db, projectCollection, projectDoc } from '@/services/firebase';
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

export const usesStaffFunction = import.meta.env.VITE_STAFF_BACKEND === 'functions';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const staffDomain = '@sanbartolomeo.com';

export function staffEmail(value: string): string {
  const entered = value.trim().toLowerCase();
  const email = entered.includes('@') ? entered : entered + staffDomain;
  if (email.length > 254 || !emailPattern.test(email)) {
    throw new Error('Ingresa un correo electrónico válido del trabajador.');
  }
  return email;
}

function secondaryAuth() {
  const app = getApps().find(item => item.name === 'staff-creator')
    || initializeApp(getApp().options, 'staff-creator');
  const tenantAuth = getAuth(app);
  tenantAuth.tenantId = AUTH_TENANT_ID;
  return tenantAuth;
}

function eventBatch(action: string, targetUid: string, actorUid: string, actorEmail: string) {
  const batch = writeBatch(db);
  batch.set(doc(projectCollection('userEvents')), {
    action, targetUid, actorUid, actorEmail, createdAt: serverTimestamp(),
  });
  return batch;
}

export async function createStaffUser(input: {
  name: string; email: string; jobTitle: string; role: UserRole; password: string;
}, actorUid: string, actorEmail: string) {
  const name = input.name.trim();
  const jobTitle = input.jobTitle.trim();
  if (name.length < 2 || name.length > 100) throw new Error('Escribe el nombre del trabajador (2 a 100 caracteres).');
  if (jobTitle.length > 100) throw new Error('El cargo debe tener máximo 100 caracteres.');
  if (input.password.length < 10) throw new Error('La contraseña inicial debe tener al menos 10 caracteres.');
  const email = staffEmail(input.email);
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
    batch.set(projectDoc('users', credential.user.uid), {
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
  batch.update(projectDoc('users', uid), { ...changes, updatedAt: serverTimestamp(), updatedBy: actorUid });
  await batch.commit();
}
