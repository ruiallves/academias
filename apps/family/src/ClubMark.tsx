import { cx } from "@/ui";

/**
 * O símbolo do clube, na app da família.
 *
 * Gémeo do `ClubMark` da consola, e existe pela mesma razão: o emblema estava
 * desenhado à mão em três sítios — o cabeçalho, a apresentação e o ecrã de
 * entrada — e cada um só sabia desenhar as iniciais. Quando o clube carregasse um
 * emblema nas Definições, nenhum deles o mostrava.
 *
 * Sem emblema, as iniciais sobre a cor do clube. Nunca um quadrado vazio: parece
 * uma imagem que não carregou.
 */
export function ClubMark({
  logoUrl,
  mark,
  size = 36,
  radius = 11,
  className,
}: {
  logoUrl?: string | null;
  mark: string;
  size?: number;
  radius?: number;
  className?: string;
}) {
  /*
   * Com emblema não há caixa nenhuma — a forma é a do emblema.
   * Um PNG transparente dentro de um quadrado com fundo ganha uma moldura que
   * ninguém desenhou. O quadrado é só o recurso para quando não há emblema.
   */
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
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
        fontSize: Math.round(size * 0.38),
        // As iniciais têm de se ler: a cor com texto por cima é a `strong`, e a
        // tinta é a que `signalVars` escolheu para ela. Ver tokens.ts.
        background: "var(--color-signal-strong)",
      }}
      aria-hidden
    >
      {mark || "··"}
    </span>
  );
}
