import { useStore } from "@/lib/store";
import { cx } from "./primitives";

/**
 * O símbolo do clube.
 *
 * ## Porque é que isto é um componente e não duas linhas repetidas
 *
 * Porque estava repetido, e uma das cópias tinha "LC" **escrito no código** — o
 * monograma do clube de demonstração, no menu lateral de toda a gente. Um clube
 * chamado Fafe abria a consola e via as iniciais de outro.
 *
 * Num sítio só, o símbolo é o mesmo em toda a parte: a barra lateral, a
 * pré-visualização da app, as definições. E quando o clube carrega o emblema nas
 * Definições, todos mudam ao mesmo tempo — que é o que "reflectido em todo o
 * lado" quer dizer.
 *
 * ## O recurso
 *
 * Sem emblema, as iniciais do nome curto sobre a cor do clube. Nunca um espaço
 * vazio: um quadrado sem nada parece uma imagem que não carregou.
 */
export function ClubMark({ size = 28, radius = 7, className }: { size?: number; radius?: number; className?: string }) {
  const { academy } = useStore();
  const mark = initials(academy.shortName || academy.name);

  /*
   * Com emblema não há caixa nenhuma.
   *
   * Tinha fundo e cantos arredondados mesmo com imagem, e um PNG de emblema —
   * que vem quase sempre com fundo transparente e forma própria — ficava dentro
   * de um quadrado colorido que ninguém desenhou. Um emblema é a forma dele; o
   * quadrado é só o recurso para quando não há emblema.
   */
  if (academy.logoUrl) {
    return (
      <img
        src={academy.logoUrl}
        alt=""
        className={cx("shrink-0 object-contain", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={cx("flex shrink-0 items-center justify-center font-bold text-signal-on", className)}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: Math.round(size * 0.4),
        background: "var(--color-signal-strong)",
      }}
      aria-hidden
    >
      {mark}
    </span>
  );
}

/** Duas letras — a primeira de cada extremo, como o servidor faz no `monogram`. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "··";
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}
