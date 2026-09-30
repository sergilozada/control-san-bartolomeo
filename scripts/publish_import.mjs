// Importación idempotente a Sistema Central. Nunca sobrescribe documentos existentes.
// Requiere SAN_WORKBOOK, SAN_PYTHON, SAN_ADMIN_UID y FIREBASE_TOOLS_LIB.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const { SAN_WORKBOOK, SAN_PYTHON = 'python', SAN_ADMIN_UID, FIREBASE_TOOLS_LIB, FIREBASE_ACCOUNT } = process.env;
if (!SAN_WORKBOOK || !SAN_ADMIN_UID || !FIREBASE_TOOLS_LIB) {
  throw new Error('Faltan SAN_WORKBOOK, SAN_ADMIN_UID o FIREBASE_TOOLS_LIB.');
}
const python = spawnSync(SAN_PYTHON, [path.join(import.meta.dirname, 'prepare_import.py'), SAN_WORKBOOK], {
  encoding: 'utf8', maxBuffer: 12 * 1024 * 1024,
});
if (python.status !== 0) throw new Error(python.stderr || 'No se pudo analizar el Excel.');
const prepared = JSON.parse(python.stdout);
if (prepared.count !== 63 || prepared.clients.length !== 63) {
  throw new Error(`Se esperaban 63 lotes; el archivo contiene ${prepared.count}. Importación detenida.`);
}
const ids = new Set(prepared.clients.map(client => client.id));
if (ids.size !== prepared.count) throw new Error('Hay identificadores de lote duplicados.');

const require = createRequire(import.meta.url);
const auth = require(path.join(FIREBASE_TOOLS_LIB, 'auth.js'));
const api = require(path.join(FIREBASE_TOOLS_LIB, 'apiv2.js'));
const account = auth.selectAccount(FIREBASE_ACCOUNT || 'manuelito.minions@gmail.com');
api.setRefreshToken(account.tokens.refresh_token);
api.setAccessToken(account.tokens.access_token);
const client = new api.Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
const root = '/projects/villa-hermosa-lotes/databases/(default)/documents/projects/san-bartolomeo';

function field(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(field) } };
  if (typeof value === 'object') return { mapValue: { fields: fields(value) } };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value)
    ? { integerValue: String(value) } : { doubleValue: value };
  return { stringValue: String(value) };
}
function fields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, field(item)]));
}
async function createOnly(uri, value) {
  try {
    await client.patch(uri, { fields: fields(value) }, { queryParams: { 'currentDocument.exists': 'false' } });
    return 'created';
  } catch (error) {
    if (error.status !== 409 && !String(error.message).includes('409')) throw error;
    const existing = (await client.get(uri)).body;
    const oldHash = existing.fields?.importReview?.mapValue?.fields?.sourceHash?.stringValue;
    if (value.importReview && oldHash !== value.importReview.sourceHash) {
      throw new Error(`Ya existe un lote con datos de otra importación: ${uri.split('/').at(-1)}`);
    }
    return 'existing';
  }
}

const dryRun = !process.argv.includes('--apply');
if (dryRun) {
  console.log(JSON.stringify({ mode: 'dry-run', clients: prepared.count,
    observations: prepared.clients.filter(item => item.observationEntries?.length).length,
    needsReview: prepared.clients.filter(item => item.importReview.status === 'pending').length,
    sourceHash: prepared.sourceHash.slice(0, 16) }));
} else {
  const parent = `${root}`;
  await createOnly(parent, { name: 'San Bartolomeo Inmobiliaria', projectKey: 'san-bartolomeo', tenantId: 'San-Bartolomeo-yp3kp' });
  await createOnly(`${root}/users/${SAN_ADMIN_UID}`, {
    name: 'Administrador San Bartolomeo', email: 'djsergio013@gmail.com', role: 'admin', active: true, deleted: false,
  });
  let created = 0;
  let existing = 0;
  for (const record of prepared.clients) {
    const { id, ...data } = record;
    const status = await createOnly(`${root}/clients/${id}`, { ...data, userId: SAN_ADMIN_UID });
    if (status === 'created') created += 1;
    else existing += 1;
  }
  console.log(JSON.stringify({ mode: 'applied', created, existing, expected: prepared.count }));
}
