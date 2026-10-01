import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { FileDown, FilePlus2, History, Home, LockKeyhole, LogOut, Save, Search, UserRoundPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/FirebaseAuthContext';
import { projectCollection } from '@/services/firebase';
import { canManageMinutes } from '@/config/permissions';
import { getClientDisplayName, getClientTitulares } from '@/types/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createMinute, updateMinute } from './minuteStore';
import { unlockMinutes } from './minuteAccess';
import { blankBuyer, blankMinute, documentHint, documentLabel, minuteSchedule, money, normalizeBuyerDocument, validateMinute, type InitialPayment, type MinuteBuyer, type MinuteDraft, type MinuteRecord } from './types';

interface MinuteEvent { id: string; minuteId: string; actorEmail: string; action: string; fields: string[]; summary?: string; createdAt?: Timestamp }

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
  const [unlocked, setUnlocked] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<'home' | 'records'>(initialClientId ? 'records' : 'home');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [minuteEvents, setMinuteEvents] = useState<MinuteEvent[]>([]);
  const prefilledClient = useRef<string | null>(null);
  const selectedClient = clients.find(client => client.id === draft.clientId);
  const schedule = draft.firstDueDate && draft.totalPrice > draft.initialAmount && draft.installments > 0 && draft.installments <= 240
    ? minuteSchedule(draft) : [];

  useEffect(() => {
    if (preview || !user || !unlocked || !canManageMinutes(user.role)) return;
    return onSnapshot(projectCollection('minutes'), snapshot => {
      setRecords(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as MinuteRecord))
        .sort((a, b) => (b.updatedAt?.toDate().getTime() || 0) - (a.updatedAt?.toDate().getTime() || 0)));
      setLoadError('');
    }, () => setLoadError('No se pudieron cargar las minutas. Revisa la conexión y los permisos.'));
  }, [preview, user, unlocked]);

  useEffect(() => {
    if (preview || !unlocked || !canManageMinutes(user?.role)) return;
    return onSnapshot(query(projectCollection('auditLogs'), where('action', 'in', ['minuta_crear', 'minuta_actualizar', 'minuta_generar'])), snapshot => {
      setMinuteEvents(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as MinuteEvent))
        .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)));
    }, () => setLoadError('No se pudo cargar el historial de Minutas.'));
  }, [preview, unlocked, user?.role]);

  const fillFromClient = (clientId: string) => {
    const client = clients.find(item => item.id === clientId);
    if (!client) { setDraft(blankMinute()); setEditingId(null); return; }
    const buyerList = getClientTitulares(client).map(titular => ({
      ...blankBuyer(), name: titular.nombre, document: titular.dni,
    }));
    const clientQuotas = client.cuotas?.filter(cuota => cuota.numero > 0).sort((a, b) => a.numero - b.numero) || [];
    setDraft({
      ...blankMinute(), clientId,
      buyers: buyerList.length ? buyerList : [blankBuyer()],
      block: client.manzana, lot: client.lote, area: client.metraje,
      totalPrice: client.montoTotal, initialAmount: client.inicial || 0,
      installments: client.numeroCuotas || clientQuotas.length || 30,
      firstDueDate: clientQuotas[0]?.vencimiento || '',
      scheduleSnapshot: clientQuotas.length ? clientQuotas.map(cuota => ({ number: cuota.numero, dueDate: cuota.vencimiento, amount: cuota.monto })) : undefined,
    });
    setEditingId(null);
    prefilledClient.current = clientId;
  };

  useEffect(() => {
    const requested = initialClientId;
    if (requested && prefilledClient.current !== requested && clients.some(client => client.id === requested)) fillFromClient(requested);
    // Se aplica solo cuando cambia la solicitud de cliente, no durante la edición del formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClientId, clients.length]);

  const setValue = <K extends keyof MinuteDraft>(key: K, value: MinuteDraft[K]) => setDraft(current => ({
    ...current, [key]: value,
    ...(['totalPrice', 'initialAmount', 'installments', 'firstDueDate'].includes(key) ? { scheduleSnapshot: undefined } : {}),
  }));
  const setBuyer = (index: number, key: keyof MinuteBuyer, value: string) => setDraft(current => ({
    ...current, buyers: current.buyers.map((buyer, buyerIndex) => buyerIndex === index ? { ...buyer, [key]: value } : buyer),
  }));
  const setPayment = (index: number, key: keyof InitialPayment, value: string | number) => setDraft(current => ({
    ...current, initialPayments: current.initialPayments.map((payment, paymentIndex) => paymentIndex === index ? { ...payment, [key]: value } : payment),
  }));

  const saveDraft = async (): Promise<string | null> => {
    const buyerName = draft.buyers.map(buyer => buyer.name.trim()).filter(Boolean).join(' y ') || 'Comprador pendiente';
    if (preview) {
      const id = editingId || crypto.randomUUID();
      const item: MinuteRecord = {
        id, reference: `SB-MUESTRA-${id.slice(0, 4).toUpperCase()}`, clientId: draft.clientId,
        clientName: buyerName, status: 'borrador', draft,
        createdBy: 'demo', updatedBy: 'demo',
      };
      setRecords(current => [item, ...current.filter(record => record.id !== id)]);
      setEditingId(id);
      toast.success('Borrador guardado en esta vista de muestra');
      return id;
    }
    if (!firebaseUser || !canManageMinutes(user?.role) || !unlocked) { toast.error('No tienes permiso para guardar minutas.'); return null; }
    if (editingId) {
      await updateMinute(firebaseUser, editingId, draft);
      toast.success('Borrador actualizado');
      return editingId;
    }
    const id = await createMinute(firebaseUser, draft, buyerName);
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
    if (!selectedClient || selectedClient.formaPago !== 'cuotas') {
      toast.error('Este modelo es solo para un cliente registrado con pago financiado. El modelo al contado llegará después.');
      return;
    }
    const errors = validateMinute(draft);
    if (errors.length) { toast.error(errors[0]); return; }
    setBusy(true);
    try {
      const { createFinancedMinuteDocument } = await import('./financedMinuteTemplate');
      const blob = await createFinancedMinuteDocument(draft);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `minuta-financiada-san-bartolomeo-mz-${draft.block}-lote-${draft.lot}.docx`.replace(/[^a-zA-Z0-9._-]/g, '_');
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);

      if (!preview && firebaseUser && canManageMinutes(user?.role) && unlocked) {
        try {
          let id = editingId;
          if (!id) id = await createMinute(firebaseUser, draft, draft.buyers.map(buyer => buyer.name.trim()).join(' y '));
          await updateMinute(firebaseUser, id, draft, 'minuta_generar');
          setEditingId(id);
        } catch (error) {
          console.error('El Word se descargó, pero no se pudo guardar la minuta en Firebase:', error);
          const code = (error as { code?: string })?.code;
          toast.error(code === 'permission-denied'
            ? 'El Word se descargó, pero Firebase rechazó guardar la minuta. Revisa los permisos y las reglas de Firestore.'
            : 'El Word se descargó, pero no se pudo guardar la minuta. Revisa tu conexión y vuelve a intentarlo.');
          return;
        }
      }
      toast.success('Word de trabajo generado para revisión');
    } catch (error) {
      console.error('No se pudo crear o descargar el Word de la minuta:', error);
      toast.error(error instanceof Error ? error.message : 'No se pudo generar el Word.');
    } finally { setBusy(false); }
  };

  const visibleRecords = records.filter(record =>
    `${record.reference} ${record.clientName} ${record.draft.block} ${record.draft.lot}`.toLowerCase().includes(search.toLowerCase()));
  const canEdit = preview || canManageMinutes(user?.role);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (preview) { setUnlocked(true); setWorkspaceView(initialClientId ? 'records' : 'home'); return; }
    if (!firebaseUser?.email || !canManageMinutes(user?.role) || !password) return;
    setLoginBusy(true);
    setLoginError('');
    try {
      await unlockMinutes(firebaseUser, password);
      setPassword('');
      setUnlocked(true);
      setWorkspaceView(initialClientId ? 'records' : 'home');
    } catch (error) {
      console.error('No se pudo abrir Minutas:', error);
      setLoginError('No se pudo verificar la contraseña de tu cuenta de San Bartolomeo.');
    } finally { setLoginBusy(false); }
  };

  if (!canManageMinutes(user?.role)) return <div className="rounded-2xl border bg-white p-8 text-center">El acceso a Minutas corresponde al administrador y al área legal.</div>;
  if (!unlocked) return <div
    className="vh-login-shell-enter grid min-h-[calc(100dvh-8.5rem)] w-full overflow-hidden rounded-[2rem] border border-[#d9ddd9] bg-[#fffefb] shadow-2xl shadow-[#312144]/15 xl:grid-cols-[minmax(0,1.25fr)_minmax(410px,0.75fr)]"
    aria-labelledby="minute-login-title"
  >
    <section
      className="relative isolate hidden min-h-[calc(100dvh-8.5rem)] flex-col justify-between overflow-hidden bg-[#312144] p-10 text-white xl:flex 2xl:p-14"
      aria-label="Minutas de San Bartolomeo Inmobiliaria"
    >
      <div className="absolute inset-0 -z-20 bg-[#4a3068]" aria-hidden="true" />
      <div className="absolute -right-32 top-32 -z-10 h-[34rem] w-[34rem] rounded-full border border-white/10" aria-hidden="true" />
      <div className="absolute -right-16 top-48 -z-10 h-[25rem] w-[25rem] rounded-full border border-white/10" aria-hidden="true" />

      <div className="w-fit max-w-[380px] overflow-hidden rounded-2xl bg-white p-3 shadow-2xl shadow-black/20">
        <img src="/brand/san-bartolomeo-logo.jpeg" alt="San Bartolomeo Inmobiliaria" className="h-28 w-[356px] object-contain object-center" />
      </div>

      <div className="max-w-2xl py-10">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#27b8b2]">Gestión legal inmobiliaria</p>
        <h1 className="brand-display mt-5 max-w-xl text-5xl font-medium leading-[1.05] tracking-tight 2xl:text-6xl">Documentos listos para revisión.</h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-white/80 2xl:text-lg">
          Centraliza compradores, pagos iniciales y cronogramas para preparar cada borrador de minuta con mayor claridad.
        </p>
      </div>

      <div className="grid max-w-3xl grid-cols-3 gap-3" aria-label="Funciones principales">
        {[
          ['01', 'Datos conectados'],
          ['02', 'Validación guiada'],
          ['03', 'Historial seguro'],
        ].map(([number, label]) => <div key={number} className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm">
          <span className="block text-xs font-bold tracking-[0.16em] text-[#27b8b2]">{number}</span>
          <span className="mt-2 block text-sm font-semibold text-white/90">{label}</span>
        </div>)}
      </div>
    </section>

    <main className="grid min-h-[calc(100dvh-8.5rem)] place-items-center bg-[#fffefb] px-6 py-10 sm:px-10 xl:px-12 2xl:px-16">
      <div className="vh-login-form-enter w-full max-w-[430px]">
        <div className="mb-10 overflow-hidden rounded-2xl border border-[#d9ddd9] bg-white p-3 shadow-sm xl:hidden">
          <img src="/brand/san-bartolomeo-logo.jpeg" alt="San Bartolomeo Inmobiliaria" className="h-28 w-full object-contain object-center sm:h-32" />
        </div>

        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e7f8f6] text-[#0d6268]">
          <LockKeyhole className="h-6 w-6" aria-hidden="true" />
        </div>
        <p className="mt-7 text-xs font-bold uppercase tracking-[0.2em] text-[#0d6268]">Acceso interno</p>
        <h2 id="minute-login-title" className="brand-display mt-3 text-4xl font-medium leading-tight text-[#312144]">Ingresar a Minutas</h2>
        <p className="mt-3 text-base leading-6 text-[#697386]">Ingresa la misma contraseña que usas para iniciar sesión en San Bartolomeo.</p>

        <form onSubmit={event => void handleLogin(event)} className="mt-9 space-y-5">
          {!preview && <>
            <div className="space-y-2">
              <Label htmlFor="minute-email" className="text-sm font-semibold text-[#312144]">Cuenta con acceso</Label>
              <Input id="minute-email" type="email" value={firebaseUser?.email || ''} readOnly autoComplete="username" className="min-h-12 rounded-xl border-[#d9ddd2] bg-[#f7f6f0] px-4 text-base text-[#56604f]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="minute-password" className="text-sm font-semibold text-[#312144]">Contraseña de tu cuenta</Label>
              <Input id="minute-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="off" placeholder="Ingresa tu contraseña de San Bartolomeo" className="min-h-12 rounded-xl border-[#cfd5c7] bg-white px-4 text-base focus-visible:ring-[#6b7f35]" required />
            </div>
          </>}
          {loginError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{loginError}</p>}
          <Button type="submit" disabled={loginBusy || (!preview && !password)} className="min-h-12 w-full rounded-xl bg-[#54317f] text-base font-semibold text-white shadow-lg shadow-[#54317f]/15 hover:bg-[#312144] disabled:shadow-none">
            {preview ? 'Entrar a la muestra de Minutas' : loginBusy ? 'Verificando…' : 'Ingresar a Minutas'}
          </Button>
        </form>

        <div className="mt-8 flex items-start gap-3 rounded-2xl border border-[#d9ddd9] bg-[#f4f7ef] p-4 text-sm leading-5 text-[#56604f]">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-[#6b7f35]" aria-hidden="true" />
          <p>Acceso protegido para administración y el área legal de San Bartolomeo Inmobiliaria.</p>
        </div>
      </div>
    </main>
  </div>;

  const navigation = <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#d9ddd9] bg-white px-4 py-3 shadow-sm">
    <div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#54317f]">Panel de gestión</p><h1 className="brand-display text-2xl text-[#312144]">{workspaceView === 'home' ? 'Inicio' : 'Minutas'}</h1></div>
    <nav aria-label="Navegación de Minutas" className="flex flex-wrap gap-1 rounded-xl border border-[#d9ddd9] bg-[#fcfaf5] p-1">
      <Button size="sm" variant="ghost" onClick={() => setWorkspaceView('home')} className={workspaceView === 'home' ? 'bg-[#eef1e6] text-[#3c5a20]' : ''}><Home className="h-4 w-4" /> Inicio</Button>
      <Button size="sm" variant="ghost" onClick={() => setWorkspaceView('records')} className={workspaceView === 'records' ? 'bg-[#eef1e6] text-[#3c5a20]' : ''}><Search className="h-4 w-4" /> Minutas</Button>
      <Button size="sm" variant="ghost" onClick={() => { prefilledClient.current = null; setEditingId(null); setDraft(blankMinute()); setWorkspaceView('records'); }}><FilePlus2 className="h-4 w-4" /> Nueva minuta</Button>
      <Button size="sm" variant="ghost" onClick={() => { setUnlocked(false); setPassword(''); setRecords([]); }}><LogOut className="h-4 w-4" /> Cerrar sesión</Button>
    </nav>
  </div>;

  if (workspaceView === 'home') return <div className="space-y-5">{navigation}
    <section className="relative overflow-hidden rounded-3xl bg-[#4a3068] p-8 text-white shadow-lg sm:p-12">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#27b8b2]">San Bartolomeo Inmobiliaria</p>
      <h2 className="brand-display mt-4 max-w-xl text-4xl">Crea una minuta desde cero.</h2>
      <p className="mt-3 max-w-xl text-sm leading-6 text-white/80">Registra compradores, verifica importes y genera un Word de trabajo para revisión legal.</p>
      <Button className="mt-6 bg-[#27b8b2] text-[#123c48] hover:bg-[#8cddd6]" onClick={() => { setEditingId(null); setDraft(blankMinute()); setWorkspaceView('records'); }}><FilePlus2 className="h-4 w-4" /> Crear nueva minuta</Button>
    </section>
    <div className="grid gap-4 sm:grid-cols-2"><Card><CardHeader><CardTitle>{records.length} minutas guardadas</CardTitle></CardHeader><CardContent><Button variant="outline" onClick={() => setWorkspaceView('records')}>Ver expedientes</Button></CardContent></Card><Card><CardHeader><CardTitle>Documento para revisión</CardTitle></CardHeader><CardContent className="text-sm text-[#697386]">Cada Word requiere comprobación de datos y una plantilla contractual aprobada.</CardContent></Card></div>
  </div>;

  return <div className="space-y-5">
    {navigation}
    <section className="rounded-3xl bg-[#54317f] px-6 py-7 text-white shadow-lg">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c49a22]">Documentos comerciales</p>
      <h1 className="brand-display mt-2 text-3xl">Minutas de San Bartolomeo Inmobiliaria</h1>
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
          {visibleRecords.map(record => <button key={record.id} type="button" onClick={() => { setDraft(record.draft); setEditingId(record.id); prefilledClient.current = record.clientId; }} className={`w-full rounded-xl border p-3 text-left text-sm transition hover:border-[#54317f] ${editingId === record.id ? 'border-[#54317f] bg-[#f3eaf9]' : 'border-[#d9ddd9] bg-white'}`}>
            <span className="block font-semibold text-[#312144]">{record.reference}</span>
            <span className="mt-1 block text-[#697386]">{record.clientName}</span>
            <span className="mt-1 block text-xs text-[#697386]">Mz. {record.draft.block} · Lote {record.draft.lot} · {record.status}</span>
          </button>)}
        </CardContent>
      </Card>
      <Card className="min-w-0 border-[#d9ddd9] bg-[#fffefb]">
        <CardHeader className="border-b border-[#e9ebe7]"><CardTitle>{editingId ? 'Editar borrador' : 'Nueva minuta'}</CardTitle><p className="text-sm text-[#697386]">Completa solo los datos del cliente y de su operación. Los datos de San Bartolomeo y su representante permanecen fijos en el modelo original.</p></CardHeader>
        <CardContent className="space-y-7 pt-6">
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-[#312144]">1. Cliente y compradores</h2>
            <div className="space-y-2"><Label htmlFor="minute-client">Cliente financiado</Label><select id="minute-client" value={draft.clientId} onChange={event => fillFromClient(event.target.value)} disabled={!canEdit} className={`w-full border px-3 ${field}`}><option value="">Selecciona un cliente registrado</option>{clients.filter(client => client.formaPago === 'cuotas').map(client => <option key={client.id} value={client.id}>{getClientDisplayName(client)} · Mz. {client.manzana} · Lote {client.lote}</option>)}</select></div>
            {selectedClient && <p className="rounded-xl bg-[#f4f7ef] px-4 py-2 text-sm text-[#54317f]">Datos cargados de {getClientDisplayName(selectedClient)}. Puedes editarlos en esta minuta.</p>}
            {selectedClient?.formaPago === 'contado' && <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">El modelo de este Word es solo para venta financiada. El modelo al contado se incorporará cuando se reciba.</p>}
            {draft.buyers.map((buyer, index) => <div key={index} className="grid gap-3 rounded-xl border border-[#e5e7df] bg-[#f3eaf9] p-4 md:grid-cols-2">
              <div className="md:col-span-2 flex items-center justify-between"><h3 className="font-semibold text-[#312144]">Comprador {index + 1}</h3>{draft.buyers.length > 1 && canEdit && <Button size="sm" variant="ghost" onClick={() => setValue('buyers', draft.buyers.filter((_, i) => i !== index))}>Quitar</Button>}</div>
              <div><Label>Nombre completo</Label><Input value={buyer.name} onChange={event => setBuyer(index, 'name', event.target.value)} disabled={!canEdit} className={field} /></div>
              <div><Label>Tipo de documento</Label><select value={buyer.documentType || 'dni'} onChange={event => { const type = event.target.value as MinuteBuyer['documentType']; setDraft(current => ({ ...current, buyers: current.buyers.map((item, i) => i === index ? { ...item, documentType: type, document: '' } : item) })); }} disabled={!canEdit} className={`w-full border px-3 ${field}`}><option value="dni">DNI</option><option value="ce">Carné de extranjería</option><option value="pasaporte">Pasaporte</option></select></div>
              <div><Label>{documentLabel(buyer.documentType)} ({documentHint(buyer.documentType || 'dni')})</Label><Input value={buyer.document} onChange={event => setBuyer(index, 'document', normalizeBuyerDocument(event.target.value, buyer.documentType || 'dni'))} inputMode={buyer.documentType === 'pasaporte' ? 'text' : 'numeric'} maxLength={buyer.documentType === 'pasaporte' ? 15 : buyer.documentType === 'ce' ? 11 : 8} disabled={!canEdit} className={field} /></div>
              <div><Label>Ocupación</Label><Input value={buyer.occupation} onChange={event => setBuyer(index, 'occupation', event.target.value)} disabled={!canEdit} className={field} /></div>
              <div><Label>Estado civil</Label><Input value={buyer.maritalStatus} onChange={event => setBuyer(index, 'maritalStatus', event.target.value)} disabled={!canEdit} className={field} /></div>
              <div className="md:col-span-2"><Label>Domicilio</Label><Input value={buyer.address} onChange={event => setBuyer(index, 'address', event.target.value)} disabled={!canEdit} className={field} /></div>
              <div><Label>Nacionalidad</Label><Input value={buyer.nationality || ''} onChange={event => setBuyer(index, 'nationality', event.target.value)} disabled={!canEdit} className={field} /></div>
              <div><Label>Distrito</Label><Input value={buyer.district || ''} onChange={event => setBuyer(index, 'district', event.target.value)} disabled={!canEdit} className={field} /></div>
              <div><Label>Provincia</Label><Input value={buyer.province || ''} onChange={event => setBuyer(index, 'province', event.target.value)} disabled={!canEdit} className={field} /></div>
              <div><Label>Departamento</Label><Input value={buyer.department || ''} onChange={event => setBuyer(index, 'department', event.target.value)} disabled={!canEdit} className={field} /></div>
            </div>)}
            {canEdit && draft.buyers.length < 10 && <Button variant="outline" onClick={() => setValue('buyers', [...draft.buyers, blankBuyer()])}><UserRoundPlus className="h-4 w-4" /> Añadir comprador</Button>}
          </section>
          <section className="space-y-4 border-t border-[#e9ebe7] pt-6">
            <h2 className="text-lg font-semibold text-[#312144]">2. Lote y precio</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div><Label>Manzana</Label><Input value={draft.block} onChange={event => setValue('block', event.target.value)} disabled={!canEdit} className={field} /></div>
              <div><Label>Lote</Label><Input value={draft.lot} onChange={event => setValue('lot', event.target.value)} disabled={!canEdit} className={field} /></div>
              <div><Label>Área m²</Label><Input type="number" min={0} value={draft.area || ''} onChange={event => setValue('area', Number(event.target.value))} disabled={!canEdit} className={field} /></div>
              <div><Label>Precio total S/</Label><Input type="number" min={0} step="0.01" value={draft.totalPrice || ''} onChange={event => setValue('totalPrice', Number(event.target.value))} disabled={!canEdit} className={field} /></div>
              <div><Label>Cuota inicial S/</Label><Input type="number" min={0} step="0.01" value={draft.initialAmount || ''} onChange={event => setValue('initialAmount', Number(event.target.value))} disabled={!canEdit} className={field} /></div>
            </div>
            <p className="rounded-xl bg-[#f3eaf9] px-4 py-3 text-sm font-semibold text-[#54317f]">Saldo a financiar: {money(Math.max(0, draft.totalPrice - draft.initialAmount))}</p>
          </section>
          <section className="space-y-4 border-t border-[#e9ebe7] pt-6">
            <h2 className="text-lg font-semibold text-[#312144]">3. Pagos de inicial</h2>
            <p className="text-sm text-[#697386]">Registra solo pagos verificados. La suma debe coincidir con la cuota inicial para generar el Word.</p>
            {draft.initialPayments.map((payment, index) => <div key={index} className="grid gap-3 rounded-xl border border-[#e5e7df] p-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]">
              <div><Label>Fecha</Label><Input type="date" value={payment.date} onChange={event => setPayment(index, 'date', event.target.value)} disabled={!canEdit} className={field} /></div>
              <div><Label>Medio</Label><select value={payment.method} onChange={event => setDraft(current => ({ ...current, initialPayments: current.initialPayments.map((item, i) => i === index ? { ...item, method: event.target.value, bank: ['Depósito', 'Transferencia'].includes(event.target.value) ? item.bank : '' } : item) }))} disabled={!canEdit} className={`w-full border px-3 ${field}`}><option value="">Seleccionar</option>{['Yape', 'Plin', 'Depósito', 'Transferencia', 'Otro'].map(method => <option key={method} value={method}>{method}</option>)}</select></div>
              <div><Label>Banco</Label><select value={payment.bank || ''} onChange={event => setPayment(index, 'bank', event.target.value)} disabled={!canEdit || !['Depósito', 'Transferencia'].includes(payment.method)} className={`w-full border px-3 ${field}`}><option value="">Seleccionar</option><option value="Interbank">Interbank</option><option value="BBVA">BBVA</option></select></div>
              <div><Label>N.° de operación</Label><Input value={payment.operationNumber || ''} onChange={event => setPayment(index, 'operationNumber', event.target.value)} disabled={!canEdit} placeholder="Si consta en el voucher" className={field} /></div>
              <div><Label>Monto S/</Label><Input type="number" min={0} step="0.01" value={payment.amount || ''} onChange={event => setPayment(index, 'amount', Number(event.target.value))} disabled={!canEdit} className={field} /></div>
              {canEdit && <Button size="sm" variant="ghost" className="self-end" onClick={() => setValue('initialPayments', draft.initialPayments.filter((_, i) => i !== index))}>Quitar</Button>}
            </div>)}
            {canEdit && <Button variant="outline" onClick={() => setValue('initialPayments', [...draft.initialPayments, { date: today(), method: '', amount: 0 }])}>Añadir pago</Button>}
            <p className="text-sm text-[#697386]">Registrado: {money(draft.initialPayments.reduce((sum, item) => sum + (item.amount || 0), 0))} / {money(draft.initialAmount)}</p>
          </section>
          <section className="space-y-4 border-t border-[#e9ebe7] pt-6">
            <h2 className="text-lg font-semibold text-[#312144]">4. Financiamiento y revisión</h2>
            <div className="grid gap-3 sm:grid-cols-2"><div><Label>Número total de cuotas</Label><Input type="number" min={1} max={240} value={draft.installments || ''} onChange={event => setValue('installments', Number(event.target.value))} disabled={!canEdit || user?.role !== 'admin'} className={field} /><p className="mt-1 text-xs text-[#697386]">Se toma del cliente. Solo administración puede cambiar esta cantidad; al hacerlo se recalcula el cronograma de esta minuta.</p></div><div><Label>Primera fecha de vencimiento</Label><Input type="date" value={draft.firstDueDate} onChange={event => setValue('firstDueDate', event.target.value)} disabled={!canEdit} className={field} /></div></div>
            {schedule.length > 0 && <div className="max-h-64 overflow-y-auto rounded-xl border border-[#d9ddd9]"><table className="w-full text-sm"><thead className="sticky top-0 bg-[#f3eaf9] text-[#312144]"><tr><th className="p-2 text-left">Comprador</th><th className="p-2 text-left">Vencimiento</th><th className="p-2 text-right">Monto</th></tr></thead><tbody>{schedule.map(item => <tr key={item.number} className="border-t"><td className="p-2">{draft.buyers.map(buyer => buyer.name).filter(Boolean).join(' y ') || 'Comprador'}</td><td className="p-2">{formatDate(item.dueDate)}</td><td className="p-2 text-right">{money(item.amount)}</td></tr>)}</tbody></table></div>}
            <div className="space-y-3 border-t border-[#e9ebe7] pt-5"><h2 className="text-lg font-semibold text-[#312144]">5. Fecha y firmas</h2><div className="max-w-xs"><Label>Fecha de firma</Label><Input type="date" value={draft.signatureDate || ''} onChange={event => setValue('signatureDate', event.target.value)} disabled={!canEdit} className={field} /></div><p className="text-sm text-[#697386]">Los nombres y documentos de los compradores se repiten automáticamente en las firmas.</p></div>
            <div className="flex flex-wrap gap-3 border-t border-[#e9ebe7] pt-5">
              {canEdit && <Button variant="outline" disabled={busy} onClick={() => void handleSave()}><Save className="h-4 w-4" /> Guardar borrador</Button>}
              <Button disabled={busy} onClick={() => void handleGenerate()} className="bg-[#54317f] text-white hover:bg-[#312144]"><FileDown className="h-4 w-4" /> Generar Word para revisión</Button>
            </div>
          </section>
          {editingId && <section className="space-y-3 border-t border-[#e9ebe7] pt-6"><h2 className="flex items-center gap-2 text-lg font-semibold text-[#312144]"><History className="h-5 w-5" /> Historial de esta minuta</h2>{minuteEvents.filter(event => event.minuteId === editingId).length === 0 ? <p className="text-sm text-[#697386]">Aún no hay cambios registrados.</p> : minuteEvents.filter(event => event.minuteId === editingId).map(event => <div key={event.id} className="rounded-xl border border-[#d9ddd9] bg-white p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{event.actorEmail}</strong><time className="text-[#697386]">{event.createdAt?.toDate().toLocaleString('es-PE') || 'Pendiente'}</time></div><p className="mt-1 text-[#56604f]">{event.summary || event.action}</p><p className="text-xs text-[#697386]">{event.fields.join(', ')}</p></div>)}</section>}
        </CardContent>
      </Card>
    </div>
  </div>;
}
