# Control San Bartolomeo

Panel independiente para clientes, lotes, cuotas, pagos y documentos de San Bartolomeo S.A.C. Se creó a partir de la estructura del control de Villa Hermosa, sin usar su proyecto Firebase ni su repositorio.

## Estado

- El Firebase independiente `control-san-bartolomeo` ya tiene aplicación web, correo/contraseña y Firestore en `southamerica-west1` (Santiago). Las reglas se publicaron en modo restringido.
- Hosting está publicado en [control-san-bartolomeo.web.app](https://control-san-bartolomeo.web.app). Aún faltan los perfiles reales de usuario antes de entrar al panel.
- Storage exige activar Blaze y un método de facturación. Hasta entonces no funcionarán las cargas de vouchers, boletas ni minutas adjuntas.
- En **Clientes**, «No adeudo» genera un PDF para revisión cuando todas las cuotas registradas están pagadas.
- En **Atrasados**, «Borrador de resolución» se habilita con tres cuotas vencidas e impagas. No cambia el contrato ni envía comunicaciones.
- **Clientes** incluye acceso a minuta, cuotas, edición, libro de observaciones y eliminación (esta última solo para admin). Las observaciones nuevas conservan autor y fecha.
- **Historial** muestra solo al administrador los cambios de clientes, cuotas y borradores de minutas, con usuario y fecha. Las reglas de Firestore restringen su lectura.
- **Minutas** permite crear expedientes para clientes, completar compradores, precio, pagos iniciales y cuotas, guardar borradores y descargar un Word de trabajo. Usa la colección `minutes` del Firebase nuevo y no necesita el servicio de Villa Hermosa.
- Minutas tiene un segundo acceso: el administrador o el usuario legal debe volver a verificar la contraseña de su misma cuenta. Dentro hay un menú propio horizontal (Inicio, Minutas, Nueva minuta y Cerrar sesión de Minutas).
- El diseño propuesto morado y turquesa es ahora el diseño oficial. Los tres PDF de Proyección comparten cabecera morada, logo en la esquina superior derecha, tabla y pie de página.
- La migración de cuotas de Villa Hermosa se retiró de esta aplicación.

## Demostración local del historial

Abre `http://127.0.0.1:5173/?demo`. En la franja superior cambia **Usuario de muestra** a **Registro de pagos**, entra en **Pendientes**, abre las cuotas de un cliente y marca una cuota como pagada. Luego cambia a **Administrador** y entra en **Historial**. Verás el correo ficticio `pagos@sanbartolomeo.example`, la acción, la cuota y la hora. El usuario Pagos no ve Historial. El administrador también puede crear una anotación en **Clientes → Libro de observaciones** y verla registrada. Todo esto se borra al recargar y no crea cuentas ni datos en Firebase.

## Configuración de Firebase paso a paso

1. En [Firebase Console](https://console.firebase.google.com/), crea un **proyecto nuevo** con un ID distinto de `villa-hermosa-lotes` y `minutas-villa-hermosa`. Anota el ID exacto.
2. Agrega una aplicación web. Copia los seis valores de `firebaseConfig` a un archivo nuevo `.env.local` usando `.env.example`. Nunca copies las variables del proyecto de Villa Hermosa.
3. En **Authentication → Sign-in method**, habilita **Correo electrónico/Contraseña**. En **Authentication → Users**, crea la primera cuenta administradora. Copia su UID.
4. Crea **Cloud Firestore** en modo producción. En la colección `users`, crea el documento cuyo ID es exactamente ese UID, con `name` (texto), `role` = `admin` (texto) y `active` = `true` (booleano). Este perfil inicial se crea desde la consola porque aún no existe un admin en la app.
5. Crea **Cloud Storage** si usarás vouchers, boletas y minutas adjuntas. Para un bucket nuevo, Firebase exige el plan Blaze; revisa precios y alertas de presupuesto en la consola antes de habilitarlo.
6. Instala Node.js y Firebase CLI si faltan. En esta carpeta ejecuta `pnpm install`, `pnpm build`, `firebase login` y `firebase use --add`. Selecciona exclusivamente el proyecto nuevo. Elige un alias como `san-bartolomeo`.
7. Revisa que `.firebaserc` contenga solo el ID nuevo. Publica reglas y sitio con `firebase deploy --only firestore:rules,storage,hosting --project ID_NUEVO`. La carpeta pública de Hosting ya está definida como `dist` y las rutas usan `index.html`.
8. Conserva la cuenta administradora del paso 3 y crea tres cuentas adicionales en **Authentication → Users**, una para Pagos, otra para Boletas y otra para Legal. Crea los tres documentos `users/{UID}` correspondientes. En cada documento usa `name` (texto), `role` (texto) y `active: true` (booleano). Los cuatro valores exactos de `role` son: `admin` (control completo e historial), `pagos` (marca cuotas pagadas y administra vouchers), `boletas` (administra boletas), `legal` (Minutas y borradores de resolución). No compartas contraseñas entre personas ni reutilices UIDs del proyecto anterior.
9. En Minutas, `admin` y `legal` ingresan primero al control y después vuelven a introducir la contraseña de su propia cuenta en el acceso de esa sección. El botón Cerrar sesión de Minutas bloquea solo esa sección; Cerrar sesión del encabezado sale de toda la aplicación.
10. Verifica con cuentas de prueba: el admin puede crear y editar clientes; Pagos puede registrar un pago y no editar importe; Boletas puede adjuntar una boleta y no marcar pagos; Legal puede crear una minuta y generar un borrador de resolución, sin editar pagos. Comprueba Historial solo en admin y acceso denegado a un usuario sin perfil.

Para desarrollo local: `pnpm dev`. Si `.env.local` no existe, verás el login con **Entrar a la vista de muestra**. Esa vista usa datos ficticios, ofrece un botón de acceso de muestra a Minutas y solo existe en el servidor de desarrollo. Abre [la vista local](http://127.0.0.1:5173/?demo). Los cambios de la muestra se pierden al recargar. Los valores de la configuración web de Firebase se incorporan al paquete del navegador; la seguridad depende de Authentication y de `firestore.rules`/`storage.rules`, no de ocultar el API key.

## Documentos y decisiones pendientes

Los contratos de muestra J-15 y M-09 indican en la cláusula 6.1 **dos cuotas impagas**, y la cláusula de resolución exige comunicación escrita al adquirente. El botón se fijó provisionalmente en **tres cuotas vencidas e impagas** según la solicitud. Confirma si «tercera cuota» significa eso o la cuota número 3 del cronograma. Un responsable debe revisar el contrato firmado de cada cliente y los pagos antes de firmar o notificar cualquier borrador.

La mora usa S/ 2 por día desde el octavo día de atraso, interpretado como S/ 2 el día 8, S/ 4 el día 9, etc. Confirma esta interpretación con cobranzas. Los números de cuenta y teléfono de Villa Hermosa se eliminaron; reemplaza «Por confirmar» por los datos oficiales de San Bartolomeo antes de entregar cronogramas.

El Word de Minutas es un borrador de datos para revisión. Los contratos de muestra de San Bartolomeo no coinciden con el texto de Villa Hermosa; falta una plantilla legal en blanco aprobada para convertirlo en una minuta contractual final. No se incorporaron cláusulas ni cuentas bancarias de Villa Hermosa.

## GitHub

Este directorio es un proyecto Git separado, publicado en el [repositorio privado de San Bartolomeo](https://github.com/sergilozada/control-san-bartolomeo). `.env.local`, `node_modules` y `dist` están ignorados. Los contratos de muestra contienen datos de clientes y no se incluyen en el repositorio.
