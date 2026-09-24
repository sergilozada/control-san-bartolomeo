import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import { Plus, ShieldCheck, UserRoundCheck, UserRoundX, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/FirebaseAuthContext';
import { roleLabel, type UserRole } from '@/config/permissions';
import { db } from '@/services/firebase';
import { createStaffUser, updateStaffUser, usesStaffFunction, type StaffProfile } from '@/services/staffUsers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const roles = Object.keys(roleLabel) as UserRole[];
const selectClass = 'h-10 rounded-xl border border-[#d9ddd9] bg-white px-3 text-sm text-[#33204f] focus:outline-none focus:ring-2 focus:ring-[#54317f]';

function messageFor(error: unknown) {
  if (error instanceof FirebaseError) {
    if (error.code === 'auth/email-already-in-use') return 'Ese usuario ya existe en Firebase Authentication.';
    if (error.code === 'auth/invalid-email') return 'El nombre de usuario genera un correo inválido.';
    if (error.code === 'auth/weak-password') return 'Usa una contraseña inicial más segura.';
    if (error.code === 'permission-denied') return 'Firebase rechazó el cambio. Comprueba que tu cuenta siga siendo administradora.';
  }
  return error instanceof Error ? error.message : 'No se pudo completar la operación.';
}

function StaffRow({ profile, actorUid, actorEmail, onMessage }: {
  profile: StaffProfile; actorUid: string; actorEmail: string;
  onMessage: (message: string, error?: boolean) => void;
}) {
  const [role, setRole] = useState<UserRole>(profile.role);
  const [busy, setBusy] = useState(false);
  useEffect(() => setRole(profile.role), [profile.role]);
  const ownAccount = profile.id === actorUid;

  const save = async (changes: Parameters<typeof updateStaffUser>[1], action: string, success: string) => {
    setBusy(true);
    try {
      await updateStaffUser(profile.id, changes, action, actorUid, actorEmail);
      onMessage(success);
    } catch (error) {
      onMessage(messageFor(error), true);
    } finally {
      setBusy(false);
    }
  };

  return <div className="grid gap-3 rounded-2xl border border-[#e1dfdc] bg-white p-4 shadow-sm lg:grid-cols-[minmax(0,1.4fr)_minmax(160px,0.7fr)_minmax(200px,1fr)] lg:items-center">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-[#33204f]">{profile.name || 'Sin nombre'}</strong>
        {ownAccount && <span className="rounded-full bg-[#f2ebf7] px-2 py-0.5 text-xs font-medium text-[#54317f]">Tu cuenta</span>}
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${profile.active ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{profile.deleted ? 'Eliminado' : profile.active ? 'Activo' : 'Suspendido'}</span>
      </div>
      <p className="mt-1 break-all text-sm text-[#5f6878]">{profile.email || (ownAccount ? actorEmail : 'Correo no registrado')}</p>
      {profile.jobTitle && <p className="mt-1 text-xs text-[#7a8190]">{profile.jobTitle}</p>}
    </div>
    <div className="flex gap-2 lg:flex-col">
      <Label htmlFor={`role-${profile.id}`} className="sr-only">Rol de {profile.name}</Label>
      <select id={`role-${profile.id}`} value={role} onChange={event => setRole(event.target.value as UserRole)} disabled={busy || ownAccount || profile.deleted} className={`${selectClass} min-w-0 flex-1`}>
        {roles.map(value => <option key={value} value={value}>{roleLabel[value]}</option>)}
      </select>
      {!ownAccount && !profile.deleted && role !== profile.role && <Button type="button" disabled={busy} onClick={() => void save({ role }, 'rol', 'Rol actualizado.')} className="bg-[#54317f] hover:bg-[#43266a]">Guardar</Button>}
    </div>
    <div className="flex flex-wrap gap-2 lg:justify-end">
      {!ownAccount && !profile.deleted && (profile.active
        ? <Button type="button" variant="outline" disabled={busy} onClick={() => {
          if (window.confirm(`¿Suspender a ${profile.name}? Perderá acceso al control inmediatamente.`)) void save({ active: false }, 'suspender', 'Usuario suspendido.');
        }}><UserRoundX className="mr-1 h-4 w-4" />Suspender</Button>
        : <Button type="button" variant="outline" disabled={busy} onClick={() => void save({ active: true }, 'reactivar', 'Usuario reactivado.')}><UserRoundCheck className="mr-1 h-4 w-4" />Reactivar</Button>)}
      {!ownAccount && !profile.deleted && <Button type="button" variant="outline" disabled={busy} className="text-rose-700 hover:text-rose-800" onClick={() => {
        if (window.confirm(usesStaffFunction
          ? `¿Eliminar definitivamente a ${profile.name} de Firebase Authentication? Se conservará un registro archivado para auditoría.`
          : `¿Eliminar el acceso de ${profile.name}? Se conservará un registro para auditoría y el correo no podrá reutilizarse hasta completar la eliminación de Authentication.`)) {
          void save({ active: false, deleted: true }, 'eliminar', 'Acceso eliminado y registro archivado.');
        }
      }}><Trash2 className="mr-1 h-4 w-4" />Eliminar</Button>}
      {!ownAccount && profile.deleted && usesStaffFunction && <Button type="button" variant="outline" disabled={busy} className="text-rose-700" onClick={() => {
        if (window.confirm(`¿Borrar definitivamente la cuenta de Authentication de ${profile.name}?`)) void save({ active: false, deleted: true }, 'eliminar', 'Cuenta de Authentication eliminada.');
      }}>Completar borrado</Button>}
    </div>
  </div>;
}

interface StaffEvent {
  id: string; action: string; targetUid: string; actorEmail: string; createdAt?: Timestamp;
}

export default function StaffUsers() {
  const { user, preview } = useAuth();
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [events, setEvents] = useState<StaffEvent[]>([]);
  const [name, setName] = useState('');
  const [localPart, setLocalPart] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [role, setRole] = useState<UserRole>('consulta');
  const [password, setPassword] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (preview || user?.role !== 'admin') return;
    const offUsers = onSnapshot(collection(db, 'users'), snapshot => {
      setStaff(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as StaffProfile))
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es')));
    }, () => setError('No se pudo leer la lista de usuarios.'));
    const offEvents = onSnapshot(query(collection(db, 'userEvents'), orderBy('createdAt', 'desc'), limit(20)), snapshot => {
      setEvents(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as StaffEvent)));
    }, () => setError('No se pudo leer la actividad de usuarios.'));
    return () => { offUsers(); offEvents(); };
  }, [preview, user?.role]);

  if (user?.role !== 'admin') return null;

  const showMessage = (value: string, isError = false) => {
    setNotice(isError ? '' : value);
    setError(isError ? value : '');
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (preview) return;
    if (role === 'admin' && !window.confirm('Este rol tendrá control completo del sistema. ¿Crear otro administrador?')) return;
    setBusy(true);
    showMessage('');
    try {
      await createStaffUser({ name, localPart, jobTitle, role, password }, user.id, user.email);
      setName(''); setLocalPart(''); setJobTitle(''); setRole('consulta'); setPassword('');
      showMessage('Usuario creado en Firebase. Entrega el correo y la contraseña inicial por un canal seguro.');
    } catch (failure) {
      showMessage(messageFor(failure), true);
    } finally {
      setBusy(false);
    }
  };

  const visible = staff.filter(item => showArchived || !item.deleted);
  const archivedCount = staff.filter(item => item.deleted).length;

  return <div className="space-y-5">
    <div className="rounded-3xl bg-[#33204f] px-6 py-6 text-white sm:px-8">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#c8b3df]"><ShieldCheck className="h-4 w-4" /> Solo administración</div>
      <h1 className="brand-display mt-2 text-3xl sm:text-4xl">Usuarios</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-white/80">Crea accesos individuales, asigna permisos según la función de cada trabajador y suspende o reactiva cuentas.</p>
    </div>

    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

    <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.5fr)]">
      <Card className="h-fit rounded-2xl border-[#e1dfdc] shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2 text-xl text-[#33204f]"><Plus className="h-5 w-5" />Crear usuario</CardTitle>
          <p className="text-sm text-[#5f6878]">El correo interno sirve para iniciar sesión. No necesita ser un buzón real.</p></CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            <div><Label htmlFor="staff-name">Nombre completo</Label><Input id="staff-name" value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={100} className="mt-1 rounded-xl" placeholder="Nombre del trabajador" /></div>
            <div><Label htmlFor="staff-job">Cargo o área</Label><Input id="staff-job" value={jobTitle} onChange={event => setJobTitle(event.target.value)} maxLength={100} className="mt-1 rounded-xl" placeholder="Ej. Asesor de ventas" /></div>
            <div><Label htmlFor="staff-username">Usuario de acceso</Label><div className="mt-1 flex min-w-0 items-center rounded-xl border border-[#d9ddd9] bg-white focus-within:ring-2 focus-within:ring-[#54317f]"><input id="staff-username" value={localPart} onChange={event => setLocalPart(event.target.value.toLowerCase())} required autoComplete="off" className="h-10 min-w-0 flex-1 rounded-l-xl px-3 text-sm outline-none" placeholder="nombre.apellido" /><span className="shrink-0 pr-3 text-xs text-[#5f6878] sm:text-sm">@sanbartolomeo.com</span></div></div>
            <div><Label htmlFor="staff-role">Rol y permisos</Label><select id="staff-role" value={role} onChange={event => setRole(event.target.value as UserRole)} className={`${selectClass} mt-1 w-full`}>{roles.map(value => <option key={value} value={value}>{roleLabel[value]}</option>)}</select><p className="mt-1 text-xs text-[#6d7482]">Consulta puede ver clientes. Pagos registra pagos y vouchers. Boletas gestiona boletas. Legal trabaja con minutas y resoluciones.</p></div>
            <div><Label htmlFor="staff-password">Contraseña inicial</Label><Input id="staff-password" type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={10} autoComplete="new-password" className="mt-1 rounded-xl" placeholder="Mínimo 10 caracteres" /><p className="mt-1 text-xs text-[#6d7482]">No se guarda en Firestore. Si el correo no recibe mensajes, la recuperación por email no funcionará.</p></div>
            <Button type="submit" disabled={busy || preview} className="w-full rounded-xl bg-[#54317f] hover:bg-[#43266a]">{busy ? 'Creando…' : 'Crear usuario'}</Button>
            {preview && <p className="text-xs text-[#6d7482]">La vista de muestra no crea cuentas reales.</p>}
          </form>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-[#e1dfdc] shadow-sm">
        <CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-xl text-[#33204f]">Equipo y accesos</CardTitle><span className="rounded-full bg-[#f2ebf7] px-3 py-1 text-sm font-medium text-[#54317f]">{staff.filter(item => !item.deleted).length} {staff.filter(item => !item.deleted).length === 1 ? 'usuario' : 'usuarios'}</span></div>
          <p className="text-sm text-[#5f6878]">Cada cambio se guarda en Firebase y se aplica al acceso a datos del usuario.</p></CardHeader>
        <CardContent className="space-y-3">
          {visible.length === 0 && <p className="rounded-xl border border-dashed border-[#d9ddd9] p-5 text-sm text-[#5f6878]">{preview ? 'La lista real aparece al ingresar con la cuenta administradora.' : 'No hay usuarios para mostrar.'}</p>}
          {visible.map(profile => <StaffRow key={profile.id} profile={profile} actorUid={user.id} actorEmail={user.email} onMessage={showMessage} />)}
          {archivedCount > 0 && <button type="button" onClick={() => setShowArchived(value => !value)} className="text-sm font-medium text-[#54317f] underline underline-offset-2">{showArchived ? 'Ocultar' : 'Mostrar'} {archivedCount} registros eliminados</button>}
          <p className="pt-2 text-xs leading-5 text-[#6d7482]">{usesStaffFunction ? 'Eliminar borra la cuenta de Authentication y conserva un registro archivado para auditoría.' : 'Eliminar revoca el acceso y archiva el perfil. La cuenta de Authentication se borrará por completo cuando se habilite la función segura de administración en Firebase.'}</p>
        </CardContent>
      </Card>
    </div>

    {events.length > 0 && <Card className="rounded-2xl border-[#e1dfdc] shadow-sm"><CardHeader><CardTitle className="text-lg text-[#33204f]">Actividad de usuarios</CardTitle></CardHeader><CardContent className="space-y-2">{events.map(item => <div key={item.id} className="flex flex-wrap justify-between gap-2 rounded-xl border border-[#e1dfdc] px-3 py-2 text-sm"><span><strong>{item.actorEmail}</strong> · {item.action} · {staff.find(person => person.id === item.targetUid)?.name || item.targetUid}</span><time className="text-[#6d7482]">{item.createdAt?.toDate().toLocaleString('es-PE') || 'Pendiente'}</time></div>)}</CardContent></Card>}
  </div>;
}
