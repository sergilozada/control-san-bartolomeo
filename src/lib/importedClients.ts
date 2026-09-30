export interface ImportReview {
  status: 'pending' | 'ready';
  sourceFile: string;
  sourceHash: string;
  sourceRow: number;
  issues: string[];
  original: Record<string, string | number | null>;
  firstDueDate?: string;
  initialDate?: string;
  contractDate?: string;
  dateMapping?: string;
  installmentAmount?: number;
  reviewedAt?: string;
}

export interface ImportedClientSource { importReview?: ImportReview }
export const needsFinancialReview = (client: ImportedClientSource) => client.importReview?.status === 'pending';

export interface ScheduleInput {
  total: number;
  initial: number;
  count: number;
  amount: number;
  firstDate: string;
  initialDate: string;
  method: 'contado' | 'cuotas';
}

export const isValidDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export function monthEnd(date: string, offset = 0) {
  if (!isValidDate(date)) throw new Error('Completa una fecha válida.');
  const [year, month] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month + offset, 0)).toISOString().slice(0, 10);
}

export const firstDueAfterInitial = (initialDate: string) => monthEnd(initialDate, 1);

export function firstDueFromExcel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  const date = text.match(/^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2})?$/);
  if (date) return isValidDate(date[1]) ? monthEnd(date[1]) : undefined;
  const named = text.match(/^([A-Za-zÁÉÍÓÚáéíóú]+)\s+(\d{4})$/);
  if (!named) return undefined;
  const months: Record<string, number> = {enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,setiembre:9,septiembre:9,octubre:10,noviembre:11,diciembre:12};
  const month = months[named[1].toLocaleLowerCase('es-PE')];
  return month ? monthEnd(`${named[2]}-${String(month).padStart(2,'0')}-01`) : undefined;
}

export function buildReviewedSchedule(input: ScheduleInput) {
  const cents = (amount: number) => Math.round(amount * 100);
  const validDate = isValidDate;
  if (!Number.isFinite(input.total) || input.total <= 0) throw new Error('Completa el precio de venta con un importe mayor que cero.');
  const quotas: {numero: number; vencimiento: string; monto: number; total: number; estado: 'pendiente'}[] = [];
  if (input.method === 'contado') {
    if (!validDate(input.firstDate)) throw new Error('Completa la fecha del pago pactado.');
    return [{numero: 1, vencimiento: input.firstDate, monto: cents(input.total) / 100, total: cents(input.total) / 100, estado: 'pendiente' as const}];
  }
  if (!Number.isFinite(input.initial) || input.initial < 0 || cents(input.initial) >= cents(input.total)) throw new Error('La inicial debe ser cero o mayor y menor que el precio. Si el pago fue al contado, selecciona esa opción.');
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 600) throw new Error('Indica entre 1 y 600 cuotas.');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Completa el monto de cuota.');
  const remainder = cents(input.total) - cents(input.initial) - cents(input.amount) * (input.count - 1);
  if (remainder <= 0) throw new Error('Los importes superan el precio de venta. Revisa inicial, cantidad y monto de cuotas.');
  if (input.initial > 0) {
    if (!validDate(input.initialDate)) throw new Error('Completa la fecha de la inicial.');
    quotas.push({numero: 0, vencimiento: input.initialDate, monto: cents(input.initial) / 100, total: cents(input.initial) / 100, estado: 'pendiente'});
  }
  if (!validDate(input.firstDate)) throw new Error('Completa la fecha del primer vencimiento.');
  const firstDate = monthEnd(input.firstDate);
  if (input.initial > 0 && firstDate < input.initialDate) throw new Error('El primer vencimiento no puede ser anterior a la fecha de la inicial.');
  for (let i = 0; i < input.count; i++) {
    const amount = i === input.count - 1 ? remainder / 100 : cents(input.amount) / 100;
    quotas.push({numero: i + 1, vencimiento: monthEnd(firstDate, i), monto: amount, total: amount, estado: 'pendiente'});
  }
  return quotas;
}
