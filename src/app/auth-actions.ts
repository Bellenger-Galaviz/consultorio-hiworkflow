"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createSession,
  destroySession,
  hashPassword,
  verifyPassword
} from "@/lib/auth";
import { prisma } from "@/lib/db";

const registerSchema = z.object({
  name: z.string().min(2, "Escribe tu nombre."),
  email: z.string().email("Escribe un correo válido.").transform((value) => value.toLowerCase()),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.")
});

const loginSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1)
});

export async function registerDoctor(formData: FormData) {
  const result = registerSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    redirect("/login?error=register");
  }

  const data = result.data;
  const existing = await prisma.user.findUnique({ where: { email: data.email } });

  if (existing) {
    redirect("/login?error=exists");
  }

  try {
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash: hashPassword(data.password)
      }
    });

    await createSession(user.id);
  } catch {
    redirect("/login?error=register");
  }

  redirect("/");
}

export async function loginDoctor(formData: FormData) {
  const result = loginSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    redirect("/login?error=invalid");
  }

  const data = result.data;
  const user = await prisma.user.findUnique({ where: { email: data.email } });

  if (!user || !verifyPassword(data.password, user.passwordHash)) {
    redirect("/login?error=invalid");
  }

  await createSession(user.id);
  redirect("/");
}

export async function logoutDoctor() {
  await destroySession();
  redirect("/login");
}
