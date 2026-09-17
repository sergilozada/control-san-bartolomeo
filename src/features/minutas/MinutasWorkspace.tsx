import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { FileDown, FilePlus2, Save, Search, UserRoundPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/FirebaseAuthContext';
import { db } from '@/services/firebase';
import { getClientDisplayName, getClientTitulares } from '@/types/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createMinute, updateMinute } from './minuteStore';
import { blankBuyer, blankMinute, buildSchedule, money, validateMinute, type InitialPayment, type MinuteBuyer, type MinuteDraft, type MinuteRecord } from './types';

const field = 'h-10 rounded-xl border-[#d9ddd9] bg-white';
const today = () => {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
};
const formatDate = (value: string) => value ? value.split('-').reverse().join('/') : '—';

export default function MinutasWorkspace({ initialClientId }: { initialClientId?: string | null }) {
  const { clients, user, firebaseUser, preview } = useAuth();
  const [draft, setDraft] = useState<MinuteDraft>(blankMinute);
  const [records, setRecords] = useState<MinuteRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const prefilledClient = useRef<string | null>(null);
  const selectedClient = clients.find(client => client.id === draft.clientId);
  const schedule = draft.firstDueDate && draft.totalPrice > draft.initialAmount && draft.installments > 0 && draft.installments <= 240
    ? buildSchedule(draft) : [];

  useEffect(() => {
    if (preview || !user) return;
    return onSnapshot(collection(db, 'minutes'), snapshot => {
      setRecords(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as MinuteRecord))
        .sort((a, b) => (b.updatedAt?.toDate().getTime() || 0) - (a.updatedAt?.toDate().getTime() || 0)));
      setLoadError('');
    }, () => setLoadError('No se pudieron cargar las minutas. Revisa la conexión y los permisos.'));
  }, [preview, user]);

  const fillFromClient = (clientId: string) => {
    const client = clients.find(item => item.id === clientId);
    if (!client) return;
    const buyerList = getClientTitulares(client).map(titular => ({
      ...blankBuyer(), name: titular.nombre, document: titular.dni,
    }));
    const firstRegular = client.cuotas?.find(cuota => cuota.numero > 0);
    setDraft({
      ...blankMinute(), clientId,
      buyers: buyerList.length ? buyerList : [blankBuyer()],
      block: client.manzana, lot: client.lote, area: client.metraje,
      totalPrice: client.montoTotal, initialAmount: client.inicial || 0,
      installments: client.numeroCuotas || 12,
      firstDueDate: firstRegular?.vencimiento || '',
    });
    setEditingId(null);
    prefilledClient.current = clientId;
  };

  useEffect(() => {
    const requested = initialClientId || clients[0]?.id;
    if (requested && prefilledClient.current !== requested && clients.some(client => client.id === requested)) fillFromClient(requested);
    // Se aplica solo cuando cambia la solicitud de cliente, no durante la edición del formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClientId, clients.length]);

  const setValue = <K extends keyof MinuteDraft>(key: K, value: MinuteDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const setBuyer = (index: number, key: keyof MinuteBuyer, value: string) => setDraft(current => ({
    ...current, buyers: current.buyers.map((buyer, buyerIndex) => buyerIndex === index ? { ...buyer, [key]: value } : buyer),
  }));
  const setPayment = (index: number, key: keyof InitialPayment, value: string | number) => setDraft(current => ({
    ...current, initialPayments: current.initialPayments.map((payment, paymentIndex) => paymentIndex === index ? { ...payment, [key]: value } : payment),
  }));

  const saveDraft = async (): Promise<string | null> => {
    if (!draft.clientId || !selectedClient) { toast.error('Selecciona un cliente.'); return null; }
    if (preview) {
      const id = editingId || crypto.randomUUID();
      const item: MinuteRecord = {
        id, reference: `SB-MUESTRA-${id.slice(0, 4).toUpperCase()}`, clientId: draft.clientId,
        clientName: getClientDisplayName(selectedClient), status: 'borrador', draft,
        createdBy: 'demo', updatedBy: 'demo',
      };
      setRecords(current => [item, ...current.filter(record => record.id !== id)]);
      setEditingId(id);
      toast.success('Borrador guardado en esta vista de muestra');
      return id;
    }
    if (!firebaseUser || user?.role === 'readonly') { toast.error('No tienes permiso para guardar minutas.'); return null; }
    if (editingId) {
      await updateMinute(firebaseUser, editingId, draft);
      toast.success('Borrador actualizado');
      return editingId;
    }
    const id = await createMinute(firebaseUser, draft, getClientDisplayName(selectedClient));
    setEditingId(id);
    toast.success('Borrador guardado');
    return id;
  };

  const handleSave = async () => {
    setBusy(true);
    try { await saveDraft(); }
    catch (error) { console.error(error); toast.error('No se pudo guardar la minuta.'); }
    finally { setBusy(false); }
  };

  const handleGenerate = async () => {
    const errors = validateMinute(draft);
    if (errors.length) { toast.error(errors[0]); return; }
    setBusy(true);
    try {
      const { createMinuteDocument } = await import('./minuteDocument');
      const blob = await createMinuteDocument(draft);
      if (!preview && firebaseUser && user?.role !== 'readonly' && selectedClient) {
        let id = editingId;
        if (!id) id = await createMinute(firebaseUser, draft, getClientDisplayName(selectedClient));
        await updateMinute(firebaseUser, id, draft, 'minuta_generar');
        setEditingId(id);
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `borrador-minuta-sb-mz-${draft.block}-lote-${draft.lot}.docx`.replace(/[^a-zA-Z0-9._-]/g, '_');
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast.success('Word de trabajo generado para revisión');
    } catch (error) {
      console.error(error);
      toast.error('No se pudo generar el Word.');
    } finally { setBusy(false); }
  };

  const visibleRecords = records.filter(record =>
    `${record.reference} ${record.clientName} ${record.draft.block} ${record.draft.lot}`.toLowerCase().includes(search.toLowerCase()));
  const canEdit = preview || user?.role !== 'readonly';

  return <div className="space-y-5">
    <section className="rounded-3xl bg-[#33204f] px-6 py-7 text-white shadow-lg">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#ffbe72]">Documentos comerciales</p>
      <h1 className="brand-display mt-2 text-3xl">Minutas de San Bartolomeo</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-white/80">Registra compradores, pagos iniciales y cronograma. El Word generado es un borrador para revisión contractual y firma autorizada.</p>
    </section>
    <div className="grid gap-5 xl:grid-cols-[270px_minmax(0,1fr)]">
      <Card className="h-fit border-[#d9ddd9] bg-[#fffefb]">
        <CardHeader className="pb-3"><CardTitle className="text-lg">Expedientes</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-[#697386]" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar minuta" className="pl-9" /></div>
          {canEdit && <Button variant="outline" className="w-full" onClick={() => { prefilledClient.current = null; setEditingId(null); setDraft(blankMinute()); }}><FilePlus2 className="h-4 w-4" /> Nueva minuta</Button>}
          {loadError && <p role="alert" className="text-sm text-rose-700">{loadError}</p>}
          {!loadError && !visibleRecords.length && <p className="text-sm text-[#697386]">Aún no hay borradores guardados.</p>}
          {visibleRecords.map(record => <button key={record.id} type="button" onClick={() => { setDraft(record.draft); setEditingId(record.id); prefilledClient.current = record.clientId; }} className={`w-full rounded-xl border p-3 text-left text-sm transition hover:border-[#54317f] ${editingId === record.id ? 'border-[#54317f] bg-[#f2ebf7]' : 'border-[#d9ddd9] bg-white'}`}>
            <span className="block font-semibold text-[#33204f]">{record.reference}</span>
            <span className="mt-1 block text-[#5f6878]">{record.clientName}</span>
            <span className="mt-1 block text-xs text-[#697386]">Mz. {record.draft.block} · Lote {record.draft.lot} · {record.status}</span>
          </button>)}
        </CardContent>
      </Card>
      <Card className="min-w-0 border-[#d9ddd9] bg-[#fffefb]">
        <CardHeader className="border-b border-[#e9ebe7]"><CardTitle>{editingId ? 'Editar borrador' : 'Nueva minuta'}</CardTitle><p className="text-sm text-[#697386]">Los datos del cliente se cargan como punto de partida. Verifica cada campo antes de generar el Word.</p></CardHeader>
        <CardContent className="space-y-7 pt-6">
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-[#33204f]">1. Cliente y compradores</h2>
            <div className="space-y-2"><Label htmlFor="minute-client">Cliente del control</Label><select id="minute-client" value={draft.clientId} onChange={event => fillFromClient(event.target.value)} className={`w-full border px-3 ${field}`}><option value="">Seleccionar cliente</option>{clients.map(client => <option key={client.id} value={client.id}>{getClientDisplayName(client)} · Mz. {client.manzana} Lote {client.lote}</option>)}</select></div>
            {draft.buyers.map((buyer, index) => <div key={index} className="grid gap-3 rounded-xl border border-[#e4e7e2] bg-[#f8f7f4] p-4 md:grid-cols-2">
              <div className="md:col-span-2 flex items-center justify-between"><h3 className="font-semibold text-[#33204f]">Comprador {index + 1}</h3>{draft.buyers.length > 1 && canEdit && <Button size="sm" variant="ghost" onClick={() => setValue('buyers', draft.buyers.filter((_, i) => i !== index))}>Quitar</Button>}</div>
              <div><Label>Nombre completo</Label><Input value={buyer.name} onChange={event => setBuyer(index, 'name', event.target.value)} disabled={!canEdit} className={field} /></div>
              <div><Label>DNI</Label><Input value={buyer.document} onChange={event => setBuyer(index, 'document', event.target.value)} maxLength={8} disabled={!canEdit} className={field} /></div>
              <div><Label>Ocupación</Label><Input value={buyer.occupation} onChange={event => setBuyer(index, 'occupation', event.target.value)} disabled={!canEdit} className={field} /></div>
              <div><Label>Estado civil</Label><Input value={buyer.maritalStatus} onChange={event => setBuyer(index, 'maritalStatus', event.target.value)} disabled={!canEdit} className={field} /></div>
              <div className="md:col-span-2"><Label>Domicilio</Label><Input value={buyer.address} onChange={event => setBuyer(index, 'address', event.target.value)} disabled={!canEdit} className={field} /></div>
            </div>)}
            {canEdit && draft.buyers.length < 10 && <Button variant="outline" onClick={() => setValue('buyers', [...draft.buyers, blankBuyer()])}><UserRoundPlus className="h-4 w-4" /> Añadir comprador</Button>}
          </section>
          <section className="space-y-4 border-t border-[#e9ebe7] pt-6">
            <h2 className="text-lg font-semibold text-[#33204f]">2. Lote y precio</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div><Label>Tipo de lote</Label><select value={draft.propertyType} onChange={event => setValue('propertyType', event.target.value as MinuteDraft['propertyType'])} disabled={!canEdit} className={`w-full border px-3 ${field}`}><option value="lote">Lote</option><option value="macrolote">Macrolote</option></select></div>
              <div><Label>Manzana</Label><Input value={draft.block} onChange={event => setValue('block', event.target.value)} disabled={!canEdit} className={field} /></div>
              <div><Label>Lote</Label><Input value={draft.lot} onChange={event => setValue('lot', event.target.value)} disabled={!canEdit} className={field} /></div>
              <div><Label>Área m²</Label><Input type="number" min={0} value={draft.area || ''} onChange={event => setValue('area', Number(event.target.value))} disabled={!canEdit} className={field} /></div>
              <div><Label>Precio total S/</Label><Input type="number" min={0} step="0.01" value={draft.totalPrice || ''} onChange={event => setValue('totalPrice', Number(event.target.value))} disabled={!canEdit} className={field} /></div>
              <div><Label>Cuota inicial S/</Label><Input type="number" min={0} step="0.01" value={draft.initialAmount || ''} onChange={event => setValue('initialAmount', Number(event.target.value))} disabled={!canEdit} className={field} /></div>
            </div>
            <p className="rounded-xl bg-[#f2ebf7] px-4 py-3 text-sm font-semibold text-[#54317f]">Saldo a financiar: {money(Math.max(0, draft.totalPrice - draft.initialAmount))}</p>
          </section>
          <section className="space-y-4 border-t border-[#e9ebe7] pt-6">
            <h2 className="text-lg font-semibold text-[#33204f]">3. Pagos de inicial</h2>
            <p className="text-sm text-[#697386]">Registra solo pagos verificados. La suma debe coincidir con la cuota inicial para generar el Word.</p>
            {draft.initialPayments.map((payment, index) => <div key={index} className="grid gap-3 rounded-xl border border-[#e4e7e2] p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <div><Label>Fecha</Label><Input type="date" value={payment.date} onChange={event => setPayment(index, 'date', event.target.value)} disabled={!canEdit} className={field} /></div>
              <div><Label>Medio</Label><select value={payment.method} onChange={event => setPayment(index, 'method', event.target.value)} disabled={!canEdit} className={`w-full border px-3 ${field}`}><option value="">Seleccionar</option>{['Yape', 'Plin', 'Depósito', 'Transferencia', 'Otro'].map(method => <option key={method} value={method}>{method}</option>)}</select></div>
              <div><Label>Monto S/</Label><Input type="number" min={0} step="0.01" value={payment.amount || ''} onChange={event => setPayment(index, 'amount', Number(event.target.value))} disabled={!canEdit} className={field} /></div>
              {canEdit && <Button size="sm" variant="ghost" className="self-end" onClick={() => setValue('initialPayments', draft.initialPayments.filter((_, i) => i !== index))}>Quitar</Button>}
            </div>)}
            {canEdit && <Button variant="outline" onClick={() => setValue('initialPayments', [...draft.initialPayments, { date: today(), method: '', amount: 0 }])}>Añadir pago</Button>}
            <p className="text-sm text-[#697386]">Registrado: {money(draft.initialPayments.reduce((sum, item) => sum + (item.amount || 0), 0))} / {money(draft.initialAmount)}</p>
          </section>
          <section className="space-y-4 border-t border-[#e9ebe7] pt-6">
            <h2 className="text-lg font-semibold text-[#33204f]">4. Financiamiento y revisión</h2>
            <div className="grid gap-3 sm:grid-cols-2"><div><Label>Número total de cuotas</Label><Input type="number" min={1} max={240} value={draft.installments || ''} onChange={event => setValue('installments', Number(event.target.value))} disabled={!canEdit} className={field} /></div><div><Label>Primera fecha de vencimiento</Label><Input type="date" value={draft.firstDueDate} onChange={event => setValue('firstDueDate', event.target.value)} disabled={!canEdit} className={field} /></div></div>
            {schedule.length > 0 && <div className="max-h-64 overflow-y-auto rounded-xl border border-[#d9ddd9]"><table className="w-full text-sm"><thead className="sticky top-0 bg-[#f2ebf7] text-[#33204f]"><tr><th className="p-2 text-left">Cuota</th><th className="p-2 text-left">Vencimiento</th><th className="p-2 text-right">Monto</th></tr></thead><tbody>{schedule.map(item => <tr key={item.number} className="border-t"><td className="p-2">{item.number}</td><td className="p-2">{formatDate(item.dueDate)}</td><td className="p-2 text-right">{money(item.amount)}</td></tr>)}</tbody></table></div>}
            <div><Label>Observaciones para revisión del documento</Label><Textarea value={draft.notes} onChange={event => setValue('notes', event.target.value)} disabled={!canEdit} rows={3} className="mt-2" /></div>
            <div className="flex flex-wrap gap-3 border-t border-[#e9ebe7] pt-5">
              {canEdit && <Button variant="outline" disabled={busy} onClick={() => void handleSave()}><Save className="h-4 w-4" /> Guardar borrador</Button>}
              <Button disabled={busy} onClick={() => void handleGenerate()} className="bg-[#54317f] text-white hover:bg-[#33204f]"><FileDown className="h-4 w-4" /> Generar Word para revisión</Button>
            </div>
          </section>
        </CardContent>
      </Card>
    </div>
  </div>;
}
