import Link from "next/link";

export default function NaoEncontrado() {
  return (
    <main className="min-h-[60dvh] grid place-items-center px-6 text-center">
      <div className="max-w-md">
        <p className="eyebrow text-ink-3">404</p>
        <h1 className="display mt-3 text-4xl">Esta página não existe.</h1>
        <p className="mt-4 text-ink-2">O link pode estar errado, ou a página já não está no site.</p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center rounded-control bg-ink px-5 font-semibold text-canvas transition hover:opacity-90"
        >
          Voltar ao início
        </Link>
      </div>
    </main>
  );
}
