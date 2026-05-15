import {
  CalendarClock,
  Clock3,
  LogOut,
  MessageCircle,
  Plus,
  UserPlus,
  Users
} from "lucide-react";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, getStatusLabel } from "@/lib/format";
import { formatInputDate, getClinicDayBounds } from "@/lib/timezone";
import {
  createAppointment,
  createClient,
  deleteClient,
  sendAppointmentReminder,
  updateAppointmentStatus
} from "./actions";
import { AppointmentForm } from "./appointment-form";
import { logoutDoctor } from "./auth-actions";
import { ClientManager } from "./client-manager";
import { CrmPanel } from "./crm-panel";

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
  searchParams: Promise<{
    chatClientId?: string;
    chatSearch?: string;
    day?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const selectedDay = getSelectedDay(params.day);
  const chatSearch = normalizeSearch(params.chatSearch ?? "");
  const { startOfDay, endOfDay } = getClinicDayBounds(selectedDay);
  const todayStart = getClinicDayBounds(formatInputDate(new Date())).startOfDay;

  const [clients, appointments, blockingAppointments, chatThreads] = await Promise.all([
    prisma.client.findMany({ where: { userId: user.id }, orderBy: { fullName: "asc" } }),
    prisma.appointment.findMany({
      where: {
        userId: user.id,
        startsAt: {
          gte: startOfDay,
          lt: endOfDay
        },
        NOT: { status: "REPROGRAMMED" }
      },
      include: { client: true },
      orderBy: { startsAt: "asc" }
    }),
    prisma.appointment.findMany({
      where: {
        userId: user.id,
        startsAt: { gte: todayStart },
        status: { in: ["PENDING", "CONFIRMED", "REPROGRAM_PENDING"] }
      },
      include: { client: true },
      orderBy: { startsAt: "asc" }
    }),
    prisma.client.findMany({
      where: { userId: user.id },
      include: {
        _count: { select: { chatMessages: true, reminders: true } },
        chatMessages: {
          orderBy: { createdAt: "desc" },
          take: 1
        },
        reminders: {
          orderBy: { sentAt: "desc" },
          take: 1
        }
      }
    })
  ]);

  const sortedChatThreads = chatThreads.sort((left, right) => {
    const leftDate = getThreadLastDate(left)?.getTime() ?? 0;
    const rightDate = getThreadLastDate(right)?.getTime() ?? 0;

    if (leftDate !== rightDate) {
      return rightDate - leftDate;
    }

    return left.fullName.localeCompare(right.fullName, "es");
  });
  const filteredChatThreads = chatSearch
    ? sortedChatThreads.filter((client) => normalizeSearch(client.fullName).includes(chatSearch))
    : sortedChatThreads;
  const selectableChatThreads = chatSearch ? filteredChatThreads : sortedChatThreads;
  const selectedChatClientId =
    params.chatClientId && selectableChatThreads.some((client) => client.id === params.chatClientId)
      ? params.chatClientId
      : selectableChatThreads[0]?.id ?? null;
  const [chatMessages, reminderMessages] = selectedChatClientId
    ? await Promise.all([
        prisma.chatMessage.findMany({
          where: {
            userId: user.id,
            clientId: selectedChatClientId
          },
          include: { appointment: true },
          orderBy: { createdAt: "asc" },
          take: 80
        }),
        prisma.reminderLog.findMany({
          where: {
            userId: user.id,
            clientId: selectedChatClientId
          },
          include: { appointment: true },
          orderBy: { sentAt: "asc" },
          take: 80
        })
      ])
    : [[], []];
  const chatMessageKeys = new Set(
    chatMessages.map((message) => `${message.appointmentId ?? ""}:${message.message}`)
  );
  const crmMessages = [
    ...chatMessages,
    ...reminderMessages
      .filter((message) => !chatMessageKeys.has(`${message.appointmentId ?? ""}:${message.message}`))
      .map((message) => ({
        appointment: message.appointment,
        createdAt: message.sentAt,
        direction: "OUTBOUND",
        id: `reminder-${message.id}`,
        intent: message.type,
        message: message.message
      }))
  ].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  const selectedChatClient =
    sortedChatThreads.find((client) => client.id === selectedChatClientId) ?? null;
  const crmThreads = sortedChatThreads.map((client) => {
    const lastMessage = getThreadLastMessage(client);

    return {
      count: client._count.chatMessages + client._count.reminders,
      fullName: client.fullName,
      id: client.id,
      lastAt: lastMessage?.createdAt.toISOString() ?? null,
      lastMessage: lastMessage?.message ?? null,
      phone: client.phone
    };
  });
  const initialCrmMessages = crmMessages.map((message) => ({
    appointmentTitle: message.appointment?.title ?? null,
    createdAt: message.createdAt.toISOString(),
    direction: message.direction,
    id: message.id,
    message: message.message
  }));
  const returnTo = buildHomeHref({
    chatClientId: selectedChatClientId ?? undefined,
    chatSearch: params.chatSearch,
    day: params.day ? selectedDay : undefined
  });
  const dayStats = {
    total: appointments.length,
    confirmed: appointments.filter((item) => item.status === "CONFIRMED").length,
    pending: appointments.filter((item) => item.status === "PENDING").length,
    cancelled: appointments.filter((item) => item.status === "CANCELLED").length,
    postponed: appointments.filter(
      (item) => item.status === "REPROGRAM_PENDING" || item.previousStartsAt
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
          <p className="mb-4 text-sm font-semibold text-ink/60">
            Citas programadas para {formatDate(startOfDay)}
          </p>

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
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <p className="text-sm font-semibold text-ink/60">
                Mostrando citas para {formatDate(startOfDay)}
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <form className="flex flex-wrap items-end gap-2" method="get">
                  {selectedChatClientId ? (
                    <input name="chatClientId" type="hidden" value={selectedChatClientId} />
                  ) : null}
                  {params.chatSearch ? (
                    <input name="chatSearch" type="hidden" value={params.chatSearch} />
                  ) : null}
                  <label className="grid gap-1">
                    <span className="label">Día</span>
                    <input className="field w-44" defaultValue={selectedDay} name="day" type="date" />
                  </label>
                  <button className="secondary-button" type="submit">
                    Ver día
                  </button>
                </form>
                <Link
                  className="secondary-button"
                  href={buildHomeHref({
                    chatClientId: selectedChatClientId ?? undefined,
                    chatSearch: params.chatSearch
                  })}
                >
                  Limpiar filtro
                </Link>
              </div>
            </div>
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
                      <td className="px-3 py-3">
                        <DateCell
                          previousStartsAt={appointment.previousStartsAt}
                          startsAt={appointment.startsAt}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <StatusCell
                          previousStartsAt={appointment.previousStartsAt}
                          status={appointment.status}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          <form action={sendAppointmentReminder}>
                            <input name="appointmentId" type="hidden" value={appointment.id} />
                            <input name="returnTo" type="hidden" value={returnTo} />
                            <button className="icon-button" title="Enviar WhatsApp ahora" type="submit">
                              <MessageCircle size={16} />
                            </button>
                          </form>
                          <StatusButton id={appointment.id} returnTo={returnTo} status="CONFIRMED" label="Confirmar" />
                          <StatusButton id={appointment.id} returnTo={returnTo} status="ATTENDED" label="Asistió" />
                          <StatusButton id={appointment.id} returnTo={returnTo} status="MISSED" label="No asistió" />
                          <StatusButton id={appointment.id} returnTo={returnTo} status="CANCELLED" label="Canceló" />
                          <StatusButton id={appointment.id} returnTo={returnTo} status="REPROGRAM_PENDING" label="Pospuso" />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {appointments.length === 0 ? (
                    <tr>
                      <td className="px-3 py-8 text-center text-ink/60" colSpan={5}>
                        Sin citas para este día.
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

        <section>
          <Panel title="Clientes" icon={<Users size={18} />}>
            <ClientManager
              action={deleteClient}
              clients={clients.map((client) => ({
                fullName: client.fullName,
                id: client.id,
                phone: client.phone
              }))}
            />
          </Panel>
        </section>

        <section className="grid gap-5">
          <Panel title="CRM de WhatsApp" icon={<MessageCircle size={18} />}>
            <CrmPanel
              initialMessages={initialCrmMessages}
              initialSelectedClientId={selectedChatClient?.id ?? null}
              threads={crmThreads}
            />
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

function DateCell({
  previousStartsAt,
  startsAt
}: {
  previousStartsAt?: Date | null;
  startsAt: Date;
}) {
  if (!previousStartsAt) {
    return <span>{formatDateTime(startsAt)}</span>;
  }

  return (
    <div className="grid gap-1">
      <span className="font-semibold">Nueva: {formatDateTime(startsAt)}</span>
      <span className="text-xs text-ink/55">Anterior: {formatDateTime(previousStartsAt)}</span>
    </div>
  );
}

function StatusCell({
  previousStartsAt,
  status
}: {
  previousStartsAt?: Date | null;
  status: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className={`status-pill ${statusClass[status]}`}>
        {getStatusLabel(status)}
      </span>
      {previousStartsAt ? (
        <span className={`status-pill ${statusClass.REPROGRAMMED}`}>
          Reprogramada
        </span>
      ) : null}
    </div>
  );
}

type ChatThread = {
  id: string;
  fullName: string;
  phone: string;
  _count: { chatMessages: number; reminders: number };
  chatMessages: Array<{
    createdAt: Date;
    direction: string;
    message: string;
  }>;
  reminders: Array<{
    message: string;
    sentAt: Date;
  }>;
};

function getThreadLastDate(thread: ChatThread) {
  return getThreadLastMessage(thread)?.createdAt ?? null;
}

function getThreadLastMessage(thread: ChatThread) {
  const chatMessage = thread.chatMessages[0]
    ? {
        createdAt: thread.chatMessages[0].createdAt,
        message: thread.chatMessages[0].message
      }
    : null;
  const reminder = thread.reminders[0]
    ? {
        createdAt: thread.reminders[0].sentAt,
        message: thread.reminders[0].message
      }
    : null;

  if (!chatMessage) {
    return reminder;
  }

  if (!reminder) {
    return chatMessage;
  }

  return chatMessage.createdAt > reminder.createdAt ? chatMessage : reminder;
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
  returnTo,
  status,
  label
}: {
  id: string;
  returnTo: string;
  status: string;
  label: string;
}) {
  return (
    <form action={updateAppointmentStatus}>
      <input name="id" type="hidden" value={id} />
      <input name="returnTo" type="hidden" value={returnTo} />
      <input name="status" type="hidden" value={status} />
      <button className="secondary-button" type="submit">
        {label}
      </button>
    </form>
  );
}

function getSelectedDay(day?: string) {
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return day;
  }

  return formatInputDate(new Date());
}

function buildHomeHref({
  chatClientId,
  chatSearch,
  day
}: {
  chatClientId?: string;
  chatSearch?: string;
  day?: string;
}) {
  const params = new URLSearchParams();

  if (day) {
    params.set("day", day);
  }

  if (chatClientId) {
    params.set("chatClientId", chatClientId);
  }

  if (chatSearch) {
    params.set("chatSearch", chatSearch);
  }

  const query = params.toString();

  return query ? `/?${query}` : "/";
}

function normalizeSearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}
