import jsPDF from 'jspdf';
import { Button } from '@/components/ui/button';
import { FileCheck2, FileWarning } from 'lucide-react';
import { getClientDisplayDnis, getClientDisplayName } from '@/types/client';

interface Installment {
  numero: number;
  vencimiento: string;
  monto: number;
  estado: 'pendiente' | 'pagado' | 'vencido';
}
interface DocumentClient {
  titulares?: { nombre: string; dni: string }[];
  nombre1: string;
  nombre2?: string;
  dni1: string;
  dni2?: string;
  manzana: string;
  lote: string;
  bloque?: string;
  cuotas?: Installment[];
}

function todayIso() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}
function formatDate(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}
function header(pdf: jsPDF, title: string) {
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(17);
  pdf.text('SAN BARTOLOMEO INMOBILIARIA', 18, 22);
  pdf.setDrawColor(84, 49, 127);
  pdf.line(18, 27, 192, 27);
  pdf.setFontSize(13);
  pdf.text(title, 18, 39);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text(`Fecha de generación: ${formatDate(todayIso())}`, 18, 48);
}
function paragraph(pdf: jsPDF, text: string, y: number) {
  const lines = pdf.splitTextToSize(text, 174);
  for (const line of lines) {
    if (y > 265) {
      pdf.addPage();
      y = 25;
    }
    pdf.text(line, 18, y);
    y += 5.5;
  }
  return y + 7;
}
function save(pdf: jsPDF, prefix: string, client: DocumentClient) {
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9-]/g, '_');
  pdf.save(`${prefix}-mz-${safe(client.manzana)}-lote-${safe(client.lote)}.pdf`);
}
function signature(pdf: jsPDF, y: number) {
  if (y > 250) {
    pdf.addPage();
    y = 35;
  }
  pdf.text('_______________________________', 18, y + 15);
  pdf.text('Firma y sello autorizados', 18, y + 21);
}

export function NoDebtCertificateButton({ client }: { client: DocumentClient }) {
  const installments = client.cuotas || [];
  const canIssue = installments.length > 0 && installments.every(c => c.estado === 'pagado');
  const generate = () => {
    if (!canIssue) return;
    const pdf = new jsPDF();
    header(pdf, 'BORRADOR DE CONSTANCIA DE NO ADEUDO');
    let y = paragraph(pdf, `Según los pagos registrados en este sistema al ${formatDate(todayIso())}, ${getClientDisplayName(client)}, identificado(a) con DNI ${getClientDisplayDnis(client)}, no presenta cuotas pendientes respecto del lote Mz. ${client.manzana}, Lote ${client.lote}.`, 65);
    y = paragraph(pdf, 'Esta constancia se limita al cronograma de cuotas registrado. Debe contrastarse con los comprobantes y la contabilidad antes de su firma o entrega. No acredita obligaciones ajenas a ese cronograma.', y);
    signature(pdf, Math.max(y, 123));
    save(pdf, 'constancia-no-adeudo', client);
  };
  return <Button size="sm" variant="outline" disabled={!canIssue} onClick={generate}
    title={canIssue ? 'Generar constancia para revisión y firma' : 'Requiere todas las cuotas pagadas y registradas'}>
    <FileCheck2 className="mr-1 h-4 w-4" /> No adeudo
  </Button>;
}

export function ResolutionDraftButton({ client }: { client: DocumentClient }) {
  const overdue = (client.cuotas || []).filter(c =>
    c.numero > 0 && c.estado !== 'pagado' && c.vencimiento.slice(0, 10) < todayIso());
  const canDraft = overdue.length >= 3;
  const generate = () => {
    if (!canDraft) return;
    const pdf = new jsPDF();
    header(pdf, 'BORRADOR DE RESOLUCION DE CONTRATO');
    pdf.setTextColor(150, 55, 45);
    pdf.text('BORRADOR PARA REVISION. SIN FIRMA NI NOTIFICACION.', 18, 57);
    pdf.setTextColor(0, 0, 0);
    const property = `${client.bloque ? `Bloque ${client.bloque}, ` : ''}Mz. ${client.manzana}, Lote ${client.lote}`;
    const totalCents = overdue.reduce((sum, cuota) => sum + Math.round(cuota.monto * 100), 0);
    let y = paragraph(pdf, `Destinatario: ${getClientDisplayName(client)}. Documento(s): ${getClientDisplayDnis(client)}. Inmueble: ${property}.`, 68);
    y = paragraph(pdf, `Referencia: contrato de compraventa de fecha [COMPLETAR FECHA DEL CONTRATO]. Asunto: propuesta de comunicación de resolución contractual por cuotas impagas, sujeta a revisión del contrato y de los requerimientos aplicables.`, y);
    y = paragraph(pdf, `Al ${formatDate(todayIso())}, el cronograma del sistema muestra ${overdue.length} cuota${overdue.length === 1 ? '' : 's'} vencida${overdue.length === 1 ? '' : 's'} sin pago registrado, por un capital total de S/ ${(totalCents / 100).toFixed(2)}. Detalle:`, y);
    for (const cuota of overdue) {
      y = paragraph(pdf, `Cuota ${cuota.numero}: vencimiento ${formatDate(cuota.vencimiento)}; capital S/ ${cuota.monto.toFixed(2)}.`, y);
    }
    y = paragraph(pdf, 'Fundamento para revisión: artículo 1561 del Código Civil peruano sobre tres armadas impagas, sucesivas o no. Verificar también el contrato y cualquier pacto relevante conforme al artículo 1562 antes de decidir la vía de resolución.', y);
    y = paragraph(pdf, 'Texto propuesto: Una vez verificados el contrato firmado, la cláusula resolutoria aplicable, la deuda exigible y las comunicaciones previas necesarias, la parte vendedora podrá comunicar su decisión de resolver el contrato indicado. Completar aquí la causal contractual exacta, la cláusula y la fecha de eficacia antes de cualquier firma o notificación: [COMPLETAR].', y);
    y = paragraph(pdf, 'Antes de emitir: cotejar comprobantes, pagos parciales y abonos no registrados; verificar el domicilio y el medio de comunicación pactados; adjuntar el requerimiento o comunicación previa que corresponda y someter el texto a revisión legal. Este archivo no cambia el estado del contrato ni acredita una notificación.', y);
    signature(pdf, y);
    const pages = pdf.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      pdf.setPage(page);
      pdf.setDrawColor(215, 221, 217);
      pdf.line(18, 282, 192, 282);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(105, 115, 130);
      pdf.text('BORRADOR PARA REVISION', 18, 288);
      pdf.text(`Página ${page} de ${pages}`, 192, 288, { align: 'right' });
    }
    save(pdf, 'borrador-resolucion-contrato', client);
  };
  return <Button size="sm" variant="outline" disabled={!canDraft} onClick={generate}
    title={canDraft ? 'Generar borrador de resolución para revisión' : 'Requiere al menos tres cuotas vencidas sin pago registrado'}>
    <FileWarning className="mr-1 h-4 w-4" /> Resolución
  </Button>;
}
