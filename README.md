# Control de asistencias, citas y recordatorios

Sistema web en Next.js para administrar clientes, citas, asistencias y recordatorios por WhatsApp usando n8n como puente hacia Evolution API.

## Stack

- Next.js App Router
- React
- Prisma
- SQLite para desarrollo local
- Webhook configurable de n8n para WhatsApp
- Login y registro de doctores
- Datos separados por doctor
- Recordatorios automáticos 24 horas antes y 1 hora antes

## Primer arranque local

1. Instala dependencias:

```powershell
npm install
```

2. Crea tu archivo de entorno:

```powershell
Copy-Item .env.example .env
```

3. Para desarrollo necesitas una base PostgreSQL local o remota y ajustar `DATABASE_URL`.

4. Genera Prisma Client:

```powershell
npm run prisma:generate
```

5. Crea la base y datos de prueba:

```powershell
npm run db:init
```

Este comando crea un usuario demo:

```text
Correo: doctor@demo.com
Contraseña: Demo12345
```

6. Arranca el proyecto:

```powershell
npm run dev
```

7. Abre:

```text
http://localhost:3000
```

## Variables de entorno

```env
DATABASE_URL="file:./dev.db"
N8N_REMINDER_WEBHOOK_URL="https://n8n.hiworkflow.mx/webhook/recordatorio-cita"
N8N_WEBHOOK_SECRET="cambia-este-secreto"
APP_PUBLIC_URL="https://consultorio.hiworkflow.mx"
```

## Flujo de WhatsApp con n8n

La plantilla importable está en:

```text
docs/n8n-evolution-whatsapp-workflow.json
```

La plantilla para ejecutar los automáticos cada 15 minutos está en:

```text
docs/n8n-schedule-due-reminders-workflow.json
```

La plantilla para recibir respuestas de clientes por WhatsApp está en:

```text
docs/n8n-inbound-whatsapp-bot-workflow.json
```

La guía completa está en:

```text
docs/N8N_WHATSAPP.md
```

Cuando presionas el boton de WhatsApp en una cita, el sistema envia un `POST` a `N8N_REMINDER_WEBHOOK_URL` con este formato:

```json
{
  "event": "appointment.reminder.requested",
  "sentFrom": "http://localhost:3000",
  "client": {
    "id": "client_id",
    "fullName": "Ana Martinez",
    "phone": "5216141234567",
    "email": "ana@example.com"
  },
  "appointment": {
    "id": "appointment_id",
    "title": "Consulta inicial",
    "startsAt": "2026-05-14T10:00:00.000Z",
    "durationMin": 45,
    "status": "CONFIRMED"
  },
  "whatsapp": {
    "to": "5216141234567",
    "message": "Hola Ana Martinez..."
  }
}
```

## Recordatorios automáticos

La app incluye un endpoint para enviar recordatorios pendientes:

```text
POST /api/reminders/due
Header: x-webhook-secret: cambia-este-secreto
```

Este endpoint debe ejecutarse de forma programada, por ejemplo cada 15 minutos desde n8n, cron-job.org, Vercel Cron o el hosting que uses.

Envia automaticamente:

- 24 horas antes de la cita: `Hola {cliente}, te recordamos que tienes una cita "{titulo}" programada para {fecha}. Por favor confirma tu asistencia.`
- 1 hora antes de la cita: `Hola {cliente}, tu cita "{titulo}" es en aproximadamente 1 hora. Te esperamos.`

El boton de WhatsApp en la tabla queda para envios manuales, por ejemplo cuando quieres reenviar un recordatorio, confirmar algo al momento o probar que el flujo de n8n funciona.

## Bot de WhatsApp

El endpoint de respuestas entrantes es:

```text
POST /api/whatsapp/inbound
Header: x-webhook-secret: cambia-este-secreto
```

Acepta JSON flexible:

```json
{
  "phone": "5216141234567",
  "message": "confirmo"
}
```

Acciones soportadas:

- Confirmar cita: `confirmo`, `si`, `ok`, `asisto`, `voy`.
- Pedir reprogramación: `cancelar`, `reprogramar`, `cambiar`, `no puedo`.
- Registrar nueva fecha: `25/05/2026 16:30`.

Cuando se reprograma, la cita original queda como `REPROGRAMMED` y se crea una cita nueva con sus propios recordatorios.

En n8n puedes crear:

1. Webhook node que reciba el payload.
2. IF node para validar el header `x-webhook-secret`.
3. HTTP Request node hacia Evolution API.
4. Respuesta final al sistema con `200 OK`.

## Publicacion futura

La guía para DigitalOcean está en:

```text
DEPLOY_DIGITALOCEAN.md
```

Para subirlo con dominio se recomienda:

- Cambiar la base a PostgreSQL en hosting como Neon, Supabase, Railway o Render.
- Ajustar `DATABASE_URL`.
- Cambiar `APP_PUBLIC_URL` por tu dominio real.
- Usar HTTPS para n8n y para la web.

Cuando elijas hosting, el siguiente paso sera preparar el proyecto para produccion y conectar dominio.
