import { Pitch, THUMB_RATIO, baseView, itemScale, pitchBackground } from "@/components/FieldEditor";
import { asLineupData, type FieldKind, type LineupData, type LineupPitch } from "@/lib/training";

/** O terreno de um lineup: a variante é, ela própria, o campo inteiro dela. */
export const lineupField = (pitch: LineupPitch): FieldKind => pitch;

/**
 * A miniatura de um modelo ou sistema de jogo: o campo e as posições.
 *
 * Vive aqui, e não dentro da página dos modelos, porque a entrada da
 * modalidade também a desenha — é a amostra do módulo. Duas cópias do mesmo
 * quadro divergiriam à primeira correção de um raio.
 *
 * Moldura de proporção fixa e fundo do piso, como nas outras grelhas: um
 * sistema de futsal (1,8) e um de futebol (1,5) lado a lado deixavam a caixa
 * mais baixa com branco por baixo do texto. Ver `THUMB_RATIO`.
 */
export function LineupThumb({
  data,
  className,
  /**
   * A proporção da moldura. `THUMB_RATIO` é a das grelhas de listagem; a capa
   * da modalidade pede outra, e sem isto o cartão do sistema ficava mais alto
   * do que os dois vizinhos — três cartões lado a lado com alturas diferentes.
   */
  ratio = THUMB_RATIO,
}: {
  data: LineupData | unknown;
  className?: string;
  ratio?: number;
}) {
  const lineup = isLineupData(data) ? data : asLineupData(data);
  const field = lineupField(lineup.pitch);
  const v = baseView(field);
  const k = itemScale(field);

  return (
    <svg
      viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`}
      className={className ?? "block w-full"}
      style={{ background: pitchBackground(field), aspectRatio: String(ratio) }}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <Pitch field={field} />
      {lineup.slots.map((s) => (
        <g key={s.id} transform={`translate(${s.x} ${s.y}) scale(${k})`}>
          <circle r={2.2} fill="#1d3a5f" stroke="rgba(255,255,255,0.85)" strokeWidth={0.25} />
          <text y={0.8} textAnchor="middle" fontSize={1.9} fontWeight={700} fill="#fff">
            {s.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function isLineupData(v: unknown): v is LineupData {
  return typeof v === "object" && v !== null && Array.isArray((v as LineupData).slots);
}
