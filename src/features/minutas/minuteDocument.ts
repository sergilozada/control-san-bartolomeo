import { AlignmentType, Document, Footer, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { buildSchedule, documentLabel, money, validateMinute, type MinuteDraft } from './types';

// La estructura sigue el Word descargado por Minutas Villa Hermosa; sus datos y
// condiciones contractuales propios no forman parte de este proyecto.
const green = '54317F';
const navy = '312144';
const accent = '27B8B2';
const pale = 'F3EAF9';
const ink = '202124';
const pending = (label: string) => '[PENDIENTE: ' + label + ']';
const valueOr = (value: string | undefined, label: string) => value?.trim() || pending(label);
const date = (value: string) => value.split('-').reverse().join('/');
const run = (value: string, bold = false, color = ink, size = 22, font = 'Times New Roman') => new TextRun({ text: value, bold, color, size, font });
const legal = (value: string, after = 75) => new Paragraph({ children: [run(value)], alignment: AlignmentType.JUSTIFIED, spacing: { after, line: 248 } });
const legalHeading = (value: string) => new Paragraph({ children: [new TextRun({ text: value.toUpperCase(), bold: true, underline: {}, color: ink, size: 22, font: 'Times New Roman' })], spacing: { before: 105, after: 42 }, keepNext: true });
const small = (value: string, bold = false, color = navy) => new Paragraph({ children: [run(value, bold, color, 16, 'Aptos')], spacing: { after: 30 } });
const signatureCell = (label: string, name: string) => new TableCell({ margins: { top: 30, bottom: 30, left: 70, right: 70 }, children: [
  new Paragraph({ children: [run('________________________', false, green, 14, 'Aptos')] }),
  new Paragraph({ children: [run(label + ' · ' + name, true, green, 14, 'Aptos')] }),
] });
const signatureFooter = (manager: string, buyers: string) => new Footer({ children: [
  new Paragraph({ children: [run('SAN BARTOLOMEO INMOBILIARIA · BORRADOR PARA REVISIÓN', true, green, 13, 'Aptos')], alignment: AlignmentType.CENTER, spacing: { after: 75 } }),
  new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [
    signatureCell('Sello y firma de Gerencia', manager), signatureCell('Firma de comprador(es)', buyers),
  ] })] }),
] });

async function logoBytes(): Promise<Uint8Array | null> {
  try {
    const response = await fetch('/brand/san-bartolomeo-logo.jpeg');
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch { return null; }
}

function scheduleCell(value: string, options: { header?: boolean; fill?: string; bold?: boolean; width?: number } = {}) {
  return new TableCell({
    width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined,
    shading: options.header ? { fill: green } : options.fill ? { fill: options.fill } : undefined,
    margins: { top: 20, bottom: 20, left: 42, right: 42 },
    children: [new Paragraph({ children: [run(value, options.header || options.bold || false, options.header ? 'FFFFFF' : navy, 13, 'Aptos')], alignment: AlignmentType.CENTER })],
  });
}

export async function createMinuteDocument(draft: MinuteDraft): Promise<Blob> {
  const errors = validateMinute(draft);
  if (errors.length) throw new Error(errors.join(' '));
  const buyers = draft.buyers.map(item => item.name.trim());
  const buyerNames = buyers.join(' y ');
  const seller = valueOr(draft.sellerLegalName, 'razón social del vendedor');
  const sellerRuc = valueOr(draft.sellerRuc, 'RUC');
  const sellerAddress = valueOr(draft.sellerAddress, 'domicilio legal del vendedor');
  const representativeDocument = valueOr(draft.sellerRepresentativeDocument, 'documento del representante');
  const registry = valueOr(draft.propertyRegistry, 'partida registral y título del terreno');
  const delivery = valueOr(draft.deliveryTerms, 'plazo y condiciones de entrega');
  const lateFee = valueOr(draft.lateFeeTerms, 'condiciones de mora y penalidades aprobadas');
  const bank = valueOr(draft.bankName, 'banco de cobranza');
  const account = valueOr(draft.bankAccount, 'número de cuenta');
  const cci = valueOr(draft.bankCci, 'CCI');
  const phone = valueOr(draft.collectionsPhone, 'teléfono de cobranza');
  const balance = draft.totalPrice - draft.initialAmount;
  const payments = draft.initialPayments.length
    ? draft.initialPayments.map(item => date(item.date) + ': ' + money(item.amount) + ' mediante ' + item.method + (item.bank ? ' en ' + item.bank : '')).join('; ')
    : 'No se registran pagos de cuota inicial.';
  const schedule = buildSchedule(draft);
  const logo = await logoBytes();
  const image = (width: number, height: number) => logo ? new ImageRun({ data: logo, transformation: { width, height }, type: 'jpg' }) : null;
  const footer = signatureFooter(draft.managerName, buyerNames);

  const legalChildren = [
    legalHeading('Señor Notario:'),
    legal('Sírvase extender en su registro de escrituras públicas la minuta de compraventa del bien identificado más adelante, según los datos y condiciones que las partes verifiquen y aprueben en su versión definitiva.'),
    legalHeading('El vendedor:'),
    legal(seller + ', con RUC ' + sellerRuc + ', domicilio en ' + sellerAddress + ', representado por ' + draft.managerName + ', identificado con ' + representativeDocument + '. La titularidad y las facultades de representación deben acreditarse antes de la firma.'),
    legalHeading('Los compradores:'),
    ...draft.buyers.map((buyer, index) => legal((index + 1) + '. ' + buyer.name.toUpperCase() + ', identificado con ' + documentLabel(buyer.documentType) + ' ' + buyer.document + ', de nacionalidad ' + valueOr(buyer.nationality, 'nacionalidad') + ', ocupación ' + valueOr(buyer.occupation, 'ocupación') + ', estado civil ' + valueOr(buyer.maritalStatus, 'estado civil') + ', domicilio en ' + valueOr(buyer.address, 'domicilio') + ', distrito ' + valueOr(buyer.district, 'distrito') + ', provincia ' + valueOr(buyer.province, 'provincia') + ', departamento ' + valueOr(buyer.department, 'departamento') + '.')),
    legal('Las personas indicadas serán denominadas conjuntamente LOS COMPRADORES. Esta redacción colectiva, así como la intervención de cónyuges cuando corresponda, requiere revisión legal.'),
    legalHeading('Primero: Antecedentes.'),
    legal('1.1. EL VENDEDOR deberá acreditar su derecho sobre el terreno y la capacidad de disponer del lote materia de la operación. Referencia registral o título declarado: ' + registry + '. Se incorporarán al expediente los documentos y planos que sustenten el área, ubicación, linderos, cargas y estado del predio.'),
    legal('1.2. El bien propuesto es el ' + (draft.propertyType === 'macrolote' ? 'macrolote' : 'lote') + ' ' + draft.lot + ' de la manzana ' + draft.block + ', con área declarada de ' + draft.area.toLocaleString('es-PE') + ' m², dentro del proyecto San Bartolomeo Inmobiliaria. La situación de subdivisión, independización, posesión y registro queda sujeta a comprobación documental.'),
    legalHeading('Segundo: Objeto del contrato.'),
    legal('EL VENDEDOR y LOS COMPRADORES someterán a aprobación la transferencia del bien descrito, junto con los derechos que legalmente le correspondan. La identificación definitiva del inmueble, su modalidad de transferencia y los alcances de la entrega deberán coincidir con los documentos que se adjunten a la escritura.'),
    legalHeading('Tercero: Precio de venta y forma de pago.'),
    legal('3.1. Precio total declarado: ' + money(draft.totalPrice) + '. Cuota inicial: ' + money(draft.initialAmount) + '. Saldo propuesto para financiamiento: ' + money(balance) + '.'),
    legal('3.2. Pagos iniciales declarados para verificación: ' + payments + '. Estos importes solo se tendrán por acreditados contra los comprobantes y estados de cuenta correspondientes.'),
    legal('3.3. El saldo se distribuye en ' + draft.installments + ' cuotas mensuales, con primer vencimiento el ' + date(draft.firstDueDate) + ', conforme al cronograma anexo. La última cuota corrige únicamente diferencias de redondeo. Los pagos futuros se realizarán en la cuenta que las partes confirmen: ' + bank + ', cuenta ' + account + ', CCI ' + cci + '.'),
    legalHeading('Cuarto: Equivalencia de las prestaciones.'),
    legal('Las partes deberán revisar el precio, las características y el estado del inmueble antes de declarar la equivalencia de sus prestaciones. Cualquier variación del área o de la identificación registral debe quedar regulada expresamente en la versión que se firme.'),
    legalHeading('Quinto: Entrega de la posesión del inmueble.'),
    legal('Las condiciones propuestas para la entrega son: ' + delivery + '. La fecha, el acta de entrega, el estado físico, los servicios y cualquier obligación previa o posterior deberán constar de forma expresa en el contrato definitivo.'),
    legalHeading('Sexto: Penalidades y moras.'),
    legal('Las condiciones de mora, requerimiento, subsanación, resolución y devolución de importes serán las que las partes aprueben por escrito. Condiciones declaradas para revisión: ' + lateFee + '. Cualquier tasa o penalidad deberá quedar expresamente indicada en el contrato definitivo.'),
    legalHeading('Séptimo: Cargas y gravámenes.'),
    legal('La existencia de cargas, gravámenes, procesos, litigios, limitaciones de disposición y deudas vinculadas con el bien deberá verificarse mediante información registral y municipal actualizada. Las declaraciones y obligaciones de saneamiento serán precisadas por asesoría legal.'),
    legalHeading('Octavo: Pago de tributos.'),
    legal('La distribución de tributos, tasas y contribuciones anteriores y posteriores a la firma, así como del impuesto de alcabala cuando corresponda, deberá definirse expresamente conforme a la ley y a los documentos del inmueble.'),
    legalHeading('Noveno: Otros compromisos.'),
    legal('El uso permitido del bien, las reglas del condominio, las obras comunes, los servicios, el mantenimiento y cualquier obligación de las partes se detallarán en anexos aprobados. Solo serán exigibles los compromisos que consten en el contrato definitivo.'),
    legalHeading('Décimo: Integridad del contrato.'),
    legal('La versión suscrita y sus anexos deberán recoger la totalidad de acuerdos entre las partes. Toda modificación posterior se hará por escrito, con fecha y aceptación de quienes corresponda.'),
    legalHeading('Décimo primero: Jurisdicción y competencia.'),
    legal('La vía y el lugar competentes para resolver controversias se determinarán en la versión definitiva, conforme a la ubicación del inmueble y a las normas aplicables: ' + pending('jurisdicción y competencia aprobadas') + '.'),
    legalHeading('Décimo segundo: Domicilio, comunicaciones y correo electrónico.'),
    legal('Se consignan como domicilios para revisión el del vendedor: ' + sellerAddress + ', y los declarados por LOS COMPRADORES en la introducción. Correos de contacto: ' + draft.buyers.map(buyer => valueOr(buyer.email, 'correo de ' + buyer.name)).join('; ') + '. Las condiciones de notificación y cambio de domicilio se definirán en el texto final.'),
    legalHeading('Décimo tercero: Cesión de derechos.'),
    legal('Cualquier restricción o autorización para ceder la posición contractual o los derechos derivados de la compraventa deberá ser negociada y redactada expresamente por las partes: ' + pending('régimen de cesión aprobado') + '.'),
    legalHeading('Décimo cuarto: Caso fortuito y fuerza mayor.'),
    legal('Las consecuencias de eventos extraordinarios ajenos al control de las partes, sus avisos y eventuales ampliaciones de plazo deberán quedar definidas en la versión definitiva: ' + pending('tratamiento aprobado de fuerza mayor') + '.'),
    legalHeading('Décimo quinto: Ley aplicable.'),
    legal('La operación se sujetará a la legislación peruana aplicable. El texto definitivo debe ser revisado por asesoría legal para verificar su coherencia con la modalidad de venta y la situación registral del bien.'),
    legalHeading('Décimo sexto: Gastos.'),
    legal('Los gastos notariales, registrales, administrativos y demás conceptos relacionados con la formalización se distribuirán según acuerdo expreso de las partes: ' + pending('distribución de gastos aprobada') + '.'),
    legal('Agregue usted, señor Notario, las formalidades de ley y curse los partes correspondientes cuando se haya aprobado y suscrito la versión definitiva de esta minuta.'),
    legal(draft.signaturePlace + ', ' + date(draft.signatureDate) + '.'),
    new Paragraph({ children: [run('FIRMAS PARA REVISIÓN', true, green, 20, 'Aptos')], alignment: AlignmentType.CENTER, spacing: { before: 260, after: 140 } }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [
      signatureCell('EL VENDEDOR', seller), signatureCell('LOS COMPRADORES', buyerNames),
    ] })] }),
  ];

  const brandCell = (right = false) => new TableCell({ children: [new Paragraph({
    children: right ? [run('SAN BARTOLOMEO INMOBILIARIA', true, green, 24, 'Aptos')] : image(95, 95) ? [image(95, 95)!] : [run('SAN BARTOLOMEO INMOBILIARIA', true, green, 19, 'Aptos')],
    alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT,
  })] });
  const brandTable = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [brandCell(), brandCell(true)] })] });
  const infoLines = [
    ...draft.buyers.map((buyer, index) => small((draft.buyers.length === 1 ? 'Comprador' : 'Comprador ' + (index + 1)) + ': ' + buyer.name + ' · ' + documentLabel(buyer.documentType) + ' ' + buyer.document, true)),
    small('Celular de contacto: ' + (draft.buyers.find(item => item.phone)?.phone || '—')),
    small('Correo de contacto: ' + (draft.buyers.find(item => item.email)?.email || '—')),
    small('Precio total: ' + money(draft.totalPrice)), small('Moneda: SOLES'),
    small('Proyecto: San Bartolomeo Inmobiliaria'), small('Manzana: ' + draft.block), small('Lote: ' + draft.lot),
    small('Metraje: ' + draft.area.toLocaleString('es-PE') + ' m²'),
  ];
  const bankLines = [
    small('DATOS PARA PAGOS', true, green), small('Banco: ' + bank, true),
    small('N.° de cuenta: ' + account), small('CCI: ' + cci), small(seller, true),
  ];
  const metadata = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [
    new TableCell({ children: infoLines, width: { size: 60, type: WidthType.PERCENTAGE }, margins: { top: 100, bottom: 100, left: 100, right: 100 } }),
    new TableCell({ children: bankLines, width: { size: 40, type: WidthType.PERCENTAGE }, shading: { fill: pale }, margins: { top: 170, bottom: 100, left: 170, right: 100 } }),
  ] })] });
  const headers = ['Comprador', 'Vencimiento', 'Monto', 'Mora', 'Total', 'Fecha de pago', 'Estado', 'Voucher', 'Boleta'];
  const widths = [22, 11, 11, 8, 11, 11, 10, 8, 8];
  const scheduleRows = [new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((item, index) => scheduleCell(item, { header: true, width: widths[index] })) }),
    ...schedule.map((item, index) => new TableRow({ cantSplit: true, children: [draft.buyers.length === 1 ? buyerNames : 'Compradores (ver datos)', date(item.dueDate), money(item.amount), 'S/ 0.00', money(item.amount), '', 'Pendiente', '', ''].map((entry, column) => scheduleCell(entry, { fill: index === schedule.length - 1 ? 'FFF1C9' : index % 2 ? 'F1F7F4' : undefined, bold: index === schedule.length - 1 && [2, 4].includes(column), width: widths[column] })) }))];
  const scheduleChildren = [
    brandTable,
    new Paragraph({ children: [run('CRONOGRAMA DE PAGOS', true, green, 32, 'Aptos')], alignment: AlignmentType.CENTER, spacing: { before: 120, after: 130 } }),
    new Paragraph({ shading: { fill: accent }, children: [run('Teléfono de cobranza San Bartolomeo: ' + phone, true, navy, 17, 'Aptos')], alignment: AlignmentType.CENTER, spacing: { before: 40, after: 40 } }),
    metadata,
    new Paragraph({ children: [run('DETALLE DE CUOTAS', true, green, 21, 'Aptos')], spacing: { before: 155, after: 75 } }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: scheduleRows }),
    new Paragraph({ children: [run('Cronograma sujeto a verificación y aprobación del contrato definitivo.', false, green, 14, 'Aptos')], spacing: { before: 110 } }),
  ];
  const doc = new Document({
    creator: 'San Bartolomeo Inmobiliaria', title: 'Minuta financiada y cronograma para revisión',
    sections: [
      { properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 900, right: 1220, bottom: 1600, left: 1220 } } }, footers: { default: footer }, children: legalChildren },
      { properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 560, right: 560, bottom: 1600, left: 560 } } }, footers: { default: footer }, children: scheduleChildren },
    ],
  });
  return Packer.toBlob(doc);
}
