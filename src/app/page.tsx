import {
  CalendarClock,
  Clock3,
  LogOut,
  MessageCircle,
  Plus,
  UserPlus,
  Users
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, getStatusLabel } from "@/lib/format";
import {
  createAppointment,
  createClient,
  sendAppointmentReminder,
  updateAppointmentStatus
} from "./actions";
import { AppointmentForm } from "./appointment-form";
import { logoutDoctor } from "./auth-actions";

export const dynamic = "force-dynamic";

const statusClass: Record<string, string> = {
  PENDING: "bg-amber/20 text-ink",
  CONFIRMED: "bg-mint text-leaf",
  CANCELLED: "bg-coral/15 text-coral",
  ATTENDED: "bg-leaf text-white",
  MISSED: "bg-ink/10 text-ink",
  REPROGRAM_PENDING: "bg-amber/20 text-ink",
  REPROGRAMMED: "bg-ink/10 text-ink",
  SENT: "bg-mint text-leaf",
  FAILED: "bg-coral/15 text-coral"
};

export default async function Home({
  searchParams
}: {
  searchParams: Promise<{ day?: string; error?: string; success?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const selectedDay = getSelectedDay(params.day);
  const { startOfDay, endOfDay } = getDayBounds(selectedDay);
  const todayStart = getDayBounds(formatInputDate(new Date())).startOfDay;

  const [clients, appointments, dayAppointments, reminders, blockingAppointments] = await Promise.all([
    prisma.client.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.appointment.findMany({
      where: {
        userId: user.id,
        startsAt: { gte: todayStart }
      },
      include: { client: true },
      orderBy: { startsAt: "asc" },
      take: 20
    }),
    prisma.appointment.findMany({
      where: {
        userId: user.id,
        startsAt: {
          gte: startOfDay,
          lt: endOfDay
        }
      },
      orderBy: { startsAt: "asc" }
    }),
    prisma.reminderLog.findMany({
      where: { userId: user.id },
      include: { client: true, appointment: true },
      orderBy: { sentAt: "desc" },
      take: 8
    }),
    prisma.appointment.findMany({
      where: {
        userId: user.id,
        startsAt: { gte: todayStart },
        status: { in: ["PENDING", "CONFIRMED", "REPROGRAM_PENDING"] }
      },
      include: { client: true },
      orderBy: { startsAt: "asc" }
    })
  ]);

  const dayStats = {
    total: dayAppointments.length,
    confirmed: dayAppointments.filter((item) => item.status === "CONFIRMED").length,
    pending: dayAppointments.filter((item) => item.status === "PENDING").length,
    cancelled: dayAppointments.filter((item) => item.status === "CANCELLED").length,
    postponed: dayAppointments.filter((item) =>
      ["REPROGRAM_PENDING", "REPROGRAMMED"].includes(item.status)
    ).length
  };

  return (
    <main className="min-h-screen">
      <header className="border-b border-black/10 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-leaf">
              Panel administrativo de {user.name}
            </p>
            <h1 className="text-2xl font-bold text-ink md:text-3xl">
              Control de citas, asistencias y recordatorios
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-ink/70">
            <div className="flex items-center gap-2">
              <Clock3 size={18} />
              <span>{formatDate(new Date())}</span>
            </div>
            <form action={logoutDoctor}>
              <button className="secondary-button" type="submit">
                <LogOut size={16} />
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <FlashMessage error={params.error} success={params.success} />

        <Panel title="Resumen del día" icon={<CalendarClock size={18} />}>
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold text-ink/60">
                Citas programadas para {formatDate(startOfDay)}
              </p>
            </div>
            <form className="flex items-end gap-2" method="get">
              <label className="grid gap-1">
                <span className="label">Día</span>
                <input className="field w-44" defaultValue={selectedDay} name="day" type="date" />
              </label>
              <button className="secondary-button" type="submit">
                Ver día
              </button>
            </form>
          </div>

          <section className="grid gap-4 md:grid-cols-5">
            <Metric icon={<CalendarClock size={20} />} label="Citas del día" value={dayStats.total} />
            <Metric icon={<CalendarClock size={20} />} label="Confirmadas" value={dayStats.confirmed} />
            <Metric icon={<CalendarClock size={20} />} label="Pendientes" value={dayStats.pending} />
            <Metric icon={<CalendarClock size={20} />} label="Canceladas" value={dayStats.cancelled} />
            <Metric icon={<CalendarClock size={20} />} label="Pospuestas" value={dayStats.postponed} />
          </section>
        </Panel>

        <section>
          <Panel title="Próximas citas" icon={<CalendarClock size={18} />}>
            <div className="overflow-x-auto rounded-md border border-black/10">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="bg-ink text-white">
                  <tr>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Cita</th>
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10 bg-white">
                  {appointments.map((appointment) => (
                    <tr key={appointment.id}>
                      <td className="px-3 py-3 font-medium">{appointment.client.fullName}</td>
                      <td className="px-3 py-3">{appointment.title}</td>
                      <td className="px-3 py-3">{formatDateTime(appointment.startsAt)}</td>
                      <td className="px-3 py-3">
                        <span className={`status-pill ${statusClass[appointment.status]}`}>
                          {getStatusLabel(appointment.status)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          <form action={sendAppointmentReminder}>
                            <input name="appointmentId" type="hidden" value={appointment.id} />
                            <button className="icon-button" title="Enviar WhatsApp ahora" type="submit">
                              <MessageCircle size={16} />
                            </button>
                          </form>
                          <StatusButton id={appointment.id} status="CONFIRMED" label="Confirmar" />
                          <StatusButton id={appointment.id} status="ATTENDED" label="Asistió" />
                          <StatusButton id={appointment.id} status="MISSED" label="No asistió" />
                          <StatusButton id={appointment.id} status="CANCELLED" label="Canceló" />
                          <StatusButton id={appointment.id} status="REPROGRAM_PENDING" label="Pospuso" />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {appointments.length === 0 ? (
                    <tr>
                      <td className="px-3 py-8 text-center text-ink/60" colSpan={5}>
                        Sin citas próximas.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>

        <section className="grid items-start gap-5 lg:grid-cols-[0.85fr_1.65fr]">
          <Panel title="Nuevo cliente" icon={<UserPlus size={18} />}>
            <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink/60">
              <Users size={16} />
              {clients.length} clientes registrados en el consultorio
            </p>
            <form action={createClient} className="grid gap-3">
              <Field label="Nombre completo" minLength={2} name="fullName" placeholder="Nombre del cliente" required />
              <Field label="WhatsApp" maxLength={20} minLength={8} name="phone" placeholder="5216141234567" required />
              <Field label="Correo" name="email" placeholder="cliente@correo.com" type="email" />
              <label className="grid gap-1">
                <span className="label">Notas</span>
                <textarea className="field min-h-16 resize-y" name="notes" />
              </label>
              <button className="primary-button" type="submit">
                <Plus size={16} />
                Guardar cliente
              </button>
            </form>
          </Panel>

          <Panel title="Nueva cita" icon={<CalendarClock size={18} />}>
            <AppointmentForm
              action={createAppointment}
              appointments={blockingAppointments.map((appointment) => ({
                clientName: appointment.client.fullName,
                durationMin: appointment.durationMin,
                id: appointment.id,
                startsAt: appointment.startsAt.toISOString(),
                status: appointment.status
              }))}
              clients={clients.map((client) => ({
                fullName: client.fullName,
                id: client.id
              }))}
            />
          </Panel>
        </section>

        <section className="grid gap-5">
          <Panel title="Historial de WhatsApp" icon={<MessageCircle size={18} />}>
            <List>
              {reminders.map((reminder) => (
                <li className="grid gap-1 px-4 py-3" key={reminder.id}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{reminder.client.fullName}</p>
                    <span className={`status-pill ${statusClass[reminder.status]}`}>
                      {getStatusLabel(reminder.status)}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-sm text-ink/65">{reminder.message}</p>
                  <p className="text-xs text-ink/45">
                    {getReminderTypeLabel(reminder.type)} - {formatDateTime(reminder.sentAt)}
                  </p>
                </li>
              ))}
            </List>
          </Panel>
        </section>
      </div>
    </main>
  );
}

function Metric({
  icon,
  label,
  value
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md border border-black/10 bg-white p-4">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-mint text-leaf">
        {icon}
      </div>
      <p className="text-sm font-semibold text-ink/60">{label}</p>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  );
}

function Panel({
  title,
  icon,
  children
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-black/10 bg-white p-4 shadow-soft">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-paper text-leaf">
          {icon}
        </span>
        <h2 className="text-lg font-bold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function FlashMessage({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) {
    return null;
  }

  const isError = Boolean(error);
  const message = error ?? success;

  return (
    <div
      className={`rounded-md border px-4 py-3 text-sm font-semibold ${
        isError
          ? "border-coral/30 bg-coral/10 text-coral"
          : "border-leaf/20 bg-mint text-leaf"
      }`}
    >
      {message}
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  placeholder,
  defaultValue,
  required = false,
  minLength,
  maxLength,
  min,
  max
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: string;
  max?: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="label">{label}</span>
      <input
        className="field"
        defaultValue={defaultValue}
        max={max}
        maxLength={maxLength}
        min={min}
        minLength={minLength}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </label>
  );
}

function ClientSelect({
  clients
}: {
  clients: Array<{ id: string; fullName: string }>;
}) {
  return (
    <label className="grid gap-1">
      <span className="label">Cliente</span>
      <select className="field" name="clientId" required>
        <option value="">Selecciona un cliente</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.fullName}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusButton({
  id,
  status,
  label
}: {
  id: string;
  status: string;
  label: string;
}) {
  return (
    <form action={updateAppointmentStatus}>
      <input name="id" type="hidden" value={id} />
      <input name="status" type="hidden" value={status} />
      <button className="secondary-button" type="submit">
        {label}
      </button>
    </form>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-black/10 overflow-hidden rounded-md border border-black/10">{children}</ul>;
}

function getReminderTypeLabel(type: string) {
  const labels: Record<string, string> = {
    MANUAL: "Manual",
    REMINDER_24H: "24 horas antes",
    REMINDER_1H: "1 hora antes"
  };

  return labels[type] ?? type;
}

function getSelectedDay(day?: string) {
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return day;
  }

  return formatInputDate(new Date());
}

function getDayBounds(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  const startOfDay = new Date(year, month - 1, date, 0, 0, 0, 0);
  const endOfDay = new Date(year, month - 1, date + 1, 0, 0, 0, 0);

  return { startOfDay, endOfDay };
}

function formatInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
