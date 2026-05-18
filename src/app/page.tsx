import {
  CalendarClock,
  Clock3,
  LogOut,
  MessageCircle,
  Plus,
  UserPlus,
  Users
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, getStatusLabel } from "@/lib/format";
import { APP_TIME_ZONE, formatInputDate, formatInputTime, getClinicDayBounds, zonedDateTimeToUtc } from "@/lib/timezone";
import {
  createAppointment,
  createClient,
  createWaitlistEntry,
  deleteClient,
  deleteWaitlistEntry,
  offerWaitlistSlot,
  sendAppointmentReminder,
  updateClient,
  updateAppointmentStatus
} from "./actions";
import { AppointmentForm } from "./appointment-form";
import { logoutDoctor } from "./auth-actions";
import { ClientManager } from "./client-manager";
import { ConfirmSubmitButton } from "./confirm-submit-button";
import { CrmPanel } from "./crm-panel";
import { MetricsPanel } from "./metrics-panel";
import { NotificationsMenu } from "./notifications-menu";
import { ThemeToggle } from "./theme-toggle";

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
    chatUnknownId?: string;
    chatSearch?: string;
    day?: string;
    error?: string;
    newClientPhone?: string;
    success?: string;
  }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const selectedDay = getSelectedDay(params.day);
  const chatSearch = normalizeSearch(params.chatSearch ?? "");
  const weekDays = getWeekDays(selectedDay);
  const { startOfDay, endOfDay } = getClinicDayBounds(selectedDay);
  const { startOfDay: startOfWeek } = getClinicDayBounds(weekDays[0]);
  const { endOfDay: endOfWeek } = getClinicDayBounds(weekDays[6]);
  const todayStart = getClinicDayBounds(formatInputDate(new Date())).startOfDay;

  const [
    clients,
    appointments,
    blockingAppointments,
    chatThreads,
    unknownChatThreads,
    weekAppointments,
    metricsAppointments,
    waitlistEntries,
    waitlistOpportunities,
    notifications
  ] = await Promise.all([
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
        status: { in: ["PENDING", "CONFIRMED"] }
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
    }),
    prisma.unknownContact.findMany({
      where: { userId: user.id, status: "NEW" },
      include: {
        _count: { select: { messages: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    }),
    prisma.appointment.findMany({
      where: {
        userId: user.id,
        startsAt: {
          gte: startOfWeek,
          lt: endOfWeek
        },
        NOT: { status: "REPROGRAMMED" }
      },
      include: { client: true },
      orderBy: { startsAt: "asc" }
    }),
    prisma.appointment.findMany({
      where: {
        userId: user.id,
        NOT: { status: "REPROGRAMMED" }
      },
      select: {
        clientId: true,
        id: true,
        previousStartsAt: true,
        startsAt: true,
        status: true
      }
    }),
    prisma.waitlistEntry.findMany({
      where: {
        userId: user.id,
        status: { in: ["WAITING", "OFFERED"] }
      },
      include: { client: true, fallbackAppointment: true },
      orderBy: [{ desiredDate: "asc" }, { startTime: "asc" }]
    }),
    prisma.waitlistOpportunity.findMany({
      where: {
        userId: user.id,
        status: { in: ["AVAILABLE", "OFFERED"] }
      },
      include: {
        offeredEntry: {
          include: { client: true }
        }
      },
      orderBy: { startsAt: "asc" }
    }),
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 8
    })
  ]);

  const clientCrmThreads = chatThreads.map((client) => {
    const lastMessage = getThreadLastMessage(client);

    return {
      count: client._count.chatMessages + client._count.reminders,
      fullName: client.fullName,
      id: client.id,
      kind: "client" as const,
      lastAt: lastMessage?.createdAt.toISOString() ?? null,
      lastMessage: lastMessage?.message ?? null,
      phone: client.phone
    };
  });
  const unknownCrmThreads = unknownChatThreads.map((contact) => {
    const lastMessage = contact.messages[0] ?? null;

    return {
      count: contact._count.messages,
      fullName: formatUnknownContactName(contact.phone),
      id: contact.id,
      kind: "unknown" as const,
      lastAt: lastMessage?.createdAt.toISOString() ?? contact.createdAt.toISOString(),
      lastMessage: lastMessage?.message ?? null,
      phone: contact.phone
    };
  });
  const crmThreads = [...clientCrmThreads, ...unknownCrmThreads].sort((left, right) => {
    const leftDate = left.lastAt ? new Date(left.lastAt).getTime() : 0;
    const rightDate = right.lastAt ? new Date(right.lastAt).getTime() : 0;

    if (leftDate !== rightDate) {
      return rightDate - leftDate;
    }

    return left.fullName.localeCompare(right.fullName, "es");
  });
  const filteredCrmThreads = chatSearch
    ? crmThreads.filter((thread) => normalizeSearch(thread.fullName).includes(chatSearch))
    : crmThreads;
  const selectableCrmThreads = chatSearch ? filteredCrmThreads : crmThreads;
  const selectedCrmThread =
    (params.chatUnknownId &&
      selectableCrmThreads.find(
        (thread) => thread.kind === "unknown" && thread.id === params.chatUnknownId
      )) ||
    (params.chatClientId &&
      selectableCrmThreads.find(
        (thread) => thread.kind === "client" && thread.id === params.chatClientId
      )) ||
    selectableCrmThreads[0] ||
    null;
  const selectedChatClientId = selectedCrmThread?.kind === "client" ? selectedCrmThread.id : null;
  const selectedChatUnknownId = selectedCrmThread?.kind === "unknown" ? selectedCrmThread.id : null;
  const [chatMessages, reminderMessages, unknownMessages] = selectedChatClientId
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
        }),
        []
      ])
    : selectedChatUnknownId
      ? await Promise.all([
          [],
          [],
          prisma.unknownContactMessage.findMany({
            where: {
              userId: user.id,
              unknownContactId: selectedChatUnknownId
            },
            orderBy: { createdAt: "asc" },
            take: 80
          })
        ])
      : [[], [], []];
  const chatMessageKeys = new Set(
    chatMessages.map((message) => `${message.appointmentId ?? ""}:${message.message}`)
  );
  const crmMessages = selectedChatClientId
    ? [
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
      ].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    : unknownMessages.map((message) => ({
        appointment: null,
        createdAt: message.createdAt,
        direction: message.direction,
        id: message.id,
        intent: message.intent,
        message: message.message
      }));
  const initialCrmMessages = crmMessages.map((message) => ({
    appointmentTitle: message.appointment?.title ?? null,
    createdAt: message.createdAt.toISOString(),
    direction: message.direction,
    id: message.id,
    message: message.message
  }));
  const returnTo = buildHomeHref({
    chatClientId: selectedChatClientId ?? undefined,
    chatUnknownId: selectedChatUnknownId ?? undefined,
    chatSearch: params.chatSearch,
    day: params.day ? selectedDay : undefined
  });

  return (
    <main className="min-h-screen">
      <header className="border-b border-black/10 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="hidden h-14 w-36 items-center justify-center rounded-md bg-black px-3 py-2 sm:flex">
              <Image
                alt="HiWorkflow"
                className="h-auto w-full object-contain"
                height={72}
                priority
                src="/hiworkflow-logo-wide.png"
                width={220}
              />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-leaf">
                Panel administrativo de {user.name}
              </p>
              <h1 className="text-2xl font-bold text-ink md:text-3xl">
                Control de citas, asistencias y recordatorios
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-ink/70">
            <NotificationsMenu
              initialNotifications={notifications.map((notification) => ({
                body: notification.body,
                createdAt: notification.createdAt.toISOString(),
                id: notification.id,
                status: notification.status,
                target: notification.target,
                title: notification.title
              }))}
            />
            <ThemeToggle />
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

        <Panel title="Calendario semanal" icon={<CalendarClock size={18} />}>
          <WeeklyCalendar
            appointments={weekAppointments}
            selectedDay={selectedDay}
            weekDays={weekDays}
          />
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
                  {selectedChatUnknownId ? (
                    <input name="chatUnknownId" type="hidden" value={selectedChatUnknownId} />
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
                    chatUnknownId: selectedChatUnknownId ?? undefined,
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
                      <td className="px-3 py-3">
                        <AppointmentTitle
                          number={appointment.clientAppointmentNumber}
                          title={appointment.title}
                        />
                      </td>
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
          <Panel id="nuevo-cliente" title="Nuevo cliente" icon={<UserPlus size={18} />}>
            <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink/60">
              <Users size={16} />
              {clients.length} clientes registrados en el consultorio
            </p>
            <form action={createClient} className="grid gap-3">
              <Field label="Nombre completo" minLength={2} name="fullName" placeholder="Nombre del cliente" required />
              <Field
                defaultValue={normalizePhone(params.newClientPhone ?? "")}
                label="WhatsApp"
                maxLength={20}
                minLength={8}
                name="phone"
                placeholder="5216141234567"
                required
              />
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

        <Panel id="lista-espera" title="Lista de espera" icon={<CalendarClock size={18} />}>
          <WaitlistPanel
            clients={clients.map((client) => ({
              fullName: client.fullName,
              id: client.id
            }))}
            createAction={createWaitlistEntry}
            deleteAction={deleteWaitlistEntry}
            entries={waitlistEntries.map((entry) => ({
              clientName: entry.client.fullName,
              clientAppointmentNumber: entry.clientAppointmentNumber,
              desiredDate: entry.desiredDate,
              durationMin: entry.durationMin,
              endTime: entry.endTime,
              fallbackAppointment: entry.fallbackAppointment
                ? {
                    startsAt: entry.fallbackAppointment.startsAt,
                    status: entry.fallbackAppointment.status
                  }
                : null,
              id: entry.id,
              priority: entry.priority,
              startTime: entry.startTime,
              status: entry.status,
              title: entry.title
            }))}
            offerAction={offerWaitlistSlot}
            opportunities={waitlistOpportunities.map((opportunity) => ({
              durationMin: opportunity.durationMin,
              id: opportunity.id,
              offeredEntryId: opportunity.offeredEntryId,
              offeredStartsAt: opportunity.offeredStartsAt,
              startsAt: opportunity.startsAt,
              status: opportunity.status
            }))}
          />
        </Panel>

        <section className="grid gap-5">
          <Panel id="crm-whatsapp" title="CRM de WhatsApp" icon={<MessageCircle size={18} />}>
            <CrmPanel
              initialMessages={initialCrmMessages}
              initialSelectedThreadId={selectedCrmThread?.id ?? null}
              threads={crmThreads}
            />
          </Panel>
        </section>

        <Panel title="Resumen y métricas" icon={<CalendarClock size={18} />}>
          <MetricsPanel
            appointments={metricsAppointments.map((appointment) => ({
              clientId: appointment.clientId,
              previousStartsAt: appointment.previousStartsAt?.toISOString() ?? null,
              startsAt: appointment.startsAt.toISOString(),
              status: appointment.status
            }))}
            initialDay={selectedDay}
            initialMonth={selectedDay.slice(0, 7)}
            initialYear={selectedDay.slice(0, 4)}
          />
        </Panel>

        <section>
          <Panel title="Clientes" icon={<Users size={18} />}>
            <ClientManager
              deleteAction={deleteClient}
              clients={clients.map((client) => ({
                email: client.email,
                fullName: client.fullName,
                id: client.id,
                notes: client.notes,
                phone: client.phone
              }))}
              updateAction={updateClient}
            />
          </Panel>
        </section>
      </div>
    </main>
  );
}

function AppointmentTitle({
  number,
  title
}: {
  number?: number | null;
  title: string;
}) {
  return (
    <div className="grid gap-1">
      {number ? <span className="text-xs font-semibold text-leaf">Cita #{number}</span> : null}
      <span>{title}</span>
    </div>
  );
}

function WeeklyCalendar({
  appointments,
  selectedDay,
  weekDays
}: {
  appointments: Array<{
    client: { fullName: string };
    clientAppointmentNumber?: number | null;
    id: string;
    startsAt: Date;
    status: string;
    title: string;
  }>;
  selectedDay: string;
  weekDays: string[];
}) {
  return (
    <div className="grid gap-3 md:grid-cols-7">
      {weekDays.map((day) => {
        const dayAppointments = appointments.filter(
          (appointment) => formatInputDate(appointment.startsAt) === day
        );
        const isSelected = day === selectedDay;

        return (
          <Link
            className={`min-h-40 rounded-md border p-3 ${
              isSelected ? "border-leaf bg-mint/60" : "border-black/10 bg-white hover:bg-paper"
            }`}
            href={buildHomeHref({ day })}
            key={day}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="font-semibold capitalize">{formatWeekday(zonedDayForDisplay(day))}</p>
                <p className="text-xs font-semibold text-ink/55">{formatDate(zonedDayForDisplay(day))}</p>
              </div>
              <span className="text-xs font-semibold text-ink/50">{dayAppointments.length}</span>
            </div>
            <div className="grid gap-2">
              {dayAppointments.map((appointment) => (
                <div
                  className={`rounded-md px-2 py-2 text-xs ${statusClass[appointment.status] ?? "bg-paper text-ink"}`}
                  key={appointment.id}
                >
                  <p className="font-bold">{formatDateTime(appointment.startsAt).slice(-5)}</p>
                  {appointment.clientAppointmentNumber ? (
                    <p className="font-semibold">Cita #{appointment.clientAppointmentNumber}</p>
                  ) : null}
                  <p className="line-clamp-1">{appointment.client.fullName}</p>
                  <p className="line-clamp-1 text-ink/65">{appointment.title}</p>
                </div>
              ))}
              {dayAppointments.length === 0 ? (
                <p className="text-xs font-semibold text-ink/45">Sin citas</p>
              ) : null}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function WaitlistPanel({
  clients,
  createAction,
  deleteAction,
  entries,
  offerAction,
  opportunities
}: {
  clients: Array<{ fullName: string; id: string }>;
  createAction: typeof createWaitlistEntry;
  deleteAction: typeof deleteWaitlistEntry;
  offerAction: typeof offerWaitlistSlot;
  entries: Array<{
    clientName: string;
    clientAppointmentNumber: number | null;
    desiredDate: string;
    durationMin: number;
    endTime: string;
    fallbackAppointment: {
      startsAt: Date;
      status: string;
    } | null;
    id: string;
    priority: string;
    startTime: string;
    status: string;
    title: string;
  }>;
  opportunities: Array<{
    durationMin: number;
    id: string;
    offeredEntryId: string | null;
    offeredStartsAt: Date | null;
    startsAt: Date;
    status: string;
  }>;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <form action={createAction} className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 md:col-span-2">
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
        <label className="grid gap-1 md:col-span-2">
          <span className="label">Motivo</span>
          <input className="field" minLength={2} name="title" placeholder="Consulta, seguimiento..." required />
        </label>
        <label className="grid gap-1">
          <span className="label">Fecha deseada</span>
          <input className="field" min={formatInputDate(new Date())} name="desiredDate" required type="date" />
        </label>
        <label className="grid gap-1">
          <span className="label">Duración min.</span>
          <input className="field" defaultValue="60" max="480" min="15" name="durationMin" required type="number" />
        </label>
        <label className="grid gap-1">
          <span className="label">Desde</span>
          <TimeSelect name="startTime" required />
        </label>
        <label className="grid gap-1">
          <span className="label">Hasta</span>
          <TimeSelect name="endTime" required />
        </label>
        <label className="grid gap-1 md:col-span-2">
          <span className="label">Prioridad</span>
          <select className="field" defaultValue="NORMAL" name="priority">
            <option value="NORMAL">Normal</option>
            <option value="HIGH">Alta</option>
            <option value="LOW">Baja</option>
          </select>
        </label>
        <div className="grid gap-3 rounded-md border border-black/10 bg-paper p-3 md:col-span-2 md:grid-cols-2">
          <p className="text-sm font-semibold text-ink/65 md:col-span-2">
            Cita de respaldo opcional
          </p>
          <label className="grid gap-1">
            <span className="label">Fecha de respaldo</span>
            <input className="field" min={formatInputDate(new Date())} name="fallbackDate" type="date" />
          </label>
          <label className="grid gap-1">
            <span className="label">Hora de respaldo</span>
            <TimeSelect name="fallbackTime" />
          </label>
        </div>
        <label className="grid gap-1 md:col-span-2">
          <span className="label">Notas</span>
          <textarea className="field min-h-16 resize-y" name="notes" />
        </label>
        <button className="primary-button md:col-span-2" disabled={clients.length === 0} type="submit">
          <Plus size={16} />
          Agregar a lista
        </button>
      </form>

      <div className="overflow-hidden rounded-md border border-black/10">
        {entries.map((entry) => {
          const matchingOpportunities = opportunities
            .map((opportunity) => ({
              opportunity,
              startsAt: getWaitlistOfferStartForView(entry, opportunity)
            }))
            .filter(
              (offer): offer is { opportunity: (typeof opportunities)[number]; startsAt: Date } =>
                Boolean(offer.startsAt)
            );
          const offeredOpportunity = opportunities.find(
            (opportunity) => opportunity.status === "OFFERED" && opportunity.offeredEntryId === entry.id
          );

          return (
          <div className="grid gap-2 border-b border-black/10 px-4 py-3 last:border-b-0" key={entry.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{entry.clientName}</p>
                {entry.clientAppointmentNumber ? (
                  <p className="text-xs font-semibold text-leaf">Cita #{entry.clientAppointmentNumber}</p>
                ) : null}
                <p className="text-sm text-ink/60">{entry.title}</p>
              </div>
              <span className={`status-pill ${entry.status === "OFFERED" ? "bg-amber/20 text-ink" : "bg-mint text-leaf"}`}>
                {getWaitlistStatusLabel(entry.status)}
              </span>
            </div>
            <p className="text-sm text-ink/60">
              {entry.desiredDate} de {entry.startTime} a {entry.endTime} · {entry.durationMin} min · {getPriorityLabel(entry.priority)}
            </p>
            {entry.fallbackAppointment ? (
              <p className="text-sm font-semibold text-ink/60">
                Respaldo: {formatDateTime(entry.fallbackAppointment.startsAt)} ·{" "}
                {getStatusLabel(entry.fallbackAppointment.status)}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {matchingOpportunities.map(({ opportunity, startsAt }) => (
                <form action={offerAction} key={opportunity.id}>
                  <input name="waitlistEntryId" type="hidden" value={entry.id} />
                  <input name="opportunityId" type="hidden" value={opportunity.id} />
                  <button className="secondary-button" type="submit">
                    Ofrecer {formatDateTime(startsAt)}
                  </button>
                </form>
              ))}
              {offeredOpportunity ? (
                <span className="status-pill bg-amber/20 text-ink">
                  Oferta enviada para {formatDateTime(offeredOpportunity.offeredStartsAt ?? offeredOpportunity.startsAt)}
                </span>
              ) : null}
              <form action={deleteAction}>
                <input name="waitlistEntryId" type="hidden" value={entry.id} />
                <ConfirmSubmitButton
                  className="secondary-button text-coral"
                  message={`¿Eliminar a ${entry.clientName} de la lista de espera?`}
                >
                  Eliminar
                </ConfirmSubmitButton>
              </form>
            </div>
          </div>
          );
        })}
        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-ink/60">
            Sin pacientes en lista de espera.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Panel({
  title,
  icon,
  id,
  children
}: {
  title: string;
  icon: React.ReactNode;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-black/10 bg-white p-4 shadow-soft" id={id}>
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

function TimeSelect({ name, required = false }: { name: string; required?: boolean }) {
  return (
    <select className="field" name={name} required={required}>
      <option value="">Selecciona una hora</option>
      {buildTimeOptions().map((time) => (
        <option key={time} value={time}>
          {time}
        </option>
      ))}
    </select>
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

function getWeekDays(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  const selected = new Date(Date.UTC(year, month - 1, date, 12, 0, 0, 0));
  const dayOfWeek = selected.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  return Array.from({ length: 7 }, (_, index) => {
    const current = new Date(selected);
    current.setUTCDate(selected.getUTCDate() + mondayOffset + index);

    return [
      String(current.getUTCFullYear()).padStart(4, "0"),
      String(current.getUTCMonth() + 1).padStart(2, "0"),
      String(current.getUTCDate()).padStart(2, "0")
    ].join("-");
  });
}

function getMonthBounds(day: string) {
  const [year, month] = day.split("-").map(Number);
  const startMonth = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const nextMonthDate = new Date(Date.UTC(year, month, 1, 12, 0, 0, 0));
  const nextMonth = [
    String(nextMonthDate.getUTCFullYear()).padStart(4, "0"),
    String(nextMonthDate.getUTCMonth() + 1).padStart(2, "0"),
    "01"
  ].join("-");

  return {
    startOfDay: getClinicDayBounds(startMonth).startOfDay,
    endOfDay: getClinicDayBounds(nextMonth).startOfDay
  };
}

function getYearBounds(year: string) {
  const parsedYear = Number(year);

  return {
    startOfDay: getClinicDayBounds(`${parsedYear}-01-01`).startOfDay,
    endOfDay: getClinicDayBounds(`${parsedYear + 1}-01-01`).startOfDay
  };
}

function getMetricView(view?: string): "day" | "month" | "year" {
  return view === "month" || view === "year" ? view : "day";
}

function getSelectedMonth(month?: string) {
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    return month;
  }

  return formatInputDate(new Date()).slice(0, 7);
}

function getSelectedYear(year?: string) {
  if (year && /^\d{4}$/.test(year)) {
    return year;
  }

  return formatInputDate(new Date()).slice(0, 4);
}

function getMetricBounds({
  day,
  month,
  view,
  year
}: {
  day: string;
  month: string;
  view: string;
  year: string;
}) {
  if (view === "year") {
    const bounds = getYearBounds(year);

    return { start: bounds.startOfDay, end: bounds.endOfDay };
  }

  if (view === "month") {
    const bounds = getMonthBounds(`${month}-01`);

    return { start: bounds.startOfDay, end: bounds.endOfDay };
  }

  const bounds = getClinicDayBounds(day);

  return { start: bounds.startOfDay, end: bounds.endOfDay };
}

function getMetricTitle({
  day,
  month,
  view,
  year
}: {
  day: string;
  month: string;
  view: string;
  year: string;
}) {
  if (view === "year") {
    return `Métricas del año ${year}`;
  }

  if (view === "month") {
    return `Métricas del mes ${month}`;
  }

  return `Métricas del día ${formatDate(zonedDayForDisplay(day))}`;
}

function zonedDayForDisplay(day: string) {
  return zonedDateTimeToUtc(day, "12:00");
}

function formatWeekday(date: Date) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: APP_TIME_ZONE,
    weekday: "long"
  }).format(date);
}

function getWaitlistOfferStartForView(
  entry: {
    desiredDate: string;
    durationMin: number;
    endTime: string;
    startTime: string;
    status: string;
  },
  opportunity: {
    durationMin: number;
    startsAt: Date;
    status: string;
  }
) {
  if (entry.status !== "WAITING" || opportunity.status !== "AVAILABLE") {
    return null;
  }

  if (entry.desiredDate !== formatInputDate(opportunity.startsAt) || entry.durationMin > opportunity.durationMin) {
    return null;
  }

  const slotStart = timeToMinutes(formatInputTime(opportunity.startsAt));
  const slotEnd = slotStart + opportunity.durationMin;
  const desiredStart = timeToMinutes(entry.startTime);
  const desiredEnd = timeToMinutes(entry.endTime);
  const offerStart = Math.max(slotStart, desiredStart);
  const latestStart = Math.min(slotEnd - entry.durationMin, desiredEnd - entry.durationMin);

  if (offerStart > latestStart) {
    return null;
  }

  return zonedDateTimeToUtc(entry.desiredDate, minutesToTime(offerStart));
}

function timeToMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);

  return hour * 60 + minute;
}

function buildTimeOptions() {
  const times: string[] = [];

  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += 15) {
      times.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    }
  }

  return times;
}

function minutesToTime(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getWaitlistStatusLabel(status: string) {
  const labels: Record<string, string> = {
    WAITING: "En espera",
    OFFERED: "Oferta enviada",
    BOOKED: "Agendada",
    CANCELLED: "Cancelada"
  };

  return labels[status] ?? status;
}

function getPriorityLabel(priority: string) {
  const labels: Record<string, string> = {
    HIGH: "Prioridad alta",
    LOW: "Prioridad baja",
    NORMAL: "Prioridad normal"
  };

  return labels[priority] ?? priority;
}

function buildHomeHref({
  chatClientId,
  chatUnknownId,
  chatSearch,
  day
}: {
  chatClientId?: string;
  chatUnknownId?: string;
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

  if (chatUnknownId) {
    params.set("chatUnknownId", chatUnknownId);
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

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function formatUnknownContactName(phone: string) {
  return `Número nuevo ${phone}`;
}
