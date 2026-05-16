"use client";

import { CalendarClock, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { APP_TIME_ZONE } from "@/lib/timezone";

type MetricView = "day" | "month" | "year";

type MetricAppointment = {
  clientId: string;
  previousStartsAt: string | null;
  startsAt: string;
  status: string;
};

type MetricsPanelProps = {
  appointments: MetricAppointment[];
  initialDay: string;
  initialMonth: string;
  initialYear: string;
};

export function MetricsPanel({
  appointments,
  initialDay,
  initialMonth,
  initialYear
}: MetricsPanelProps) {
  const [view, setView] = useState<MetricView>("day");
  const [day, setDay] = useState(initialDay);
  const [month, setMonth] = useState(initialMonth);
  const [year, setYear] = useState(initialYear);

  const filteredAppointments = useMemo(() => {
    return appointments.filter((appointment) => {
      const appointmentDay = getDateKey(appointment.startsAt);

      if (view === "year") {
        return appointmentDay.slice(0, 4) === year;
      }

      if (view === "month") {
        return appointmentDay.slice(0, 7) === month;
      }

      return appointmentDay === day;
    });
  }, [appointments, day, month, view, year]);

  const stats = useMemo(() => {
    const attended = filteredAppointments.filter((item) => item.status === "ATTENDED").length;
    const missed = filteredAppointments.filter((item) => item.status === "MISSED").length;
    const attendedOrMissed = attended + missed;

    return {
      activeClients: new Set(filteredAppointments.map((item) => item.clientId)).size,
      attendanceRate: attendedOrMissed > 0 ? Math.round((attended / attendedOrMissed) * 100) : 0,
      attended,
      cancelled: filteredAppointments.filter((item) => item.status === "CANCELLED").length,
      confirmed: filteredAppointments.filter((item) => item.status === "CONFIRMED").length,
      missed,
      pending: filteredAppointments.filter((item) => item.status === "PENDING").length,
      reprogrammed: filteredAppointments.filter(
        (item) => item.status === "REPROGRAM_PENDING" || item.previousStartsAt
      ).length,
      total: filteredAppointments.length
    };
  }, [filteredAppointments]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <p className="text-sm font-semibold text-ink/60">{getMetricTitle({ day, month, view, year })}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1">
            <span className="label">Vista</span>
            <select
              className="field w-32"
              onChange={(event) => setView(event.target.value as MetricView)}
              value={view}
            >
              <option value="day">Día</option>
              <option value="month">Mes</option>
              <option value="year">Año</option>
            </select>
          </label>

          {view === "day" ? (
            <label className="grid gap-1">
              <span className="label">Día</span>
              <input className="field w-44" onChange={(event) => setDay(event.target.value)} type="date" value={day} />
            </label>
          ) : null}

          {view === "month" ? (
            <label className="grid gap-1">
              <span className="label">Mes</span>
              <input
                className="field w-44"
                onChange={(event) => setMonth(event.target.value)}
                type="month"
                value={month}
              />
            </label>
          ) : null}

          {view === "year" ? (
            <label className="grid gap-1">
              <span className="label">Año</span>
              <input
                className="field w-32"
                min="2020"
                onChange={(event) => setYear(event.target.value)}
                type="number"
                value={year}
              />
            </label>
          ) : null}
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-8">
        <MetricCard icon={<CalendarClock size={20} />} label="Citas" value={stats.total} />
        <MetricCard icon={<CalendarClock size={20} />} label="Confirmadas" value={stats.confirmed} />
        <MetricCard icon={<CalendarClock size={20} />} label="Pendientes" value={stats.pending} />
        <MetricCard icon={<CalendarClock size={20} />} label="Canceladas" value={stats.cancelled} />
        <MetricCard icon={<CalendarClock size={20} />} label="Pospuestas" value={stats.reprogrammed} />
        <MetricCard icon={<CalendarClock size={20} />} label="Asistencia" value={`${stats.attendanceRate}%`} />
        <MetricCard icon={<CalendarClock size={20} />} label="No asistieron" value={stats.missed} />
        <MetricCard icon={<Users size={20} />} label="Pacientes activos" value={stats.activeClients} />
      </section>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-md border border-black/10 bg-white p-4">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-mint text-leaf">
        {icon}
      </div>
      <p className="text-sm font-semibold text-ink/60">{label}</p>
      <p className="text-3xl font-bold text-ink">{value}</p>
    </div>
  );
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

function getMetricTitle({
  day,
  month,
  view,
  year
}: {
  day: string;
  month: string;
  view: MetricView;
  year: string;
}) {
  if (view === "year") {
    return `Métricas del año ${year}`;
  }

  if (view === "month") {
    return `Métricas de ${formatMonth(month)}`;
  }

  return `Métricas del día ${formatDisplayDate(day)}`;
}

function formatDisplayDate(day: string) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    timeZone: APP_TIME_ZONE,
    year: "numeric"
  }).format(new Date(`${day}T12:00:00Z`));
}

function formatMonth(month: string) {
  return new Intl.DateTimeFormat("es-MX", {
    month: "long",
    timeZone: APP_TIME_ZONE,
    year: "numeric"
  }).format(new Date(`${month}-15T12:00:00Z`));
}
