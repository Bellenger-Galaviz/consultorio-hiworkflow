import type { Appointment, Client, User } from "@prisma/client";
import { findAppointmentConflict, getAppointmentEnd } from "@/lib/appointments";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import {
  createAppointmentStatusNotification,
  createClientMessageNotification,
  createUnknownContactNotification
} from "@/lib/notifications";
import { sendReminderToN8n } from "@/lib/n8n";
import { zonedDateTimeToUtc } from "@/lib/timezone";
import { formatInputDate } from "@/lib/timezone";
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
  agent?: {
    intent?: string;
    normalizedDateTime?: string;
    rangeStart?: string;
    rangeEnd?: string;
    period?: string;
    selectedOption?: number;
  };
};

type DateTimeParseResult =
  | { date: Date; error: null }
  | { date: null; error: "INVALID_FORMAT" | "INVALID_DATE" | "PAST_DATE" };

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
  "REPROGRAM_CONFIRM_REJECTED",
  "CANCELLED_CONFIRM_REJECTED",
  "CANCELLED_FALLBACK_REPLY",
  "FALLBACK_REPLY"
]);

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
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

function detectIntent(text: string) {
  const normalized = normalizeText(text);

  if (
    /\b(cancel\w*|no voy|no asistire|no podre|no puedo asistir)\b/.test(
      normalized
    )
  ) {
    return "CANCEL";
  }

  if (/\b(reprogram\w*|reagend\w*|cambiar|mover|posponer|pospongo|aplazar|no puedo)\b/.test(normalized)) {
    return "REPROGRAM_REQUEST";
  }

  if (/\b(confirmo|confirmar|si|ok|asisto|voy)\b/.test(normalized)) {
    return "CONFIRM";
  }

  return "UNKNOWN";
}

function isWaitlistConfirm(text: string) {
  const normalized = normalizeText(text);

  return /\b(si|sÃ­|confirmo|acepto|quiero|agendalo|agendar)\b/.test(normalized);
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

function timeToMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);

  return hour * 60 + minute;
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

  const match = normalizeText(message).match(/^(?:opcion\s*)?(\d{1,2})\b/);

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

async function reply(appointment: AppointmentWithClient, message: string, intent: string) {
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

  await sendReminderToN8n({
    client: appointment.client,
    appointment,
    message
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
      ? `Ese horario ya estÃ¡ ocupado. Estos son horarios disponibles cercanos:\n\n${alternatives
          .map((slot, index) => `${index + 1}. ${formatDateTime(slot)}`)
          .join("\n")}\n\nResponde con el nÃºmero de la opciÃ³n que prefieres o pregunta por otro rango.`
      : "Ese horario ya estÃ¡ ocupado y no encontrÃ© espacios cercanos disponibles. Pregunta por otra semana, otro mes o responde con otra fecha y hora.";

    await reply(appointment, message, alternatives.length ? "AVAILABILITY_OPTIONS" : "REPROGRAM_CONFLICT_REPLY");

    return { ok: true, action: "REPROGRAM_CONFLICT", appointmentId: appointment.id };
  }

  const updatedAppointment = await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      previousStartsAt: appointment.previousStartsAt ?? appointment.startsAt,
      startsAt: proposedDate,
      status: "PENDING",
      notes: `${appointment.notes ?? ""}\nReprogramada de ${formatDateTime(appointment.startsAt)} a ${formatDateTime(
        proposedDate
      )}.`.trim()
    },
    include: { client: true }
  });

  const message = `Listo ${appointment.client.fullName}, registramos tu nueva cita "${appointment.title}" para ${formatDateTime(
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

function buildAvailabilityMessage(appointment: AppointmentWithClient, slots: Date[]) {
  if (!slots.length) {
    return `${appointment.client.fullName}, no encontré horarios disponibles en ese rango. Puedes preguntar por otra semana, otro mes o responder con una fecha específica.`;
  }

  const options = slots
    .map((slot, index) => `${index + 1}. ${formatDateTime(slot)}`)
    .join("\n");

  return `${appointment.client.fullName}, encontré estos horarios disponibles:\n\n${options}\n\nResponde con el número de la opción que prefieres. Si quieres más alternativas, dime "más opciones" o pregunta por otro rango.`;
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

  await reply(appointment, message, "AVAILABILITY_OPTIONS");
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
  const message = `${appointment.client.fullName}, claro. ¿Qué día y hora te gustaría${rangeText}? Puedes responder algo como "mañana a las 9 am", "martes a las 16:00" o "la próxima semana por la tarde".`;

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
    )} está disponible. Responde 1 para reprogramar tu cita a ese horario o dime otra fecha.`;

    await reply(appointment, message, "AVAILABILITY_OPTIONS");
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
        .join("\n")}\n\nResponde con el número de la opción que prefieres o dime otra fecha.`
    : `${appointment.client.fullName}, no, ${formatDateTime(
        proposedDate
      )} ya está ocupado y no encontré otro espacio disponible ese día. Puedes preguntarme por otro día u otro rango.`;

  await reply(appointment, message, alternatives.length ? "AVAILABILITY_OPTIONS" : "REPROGRAM_CONFLICT_REPLY");

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
      ? `${appointment.client.fullName}, la fecha y hora que enviaste ya pasaron. Por favor responde con una fecha futura en formato DD/MM/AAAA HH:mm, por ejemplo 25/05/2026 16:30.`
      : `${appointment.client.fullName}, no pude identificar una fecha y hora válida. Por favor responde exactamente con el formato DD/MM/AAAA HH:mm, por ejemplo 25/05/2026 16:30.`;

  await reply(appointment, message, "REPROGRAM_DATE_FORMAT_RETRY");

  return { ok: true, action: "ASKED_REPROGRAM_DATE_FORMAT", appointmentId: appointment.id };
}

export async function handleIncomingWhatsAppMessage(input: IncomingMessage) {
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

  const proposedDateResult = parseSpanishDateTime(input.message);
  const proposedDate = proposedDateResult.date;
  const selectedOption = getSelectedOptionFromMessage(input.message, input.agent);

  if (appointment.status === "REPROGRAM_PENDING" && hasResponseContext && selectedOption) {
    return selectOfferedAvailabilityOption(appointment, selectedOption);
  }

  if (
    appointment.status === "REPROGRAM_PENDING" &&
    hasResponseContext &&
    input.agent?.intent === "AVAILABILITY_QUERY"
  ) {
    if (input.agent.normalizedDateTime) {
      const exactDateResult = parseSpanishDateTime(input.agent.normalizedDateTime);

      if (exactDateResult.date) {
        return replyWithExactAvailability(appointment, exactDateResult.date);
      }

      return askForReprogramDateAgain(appointment, exactDateResult.error);
    }

    if ((input.agent.rangeStart || input.agent.rangeEnd) && !input.agent.period) {
      return askForPreferredReprogramTime(appointment, {
        rangeStart: input.agent.rangeStart,
        rangeEnd: input.agent.rangeEnd
      });
    }

    const previousState = await prisma.whatsappAgentState.findUnique({
      where: {
        appointmentId_topic: {
          appointmentId: appointment.id,
          topic: "REPROGRAM"
        }
      }
    });
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
      period: input.agent.period ?? previousState?.period ?? undefined,
      excludeIso: isFollowUpWithoutNewRange ? previousSlots : undefined
    });
  }

  if (
    appointment.status === "REPROGRAM_PENDING" &&
    hasResponseContext &&
    intent === "UNKNOWN" &&
    isAvailabilityFollowUp(input.message)
  ) {
    const previousState = await prisma.whatsappAgentState.findUnique({
      where: {
        appointmentId_topic: {
          appointmentId: appointment.id,
          topic: "REPROGRAM"
        }
      }
    });
    const previousSlots = Array.isArray(previousState?.offeredSlots)
      ? previousState.offeredSlots.filter((slot): slot is string => typeof slot === "string")
      : [];

    return replyWithAvailabilityOptions(appointment, {
      rangeStart: previousState?.rangeStart ?? undefined,
      rangeEnd: previousState?.rangeEnd ?? undefined,
      period: previousState?.period ?? undefined,
      excludeIso: previousSlots
    });
  }

  if (
    appointment.status === "REPROGRAM_PENDING" &&
    hasResponseContext &&
    input.agent?.intent === "REPROGRAM_DATETIME" &&
    input.agent.normalizedDateTime
  ) {
    const agentDateResult = parseSpanishDateTime(input.agent.normalizedDateTime);

    if (agentDateResult.date) {
      return reprogramAppointment(appointment, agentDateResult.date);
    }

    return askForReprogramDateAgain(appointment, agentDateResult.error);
  }

  if (
    appointment.status === "REPROGRAM_PENDING" &&
    hasResponseContext &&
    intent === "UNKNOWN" &&
    !proposedDate
  ) {
    return askForReprogramDateAgain(appointment, proposedDateResult.error);
  }

  if (!hasResponseContext || intent === "UNKNOWN") {
    await createClientMessageNotification(appointment.client, input.message);

    return { ok: true, action: "CLIENT_MESSAGE_RECORDED", appointmentId: appointment.id };
  }

  if (appointment.status === "CANCELLED") {
    if (proposedDate) {
      return reprogramAppointment(appointment, proposedDate);
    }

    if (intent === "REPROGRAM_REQUEST") {
      const reprogrammingAppointment = await prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: "REPROGRAM_PENDING" },
        include: { client: true }
      });
      await createAppointmentStatusNotification(reprogrammingAppointment, "REPROGRAM_PENDING");

      return askForPreferredReprogramTime(reprogrammingAppointment);
    }

    if (intent === "CONFIRM") {
      const message = `${appointment.client.fullName}, esa cita ya fue cancelada y no se puede volver a activar con CONFIRMO. Responde REPROGRAMAR si quieres agendar una nueva fecha.`;

      await reply(appointment, message, "CANCELLED_CONFIRM_REJECTED");

      return { ok: true, action: "CANCELLED_CONFIRM_REJECTED", appointmentId: appointment.id };
    }

    const message = `${appointment.client.fullName}, esa cita estÃ¡ cancelada. Responde REPROGRAMAR si quieres agendar una nueva fecha.`;

    await reply(appointment, message, "CANCELLED_FALLBACK_REPLY");

    return { ok: true, action: "CANCELLED_FALLBACK", appointmentId: appointment.id };
  }

  if (appointment.status === "REPROGRAM_PENDING" && proposedDate) {
    return reprogramAppointment(appointment, proposedDate);
  }

  if (appointment.status === "REPROGRAM_PENDING" && intent === "CONFIRM") {
    const message = `${appointment.client.fullName}, esta cita está pendiente de reprogramación. Dime qué día y hora te gustaría, por ejemplo "mañana a las 9 am" o "la próxima semana por la tarde".`;

    await reply(appointment, message, "REPROGRAM_CONFIRM_REJECTED");

    return { ok: true, action: "REPROGRAM_CONFIRM_REJECTED", appointmentId: appointment.id };
  }

  if (intent === "CONFIRM") {
    const confirmedAppointment = await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: "CONFIRMED" },
      include: { client: true }
    });
    await createAppointmentStatusNotification(confirmedAppointment, "CONFIRMED");

    const message = `Gracias ${appointment.client.fullName}, tu cita "${appointment.title}" queda confirmada para ${formatDateTime(
      appointment.startsAt
    )}.`;

    await reply(appointment, message, "CONFIRM_REPLY");

    return { ok: true, action: "CONFIRMED", appointmentId: appointment.id };
  }

  if (intent === "CANCEL") {
    const cancelledAppointment = await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: "CANCELLED" },
      include: { client: true }
    });

    const message = `Entendido ${appointment.client.fullName}, tu cita "${appointment.title}" del ${formatDateTime(
      appointment.startsAt
    )} quedÃ³ cancelada.`;

    await reply(appointment, message, "CANCEL_REPLY");
    await createAppointmentStatusNotification(cancelledAppointment, "CANCELLED");
    await notifyWaitlistForAvailableSlot(cancelledAppointment);

    return { ok: true, action: "CANCELLED", appointmentId: appointment.id };
  }

  if (intent === "REPROGRAM_REQUEST") {
    const reprogrammingAppointment = await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: "REPROGRAM_PENDING" },
      include: { client: true }
    });
    await createAppointmentStatusNotification(reprogrammingAppointment, "REPROGRAM_PENDING");
    await notifyWaitlistForAvailableSlot(reprogrammingAppointment);

    return askForPreferredReprogramTime(reprogrammingAppointment);
  }

  await createClientMessageNotification(appointment.client, input.message);

  return { ok: true, action: "CLIENT_MESSAGE_RECORDED", appointmentId: appointment.id };
}
