import { useState } from 'react';
import useAnyAuth from '@/context/useAnyAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BookOpen, Download, Edit, Eye, FileCheck2, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { isStorageEnabled, projectStorageRoot, storage } from '@/services/firebase';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ObservationEntry, Titular } from '@/types/client';
import { getClientDisplayDnis, getClientDisplayName, getClientTitulares } from '@/types/client';
import { canManageClients, canManageMinutes, canManageReceipts, canRegisterPayments } from '@/config/permissions';
import MinutaUploadButton from '@/components/MinutaUploadButton';
import { NoDebtCertificateButton, ResolutionDraftButton } from '@/components/ClientDocuments';
import { monthEnd, needsFinancialReview, type ImportedClientSource } from '@/lib/importedClients';
import ImportedClientReview from '@/components/ImportedClientReview';

interface ClientListProps {
  filterType?: 'pending' | 'overdue' | 'all';
  onCreateMinute?: (clientId: string) => void;
}

type OverdueCountFilter = 'all' | '1' | '2' | '3' | '4' | '5' | '6';

interface Client extends ImportedClientSource {
  id: string;
  titulares?: Titular[];
  nombre1: string;
  nombre2?: string;
  dni1: string;
  dni2?: string;
  celular1?: string;
  celular2?: string;
  email1?: string;
  email2?: string;
  observaciones?: string;
  observationEntries?: ObservationEntry[];
  bloque?: string;
  manzana: string;
  lote: string;
  metraje: number;
  montoTotal: number;
  formaPago: 'contado' | 'cuotas';
  inicial?: number;
  numeroCuotas?: number;
  fechaRegistro: string;
  cuotas?: Cuota[];
}

interface StoredAttachment {
  url: string;
  name?: string;
  path?: string;
}

type AttachmentType = 'voucher' | 'boleta';

interface Cuota {
  numero: number;
  vencimiento: string;
  monto: number;
  mora?: number;
  total?: number;
  // If true, mora was set manually by a user and should be respected even if 0
  manualMora?: boolean;
  fechaPago?: string;
  estado: 'pendiente' | 'pagado' | 'vencido';
  // Support legacy string URLs and the newer objects that store original filename
  voucher?: string | string[] | StoredAttachment | StoredAttachment[];
  boleta?: string | string[] | StoredAttachment | StoredAttachment[];
}

interface AttachmentManagerState {
  clientId: string;
  clientName: string;
  cuotaIndex: number;
  cuotaNumber: number;
  fileType: AttachmentType;
  files: StoredAttachment[];
}

interface AttachmentDeleteState extends AttachmentManagerState {
  attachment: StoredAttachment;
}

interface PaymentScheduleConfig {
  logoLayout: 'legacy-wide' | 'paired-square';
  logoUrls: string[];
  cobranzaPhone: string;
  projectName: string;
  bankLines: string[];
}

const CURRENT_PAYMENT_SCHEDULE: PaymentScheduleConfig = {
  logoLayout: 'legacy-wide',
  logoUrls: ['/brand/san-bartolomeo-logo.jpeg'],
  cobranzaPhone: 'Por confirmar',
  projectName: 'San Bartolomeo Inmobiliaria',
  bankLines: ['Solicite los datos bancarios vigentes a cobranzas.']
};

const getPaymentScheduleSections = (client: Client) => (
  client.cuotas?.length ? [{ installments: client.cuotas, config: CURRENT_PAYMENT_SCHEDULE }] : []
);

const normalizeAttachments = (raw: Cuota['voucher']): StoredAttachment[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(item => (typeof item === 'string' ? { url: item } : item));
  }
  return typeof raw === 'string' ? [{ url: raw }] : [raw];
};

export default function ClientList({ filterType = 'all', onCreateMinute }: ClientListProps) {
  const {
    user,
    preview,
    clients,
    deleteClient,
    updateClient,
    appendObservation,
    updateCuota,
    calculateMora,
    markCuotaAsPaid,
    unmarkCuotaAsPaid,
    updateCuotaAmount,
    updateCuotaDates,
    selectedClientId,
    setSelectedClientId,
    formatLocalISO,
    parseLocalDate
  } = useAnyAuth();
  const canEditClients = canManageClients(user?.role);
  const canPay = canRegisterPayments(user?.role);
  const canBoleta = canManageReceipts(user?.role);
  const canLegal = canManageMinutes(user?.role);
  const [selectedClient, setSelectedClient] = useState<string | null>(selectedClientId || null);
  const [editingCuota, setEditingCuota] = useState<{ clientId: string; type: 'amount' | 'date'; cuotaIndex?: number } | null>(null);
  const [editMonto, setEditMonto] = useState('');
  const [editFecha, setEditFecha] = useState('');
  const [editingMora, setEditingMora] = useState<{ clientId: string; cuotaIndex: number } | null>(null);
  const [editMoraValue, setEditMoraValue] = useState('');
  const [propagateDates, setPropagateDates] = useState(false);
  const [overdueMonth, setOverdueMonth] = useState<number | null>(null); // 0-11, null = all
  const [overdueYear, setOverdueYear] = useState<number>(new Date().getFullYear());
  const [overdueCountFilter, setOverdueCountFilter] = useState<OverdueCountFilter>('all');
  // Initialize paymentDate as local ISO (yyyy-MM-dd) to avoid timezone shifts
  const [paymentDate, setPaymentDate] = useState(formatLocalISO());
  const [editingPhoneClientId, setEditingPhoneClientId] = useState<string | null>(null);
  const [editCelular1, setEditCelular1] = useState('');
  const [editCelular2, setEditCelular2] = useState('');
  const [detailEditField, setDetailEditField] = useState<'nombre' | 'dni' | 'email' | null>(null);
  const [editTitulares, setEditTitulares] = useState<Titular[]>([]);
  const [editEmail1, setEditEmail1] = useState('');
  const [editEmail2, setEditEmail2] = useState('');
  const [savingDetail, setSavingDetail] = useState(false);
  const [paymentConfirmation, setPaymentConfirmation] = useState<{ clientId: string; cuotaIndex: number; action: 'mark' | 'unmark' } | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);
  const [observationsClient, setObservationsClient] = useState<Client | null>(null);
  const [observationDraft, setObservationDraft] = useState('');
  const [savingObservation, setSavingObservation] = useState(false);
  const [attachmentManager, setAttachmentManager] = useState<AttachmentManagerState | null>(null);
  const [attachmentToDelete, setAttachmentToDelete] = useState<AttachmentDeleteState | null>(null);
  const [deletingAttachment, setDeletingAttachment] = useState(false);
  const [deletingClientId, setDeletingClientId] = useState<string | null>(null);

  const openClientDetail = (client: Client) => {
    setDetailEditField(null);
    setSelectedClient(client.id);
    setSelectedClientId(client.id);
  };

  const openObservations = (client: Client) => {
    setObservationsClient(client);
    setObservationDraft('');
  };

  const closeObservations = () => {
    if (savingObservation) return;
    setObservationsClient(null);
    setObservationDraft('');
  };

  const saveObservation = async () => {
    if (!observationsClient || !observationDraft.trim()) return;

    setSavingObservation(true);
    try {
      await appendObservation(observationsClient.id, observationDraft);
      toast.success('Anotación agregada al libro');
      setObservationsClient(null);
      setObservationDraft('');
    } catch (error) {
      console.error('Error guardando la observación:', error);
      toast.error('No se pudo guardar la observación');
    } finally {
      setSavingObservation(false);
    }
  };

  const startPhoneEdit = (client: Client) => {
    setEditingPhoneClientId(client.id);
    setEditCelular1(client.celular1 || '');
    setEditCelular2(client.celular2 || '');
  };

  const cancelPhoneEdit = () => {
    setEditingPhoneClientId(null);
    setEditCelular1('');
    setEditCelular2('');
  };

  const savePhoneEdit = async () => {
    if (!editingPhoneClientId) return;

    const payload = {
      celular1: editCelular1.trim(),
      celular2: editCelular2.trim()
    };

    try {
      await updateClient(editingPhoneClientId, payload);
      toast.success('Teléfonos actualizados correctamente');
      cancelPhoneEdit();
    } catch (err) {
      console.error('Error actualizando teléfonos:', err);
      toast.error('No se pudo actualizar los teléfonos');
    }
  };

  const startDetailEdit = (client: Client, field: 'nombre' | 'dni' | 'email') => {
    setDetailEditField(field);
    setEditTitulares(getClientTitulares(client));
    setEditEmail1(client.email1 || '');
    setEditEmail2(client.email2 || '');
  };

  const saveDetailEdit = async (client: Client) => {
    if (!detailEditField || savingDetail) return;
    const titulares = editTitulares.map(titular => ({nombre:titular.nombre.trim(),dni:titular.dni.trim()}));
    if (detailEditField === 'nombre' && titulares.some(titular => !titular.nombre)) {toast.error('Completa el nombre de cada titular.');return;}
    if (detailEditField === 'dni' && titulares.some(titular => !/^\d{8}$/.test(titular.dni))) {toast.error('Cada DNI debe tener 8 dígitos.');return;}
    const email1 = editEmail1.trim(), email2 = editEmail2.trim();
    if (detailEditField === 'email' && [email1,email2].some(email => email && !/^\S+@[^\s@]+\.[^\s@]+$/.test(email))) {toast.error('Revisa el formato de los correos.');return;}
    const payload = detailEditField === 'email' ? {email1,email2} : {
      titulares,
      nombre1:titulares[0]?.nombre || '',nombre2:titulares[1]?.nombre || '',
      dni1:titulares[0]?.dni || '',dni2:titulares[1]?.dni || '',
    };
    setSavingDetail(true);
    try {
      await updateClient(client.id, payload);
      toast.success('Datos del cliente actualizados.');
      setDetailEditField(null);
    } catch (err) {
      console.error('Error actualizando datos del cliente:', err);
      toast.error('No se pudieron guardar los datos.');
    } finally {setSavingDetail(false);}
  };

  const getOverdueInstallments = (client: Client) => {
    const today = new Date();
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    return (client.cuotas || []).filter((cuota) => {
      if (cuota.estado !== 'pendiente' || cuota.numero <= 0) return false;

      const dueDate = parseLocalDate(cuota.vencimiento);
      const dueMidnight = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
      if (dueMidnight.getTime() >= todayMidnight.getTime()) return false;

      return overdueMonth === null
        || (dueDate.getMonth() === overdueMonth && dueDate.getFullYear() === overdueYear);
    });
  };

  const getFilteredClients = () => {
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    switch (filterType) {
      case 'pending':
        return clients.filter(client => 
          client.cuotas?.some(cuota => {
       const vencimiento = new Date(cuota.vencimiento);
       const v = parseLocalDate(cuota.vencimiento);
       return v.getMonth() === currentMonth && 
         v.getFullYear() === currentYear &&
                   cuota.estado === 'pendiente' &&
                   cuota.numero > 0; // Excluir iniciales
          })
        );
      case 'overdue':
        return clients.filter(client => {
          const overdueCount = getOverdueInstallments(client).length;
          return overdueCount > 0
            && (overdueCountFilter === 'all' || overdueCount === Number(overdueCountFilter));
        });
      default:
        return clients;
    }
  };

  const getClientStatus = (client: Client) => {
    if (needsFinancialReview(client)) return 'Revisar pagos';
    if (!client.cuotas || client.cuotas.length === 0) return 'Sin cuotas';
    
    const cuotasPagadas = client.cuotas.filter((c: Cuota) => c.estado === 'pagado' && c.numero > 0).length;
    const totalCuotas = client.cuotas.filter((c: Cuota) => c.numero > 0).length;
    const cuotasPendientes = totalCuotas - cuotasPagadas;
    
    if (cuotasPendientes === 0) return client.cuotas.some(c => c.estado !== 'pagado') ? 'Inicial pendiente' : 'Completado';
    return `Debe ${cuotasPendientes}`;
  };

  const getOverdueInstallmentCount = (client: Client) => {
    return getOverdueInstallments(client).length;
  };

  const handleDeleteClient = async (clientId: string) => {
    if (deletingClientId || !window.confirm('¿Está seguro de que desea eliminar este cliente? Esta acción no se puede deshacer.')) return;

    setDeletingClientId(clientId);
    try {
      await deleteClient(clientId);
      toast.success('Cliente eliminado exitosamente');
    } catch (error) {
      console.error('No se pudo eliminar el cliente:', error);
      toast.error('No se eliminó el cliente.', {
        description: error instanceof Error ? error.message : 'Firebase no confirmó el borrado. Inténtelo de nuevo.',
      });
    } finally {
      setDeletingClientId(null);
    }
  };

  const handleEditCuotasAmount = () => {
    if (!editingCuota || editingCuota.type !== 'amount') return;
    
    const newMonto = parseFloat(editMonto);
    if (isNaN(newMonto) || newMonto < 0) {
      toast.error('Ingrese un monto válido');
      return;
    }
    // If a specific cuota index is provided, update only that cuota and move the difference to the final cuota
    if (editingCuota.cuotaIndex !== undefined) {
      const client = clients.find(c => c.id === editingCuota.clientId);
      if (!client || !client.cuotas) {
        toast.error('Cliente o cuotas no encontrados');
        return;
      }

      const cuotasCopy = client.cuotas.map(c => ({ ...c }));
      const idx = editingCuota.cuotaIndex;
      const oldMonto = cuotasCopy[idx]?.monto ?? 0;
      cuotasCopy[idx].monto = newMonto;
      cuotasCopy[idx].total = newMonto + (cuotasCopy[idx].mora ?? 0);

      // Find last cuota index (highest numero > 0)
      const numeroCuotas = cuotasCopy.filter(c => c.numero > 0).length;
      let lastIndex = cuotasCopy.findIndex(c => c.numero === numeroCuotas);
      if (lastIndex === -1) lastIndex = cuotasCopy.length - 1;

      // Compute leftover: if newMonto is less than oldMonto, leftover is positive and should be
      // added to the last cuota. If newMonto > oldMonto, we subtract the difference from last cuota.
      const diffToMove = oldMonto - newMonto; // positive => add to last, negative => subtract from last

      // Only apply movement to a different cuota than the one being edited
      if (lastIndex >= 0 && lastIndex < cuotasCopy.length && lastIndex !== idx && diffToMove !== 0) {
        const last = cuotasCopy[lastIndex];
        const newLastMonto = (last.monto || 0) + diffToMove;
        // Ensure last cuota monto doesn't go negative
        last.monto = Math.max(0, Math.round((newLastMonto + Number.EPSILON) * 100) / 100);
        last.total = last.monto + (last.mora ?? 0);
      }

      // Single write (replace cuotas array)
      Promise.resolve(updateClient(editingCuota.clientId, { cuotas: cuotasCopy }))
        .then(() => {
          setEditingCuota(null);
          setEditMonto('');
          toast.success('Monto de cuota actualizado y diferencia aplicada a la última cuota');
        })
        .catch(err => {
          console.error('Error actualizando cuota individual:', err);
          toast.error('Error al actualizar cuota');
        });
      return;
    }

    // Otherwise update regular cuotas amounts (existing behaviour)
    updateCuotaAmount(editingCuota.clientId, newMonto);
    setEditingCuota(null);
    setEditMonto('');
    toast.success('Montos de cuotas actualizados exitosamente');
  };

  const handleEditMoraSave = () => {
    if (!editingMora) return;
    const v = parseFloat(editMoraValue);
    if (isNaN(v) || v < 0) { toast.error('Ingrese un monto válido para la mora'); return; }
    // Update the specific cuota mora and total
    const client = clients.find(c => c.id === editingMora.clientId);
  if (!client || !client.cuotas) return;
  const cuota = client.cuotas[editingMora.cuotaIndex];
  if (!cuota) return;
  updateCuota(editingMora.clientId, editingMora.cuotaIndex, { mora: v, total: cuota.monto + v, manualMora: true });
    setEditingMora(null);
    setEditMoraValue('');
    toast.success('Mora actualizada');
  };

  const handleEditCuotaDate = () => {
    if (!editingCuota || editingCuota.type !== 'date' || editingCuota.cuotaIndex === undefined) return;

    if (!editFecha) {
      toast.error('Ingrese una fecha válida');
      return;
    }

    (async () => {
      try {
        const client = clients.find(c => c.id === editingCuota.clientId);
        if (!client || !client.cuotas) return;

        const cuotaIdx = editingCuota.cuotaIndex as number;
        const chosenISO = formatLocalISO(editFecha);
        const baseISO = client.formaPago === 'cuotas' && client.cuotas[cuotaIdx].numero > 0 ? monthEnd(chosenISO) : chosenISO;

        if (!propagateDates) {
          // Only update the single cuota
          await Promise.resolve(updateCuotaDates(editingCuota.clientId, cuotaIdx, baseISO));
        } else {
          // Update this cuota and all following cuotas.
          // Initial payments keep their date; regular installments use month end.
          // All subsequent cuotas should use the LAST DAY of each successive month.
          const baseDate = parseLocalDate(baseISO);
          const updatedCuotas = client.cuotas.map((c, idx) => {
            if (idx < cuotaIdx) return c;
            const monthsToAdd = idx - cuotaIdx;
            if (monthsToAdd === 0) {
              return { ...c, vencimiento: baseISO };
            }
            // compute last day of (base month + monthsToAdd)
            const year = baseDate.getFullYear();
            const month = baseDate.getMonth() + monthsToAdd;
            const lastDay = new Date(year, month + 1, 0).getDate();
            const target = new Date(year, month, lastDay);
            return { ...c, vencimiento: formatLocalISO(target) };
          });

          // Single write to update all cuotas at once
          await updateClient(editingCuota.clientId, { cuotas: updatedCuotas });
        }

        setEditingCuota(null);
        setEditFecha('');
        setPropagateDates(false);
        toast.success('Fecha(s) de vencimiento actualizada(s)');
      } catch (err) {
        console.error('Error actualizando fechas de cuotas:', err);
        toast.error('Error al actualizar fechas de cuotas');
      }
    })();
  };

  const confirmPaymentChange = async () => {
    if (!paymentConfirmation || savingPayment) return;
    const {clientId,cuotaIndex,action}=paymentConfirmation;
    setSavingPayment(true);
    try {
      if (action === 'mark') {
        if (!paymentDate) throw new Error('Selecciona la fecha de pago.');
        await markCuotaAsPaid(clientId, cuotaIndex, paymentDate);
        toast.success('Cuota marcada como pagada.');
      } else {
        await unmarkCuotaAsPaid(clientId, cuotaIndex);
        toast.success('Pago desmarcado. La cuota está pendiente.');
      }
      setPaymentConfirmation(null);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el pago.');
    } finally {setSavingPayment(false);}
  };

  const handleFileUpload = (clientId: string, cuotaIndex: number, fileType: 'voucher' | 'boleta') => {
    if (fileType === 'voucher' ? !canPay : !canBoleta) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.multiple = true; // Permitir múltiples archivos
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        // We'll store objects with both the download URL and the original filename
        const uploadedItems: StoredAttachment[] = [];
        for (let i = 0; i < files.length; i++) {
          try {
            const file = files[i];
            const originalName = file.name;
            const dotIndex = originalName.lastIndexOf('.');
            const baseName = dotIndex !== -1 ? originalName.slice(0, dotIndex) : originalName;
            const ext = dotIndex !== -1 ? originalName.slice(dotIndex) : '';
            // Append a short unique suffix to the stored file name to avoid collisions in Storage
            const uniqueCode = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
            const finalName = `${baseName}_${uniqueCode}${ext}`;
            const path = `${projectStorageRoot}/clients/${clientId}/cuotas/${cuotaIndex}/${fileType}/${finalName}`;
            const sRef = storageRef(storage, path);
            // upload as bytes
            const snapshot = await uploadBytes(sRef, file);
            const url = await getDownloadURL(snapshot.ref);
            uploadedItems.push({ url, name: originalName, path: snapshot.ref.fullPath });
          } catch (err) {
            console.error('Error subiendo archivo:', err);
            toast.error('Error subiendo uno o más archivos');
          }
        }

        if (uploadedItems.length > 0) {
          // Concatenar con existentes si las hay. Normalize existing entries to objects of {url,name?}
          const client = clients.find(c => c.id === clientId);
          const existingRaw = client?.cuotas ? client.cuotas[cuotaIndex]?.[fileType] : undefined;
          const existing = normalizeAttachments(existingRaw);
          const merged = [...existing, ...uploadedItems];
          try {
            await updateCuota(clientId, cuotaIndex, { [fileType]: merged });
            toast.success(`${uploadedItems.length} ${fileType === 'voucher' ? 'voucher(s)' : 'boleta(s)'} subido(s) exitosamente`);
          } catch (error) {
            console.error(error);
            await Promise.all(uploadedItems.map(item => deleteObject(storageRef(storage, item.path || '')).catch(() => undefined)));
            toast.error('No se pudieron asociar los archivos a la cuota');
          }
        }
      }
    };
    input.click();
  };

  const downloadAllFiles = (files: Cuota['voucher'], filenamePrefix: string) => {
    if (!files) return;
    // Normalize to array of objects {url, name?} or strings
    const arrRaw = Array.isArray(files) ? files : [files];
    const arr = arrRaw.map(item => (typeof item === 'string' ? { url: item as string } : item)) as Array<{ url: string; name?: string }>;
    // Create a zip-like multiple download by triggering each file download sequentially
    // For cross-origin URLs (Firebase Storage) the `download` attribute may be ignored.
    // Fetch each file as a blob (CORS must allow GET), then create an object URL and force download.
    (async () => {
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i] as { url: string; name?: string };
        try {
          const res = await fetch(item.url, { mode: 'cors' });
          if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
          const blob = await res.blob();
          // determine download filename: prefer original name if present
          let downloadName = item.name;
          // try to infer extension from content-type or url when name missing
          if (!downloadName) {
            const contentType = blob.type || '';
            let ext = '';
            if (contentType) {
              const parts = contentType.split('/');
              if (parts.length === 2) ext = '.' + parts[1].split('+')[0];
            }
            if (!ext) {
              const m = (item.url).match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
              if (m) ext = '.' + m[1];
            }
            downloadName = `${filenamePrefix}_${i}${ext}`;
          }

          const objUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = objUrl;
          a.download = downloadName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(objUrl);
        } catch (err) {
          console.error('Error downloading file', err);
          // Fallback: abrir en nueva pestaña para que el usuario pueda guardar manualmente
          try {
            const item = arr[i] as { url: string; name?: string };
            const a = document.createElement('a');
            a.href = item.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            document.body.appendChild(a);
            a.click();
            a.remove();
            toast('No se pudo forzar la descarga por CORS; se ha abierto el archivo en una nueva pestaña. Use "Guardar como" para descargar.');
          } catch (e) {
            toast.error('Error al descargar uno o más archivos. Revise la consola.');
          }
        }
      }
    })();
  };

  const openAllFiles = (files: Cuota['voucher']) => {
    if (!files) return;
    const arr = normalizeAttachments(files);
    arr.forEach(item => {
      try {
        if (item && item.url) window.open(item.url, '_blank');
      } catch (e) {
        console.error('openAllFiles error opening file', e);
      }
    });
  };

  const openAttachmentManager = (
    client: Client,
    cuotaIndex: number,
    fileType: AttachmentType,
  ) => {
    const files = normalizeAttachments(client.cuotas?.[cuotaIndex]?.[fileType]);
    if (files.length === 0) return;

    setAttachmentManager({
      clientId: client.id,
      clientName: getClientDisplayName(client),
      cuotaIndex,
      cuotaNumber: client.cuotas?.[cuotaIndex]?.numero ?? cuotaIndex + 1,
      fileType,
      files,
    });
  };

  const requestAttachmentDelete = (attachment: StoredAttachment) => {
    if (!attachmentManager) return;
    setAttachmentToDelete({ ...attachmentManager, attachment });
  };

  const handleDeleteAttachment = async () => {
    if (!attachmentToDelete) return;

    setDeletingAttachment(true);
    try {
      const client = clients.find(item => item.id === attachmentToDelete.clientId) as Client | undefined;
      if (!client?.cuotas?.[attachmentToDelete.cuotaIndex]) {
        throw new Error('No se encontró la cuota asociada al archivo');
      }

      const cuota = client.cuotas[attachmentToDelete.cuotaIndex];
      const currentFiles = normalizeAttachments(cuota[attachmentToDelete.fileType]);
      const fileIndex = currentFiles.findIndex(file => (
        file.path === attachmentToDelete.attachment.path
        || file.url === attachmentToDelete.attachment.url
      ));

      if (fileIndex < 0) throw new Error('El archivo ya no está asociado a esta cuota');

      const remainingFiles = [...currentFiles];
      remainingFiles.splice(fileIndex, 1);
      await updateCuota(client.id, attachmentToDelete.cuotaIndex, { [attachmentToDelete.fileType]: remainingFiles });

      let storageCleanupWarning = false;
      try {
        const attachmentRef = storageRef(
          storage,
          attachmentToDelete.attachment.path || attachmentToDelete.attachment.url,
        );
        const expectedPrefix = `${projectStorageRoot}/clients/${client.id}/cuotas/${attachmentToDelete.cuotaIndex}/${attachmentToDelete.fileType}/`;

        if (attachmentRef.fullPath.startsWith(expectedPrefix)) {
          await deleteObject(attachmentRef);
        } else {
          storageCleanupWarning = true;
          console.warn('Se omitió el borrado físico de un adjunto con una ruta no reconocida:', attachmentRef.fullPath);
        }
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code)
          : '';
        if (code !== 'storage/object-not-found') {
          storageCleanupWarning = true;
          console.error('No se pudo borrar el adjunto de Storage:', error);
        }
      }

      setAttachmentManager(current => {
        if (!current) return null;
        if (remainingFiles.length === 0) return null;
        return { ...current, files: remainingFiles };
      });
      setAttachmentToDelete(null);

      if (storageCleanupWarning) {
        toast.warning('El adjunto se quitó de la cuota, pero el archivo antiguo no pudo eliminarse del almacenamiento');
      } else {
        toast.success(`${attachmentToDelete.fileType === 'voucher' ? 'Voucher' : 'Boleta'} eliminado correctamente`);
      }
    } catch (error) {
      console.error('Error eliminando el adjunto:', error);
      toast.error(`No se pudo eliminar ${attachmentToDelete.fileType === 'voucher' ? 'el voucher' : 'la boleta'}`);
    } finally {
      setDeletingAttachment(false);
    }
  };

  const formatDate = (dateString: string) => {
    const d = parseLocalDate(dateString);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const getEffectiveMora = (cuota: Cuota): number => {
    if (cuota.numero === 0) return 0;
    if (cuota.estado === 'pagado' && typeof cuota.mora === 'number') return cuota.mora;
    if (cuota.manualMora === true && typeof cuota.mora === 'number') return cuota.mora;
    return calculateMora(cuota.vencimiento, cuota.monto);
  };

  // Prepare month/year options for the overdue filter
  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre'];
  const yearsSet = new Set<number>();
  clients.forEach(c => c.cuotas?.forEach(q => {
    try { yearsSet.add(parseLocalDate(q.vencimiento).getFullYear()); } catch (e) { /* ignore parse errors */ }
  }));
  const availableYears = Array.from(yearsSet).sort((a, b) => b - a);
  if (availableYears.length === 0) availableYears.push(new Date().getFullYear());

  const resetOverdueFilter = () => {
    setOverdueMonth(null);
    setOverdueYear(new Date().getFullYear());
    setOverdueCountFilter('all');
  };

  const exportToPDF = (client: Client) => {
    (async () => {
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = 210;
      const scheduleSections = getPaymentScheduleSections(client);
      if (scheduleSections.length === 0) {
        toast.error('El cliente no tiene cuotas para exportar');
        return;
      }
      // Try to fetch logo and embed as base64
      const fetchImageAsDataURL = async (url: string) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          const blob = await res.blob();
          return await new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          return null;
        }
      };

      for (let sectionIndex = 0; sectionIndex < scheduleSections.length; sectionIndex += 1) {
        const section = scheduleSections[sectionIndex];
        const scheduleConfig = section.config;
        const sectionCuotas = section.installments;
        if (sectionIndex > 0) doc.addPage();

      let logoData: Array<string | null> = [];
      try {
        logoData = await Promise.all(scheduleConfig.logoUrls.map(fetchImageAsDataURL));
      } catch (err) {
        console.error('Error fetching schedule logos:', err);
        logoData = scheduleConfig.logoUrls.map(() => null);
      }

      // El cronograma de este proyecto usa solamente su propia marca.
      let titleY = 20;
      if (scheduleConfig.logoLayout === 'paired-square') {
        const logoSize = 46;
        const logoTop = 5;
        const logoSideMargin = 5;
        const logoPositions = [
          logoSideMargin,
          pageWidth - logoSideMargin - logoSize
        ];

        logoData.forEach((imageData, index) => {
          if (!imageData) return;
          try {
            doc.addImage(imageData, 'JPEG', logoPositions[index], logoTop, logoSize, logoSize);
          } catch (err) {
            console.error(`Error adding schedule logo ${index + 1} to PDF:`, err);
          }
        });
        titleY = logoTop + logoSize + 6;
      } else if (logoData[0]) {
        try {
          const imgProps = doc.getImageProperties(logoData[0]);
          const imgW = 42;
          const imgH = (imgProps.height * imgW) / imgProps.width;
          doc.addImage(logoData[0], 'JPEG', (pageWidth - imgW) / 2, 6, imgW, imgH);
          titleY = 6 + imgH + 6;
        } catch (err) {
          console.error('Error adding logo to PDF:', err);
          titleY = 20;
        }
      }

      // Title
      doc.setFontSize(16);
      doc.text('CRONOGRAMA DE PAGOS', pageWidth / 2, titleY, { align: 'center' });

      // Contact bar under title
      const contactY = titleY + 6;
      doc.setFontSize(10);
      doc.setFillColor(255, 205, 0);
      doc.rect(20, contactY - 4, pageWidth - 40, 6, 'F');
      doc.setTextColor(0);
      doc.text(`Telefono de cobranza San Bartolomeo Inmobiliaria: ${scheduleConfig.cobranzaPhone}`, 25, contactY);

  // Client info block (left) and bank info block (right)
      const infoStartY = contactY + 8;
      doc.setFontSize(10);
      const leftX = 20;
      const rightX = pageWidth - 110;

  // Left column: client details (separate fields). Right column will show DNIs on same vertical start.
    const infoLineHeight = 6;
    let yInfo = infoStartY;
  const clientTitulares = getClientTitulares(client);
  clientTitulares.forEach((titular, index) => {
    doc.text(`Nombre ${index + 1}: ${titular.nombre}`, leftX, yInfo);
    yInfo += infoLineHeight;
  });
  doc.text(`Celular: ${client.celular1 || ''}`, leftX, yInfo); yInfo += infoLineHeight;
  if (client.celular2) { doc.text(`Celular: ${client.celular2}`, leftX, yInfo); yInfo += infoLineHeight; }
  doc.text(`Gmail: ${client.email1 || ''}`, leftX, yInfo); yInfo += infoLineHeight;
  if (client.email2) { doc.text(`Gmail: ${client.email2}`, leftX, yInfo); yInfo += infoLineHeight; }
    doc.text(`Precio total: S/ ${client.montoTotal.toFixed(2)}`, leftX, yInfo); yInfo += infoLineHeight;
    doc.text(`Moneda: SOLES`, leftX, yInfo); yInfo += infoLineHeight;
    doc.text(`Proyecto: ${scheduleConfig.projectName}`, leftX, yInfo); yInfo += infoLineHeight;
    if (client.bloque) { doc.text(`Bloque: ${client.bloque}`, leftX, yInfo); yInfo += infoLineHeight; }
    doc.text(`Manzana: ${client.manzana}`, leftX, yInfo); yInfo += infoLineHeight;
    doc.text(`Lote: ${client.lote}`, leftX, yInfo); yInfo += infoLineHeight;
    doc.text(`Metraje: ${client.metraje} m2`, leftX, yInfo); yInfo += infoLineHeight;

  // Right column: DNIs aligned at top next to their titular.
  const dniX = rightX + 30;
  let yDni = infoStartY;
  clientTitulares.forEach((titular, index) => {
    doc.text(`DNI ${index + 1}: ${titular.dni}`, dniX, yDni);
    yDni += infoLineHeight;
  });

    // Right column: bank info box (reordered and sized to its content)
  const bankY = infoStartY + (infoLineHeight * Math.max(4, clientTitulares.length)) + 2;
    doc.setFontSize(9);
    doc.setTextColor(0);
    const bankLines = scheduleConfig.bankLines;
    // measure text width and height to draw a tight green box
    let maxBankTextWidth = 0;
    bankLines.forEach(l => {
      try {
        const w = doc.getTextWidth(l);
        if (w > maxBankTextWidth) maxBankTextWidth = w;
      } catch (e) {
        // fallback width
        if (l.length * 2 > maxBankTextWidth) maxBankTextWidth = l.length * 2;
      }
    });
    const bankPad = 4;
  const boxWidth = maxBankTextWidth + bankPad * 2;
    const boxHeight = (bankLines.length * infoLineHeight) + bankPad * 2;
  let boxX = rightX + 8; // move box a bit to the right
    // ensure the box doesn't overflow the right margin
    if (boxX + boxWidth > pageWidth - 10) boxX = pageWidth - 10 - boxWidth;
    doc.setFillColor(200, 230, 201);
    doc.rect(boxX, bankY - 2, boxWidth, boxHeight, 'F');
    // draw bank lines inside box
    let yBank = bankY + bankPad;
    bankLines.forEach((line, index) => {
      doc.setFont(undefined, index === bankLines.length - 1 ? 'bold' : 'normal');
      doc.text(line, boxX + bankPad, yBank);
      yBank += infoLineHeight;
    });
    doc.setFont(undefined, 'normal');

  // Table header start Y (leave ample space so nothing se solape)
  const tableStartY = Math.max(bankY + boxHeight + 12, yInfo + 8);

      // Prepare table rows, computing mora (manual or calculated) and total per row
      const rows = sectionCuotas.map((cuota) => {
        const moraDisplayed = getEffectiveMora(cuota);
        const totalForRow = cuota.monto + moraDisplayed;
        return [
          cuota.numero === 0 ? 'Inicial' : String(cuota.numero),
          formatDate(cuota.vencimiento),
          cuota.monto.toFixed(2),
          moraDisplayed.toFixed(2),
          totalForRow.toFixed(2),
          cuota.fechaPago ? formatDate(cuota.fechaPago) : '',
          cuota.estado,
          Array.isArray(cuota.voucher) ? String(cuota.voucher.length) : (cuota.voucher ? '1' : ''),
          Array.isArray(cuota.boleta) ? String(cuota.boleta.length) : (cuota.boleta ? '1' : '')
        ];
      });

      // Use the ESM autoTable function and read the final position from jsPDF.
      let tableEndY = tableStartY;
      try {
        autoTable(doc, {
          startY: tableStartY,
          margin: { left: 20, right: 20 },
          head: [['N°','vencimiento','Monto','Mora','Total','Fecha de Pago','Estado','Vouchers','Boletas']],
          body: rows,
          theme: 'grid',
          styles: { fontSize: 9, cellPadding: 3 },
          headStyles: { fillColor: [0,102,204], textColor: 255 },
          alternateRowStyles: { fillColor: [245,245,245] },
          columnStyles: {
            1: { cellWidth: 26 },
            2: { cellWidth: 18 },
            5: { cellWidth: 24 },
            6: { cellWidth: 20 },
            7: { cellWidth: 18 },
            8: { cellWidth: 14 }
          }
        });
        tableEndY = (doc.lastAutoTable?.finalY ?? tableStartY) + 6;
      } catch (err) {
        console.error('autoTable error', err);
        // If something else fails, at least dump rows safely
        let y = tableStartY;
        doc.setFontSize(9);
        rows.forEach(r => {
          const line = r.join(' | ');
          const parts = doc.splitTextToSize(line, pageWidth - 40);
          doc.text(parts, 20, y);
          y += (parts.length * 6) + 2;
          if (y > 270) { doc.addPage(); y = 20; }
        });
        tableEndY = y + 4;
      }
      // Footer: totals and note, placed right after the table (tableEndY)
      try {
  let footerY = tableEndY;
        // If footer would overflow page, add a new page
        const pageH = doc.internal.pageSize.getHeight();
        if (footerY + 30 > pageH - 10) {
          doc.addPage();
          footerY = 20;
        }
        doc.setFontSize(10);
        // Compute totals using the same displayed values shown in the modal table:
        // displayedMora = cuota.numero === 0 ? 0 : (manualMora ? cuota.mora : calculateMora(...))
        // totalDisplayed = cuota.monto + displayedMora
        const totalPagado = sectionCuotas.reduce((acc, c) => {
          const moraDisplayed = getEffectiveMora(c);
          const totalDisplayed = (c.monto || 0) + moraDisplayed;
          return acc + ((c.estado === 'pagado') ? totalDisplayed : 0);
        }, 0);
        const totalPendiente = sectionCuotas.reduce((acc, c) => {
          const moraDisplayed = getEffectiveMora(c);
          const totalDisplayed = (c.monto || 0) + moraDisplayed;
          return acc + ((c.estado !== 'pagado') ? totalDisplayed : 0);
        }, 0);
        doc.text(`Importe total pagado S/ ${totalPagado.toFixed(2)}`, 20, footerY);
        doc.text(`Importe pendiente S/ ${totalPendiente.toFixed(2)}`, 20, footerY + 6);
        // small green strip below totals
        // Draw totals
        doc.setFillColor(220, 240, 220);
        // NOTE: draw the green box exactly around the note text (with padding)
        const noteText = `NOTA: UNA VEZ CANCELADO LA CUOTA MENSUAL, ENVIAR FOTO DEL VOUCHER AL NUMERO DE COBRANZA: ${scheduleConfig.cobranzaPhone}`;
        const noteFontSize = 8; // smaller font to ensure fit
        doc.setFontSize(noteFontSize);
        // split note into lines that fit inside the content width
        const contentWidth = pageWidth - 30; // left/right padding
        const noteLines = doc.splitTextToSize(noteText, contentWidth);
        const lineHeight = 4.2; // approximate mm per line at this font size
        const boxPadding = 3;
        const boxHeight = (noteLines.length * lineHeight) + (boxPadding * 2);
        const boxX = 15;
        const boxY = footerY + 10;
        doc.setFillColor(220, 240, 220);
        doc.rect(boxX, boxY, contentWidth + (boxPadding * 2) - 2, boxHeight, 'F');
        doc.setTextColor(0);
        // draw note lines inside the box with a small left padding
        let currentY = boxY + boxPadding + lineHeight;
        noteLines.forEach(line => {
          doc.text(line, boxX + boxPadding, currentY);
          currentY += lineHeight;
        });
      } catch (err) {
        console.error('PDF footer error', err);
      }
      }

      try {
        doc.save(`cronograma_${client.nombre1}_${client.dni1}.pdf`);
        toast.success('PDF descargado exitosamente');
      } catch (err) {
        console.error('Error saving PDF', err);
        toast.error('Error al generar el PDF. Revise la consola para más detalles.');
      }
    })();
  };

  const exportToExcel = (client: Client) => {
    (async () => {
      const scheduleSections = getPaymentScheduleSections(client);
      if (scheduleSections.length === 0) {
        toast.error('El cliente no tiene cuotas para exportar');
        return;
      }

      // Try to fetch logo as base64 to embed in the HTML
      const fetchImageAsDataURL = async (url: string) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          const blob = await res.blob();
          return await new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          return null;
        }
      };

      const sectionHtmlBlocks: string[] = [];

      for (let sectionIndex = 0; sectionIndex < scheduleSections.length; sectionIndex += 1) {
        const section = scheduleSections[sectionIndex];
        const scheduleConfig = section.config;
        const sectionCuotas = section.installments;
        const logoData = await Promise.all(scheduleConfig.logoUrls.map(fetchImageAsDataURL));

        let headerHtml = '<div style="text-align:center;">';
        if (scheduleConfig.logoLayout === 'paired-square') {
          const leftLogo = logoData[0]
            ? `<img src="${logoData[0]}" width="174" height="174" style="display:block;"/>`
            : '';
          const rightLogo = logoData[1]
            ? `<img src="${logoData[1]}" width="174" height="174" style="display:block;margin-left:auto;"/>`
            : '';
          headerHtml += `<table role="presentation" style="width:100%;border-collapse:collapse;"><tr>
            <td width="50%" align="left" style="padding-left:19px;">${leftLogo}</td>
            <td width="50%" align="right" style="padding-right:19px;">${rightLogo}</td>
          </tr></table>`;
        } else if (logoData[0]) {
          headerHtml += `<img src="${logoData[0]}" style="display:block;width:160px;height:160px;object-fit:contain;margin:0 auto;"/>`;
        }
        headerHtml += '<h2>CRONOGRAMA DE PAGOS</h2>';
        headerHtml += `<div style="background:#ffd700;padding:4px;margin-bottom:6px;">Telefono de cobranza San Bartolomeo Inmobiliaria: ${scheduleConfig.cobranzaPhone}</div>`;
        headerHtml += '</div>';

        let infoHtml = '<table style="width:100%;border-collapse:collapse;margin-bottom:8px;"><tr>';
        infoHtml += '<td style="vertical-align:top;width:60%;"><table style="width:100%;">';
        getClientTitulares(client).forEach((titular, index) => {
          infoHtml += `<tr><td><strong>Nombre ${index + 1}</strong></td><td>${titular.nombre}</td></tr>`;
          infoHtml += `<tr><td><strong>DNI ${index + 1}</strong></td><td>${titular.dni}</td></tr>`;
        });
        infoHtml += `<tr><td><strong>Celular 1</strong></td><td>${client.celular1 || ''}</td></tr>`;
        if (client.celular2) infoHtml += `<tr><td><strong>Celular 2</strong></td><td>${client.celular2}</td></tr>`;
        infoHtml += `<tr><td><strong>Correo 1</strong></td><td>${client.email1 || ''}</td></tr>`;
        if (client.email2) infoHtml += `<tr><td><strong>Correo 2</strong></td><td>${client.email2}</td></tr>`;
        infoHtml += `<tr><td><strong>Precio total</strong></td><td>S/ ${client.montoTotal.toFixed(2)}</td></tr>`;
        infoHtml += '<tr><td><strong>Moneda</strong></td><td>SOLES</td></tr>';
        infoHtml += `<tr><td><strong>Proyecto</strong></td><td>${scheduleConfig.projectName}</td></tr>`;
        if (client.bloque) infoHtml += `<tr><td><strong>Bloque</strong></td><td>${client.bloque}</td></tr>`;
        infoHtml += `<tr><td><strong>Manzana</strong></td><td>${client.manzana}</td></tr>`;
        infoHtml += `<tr><td><strong>Lote</strong></td><td>${client.lote}</td></tr>`;
        infoHtml += `<tr><td><strong>Metraje</strong></td><td>${client.metraje} m2</td></tr>`;
        infoHtml += '</table></td>';

        const bankHtml = scheduleConfig.logoLayout === 'legacy-wide'
          ? `<div style="font-size:12px;font-weight:600;">${scheduleConfig.bankLines[0]}</div>
            <div>${scheduleConfig.bankLines[1]}</div>
            <div>${scheduleConfig.bankLines[2]}</div>
            <div style="margin-top:6px;font-weight:bold;">${scheduleConfig.bankLines[3]}</div>`
          : scheduleConfig.bankLines.map((line, index) => (
            `<div style="${index === scheduleConfig.bankLines.length - 1 ? 'margin-top:6px;font-weight:bold;' : ''}">${line}</div>`
          )).join('');
        infoHtml += `<td style="vertical-align:top;padding:8px;">
          <div style="display:inline-block;background:#c8e6c9;padding:8px;border-radius:2px;">${bankHtml}</div>
        </td></tr></table>`;

        let tableHtml = '<table border="1" style="width:100%;border-collapse:collapse;border:1px solid #0066cc;">';
        tableHtml += '<tr style="background:#0066cc;color:#fff;">'
          + '<th style="width:6%;">N°</th>'
          + '<th style="width:12%;">vencimiento</th>'
          + '<th style="width:10%;">Monto</th>'
          + '<th style="width:8%;">Mora</th>'
          + '<th style="width:12%;">Total</th>'
          + '<th style="width:12%;">Fecha Pago</th>'
          + '<th style="width:18%;">Estado</th>'
          + '<th style="width:12%;">Vouchers</th>'
          + '<th style="width:10%;">Boletas</th>'
          + '</tr>';
        sectionCuotas.forEach(cuota => {
          const vouchersCount = Array.isArray(cuota.voucher) ? cuota.voucher.length : (cuota.voucher ? 1 : 0);
          const boletasCount = Array.isArray(cuota.boleta) ? cuota.boleta.length : (cuota.boleta ? 1 : 0);
          const moraDisplayed = getEffectiveMora(cuota);
          const totalDisplayed = cuota.monto + moraDisplayed;
          tableHtml += `<tr>
            <td>${cuota.numero === 0 ? 'Inicial' : cuota.numero}</td>
            <td>${formatDate(cuota.vencimiento)}</td>
            <td>S/ ${cuota.monto.toFixed(2)}</td>
            <td>S/ ${moraDisplayed.toFixed(2)}</td>
            <td>S/ ${totalDisplayed.toFixed(2)}</td>
            <td>${cuota.fechaPago ? formatDate(cuota.fechaPago) : ''}</td>
            <td>${cuota.estado}</td>
            <td>${vouchersCount > 0 ? vouchersCount + ' voucher(s)' : ''}</td>
            <td>${boletasCount > 0 ? boletasCount + ' boleta(s)' : ''}</td>
          </tr>`;
        });
        tableHtml += '</table>';

        const totalPagado = sectionCuotas.reduce((acc, cuota) => {
          const totalDisplayed = cuota.monto + getEffectiveMora(cuota);
          return acc + (cuota.estado === 'pagado' ? totalDisplayed : 0);
        }, 0);
        const totalPendiente = sectionCuotas.reduce((acc, cuota) => {
          const totalDisplayed = cuota.monto + getEffectiveMora(cuota);
          return acc + (cuota.estado !== 'pagado' ? totalDisplayed : 0);
        }, 0);
        const footerHtml = `
          <div style="margin-top:8px;">
            <div>Importe total pagado S/ ${totalPagado.toFixed(2)}</div>
            <div>Importe pendiente S/ ${totalPendiente.toFixed(2)}</div>
          </div>
          <div style="margin-top:6px;">
            <div style="display:inline-block;background:#c8e6c9;padding:6px;font-size:11px;">
              NOTA: UNA VEZ CANCELADO LA CUOTA MENSUAL, ENVIAR FOTO DEL VOUCHER AL NUMERO DE COBRANZA: ${scheduleConfig.cobranzaPhone}
            </div>
          </div>`;
        const breakStyle = sectionIndex > 0 ? 'page-break-before:always;' : '';
        sectionHtmlBlocks.push(`<section style="${breakStyle}">${headerHtml}${infoHtml}${tableHtml}${footerHtml}</section>`);
      }

      const fullHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body>${sectionHtmlBlocks.join('')}</body></html>`;

      const blob = new Blob([fullHtml], { type: 'application/vnd.ms-excel' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cronograma_${client.nombre1}_${client.dni1}.xls`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Excel descargado exitosamente');
    })();
  };

  const getClientPaymentTotals = (client: Client) => {
    // Los registros importados solo cuentan como pagados cuando se registra el pago.
    if (client.formaPago === 'contado' && !client.importReview) {
      return {
        totalPagado: Number(client.montoTotal || 0),
        totalPendiente: 0
      };
    }

    return (client.cuotas || []).reduce((totals, cuota) => {
      const mora = getEffectiveMora(cuota);
      const importe = Number(cuota.monto || 0) + Number(mora || 0);

      if (cuota.estado === 'pagado') {
        totals.totalPagado += importe;
      } else {
        totals.totalPendiente += importe;
      }

      return totals;
    }, { totalPagado: 0, totalPendiente: 0 });
  };

  const exportClientsToPDF = () => {
    if (filteredClients.length === 0) {
      toast.error('No hay clientes para descargar.');
      return;
    }

    try {
      if (filterType === 'overdue') {
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const generatedAt = new Date().toLocaleString('es-PE');
        const money = (value: number) => `S/ ${Number(value || 0).toFixed(2)}`;
        const monthFilterLabel = overdueMonth === null
          ? 'Todos los meses'
          : `${monthNames[overdueMonth]} ${overdueYear}`;
        const countFilterLabel = overdueCountFilter === 'all'
          ? 'Todas las cantidades'
          : `${overdueCountFilter} cuota${overdueCountFilter === '1' ? '' : 's'} atrasada${overdueCountFilter === '1' ? '' : 's'}`;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(17);
        doc.setTextColor(21, 40, 77);
        doc.text('REPORTE DE CLIENTES CON CUOTAS ATRASADAS', 10, 15);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(95, 104, 120);
        doc.text(`Generado: ${generatedAt} | Clientes: ${filteredClients.length}`, 10, 22);
        doc.text(`Filtros aplicados: ${monthFilterLabel} | ${countFilterLabel}`, 10, 27);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(13, 111, 120);
        doc.text('CLIENTES, LOTES Y ESTADO DE PAGOS', 10, 35);

        autoTable(doc, {
          startY: 39,
          head: [[
            'ID', 'Nombres', 'DNIs', 'Celulares', 'Emails', 'Manzana', 'Lote', 'Metraje',
            'Precio de lote', 'Forma de pago', 'Inicial', 'Cuotas', 'Cuotas atrasadas', 'Debe'
          ]],
          body: filteredClients.map((client, index) => [
            index + 1,
            getClientDisplayName(client),
            getClientDisplayDnis(client),
            [client.celular1, client.celular2].filter(Boolean).join(' / ') || '-',
            [client.email1, client.email2].filter(Boolean).join(' / ') || '-',
            client.manzana,
            client.lote,
            `${Number(client.metraje || 0).toFixed(2)} m2`,
            money(client.montoTotal),
            client.formaPago,
            client.inicial ? money(client.inicial) : '-',
            client.numeroCuotas || '-',
            getOverdueInstallmentCount(client),
            getClientStatus(client)
          ]),
          theme: 'grid',
          styles: { fontSize: 5.8, cellPadding: 1, overflow: 'linebreak', valign: 'middle' },
          headStyles: { fillColor: [13, 111, 120], textColor: 255, fontStyle: 'bold', halign: 'center', fontSize: 5.8 },
          alternateRowStyles: { fillColor: [240, 250, 247] },
          columnStyles: {
            0: { cellWidth: 7, halign: 'center' },
            1: { cellWidth: 32 },
            2: { cellWidth: 22 },
            3: { cellWidth: 20 },
            4: { cellWidth: 34 },
            5: { cellWidth: 12, halign: 'center' },
            6: { cellWidth: 10, halign: 'center' },
            7: { cellWidth: 15, halign: 'center' },
            8: { cellWidth: 20, halign: 'right' },
            9: { cellWidth: 18, halign: 'center' },
            10: { cellWidth: 20, halign: 'right' },
            11: { cellWidth: 13, halign: 'center' },
            12: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
            13: { cellWidth: 16, halign: 'center', fontStyle: 'bold' }
          },
          margin: { top: 14, right: 10, bottom: 15, left: 10 },
          rowPageBreak: 'avoid'
        });

        const pageHeight = doc.internal.pageSize.getHeight();
        const totalOverdueInstallments = filteredClients.reduce(
          (total, client) => total + getOverdueInstallmentCount(client),
          0
        );
        let summaryY = (doc.lastAutoTable?.finalY || 39) + 8;
        if (summaryY > pageHeight - 22) {
          doc.addPage();
          summaryY = 20;
        }
        doc.setFillColor(255, 247, 237);
        doc.setDrawColor(253, 186, 116);
        doc.roundedRect(10, summaryY, 110, 12, 2, 2, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(154, 52, 18);
        doc.text(
          `Total: ${filteredClients.length} cliente${filteredClients.length === 1 ? '' : 's'} | ${totalOverdueInstallments} cuota${totalOverdueInstallments === 1 ? '' : 's'} atrasada${totalOverdueInstallments === 1 ? '' : 's'}`,
          15,
          summaryY + 7.5
        );

        const totalPages = doc.getNumberOfPages();
        for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
          doc.setPage(pageNumber);
          const pageWidth = doc.internal.pageSize.getWidth();
          const currentPageHeight = doc.internal.pageSize.getHeight();
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);
          doc.setTextColor(105, 115, 130);
          doc.text('San Bartolomeo Inmobiliaria', 10, currentPageHeight - 6);
          doc.text(`Pagina ${pageNumber} de ${totalPages}`, pageWidth - 10, currentPageHeight - 6, { align: 'right' });
        }

        doc.save(`reporte_atrasados_${new Date().toISOString().slice(0, 10)}.pdf`);
        toast.success('Reporte de atrasados descargado en PDF.');
        return;
      }

      // Generar directamente en A4 horizontal para evitar que la impresora reduzca un A3.
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const generatedAt = new Date().toLocaleString('es-PE');
      const money = (value: number) => `S/ ${Number(value || 0).toFixed(2)}`;

      const financedClients = filteredClients.filter(client => client.formaPago === 'cuotas');
      const cashClients = filteredClients.filter(client => client.formaPago === 'contado');

      const calculateGroupTotals = (group: Client[]) => group.reduce((acc, client) => {
        if (needsFinancialReview(client)) return acc;
        const paymentTotals = getClientPaymentTotals(client);
        acc.montoTotal += Number(client.montoTotal || 0);
        acc.pagado += paymentTotals.totalPagado;
        acc.pendiente += paymentTotals.totalPendiente;
        return acc;
      }, { montoTotal: 0, pagado: 0, pendiente: 0 });

      const totals = calculateGroupTotals(filteredClients);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(30, 64, 175);
      doc.text('REPORTE GENERAL DE CLIENTES', 14, 16);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(80);
      doc.text(`Generado: ${generatedAt} | Total de clientes: ${filteredClients.length}`, 14, 23);

      const renderClientGroup = (
        title: string,
        group: Client[],
        color: [number, number, number],
        addPage: boolean
      ) => {
        if (addPage) doc.addPage();

        const startY = addPage ? 18 : 34;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(...color);
        doc.text(`${title} (${group.length})`, 10, startY - 5);

        const rows = group.map((client, index) => {
          const paymentTotals = getClientPaymentTotals(client);
          return [
            index + 1,
            getClientDisplayName(client),
            getClientDisplayDnis(client),
            [client.celular1, client.celular2].filter(Boolean).join(' / ') || '-',
            [client.email1, client.email2].filter(Boolean).join(' / ') || '-',
            client.manzana,
            client.lote,
            `${Number(client.metraje || 0).toFixed(2)} m2`,
            client.montoTotal > 0 ? money(client.montoTotal) : 'Por completar',
            client.numeroCuotas || 'Por completar',
            needsFinancialReview(client) ? 'Por revisar' : money(paymentTotals.totalPagado),
            needsFinancialReview(client) ? 'Por revisar' : money(paymentTotals.totalPendiente)
          ];
        });

        autoTable(doc, {
          startY,
          head: [[
            'N°', 'Nombres', 'DNIs', 'Celulares', 'Emails', 'Mz.', 'Lote', 'Metraje',
            'Monto total', 'Cuotas', 'Total pagado (incl. inicial)', 'Monto pendiente'
          ]],
          body: rows,
          theme: 'grid',
          styles: { fontSize: 6.5, cellPadding: 1.4, overflow: 'linebreak', valign: 'middle' },
          headStyles: { fillColor: color, textColor: 255, fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [241, 245, 249] },
          margin: { top: 14, right: 10, bottom: 16, left: 10 },
          didDrawPage: () => {
          const pageNumber = doc.getNumberOfPages();
          const pageWidth = doc.internal.pageSize.getWidth();
          const pageHeight = doc.internal.pageSize.getHeight();
          doc.setFontSize(7);
          doc.setTextColor(100);
          doc.text(`Página ${pageNumber}`, pageWidth - 10, pageHeight - 7, { align: 'right' });
          }
        });

        const groupTotals = calculateGroupTotals(group);
        autoTable(doc, {
          startY: (doc.lastAutoTable?.finalY || startY) + 5,
          body: [[
            `Subtotal ${title}`,
            `${group.length} clientes`,
            `Contratos: ${money(groupTotals.montoTotal)}`,
            `Pagado: ${money(groupTotals.pagado)}`,
            `Pendiente: ${money(groupTotals.pendiente)}`
          ]],
          theme: 'grid',
          styles: { fontSize: 8, cellPadding: 2, fontStyle: 'bold' },
          bodyStyles: { fillColor: [248, 250, 252], textColor: color },
          margin: { left: 10, right: 10, bottom: 16 }
        });
      };

      if (financedClients.length > 0) {
        renderClientGroup('CLIENTES FINANCIADOS', financedClients, [30, 64, 175], false);
      }
      if (cashClients.length > 0) {
        renderClientGroup('CLIENTES AL CONTADO', cashClients, [5, 150, 105], financedClients.length > 0);
      }

      doc.addPage();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(22, 101, 52);
      doc.text('RESUMEN GENERAL', 10, 18);

      const summaryRows = [
        ['Total de clientes', String(filteredClients.length)],
        ['Clientes financiados', String(financedClients.length)],
        ['Clientes al contado', String(cashClients.length)],
        ['Valor de contratos con cronograma revisado', money(totals.montoTotal)],
        ['TOTAL PAGADO REGISTRADO (EXCLUYE POR REVISAR)', money(totals.pagado)],
        ['TOTAL PENDIENTE (EXCLUYE POR REVISAR)', money(totals.pendiente)],
        ['Clientes por revisar, excluidos de los importes anteriores', String(filteredClients.filter(needsFinancialReview).length)]
      ];

      autoTable(doc, {
        startY: 24,
        head: [['RESUMEN GENERAL', 'IMPORTE']],
        body: summaryRows,
        theme: 'grid',
        margin: { left: 10, bottom: 16 },
        styles: { fontSize: 9, cellPadding: 2.5 },
        headStyles: { fillColor: [22, 101, 52], textColor: 255, fontStyle: 'bold' },
        columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' } },
        didParseCell: (data: {
          section: string;
          row: { index: number };
          cell: { styles: { fillColor: number[]; fontStyle: string } };
        }) => {
          if (data.section === 'body' && data.row.index >= 4) {
            data.cell.styles.fillColor = data.row.index === 4 ? [220, 252, 231] : [254, 226, 226];
            data.cell.styles.fontStyle = 'bold';
          }
        },
        didDrawPage: () => {
          const pageWidth = doc.internal.pageSize.getWidth();
          const pageHeight = doc.internal.pageSize.getHeight();
          doc.setFontSize(7);
          doc.setTextColor(100);
          doc.text(`Página ${doc.getNumberOfPages()}`, pageWidth - 10, pageHeight - 7, { align: 'right' });
        }
      });

      doc.save(`reporte_clientes_${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success('Reporte de clientes descargado en PDF.');
    } catch (error) {
      console.error('Error generando reporte general de clientes:', error);
      toast.error('No se pudo generar el reporte PDF de clientes.');
    }
  };

  const filteredClients = getFilteredClients();
  const showDebtColumn = filterType === 'pending' || filterType === 'overdue';
  const showStatusColumn = filterType === 'all';
  const showMinuteAction = filterType === 'all';

  return (
    <div className="w-full space-y-6">
      <Card className="overflow-hidden border-[#d9ddd9] bg-[#fffefb] shadow-sm">
        <CardHeader className="flex flex-col gap-4 border-b border-[#e9ebe7] bg-[#fffefb] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#54317f]">San Bartolomeo Inmobiliaria</p>
            <CardTitle className="brand-display text-2xl text-[#312144]">{filteredClients.length} cliente{filteredClients.length === 1 ? '' : 's'}</CardTitle>
            <p className="mt-1 text-sm text-[#697386]">Consulta pagos, documentos y datos de cada registro.</p>
            {filteredClients.some(needsFinancialReview) && <p className="mt-2 text-sm text-amber-900">{filteredClients.filter(needsFinancialReview).length} registros importados por revisar. Usa «Completar» para confirmar el cronograma y registrar sus pagos manualmente.</p>}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={exportClientsToPDF} disabled={filteredClients.length === 0}>
              <Download className="w-4 h-4 mr-2" />
              Descargar clientes PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filterType === 'overdue' && (
            <div className="flex flex-wrap items-center gap-3 border-b border-[#e9ebe7] bg-[#f5f4ef]/70 px-5 py-4 sm:px-6">
              <Label>Mes de atraso:</Label>
              <Select value={overdueMonth === null ? 'all' : String(overdueMonth)} onValueChange={value => setOverdueMonth(value === 'all' ? null : Number(value))}>
                <SelectTrigger aria-label="Mes de atraso" className="h-10 w-[150px] rounded-xl border-[#d9ddd9] bg-white"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">Todos</SelectItem>{monthNames.map((month, index) => <SelectItem key={month} value={String(index)}>{month}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={String(overdueYear)} onValueChange={value => setOverdueYear(Number(value))}>
                <SelectTrigger aria-label="Año de atraso" className="h-10 w-[100px] rounded-xl border-[#d9ddd9] bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{availableYears.map(year => <SelectItem key={year} value={String(year)}>{year}</SelectItem>)}</SelectContent>
              </Select>

              <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-xl border border-[#d9ddd9] bg-white px-3 py-1.5 shadow-sm">
                <Label htmlFor="overdue-count-filter" className="text-sm font-medium text-[#5f6878]">
                  Filtrar por cuotas atrasadas:
                </Label>
                <Select
                  value={overdueCountFilter}
                  onValueChange={(value) => setOverdueCountFilter(value as OverdueCountFilter)}
                >
                  <SelectTrigger id="overdue-count-filter" className="h-9 w-[170px] border-[#d9ddd9] bg-[#fffefb]">
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="1">1 cuota</SelectItem>
                    <SelectItem value="2">2 cuotas</SelectItem>
                    <SelectItem value="3">3 cuotas</SelectItem>
                    <SelectItem value="4">4 cuotas</SelectItem>
                    <SelectItem value="5">5 cuotas</SelectItem>
                    <SelectItem value="6">6 cuotas</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button size="sm" variant="outline" onClick={resetOverdueFilter}>Limpiar</Button>
            </div>
          )}
          <div className="vh-client-table-shell overflow-x-auto rounded-2xl border border-[#d9ddd9] bg-white shadow-sm">
            <div className="flex items-center justify-between gap-4 border-b border-[#e4e7e2] bg-[#fffefb] px-4 py-3">
              <p className="text-xs font-medium text-[#697386]">Desliza la tabla horizontalmente para ver todas las columnas.</p>
            </div>
            <Table
              aria-label={filterType === 'overdue' ? 'Clientes con cuotas atrasadas' : 'Clientes registrados'}
              className="vh-spaced-table vh-client-table min-w-[1380px] table-fixed text-[11px] xl:text-[12px]"
            >
              <TableHeader className="bg-[#f5f4ef]">
                <TableRow>
                  <TableHead className="w-[4%] px-1.5 text-center">ID</TableHead>
                  <TableHead className="w-[13%] px-1.5 text-center">Nombres</TableHead>
                  <TableHead className="w-[8%] px-1.5 text-center">DNIs</TableHead>
                  <TableHead className="w-[10%] px-1.5 text-center">Celulares</TableHead>
                  <TableHead className="w-[12%] px-1.5 text-center">Emails</TableHead>
                  <TableHead className="px-1.5 text-center">Bloque</TableHead>
                  <TableHead className="px-1.5 text-center">Manzana</TableHead>
                  <TableHead className="px-1.5 text-center">Lote</TableHead>
                  <TableHead className="px-1.5 text-center">Metraje</TableHead>
                  <TableHead className="px-1.5 text-center">
                    {filterType === 'overdue' ? 'Precio de lote' : 'Monto Total'}
                  </TableHead>
                  <TableHead className="px-1.5 text-center">Forma Pago</TableHead>
                  <TableHead className="px-1.5 text-center">Inicial</TableHead>
                  <TableHead className="px-1.5 text-center">Cuotas</TableHead>
                  {filterType === 'overdue' && <TableHead className="px-1.5 text-center">Cuotas atrasadas</TableHead>}
                  {showDebtColumn && <TableHead className="px-1.5 text-center">Debe</TableHead>}
                  {showStatusColumn && <TableHead className="px-1.5 text-center">Estado</TableHead>}
                  <TableHead className={`${showMinuteAction ? 'w-[15%]' : 'w-[13%]'} px-1.5 text-center`}>Opciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients.map((client, index) => (
                  <TableRow
                    key={client.id}
                    className="group border-[#e4e7e2] odd:bg-white even:bg-[#fbfcfa] hover:bg-[#f3f7ed]"
                  >
                    <TableCell className="bg-inherit px-1.5 py-3 text-center font-semibold text-[#54317f] group-hover:bg-[#f3f7ed]">{index + 1}</TableCell>
                    <TableCell className="break-words bg-inherit px-1.5 py-3 group-hover:bg-[#f3f7ed]">
                      <div className="mx-auto w-fit max-w-full space-y-1.5 text-left">
                        {getClientTitulares(client).map((titular, titularIndex) => (
                          <div key={`${client.id}-nombre-${titularIndex}`} className="flex items-start gap-2">
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f3eaf9] text-[10px] font-semibold text-[#54317f]">{titularIndex + 1}</span>
                            <span className="font-medium text-[#182033]">{titular.nombre || 'Sin nombre'}</span>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="break-words px-1.5 py-3">
                      <div className="mx-auto w-fit max-w-full space-y-1.5 text-center">
                        {getClientTitulares(client).map((titular, titularIndex) => (
                          <div key={`${client.id}-dni-${titularIndex}`} className="flex min-h-5 items-center justify-center text-[#5f6878]">
                            {titular.dni || 'Sin DNI'}
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="break-words px-1.5 py-3">
                      {editingPhoneClientId === client.id ? (
                        <div className="space-y-2">
                          <Input
                            value={editCelular1}
                            onChange={(e) => setEditCelular1(e.target.value)}
                            placeholder="Celular 1"
                            className="w-full"
                          />
                          <Input
                            value={editCelular2}
                            onChange={(e) => setEditCelular2(e.target.value)}
                            placeholder="Celular 2"
                            className="w-full"
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={savePhoneEdit}>
                              Guardar
                            </Button>
                            <Button size="sm" variant="outline" onClick={cancelPhoneEdit}>
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1.5">
                          <div className="flex flex-col">
                            <span>{client.celular1 || '-'}</span>
                            <span className="text-xs text-slate-500">{client.celular2 || ''}</span>
                          </div>
                          {canEditClients && <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Editar celulares" onClick={() => startPhoneEdit(client)}>
                            <Edit className="w-4 h-4" />
                          </Button>}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="break-words px-1.5 py-3">
                      <div className="flex min-w-0 flex-col items-center">
                        <span>{client.email1 || '-'}</span>
                        <span className="text-xs text-slate-500">{client.email2 || ''}</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-1.5 py-3 text-center">{client.bloque || '—'}</TableCell>
                    <TableCell className="px-1.5 py-3 text-center">{client.manzana}</TableCell>
                    <TableCell className="px-1.5 py-3 text-center">{client.lote}</TableCell>
                    <TableCell className="px-1.5 py-3 text-center">{client.metraje} m²</TableCell>
                    <TableCell className="px-1.5 py-3 text-center font-semibold text-[#312144]">{needsFinancialReview(client) && client.montoTotal <= 0 ? 'Por completar' : `S/ ${client.montoTotal.toFixed(2)}`}</TableCell>
                    <TableCell className="px-1.5 py-3 text-center">
                      <Badge variant={client.formaPago === 'contado' ? 'default' : 'secondary'}>
                        {client.formaPago}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-1.5 py-3 text-center">
                      {client.inicial !== undefined ? `S/ ${client.inicial.toFixed(2)}` : needsFinancialReview(client) ? 'Por completar' : '-'}
                    </TableCell>
                    <TableCell className="px-1.5 py-3 text-center">{client.numeroCuotas || '-'}</TableCell>
                    {filterType === 'overdue' && (
                      <TableCell className="px-1.5 py-3 text-center font-semibold text-rose-700">
                        {getOverdueInstallmentCount(client)}
                      </TableCell>
                    )}
                    {showDebtColumn && (
                      <TableCell className="px-1.5 py-3 text-center">
                        <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 font-semibold text-rose-700">
                          {getClientStatus(client)}
                        </span>
                      </TableCell>
                    )}
                    {showStatusColumn && (
                      <TableCell className="px-1.5 py-3 text-center">
                        <Badge variant="outline">{getClientStatus(client)}</Badge>
                      </TableCell>
                    )}
                    <TableCell className="bg-inherit px-1.5 py-3 group-hover:bg-[#f3f7ed]">
                      <div className="flex flex-wrap items-center justify-center gap-1.5">
                        {showMinuteAction && canLegal && (
                          <MinutaUploadButton
                            clientId={client.id}
                            clientName={getClientDisplayName(client)}
                            onCreate={onCreateMinute}
                          />
                        )}
                        {filterType === 'all' && canEditClients && <NoDebtCertificateButton client={client} />}
                        {filterType === 'overdue' && canLegal && <ResolutionDraftButton client={client} />}
                        {(needsFinancialReview(client) || (client.cuotas && client.cuotas.length > 0)) && (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Ver cuotas de ${getClientDisplayName(client)}`}
                            onClick={() => openClientDetail(client)}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            {needsFinancialReview(client) ? 'Completar' : 'Cuotas'}
                          </Button>
                        )}
                        <div className="flex items-center gap-1.5">
                          {canEditClients && !needsFinancialReview(client) && <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Editar cuotas de ${getClientDisplayName(client)}`}
                            title="Editar cuotas"
                            onClick={() => setEditingCuota({ clientId: client.id, type: 'amount' })}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>}
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Libro de observaciones de ${getClientDisplayName(client)}`}
                            title="Libro de observaciones"
                            onClick={() => openObservations(client)}
                            className={client.observationEntries?.length || client.observaciones?.trim()
                              ? 'border-[#e59a3a]/70 bg-[#fff8e8] text-[#805f1c] hover:bg-[#fff3d5] hover:text-[#805f1c]'
                              : 'text-[#312144]'}
                          >
                            <BookOpen className="w-4 h-4" />
                          </Button>
                          {user?.role === 'admin' && <Button
                            size="sm"
                            variant="destructive"
                            aria-label={`Eliminar a ${getClientDisplayName(client)}`}
                            title="Eliminar cliente"
                            onClick={() => void handleDeleteClient(client.id)}
                            disabled={deletingClientId !== null}
                          >
                            {deletingClientId === client.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </Button>}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={observationsClient !== null} onOpenChange={open => {
        if (!open) closeObservations();
      }}>
        <DialogContent className="w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border-[#d9ddd9] bg-[#fffefb] p-0 sm:max-w-xl">
          <DialogHeader className="border-b border-[#e9ebe7] bg-[#f5f4ef]/80 px-6 py-5 text-left">
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-[#f3eaf9] text-[#54317f]">
              <BookOpen className="h-5 w-5" />
            </div>
            <DialogTitle className="text-xl text-[#312144]">Libro de observaciones</DialogTitle>
            <DialogDescription className="leading-6 text-[#697386]">
              {observationsClient ? getClientDisplayName(observationsClient) : ''}. Cada anotación conserva autor y fecha.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[65vh] space-y-4 overflow-y-auto px-6 py-5">
            <div className="space-y-2" aria-label="Anotaciones anteriores">
              {observationsClient?.observaciones?.trim() && <div className="rounded-xl border border-[#d9ddd9] bg-[#f7f8f6] p-3 text-sm">
                <p className="font-semibold text-[#312144]">Nota anterior</p>
                <p className="mt-1 whitespace-pre-wrap text-[#5f6878]">{observationsClient.observaciones}</p>
              </div>}
              {observationsClient?.observationEntries?.slice().reverse().map(entry => <div key={entry.id} className="rounded-xl border border-[#d9ddd9] bg-white p-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2 font-semibold text-[#312144]">
                  <span>{entry.author}</span><time>{new Date(entry.at).toLocaleString('es-PE')}</time>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-[#5f6878]">{entry.text}</p>
              </div>)}
              {!observationsClient?.observaciones?.trim() && !observationsClient?.observationEntries?.length && <p className="text-sm text-[#697386]">Aún no hay anotaciones para este cliente.</p>}
            </div>
            {canEditClients && <>
            <Label htmlFor="client-observations" className="text-[#312144]">Nueva anotación</Label>
            <Textarea
              id="client-observations"
              value={observationDraft}
              onChange={event => setObservationDraft(event.target.value)}
              maxLength={2000}
              rows={8}
              placeholder="Escribe un acuerdo o seguimiento…"
              className="min-h-44 resize-y rounded-xl bg-white leading-6 focus-visible:border-[#6b4492]"
              disabled={savingObservation}
              autoFocus
            />
            <p className="text-right text-xs text-[#697386]" aria-live="polite">
              {observationDraft.length}/2000
            </p>
            </>}
          </div>

          <DialogFooter className="gap-2 border-t border-[#e9ebe7] bg-[#f5f4ef]/80 px-6 py-4 sm:space-x-0">
            <Button variant="outline" onClick={closeObservations} disabled={savingObservation}>
              Cancelar
            </Button>
            {canEditClients && <Button
              onClick={() => void saveObservation()}
              disabled={savingObservation || !observationDraft.trim()}
            >
              {savingObservation && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
              {savingObservation ? 'Guardando…' : 'Guardar observación'}
            </Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de cuotas */}
      {selectedClient && (
        <Dialog open={true} onOpenChange={() => {
          setSelectedClient(null);
          setSelectedClientId(null);
        }}>
  <DialogContent className="max-h-[94vh] w-[calc(100vw-1rem)] max-w-[1500px] overflow-x-hidden overflow-y-auto p-4 sm:w-[calc(100vw-2rem)] sm:p-6">
            <DialogHeader className="pr-8">
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:justify-between">
                <DialogTitle className="text-center text-xl text-[#312144] sm:text-left">Detalle de Cuotas</DialogTitle>
                <div className="flex flex-wrap justify-center gap-2 sm:justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={needsFinancialReview(clients.find(c => c.id === selectedClient) || {})}
                    onClick={() => {
                      const client = clients.find(c => c.id === selectedClient);
                      if (client) exportToPDF(client);
                    }}
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Exportar PDF
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={needsFinancialReview(clients.find(c => c.id === selectedClient) || {})}
                    onClick={() => {
                      const client = clients.find(c => c.id === selectedClient);
                      if (client) exportToExcel(client);
                    }}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Exportar Excel
                  </Button>
                </div>
              </div>
            </DialogHeader>
            {(() => {
              const client = clients.find(c => c.id === selectedClient);
              if (!client || !client.cuotas) return null;
              if (needsFinancialReview(client)) return <div className="space-y-4">
                <p className="font-medium">{getClientDisplayName(client)} · Bloque {client.bloque} / Mz. {client.manzana} / Lt. {client.lote}</p>
                <ImportedClientReview key={client.id} client={client} canEdit={canEditClients} onSave={data => updateClient(client.id, data)} />
              </div>;
              return (
                <div className="space-y-4">
                  <div className="san-client-summary mx-auto w-full max-w-5xl space-y-4 rounded-xl border border-[#e9e0ee] bg-[#faf9f4] p-4 text-sm sm:p-5">
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="flex min-w-0 items-start justify-center gap-1.5 text-center sm:justify-start sm:text-left">
                        <dt className="shrink-0 font-semibold text-slate-700">Cliente:</dt>
                        <dd className="min-w-0 text-slate-700">{getClientDisplayName(client)}</dd>
                        {canEditClients && <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" aria-label="Editar nombre del cliente" onClick={() => startDetailEdit(client,'nombre')}><Edit className="h-3.5 w-3.5" /></Button>}
                      </div>
                      <div className="flex min-w-0 items-start justify-center gap-1.5 text-center sm:justify-start sm:text-left">
                        <dt className="shrink-0 font-semibold text-slate-700">DNIs:</dt>
                        <dd className="min-w-0 text-slate-700">{getClientDisplayDnis(client)}</dd>
                        {canEditClients && <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" aria-label="Editar DNI del cliente" onClick={() => startDetailEdit(client,'dni')}><Edit className="h-3.5 w-3.5" /></Button>}
                      </div>
                      <div className="flex min-w-0 items-start justify-center gap-1.5 text-center sm:justify-start sm:text-left">
                        <dt className="shrink-0 font-semibold text-slate-700">Bloque:</dt>
                        <dd className="text-slate-700">{client.bloque || '—'}</dd>
                      </div>
                      <div className="flex min-w-0 items-start justify-center gap-1.5 text-center sm:justify-start sm:text-left">
                        <dt className="shrink-0 font-semibold text-slate-700">Manzana:</dt>
                        <dd className="text-slate-700">{client.manzana}</dd>
                      </div>
                      <div className="flex min-w-0 items-start justify-center gap-1.5 text-center sm:justify-start sm:text-left">
                        <dt className="shrink-0 font-semibold text-slate-700">Lote:</dt>
                        <dd className="text-slate-700">{client.lote}</dd>
                      </div>
                      <div className="flex min-w-0 items-start justify-center gap-1.5 text-center sm:justify-start sm:text-left">
                        <dt className="shrink-0 font-semibold text-slate-700">Email:</dt>
                        <dd className="min-w-0 break-words text-slate-700">{client.email1 || 'N/A'}</dd>
                        {canEditClients && <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" aria-label="Editar correo del cliente" onClick={() => startDetailEdit(client,'email')}><Edit className="h-3.5 w-3.5" /></Button>}
                      </div>
                      <div className="flex min-w-0 items-start justify-center gap-1.5 text-center sm:justify-start sm:text-left">
                        <dt className="shrink-0 font-semibold text-slate-700">Metraje:</dt>
                        <dd className="text-slate-700">{client.metraje} m²</dd>
                      </div>
                    </dl>

                    {canEditClients && detailEditField && <div className="rounded-lg border border-[#d9ddd9] bg-white p-3">
                      <p className="mb-3 font-semibold text-[#312144]">Editar {detailEditField === 'nombre' ? 'cliente' : detailEditField === 'dni' ? 'DNI' : 'correo'}</p>
                      {detailEditField === 'email' ? <div className="grid gap-3 sm:grid-cols-2">
                        <div><Label htmlFor="detail-email-1">Correo principal</Label><Input id="detail-email-1" type="email" value={editEmail1} onChange={event => setEditEmail1(event.target.value)} /></div>
                        <div><Label htmlFor="detail-email-2">Correo adicional</Label><Input id="detail-email-2" type="email" value={editEmail2} onChange={event => setEditEmail2(event.target.value)} /></div>
                      </div> : <div className="grid gap-3 sm:grid-cols-2">
                        {editTitulares.map((titular,index) => <div key={index}>
                          <Label htmlFor={`detail-${detailEditField}-${index}`}>{detailEditField === 'nombre' ? 'Nombre' : 'DNI'} del titular {index+1}</Label>
                          <Input id={`detail-${detailEditField}-${index}`} value={titular[detailEditField]} inputMode={detailEditField === 'dni' ? 'numeric' : 'text'} maxLength={detailEditField === 'dni' ? 8 : undefined} onChange={event => setEditTitulares(current => current.map((item,itemIndex) => itemIndex === index ? {...item,[detailEditField]:event.target.value} : item))} />
                        </div>)}
                      </div>}
                      <div className="mt-3 flex gap-2"><Button size="sm" disabled={savingDetail} onClick={() => void saveDetailEdit(client)}>{savingDetail ? 'Guardando…' : 'Guardar'}</Button><Button size="sm" variant="outline" disabled={savingDetail} onClick={() => setDetailEditField(null)}>Cancelar</Button></div>
                    </div>}

                  </div>

                  {canPay && <div className="flex w-full max-w-5xl justify-start">
                    <div className="w-full max-w-[215px] rounded-xl border border-[#d9ddd9] bg-[#f7f8f6] p-2.5 shadow-sm">
                      <Label htmlFor="paymentDate" className="block text-left text-[11px] font-semibold leading-4 text-[#5f6878]">
                        Fecha para marcar pagos
                      </Label>
                      <Input
                        id="paymentDate"
                        type="date"
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        className="mt-1.5 h-8 w-full bg-white px-2 text-center text-xs"
                      />
                    </div>
                  </div>}
                  
                  <div className="w-full [&>div]:overflow-x-hidden">
                    <Table className="block w-full text-sm 2xl:table 2xl:table-fixed 2xl:text-[11px]">
                      <TableHeader className="hidden bg-[#f5f4ef] 2xl:table-header-group">
                        <TableRow>
                          <TableHead className="w-[5%] px-2 text-center">N°</TableHead>
                          <TableHead className="w-[10%] px-2 text-center">Vencimiento</TableHead>
                          <TableHead className="w-[11%] px-2 text-center">Monto</TableHead>
                          <TableHead className="w-[10%] px-2 text-center">Mora</TableHead>
                          <TableHead className="w-[10%] px-2 text-center">Total</TableHead>
                          <TableHead className="w-[10%] px-2 text-center">Fecha pago</TableHead>
                          <TableHead className="w-[9%] px-2 text-center">Estado</TableHead>
                          <TableHead className="w-[9%] px-2 text-center">Acción</TableHead>
                          <TableHead className="w-[10%] px-2 text-center">Voucher</TableHead>
                          <TableHead className="w-[10%] px-2 text-center">Boleta</TableHead>
                          <TableHead className="w-[6%] px-2 text-center">Fecha</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody className="block space-y-3 2xl:table-row-group 2xl:space-y-0">
                        {client.cuotas.map((cuota, index) => {
                          const displayedMora = getEffectiveMora(cuota);
                          // Mostrar siempre monto + mora (manual o calculada) para reflejar la deuda actual
                          const totalDisplayed = cuota.monto + displayedMora;
                          
                          return (
                            <TableRow key={index} className="san-quota-row grid grid-cols-2 gap-4 rounded-xl border border-[#d9ddd9] bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-4 2xl:table-row 2xl:rounded-none 2xl:border-x-0 2xl:bg-transparent 2xl:p-0 2xl:shadow-none">
                              <TableCell className="col-span-2 block min-w-0 p-0 text-center sm:col-span-1 2xl:table-cell 2xl:p-2">
                                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 2xl:hidden">Cuota</span>
                                <Badge variant={cuota.numero === 0 ? 'secondary' : 'outline'}>
                                  {cuota.numero === 0 ? 'Inicial' : cuota.numero}
                                </Badge>
                              </TableCell>
                              <TableCell className="block min-w-0 p-0 text-center 2xl:table-cell 2xl:p-2">
                                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 2xl:hidden">Vencimiento</span>
                                {formatDate(cuota.vencimiento)}
                              </TableCell>
                              <TableCell className="block min-w-0 p-0 text-center 2xl:table-cell 2xl:p-2">
                                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 2xl:hidden">Monto</span>
                                <div className="flex items-center justify-center gap-1 2xl:gap-0.5">
                                  <span className="truncate">S/ {cuota.monto.toFixed(2)}</span>
                                  {canEditClients && <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={`Editar monto de la cuota ${cuota.numero}`} title="Editar monto" onClick={() => { setEditingCuota({ clientId: selectedClient!, type: 'amount', cuotaIndex: index }); setEditMonto(cuota.monto.toFixed(2)); }}>
                                    <Edit className="w-4 h-4" />
                                  </Button>}
                                </div>
                              </TableCell>
                              <TableCell className="block min-w-0 p-0 text-center 2xl:table-cell 2xl:p-2">
                                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 2xl:hidden">Mora</span>
                                <div className="flex items-center justify-center gap-1 2xl:gap-0.5">
                                  <span>S/ {displayedMora.toFixed(2)}</span>
                                  {canEditClients && <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={`Editar mora de la cuota ${cuota.numero}`} title="Editar mora" onClick={() => { setEditingMora({ clientId: selectedClient!, cuotaIndex: index }); setEditMoraValue(displayedMora.toFixed(2)); }}>
                                    <Edit className="w-4 h-4" />
                                  </Button>}
                                </div>
                              </TableCell>
                              <TableCell className="block min-w-0 p-0 text-center 2xl:table-cell 2xl:p-2">
                                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 2xl:hidden">Total</span>
                                S/ {totalDisplayed.toFixed(2)}
                              </TableCell>
                              <TableCell className="block min-w-0 p-0 text-center 2xl:table-cell 2xl:p-2">
                                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 2xl:hidden">Fecha de pago</span>
                                {cuota.fechaPago ? formatDate(cuota.fechaPago) : '-'}
                              </TableCell>
                              <TableCell className="block min-w-0 p-0 text-center 2xl:table-cell 2xl:p-2">
                                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 2xl:hidden">Estado</span>
                                <Badge variant={
                                  cuota.estado === 'pagado' ? 'default' : 
                                  cuota.estado === 'vencido' ? 'destructive' : 'secondary'
                                }>
                                  {cuota.estado}
                                </Badge>
                              </TableCell>
                              <TableCell className="block min-w-0 p-0 text-center 2xl:table-cell 2xl:p-2">
                                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 2xl:hidden">Acción</span>
                                {canPay && (
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    className="h-8 px-2 text-xs"
                                    onClick={() => setPaymentConfirmation({clientId:client.id,cuotaIndex:index,action:cuota.estado === 'pagado' ? 'unmark' : 'mark'})}
                                  >
                                    {cuota.estado === 'pagado' ? 'Desmarcar pago' : 'Marcar pagado'}
                                  </Button>
                                )}
                              </TableCell>
                              <TableCell className="block min-w-0 p-0 text-center 2xl:table-cell 2xl:p-2">
                                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 2xl:hidden">Voucher</span>
                                <div className="flex items-center justify-center gap-1">
                                  {canPay && isStorageEnabled && <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={`Subir voucher de la cuota ${cuota.numero}`} title="Subir voucher" onClick={() => handleFileUpload(selectedClient, index, 'voucher')}>
                                    <Upload className="w-4 h-4" />
                                  </Button>}
                                  {(Array.isArray(cuota.voucher) ? cuota.voucher.length > 0 : !!cuota.voucher) && (
                                    <>
                                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={`Ver voucher de la cuota ${cuota.numero}`} title="Ver voucher" onClick={() => openAllFiles(cuota.voucher)}>
                                        <Eye className="w-4 h-4" />
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={`Descargar voucher de la cuota ${cuota.numero}`} title="Descargar voucher" onClick={() => downloadAllFiles(cuota.voucher, `voucher_${client.dni1 || 'file'}_${index}`)}>
                                        <Download className="w-4 h-4" />
                                      </Button>
                                      {canPay && <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 w-8 p-0 text-[#a63d45] hover:bg-rose-50 hover:text-[#8e2932]"
                                        aria-label={`Borrar voucher de la cuota ${cuota.numero}`}
                                        title="Borrar voucher"
                                        onClick={() => openAttachmentManager(client, index, 'voucher')}
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </Button>}
                                    </>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="block min-w-0 p-0 text-center 2xl:table-cell 2xl:p-2">
                                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 2xl:hidden">Boleta</span>
                                <div className="flex items-center justify-center gap-1">
                                  {canBoleta && isStorageEnabled && <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={`Subir boleta de la cuota ${cuota.numero}`} title="Subir boleta" onClick={() => handleFileUpload(selectedClient, index, 'boleta')}>
                                    <Upload className="w-4 h-4" />
                                  </Button>}
                                  {(Array.isArray(cuota.boleta) ? cuota.boleta.length > 0 : !!cuota.boleta) && (
                                    <>
                                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={`Ver boleta de la cuota ${cuota.numero}`} title="Ver boleta" onClick={() => openAllFiles(cuota.boleta)}>
                                        <Eye className="w-4 h-4" />
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={`Descargar boleta de la cuota ${cuota.numero}`} title="Descargar boleta" onClick={() => downloadAllFiles(cuota.boleta, `boleta_${client.dni1 || 'file'}_${index}`)}>
                                        <Download className="w-4 h-4" />
                                      </Button>
                                      {canBoleta && <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 w-8 p-0 text-[#a63d45] hover:bg-rose-50 hover:text-[#8e2932]"
                                        aria-label={`Borrar boleta de la cuota ${cuota.numero}`}
                                        title="Borrar boleta"
                                        onClick={() => openAttachmentManager(client, index, 'boleta')}
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </Button>}
                                    </>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="block min-w-0 p-0 text-center 2xl:table-cell 2xl:p-2">
                                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 2xl:hidden">Vencimiento</span>
                                {canEditClients && <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 w-8 p-0"
                                  aria-label={`Editar fecha de vencimiento de la cuota ${cuota.numero}`}
                                  title="Editar fecha de vencimiento"
                                  onClick={() => {
                                    setEditingCuota({ clientId: selectedClient, type: 'date', cuotaIndex: index });
                                    setEditFecha(cuota.vencimiento);
                                  }}
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>
      )}

      <AlertDialog open={paymentConfirmation !== null} onOpenChange={open => {if (!open && !savingPayment) setPaymentConfirmation(null);}}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{paymentConfirmation?.action === 'unmark' ? '¿Desmarcar este pago?' : '¿Marcar esta cuota como pagada?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {paymentConfirmation?.action === 'unmark'
                ? 'La cuota volverá a pendiente y se quitará su fecha de pago. Los vouchers y boletas adjuntos se conservarán.'
                : `Se registrará el pago con fecha ${paymentDate ? formatDate(paymentDate) : 'sin seleccionar'}. Confirma que has comprobado el abono.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingPayment}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={savingPayment || (paymentConfirmation?.action === 'mark' && !paymentDate)} onClick={event => {event.preventDefault();void confirmPaymentChange();}}>
              {savingPayment ? 'Guardando…' : paymentConfirmation?.action === 'unmark' ? 'Sí, desmarcar' : 'Sí, marcar pagado'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={attachmentManager !== null} onOpenChange={open => {
        if (!open && !deletingAttachment) setAttachmentManager(null);
      }}>
        <DialogContent className="w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border-[#d9ddd9] bg-[#fffefb] p-0 sm:max-w-lg">
          <DialogHeader className="border-b border-[#e9ebe7] bg-[#f5f4ef]/80 px-6 py-5 text-left">
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-[#f3eaf9] text-[#54317f]">
              <FileCheck2 className="h-5 w-5" />
            </div>
            <DialogTitle className="text-xl text-[#312144]">
              {attachmentManager?.fileType === 'voucher' ? 'Vouchers' : 'Boletas'} de la cuota {attachmentManager?.cuotaNumber}
            </DialogTitle>
            <DialogDescription className="leading-6 text-[#697386]">
              {attachmentManager?.clientName}. Selecciona la papelera del archivo específico que deseas borrar.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-80 space-y-2 overflow-y-auto px-6 py-5">
            {attachmentManager?.files.map((file, index) => (
              <div
                key={file.path || file.url}
                className="flex min-h-14 items-center gap-2 rounded-xl border border-[#d9ddd9] bg-white p-1.5"
              >
                <a
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-2.5 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6b4492]"
                  aria-label={`Abrir ${file.name || `archivo ${index + 1}`}`}
                >
                  <FileText className="h-5 w-5 shrink-0 text-[#54317f]" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#182033]">
                    {file.name || `Archivo ${index + 1}`}
                  </span>
                  <Eye className="h-4 w-4 shrink-0 text-[#697386]" />
                </a>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => requestAttachmentDelete(file)}
                  className="h-10 w-10 shrink-0 text-[#a63d45] hover:bg-rose-50 hover:text-[#8e2932]"
                  aria-label={`Eliminar ${file.name || `archivo ${index + 1}`}`}
                  title="Eliminar archivo"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <DialogFooter className="border-t border-[#e9ebe7] bg-[#f5f4ef]/80 px-6 py-4">
            <Button variant="outline" onClick={() => setAttachmentManager(null)} disabled={deletingAttachment}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={attachmentToDelete !== null} onOpenChange={open => {
        if (!open && !deletingAttachment) setAttachmentToDelete(null);
      }}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] rounded-2xl border-[#d9ddd9] bg-[#fffefb] sm:max-w-md">
          <AlertDialogHeader>
            <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-[#a63d45] sm:mx-0">
              <Trash2 className="h-5 w-5" />
            </div>
            <AlertDialogTitle className="text-[#312144]">
              ¿Eliminar {attachmentToDelete?.fileType === 'voucher' ? 'este voucher' : 'esta boleta'}?
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-6 text-[#697386]">
              {attachmentToDelete?.attachment.name || 'El archivo seleccionado'} se quitará de la cuota {attachmentToDelete?.cuotaNumber}. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <Button variant="outline" onClick={() => setAttachmentToDelete(null)} disabled={deletingAttachment}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void handleDeleteAttachment()} disabled={deletingAttachment}>
              {deletingAttachment
                ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                : <Trash2 className="h-4 w-4" />}
              {deletingAttachment ? 'Eliminando…' : 'Eliminar archivo'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal de edición de montos */}
      {editingCuota && editingCuota.type === 'amount' && (
        <Dialog open={true} onOpenChange={() => setEditingCuota(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Editar Monto de Cuotas</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Nuevo monto por cuota:</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editMonto}
                  onChange={(e) => setEditMonto(e.target.value)}
                  placeholder="Ingrese el nuevo monto"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setEditingCuota(null)}>
                  Cancelar
                </Button>
                <Button onClick={handleEditCuotasAmount}>
                  Actualizar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Modal de edición de fecha */}
      {editingCuota && editingCuota.type === 'date' && (
        <Dialog open={true} onOpenChange={() => setEditingCuota(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Editar Fecha de Vencimiento</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Nueva fecha de vencimiento:</Label>
                <Input
                  type="date"
                  value={editFecha}
                  onChange={(e) => setEditFecha(e.target.value)}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="propagateDates" checked={propagateDates} onCheckedChange={(v) => setPropagateDates(!!v)} />
                <Label htmlFor="propagateDates">Aplicar esta fecha a las cuotas siguientes (mensualmente)</Label>
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setEditingCuota(null)}>
                  Cancelar
                </Button>
                <Button onClick={handleEditCuotaDate}>
                  Actualizar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Modal de edición de Mora por cuota */}
      {editingMora && (
        <Dialog open={true} onOpenChange={() => setEditingMora(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Editar Mora de la Cuota</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Nuevo monto de mora:</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={editMoraValue}
                  onChange={(e) => setEditMoraValue(e.target.value)}
                  placeholder="Ingrese el nuevo monto de mora"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setEditingMora(null)}>
                  Cancelar
                </Button>
                <Button onClick={handleEditMoraSave}>
                  Guardar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
