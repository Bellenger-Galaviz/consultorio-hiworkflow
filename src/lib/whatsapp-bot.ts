import { AsyncLocalStorage } from "node:async_hooks";
import type { Appointment, Client, User } from "@prisma/client";
import { logAppointmentEvent } from "@/lib/appointment-events";
import { findAppointmentConflict, getAppointmentEnd } from "@/lib/appointments";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import {
  createAppointmentStatusNotification,
  createClientMessageNotification,
  createUnknownContactNotification
} from "@/lib/notifications";
import { sendReminderToN8n } from "@/lib/n8n";
import { APP_TIME_ZONE, formatInputDate, formatInputTime, zonedDateTimeToUtc } from "@/lib/timezone";
import {
  bookWaitlistOffer,
  declineWaitlistOffer,
  findPendingWaitlistOfferByPhone,
  notifyWaitlistForAvailableSlot
} from "@/lib/waitlist";

type AppointmentWithClient = Appointment & {
  client: Client;
};

type IncomingMessage = {
  phone: string;
  message: string;
  deliveryMode?: "SEND" | "COLLECT";
  agent?: {
    intent?: string;
    normalizedDateTime?: string;
    rangeStart?: string;
    rangeEnd?: string;
    period?: string;
    selectedOption?: number;
  };
};

type WhatsappButton = {
  id: string;
  displayText: string;
};

type CollectedReply = {
  to: string;
  message: string;
  intent: string;
  clientName: string;
  appointmentTitle?: string;
  appointmentStartsAt?: Date;
  buttons?: WhatsappButton[];
};

const replyContext = new AsyncLocalStorage<{
  mode: "SEND" | "COLLECT";
  replies: CollectedReply[];
}>();

type DateTimeParseResult =
  | { date: Date; error: null }
  | { date: null; error: "INVALID_FORMAT" | "INVALID_DATE" | "PAST_DATE" };

type AvailabilityRange = {
  rangeStart: string;
  rangeEnd: string;
  period?: string;
  label: string;
  asksForDay: boolean;
};

const APPOINTMENT_CONTEXT_INTENTS = new Set([
  "MANUAL",
  "REMINDER_24H",
  "REMINDER_1H",
  "CONFIRM_REPLY",
  "CANCEL_REPLY",
  "ASK_REPROGRAM_DATE",
  "REPROGRAM_CONFIRM_REPLY",
  "REPROGRAM_CONFLICT_REPLY",
  "REPROGRAM_DATE_FORMAT_RETRY",
  "AVAILABILITY_OPTIONS",
  "AVAILABILITY_DAYS",
  "REPROGRAM_CONFIRM_REJECTED",
  "CANCELLED_CONFIRM_REJECTED",
  "CANCELLED_FALLBACK_REPLY",
  "FALLBACK_REPLY"
]);

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

function getClientFirstName(client: Client) {
  return client.fullName.trim().split(/\s+/)[0] || client.fullName;
}

function isGroupMessageSender(value: string) {
  const raw = value.toLowerCase();
  const normalized = normalizePhone(value);

  return raw.includes("@g.us") || raw.includes("group") || normalized.length > 15;
}

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isAvailabilityQuestion(text: string) {
  const normalized = normalizeText(text);

  return /\b(disponibilidad|disponible|tienes|tendras|hay|queda|quedan|horario|horarios|espacio|espacios)\b/.test(
    normalized
  );
}

function hasReprogramLanguage(text: string) {
  const normalized = normalizeText(text);

  return (
    /\b(reprogram\w*|reagend\w*|cambi\w*|mov\w*|pospon\w*|aplaz\w*)\b/.test(normalized) ||
    /\b(pasamela|pasamelo|pasarla|pasarlo|pasar\s+(?:la|lo|mi|esta|esa)|pasame\s+la)\b/.test(normalized) ||
    /\b(otro dia|otra fecha|nueva fecha|siguiente semana|proxima semana|proximo mes)\b/.test(normalized)
  );
}

function hasCancelLanguage(text: string) {
  const normalized = normalizeText(text);

  return /\b(cancelar_cita|cancel\w*|no voy|no asistire|no asistire|no podre|no podre|no puedo asistir|no alcanzare|no alcanzare)\b/.test(
    normalized
  );
}

function detectIntent(text: string) {
  const normalized = normalizeText(text);

  if (/\b(confirmar_cita|confirmo|confirmar|asistire|asistiré|si asistire|si asistiré)\b/.test(normalized)) {
    return "CONFIRM";
  }

  if (hasReprogramLanguage(text)) {
    return "REPROGRAM_REQUEST";
  }

  if (hasCancelLanguage(text)) {
    return "CANCEL";
  }

  if (/\b(si|ok|asisto|voy)\b/.test(normalized)) {
    return "CONFIRM";
  }

  return "UNKNOWN";
}

function isWaitlistConfirm(text: string) {
  const normalized = normalizeText(text);

  return /\b(si|confirmo|acepto|quiero|agendalo|agendar)\b/.test(normalized);
}

function isWaitlistDecline(text: string) {
  const normalized = normalizeText(text);

  return /\b(no|paso|no puedo|cancelar|cancelo)\b/.test(normalized);
}

function parseSpanishDateTime(text: string): DateTimeParseResult {
  const normalized = normalizeText(text);
  const match = normalized.match(
    /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2}):(\d{2})\b/
  );

  if (!match) {
    return { date: null, error: "INVALID_FORMAT" };
  }

  const now = new Date();
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return { date: null, error: "INVALID_DATE" };
  }

  const date = zonedDateTimeToUtc(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
  );

  if (Number.isNaN(date.getTime())) {
    return { date: null, error: "INVALID_DATE" };
  }

  if (date <= now) {
    return { date: null, error: "PAST_DATE" };
  }

  return { date, error: null };
}

function addDaysToInputDate(day: string, days: number) {
  const [year, month, date] = day.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date + days, 12, 0, 0, 0));

  return [
    String(utc.getUTCFullYear()).padStart(4, "0"),
    String(utc.getUTCMonth() + 1).padStart(2, "0"),
    String(utc.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function getInputDateParts(day: string) {
  const [year, month, date] = day.split("-").map(Number);

  return { year, month, date };
}

function getInputDateWeekday(day: string) {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

function getMonthEndDay(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function buildInputDate(year: number, month: number, date: number) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(date).padStart(2, "0")
  ].join("-");
}

function inferPeriod(text: string) {
  const normalized = normalizeText(text);

  if (/\b(por la manana|en la manana|de manana|mananas|temprano)\b/.test(normalized)) {
    return "morning";
  }

  if (/\b(tarde|medio dia|mediodia)\b/.test(normalized)) {
    return "afternoon";
  }

  if (/\b(noche)\b/.test(normalized)) {
    return "evening";
  }

  return undefined;
}

function inferAvailabilityRange(message: string): AvailabilityRange | null {
  const normalized = normalizeText(message);
  const today = formatInputDate(new Date());
  const todayParts = getInputDateParts(today);
  const period = inferPeriod(message);

  if (/\b(siguiente|proxima|proximo)\s+semana\b/.test(normalized)) {
    const todayWeekday = getInputDateWeekday(today);
    const daysUntilNextMonday = ((8 - todayWeekday) % 7) || 7;
    const rangeStart = addDaysToInputDate(today, daysUntilNextMonday);

    return {
      rangeStart,
      rangeEnd: addDaysToInputDate(rangeStart, 6),
      period,
      label: "la siguiente semana",
      asksForDay: true
    };
  }

  if (/\b(esta)\s+semana\b/.test(normalized)) {
    const todayWeekday = getInputDateWeekday(today);

    return {
      rangeStart: today,
      rangeEnd: addDaysToInputDate(today, 7 - (todayWeekday || 7)),
      period,
      label: "esta semana",
      asksForDay: true
    };
  }

  if (/\b(siguiente|proximo|proxima)\s+mes\b/.test(normalized)) {
    const nextMonth = todayParts.month === 12 ? 1 : todayParts.month + 1;
    const year = todayParts.month === 12 ? todayParts.year + 1 : todayParts.year;
    const rangeStart = buildInputDate(year, nextMonth, 1);

    return {
      rangeStart,
      rangeEnd: buildInputDate(year, nextMonth, getMonthEndDay(year, nextMonth)),
      period,
      label: "el siguiente mes",
      asksForDay: true
    };
  }

  if (/\b(pasado manana)\b/.test(normalized)) {
    const rangeStart = addDaysToInputDate(today, 2);

    return {
      rangeStart,
      rangeEnd: rangeStart,
      period,
      label: "pasado mañana",
      asksForDay: false
    };
  }

  if (/\b(manana)\b/.test(normalized)) {
    const rangeStart = addDaysToInputDate(today, 1);

    return {
      rangeStart,
      rangeEnd: rangeStart,
      period,
      label: "mañana",
      asksForDay: false
    };
  }

  return null;
}

function timeToMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);

  return hour * 60 + minute;
}

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12
};

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6
};

function inferRequestedTime(message: string) {
  const normalized = normalizeText(message);
  const match =
    normalized.match(/\b(?:a\s+las|alas|como\s+a\s+las|como\s+a|sobre\s+las|tipo)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/) ??
    normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/);

  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const suffix = match[3]?.replace(/\./g, "");

  if (minute < 0 || minute > 59 || hour < 1 || hour > 23) {
    return null;
  }

  if (suffix === "pm" && hour < 12) {
    hour += 12;
  } else if (suffix === "am" && hour === 12) {
    hour = 0;
  } else if (!suffix && hour >= 1 && hour <= 7) {
    hour += 12;
  }

  return minutesToTime(hour * 60 + minute);
}

function hasSameTimeReference(message: string) {
  const normalized = normalizeText(message);

  return /\b(misma hora|mismo horario|igual hora|igual horario|a esa hora|esa misma hora)\b/.test(normalized);
}

function hasExplicitTime(message: string) {
  return inferRequestedTime(message) !== null;
}

function inferRequestedDay(message: string, preferredRange?: { rangeStart?: string | null; rangeEnd?: string | null }) {
  const normalized = normalizeText(message);
  const today = formatInputDate(new Date());
  const todayParts = getInputDateParts(today);

  if (/\b(pasado manana)\b/.test(normalized)) {
    return addDaysToInputDate(today, 2);
  }

  if (/\b(manana)\b/.test(normalized)) {
    return addDaysToInputDate(today, 1);
  }

  const weekdayMatch = normalized.match(/\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/);

  if (weekdayMatch) {
    const wanted = WEEKDAYS[weekdayMatch[1]];
    return findNextInputDateForWeekday(wanted, preferredRange);
  }

  const dayMonthMatch = normalized.match(/\b(?:el\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);

  if (dayMonthMatch) {
    const day = Number(dayMonthMatch[1]);
    const month = MONTHS[dayMonthMatch[2]];
    let year = todayParts.year;

    if (month < todayParts.month || (month === todayParts.month && day < todayParts.date)) {
      year += 1;
    }

    if (day >= 1 && day <= getMonthEndDay(year, month)) {
      return buildInputDate(year, month, day);
    }
  }

  const dayOnlyMatch = [...normalized.matchAll(/\b(?:el\s+)?(\d{1,2})\b/g)].find((match) => {
    const index = match.index ?? 0;
    const before = normalized.slice(Math.max(0, index - 12), index);
    const after = normalized.slice(index + match[0].length, index + match[0].length + 6);

    return !/(?:a\s+las|alas|las|como\s+a)\s*$/.test(before) && !/^\s*(?:am|pm|a\.m\.|p\.m\.)/.test(after);
  });

  if (dayOnlyMatch && !/^\s*\d{1,2}\s*$/.test(normalized)) {
    const day = Number(dayOnlyMatch[1]);
    const rangeStartParts = preferredRange?.rangeStart ? getInputDateParts(preferredRange.rangeStart) : todayParts;
    let year = rangeStartParts.year;
    let month = rangeStartParts.month;

    if (day < 1 || day > getMonthEndDay(year, month)) {
      return null;
    }

    let candidate = buildInputDate(year, month, day);

    if (zonedDateTimeToUtc(candidate, "23:59") <= new Date()) {
      month = month === 12 ? 1 : month + 1;
      year = month === 1 ? year + 1 : year;

      if (day > getMonthEndDay(year, month)) {
        return null;
      }

      candidate = buildInputDate(year, month, day);
    }

    return candidate;
  }

  return null;
}

function findNextInputDateForWeekday(
  wanted: number,
  preferredRange?: { rangeStart?: string | null; rangeEnd?: string | null }
) {
  const today = formatInputDate(new Date());
  const rangeStart = preferredRange?.rangeStart ?? today;
  const rangeEnd = preferredRange?.rangeEnd ?? addDaysToInputDate(today, 21);

  for (let day = rangeStart; day <= rangeEnd; day = addDaysToInputDate(day, 1)) {
    if (getInputDateWeekday(day) === wanted && zonedDateTimeToUtc(day, "23:59") > new Date()) {
      return day;
    }
  }

  return null;
}

function inferNaturalDateTime(
  message: string,
  preferredRange?: { rangeStart?: string | null; rangeEnd?: string | null }
): DateTimeParseResult {
  const day = inferRequestedDay(message, preferredRange);
  const time = inferRequestedTime(message);

  if (!day || !time) {
    return { date: null, error: "INVALID_FORMAT" };
  }

  const date = zonedDateTimeToUtc(day, time);

  if (Number.isNaN(date.getTime())) {
    return { date: null, error: "INVALID_DATE" };
  }

  if (date <= new Date()) {
    return { date: null, error: "PAST_DATE" };
  }

  return { date, error: null };
}

function getMentionedWeekday(text: string) {
  const normalized = normalizeText(text);
  const match = normalized.match(/\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/);

  return match ? WEEKDAYS[match[1]] : null;
}

function getCorrectionWeekday(text: string) {
  const normalized = normalizeText(text);
  const specific = normalized.match(
    /\b(?:pedi|pedido|dije|solicite|queria|quería|era|para)\s+(?:el\s+)?(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/
  );

  if (specific) {
    return WEEKDAYS[specific[1]];
  }

  const matches = [...normalized.matchAll(/\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/g)];
  const last = matches.at(-1);

  return last ? WEEKDAYS[last[1]] : null;
}

function isWeekdayCorrectionMessage(text: string) {
  const normalized = normalizeText(text);

  return (
    getMentionedWeekday(text) !== null &&
    /\b(pedi|pedido|dije|solicite|queria|era|cae|equivoc|confund|corregir|correccion)\b/.test(normalized)
  );
}

function getRequestedWeekdayDateTime(
  message: string,
  preferredRange?: { rangeStart?: string | null; rangeEnd?: string | null },
  fallbackTime?: Date
) {
  const correctionWeekday = isWeekdayCorrectionMessage(message) ? getCorrectionWeekday(message) : null;
  const day =
    correctionWeekday === null
      ? inferRequestedDay(message, preferredRange)
      : findNextInputDateForWeekday(correctionWeekday, preferredRange);
  const time = inferRequestedTime(message) ?? (fallbackTime ? formatInputTime(fallbackTime) : null);

  if (!day || !time) {
    return null;
  }

  const date = zonedDateTimeToUtc(day, time);

  return Number.isNaN(date.getTime()) || date <= new Date() ? null : date;
}

function correctDateByMentionedWeekday(
  message: string,
  date: Date | null,
  preferredRange?: { rangeStart?: string | null; rangeEnd?: string | null }
) {
  if (!date || getMentionedWeekday(message) === null) {
    return date;
  }

  return getRequestedWeekdayDateTime(message, preferredRange) ?? date;
}

function minutesToTime(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getSelectedOptionFromMessage(message: string, agent?: IncomingMessage["agent"]) {
  if (agent?.selectedOption && agent.selectedOption > 0) {
    return agent.selectedOption;
  }

  const match = normalizeText(message).match(/^(?:slot_|opcion\s*)?(\d{1,2})\b/);

  return match ? Number(match[1]) : null;
}

function isAvailabilityFollowUp(message: string) {
  const normalized = normalizeText(message);

  return /\b(solo|solamente|mas|otras|otros|opciones|horarios|tarde|manana|mañana|semana|mes|disponible|disponibilidad)\b/.test(
    normalized
  );
}

async function findActiveAppointment(phone: string) {
  const normalized = normalizePhone(phone);
  const now = new Date();
  const statusFilter = ["PENDING", "CONFIRMED", "REPROGRAM_PENDING", "CANCELLED"];

  const clients = await prisma.client.findMany({
    where: {
      phone: {
        contains: normalized.slice(-10)
      }
    },
    include: {
      appointments: {
        where: {
          startsAt: { gt: now },
          status: { in: statusFilter }
        },
        orderBy: { startsAt: "asc" },
        take: 5
      }
    },
    take: 10
  });

  const clientIds = clients.map((client) => client.id);
  const recentChat = clientIds.length
    ? await prisma.chatMessage.findFirst({
        where: {
          clientId: { in: clientIds },
          appointment: {
            is: {
              startsAt: { gt: now },
              status: { in: statusFilter }
            }
          }
        },
        include: {
          appointment: { include: { client: true } },
          client: true
        },
        orderBy: { createdAt: "desc" }
      })
    : null;

  if (recentChat?.appointment) {
    return {
      client: recentChat.client,
      appointment: {
        ...recentChat.appointment,
        client: recentChat.client
      } as AppointmentWithClient
    };
  }

  const client = clients.find((item) =>
    item.appointments.some((appointment) => appointment.status !== "CANCELLED")
  );
  const appointment = client?.appointments.find((item) => item.status !== "CANCELLED");

  if (!client || !appointment) {
    return null;
  }

  return {
    client,
    appointment: {
      ...appointment,
      client
    } as AppointmentWithClient
  };
}

async function findClientByPhone(phone: string) {
  const normalized = normalizePhone(phone);

  if (!normalized) {
    return null;
  }

  return prisma.client.findFirst({
    where: {
      phone: {
        contains: normalized.slice(-10)
      }
    },
    orderBy: { updatedAt: "desc" }
  });
}

async function resolveUnknownContactOwner() {
  const configuredEmail = process.env.INBOUND_DEFAULT_USER_EMAIL?.trim();

  if (configuredEmail) {
    const configuredUser = await prisma.user.findUnique({
      where: { email: configuredEmail }
    });

    if (configuredUser) {
      return configuredUser;
    }
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    take: 2
  });

  return users.length === 1 ? users[0] : null;
}

async function recordKnownClientMessage(client: Client, message: string, intent: string) {
  await prisma.chatMessage.create({
    data: {
      userId: client.userId,
      clientId: client.id,
      direction: "INBOUND",
      message,
      intent
    }
  });

  await createClientMessageNotification(client, message);
}

async function recordUnknownContactMessage(user: User, phone: string, message: string, intent: string) {
  const normalizedPhone = normalizePhone(phone);
  const contact = await prisma.unknownContact.upsert({
    where: {
      userId_phone: {
        userId: user.id,
        phone: normalizedPhone
      }
    },
    create: {
      userId: user.id,
      phone: normalizedPhone,
      displayName: `Número nuevo ${normalizedPhone}`
    },
    update: {
      status: "NEW"
    }
  });

  await prisma.unknownContactMessage.create({
    data: {
      userId: user.id,
      unknownContactId: contact.id,
      direction: "INBOUND",
      message,
      intent
    }
  });

  await createUnknownContactNotification(contact, message);

  return contact;
}

async function recordMessageWithoutActiveAppointment(input: IncomingMessage, intent: string) {
  const client = await findClientByPhone(input.phone);

  if (client) {
    await recordKnownClientMessage(client, input.message, intent);

    return {
      ok: true,
      action: "CLIENT_MESSAGE_RECORDED",
      clientId: client.id
    };
  }

  const owner = await resolveUnknownContactOwner();

  if (!owner) {
    return {
      ok: true,
      action: "NO_OWNER_FOR_UNKNOWN_CONTACT"
    };
  }

  const contact = await recordUnknownContactMessage(owner, input.phone, input.message, intent);

  return {
    ok: true,
    action: "UNKNOWN_CONTACT_RECORDED",
    unknownContactId: contact.id
  };
}

async function hasAppointmentResponseContext(appointment: AppointmentWithClient) {
  const latestOutbound = await prisma.chatMessage.findFirst({
    where: {
      appointmentId: appointment.id,
      direction: "OUTBOUND"
    },
    orderBy: { createdAt: "desc" },
    select: { intent: true }
  });

  return Boolean(
    latestOutbound?.intent && APPOINTMENT_CONTEXT_INTENTS.has(latestOutbound.intent)
  );
}

async function reply(
  appointment: AppointmentWithClient,
  message: string,
  intent: string,
  buttons?: WhatsappButton[]
) {
  await prisma.chatMessage.create({
    data: {
      userId: appointment.userId,
      clientId: appointment.clientId,
      appointmentId: appointment.id,
      direction: "OUTBOUND",
      message,
      intent
    }
  });

  const context = replyContext.getStore();
  if (context?.mode === "COLLECT") {
    context.replies.push({
      to: appointment.client.phone,
      message,
      intent,
      buttons,
      clientName: appointment.client.fullName,
      appointmentTitle: appointment.title,
      appointmentStartsAt: appointment.startsAt
    });

    return;
  }

  await sendReminderToN8n({
    buttons,
    client: appointment.client,
    appointment,
    message,
    title: "Cita médica"
  });
}

async function reprogramAppointment(appointment: AppointmentWithClient, proposedDate: Date) {
  const conflict = await findAppointmentConflict({
    userId: appointment.userId,
    startsAt: proposedDate,
    durationMin: appointment.durationMin,
    ignoreAppointmentId: appointment.id
  });

  if (conflict) {
    const alternatives = await findAvailableReprogramSlots({
      appointment,
      rangeStart: formatInputDate(proposedDate),
      rangeEnd: addDaysToInputDate(formatInputDate(proposedDate), 14)
    });
    const message = alternatives.length
      ? `Ese horario ya está ocupado. Estos son horarios disponibles cercanos:\n\n${alternatives
          .map((slot, index) => `${index + 1}. ${formatDateTime(slot)}`)
          .join("\n")}\n\nDime cuál te funciona o qué otro día u horario te gustaría revisar.`
      : "Ese horario ya está ocupado y no encontré espacios cercanos disponibles. Pregunta por otra semana, otro mes o responde con otra fecha y hora.";

    await reply(appointment, message, alternatives.length ? "AVAILABILITY_OPTIONS" : "REPROGRAM_CONFLICT_REPLY");

    return { ok: true, action: "REPROGRAM_CONFLICT", appointmentId: appointment.id };
  }

  const updatedAppointment = await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      previousStartsAt: appointment.previousStartsAt ?? appointment.startsAt,
      startsAt: proposedDate,
      status: "PENDING",
      statusChangedAt: new Date(),
      notes: `${appointment.notes ?? ""}\nReprogramada de ${formatDateTime(appointment.startsAt)} a ${formatDateTime(
        proposedDate
      )}.`.trim()
    },
    include: { client: true }
  });
  await logAppointmentEvent({
    appointmentId: updatedAppointment.id,
    type: "REPROGRAMMED",
    userId: updatedAppointment.userId
  });

  const message = `Sí, tenemos ese horario disponible. Ya dejé tu cita "${appointment.title}" reprogramada para ${formatDateTime(
    proposedDate
  )}.`;

  await reply(updatedAppointment, message, "REPROGRAM_CONFIRM_REPLY");

  return {
    ok: true,
    action: "REPROGRAMMED",
    appointmentId: appointment.id
  };
}

async function findAvailableReprogramSlots({
  appointment,
  rangeStart,
  rangeEnd,
  period,
  excludeIso = [],
  limit = 5
}: {
  appointment: AppointmentWithClient;
  rangeStart?: string;
  rangeEnd?: string;
  period?: string;
  excludeIso?: string[];
  limit?: number;
}) {
  const now = new Date();
  const today = formatInputDate(now);
  const startDay = rangeStart && /^\d{4}-\d{2}-\d{2}$/.test(rangeStart) ? rangeStart : today;
  const endDay =
    rangeEnd && /^\d{4}-\d{2}-\d{2}$/.test(rangeEnd)
      ? rangeEnd
      : addDaysToInputDate(startDay, 21);
  const workStart = timeToMinutes(process.env.AI_AGENT_BUSINESS_START ?? "09:00");
  const workEnd = timeToMinutes(process.env.AI_AGENT_BUSINESS_END ?? "19:00");
  const stepMin = Number(process.env.AI_AGENT_SLOT_STEP_MIN ?? 15);
  const optionGapMin = Number(process.env.AI_AGENT_OPTION_GAP_MIN ?? 120);
  const maxOptionsPerDay = Number(process.env.AI_AGENT_MAX_OPTIONS_PER_DAY ?? 3);
  const excluded = new Set(excludeIso);
  const availableDays = new Set(
    (process.env.AI_AGENT_WORK_DAYS ?? "1,2,3,4,5,6")
      .split(",")
      .map((item) => Number(item.trim()))
  );
  const periodStart =
    period === "morning" ? timeToMinutes("06:00") : period === "afternoon" ? timeToMinutes("12:00") : 0;
  const periodEnd =
    period === "morning"
      ? timeToMinutes("12:00")
      : period === "afternoon"
        ? timeToMinutes("19:00")
        : period === "evening"
          ? timeToMinutes("23:59")
          : 24 * 60;
  const rangeStartsAt = zonedDateTimeToUtc(startDay, "00:00");
  const rangeEndsAt = zonedDateTimeToUtc(addDaysToInputDate(endDay, 1), "00:00");
  const existingAppointments = await prisma.appointment.findMany({
    where: {
      userId: appointment.userId,
      status: { in: ["PENDING", "CONFIRMED"] },
      id: { not: appointment.id },
      startsAt: { lt: rangeEndsAt }
    },
    orderBy: { startsAt: "asc" }
  });
  const candidates: Date[] = [];

  for (let day = startDay; day <= endDay; day = addDaysToInputDate(day, 1)) {
    const dayOfWeek = new Date(`${day}T12:00:00Z`).getUTCDay();

    if (!availableDays.has(dayOfWeek)) {
      continue;
    }

    const latestStart = workEnd - appointment.durationMin;
    const startMin = Math.max(workStart, periodStart);
    const endMin = Math.min(latestStart, periodEnd - appointment.durationMin);

    for (let minutes = startMin; minutes <= endMin; minutes += stepMin) {
      const startsAt = zonedDateTimeToUtc(day, minutesToTime(minutes));
      const endsAt = getAppointmentEnd(startsAt, appointment.durationMin);

      if (startsAt <= now || startsAt < rangeStartsAt || excluded.has(startsAt.toISOString())) {
        continue;
      }

      const conflict = existingAppointments.find((existingAppointment) => {
        const existingEnd = getAppointmentEnd(
          existingAppointment.startsAt,
          existingAppointment.durationMin
        );

        return startsAt < existingEnd && endsAt > existingAppointment.startsAt;
      });

      if (!conflict) {
        candidates.push(startsAt);
      }
    }
  }

  const selected: Date[] = [];
  const selectedPerDay = new Map<string, number>();

  for (const candidate of candidates) {
    const day = formatInputDate(candidate);
    const sameDayCount = selectedPerDay.get(day) ?? 0;

    if (sameDayCount >= maxOptionsPerDay) {
      continue;
    }

    const tooClose = selected.some(
      (slot) =>
        formatInputDate(slot) === day &&
        Math.abs(slot.getTime() - candidate.getTime()) < optionGapMin * 60 * 1000
    );

    if (tooClose) {
      continue;
    }

    selected.push(candidate);
    selectedPerDay.set(day, sameDayCount + 1);

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function formatAvailabilityDay(day: string) {
  const date = zonedDateTimeToUtc(day, "12:00");

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    timeZone: APP_TIME_ZONE,
    weekday: "long",
    year: "numeric"
  }).format(date);
}

async function findAvailableReprogramDays({
  appointment,
  rangeEnd,
  rangeStart,
  period,
  limit = 6
}: {
  appointment: AppointmentWithClient;
  rangeEnd: string;
  rangeStart: string;
  period?: string;
  limit?: number;
}) {
  const days: string[] = [];

  for (let day = rangeStart; day <= rangeEnd; day = addDaysToInputDate(day, 1)) {
    const slots = await findAvailableReprogramSlots({
      appointment,
      rangeEnd: day,
      rangeStart: day,
      period,
      limit: 1
    });

    if (slots.length) {
      days.push(day);
    }

    if (days.length >= limit) {
      break;
    }
  }

  return days;
}

function buildAvailabilityMessage(appointment: AppointmentWithClient, slots: Date[]) {
  const clientName = getClientFirstName(appointment.client);

  if (!slots.length) {
    return `${clientName}, por ahora no encontré horarios disponibles en ese rango. Puedes preguntarme por otra semana, otro mes o una fecha específica.`;
  }

  const options = slots
    .map((slot, index) => `${index + 1}. ${formatDateTime(slot)}`)
    .join("\n");

  return `${clientName}, estos son algunos espacios disponibles:\n\n${options}\n\nDime cuál te funciona o qué otro horario prefieres revisar.`;
}

function buildSlotButtons(slots: Date[]) {
  return slots.slice(0, 3).map((_, index) => ({
    id: `SLOT_${index + 1}`,
    displayText: `Opción ${index + 1}`
  }));
}

async function replyWithAvailabilityOptions(
  appointment: AppointmentWithClient,
  options?: { rangeStart?: string; rangeEnd?: string; period?: string; excludeIso?: string[] }
) {
  const slots = await findAvailableReprogramSlots({
    appointment,
    rangeStart: options?.rangeStart,
    rangeEnd: options?.rangeEnd,
    period: options?.period,
    excludeIso: options?.excludeIso
  });

  const message = buildAvailabilityMessage(appointment, slots);

  await reply(appointment, message, "AVAILABILITY_OPTIONS", buildSlotButtons(slots));
  await prisma.whatsappAgentState.upsert({
    where: {
      appointmentId_topic: {
        appointmentId: appointment.id,
        topic: "REPROGRAM"
      }
    },
    create: {
      userId: appointment.userId,
      clientId: appointment.clientId,
      appointmentId: appointment.id,
      topic: "REPROGRAM",
      rangeStart: options?.rangeStart,
      rangeEnd: options?.rangeEnd,
      period: options?.period,
      offeredSlots: slots.map((slot) => slot.toISOString())
    },
    update: {
      rangeStart: options?.rangeStart,
      rangeEnd: options?.rangeEnd,
      period: options?.period,
      offeredSlots: slots.map((slot) => slot.toISOString())
    }
  });

  return { ok: true, action: "SENT_AVAILABILITY_OPTIONS", appointmentId: appointment.id };
}

async function replyWithRangeAvailabilityQuestion(
  appointment: AppointmentWithClient,
  range: AvailabilityRange
) {
  if (range.asksForDay) {
    const days = await findAvailableReprogramDays({
      appointment,
      rangeStart: range.rangeStart,
      rangeEnd: range.rangeEnd,
      period: range.period
    });
    const clientName = getClientFirstName(appointment.client);
    const periodText = getPeriodText(range.period);
    const message = days.length
      ? `${clientName}, sí tengo disponibilidad ${range.label}${periodText}. ¿Qué día y horario te gustaría revisar?`
      : `${clientName}, no encontré disponibilidad ${range.label}${periodText}. Si quieres, puedo revisar otra semana, otro horario o un día específico.`;
    await reply(appointment, message, days.length ? "AVAILABILITY_DAYS" : "REPROGRAM_CONFLICT_REPLY");
    await prisma.whatsappAgentState.upsert({
      where: {
        appointmentId_topic: {
          appointmentId: appointment.id,
          topic: "REPROGRAM"
        }
      },
      create: {
        userId: appointment.userId,
        clientId: appointment.clientId,
        appointmentId: appointment.id,
        topic: "REPROGRAM",
        rangeStart: range.rangeStart,
        rangeEnd: range.rangeEnd,
        period: range.period,
        offeredSlots: []
      },
      update: {
        rangeStart: range.rangeStart,
        rangeEnd: range.rangeEnd,
        period: range.period,
        offeredSlots: []
      }
    });

    return { ok: true, action: "ANSWERED_RANGE_DAYS", appointmentId: appointment.id };
  }

  const slots = await findAvailableReprogramSlots({
    appointment,
    rangeStart: range.rangeStart,
    rangeEnd: range.rangeEnd,
    period: range.period,
    limit: 1
  });
  const clientName = getClientFirstName(appointment.client);

  if (slots.length) {
    const message = `${clientName}, sí tengo disponibilidad ${range.label}${getPeriodText(
      range.period
    )}. ¿A qué hora te gustaría?`;

    await reply(appointment, message, "AVAILABILITY_DAYS");
    await prisma.whatsappAgentState.upsert({
      where: {
        appointmentId_topic: {
          appointmentId: appointment.id,
          topic: "REPROGRAM"
        }
      },
      create: {
        userId: appointment.userId,
        clientId: appointment.clientId,
        appointmentId: appointment.id,
        topic: "REPROGRAM",
        rangeStart: range.rangeStart,
        rangeEnd: range.rangeEnd,
        period: range.period,
        offeredSlots: []
      },
      update: {
        rangeStart: range.rangeStart,
        rangeEnd: range.rangeEnd,
        period: range.period,
        offeredSlots: []
      }
    });

    return { ok: true, action: "ASKED_TIME_FOR_AVAILABLE_RANGE", appointmentId: appointment.id };
  }

  const alternatives = await findAvailableReprogramSlots({
    appointment,
    rangeStart: addDaysToInputDate(range.rangeEnd, 1),
    rangeEnd: addDaysToInputDate(range.rangeEnd, 21),
    period: range.period,
    limit: 3
  });
  const message = alternatives.length
    ? `${clientName}, no tengo disponibilidad ${range.label}. Lo más cercano que encontré después es:\n\n${alternatives
        .map((slot, index) => `${index + 1}. ${formatDateTime(slot)}`)
        .join("\n")}\n\nDime cuál te funciona o qué otro rango te gustaría revisar.`
    : `${clientName}, no tengo disponibilidad ${range.label} ni encontré espacios cercanos después. Puedes preguntarme por otra semana u otro mes.`;

  await reply(
    appointment,
    message,
    alternatives.length ? "AVAILABILITY_OPTIONS" : "REPROGRAM_CONFLICT_REPLY",
    buildSlotButtons(alternatives)
  );
  await prisma.whatsappAgentState.upsert({
    where: {
      appointmentId_topic: {
        appointmentId: appointment.id,
        topic: "REPROGRAM"
      }
    },
    create: {
      userId: appointment.userId,
      clientId: appointment.clientId,
      appointmentId: appointment.id,
      topic: "REPROGRAM",
      rangeStart: alternatives.length ? addDaysToInputDate(range.rangeEnd, 1) : range.rangeStart,
      rangeEnd: alternatives.length ? addDaysToInputDate(range.rangeEnd, 21) : range.rangeEnd,
      period: range.period,
      offeredSlots: alternatives.map((slot) => slot.toISOString())
    },
    update: {
      rangeStart: alternatives.length ? addDaysToInputDate(range.rangeEnd, 1) : range.rangeStart,
      rangeEnd: alternatives.length ? addDaysToInputDate(range.rangeEnd, 21) : range.rangeEnd,
      period: range.period,
      offeredSlots: alternatives.map((slot) => slot.toISOString())
    }
  });

  return { ok: true, action: "ANSWERED_RANGE_AVAILABILITY", appointmentId: appointment.id };
}

function getPeriodText(period?: string) {
  return period === "morning"
    ? " por la mañana"
    : period === "afternoon"
      ? " por la tarde"
      : period === "evening"
        ? " por la noche"
        : "";
}

async function askForTimeOnRequestedDay(
  appointment: AppointmentWithClient,
  day: string,
  period?: string
) {
  const slots = await findAvailableReprogramSlots({
    appointment,
    rangeEnd: day,
    rangeStart: day,
    period,
    limit: 1
  });
  const clientName = getClientFirstName(appointment.client);
  const dayLabel = formatAvailabilityDay(day);
  const periodText = getPeriodText(period);
  const message = slots.length
    ? `${clientName}, sí tengo disponibilidad el ${dayLabel}${periodText}. ¿A qué hora te gustaría?`
    : `${clientName}, no encontré disponibilidad el ${dayLabel}${periodText}. Si quieres, puedo revisar otro día u otro horario.`;

  await reply(appointment, message, slots.length ? "AVAILABILITY_DAYS" : "REPROGRAM_CONFLICT_REPLY");
  await prisma.whatsappAgentState.upsert({
    where: {
      appointmentId_topic: {
        appointmentId: appointment.id,
        topic: "REPROGRAM"
      }
    },
    create: {
      userId: appointment.userId,
      clientId: appointment.clientId,
      appointmentId: appointment.id,
      topic: "REPROGRAM",
      rangeStart: day,
      rangeEnd: day,
      period,
      offeredSlots: []
    },
    update: {
      rangeStart: day,
      rangeEnd: day,
      period,
      offeredSlots: []
    }
  });

  return { ok: true, action: "ASKED_TIME_FOR_REQUESTED_DAY", appointmentId: appointment.id };
}

async function askForPreferredReprogramTime(
  appointment: AppointmentWithClient,
  options?: { rangeStart?: string; rangeEnd?: string }
) {
  await prisma.whatsappAgentState.upsert({
    where: {
      appointmentId_topic: {
        appointmentId: appointment.id,
        topic: "REPROGRAM"
      }
    },
    create: {
      userId: appointment.userId,
      clientId: appointment.clientId,
      appointmentId: appointment.id,
      topic: "REPROGRAM",
      rangeStart: options?.rangeStart,
      rangeEnd: options?.rangeEnd,
      offeredSlots: []
    },
    update: {
      rangeStart: options?.rangeStart,
      rangeEnd: options?.rangeEnd,
      offeredSlots: []
    }
  });

  const rangeText =
    options?.rangeStart && options.rangeEnd
      ? " dentro de ese rango"
      : "";
  const message = `${getClientFirstName(appointment.client)}, con gusto. ¿Para qué día u horario te gustaría reprogramarla${rangeText}?`;

  await reply(appointment, message, "ASK_REPROGRAM_DATE");

  return { ok: true, action: "ASKED_REPROGRAM_PREFERENCE", appointmentId: appointment.id };
}

async function replyWithExactAvailability(appointment: AppointmentWithClient, proposedDate: Date) {
  const conflict = await findAppointmentConflict({
    userId: appointment.userId,
    startsAt: proposedDate,
    durationMin: appointment.durationMin,
    ignoreAppointmentId: appointment.id
  });

  if (!conflict) {
    const message = `${appointment.client.fullName}, sí, ${formatDateTime(
      proposedDate
    )} está disponible. Si quieres tomar ese horario, respóndeme que sí lo agendemos.`;

    await reply(appointment, message, "AVAILABILITY_OPTIONS", [{ id: "SLOT_1", displayText: "Elegir horario" }]);
    await prisma.whatsappAgentState.upsert({
      where: {
        appointmentId_topic: {
          appointmentId: appointment.id,
          topic: "REPROGRAM"
        }
      },
      create: {
        userId: appointment.userId,
        clientId: appointment.clientId,
        appointmentId: appointment.id,
        topic: "REPROGRAM",
        rangeStart: formatInputDate(proposedDate),
        rangeEnd: formatInputDate(proposedDate),
        offeredSlots: [proposedDate.toISOString()]
      },
      update: {
        rangeStart: formatInputDate(proposedDate),
        rangeEnd: formatInputDate(proposedDate),
        offeredSlots: [proposedDate.toISOString()]
      }
    });

    return { ok: true, action: "SENT_EXACT_AVAILABILITY", appointmentId: appointment.id };
  }

  const alternatives = await findAvailableReprogramSlots({
    appointment,
    rangeStart: formatInputDate(proposedDate),
    rangeEnd: formatInputDate(proposedDate)
  });
  const message = alternatives.length
    ? `${appointment.client.fullName}, no, ${formatDateTime(
        proposedDate
      )} ya está ocupado. Ese día tengo estos horarios disponibles:\n\n${alternatives
        .map((slot, index) => `${index + 1}. ${formatDateTime(slot)}`)
        .join("\n")}\n\nDime cuál te funciona o dime otra fecha.`
    : `${appointment.client.fullName}, no, ${formatDateTime(
        proposedDate
      )} ya está ocupado y no encontré otro espacio disponible ese día. Puedes preguntarme por otro día u otro rango.`;

  await reply(
    appointment,
    message,
    alternatives.length ? "AVAILABILITY_OPTIONS" : "REPROGRAM_CONFLICT_REPLY",
    buildSlotButtons(alternatives)
  );

  if (alternatives.length) {
    await prisma.whatsappAgentState.upsert({
      where: {
        appointmentId_topic: {
          appointmentId: appointment.id,
          topic: "REPROGRAM"
        }
      },
      create: {
        userId: appointment.userId,
        clientId: appointment.clientId,
        appointmentId: appointment.id,
        topic: "REPROGRAM",
        rangeStart: formatInputDate(proposedDate),
        rangeEnd: formatInputDate(proposedDate),
        offeredSlots: alternatives.map((slot) => slot.toISOString())
      },
      update: {
        rangeStart: formatInputDate(proposedDate),
        rangeEnd: formatInputDate(proposedDate),
        offeredSlots: alternatives.map((slot) => slot.toISOString())
      }
    });
  }

  return { ok: true, action: "ANSWERED_EXACT_AVAILABILITY", appointmentId: appointment.id };
}

async function selectOfferedAvailabilityOption(
  appointment: AppointmentWithClient,
  selectedOption: number
) {
  const state = await prisma.whatsappAgentState.findUnique({
    where: {
      appointmentId_topic: {
        appointmentId: appointment.id,
        topic: "REPROGRAM"
      }
    }
  });
  const offeredSlots = Array.isArray(state?.offeredSlots) ? state.offeredSlots : [];
  const offeredSlot = offeredSlots[selectedOption - 1];

  if (typeof offeredSlot === "string") {
    const startsAt = new Date(offeredSlot);

    if (!Number.isNaN(startsAt.getTime())) {
      return reprogramAppointment(appointment, startsAt);
    }
  }

  const latestOptions = await prisma.chatMessage.findFirst({
    where: {
      appointmentId: appointment.id,
      direction: "OUTBOUND",
      intent: "AVAILABILITY_OPTIONS"
    },
    orderBy: { createdAt: "desc" }
  });

  const matches = [...(latestOptions?.message ?? "").matchAll(/^\s*(\d+)\.\s+(\d{2}\/\d{2}\/\d{4},?\s+\d{2}:\d{2})/gm)];
  const option = matches.find((match) => Number(match[1]) === selectedOption);

  if (!option) {
    return replyWithAvailabilityOptions(appointment);
  }

  const parseResult = parseSpanishDateTime(option[2].replace(",", ""));

  if (!parseResult.date) {
    return replyWithAvailabilityOptions(appointment);
  }

  return reprogramAppointment(appointment, parseResult.date);
}

async function askForReprogramDateAgain(
  appointment: AppointmentWithClient,
  reason: DateTimeParseResult["error"]
) {
  const message =
    reason === "PAST_DATE"
      ? `${appointment.client.fullName}, la fecha y hora que enviaste ya pasaron. ¿Me puedes indicar una fecha futura con día y hora?`
      : `${appointment.client.fullName}, no logré identificar el día y horario. ¿Me lo puedes escribir de nuevo con día y hora?`;

  await reply(appointment, message, "REPROGRAM_DATE_FORMAT_RETRY");

  return { ok: true, action: "ASKED_REPROGRAM_DATE_FORMAT", appointmentId: appointment.id };
}

async function handleIncomingWhatsAppMessageCore(input: IncomingMessage) {
  if (isGroupMessageSender(input.phone)) {
    return { ok: true, action: "IGNORED_GROUP_MESSAGE" };
  }

  const found = await findActiveAppointment(input.phone);
  const waitlistOffer = await findPendingWaitlistOfferByPhone(input.phone);
  const intent = detectIntent(input.message);

  if (!found && !waitlistOffer) {
    return recordMessageWithoutActiveAppointment(input, intent);
  }

  if (waitlistOffer && isWaitlistConfirm(input.message)) {
    const entry = waitlistOffer.offeredEntry;

    if (!entry) {
      return { ok: true, action: "WAITLIST_OFFER_EXPIRED" };
    }

    await prisma.chatMessage.create({
      data: {
        userId: waitlistOffer.userId,
        clientId: entry.clientId,
        waitlistEntryId: entry.id,
        waitlistOpportunityId: waitlistOffer.id,
        direction: "INBOUND",
        message: input.message,
        intent: "WAITLIST_ACCEPT"
      }
    });

    return bookWaitlistOffer(waitlistOffer);
  }

  if (waitlistOffer && isWaitlistDecline(input.message)) {
    const entry = waitlistOffer.offeredEntry;

    if (!entry) {
      return { ok: true, action: "WAITLIST_DECLINED" };
    }

    await prisma.chatMessage.create({
      data: {
        userId: waitlistOffer.userId,
        clientId: entry.clientId,
        waitlistEntryId: entry.id,
        waitlistOpportunityId: waitlistOffer.id,
        direction: "INBOUND",
        message: input.message,
        intent: "WAITLIST_DECLINE"
      }
    });

    return declineWaitlistOffer(waitlistOffer);
  }

  if (!found) {
    return recordMessageWithoutActiveAppointment(input, intent);
  }

  const { appointment } = found;
  const hasResponseContext = await hasAppointmentResponseContext(appointment);
  const agentIntent = input.agent?.intent;
  const effectiveIntent =
    intent !== "UNKNOWN"
      ? intent
      : agentIntent === "CONFIRM"
        ? "CONFIRM"
        : agentIntent === "CANCEL"
          ? "CANCEL"
          : agentIntent === "REPROGRAM_REQUEST"
            ? "REPROGRAM_REQUEST"
            : intent;
  const hasAgentAppointmentIntent =
    agentIntent === "AVAILABILITY_QUERY" ||
    agentIntent === "REPROGRAM_DATETIME" ||
    agentIntent === "OPTION_SELECTION";
  const hasAppointmentIntent = effectiveIntent !== "UNKNOWN" || hasAgentAppointmentIntent;
  const effectiveHasResponseContext =
    hasResponseContext || appointment.status === "REPROGRAM_PENDING" || hasAppointmentIntent;

  await prisma.chatMessage.create({
    data: {
      userId: appointment.userId,
      clientId: appointment.clientId,
      appointmentId: appointment.id,
      direction: "INBOUND",
      message: input.message,
      intent
    }
  });

  const previousState = await prisma.whatsappAgentState.findUnique({
    where: {
      appointmentId_topic: {
        appointmentId: appointment.id,
        topic: "REPROGRAM"
      }
    }
  });
  const localRange = inferAvailabilityRange(input.message);
  const normalizedIncomingMessage = normalizeText(input.message);
  const localPeriod = inferPeriod(input.message);
  const shouldIgnoreAgentPeriod =
    /\bpasado manana\b/.test(normalizedIncomingMessage) && !localPeriod;
  const requestedPeriod = localPeriod ?? (shouldIgnoreAgentPeriod ? undefined : input.agent?.period ?? undefined);
  const agentRange =
    input.agent?.rangeStart || input.agent?.rangeEnd
      ? {
          rangeStart: input.agent.rangeStart ?? input.agent.rangeEnd ?? formatInputDate(new Date()),
          rangeEnd: input.agent.rangeEnd ?? input.agent.rangeStart ?? input.agent.rangeEnd ?? formatInputDate(new Date()),
          period: requestedPeriod,
          label:
            (input.agent.rangeStart ?? input.agent.rangeEnd) === (input.agent.rangeEnd ?? input.agent.rangeStart)
              ? "ese día"
              : "ese rango",
          asksForDay: (input.agent.rangeStart ?? input.agent.rangeEnd) !== (input.agent.rangeEnd ?? input.agent.rangeStart)
        }
      : null;
  const previousRange =
    previousState?.rangeStart && previousState.rangeEnd
      ? {
          rangeStart: previousState.rangeStart,
          rangeEnd: previousState.rangeEnd,
          period: requestedPeriod ?? previousState.period ?? undefined,
          label: previousState.rangeStart === previousState.rangeEnd ? "ese día" : "ese rango",
          asksForDay: false
        }
      : null;
  const requestedRange =
    localRange ??
    agentRange ??
    ((requestedPeriod || isAvailabilityFollowUp(input.message)) ? previousRange : null);
  const proposedDateResult = parseSpanishDateTime(input.message);
  const inferredDateResult = proposedDateResult.date
    ? proposedDateResult
    : inferNaturalDateTime(input.message, {
        rangeStart: requestedRange?.rangeStart ?? previousState?.rangeStart,
        rangeEnd: requestedRange?.rangeEnd ?? previousState?.rangeEnd
      });
  const proposedDate = correctDateByMentionedWeekday(input.message, inferredDateResult.date, {
    rangeStart: requestedRange?.rangeStart ?? previousState?.rangeStart,
    rangeEnd: requestedRange?.rangeEnd ?? previousState?.rangeEnd
  });
  const explicitTime = hasExplicitTime(input.message);
  const requestedTime = inferRequestedTime(input.message);
  const proposedDateFromPreviousDayTime =
    explicitTime &&
    requestedTime &&
    previousState?.rangeStart &&
    previousState.rangeStart === previousState.rangeEnd
      ? zonedDateTimeToUtc(previousState.rangeStart, requestedTime)
      : null;
  const validProposedDateFromPreviousDayTime =
    proposedDateFromPreviousDayTime && proposedDateFromPreviousDayTime > new Date()
      ? proposedDateFromPreviousDayTime
      : null;
  const requestedDayWithoutTime =
    !explicitTime
      ? inferRequestedDay(input.message, {
          rangeStart: requestedRange?.rangeStart ?? previousState?.rangeStart,
          rangeEnd: requestedRange?.rangeEnd ?? previousState?.rangeEnd
        })
      : null;
  const proposedDateFromSameTimeReference =
    requestedDayWithoutTime && hasSameTimeReference(input.message)
      ? zonedDateTimeToUtc(requestedDayWithoutTime, formatInputTime(appointment.startsAt))
      : null;
  const validProposedDateFromSameTimeReference =
    proposedDateFromSameTimeReference && proposedDateFromSameTimeReference > new Date()
      ? proposedDateFromSameTimeReference
      : null;
  const selectedOption = getSelectedOptionFromMessage(input.message, input.agent);
  const asksAvailability = isAvailabilityQuestion(input.message) || input.agent?.intent === "AVAILABILITY_QUERY";
  const correctedWeekdayDate =
    appointment.previousStartsAt && isWeekdayCorrectionMessage(input.message)
      ? getRequestedWeekdayDateTime(
          input.message,
          {
            rangeStart: requestedRange?.rangeStart ?? previousState?.rangeStart,
            rangeEnd: requestedRange?.rangeEnd ?? previousState?.rangeEnd
          },
          appointment.startsAt
        )
      : null;

  if (appointment.status === "REPROGRAM_PENDING" && effectiveHasResponseContext && selectedOption) {
    return selectOfferedAvailabilityOption(appointment, selectedOption);
  }

  if (
    appointment.status === "REPROGRAM_PENDING" &&
    effectiveHasResponseContext &&
    validProposedDateFromSameTimeReference
  ) {
    return asksAvailability
      ? replyWithExactAvailability(appointment, validProposedDateFromSameTimeReference)
      : reprogramAppointment(appointment, validProposedDateFromSameTimeReference);
  }

  if (appointment.status === "REPROGRAM_PENDING" && effectiveHasResponseContext && requestedDayWithoutTime) {
    return askForTimeOnRequestedDay(appointment, requestedDayWithoutTime, requestedPeriod ?? previousState?.period ?? undefined);
  }

  if (
    appointment.status === "REPROGRAM_PENDING" &&
    effectiveHasResponseContext &&
    validProposedDateFromPreviousDayTime
  ) {
    return asksAvailability
      ? replyWithExactAvailability(appointment, validProposedDateFromPreviousDayTime)
      : reprogramAppointment(appointment, validProposedDateFromPreviousDayTime);
  }

  if (appointment.status === "REPROGRAM_PENDING" && effectiveHasResponseContext && proposedDate && asksAvailability) {
    return replyWithExactAvailability(appointment, proposedDate);
  }

  if (
    appointment.status === "REPROGRAM_PENDING" &&
    effectiveHasResponseContext &&
    requestedRange &&
    (asksAvailability || effectiveIntent === "REPROGRAM_REQUEST" || isAvailabilityFollowUp(input.message))
  ) {
    return replyWithRangeAvailabilityQuestion(appointment, requestedRange);
  }

  if (
    appointment.status === "REPROGRAM_PENDING" &&
    effectiveHasResponseContext &&
    input.agent?.intent === "AVAILABILITY_QUERY"
  ) {
    if (input.agent.normalizedDateTime) {
      const exactDateResult = parseSpanishDateTime(input.agent.normalizedDateTime);

      if (exactDateResult.date) {
        if (!explicitTime && getMentionedWeekday(input.message) !== null) {
          const day =
            requestedDayWithoutTime ??
            inferRequestedDay(input.message, {
              rangeStart: requestedRange?.rangeStart ?? previousState?.rangeStart,
              rangeEnd: requestedRange?.rangeEnd ?? previousState?.rangeEnd
            });

          if (day) {
            return askForTimeOnRequestedDay(appointment, day, requestedPeriod ?? previousState?.period ?? undefined);
          }
        }

        return replyWithExactAvailability(appointment, exactDateResult.date);
      }

      return askForReprogramDateAgain(appointment, exactDateResult.error);
    }

    const isFollowUpWithoutNewRange =
      isAvailabilityFollowUp(input.message) &&
      !input.agent.rangeStart &&
      !input.agent.rangeEnd &&
      previousState;
    const previousSlots = Array.isArray(previousState?.offeredSlots)
      ? previousState.offeredSlots.filter((slot): slot is string => typeof slot === "string")
      : [];

    return replyWithAvailabilityOptions(appointment, {
      rangeStart: isFollowUpWithoutNewRange ? previousState.rangeStart ?? undefined : input.agent.rangeStart,
      rangeEnd: isFollowUpWithoutNewRange ? previousState.rangeEnd ?? undefined : input.agent.rangeEnd,
      period: requestedPeriod ?? previousState?.period ?? undefined,
      excludeIso: isFollowUpWithoutNewRange ? previousSlots : undefined
    });
  }

  if (
    appointment.status === "REPROGRAM_PENDING" &&
    effectiveHasResponseContext &&
    effectiveIntent === "UNKNOWN" &&
    isAvailabilityFollowUp(input.message)
  ) {
    const previousSlots = Array.isArray(previousState?.offeredSlots)
      ? previousState.offeredSlots.filter((slot): slot is string => typeof slot === "string")
      : [];

    return replyWithAvailabilityOptions(appointment, {
      rangeStart: previousState?.rangeStart ?? undefined,
      rangeEnd: previousState?.rangeEnd ?? undefined,
      period: requestedPeriod ?? previousState?.period ?? undefined,
      excludeIso: previousSlots
    });
  }

  if (
    appointment.status === "REPROGRAM_PENDING" &&
    effectiveHasResponseContext &&
    input.agent?.intent === "REPROGRAM_DATETIME" &&
    input.agent.normalizedDateTime
  ) {
    const agentDateResult = parseSpanishDateTime(input.agent.normalizedDateTime);

    if (agentDateResult.date) {
      if (!explicitTime && getMentionedWeekday(input.message) !== null) {
        const day =
          requestedDayWithoutTime ??
          inferRequestedDay(input.message, {
            rangeStart: requestedRange?.rangeStart ?? previousState?.rangeStart,
            rangeEnd: requestedRange?.rangeEnd ?? previousState?.rangeEnd
          });

        if (day) {
          return askForTimeOnRequestedDay(appointment, day, requestedPeriod ?? previousState?.period ?? undefined);
        }
      }

      const correctedAgentDate =
        correctDateByMentionedWeekday(input.message, agentDateResult.date, {
          rangeStart: requestedRange?.rangeStart ?? previousState?.rangeStart,
          rangeEnd: requestedRange?.rangeEnd ?? previousState?.rangeEnd
        }) ?? agentDateResult.date;

      return reprogramAppointment(appointment, correctedAgentDate);
    }

    return askForReprogramDateAgain(appointment, agentDateResult.error);
  }

  if (
    appointment.status === "REPROGRAM_PENDING" &&
    effectiveHasResponseContext &&
    effectiveIntent === "UNKNOWN" &&
    !proposedDate
  ) {
    return askForReprogramDateAgain(appointment, inferredDateResult.error);
  }

  if (effectiveHasResponseContext && correctedWeekdayDate && !asksAvailability) {
    return reprogramAppointment(appointment, correctedWeekdayDate);
  }

  if (appointment.status !== "CANCELLED" && (!effectiveHasResponseContext || effectiveIntent === "UNKNOWN")) {
    await createClientMessageNotification(appointment.client, input.message);

    return { ok: true, action: "CLIENT_MESSAGE_RECORDED", appointmentId: appointment.id };
  }

  if (appointment.status === "CANCELLED") {
    if (requestedDayWithoutTime) {
      const reprogrammingAppointment = await prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: "REPROGRAM_PENDING", statusChangedAt: new Date() },
        include: { client: true }
      });
      await logAppointmentEvent({
        appointmentId: reprogrammingAppointment.id,
        type: "REPROGRAM_PENDING",
        userId: reprogrammingAppointment.userId
      });
      await createAppointmentStatusNotification(reprogrammingAppointment, "REPROGRAM_PENDING");

      return askForTimeOnRequestedDay(reprogrammingAppointment, requestedDayWithoutTime, requestedPeriod ?? previousState?.period ?? undefined);
    }

    if (requestedRange && asksAvailability) {
      const reprogrammingAppointment = await prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: "REPROGRAM_PENDING", statusChangedAt: new Date() },
        include: { client: true }
      });
      await logAppointmentEvent({
        appointmentId: reprogrammingAppointment.id,
        type: "REPROGRAM_PENDING",
        userId: reprogrammingAppointment.userId
      });
      await createAppointmentStatusNotification(reprogrammingAppointment, "REPROGRAM_PENDING");

      return replyWithRangeAvailabilityQuestion(reprogrammingAppointment, requestedRange);
    }

    if (proposedDate && asksAvailability) {
      const reprogrammingAppointment = await prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: "REPROGRAM_PENDING", statusChangedAt: new Date() },
        include: { client: true }
      });
      await logAppointmentEvent({
        appointmentId: reprogrammingAppointment.id,
        type: "REPROGRAM_PENDING",
        userId: reprogrammingAppointment.userId
      });
      await createAppointmentStatusNotification(reprogrammingAppointment, "REPROGRAM_PENDING");

      return replyWithExactAvailability(reprogrammingAppointment, proposedDate);
    }

    if (proposedDate) {
      return reprogramAppointment(appointment, proposedDate);
    }

    if (validProposedDateFromSameTimeReference) {
      return reprogramAppointment(appointment, validProposedDateFromSameTimeReference);
    }

    if (effectiveIntent === "REPROGRAM_REQUEST") {
      const reprogrammingAppointment = await prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: "REPROGRAM_PENDING", statusChangedAt: new Date() },
        include: { client: true }
      });
      await logAppointmentEvent({
        appointmentId: reprogrammingAppointment.id,
        type: "REPROGRAM_PENDING",
        userId: reprogrammingAppointment.userId
      });
      await createAppointmentStatusNotification(reprogrammingAppointment, "REPROGRAM_PENDING");

      if (requestedRange) {
        return replyWithRangeAvailabilityQuestion(reprogrammingAppointment, requestedRange);
      }

      return askForPreferredReprogramTime(reprogrammingAppointment);
    }

    if (effectiveIntent === "CONFIRM") {
      const message = `${appointment.client.fullName}, esa cita ya fue cancelada y no puedo reactivarla directamente. Si quieres agendar una nueva fecha, dime qué día y horario te gustaría.`;

      await reply(appointment, message, "CANCELLED_CONFIRM_REJECTED");

      return { ok: true, action: "CANCELLED_CONFIRM_REJECTED", appointmentId: appointment.id };
    }

    const message = `${appointment.client.fullName}, esa cita está cancelada. Si quieres agendar una nueva fecha, dime qué día y horario te gustaría.`;

    await reply(appointment, message, "CANCELLED_FALLBACK_REPLY");

    return { ok: true, action: "CANCELLED_FALLBACK", appointmentId: appointment.id };
  }

  if (appointment.status === "REPROGRAM_PENDING" && proposedDate) {
    return reprogramAppointment(appointment, proposedDate);
  }

  if (appointment.status === "REPROGRAM_PENDING" && validProposedDateFromSameTimeReference) {
    return reprogramAppointment(appointment, validProposedDateFromSameTimeReference);
  }

  if (appointment.status === "REPROGRAM_PENDING" && effectiveIntent === "CONFIRM") {
    const state = await prisma.whatsappAgentState.findUnique({
      where: {
        appointmentId_topic: {
          appointmentId: appointment.id,
          topic: "REPROGRAM"
        }
      }
    });
    const offeredSlots = Array.isArray(state?.offeredSlots) ? state.offeredSlots : [];

    if (offeredSlots.length === 1) {
      return selectOfferedAvailabilityOption(appointment, 1);
    }

    const message = `${appointment.client.fullName}, esta cita está pendiente de reprogramación. Dime qué día y hora te gustaría.`;

    await reply(appointment, message, "REPROGRAM_CONFIRM_REJECTED");

    return { ok: true, action: "REPROGRAM_CONFIRM_REJECTED", appointmentId: appointment.id };
  }

  if (effectiveIntent === "CONFIRM") {
    const confirmedAppointment = await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: "CONFIRMED", statusChangedAt: new Date() },
      include: { client: true }
    });
    await logAppointmentEvent({
      appointmentId: confirmedAppointment.id,
      type: "CONFIRMED",
      userId: confirmedAppointment.userId
    });
    await createAppointmentStatusNotification(confirmedAppointment, "CONFIRMED");

    const message = `Gracias ${appointment.client.fullName}, tu cita "${appointment.title}" queda confirmada para ${formatDateTime(
      appointment.startsAt
    )}.`;

    await reply(appointment, message, "CONFIRM_REPLY");

    return { ok: true, action: "CONFIRMED", appointmentId: appointment.id };
  }

  if (effectiveIntent === "CANCEL") {
    const cancelledAppointment = await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: "CANCELLED", statusChangedAt: new Date() },
      include: { client: true }
    });
    await logAppointmentEvent({
      appointmentId: cancelledAppointment.id,
      type: "CANCELLED",
      userId: cancelledAppointment.userId
    });

    const message = `Entendido ${appointment.client.fullName}, tu cita "${appointment.title}" del ${formatDateTime(
      appointment.startsAt
    )} quedó cancelada.`;

    await reply(appointment, message, "CANCEL_REPLY");
    await createAppointmentStatusNotification(cancelledAppointment, "CANCELLED");
    await notifyWaitlistForAvailableSlot(cancelledAppointment);

    return { ok: true, action: "CANCELLED", appointmentId: appointment.id };
  }

  if (effectiveIntent === "REPROGRAM_REQUEST") {
    if (validProposedDateFromSameTimeReference) {
      return reprogramAppointment(appointment, validProposedDateFromSameTimeReference);
    }

    const reprogrammingAppointment = await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: "REPROGRAM_PENDING", statusChangedAt: new Date() },
      include: { client: true }
    });
    await logAppointmentEvent({
      appointmentId: reprogrammingAppointment.id,
      type: "REPROGRAM_PENDING",
      userId: reprogrammingAppointment.userId
    });
    await createAppointmentStatusNotification(reprogrammingAppointment, "REPROGRAM_PENDING");
    await notifyWaitlistForAvailableSlot(reprogrammingAppointment);

    if (requestedRange) {
      return replyWithRangeAvailabilityQuestion(reprogrammingAppointment, requestedRange);
    }

    return askForPreferredReprogramTime(reprogrammingAppointment);
  }

  await createClientMessageNotification(appointment.client, input.message);

  return { ok: true, action: "CLIENT_MESSAGE_RECORDED", appointmentId: appointment.id };
}

export async function handleIncomingWhatsAppMessage(input: IncomingMessage) {
  const context = {
    mode: input.deliveryMode ?? "SEND",
    replies: [] as CollectedReply[]
  };

  return replyContext.run(context, async () => {
    const result = await handleIncomingWhatsAppMessageCore(input);

    if (context.mode === "COLLECT") {
      return {
        ...result,
        replies: context.replies
      };
    }

    return result;
  });
}
