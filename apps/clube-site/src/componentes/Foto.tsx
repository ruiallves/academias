import Image from "next/image";

/**
 * Uma fotografia que pode não existir.
 *
 * Uma notícia ou um produto sem foto é normal (nem toda a notícia de um clube
 * de formação tem fotografia). Em vez de uma caixa cinzenta vazia, o lugar
 * fica na cor do clube com o emblema em marca de água: lê-se como "do clube",
 * não como "imagem partida".
 *
 * Sempre `fill`: quem chama dá o tamanho ao contentor.
 */
export function Foto({
  src,
  alt = "",
  sizes,
  priority = false,
  className = "",
}: {
  src?: string;
  alt?: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  if (src) return <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className={`object-cover ${className}`} />;
  return (
    <div aria-hidden className="absolute inset-0 grid place-items-center bg-signal-strong">
      <svg viewBox="0 0 48 56" className="h-1/3 max-h-24 w-auto opacity-20">
        <path d="M24 2 44 9v19c0 13-9 21-20 26C13 49 4 41 4 28V9l20-7Z" fill="var(--color-signal-on)" />
      </svg>
    </div>
  );
}
