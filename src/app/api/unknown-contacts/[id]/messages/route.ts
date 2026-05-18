import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  const { id } = await params;
  const contact = await prisma.unknownContact.findFirst({
    where: {
      id,
      userId: user.id,
      status: "NEW"
    }
  });

  if (!contact) {
    return NextResponse.json({ error: "Contacto no encontrado." }, { status: 404 });
  }

  const messages = await prisma.unknownContactMessage.findMany({
    where: {
      userId: user.id,
      unknownContactId: id
    },
    orderBy: { createdAt: "asc" },
    take: 80
  });

  return NextResponse.json({
    messages: messages.map((message) => ({
      appointmentTitle: null,
      createdAt: message.createdAt.toISOString(),
      direction: message.direction,
      id: message.id,
      message: message.message
    }))
  });
}
