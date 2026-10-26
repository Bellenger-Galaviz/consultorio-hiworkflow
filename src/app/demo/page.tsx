import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  MessageCircle,
  Search,
  Users
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const week = [
  {
    day: "Lunes",
    date: "26/10/2026",
    appointments: [
      { time: "09:00", client: "Mariana López", title: "Consulta inicial", tone: "confirmed" },
      { time: "12:30", client: "Carlos Ortega", title: "Seguimiento", tone: "pending" },
      { time: "17:00", client: "Sofía Ramírez", title: "Valoración", tone: "confirmed" }
    ]
  },
  {
    day: "Martes",
    date: "27/10/2026",
    appointments: [
      { time: "10:00", client: "Diego Torres", title: "Seguimiento", tone: "confirmed" },
      { time: "16:30", client: "Elena Cruz", title: "Consulta", tone: "pending" }
    ]
  },
  {
    day: "Miércoles",
    date: "28/10/2026",
    appointments: [
      { time: "11:00", client: "Natalia Silva", title: "Primera cita", tone: "confirmed" },
      { time: "18:15", client: "Luis Mendoza", title: "Control", tone: "confirmed" }
    ]
  },
  {
    day: "Jueves",
    date: "29/10/2026",
    appointments: [
      { time: "09:30", client: "Fernanda Ruiz", title: "Seguimiento", tone: "pending" },
      { time: "14:00", client: "Mateo García", title: "Consulta", tone: "confirmed" }
    ]
  },
  {
    day: "Viernes",
    date: "30/10/2026",
    appointments: [
      { time: "10:30", client: "Andrea Flores", title: "Valoración", tone: "confirmed" },
      { time: "13:00", client: "Jorge Nava", title: "Control", tone: "pending" }
    ]
  }
];

const upcoming = [
  { number: 24, client: "Mariana López", title: "Consulta inicial", time: "09:00", status: "Confirmada" },
  { number: 25, client: "Carlos Ortega", title: "Seguimiento", time: "12:30", status: "Pendiente" },
  { number: 26, client: "Sofía Ramírez", title: "Valoración", time: "17:00", status: "Confirmada" }
];

const conversations = [
  { name: "Mariana López", preview: "Perfecto, ahí estaré. Gracias.", time: "08:42", active: true },
  { name: "Carlos Ortega", preview: "¿Podemos mover la cita para mañana?", time: "08:18", active: false },
  { name: "Sofía Ramírez", preview: "Confirmo mi asistencia.", time: "Ayer", active: false }
];

export const metadata = {
  title: "Demo | HiWorkflow Consultorio",
  description: "Demostración pública del sistema de gestión de citas y WhatsApp para consultorios."
};

export default function DemoPage() {
  return (
    <main className="min-h-screen bg-paper pb-10">
      <header className="border-b border-black/10 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-36 items-center justify-center rounded-md bg-black px-3 py-2">
              <Image alt="HiWorkflow" className="h-auto w-full object-contain" height={64} priority src="/hiworkflow-logo-wide.png" width={180} />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-leaf">Panel del consultorio</p>
              <h1 className="text-2xl font-bold text-ink md:text-3xl">Agenda y atención de pacientes</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-md border border-leaf/20 bg-mint px-3 py-2 text-sm font-semibold text-leaf">
              Demo con datos ficticios
            </span>
            <Link className="secondary-button" href="/login">Iniciar sesión</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <section aria-label="Resumen del día" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric icon={<CalendarClock size={20} />} label="Citas de hoy" value="3" />
          <Metric icon={<CheckCircle2 size={20} />} label="Confirmadas" value="2" />
          <Metric icon={<Clock3 size={20} />} label="Pendientes" value="1" />
          <Metric icon={<Users size={20} />} label="Pacientes activos" value="38" />
        </section>

        <Panel icon={<CalendarClock size={18} />} title="Calendario semanal">
          <div className="grid gap-3 md:grid-cols-5">
            {week.map((column) => (
              <article className="min-h-56 rounded-md border border-black/10 bg-white p-3" key={column.date}>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-ink">{column.day}</p>
                    <p className="text-xs font-semibold text-ink/55">{column.date}</p>
                  </div>
                  <span className="text-xs font-semibold text-ink/50">{column.appointments.length}</span>
                </div>
                <div className="grid gap-2">
                  {column.appointments.map((appointment) => (
                    <div
                      className={`rounded-md px-2 py-2 text-xs ${appointment.tone === "confirmed" ? "bg-mint text-leaf" : "bg-amber/20 text-ink"}`}
                      key={`${column.date}-${appointment.time}`}
                    >
                      <p className="font-bold">{appointment.time}</p>
                      <p className="line-clamp-1 font-semibold">{appointment.client}</p>
                      <p className="line-clamp-1 opacity-75">{appointment.title}</p>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </Panel>

        <Panel icon={<CalendarClock size={18} />} title="Próximas citas">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <p className="text-sm font-semibold text-ink/60">Mostrando citas para 26/10/2026</p>
            <div className="flex items-end gap-2">
              <label className="grid gap-1">
                <span className="label">Día</span>
                <input className="field w-44" defaultValue="2026-10-26" type="date" />
              </label>
              <button className="secondary-button" type="button">Hoy</button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border border-black/10">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-ink text-white">
                <tr>
                  <th className="px-3 py-2">Paciente</th>
                  <th className="px-3 py-2">Cita</th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Expediente</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10 bg-white">
                {upcoming.map((appointment) => (
                  <tr key={appointment.number}>
                    <td className="px-3 py-3 font-semibold">{appointment.client}</td>
                    <td className="px-3 py-3">
                      <span className="block text-xs font-semibold text-leaf">Cita #{appointment.number}</span>
                      {appointment.title}
                    </td>
                    <td className="px-3 py-3">26/10/2026, {appointment.time}</td>
                    <td className="px-3 py-3">
                      <span className={`status-pill ${appointment.status === "Confirmada" ? "bg-mint text-leaf" : "bg-amber/20 text-ink"}`}>
                        {appointment.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2">
                        <button className="icon-button" title="Ver notas" type="button"><FileText size={16} /></button>
                        <button className="icon-button" title="Abrir conversación" type="button"><MessageCircle size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel icon={<MessageCircle size={18} />} id="crm-whatsapp" title="CRM de WhatsApp">
          <div className="grid min-h-[360px] overflow-hidden rounded-md border border-black/10 bg-white lg:grid-cols-[340px_1fr]">
            <aside className="border-b border-black/10 lg:border-b-0 lg:border-r">
              <div className="border-b border-black/10 p-3">
                <div className="flex items-center gap-2 rounded-md border border-black/10 px-3 py-2 text-sm text-ink/55">
                  <Search size={16} /> Buscar paciente
                </div>
              </div>
              {conversations.map((conversation) => (
                <div className={`border-b border-black/10 p-4 ${conversation.active ? "bg-mint/60" : "bg-white"}`} key={conversation.name}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-ink">{conversation.name}</p>
                    <span className="text-xs text-ink/50">{conversation.time}</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-ink/60">{conversation.preview}</p>
                </div>
              ))}
            </aside>
            <section className="flex min-h-[360px] flex-col bg-paper">
              <div className="border-b border-black/10 bg-white px-5 py-4">
                <p className="font-bold text-ink">Mariana López</p>
                <p className="text-sm text-ink/55">Conversación vinculada a su expediente</p>
              </div>
              <div className="flex flex-1 flex-col justify-end gap-3 p-5">
                <div className="max-w-lg rounded-md border border-black/10 bg-white px-4 py-3 text-sm text-ink">
                  Hola Mariana, le recordamos su cita de mañana a las 9:00. ¿Podrá asistir?
                  <p className="mt-1 text-right text-xs text-ink/45">08:40</p>
                </div>
                <div className="ml-auto max-w-lg rounded-md bg-leaf px-4 py-3 text-sm text-white">
                  Perfecto, ahí estaré. Gracias.
                  <p className="mt-1 text-right text-xs text-white/70">08:42</p>
                </div>
              </div>
              <div className="border-t border-black/10 bg-white p-3">
                <div className="rounded-md border border-black/10 px-3 py-3 text-sm text-ink/45">Escribe un mensaje...</div>
              </div>
            </section>
          </div>
        </Panel>
      </div>
    </main>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-black/10 bg-white p-4 shadow-soft">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-mint text-leaf">{icon}</div>
      <p className="text-sm font-semibold text-ink/60">{label}</p>
      <p className="text-3xl font-bold text-ink">{value}</p>
    </div>
  );
}

function Panel({
  children,
  icon,
  id,
  title
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  id?: string;
  title: string;
}) {
  return (
    <section className="rounded-md border border-black/10 bg-white p-4 shadow-soft" id={id}>
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-paper text-leaf">{icon}</span>
        <h2 className="text-lg font-bold text-ink">{title}</h2>
      </div>
      {children}
    </section>
  );
}
