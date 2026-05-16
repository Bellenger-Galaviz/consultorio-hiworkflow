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
        <div className="grid lg:grid-cols-[1fr_1.15fr]">
          <section className="bg-black p-8 text-white lg:p-10">
            <div className="flex min-h-[520px] flex-col justify-between gap-10">
              <div>
                <Image
                  alt="HiWorkflow"
                  className="h-auto w-full max-w-md object-contain"
                  height={240}
                  priority
                  src="/hiworkflow-logo.png"
                  width={520}
                />
                <div className="mt-8 h-px w-full bg-white/15" />
              </div>

              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-leaf">
                  Consultorio HiWorkflow
                </p>
                <h1 className="mt-3 max-w-md text-4xl font-bold leading-tight">
                  Gestión clínica con recordatorios inteligentes.
                </h1>
                <p className="mt-4 max-w-md text-base leading-7 text-white/75">
                  Administra pacientes, citas, confirmaciones, lista de espera y conversaciones de WhatsApp desde un solo panel.
                </p>
              </div>
            </div>
          </section>

          <section className="grid content-center gap-8 p-6 md:p-8 lg:p-10">
            <ErrorMessage error={params.error} />

            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-wide text-leaf">Acceso seguro</p>
              <h2 className="mt-2 text-3xl font-bold text-ink">Entra o crea tu cuenta</h2>
              <p className="mt-2 text-sm leading-6 text-ink/60">
                Cada doctor trabaja con sus propios pacientes, citas y mensajes. La información no se comparte entre cuentas.
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-2">
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <LogIn size={18} className="text-leaf" />
                  <h3 className="text-xl font-bold text-ink">Iniciar sesión</h3>
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
                  <h3 className="text-xl font-bold text-ink">Crear usuario</h3>
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
