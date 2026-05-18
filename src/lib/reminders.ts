import type { Appointment, Client } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { sendReminderToN8n } from "@/lib/n8n";

export type ReminderType = "MANUAL" | "REMINDER_24H" | "REMINDER_1H";

type AppointmentWithClient = Appointment & {
  client: Client;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const REMINDER_24H_WINDOW_MS =
  Number(process.env.REMINDER_24H_WINDOW_MIN ?? 90) * 60 * 1000;

export function buildReminderMessage(appointment: AppointmentWithClient, type: ReminderType) {
  if (type === "REMINDER_24H") {
    return `Hola ${appointment.client.fullName}, te recordamos que tienes una cita "${appointment.title}" programada para ${formatDateTime(
      appointment.startsAt
    )}. Responde CONFIRMO para confirmar, CANCELAR para cancelar o REPROGRAMAR para cambiar la fecha.`;
  }

  if (type === "REMINDER_1H") {
    return `Hola ${appointment.client.fullName}, tu cita "${appointment.title}" es en aproximadamente 1 hora. Responde CONFIRMO para confirmar, CANCELAR para cancelar o REPROGRAMAR para cambiar la fecha.`;
  }

  return `Hola ${appointment.client.fullName}, te recordamos tu cita "${appointment.title}" programada para ${formatDateTime(
    appointment.startsAt
  )}. Responde CONFIRMO para confirmar, CANCELAR para cancelar o REPROGRAMAR para cambiar la fecha.`;
}

export async function sendAppointmentReminderByType(
  appointment: AppointmentWithClient,
  type: ReminderType
) {
  if (type !== "MANUAL") {
    const previous = await prisma.reminderLog.findFirst({
      where: {
        appointmentId: appointment.id,
        userId: appointment.userId,
        type,
        status: "SENT"
      }
    });

    if (previous) {
      return { skipped: true, logId: previous.id };
    }
  }

  const message = buildReminderMessage(appointment, type);

  try {
    const response = await sendReminderToN8n({
      client: appointment.client,
      appointment,
      message
    });

    const log = await prisma.reminderLog.create({
      data: {
        clientId: appointment.clientId,
        userId: appointment.userId,
        appointmentId: appointment.id,
        type,
        message,
        status: "SENT",
        response
      }
    });

    await prisma.chatMessage.create({
      data: {
        userId: appointment.userId,
        clientId: appointment.clientId,
        appointmentId: appointment.id,
        direction: "OUTBOUND",
        message,
        intent: type
      }
    });

    return { skipped: false, logId: log.id };
  } catch (error) {
    const log = await prisma.reminderLog.create({
      data: {
        clientId: appointment.clientId,
        userId: appointment.userId,
        appointmentId: appointment.id,
        type,
        message,
        status: "FAILED",
        response: error instanceof Error ? error.message : "Unknown error"
      }
    });

    if (type === "MANUAL") {
      throw error;
    }

    return { skipped: false, logId: log.id, error: log.response };
  }
}

export async function sendDueAutomaticReminders() {
  const now = new Date();
  const next24Hours = new Date(now.getTime() + DAY_MS);

  const appointments = await prisma.appointment.findMany({
    where: {
      startsAt: {
        gt: now,
        lte: next24Hours
      },
      status: {
        in: ["PENDING", "CONFIRMED"]
      }
    },
    include: { client: true },
    orderBy: { startsAt: "asc" },
    take: 100
  });

  const results = [];

  for (const appointment of appointments) {
    const msUntilStart = appointment.startsAt.getTime() - now.getTime();
    const isIn24HourReminderWindow =
      msUntilStart > DAY_MS - REMINDER_24H_WINDOW_MS && msUntilStart <= DAY_MS;
    const isIn1HourReminderWindow = msUntilStart > 0 && msUntilStart <= HOUR_MS;

    if (isIn24HourReminderWindow) {
      results.push({
        appointmentId: appointment.id,
        type: "REMINDER_24H",
        ...(await sendAppointmentReminderByType(appointment, "REMINDER_24H"))
      });
    }

    if (appointment.status === "PENDING" && isIn1HourReminderWindow) {
      results.push({
        appointmentId: appointment.id,
        type: "REMINDER_1H",
        ...(await sendAppointmentReminderByType(appointment, "REMINDER_1H"))
      });
    }
  }

  return results;
}
