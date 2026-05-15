import type { Appointment, Client } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatInputDate } from "@/lib/timezone";

type AppointmentWithClient = Appointment & {
  client: Client;
};

const statusText: Record<string, { title: string; verb: string }> = {
  CANCELLED: { title: "Cita cancelada", verb: "canceló" },
  CONFIRMED: { title: "Cita confirmada", verb: "confirmó" },
  REPROGRAM_PENDING: { title: "Cita por reprogramar", verb: "pidió reprogramar" },
  ATTENDED: { title: "Asistencia registrada", verb: "asistió a" },
  MISSED: { title: "Inasistencia registrada", verb: "no asistió a" },
  PENDING: { title: "Cita pendiente", verb: "quedó pendiente en" }
};

export async function createAppointmentStatusNotification(
  appointment: AppointmentWithClient,
  status: string
) {
  const copy = statusText[status];

  if (!copy) {
    return;
  }

  await prisma.notification.create({
    data: {
      userId: appointment.userId,
      type: `APPOINTMENT_${status}`,
      title: copy.title,
      body: `${appointment.client.fullName} ${copy.verb} "${appointment.title}" el ${formatDateTime(
        appointment.startsAt
      )}.`,
      target: `/?day=${formatInputDate(appointment.startsAt)}`,
      appointmentId: appointment.id
    }
  });
}
