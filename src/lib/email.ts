import nodemailer from "nodemailer";

type PasswordResetEmailInput = {
  resetUrl: string;
  to: string;
};

export async function sendPasswordResetEmail({ resetUrl, to }: PasswordResetEmailInput) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const from = process.env.EMAIL_FROM;

  if (!host || !from) {
    throw new Error("Configura SMTP_HOST, SMTP_PORT y EMAIL_FROM para enviar correos.");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        : undefined
  });

  await transporter.sendMail({
    from,
    to,
    subject: "Restablece tu contraseña de HiWorkflow",
    text: [
      "Recibimos una solicitud para restablecer tu contraseña.",
      "",
      `Abre este enlace para crear una nueva contraseña: ${resetUrl}`,
      "",
      "El enlace vence en 1 hora. Si no solicitaste este cambio, puedes ignorar este correo."
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.55;color:#102019">
        <h2>Restablece tu contraseña</h2>
        <p>Recibimos una solicitud para restablecer tu contraseña.</p>
        <p>
          <a href="${resetUrl}" style="display:inline-block;background:#17a9c2;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:700">
            Crear nueva contraseña
          </a>
        </p>
        <p>El enlace vence en 1 hora. Si no solicitaste este cambio, puedes ignorar este correo.</p>
      </div>
    `
  });
}
