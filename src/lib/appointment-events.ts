import { prisma } from "@/lib/db";

const EVENT_LABELS: Record<string, string> = {
  ATTENDED: "Marcada como asistida",
  CANCELLED: "Cancelada",
  CONFIRMED: "Confirmada",
  CREATED: "Creada",
  MISSED: "Marcada como no asistió",
  PENDING: "Pendiente",
  REPROGRAM_PENDING: "Pospuesta",
  REPROGRAMMED: "Reprogramada"
};

export function getAppointmentEventLabel(type: string) {
  return EVENT_LABELS[type] ?? type;
}

export async function logAppointmentEvent({
  appointmentId,
  type,
  userId
}: {
  appointmentId: string;
  type: string;
  userId: string;
}) {
  return prisma.appointmentEvent.create({
    data: {
      appointmentId,
      label: getAppointmentEventLabel(type),
      type,
      userId
    }
  });
}
