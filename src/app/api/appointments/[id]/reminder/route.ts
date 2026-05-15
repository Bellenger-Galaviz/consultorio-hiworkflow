import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendAppointmentReminderByType } from "@/lib/reminders";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const secret = request.headers.get("x-webhook-secret");

  if (process.env.N8N_WEBHOOK_SECRET && secret !== process.env.N8N_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const appointment = await prisma.appointment
    .findUnique({
      where: { id },
      include: { client: true }
    })
    .catch(() => null);

  if (!appointment) {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }

  try {
    const result = await sendAppointmentReminderByType(appointment, "MANUAL");

    return NextResponse.json({ ok: true, logId: result.logId });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
