import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  const { id } = await params;
  const client = await prisma.client.findFirst({
    where: {
      id,
      userId: user.id
    }
  });

  if (!client) {
    return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 });
  }

  const [chatMessages, reminderMessages] = await Promise.all([
    prisma.chatMessage.findMany({
      where: {
        userId: user.id,
        clientId: id
      },
      include: { appointment: true },
      orderBy: { createdAt: "asc" },
      take: 80
    }),
    prisma.reminderLog.findMany({
      where: {
        userId: user.id,
        clientId: id
      },
      include: { appointment: true },
      orderBy: { sentAt: "asc" },
      take: 80
    })
  ]);
  const chatMessageKeys = new Set(
    chatMessages.map((message) => `${message.appointmentId ?? ""}:${message.message}`)
  );
  const messages = [
    ...chatMessages.map((message) => ({
      appointmentTitle: message.appointment?.title ?? null,
      createdAt: message.createdAt.toISOString(),
      direction: message.direction,
      id: message.id,
      message: message.message
    })),
    ...reminderMessages
      .filter((message) => !chatMessageKeys.has(`${message.appointmentId ?? ""}:${message.message}`))
      .map((message) => ({
        appointmentTitle: message.appointment?.title ?? null,
        createdAt: message.sentAt.toISOString(),
        direction: "OUTBOUND",
        id: `reminder-${message.id}`,
        message: message.message
      }))
  ].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

  return NextResponse.json({ messages });
}
