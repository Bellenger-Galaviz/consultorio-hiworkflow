import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  const { id } = await params;
  const file = await prisma.clientFile.findFirst({
    where: {
      id,
      userId: user.id
    }
  });

  if (!file) {
    return NextResponse.json({ error: "Archivo no encontrado." }, { status: 404 });
  }

  const updatedFile = await prisma.clientFile.update({
    where: { id: file.id },
    data: {
      savedAt: file.savedAt ?? new Date(),
      status: "SAVED"
    }
  });

  return NextResponse.json({
    file: {
      id: updatedFile.id,
      savedToRecord: updatedFile.status === "SAVED"
    }
  });
}
