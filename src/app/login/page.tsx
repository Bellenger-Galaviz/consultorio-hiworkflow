import { LogIn, UserPlus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { loginDoctor, registerDoctor } from "../auth-actions";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="auth-page">
      <div className="auth-shell">
        <section className="auth-visual">
          <div className="login-orbit" aria-label="HiWorkflow">
            <span className="login-orbit-line" />
            <span className="login-orbit-line" />
            <span className="login-orbit-line" />
            <Image
              alt="HiWorkflow"
              className="login-logo-image"
              height={260}
              priority
              src="/hiworkflow-logo-wide.png"
              width={620}
            />
          </div>
        </section>

        <section className="auth-panel">
          <div>
            <p className="auth-eyebrow">Acceso seguro</p>
            <h1 className="auth-title">Entra o crea tu cuenta</h1>
          </div>

          <div className="auth-notice-slot">
            <Notice error={params.error} success={params.success} />
          </div>

          <div className="auth-forms">
            <div>
              <div className="mb-4 flex items-center gap-2">
                <LogIn size={18} className="text-sky" />
                <h2 className="text-xl font-bold text-white">Iniciar sesión</h2>
              </div>
              <form action={loginDoctor} className="grid gap-3">
                <label className="grid gap-1">
                  <span className="auth-label">Correo</span>
                  <input className="field auth-input" name="email" type="email" required />
                </label>
                <label className="grid gap-1">
                  <span className="auth-label">Contraseña</span>
                  <input className="field auth-input" name="password" type="password" required />
                </label>
                <button className="auth-primary-button" type="submit">
                  <LogIn size={16} />
                  Entrar
                </button>
                <Link className="auth-link" href="/recuperar">
                  Olvidé mi contraseña
                </Link>
              </form>
            </div>

            <div>
              <div className="mb-4 flex items-center gap-2">
                <UserPlus size={18} className="text-sky" />
                <h2 className="text-xl font-bold text-white">Crear usuario</h2>
              </div>
              <form action={registerDoctor} className="grid gap-3">
                <label className="grid gap-1">
                  <span className="auth-label">Nombre</span>
                  <input className="field auth-input" name="name" required />
                </label>
                <label className="grid gap-1">
                  <span className="auth-label">Correo</span>
                  <input className="field auth-input" name="email" type="email" required />
                </label>
                <label className="grid gap-1">
                  <span className="auth-label">Contraseña</span>
                  <input className="field auth-input" minLength={8} name="password" type="password" required />
                </label>
                <button className="auth-secondary-button" type="submit">
                  <UserPlus size={16} />
                  Crear cuenta
                </button>
              </form>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Notice({ error, success }: { error?: string; success?: string }) {
  const errorMessage =
    error === "exists"
      ? "Ese correo ya tiene una cuenta."
      : error === "register"
        ? "Revisa los datos para crear la cuenta."
        : error
          ? "Correo o contraseña incorrectos."
          : null;
  const successMessage = success === "password-reset" ? "Contraseña actualizada. Ya puedes iniciar sesión." : null;
  const message = errorMessage ?? successMessage;

  if (!message) {
    return null;
  }

  return (
    <p className={`auth-notice ${errorMessage ? "auth-notice-error" : "auth-notice-success"}`}>
      {message}
    </p>
  );
}
