const asNonNegative = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

// Sin condiciones contractuales confirmadas, la mora automática queda en cero.
export const lateFeePerDay = asNonNegative(import.meta.env.VITE_LATE_FEE_PER_DAY);
export const lateFeeGraceDays = asNonNegative(import.meta.env.VITE_LATE_FEE_GRACE_DAYS);

export function calculateLateFee(vencimiento: string, today = new Date()): number {
  if (lateFeePerDay === 0) return 0;
  const [year, month, day] = vencimiento.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return 0;
  const due = new Date(year, month - 1, day);
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const elapsed = Math.floor((current.getTime() - due.getTime()) / 86400000);
  return Math.max(0, elapsed - lateFeeGraceDays) * lateFeePerDay;
}
