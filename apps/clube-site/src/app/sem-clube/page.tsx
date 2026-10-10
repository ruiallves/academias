/**
 * O que se vê num domínio que ainda não está ligado a clube nenhum. Não diz
 * de quem é o site nem lista clubes: só que este endereço ainda não está
 * pronto.
 */
export default function SemClube() {
  return (
    <main className="min-h-dvh grid place-items-center px-6 text-center">
      <div className="max-w-md">
        <p className="eyebrow text-ink-3">Academias</p>
        <h1 className="display mt-3 text-4xl">Este endereço ainda não está ligado a nenhum clube.</h1>
        <p className="mt-4 text-ink-2">
          Se és do clube, o domínio está registado mas ainda não apontado. Fala connosco e tratamos disso.
        </p>
      </div>
    </main>
  );
}
