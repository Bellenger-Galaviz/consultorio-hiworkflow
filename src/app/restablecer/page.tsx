import { ArrowLeft, KeyRound } from "lucide-react";
import Link from "next/link";
import { resetPassword } from "../auth-actions";

export default async function ResetPasswordPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token ?? "";

  return (
    <main className="auth-page">
      <section className="auth-reset-card">
        <Link className="auth-link inline-flex items-center gap-2" href="/login">
          <ArrowLeft size={16} />
          Volver al login
        </Link>

        <div>
          <p className="auth-eyebrow">Nueva contraseña</p>
          <h1 className="auth-title">Crea una contraseña segura</h1>
        </div>

        <div className="auth-notice-slot">
          <Notice error={params.error} missingToken={!token} />
        </div>

        <form action={resetPassword} className="grid gap-3">
          <input name="token" type="hidden" value={token} />
          <label className="grid gap-1">
            <span className="auth-label">Nueva contraseña</span>
            <input className="field auth-input" minLength={8} name="password" type="password" required />
          </label>
          <label className="grid gap-1">
            <span className="auth-label">Confirmar contraseña</span>
            <input className="field auth-input" minLength={8} name="confirmPassword" type="password" required />
          </label>
          <button className="auth-primary-button" disabled={!token} type="submit">
            <KeyRound size={16} />
            Guardar contraseña
          </button>
        </form>
      </section>
    </main>
  );
}

function Notice({ error, missingToken }: { error?: string; missingToken: boolean }) {
  const message = missingToken
    ? "El enlace de recuperación no es válido."
    : error === "expired"
      ? "El enlace venció o ya fue usado. Solicita uno nuevo."
      : error
        ? "Las contraseñas deben coincidir y tener al menos 8 caracteres."
        : null;

  if (!message) {
    return null;
  }

  return <p className="auth-notice auth-notice-error">{message}</p>;
}
