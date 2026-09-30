import type { User } from 'firebase/auth';
import { collection, doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, projectCollection, projectDoc } from '@/services/firebase';
import type { MinuteDraft } from './types';

type MinuteAction = 'minuta_crear' | 'minuta_actualizar' | 'minuta_generar';

const fieldNames: Record<string, string> = {
  buyers: 'Compradores', propertyType: 'Tipo de lote', block: 'Manzana', lot: 'Lote',
  area: 'Área', totalPrice: 'Precio', initialAmount: 'Inicial', initialPayments: 'Pagos de inicial',
  installments: 'Número de cuotas', firstDueDate: 'Primer vencimiento', notes: 'Observaciones',
  signaturePlace: 'Lugar de firma', signatureDate: 'Fecha de firma', managerName: 'Representante de Gerencia',
  sellerLegalName: 'Razón social', sellerRuc: 'RUC del vendedor', sellerAddress: 'Domicilio del vendedor',
  sellerRepresentativeDocument: 'Documento del representante', propertyRegistry: 'Partida o título',
  deliveryTerms: 'Entrega', lateFeeTerms: 'Mora', bankName: 'Banco de cobranza',
  bankAccount: 'Cuenta bancaria', bankCci: 'CCI', collectionsPhone: 'Teléfono de cobranza',
};

function changedFields(before: MinuteDraft | undefined, after: MinuteDraft): string[] {
  if (!before) return Object.keys(fieldNames).map(key => fieldNames[key]);
  return Object.keys(fieldNames).filter(key => JSON.stringify(before[key as keyof MinuteDraft]) !== JSON.stringify(after[key as keyof MinuteDraft]))
    .map(key => fieldNames[key]);
}

function changeSummary(before: MinuteDraft | undefined, after: MinuteDraft, fields: string[]): string {
  if (!before) return 'Borrador de minuta creado';
  const simpleFields: (keyof MinuteDraft)[] = ['propertyType', 'block', 'lot', 'area', 'totalPrice', 'initialAmount', 'installments', 'firstDueDate', 'signaturePlace', 'signatureDate', 'managerName', 'sellerLegalName', 'sellerRuc', 'sellerAddress', 'sellerRepresentativeDocument', 'propertyRegistry', 'deliveryTerms', 'lateFeeTerms', 'bankName', 'bankAccount', 'bankCci', 'collectionsPhone'];
  const details = simpleFields.filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map(key => `${fieldNames[key]}: ${String(before[key] ?? '—')} → ${String(after[key] ?? '—')}`);
  const short = (value: unknown) => String(value ?? '—').slice(0, 100);
  if (fields.includes('Compradores')) {
    const keys = ['name', 'documentType', 'document', 'occupation', 'maritalStatus', 'address', 'nationality', 'email', 'phone', 'district', 'province', 'department'] as const;
    for (let index = 0; index < Math.max(before.buyers.length, after.buyers.length); index++) {
      const oldBuyer = before.buyers[index];
      const newBuyer = after.buyers[index];
      if (!oldBuyer || !newBuyer) { details.push(`Comprador ${index + 1}: ${oldBuyer ? 'retirado ' + short(oldBuyer.name) : 'agregado ' + short(newBuyer.name)}`); continue; }
      for (const key of keys) if (oldBuyer[key] !== newBuyer[key]) details.push(`Comprador ${index + 1} ${key}: ${short(oldBuyer[key])} → ${short(newBuyer[key])}`);
    }
  }
  if (fields.includes('Pagos de inicial')) {
    const keys = ['date', 'method', 'bank', 'amount'] as const;
    for (let index = 0; index < Math.max(before.initialPayments.length, after.initialPayments.length); index++) {
      const oldPayment = before.initialPayments[index];
      const newPayment = after.initialPayments[index];
      if (!oldPayment || !newPayment) { details.push(`Pago inicial ${index + 1}: ${oldPayment ? 'retirado' : 'agregado'}`); continue; }
      for (const key of keys) if (oldPayment[key] !== newPayment[key]) details.push(`Pago inicial ${index + 1} ${key}: ${short(oldPayment[key])} → ${short(newPayment[key])}`);
    }
  }
  if (fields.includes('Observaciones')) details.push(`Observaciones: ${short(before.notes)} → ${short(after.notes)}`);
  return details.join(' · ') || 'Borrador guardado sin cambios de datos';
}

function addAudit(batch: ReturnType<typeof writeBatch>, actor: User, minuteId: string, clientId: string, action: MinuteAction, fields: string[], summary: string) {
  const entry = doc(projectCollection('auditLogs'));
  batch.set(entry, {
    actorUid: actor.uid, actorEmail: actor.email || '', clientId, minuteId, action,
    fields: action === 'minuta_generar' ? ['Documento Word'] : fields,
    summary: action === 'minuta_generar' ? 'Borrador Word generado' : summary,
    createdAt: serverTimestamp(),
  });
  return entry.id;
}

export async function createMinute(actor: User, draft: MinuteDraft, clientName: string) {
  const reference = doc(projectCollection('minutes'));
  const batch = writeBatch(db);
  const lastAuditId = addAudit(batch, actor, reference.id, draft.clientId, 'minuta_crear', changedFields(undefined, draft), changeSummary(undefined, draft, []));
  batch.set(reference, {
    reference: `ER-${new Date().toISOString().slice(0, 7).replace('-', '')}-${reference.id.slice(0, 6).toUpperCase()}`,
    clientId: draft.clientId, clientName, draft, status: 'borrador',
    createdBy: actor.uid, updatedBy: actor.uid,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastAuditId,
  });
  await batch.commit();
  return reference.id;
}

export async function updateMinute(actor: User, minuteId: string, draft: MinuteDraft, action: Exclude<MinuteAction, 'minuta_crear'> = 'minuta_actualizar') {
  const batch = writeBatch(db);
  const existing = await getDoc(projectDoc('minutes', minuteId));
  if (!existing.exists()) throw new Error('La minuta ya no existe.');
  const original = existing.data().draft as MinuteDraft;
  const fields = changedFields(original, draft);
  const lastAuditId = addAudit(batch, actor, minuteId, draft.clientId, action, fields, changeSummary(original, draft, fields));
  batch.update(projectDoc('minutes', minuteId), {
    draft, clientId: draft.clientId, clientName: draft.buyers.map(buyer => buyer.name.trim()).filter(Boolean).join(' y '),
    ...(action === 'minuta_generar' ? { status: 'generada' } : {}),
    updatedBy: actor.uid, updatedAt: serverTimestamp(), lastAuditId,
  });
  await batch.commit();
}
