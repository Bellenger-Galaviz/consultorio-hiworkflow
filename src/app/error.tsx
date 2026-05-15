"use client";

export default function Error({
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-5">
      <section className="w-full max-w-md rounded-md border border-black/10 bg-white p-6 text-center shadow-soft">
        <h1 className="text-2xl font-bold text-ink">Algo no salió bien</h1>
        <p className="mt-2 text-sm text-ink/65">
          No se perdieron tus datos. Intenta de nuevo o vuelve a cargar la pagina.
        </p>
        <button className="primary-button mt-5" onClick={reset} type="button">
          Reintentar
        </button>
      </section>
    </main>
  );
}
