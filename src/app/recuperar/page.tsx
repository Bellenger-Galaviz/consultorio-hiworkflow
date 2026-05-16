import { ArrowLeft, Mail } from "lucide-react";
import Link from "next/link";
import { requestPasswordReset } from "../auth-actions";

export default async function RecoverPasswordPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="auth-page">
      <section className="auth-reset-card">
        <Link className="auth-link inline-flex items-center gap-2" href="/login">
          <ArrowLeft size={16} />
          Volver al login
        </Link>

        <div>
          <p className="auth-eyebrow">Recuperación de acceso</p>
          <h1 className="auth-title">Restablece tu contraseña</h1>
          <p className="mt-2 text-sm leading-6 text-white/60">
            Escribe tu correo y te enviaremos un enlace seguro para crear una nueva contraseña.
          </p>
        </div>

        <div className="auth-notice-slot">
          <Notice error={params.error} success={params.success} />
        </div>

        <form action={requestPasswordReset} className="grid gap-3">
          <label className="grid gap-1">
            <span className="auth-label">Correo</span>
            <input className="field auth-input" name="email" type="email" required />
          </label>
          <button className="auth-primary-button" type="submit">
            <Mail size={16} />
            Enviar enlace
          </button>
        </form>
      </section>
    </main>
  );
}

function Notice({ error, success }: { error?: string; success?: string }) {
  const message =
    success === "sent"
      ? "Si ese correo existe, enviaremos un enlace de recuperación."
      : error === "email"
        ? "No se pudo enviar el correo. Revisa la configuración SMTP."
        : error
          ? "Escribe un correo válido."
          : null;

  if (!message) {
    return null;
  }

  return (
    <p className={`auth-notice ${error ? "auth-notice-error" : "auth-notice-success"}`}>
      {message}
    </p>
  );
}
