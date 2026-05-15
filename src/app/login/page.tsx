import { CalendarClock, LogIn, UserPlus } from "lucide-react";
import { loginDoctor, registerDoctor } from "../auth-actions";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-paper px-5 py-8">
      <div className="w-full max-w-5xl overflow-hidden rounded-md border border-black/10 bg-white shadow-soft">
        <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
          <section className="bg-ink p-8 text-white">
            <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-md bg-mint text-leaf">
              <CalendarClock size={26} />
            </div>
            <h1 className="text-3xl font-bold">Sistema para doctores</h1>
            <p className="mt-3 max-w-sm text-white/75">
              Cada cuenta administra sus propios pacientes, citas, asistencias y recordatorios.
            </p>
          </section>

          <section className="grid gap-6 p-6 md:grid-cols-2 md:p-8">
            <ErrorMessage error={params.error} />

            <div>
              <div className="mb-4 flex items-center gap-2">
                <LogIn size={18} className="text-leaf" />
                <h2 className="text-xl font-bold">Iniciar sesion</h2>
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
                <h2 className="text-xl font-bold">Crear usuario</h2>
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
