import { prisma } from "@/lib/db";

const BLOCKING_STATUSES = ["PENDING", "CONFIRMED"];

export function getAppointmentEnd(startsAt: Date, durationMin: number) {
  return new Date(startsAt.getTime() + durationMin * 60 * 1000);
}

export async function findAppointmentConflict({
  userId,
  startsAt,
  durationMin,
  ignoreAppointmentId
}: {
  userId: string;
  startsAt: Date;
  durationMin: number;
  ignoreAppointmentId?: string;
}) {
  const endsAt = getAppointmentEnd(startsAt, durationMin);
  const appointments = await prisma.appointment.findMany({
    where: {
      userId,
      status: { in: BLOCKING_STATUSES },
      ...(ignoreAppointmentId ? { id: { not: ignoreAppointmentId } } : {})
    },
    include: { client: true },
    orderBy: { startsAt: "asc" }
  });

  return (
    appointments.find((appointment) => {
      const existingEnd = getAppointmentEnd(appointment.startsAt, appointment.durationMin);

      return startsAt < existingEnd && endsAt > appointment.startsAt;
    }) ?? null
  );
}

export async function getNextClientAppointmentNumber(clientId: string) {
  const lastAppointment = await prisma.appointment.findFirst({
    where: {
      clientId,
      clientAppointmentNumber: { not: null }
    },
    orderBy: { clientAppointmentNumber: "desc" },
    select: { clientAppointmentNumber: true }
  });

  return (lastAppointment?.clientAppointmentNumber ?? 0) + 1;
}
