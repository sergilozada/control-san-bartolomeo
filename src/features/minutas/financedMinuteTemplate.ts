import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { documentLabel, minuteSchedule, money, validateMinute, type MinuteBuyer, type MinuteDraft } from './types';

const TEMPLATE_URL = '/minutas/san-bartolomeo-financiada.docx';
const WORD_DOCUMENT = 'word/document.xml';

const units = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const tens = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const hundreds = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
const beforeNoun = (value: string) => value.replace(/veintiuno$/, 'veintiún').replace(/ y uno$/, ' y un').replace(/uno$/, 'un');

function wordsUnderThousand(value: number): string {
  if (value < 30) return units[value];
  if (value < 100) return tens[Math.floor(value / 10)] + (value % 10 ? ' y ' + units[value % 10] : '');
  if (value === 100) return 'cien';
  return hundreds[Math.floor(value / 100)] + (value % 100 ? ' ' + wordsUnderThousand(value % 100) : '');
}

export function numberInSpanish(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value >= 1_000_000_000) throw new Error('El importe está fuera del rango del modelo de minuta.');
  if (value < 1000) return wordsUnderThousand(value);
  if (value < 1_000_000) {
    const thousands = Math.floor(value / 1000);
    return (thousands === 1 ? 'mil' : beforeNoun(wordsUnderThousand(thousands)) + ' mil') + (value % 1000 ? ' ' + wordsUnderThousand(value % 1000) : '');
  }
  const millions = Math.floor(value / 1_000_000);
  return (millions === 1 ? 'un millón' : beforeNoun(wordsUnderThousand(millions)) + ' millones') + (value % 1_000_000 ? ' ' + numberInSpanish(value % 1_000_000) : '');
}

const moneyInWords = (value: number) => {
  const cents = Math.round(value * 100);
  return `${beforeNoun(numberInSpanish(Math.floor(cents / 100)))} con ${String(cents % 100).padStart(2, '0')}/100 soles`;
};
const areaInWords = (value: number) => {
  const hundredths = Math.round(value * 100);
  return `${beforeNoun(numberInSpanish(Math.floor(hundredths / 100)))} con ${String(hundredths % 100).padStart(2, '0')}/100`;
};
const formatDate = (iso: string) => {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
};
const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
const xmlEscape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const token = (name: string) => `{{${name}}}`;
const fill = (source: string, values: Record<string, string>) => source.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key: string) => key in values ? xmlEscape(values[key]) : token(key));

function buyerIntro(buyers: MinuteBuyer[]): string {
  const descriptions = buyers.map(buyer => {
    const parts = [buyer.address.trim()];
    for (const place of [buyer.district, buyer.province, buyer.department]) {
      if (place?.trim() && !parts.join(' ').toLocaleLowerCase('es-PE').includes(place.trim().toLocaleLowerCase('es-PE'))) parts.push(place.trim());
    }
    const location = parts.join(', ');
    return `${buyer.name.trim().toUpperCase()}, de nacionalidad ${buyer.nationality?.trim()}, identificado con ${documentLabel(buyer.documentType)} N.° ${buyer.document.trim()}, de ocupación ${buyer.occupation.trim()}, de estado civil ${buyer.maritalStatus.trim()}, con domicilio habitual en ${location}`;
  });
  return descriptions.join('; y ') + ', a quienes en adelante se les denominará LOS ADQUIRENTES, de conformidad con los términos y condiciones siguientes: =============================';
}

function enclosingXml(xml: string, marker: string, tag: 'w:p' | 'w:tr'): { start: number; end: number } {
  const at = xml.indexOf(marker);
  if (at < 0) throw new Error(`Falta el campo ${marker} en el modelo Word.`);
  const start = tag === 'w:tr' ? xml.lastIndexOf('<w:tr>', at) : Math.max(xml.lastIndexOf('<w:p ', at), xml.lastIndexOf('<w:p>', at));
  const end = xml.indexOf(`</${tag}>`, at) + tag.length + 3;
  if (start < 0 || end < at) throw new Error(`No se pudo ubicar ${marker} en el modelo Word.`);
  return { start, end };
}

function fillRepeatingSignatures(xml: string, buyers: MinuteBuyer[]): string {
  const first = enclosingXml(xml, token('BUYER_2_LINE'), 'w:p').start;
  const last = enclosingXml(xml, token('BUYER_2_DOCUMENT'), 'w:p').end;
  const block = xml.slice(first, last);
  const repeated = buyers.slice(1).map(buyer => fill(block, {
    BUYER_2_LINE: '__________________________________',
    BUYER_2_NAME: buyer.name.trim().toUpperCase(),
    BUYER_2_DOCUMENT_LABEL: documentLabel(buyer.documentType),
    BUYER_2_DOCUMENT: buyer.document.trim(),
  })).join('');
  return xml.slice(0, first) + repeated + xml.slice(last);
}

function fillScheduleRows(xml: string, draft: MinuteDraft): string {
  const { start, end } = enclosingXml(xml, token('QUOTA_NUMBER'), 'w:tr');
  const row = xml.slice(start, end);
  const repeated = minuteSchedule(draft).map(item => fill(row, {
    QUOTA_NUMBER: String(item.number), QUOTA_DUE: formatDate(item.dueDate), QUOTA_AMOUNT: money(item.amount),
  })).join('');
  return xml.slice(0, start) + repeated + xml.slice(end);
}

export function renderFinancedMinuteXml(templateXml: string, draft: MinuteDraft): string {
  const errors = validateMinute(draft);
  if (errors.length) throw new Error(errors.join(' '));
  const signature = draft.signatureDate.split('-');
  const balance = Math.round(draft.totalPrice * 100 - draft.initialAmount * 100) / 100;
  let xml = fillRepeatingSignatures(templateXml, draft.buyers);
  xml = fillScheduleRows(xml, draft);
  const payments = draft.initialPayments.length
    ? draft.initialPayments.map(payment => `${formatDate(payment.date)}: ${money(payment.amount)} por ${payment.method}${payment.bank ? ` en ${payment.bank}` : ''}${payment.operationNumber ? `, operación N.° ${payment.operationNumber}` : ''}`).join('; ')
    : 'no se registran abonos de cuota inicial';
  const received = draft.initialAmount > 0
    ? `Se ha recibido como cuota inicial ${money(draft.initialAmount)} (${moneyInWords(draft.initialAmount)}), conforme a los pagos acreditados: ${payments}. `
    : 'No se ha recibido cuota inicial. ';
  const paymentParagraph = `${received}El saldo pendiente de ${money(balance)} (${moneyInWords(balance)}) se pagará en ${draft.installments} cuotas, conforme al cronograma anexo. El primer vencimiento será el ${formatDate(draft.firstDueDate)}.`;
  xml = fill(xml, {
    BUYERS_INTRO: buyerIntro(draft.buyers),
    BUYER_1_NAME: draft.buyers[0].name.trim().toUpperCase(),
    BUYER_1_DOCUMENT_LABEL: documentLabel(draft.buyers[0].documentType),
    BUYER_1_DOCUMENT: draft.buyers[0].document.trim(),
    AREA_M2: draft.area.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    AREA_HA: (draft.area / 10000).toLocaleString('es-PE', { minimumFractionDigits: 4, maximumFractionDigits: 4 }),
    AREA_WORDS: areaInWords(draft.area), BLOCK: draft.block.trim(), LOT: draft.lot.trim(),
    TOTAL_MONEY: money(draft.totalPrice), TOTAL_WORDS: moneyInWords(draft.totalPrice),
    PAYMENT_PARAGRAPH: paymentParagraph,
    SIGNATURE_DAY: signature[2],
    SIGNATURE_MONTH: months[Number(signature[1]) - 1], SIGNATURE_YEAR: signature[0],
  });
  if (/\{\{[A-Z0-9_]+\}\}/.test(xml)) throw new Error('Quedaron datos de la minuta sin completar.');
  return xml;
}

export async function createFinancedMinuteDocument(draft: MinuteDraft): Promise<Blob> {
  const response = await fetch(TEMPLATE_URL);
  if (!response.ok) throw new Error('No se pudo cargar el modelo de San Bartolomeo.');
  const parts = unzipSync(new Uint8Array(await response.arrayBuffer()));
  if (!parts[WORD_DOCUMENT]) throw new Error('El modelo Word no tiene contenido válido.');
  const filled = renderFinancedMinuteXml(strFromU8(parts[WORD_DOCUMENT]), draft);
  parts[WORD_DOCUMENT] = strToU8(filled);
  const result = zipSync(parts, { level: 6 });
  return new Blob([result as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
