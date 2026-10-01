// Política exclusiva de San Bartolomeo: siete días de gracia y S/ 2 por día desde el octavo.
export const lateFeePerDay = 2;
export const lateFeeGraceDays = 7;
// Los pagos anteriores a la activación no se recalculan retroactivamente.
export const lateFeePolicyStartDate = '2026-10-01';

const calendarDay = (value: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.floor(date.getTime() / 86400000);
};

export function calculateLateFee(vencimiento: string, today = new Date()): number {
  const dueDay = calendarDay(vencimiento);
  if (dueDay === null || Number.isNaN(today.getTime())) return 0;
  // Días calendario locales: evita que el horario de verano altere la cuenta.
  const currentDay = Math.floor(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000);
  return Math.max(0, currentDay - dueDay - lateFeeGraceDays) * lateFeePerDay;
}

export function calculateLateFeeOnPayment(vencimiento: string, fechaPago: string): number {
  const paidDay = calendarDay(fechaPago);
  if (paidDay === null || fechaPago.slice(0, 10) < lateFeePolicyStartDate) return 0;
  const paidDate = new Date(`${fechaPago.slice(0, 10)}T12:00:00`);
  return calculateLateFee(vencimiento, paidDate);
}

interface LateFeeQuota {
  numero: number;
  vencimiento: string;
  estado: 'pendiente' | 'pagado' | 'vencido';
  mora?: number;
  manualMora?: boolean;
  fechaPago?: string;
}

export function getEffectiveLateFee(cuota: LateFeeQuota, today = new Date()): number {
  if (cuota.numero <= 0) return 0; // La inicial no es una cuota mensual.
  if (cuota.estado === 'pagado') {
    if (typeof cuota.mora === 'number') return cuota.mora;
    return cuota.fechaPago ? calculateLateFeeOnPayment(cuota.vencimiento, cuota.fechaPago) : 0;
  }
  if (cuota.manualMora && typeof cuota.mora === 'number') return cuota.mora;
  return calculateLateFee(cuota.vencimiento, today);
}
