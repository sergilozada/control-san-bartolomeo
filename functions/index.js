const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();
const auth = getAuth();
const roles = new Set(['admin', 'pagos', 'boletas', 'legal', 'consulta']);
const emailPattern = /^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?@sanbartolomeo\.com$/;

function fail(message) { throw new HttpsError('invalid-argument', message); }
function text(value, max) {
  return typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
}

exports.manageStaffUser = onCall({ region: 'southamerica-west1', maxInstances: 5 }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Inicia sesión.');
  const actorUid = request.auth.uid;
  const actorProfile = await db.doc(`users/${actorUid}`).get();
  if (!actorProfile.exists || actorProfile.get('active') !== true || actorProfile.get('role') !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo el administrador puede gestionar usuarios.');
  }
  const actorEmail = request.auth.token.email || '';
  const data = request.data || {};
  const action = data.action;

  if (action === 'crear') {
    const name = text(data.name, 100);
    const jobTitle = text(data.jobTitle, 100);
    const email = text(data.email, 64).toLowerCase();
    const password = typeof data.password === 'string' ? data.password : '';
    if (name.length < 2 || !emailPattern.test(email) || !roles.has(data.role) || password.length < 10 || password.length > 128) {
      fail('Revisa el nombre, correo interno, rol y contraseña inicial.');
    }
    const created = await auth.createUser({ email, password, displayName: name, disabled: false });
    try {
      const batch = db.batch();
      batch.set(db.doc(`users/${created.uid}`), {
        name, email, jobTitle, role: data.role, active: true, deleted: false,
        createdAt: FieldValue.serverTimestamp(), createdBy: actorUid,
      });
      batch.set(db.collection('userEvents').doc(), {
        action: 'crear', targetUid: created.uid, actorUid, actorEmail, createdAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();
      return { uid: created.uid };
    } catch (error) {
      await auth.deleteUser(created.uid).catch(() => undefined);
      throw error;
    }
  }

  const uid = text(data.uid, 128);
  if (!uid || uid === actorUid) fail('No puedes modificar tu propia cuenta desde aquí.');
  const targetRef = db.doc(`users/${uid}`);
  const target = await targetRef.get();
  if (!target.exists) throw new HttpsError('not-found', 'Usuario no encontrado.');
  if (target.get('deleted') === true && action !== 'eliminar') {
    throw new HttpsError('failed-precondition', 'El usuario ya fue eliminado.');
  }

  let changes;
  if (action === 'rol') {
    if (!roles.has(data.role)) fail('Rol inválido.');
    changes = { role: data.role };
  } else if (action === 'suspender' || action === 'reactivar') {
    const disabled = action === 'suspender';
    if (!disabled) await auth.updateUser(uid, { disabled: false });
    changes = { active: !disabled };
  } else if (action === 'eliminar') {
    changes = { active: false, deleted: true };
  } else {
    fail('Operación desconocida.');
  }

  const batch = db.batch();
  batch.update(targetRef, { ...changes, updatedAt: FieldValue.serverTimestamp(), updatedBy: actorUid });
  batch.set(db.collection('userEvents').doc(), {
    action, targetUid: uid, actorUid, actorEmail, createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  if (action === 'suspender') await auth.updateUser(uid, { disabled: true });
  if (action === 'eliminar') {
    try { await auth.deleteUser(uid); }
    catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
  }
  return { ok: true };
});
