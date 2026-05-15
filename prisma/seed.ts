import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");

  return `${salt}:${hash}`;
}

async function main() {
  await prisma.session.deleteMany();
  await prisma.reminderLog.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.client.deleteMany();
  await prisma.user.deleteMany();

  const doctor = await prisma.user.create({
    data: {
      name: "Doctor Demo",
      email: "doctor@demo.com",
      passwordHash: hashPassword("Demo12345")
    }
  });

  const ana = await prisma.client.create({
    data: {
      userId: doctor.id,
      fullName: "Ana Martinez",
      phone: "5216141234567",
      email: "ana@example.com",
      notes: "Prefiere recordatorios por WhatsApp por la tarde."
    }
  });

  const carlos = await prisma.client.create({
    data: {
      userId: doctor.id,
      fullName: "Carlos Hernandez",
      phone: "5216147654321",
      email: "carlos@example.com"
    }
  });

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);

  const later = new Date();
  later.setDate(later.getDate() + 2);
  later.setHours(16, 30, 0, 0);

  await prisma.appointment.createMany({
    data: [
      {
        userId: doctor.id,
        clientId: ana.id,
        title: "Consulta inicial",
        startsAt: tomorrow,
        durationMin: 45,
        status: "CONFIRMED",
        notes: "Enviar ubicacion un dia antes."
      },
      {
        userId: doctor.id,
        clientId: carlos.id,
        title: "Seguimiento",
        startsAt: later,
        durationMin: 60,
        status: "PENDING"
      }
    ]
  });

  await prisma.attendance.createMany({
    data: [
      {
        userId: doctor.id,
        clientId: ana.id,
        date: new Date(),
        status: "PRESENT",
        notes: "Llego a tiempo."
      },
      {
        userId: doctor.id,
        clientId: carlos.id,
        date: new Date(),
        status: "LATE",
        notes: "Llego 10 minutos tarde."
      }
    ]
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
