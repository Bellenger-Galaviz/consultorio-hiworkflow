# HiWorkflow Consultorio

Plataforma web para consultorios que centraliza agenda, pacientes, expedientes y conversaciones de WhatsApp. Está pensada para profesionales de la salud que hoy administran citas manualmente y necesitan reducir confirmaciones, cancelaciones y reprogramaciones por teléfono.

[Aplicación en vivo](https://consultorio.hiworkflow.mx) · [Demo sin datos reales](https://consultorio.hiworkflow.mx/demo) · [Historial de cambios](https://github.com/Bellenger-Galaviz/consultorio-hiworkflow/commits/main)

> La ruta `/demo` utiliza exclusivamente información ficticia y permite revisar la interfaz sin acceder a expedientes reales.

## Vista del producto

![Calendario semanal y próximas citas](docs/screenshots/dashboard.png)

![CRM de WhatsApp integrado](docs/screenshots/crm-whatsapp.png)

## Qué resuelve

- Agenda semanal con estados, historial y reprogramaciones.
- Recordatorios automáticos y conversaciones por WhatsApp.
- Interpretación de respuestas naturales para confirmar, cancelar o mover citas.
- CRM con historial por paciente, mensajes, notas y archivos clínicos.
- Expediente consultable desde el CRM y desde cada cita.
- Importación masiva de pacientes desde CSV o Excel.
- Lista de espera para aprovechar espacios liberados.
- Métricas de asistencia, cancelaciones y pacientes activos.
- Aislamiento de datos por cuenta del consultorio.

## Arquitectura

La lógica de negocio vive en TypeScript. n8n se utiliza como capa de integración con WhatsApp y para ejecutar automatizaciones programadas; sus exportaciones JSON se conservan únicamente como respaldo reproducible de infraestructura.

```text
src/app/                  UI, Server Actions y endpoints HTTP
src/lib/                  citas, recordatorios, WhatsApp y reglas de negocio
prisma/                   modelo relacional y migraciones de PostgreSQL
N8N/                      respaldos importables de los workflows activos
docs/                     documentación operativa e integración
```

Flujo principal:

```text
WhatsApp / Evolution API
          ↓
        n8n
          ↓
Endpoints TypeScript de Next.js
          ↓
Reglas de citas y conversación
          ↓
PostgreSQL / Prisma
```

## Stack

- Next.js 15 con App Router y React 19
- TypeScript
- PostgreSQL y Prisma ORM
- Tailwind CSS y Lucide Icons
- n8n para orquestación
- Evolution API para WhatsApp
- Zod para validación de entradas

## Desarrollo local

Requisitos: Node.js 20 o superior y PostgreSQL.

```powershell
npm install
Copy-Item .env.example .env
npm run prisma:generate
npm run db:init
npm run dev
```

Después abre [http://localhost:3000](http://localhost:3000). La semilla crea una cuenta de demostración:

```text
Correo: doctor@demo.com
Contraseña: Demo12345
```

La demostración pública también está disponible localmente en [http://localhost:3000/demo](http://localhost:3000/demo) y no requiere base de datos.

## Variables de entorno

Crea `.env` a partir de `.env.example`:

```env
DATABASE_URL="postgresql://usuario:password@localhost:5432/consultorio_db?schema=public"
N8N_REMINDER_WEBHOOK_URL="https://tu-n8n.example/webhook/recordatorio-cita"
N8N_WEBHOOK_SECRET="un-secreto-largo-y-aleatorio"
APP_PUBLIC_URL="http://localhost:3000"
```

Nunca publiques `.env`, credenciales de PostgreSQL, claves de OpenAI ni tokens de n8n.

## Base de datos

```powershell
npm run prisma:generate
npm run prisma:deploy
npm run seed
```

Las migraciones incluyen clientes, citas, sesiones, recordatorios, conversaciones, notificaciones, lista de espera, historial de eventos y archivos de expediente.

## Integración con WhatsApp

La aplicación expone endpoints autenticados para recibir mensajes, registrar archivos y solicitar recordatorios. La guía operativa está en [`docs/N8N_WHATSAPP.md`](docs/N8N_WHATSAPP.md).

Los workflows versionados son:

- `N8N/Recordatorio de cita por WhatsApp.json`
- `N8N/Ejecutar recordatorios automáticos de citas.json`
- `N8N/Recibir respuestas WhatsApp y actualizar citas.json`

El código que valida intenciones, conserva contexto, consulta disponibilidad y modifica citas está en [`src/lib/whatsapp-bot.ts`](src/lib/whatsapp-bot.ts), no dentro de los JSON exportados.

## Verificación

```powershell
npm run build
npx prisma validate
```

## Despliegue

El despliegue actual utiliza PostgreSQL, PM2 y almacenamiento local persistente en un servidor de DigitalOcean. Consulta [`DEPLOY_DIGITALOCEAN.md`](DEPLOY_DIGITALOCEAN.md).

Vercel puede ejecutar la aplicación y la ruta de demostración, pero para usar expedientes en producción es necesario reemplazar el almacenamiento local de archivos por almacenamiento persistente compatible con S3. La base de datos también debe ser PostgreSQL externa, por ejemplo Neon, Supabase o Railway.

## Estado del proyecto

El repositorio conserva el historial incremental de implementación: agenda, WhatsApp, agente conversacional, métricas, importación de pacientes, expedientes y correcciones de producción. Consulta el historial con:

```powershell
git log --oneline --graph
```
