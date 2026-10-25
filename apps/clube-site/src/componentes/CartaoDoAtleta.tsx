import Image from "next/image";

type Atleta = { name: string; number?: number; position?: string; photo?: string };

/**
 * Um atleta do plantel: a fotografia, o número por cima dela, o nome e a
 * posição por baixo.
 *
 * A fotografia só vem quando o clube ligou "Fotos dos atletas" nessa equipa e
 * o atleta tem foto na ficha (ver `EquipaNoSite.fotos` na API). Sem ela, a
 * imagem padrão: uma silhueta sobre a cor do clube, a mesma para todos, para
 * o plantel ler-se igual com e sem fotografias.
 */
export function CartaoDoAtleta({ atleta }: { atleta: Atleta }) {
  return (
    <article className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="relative aspect-[4/5] overflow-hidden bg-signal-soft">
        {atleta.photo ? (
          <Image
            src={atleta.photo}
            alt={atleta.name}
            fill
            sizes="(min-width: 1024px) 18vw, (min-width: 640px) 30vw, 45vw"
            className="object-cover object-top"
            // Em desenvolvimento a API é http://localhost, que o optimizador de imagens recusa.
            unoptimized={atleta.photo.startsWith("http://")}
          />
        ) : (
          <Silhueta />
        )}
        <span className="display absolute left-2 top-2 grid min-w-9 place-items-center rounded-control bg-signal-strong px-2 py-1 text-xl leading-none text-signal-on tabular">
          {atleta.number ?? "–"}
        </span>
      </div>
      <div className="px-3 py-2.5">
        <p className="truncate font-semibold text-ink">{atleta.name}</p>
        {atleta.position && <p className="truncate text-sm text-ink-3">{atleta.position}</p>}
      </div>
    </article>
  );
}

/** A imagem padrão: cabeça e ombros, na tinta do clube, sem cara nenhuma. */
function Silhueta() {
  return (
    <svg viewBox="0 0 80 100" aria-hidden className="absolute inset-0 size-full text-signal-ink opacity-25" preserveAspectRatio="xMidYMax meet">
      <circle cx="40" cy="38" r="17" fill="currentColor" />
      <path d="M8 100c0-21 14.3-36 32-36s32 15 32 36Z" fill="currentColor" />
    </svg>
  );
}
