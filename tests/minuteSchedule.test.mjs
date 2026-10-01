import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { blankMinute, minuteSchedule, validIsoDate, validateMinute } from '../src/features/minutas/types.ts';

const validDraft = () => ({
  ...blankMinute(),
  clientId: 'cliente-prueba',
  buyers: [{ name: 'Cliente Uno', documentType: 'dni', document: '00000001', occupation: 'comerciante', maritalStatus: 'soltero', address: 'Calle 1', nationality: 'peruana' }],
  block: 'A', lot: '10', area: 582.7,
  totalPrice: 10000, initialAmount: 1000,
  initialPayments: [{ date: '2026-07-28', method: 'Transferencia', bank: 'Interbank', operationNumber: '123', amount: 1000 }],
  installments: 2, firstDueDate: '2026-08-31', signatureDate: '2026-10-01',
  scheduleSnapshot: [
    { number: 1, dueDate: '2026-08-31', amount: 4500 },
    { number: 2, dueDate: '2026-09-30', amount: 4500 },
  ],
});

test('la minuta financiada respeta el cronograma guardado y verifica el cierre', () => {
  const draft = validDraft();
  assert.deepEqual(validateMinute(draft), []);
  assert.deepEqual(minuteSchedule(draft), draft.scheduleSnapshot);
  assert.equal(minuteSchedule(draft).reduce((sum, cuota) => sum + cuota.amount, 0), draft.totalPrice - draft.initialAmount);
});

test('no acepta importes históricos incompletos ni cuotas que no suman el saldo', () => {
  const draft = validDraft();
  draft.scheduleSnapshot[1].amount = 4400;
  assert.match(validateMinute(draft).join(' '), /cronograma/);
  draft.scheduleSnapshot[1].amount = 4500;
  draft.initialPayments[0].amount = 900;
  assert.match(validateMinute(draft).join(' '), /pagos iniciales/);
});

test('descarta fechas inexistentes', () => {
  assert.equal(validIsoDate('2026-02-29'), false);
  assert.equal(validIsoDate('2028-02-29'), true);
  assert.equal(validIsoDate('2026-13-01'), false);
});

test('el vendedor y su representante permanecen fijos en la plantilla', () => {
  const template = unzipSync(readFileSync(new URL('../public/minutas/san-bartolomeo-financiada.docx', import.meta.url)));
  const xml = strFromU8(template['word/document.xml']);
  assert.match(xml, /SAN BARTOLOMEO S\.A\.C\./);
  assert.match(xml, /representada por su Gerente General/);
  assert.doesNotMatch(xml, /\{\{(?:SELLER|MANAGER|SIGNATURE_PLACE)/);
  assert.match(xml, /\{\{BUYERS_INTRO\}\}/);
});
