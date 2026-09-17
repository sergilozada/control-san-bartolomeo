import { User } from 'firebase/auth';
import { collection, doc, serverTimestamp, writeBatch, type WriteBatch } from 'firebase/firestore';
import { db } from '@/services/firebase';

export type AuditAction = 'crear' | 'actualizar' | 'eliminar';

function addAudit(batch: WriteBatch, actor: User, clientId: string, action: AuditAction, fields: string[]) {
  const entry = doc(collection(db, 'auditLogs'));
  batch.set(entry, {
    actorUid: actor.uid,
    actorEmail: actor.email || '',
    clientId,
    action,
    fields,
    createdAt: serverTimestamp(),
  });
  return entry.id;
}

export async function createClientWithAudit(actor: User, data: Record<string, unknown>) {
  const client = doc(collection(db, 'clients'));
  const batch = writeBatch(db);
  const lastAuditId = addAudit(batch, actor, client.id, 'crear', Object.keys(data));
  batch.set(client, { ...data, lastAuditId });
  await batch.commit();
  return client.id;
}

export async function updateClientWithAudit(
  actor: User, clientId: string, data: Record<string, unknown>,
) {
  const batch = writeBatch(db);
  const lastAuditId = addAudit(batch, actor, clientId, 'actualizar', Object.keys(data));
  batch.update(doc(db, 'clients', clientId), { ...data, lastAuditId });
  await batch.commit();
}

export async function deleteClientWithAudit(actor: User, clientId: string) {
  const batch = writeBatch(db);
  addAudit(batch, actor, clientId, 'eliminar', []);
  batch.delete(doc(db, 'clients', clientId));
  await batch.commit();
}
