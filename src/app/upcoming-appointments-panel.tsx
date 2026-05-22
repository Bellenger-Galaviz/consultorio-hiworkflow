"use client";

import { CalendarClock, MessageCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { APP_TIME_ZONE } from "@/lib/timezone";
import { ClientFilesHistory, type ClientFileItem } from "./client-files-history";
import { ClientNotesHistory, type ClientNoteItem } from "./client-notes-history";

type AppointmentEvent = {
  createdAt: string;
  id: string;
  label: string;
  type: string;
};

export type UpcomingAppointment = {
  clientAppointmentNumber: number | null;
  clientFiles: ClientFileItem[];
  clientName: string;
  createdAt: string;
  events: AppointmentEvent[];
  id: string;
  notes: ClientNoteItem[];
  previousStartsAt: string | null;
  startsAt: string;
  status: string;
  statusChangedAt: string | null;
  title: string;
};

type UpcomingAppointmentsPanelProps = {
  appointments: UpcomingAppointment[];
  initialDay: string;
  returnToBase: string;
  sendReminderAction: (formData: FormData) => void | Promise<void>;
  updateStatusAction: (formData: FormData) => void | Promise<void>;
};

const statusClass: Record<string, string> = {
  PENDING: "bg-amber/20 text-ink",
  CONFIRMED: "bg-mint text-leaf",
  CANCELLED: "bg-coral/15 text-coral",
  ATTENDED: "bg-leaf text-white",
  MISSED: "bg-ink/10 text-ink",
  REPROGRAM_PENDING: "bg-amber/20 text-ink",
  REPROGRAMMED: "bg-ink/10 text-ink"
};

export function UpcomingAppointmentsPanel({
  appointments,
  initialDay,
  returnToBase,
  sendReminderAction,
  updateStatusAction
}: UpcomingAppointmentsPanelProps) {
  const [day, setDay] = useState(initialDay);
  const today = getDateKey(new Date().toISOString());
  const filteredAppointments = useMemo(
    () => appointments.filter((appointment) => getDateKey(appointment.startsAt) === day),
    [appointments, day]
  );
  const returnTo = buildReturnTo(returnToBase, day);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <p className="text-sm font-semibold text-ink/60">
          Mostrando citas para {formatDisplayDate(day)}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1">
            <span className="label">Día</span>
            <input
              className="field w-44"
              onChange={(event) => setDay(event.target.value)}
              type="date"
              value={day}
            />
          </label>
          <button className="secondary-button" onClick={() => setDay(today)} type="button">
            Hoy
          </button>
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
            {filteredAppointments.map((appointment) => (
              <tr key={appointment.id}>
                <td className="px-3 py-3 font-medium">{appointment.clientName}</td>
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
                    createdAt={appointment.createdAt}
                    events={appointment.events}
                    previousStartsAt={appointment.previousStartsAt}
                    status={appointment.status}
                    statusChangedAt={appointment.statusChangedAt}
                  />
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-2">
                    <form action={sendReminderAction}>
                      <input name="appointmentId" type="hidden" value={appointment.id} />
                      <input name="returnTo" type="hidden" value={returnTo} />
                      <button className="icon-button" title="Enviar WhatsApp ahora" type="submit">
                        <MessageCircle size={16} />
                      </button>
                    </form>
                    <StatusButton
                      action={updateStatusAction}
                      id={appointment.id}
                      label="Confirmar"
                      returnTo={returnTo}
                      status="CONFIRMED"
                    />
                    <StatusButton
                      action={updateStatusAction}
                      id={appointment.id}
                      label="Asistió"
                      returnTo={returnTo}
                      status="ATTENDED"
                    />
                    <StatusButton
                      action={updateStatusAction}
                      id={appointment.id}
                      label="No asistió"
                      returnTo={returnTo}
                      status="MISSED"
                    />
                    <StatusButton
                      action={updateStatusAction}
                      id={appointment.id}
                      label="Canceló"
                      returnTo={returnTo}
                      status="CANCELLED"
                    />
                    <StatusButton
                      action={updateStatusAction}
                      id={appointment.id}
                      label="Pospuso"
                      returnTo={returnTo}
                      status="REPROGRAM_PENDING"
                    />
                    <ClientNotesHistory notes={appointment.notes} />
                    <ClientFilesHistory files={appointment.clientFiles} />
                  </div>
                </td>
              </tr>
            ))}
            {filteredAppointments.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-ink/60" colSpan={5}>
                  Sin citas para este día.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
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

function DateCell({
  previousStartsAt,
  startsAt
}: {
  previousStartsAt?: string | null;
  startsAt: string;
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
  createdAt,
  events,
  previousStartsAt,
  status,
  statusChangedAt
}: {
  createdAt: string;
  events?: AppointmentEvent[];
  previousStartsAt?: string | null;
  statusChangedAt?: string | null;
  status: string;
}) {
  const timeline = getAppointmentTimeline({
    createdAt,
    events,
    status,
    statusChangedAt: statusChangedAt ?? createdAt
  });

  return (
    <div className="grid gap-1.5">
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
      <div className="max-h-24 overflow-y-auto pr-1 text-xs leading-relaxed text-ink/55">
        {timeline.map((event) => (
          <p key={event.id}>
            {event.label}: {formatDateTime(event.createdAt)}
          </p>
        ))}
      </div>
    </div>
  );
}

function StatusButton({
  action,
  id,
  returnTo,
  status,
  label
}: {
  action: (formData: FormData) => void | Promise<void>;
  id: string;
  returnTo: string;
  status: string;
  label: string;
}) {
  return (
    <form action={action}>
      <input name="id" type="hidden" value={id} />
      <input name="returnTo" type="hidden" value={returnTo} />
      <input name="status" type="hidden" value={status} />
      <button className="secondary-button" type="submit">
        {label}
      </button>
    </form>
  );
}

function getAppointmentTimeline({
  createdAt,
  events,
  status,
  statusChangedAt
}: {
  createdAt: string;
  events?: AppointmentEvent[];
  status: string;
  statusChangedAt: string;
}) {
  const base = [
    {
      id: "created",
      label: "Creada",
      createdAt
    },
    ...(events ?? [])
      .filter((event) => event.type !== "CREATED")
      .map((event) => ({
        id: event.id,
        label: event.label,
        createdAt: event.createdAt
      }))
  ];
  const hasCurrentStatus = base.some((event) => event.label === getStatusTimelineLabel(status));

  if (!hasCurrentStatus && status !== "PENDING") {
    base.push({
      id: `current-${status}`,
      label: getStatusTimelineLabel(status),
      createdAt: statusChangedAt
    });
  }

  return base.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
}

function getStatusTimelineLabel(status: string) {
  const labels: Record<string, string> = {
    ATTENDED: "Asistio",
    CANCELLED: "Cancelada",
    CONFIRMED: "Confirmada",
    MISSED: "No asistio",
    PENDING: "Creada",
    REPROGRAM_PENDING: "Pospuesta",
    REPROGRAMMED: "Reprogramada"
  };

  return labels[status] ?? status;
}

function getStatusLabel(status: string) {
  const labels: Record<string, string> = {
    ATTENDED: "Asistio",
    CANCELLED: "Cancelada",
    CONFIRMED: "Confirmada",
    MISSED: "No asistio",
    PENDING: "Pendiente",
    REPROGRAM_PENDING: "Pospuesta",
    REPROGRAMMED: "Reprogramada"
  };

  return labels[status] ?? status;
}

function getDateKey(value: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: APP_TIME_ZONE,
    year: "numeric"
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: APP_TIME_ZONE,
    year: "numeric"
  }).format(new Date(value));
}

function formatDisplayDate(day: string) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    timeZone: APP_TIME_ZONE,
    year: "numeric"
  }).format(new Date(`${day}T12:00:00Z`));
}

function buildReturnTo(baseHref: string, day: string) {
  const [path, query] = baseHref.split("?");
  const params = new URLSearchParams(query ?? "");
  params.set("day", day);
  const nextQuery = params.toString();

  return nextQuery ? `${path}?${nextQuery}` : path;
}
