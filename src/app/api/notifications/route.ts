import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const user = await requireUser();
  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 8
  });

  return NextResponse.json({
    notifications: notifications.map((notification) => ({
      body: notification.body,
      createdAt: notification.createdAt.toISOString(),
      id: notification.id,
      status: notification.status,
      target: notification.target,
      title: notification.title
    })),
    unreadCount: notifications.filter((notification) => notification.status === "UNREAD").length
  });
}

export async function POST() {
  const user = await requireUser();

  await prisma.notification.updateMany({
    where: {
      userId: user.id,
      status: "UNREAD"
    },
    data: { status: "READ" }
  });

  return NextResponse.json({ ok: true });
}
