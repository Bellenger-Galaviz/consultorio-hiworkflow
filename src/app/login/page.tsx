import { LogIn, UserPlus } from "lucide-react";
import Image from "next/image";
import { loginDoctor, registerDoctor } from "../auth-actions";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-paper px-5 py-8">
      <div className="w-full max-w-6xl overflow-hidden rounded-md border border-black/10 bg-white shadow-soft">
        <div className="grid lg:grid-cols-[0.95fr_1.05fr]">
          <section className="login-stage grid min-h-[430px] place-items-center overflow-hidden p-8 lg:min-h-[610px] lg:p-10">
            <div className="login-orbit" aria-label="HiWorkflow">
              <span className="login-orbit-line" />
              <span className="login-orbit-line" />
              <span className="login-orbit-line" />
              <div className="login-logo-core">
                <Image
                  alt="HiWorkflow"
                  className="h-auto w-full object-contain"
                  height={260}
                  priority
                  src="/hiworkflow-logo-wide.png"
                  width={620}
                />
              </div>
            </div>
          </section>

          <section className="grid content-center gap-8 p-6 md:p-8 lg:p-10">
            <ErrorMessage error={params.error} />

            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-leaf">Acceso seguro</p>
              <h1 className="mt-2 text-3xl font-bold text-ink">Entra o crea tu cuenta</h1>
            </div>

            <div className="grid gap-8 md:grid-cols-2">
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <LogIn size={18} className="text-leaf" />
                  <h2 className="text-xl font-bold text-ink">Iniciar sesión</h2>
                </div>
                <form action={loginDoctor} className="grid gap-3">
                  <label className="grid gap-1">
                    <span className="label">Correo</span>
                    <input className="field" name="email" type="email" required />
                  </label>
                  <label className="grid gap-1">
                    <span className="label">Contraseña</span>
                    <input className="field" name="password" type="password" required />
                  </label>
                  <button className="primary-button" type="submit">
                    <LogIn size={16} />
                    Entrar
                  </button>
                </form>
              </div>

              <div>
                <div className="mb-4 flex items-center gap-2">
                  <UserPlus size={18} className="text-leaf" />
                  <h2 className="text-xl font-bold text-ink">Crear usuario</h2>
                </div>
                <form action={registerDoctor} className="grid gap-3">
                  <label className="grid gap-1">
                    <span className="label">Nombre</span>
                    <input className="field" name="name" required />
                  </label>
                  <label className="grid gap-1">
                    <span className="label">Correo</span>
                    <input className="field" name="email" type="email" required />
                  </label>
                  <label className="grid gap-1">
                    <span className="label">Contraseña</span>
                    <input className="field" minLength={8} name="password" type="password" required />
                  </label>
                  <button className="secondary-button" type="submit">
                    <UserPlus size={16} />
                    Crear cuenta
                  </button>
                </form>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function ErrorMessage({ error }: { error?: string }) {
  if (!error) {
    return null;
  }

  const message =
    error === "exists"
      ? "Ese correo ya tiene una cuenta."
      : error === "register"
        ? "Revisa los datos para crear la cuenta."
        : "Correo o contraseña incorrectos.";

  return (
    <p className="rounded-md border border-coral/30 bg-coral/10 px-3 py-2 text-sm font-semibold text-coral md:col-span-2">
      {message}
    </p>
  );
}
