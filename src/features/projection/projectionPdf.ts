import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';

export interface ProjectionRow {
  month: string;
  installments: number;
  amount: number;
}

export type ProjectionKind = 'month' | 'range' | 'monthly';

const forest: [number, number, number] = [84, 49, 127];
const forestLight: [number, number, number] = [243, 234, 249];
const ink: [number, number, number] = [49, 33, 68];
const money = (value: number) => `S/ ${value.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function loadProjectionLogo(): Promise<string> {
  const response = await fetch('/brand/san-bartolomeo-logo.jpeg');
  if (!response.ok) throw new Error('No se pudo cargar el logo de San Bartolomeo Inmobiliaria.');
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('No se pudo preparar el logo.'));
    reader.readAsDataURL(blob);
  });
}

function pageChrome(pdf: jsPDF, subtitle: string, logo: string, page: number, pages: number) {
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  pdf.setFillColor(...forest);
  pdf.rect(0, 0, width, 41, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text('PROYECCIÓN DE INGRESOS', 16, 17);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text(subtitle, 16, 28);
  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect(width - 44, 5, 29, 29, 3, 3, 'F');
  pdf.addImage(logo, 'JPEG', width - 43, 6, 27, 27);
  pdf.setDrawColor(...forest);
  pdf.line(16, height - 18, width - 16, height - 18);
  pdf.setTextColor(...forest);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.text('SAN BARTOLOMEO INMOBILIARIA  ·  Proyección de ingresos', 16, height - 12);
  pdf.text(`${page} / ${pages}`, width - 16, height - 12, { align: 'right' });
}

export function createProjectionPdf(kind: ProjectionKind, subtitle: string, rows: ProjectionRow[], logo: string) {
  const pdf = new jsPDF();
  pdf.setProperties({ title: `Proyección de ingresos - ${subtitle}`, author: 'San Bartolomeo Inmobiliaria' });
  const totalInstallments = rows.reduce((sum, row) => sum + row.installments, 0);
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);

  pdf.setTextColor(...ink);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text('Resumen', 16, 55);
  pdf.setFillColor(...forestLight);
  pdf.roundedRect(16, 60, 178, 25, 3, 3, 'F');
  pdf.setTextColor(...forest);
  pdf.setFontSize(10);
  pdf.text(`Cuotas previstas: ${totalInstallments}`, 22, 70);
  pdf.text(`Ingreso proyectado: ${money(totalAmount)}`, 22, 78);

  autoTable(pdf, {
    startY: 95,
    margin: { left: 16, right: 16, top: 49, bottom: 25 },
    head: [['Mes', 'Número de cuotas', 'Total proyectado']],
    body: rows.map(row => [row.month, String(row.installments), money(row.amount)]),
    foot: [['Total', String(totalInstallments), money(totalAmount)]],
    theme: 'grid',
    headStyles: { fillColor: forest, textColor: [255, 255, 255], fontStyle: 'bold' },
    footStyles: { fillColor: forestLight, textColor: forest, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [251, 249, 252] },
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 3.5, textColor: ink, lineColor: [225, 218, 230], lineWidth: 0.1 },
    columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' } },
    showFoot: 'lastPage',
  });

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    pageChrome(pdf, subtitle, logo, page, pages);
  }
  return pdf;
}

export async function downloadProjectionPdf(kind: ProjectionKind, subtitle: string, rows: ProjectionRow[]) {
  const logo = await loadProjectionLogo();
  const pdf = createProjectionPdf(kind, subtitle, rows, logo);
  const date = new Date();
  const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  pdf.save(`proyeccion_${kind}_${day}.pdf`);
}
