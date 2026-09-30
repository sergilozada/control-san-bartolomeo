export interface MinuteBuyer {
  name: string;
  documentType: 'dni' | 'ce' | 'pasaporte';
  document: string;
  occupation: string;
  maritalStatus: string;
  address: string;
  nationality?: string;
  email?: string;
  phone?: string;
  district?: string;
  province?: string;
  department?: string;
}

export interface InitialPayment {
  date: string;
  method: string;
  bank?: string;
  amount: number;
}

export interface MinuteDraft {
  clientId: string;
  buyers: MinuteBuyer[];
  propertyType: 'lote' | 'macrolote';
  block: string;
  lot: string;
  area: number;
  totalPrice: number;
  initialAmount: number;
  initialPayments: InitialPayment[];
  installments: number;
  firstDueDate: string;
  signaturePlace: string;
  signatureDate: string;
  managerName: string;
  sellerLegalName?: string;
  sellerRuc?: string;
  sellerAddress?: string;
  sellerRepresentativeDocument?: string;
  propertyRegistry?: string;
  deliveryTerms?: string;
  lateFeeTerms?: string;
  bankName?: string;
  bankAccount?: string;
  bankCci?: string;
  collectionsPhone?: string;
  notes: string;
}

export interface MinuteRecord {
  id: string;
  reference: string;
  clientId: string;
  clientName: string;
  status: 'borrador' | 'generada';
  draft: MinuteDraft;
  createdBy: string;
  updatedBy: string;
  updatedAt?: { toDate: () => Date };
}

export const blankBuyer = (): MinuteBuyer => ({ name: '', documentType: 'dni', document: '', occupation: '', maritalStatus: '', address: '', nationality: '', email: '', phone: '', district: '', province: '', department: '' });

export const blankMinute = (): MinuteDraft => ({
  clientId: '', buyers: [blankBuyer()], propertyType: 'lote', block: '', lot: '', area: 0,
  totalPrice: 0, initialAmount: 0, initialPayments: [], installments: 30,
  firstDueDate: '', signaturePlace: '', signatureDate: '', managerName: '', notes: '',
  sellerLegalName: '', sellerRuc: '', sellerAddress: '', sellerRepresentativeDocument: '', propertyRegistry: '',
  deliveryTerms: '', lateFeeTerms: '', bankName: '', bankAccount: '', bankCci: '', collectionsPhone: '',
});

export const money = (amount: number) => `S/ ${amount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function validateMinute(draft: MinuteDraft): string[] {
  const errors: string[] = [];
  if (!draft.buyers.length || draft.buyers.some(buyer => !buyer.name.trim() || !validBuyerDocument(buyer))) {
    errors.push('Cada comprador necesita nombre y documento válido: DNI de 8 dígitos, carné de extranjería de hasta 11 dígitos o pasaporte de hasta 15 caracteres alfanuméricos.');
  }
  if (!draft.block.trim() || !draft.lot.trim() || !Number.isFinite(draft.area) || draft.area <= 0) errors.push('Completa manzana, lote y área.');
  if (!Number.isFinite(draft.totalPrice) || draft.totalPrice <= 0 || !Number.isFinite(draft.initialAmount) || draft.initialAmount < 0 || draft.initialAmount >= draft.totalPrice) errors.push('Revisa el precio y la cuota inicial.');
  if (!Number.isInteger(draft.installments) || draft.installments < 1 || draft.installments > 240 || !/^\d{4}-\d{2}-\d{2}$/.test(draft.firstDueDate)) errors.push('Indica entre 1 y 240 cuotas y la fecha de la primera.');
  if (draft.initialPayments.some(payment => !payment.date || !payment.method || (['Depósito', 'Transferencia'].includes(payment.method) && !payment.bank) || !Number.isFinite(payment.amount) || payment.amount <= 0)) errors.push('Completa fecha, medio, banco cuando corresponda y monto de cada pago inicial.');
  const paymentSum = draft.initialPayments.reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0);
  if (paymentSum !== Math.round(draft.initialAmount * 100)) errors.push('Los pagos iniciales deben sumar la cuota inicial.');
  if (!draft.signaturePlace?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(draft.signatureDate || '') || !draft.managerName?.trim()) errors.push('Completa lugar, fecha y representante de Gerencia para el cierre.');
  if (draft.sellerRuc && !/^\d{11}$/.test(draft.sellerRuc)) errors.push('El RUC del vendedor debe tener 11 dígitos.');
  if (draft.buyers.some(buyer => buyer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email))) errors.push('Revisa el correo de cada comprador.');
  return errors;
}

export function validBuyerDocument(buyer: MinuteBuyer): boolean {
  const value = buyer.document.trim().toUpperCase();
  if ((buyer.documentType || 'dni') === 'dni') return /^\d{8}$/.test(value);
  if (buyer.documentType === 'ce') return /^\d{1,11}$/.test(value);
  return /^[A-Z0-9]{1,15}$/.test(value);
}

export function normalizeBuyerDocument(value: string, type: MinuteBuyer['documentType']): string {
  if (type === 'dni') return value.replace(/\D/g, '').slice(0, 8);
  if (type === 'ce') return value.replace(/\D/g, '').slice(0, 11);
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
}

export const documentHint = (type: MinuteBuyer['documentType']) =>
  type === 'ce' ? 'Hasta 11 dígitos' : type === 'pasaporte' ? 'Hasta 15 caracteres alfanuméricos' : '8 dígitos';

export const documentLabel = (type?: MinuteBuyer['documentType']) =>
  type === 'ce' ? 'Carné de extranjería' : type === 'pasaporte' ? 'Pasaporte' : 'DNI';

export function buildSchedule(draft: MinuteDraft) {
  const balanceCents = Math.round((draft.totalPrice - draft.initialAmount) * 100);
  const regularCents = Math.floor(balanceCents / draft.installments);
  const [year, month] = draft.firstDueDate.split('-').map(Number);
  return Array.from({ length: draft.installments }, (_, index) => {
    const date = new Date(year, month - 1 + index, 1);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const dueDate = new Date(date.getFullYear(), date.getMonth(), lastDay);
    const amountCents = index === draft.installments - 1
      ? balanceCents - regularCents * (draft.installments - 1) : regularCents;
    return {
      number: index + 1,
      dueDate: [dueDate.getFullYear(), String(dueDate.getMonth() + 1).padStart(2, '0'), String(dueDate.getDate()).padStart(2, '0')].join('-'),
      amount: amountCents / 100,
    };
  });
}
