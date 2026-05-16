"use server";

import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  createSession,
  destroySession,
  hashPassword,
  verifyPassword
} from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email";

const registerSchema = z.object({
  name: z.string().min(2, "Escribe tu nombre."),
  email: z.string().email("Escribe un correo válido.").transform((value) => value.toLowerCase()),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.")
});

const loginSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1)
});

const forgotPasswordSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase())
});

const resetPasswordSchema = z
  .object({
    confirmPassword: z.string().min(8),
    password: z.string().min(8),
    token: z.string().min(20)
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"]
  });

function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getPublicUrl() {
  return (process.env.APP_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

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

export async function requestPasswordReset(formData: FormData) {
  const result = forgotPasswordSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    redirect("/recuperar?error=invalid");
  }

  const user = await prisma.user.findUnique({ where: { email: result.data.email } });

  if (!user) {
    redirect("/recuperar?success=sent");
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.passwordResetToken.deleteMany({
    where: {
      userId: user.id,
      usedAt: null
    }
  });

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashResetToken(token),
      expiresAt
    }
  });

  try {
    await sendPasswordResetEmail({
      to: user.email,
      resetUrl: `${getPublicUrl()}/restablecer?token=${token}`
    });
  } catch {
    redirect("/recuperar?error=email");
  }

  redirect("/recuperar?success=sent");
}

export async function resetPassword(formData: FormData) {
  const result = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  const rawToken = String(formData.get("token") ?? "");
  const tokenQuery = rawToken ? `token=${encodeURIComponent(rawToken)}&` : "";

  if (!result.success) {
    redirect(`/restablecer?${tokenQuery}error=invalid`);
  }

  const tokenHash = hashResetToken(result.data.token);
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash }
  });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    redirect(`/restablecer?${tokenQuery}error=expired`);
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash: hashPassword(result.data.password) }
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() }
    }),
    prisma.session.deleteMany({
      where: { userId: resetToken.userId }
    })
  ]);

  redirect("/login?success=password-reset");
}

export async function logoutDoctor() {
  await destroySession();
  redirect("/login");
}
