import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateLateFee,
  calculateLateFeeOnPayment,
  getEffectiveLateFee,
} from '../src/config/paymentPolicy.ts';

const localDate = (year, month, day) => new Date(year, month - 1, day, 12);
const pending = { numero: 1, vencimiento: '2026-08-31', estado: 'pendiente' };

test('siete días completos de gracia y S/ 2 desde el octavo', () => {
  assert.equal(calculateLateFee('2026-08-31', localDate(2026, 9, 7)), 0);
  assert.equal(calculateLateFee('2026-08-31', localDate(2026, 9, 8)), 2);
  assert.equal(calculateLateFee('2026-08-31', localDate(2026, 9, 9)), 4);
  assert.equal(calculateLateFee('2026-08-31', localDate(2026, 8, 30)), 0);
});

test('cuenta días de calendario al cruzar meses y no acepta fechas inválidas', () => {
  assert.equal(calculateLateFee('2026-02-28', localDate(2026, 3, 8)), 2);
  assert.equal(calculateLateFee('2026-02-30', localDate(2026, 3, 8)), 0);
});

test('las cuotas pendientes acumulan; la inicial y los pagos históricos no cambian', () => {
  assert.equal(getEffectiveLateFee(pending, localDate(2026, 10, 1)), 48);
  assert.equal(getEffectiveLateFee({ ...pending, numero: 0 }, localDate(2026, 10, 1)), 0);
  assert.equal(getEffectiveLateFee({ ...pending, estado: 'pagado', fechaPago: '2026-09-20' }, localDate(2026, 10, 1)), 0);
  assert.equal(getEffectiveLateFee({ ...pending, estado: 'pagado', mora: 0, fechaPago: '2026-10-01' }, localDate(2026, 10, 15)), 0);
});

test('al pagar la mora se congela en la fecha real y respeta ajustes manuales', () => {
  assert.equal(calculateLateFeeOnPayment('2026-08-31', '2026-10-01'), 48);
  assert.equal(getEffectiveLateFee({ ...pending, estado: 'pagado', fechaPago: '2026-10-01' }, localDate(2026, 10, 15)), 48);
  assert.equal(getEffectiveLateFee({ ...pending, manualMora: true, mora: 5 }, localDate(2026, 10, 15)), 5);
  assert.equal(getEffectiveLateFee({ ...pending, estado: 'pagado', manualMora: true, mora: 5, fechaPago: '2026-10-01' }, localDate(2026, 10, 15)), 5);
});
