import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buildReviewedSchedule, isValidDate, monthEnd, type ImportedClientSource } from '@/lib/importedClients';
import { toast } from 'sonner';

interface ReviewClient extends ImportedClientSource {
  id: string; montoTotal: number; inicial?: number; numeroCuotas?: number; formaPago: 'contado' | 'cuotas';
}

export default function ImportedClientReview({client, canEdit, onSave}: {
  client: ReviewClient;
  canEdit: boolean;
  onSave: (data: Partial<ReviewClient> & {cuotas: ReturnType<typeof buildReviewedSchedule>}) => Promise<void>;
}) {
  const review = client.importReview!;
  const [total, setTotal] = useState(client.montoTotal > 0 ? String(client.montoTotal) : '');
  const [initial, setInitial] = useState(client.inicial === undefined ? '' : String(client.inicial));
  const [count, setCount] = useState(client.numeroCuotas ? String(client.numeroCuotas) : '');
  const [amount, setAmount] = useState(review.installmentAmount && review.installmentAmount > 0 ? String(review.installmentAmount) : '');
  const [firstDate, setFirstDate] = useState(review.firstDueDate || '');
  const [initialDate, setInitialDate] = useState(review.initialDate || review.contractDate || '');
  const [method, setMethod] = useState(client.formaPago);
  const [saving, setSaving] = useState(false);
  const dueDate = method === 'cuotas' && isValidDate(firstDate) ? monthEnd(firstDate) : firstDate;
  let cuotas: ReturnType<typeof buildReviewedSchedule> = [];
  let error = '';
  try {
    if (method === 'cuotas' && initial.trim() === '') throw new Error('Falta la inicial. Si no hubo adelanto, escribe 0.');
    cuotas = buildReviewedSchedule({total:Number(total), initial:Number(initial), count:Number(count), amount:Number(amount), firstDate:dueDate, initialDate, method});
  } catch (e) { error = e instanceof Error ? e.message : 'Revisa los datos.'; }
  const save = async () => {
    if (!canEdit || saving || error) return;
    setSaving(true);
    try {
      await onSave({montoTotal:Number(total), inicial:method === 'cuotas' ? Number(initial) : 0,
        numeroCuotas:method === 'cuotas' ? Number(count) : 1, formaPago:method, cuotas,
        importReview:{...review, status:'ready', firstDueDate:dueDate, initialDate, dateMapping:'excel-firma-inicio-cuota-v1', reviewedAt:new Date().toISOString()}});
      toast.success('Cronograma guardado. Ya puedes registrar los pagos y sus comprobantes.');
    } catch { toast.error('No se guardó el cronograma. Inténtalo de nuevo.'); }
    finally { setSaving(false); }
  };
  return <section className="space-y-5 rounded-xl border border-amber-200 bg-amber-50/40 p-4 sm:p-6">
    <div><h3 className="font-semibold text-[#312144]">Completar datos y revisar pagos</h3>
      <p className="mt-1 text-sm text-slate-600">Registro importado de la fila {review.sourceRow}. Confirma los importes y las fechas del contrato antes de habilitar el cronograma. Después podrás registrar manualmente cada pago, boleta y voucher.</p>
    </div>
    <details className="rounded-lg border bg-white p-3 text-sm"><summary className="cursor-pointer font-medium">Ver datos y observaciones del Excel</summary>
      <ul className="my-3 list-disc space-y-1 pl-5">{review.issues.map((issue,index) => <li key={index}>{issue}</li>)}</ul>
      <dl className="grid gap-2 sm:grid-cols-2">{Object.entries(review.original).map(([key,value]) => <div key={key} className="break-words"><dt className="font-semibold">{key}</dt><dd>{value === null || value === '' ? 'Sin informar' : String(value)}</dd></div>)}</dl>
    </details>
    {canEdit ? <>
      <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div><Label htmlFor="review-method">Forma de pago</Label><select id="review-method" className="mt-1 h-10 w-full rounded-md border bg-white px-3" value={method} onChange={e=>setMethod(e.target.value as 'contado' | 'cuotas')}><option value="cuotas">Cuotas</option><option value="contado">Contado</option></select></div>
        <div><Label htmlFor="review-total">Precio de venta (S/) *</Label><Input id="review-total" type="number" min="0.01" step="0.01" value={total} onChange={e=>setTotal(e.target.value)} /></div>
        {method === 'cuotas' && <>
          <div><Label htmlFor="review-initial">Inicial del contrato (S/) *</Label><Input id="review-initial" type="number" min="0" step="0.01" value={initial} onChange={e=>setInitial(e.target.value)} placeholder="Completar; 0 si no hubo inicial" /></div>
          <div><Label htmlFor="review-count">Cantidad de cuotas *</Label><Input id="review-count" type="number" min="1" max="600" step="1" value={count} onChange={e=>setCount(e.target.value)} /></div>
          <div><Label htmlFor="review-amount">Cuota regular (S/) *</Label><Input id="review-amount" type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} /></div>
          {Number(initial)>0 && <div><Label htmlFor="review-initial-date">Fecha de la inicial *</Label><Input id="review-initial-date" type="date" value={initialDate} onChange={e=>setInitialDate(e.target.value)} /><p className="mt-1 text-xs text-slate-600">Corresponde a «Firma del contrato» del Excel.</p></div>}
        </>}
        <div><Label htmlFor="review-first-date">{method==='cuotas' ? 'Primer vencimiento *' : 'Fecha del pago pactado *'}</Label><Input id="review-first-date" type="date" value={dueDate} onChange={e=>setFirstDate(e.target.value)} />{method==='cuotas' && <p className="mt-1 text-xs text-slate-600">Corresponde a «Inicio de cuota» del Excel. El vencimiento se fija al último día de ese mes; si falta en el Excel, complétalo aquí.</p>}</div>
      </fieldset>
      {error ? <p className="text-sm text-amber-900">{error}</p> : <div className="rounded-lg border bg-white p-3 text-sm">
        <p>{method==='cuotas' ? `${count} cuotas mensuales. Última cuota: S/ ${cuotas.at(-1)!.monto.toFixed(2)} el ${cuotas.at(-1)!.vencimiento}. La última cuota ajusta el importe para completar el precio.` : `Un pago de S/ ${Number(total).toFixed(2)} el ${firstDate}.`}</p>
        <p className="mt-2">Al guardar, los pagos quedarán pendientes hasta que los registres manualmente. Los vencimientos anteriores a hoy aparecerán en atrasados mientras no se registre su pago.</p>
      </div>}
      <Button onClick={()=>void save()} disabled={saving || Boolean(error)}>{saving ? 'Guardando…' : 'Guardar cronograma y habilitar pagos'}</Button>
    </> : <p className="text-sm">Un administrador debe completar el cronograma para habilitar el registro de pagos.</p>}
  </section>;
}
