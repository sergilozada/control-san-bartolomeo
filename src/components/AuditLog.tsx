import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore';
import { db } from '@/services/firebase';
import { useAuth } from '@/context/FirebaseAuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Entry {
  id: string;
  actorEmail: string;
  clientId: string;
  minuteId?: string;
  action: string;
  fields: string[];
  summary?: string;
  createdAt?: Timestamp | Date;
}

export default function AuditLog() {
  const { preview, demoAuditEntries } = useAuth();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const visibleEntries: Entry[] = preview ? (demoAuditEntries || []) : entries;
  useEffect(() => {
    if (preview) return;
    return onSnapshot(
    query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(100)),
    snapshot => setEntries(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Entry))),
    () => setError('No se pudo cargar el historial. Revisa los permisos de administrador.'),
    );
  }, [preview]);
  return <Card>
    <CardHeader><CardTitle>Historial de cambios</CardTitle>
      <p className="text-sm text-slate-500">Visible solo para administradores. Últimos 100 cambios de clientes, cuotas y minutas.</p>
    </CardHeader>
    <CardContent>
      {error && <p role="alert" className="text-rose-700">{error}</p>}
      {preview && <p className="text-sm text-slate-500">Demostración local: los cambios de muestra se borran al recargar. Solo el administrador ve este historial.</p>}
      {!error && visibleEntries.length === 0 && <p className="text-sm text-slate-500">Aún no hay cambios registrados. Prueba una observación o un pago de muestra.</p>}
      <div className="space-y-2">
        {visibleEntries.map(entry => <div key={entry.id} className="rounded-xl border border-slate-200 p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <strong>{entry.actorEmail} · {entry.action}</strong>
            <time className="text-slate-500">{(entry.createdAt instanceof Date ? entry.createdAt : entry.createdAt?.toDate())?.toLocaleString('es-PE') || 'Pendiente'}</time>
          </div>
          <p className="mt-1 text-slate-600">{entry.minuteId ? `Minuta: ${entry.minuteId}` : `Cliente: ${entry.clientId}`}</p>
          {entry.summary && <p className="text-slate-600">{entry.summary}</p>}
          {entry.fields.length > 0 && <p className="text-slate-500">Campos: {entry.fields.join(', ')}</p>}
        </div>)}
      </div>
    </CardContent>
  </Card>;
}
