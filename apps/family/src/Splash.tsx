import { useEffect, useState, type ReactNode } from "react";
import { ClubMark } from "@/ClubMark";
import { readBrand } from "@/lib/brand";

/**
 * O ecrã de arranque, enquanto o servidor não responde.
 *
 * Era um quadrado da cor do clube a pulsar, com "A carregar…" por baixo. Passa
 * a ser o símbolo do clube (o mesmo do ícone no ecrã inicial), a respirar
 * devagar, sem texto nenhum: o que o telemóvel acabou de mostrar ao abrir a
 * app é o ícone, e o splash continua-o em vez de o trocar por outra coisa. A
 * marca vem do `localStorage` (ver `lib/brand.ts`), por isso está certa antes
 * de haver dados.
 *
 * Com os dados guardados da última abertura (ver `lib/arranque.ts`) este ecrã
 * quase nunca se vê: a app desenha-se logo com eles.
 */

/* Quando o splash saiu do ecrã pela última vez — para a saída dele se animar. */
let escondidoEm = 0;

export function Splash({ demora }: { demora?: ReactNode }) {
  const [tarde, setTarde] = useState(false);
  const brand = readBrand();

  useEffect(() => {
    const t = setTimeout(() => setTarde(true), 8000);
    return () => {
      clearTimeout(t);
      escondidoEm = Date.now();
    };
  }, []);

  if (tarde && demora) return <>{demora}</>;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center">
      <span className="respira" aria-hidden>
        <ClubMark logoUrl={brand.logoUrl} mark={brand.mark} size={72} radius={22} />
      </span>
    </div>
  );
}

/**
 * A saída do splash: um véu com o símbolo que se desvanece por cima da app já
 * desenhada, em vez de a app aparecer de repente no lugar dele.
 *
 * Monta-se **dentro** da app (por cima dela), e só se o splash saiu do ecrã
 * mesmo agora: quem abriu com os dados guardados não viu splash nenhum, e quem
 * passou pela apresentação entretanto já não vem do splash — nos dois casos
 * não há nada para desvanecer. Some sozinho no fim da animação.
 */
export function SaidaDoSplash() {
  const [visivel, setVisivel] = useState(() => Date.now() - escondidoEm < 400);
  const brand = readBrand();

  if (!visivel) return null;
  return (
    <div
      className="splash-sai pointer-events-none fixed inset-0 z-[90] flex items-center justify-center bg-canvas"
      onAnimationEnd={() => setVisivel(false)}
      aria-hidden
    >
      <ClubMark logoUrl={brand.logoUrl} mark={brand.mark} size={72} radius={22} />
    </div>
  );
}
