# Resumen de sesión — Universal AI Sync

## Qué hicimos en esta conversación

### 1. Sistema de email (Nodemailer)
- El correo ya estaba implementado en `backend/lib/mailer.js` usando **Nodemailer + SMTP**
- Se envía automáticamente cuando PayPal confirma el pago (en `backend/routes/paypal.js`)
- **Pendiente verificar**: que en el `.env` real la variable se llame `EMAIL_FROM` (no `SMTP_FROM`), porque `mailer.js:20` usa `process.env.EMAIL_FROM`

### 2. Dos planes de PayPal (mensual y anual)
- Ya estaban implementados en `backend/public/checkout.html` con dos botones distintos
- Plan mensual: `P-5DR802526M8121442NIJTWLA`
- Plan anual: `P-62S57222JD689262MNIJT55I`
- PayPal gestiona automáticamente los ciclos de cobro y envía webhooks al cancelar/suspender

### 3. Licencia vinculada a un dispositivo (device binding)
**Archivos modificados:**
- `backend/lib/db.js` — `validateLicense(licenseKey, deviceId)` ahora:
  - Primera activación: guarda el `deviceId` en la columna `device_id` de la DB
  - Activaciones siguientes: solo válido si el `deviceId` coincide
  - Si otro dispositivo intenta usarla: devuelve `status: 'device_mismatch'`
- `backend/routes/license.js` — lee `deviceId` del body y lo pasa a `validateLicense`
- `ai-sync-extension/src/popup/popup.js` — añadida función `getOrCreateDeviceId()` que genera un UUID único por instalación en `chrome.storage.local` y lo envía en cada llamada de validación. Mensaje de error añadido: `"Key already activated on another device"`

### 4. Cooldown del plan free server-side (anti-bypass)
**Problema resuelto**: el cooldown de 5h era solo client-side, se podía saltar borrando `chrome.storage.local`

**Archivos nuevos/modificados:**
- `backend/lib/db.js` — nueva función `checkAndRecordFileSync(deviceId)` que consulta/actualiza la tabla `sync_cooldowns` en Supabase
- `backend/routes/sync.js` — nuevo archivo, endpoint `POST /api/sync/file-check`
- `backend/server.js` — montado el nuevo route: `app.use('/api/sync', require('./routes/sync'))`
- `ai-sync-extension/src/popup/popup.js` — `handleFileSync()` ahora es async y llama al backend antes de ejecutar el sync para usuarios free. Si el backend dice no permitido, arranca el timer con el `availableAt` real del servidor

---

## SQL pendiente de ejecutar en Supabase

Hay que ejecutar esto en el editor SQL de Supabase (en orden):

```sql
-- Tabla principal de usuarios
CREATE TABLE IF NOT EXISTS users (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  text UNIQUE NOT NULL,
  plan                   text NOT NULL DEFAULT 'free',
  status                 text NOT NULL DEFAULT 'active',
  license_key            text,
  paypal_subscription_id text,
  device_id              text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_license_key_idx         ON users (license_key);
CREATE INDEX IF NOT EXISTS users_paypal_subscription_idx ON users (paypal_subscription_id);

-- Vista para el panel de admin
CREATE OR REPLACE VIEW user_stats AS
SELECT
  COUNT(*)                                 AS total,
  COUNT(*) FILTER (WHERE plan = 'premium') AS premium,
  COUNT(*) FILTER (WHERE plan = 'free')    AS free_users;

-- Tabla para cooldown server-side de usuarios free
CREATE TABLE IF NOT EXISTS sync_cooldowns (
  device_id    text PRIMARY KEY,
  last_sync_at timestamptz NOT NULL DEFAULT now()
);
```

---

## Estado del proyecto al finalizar la sesión

| Funcionalidad | Estado |
|---|---|
| Email con licencia al pagar | Implementado (verificar `EMAIL_FROM` en .env) |
| Dos planes PayPal (mensual/anual) | Funcionando |
| Licencia bloqueada a un dispositivo | Implementado — falta el SQL |
| Cooldown free plan server-side | Implementado — falta el SQL |
| Webhooks PayPal (renovación, cancelación, suspensión) | Funcionando |
| Auto-activación desde success.html | Funcionando |
| Panel de admin | Funcionando (MRR solo cuenta mensual, no es crítico) |

---

## Para retomar

1. Ejecutar el SQL de arriba en Supabase
2. Verificar que `.env` tenga `EMAIL_FROM` (no `SMTP_FROM`)
3. Hacer build de la extensión y subir nueva versión al Chrome Web Store con los cambios de `device_id` y cooldown server-side
4. Probar el flujo completo: pago → email → activación de licencia → intentar activar en otro dispositivo (debe fallar)
