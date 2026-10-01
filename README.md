# Control San Bartolomeo

Panel de San Bartolomeo Inmobiliaria, basado en el control de El Refugio de Carhuaz. Conserva clientes, cuotas, vouchers, boletas, libro de observaciones, reportes, roles, historial y minutas. Su dominio sigue siendo [control-san-bartolomeo.web.app](https://control-san-bartolomeo.web.app).

## Sistema Central y aislamiento

- El nombre visible del proyecto Firebase compartido es **Sistema Central**. Su ID técnico, que no cambia al renombrarlo, es `villa-hermosa-lotes`.
- San usa `projects/san-bartolomeo/{clients,users,userEvents,minutes,auditLogs,limaSales,salesEvents}` en Firestore y `projects/san-bartolomeo/clients/...` en Storage. Refugio usa `projects/refugio-carhuaz/...` y Villa conserva sus rutas históricas.
- San autentica exclusivamente en el tenant de Identity Platform `San-Bartolomeo-yp3kp`. El mismo correo puede tener otra contraseña en el espacio predeterminado de Refugio. Nunca se debe quitar `auth.tenantId` de `src/services/firebase.ts` ni del autenticador secundario en `src/services/staffUsers.ts`.
- Las reglas publicadas en Sistema Central exigen tenant, perfil activo y rol para San. No se debe publicar el `firestore.rules` o `storage.rules` antiguo de este repositorio sobre Sistema Central.
- El sitio se publica **solo con Hosting** en `control-san-bartolomeo`:

```powershell
pnpm build
firebase deploy --only hosting --project control-san-bartolomeo
```

Las reglas centrales se mantienen en el repositorio de Villa Hermosa (`firestore.rules` y `storage.rules`); se despliegan allí con `--project villa-hermosa-lotes`. Un despliegue sin `--only hosting` desde este repositorio podría publicar reglas antiguas en el proyecto Hosting de San, no en Sistema Central.

## Importación 2026

`scripts/prepare_import.py` lee `DATA ANUAL DE SAN BARTOLOME 2026.xlsx`; `scripts/publish_import.mjs` crea documentos sin sobrescribir registros existentes. La importación inicial contiene **63 lotes únicos** y **5 observaciones** del Excel. No se copiaron clientes de Refugio.

El Excel no incluye fechas exactas de vencimiento, pagos efectuados, vouchers ni boletas. Por eso los 63 clientes tienen `importReview.status = pending`, `cuotas = []`, conservan los valores originales y aparecen en **Clientes → Completar** para revisión. No se generan estados de pago, mora o cronogramas supuestos. Algunos metrajes y montos contienen cifras inusuales o caracteres `O` ambiguos: deben verificarse con documentos de venta antes de emitir documentos definitivos. Una anotación como «CANCELO LA TOTALIDAD DE SU TERRENO» se conserva en el libro, pero no se convierte en cuota pagada sin evidencia de importe y fecha.

El script publica únicamente tras pasar `--apply` y requiere credenciales autorizadas de Firebase CLI y las variables `SAN_WORKBOOK`, `SAN_PYTHON`, `SAN_ADMIN_UID` y `FIREBASE_TOOLS_LIB`. No se guarda el Excel ni un JSON con datos personales en Git. Evita reimportar una versión modificada sin revisar los conflictos de lotes.

## Desarrollo y control

Las cuotas mensuales pendientes tienen siete días calendario de gracia tras el vencimiento. Desde el octavo día se muestra una mora de **S/ 2 por día** en Detalle de Cuotas, cronogramas y reporte de deudores. La inicial queda excluida. La mora de un pago se fija según su fecha de pago y no sigue creciendo; los pagos con fecha anterior al 1 de octubre de 2026 conservan la mora histórica registrada (o cero si no la tenían). Una mora ajustada manualmente por un administrador conserva prioridad. La política solo se configura en esta aplicación, no en los otros proyectos del Firebase central.

```powershell
pnpm install
pnpm dev
pnpm lint
pnpm exec tsc -b --noEmit
pnpm build
```

`?demo` está disponible solo en desarrollo con datos ficticios. El logo y las fotografías de San siguen en `public/brand`. Las minutas son borradores para revisión legal; los campos de empresa y cuentas bancarias deben completarse con información oficial antes de entregar documentos. No se reutilizan cuentas bancarias de Refugio o Villa.
