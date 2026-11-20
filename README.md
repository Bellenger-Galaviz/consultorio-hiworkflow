HiWorkflow Consultorio

Appointment, patient and WhatsApp management for small medical clinics. Built to replace the paper agenda and the stream of phone calls for confirmations, cancellations and rescheduling.

Stack: Next.js 15 (App Router) · React 19 · TypeScript · PostgreSQL + Prisma · Tailwind CSS · Zod

Live demo: https://consultorio-hiworkflow.vercel.app/demo — fictitious data, no sign-up needed.

Deployment status: ran in production on DigitalOcean (PostgreSQL + PM2 + local file storage) until I took the server down rather than keep paying for it while the product had no customers. It now runs on Vercel with Supabase (PostgreSQL + object storage) so it can be opened and tried at any time. The screenshots below are from the running app, and npm run dev brings up a working instance with seeded demo data in about two minutes.

Screenshots

Weekly calendar and upcoming appointments

Dashboard

WhatsApp CRM, integrated per patient

WhatsApp CRM

What it does

Appointments

Weekly calendar with per-appointment status, full history and rescheduling
Waitlist that picks up slots when someone cancels
Automatic reminders over WhatsApp

WhatsApp as the front door

Patients reply in plain language — "no puedo el martes", "sí ahí estaré", "me lo cambias?" — and the system reads the intent and confirms, cancels or reschedules without a phone call
Every conversation lands in the patient's record, so the clinic sees one thread per person instead of a shared inbox

Patient CRM

History, messages, notes and clinical files per patient
Bulk import from CSV or Excel for clinics migrating off a spreadsheet

Operations

Attendance, cancellation and active-patient metrics
Per-clinic data isolation: each account only ever sees its own records
Architecture
Next.js 15 (App Router)  →  business logic, UI, API routes
Prisma                   →  PostgreSQL
n8n + Evolution API      →  WhatsApp transport and scheduling only

One decision worth calling out: the business logic lives in TypeScript, not in the n8n workflows. n8n handles message transport and triggers; deciding what a reply means and what happens to an appointment is application code that can be read, reviewed and tested. The exported workflows in N8N/ are deliberately thin.

Per-clinic isolation is enforced at the query layer rather than trusted to the UI, so a bug in a component cannot leak another clinic's records.

Running it locally

Requires Node.js 20+ and PostgreSQL.

bash
npm install
cp .env.example .env          # fill in DATABASE_URL
npm run prisma:generate
npm run db:init               # schema + seed with a demo doctor account
npm run dev

Open http://localhost:3000. The seed creates a demo doctor you can sign in as.

/demo runs without a database, with fictitious data — useful for a quick look at the UI.

Checks

bash
npm run build
npx prisma validate
Deployment

Current: Vercel (app) + Supabase (PostgreSQL and file storage).

Previously: a DigitalOcean droplet running PostgreSQL, PM2 and local disk storage, behind a reverse proxy. That setup worked fine; I moved off it because keeping a VPS running for a product with no customers was not worth the monthly cost.

Notes for anyone deploying this:

Vercel's filesystem is ephemeral, so clinical file uploads need S3-compatible object storage — Supabase Storage covers it.
Prisma on a pooled Postgres connection needs both DATABASE_URL (pooled) and DIRECT_URL (direct) set; migrations use the direct one.
The WhatsApp layer needs a reachable n8n instance and Evolution API. Everything else runs without them.

See DEPLOY_DIGITALOCEAN.md for the VPS setup.

Project structure
src/        application code — routes, components, business logic
prisma/     schema, migrations and seed
N8N/        exported workflows (transport only)
docs/       screenshots and notes
public/     static assets
About this project

I designed, built and shipped this on my own: data model, interface, business rules, WhatsApp integration and deployment. It started as a real problem I kept seeing — small clinics running their entire schedule through a notebook and a phone — and I wanted to find out how far one person could take a product end to end with AI-assisted development.

Built with Claude Code and Codex, and reviewed line by line before anything shipped.

License

MIT — see LICENSE.