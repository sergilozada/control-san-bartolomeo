# Control San Bartolomeo

Panel independiente para clientes, lotes, cuotas, pagos y documentos de San Bartolomeo S.A.C. Se creó a partir de la estructura del control de Villa Hermosa, sin usar su proyecto Firebase ni su repositorio.

## Estado

- La aplicación compila y muestra una pantalla de configuración hasta conectarla a un Firebase nuevo.
- En **Clientes**, «No adeudo» genera un PDF para revisión cuando todas las cuotas registradas están pagadas.
- En **Atrasados**, «Borrador de resolución» se habilita con tres cuotas vencidas e impagas. No cambia el contrato ni envía comunicaciones.
- **Historial** muestra al administrador los cambios de clientes y cuotas, con usuario y fecha. Las reglas de Firestore restringen su lectura.
- **Minutas** queda visible, pendiente de una plantilla y un servicio propios de San Bartolomeo. Nunca debe conectarse al servicio de Villa Hermosa.

## Configuración de Firebase paso a paso

1. En [Firebase Console](https://console.firebase.google.com/), crea un **proyecto nuevo** con un ID distinto de `villa-hermosa-lotes` y `minutas-villa-hermosa`. Anota el ID exacto.
2. Agrega una aplicación web. Copia los seis valores de `firebaseConfig` a un archivo nuevo `.env.local` usando `.env.example`. Nunca copies las variables del proyecto de Villa Hermosa.
3. En **Authentication → Sign-in method**, habilita **Correo electrónico/Contraseña**. En **Authentication → Users**, crea la primera cuenta administradora. Copia su UID.
4. Crea **Cloud Firestore** en modo producción. En la colección `users`, crea el documento cuyo ID es exactamente ese UID, con `name` (texto), `role` = `admin` (texto) y `active` = `true` (booleano). Este perfil inicial se crea desde la consola porque aún no existe un admin en la app.
5. Crea **Cloud Storage** si usarás vouchers, boletas y minutas adjuntas. Para un bucket nuevo, Firebase exige el plan Blaze; revisa precios y alertas de presupuesto en la consola antes de habilitarlo.
6. Instala Node.js y Firebase CLI si faltan. En esta carpeta ejecuta `pnpm install`, `pnpm build`, `firebase login` y `firebase use --add`. Selecciona exclusivamente el proyecto nuevo. Elige un alias como `san-bartolomeo`.
7. Revisa que `.firebaserc` contenga solo el ID nuevo. Publica reglas y sitio con `firebase deploy --only firestore:rules,storage,hosting --project ID_NUEVO`. La carpeta pública de Hosting ya está definida como `dist` y las rutas usan `index.html`.
8. Inicia sesión con el admin. Para cada persona adicional, crea su cuenta en Authentication y un documento `users/{UID}` con `name`, `role` (`admin`, `full` o `readonly`) y `active: true`. `full` ve y edita sus clientes; `readonly` solo lee los suyos; `admin` ve todos y el historial. No reutilices UIDs del proyecto anterior.
9. Verifica en el sitio nuevo: acceso de admin, creación y edición de un cliente de prueba, registro de una cuota pagada, historial visible solo para admin y acceso denegado a un usuario sin perfil.

Para desarrollo local: `pnpm dev`. Si `.env.local` no existe, verás la pantalla de configuración. Los valores de la configuración web de Firebase se incorporan al paquete del navegador; la seguridad depende de Authentication y de `firestore.rules`/`storage.rules`, no de ocultar el API key.

## Documentos y decisiones pendientes

Los contratos de muestra J-15 y M-09 indican en la cláusula 6.1 **dos cuotas impagas**, y la cláusula de resolución exige comunicación escrita al adquirente. El botón se fijó provisionalmente en **tres cuotas vencidas e impagas** según la solicitud. Confirma si «tercera cuota» significa eso o la cuota número 3 del cronograma. Un responsable debe revisar el contrato firmado de cada cliente y los pagos antes de firmar o notificar cualquier borrador.

La mora usa S/ 2 por día desde el octavo día de atraso, interpretado como S/ 2 el día 8, S/ 4 el día 9, etc. Confirma esta interpretación con cobranzas. Los números de cuenta y teléfono de Villa Hermosa se eliminaron; reemplaza «Por confirmar» por los datos oficiales de San Bartolomeo antes de entregar cronogramas.

## GitHub

Este directorio es un proyecto Git separado. Publícalo en un repositorio **privado** nuevo, sin arrastrar el remoto de Villa Hermosa. `.env.local`, `node_modules` y `dist` están ignorados. Los contratos de muestra contienen datos de clientes y no se incluyen en el repositorio.
