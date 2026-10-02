import { useEffect, useRef, useState } from "react";
import { Check, SlidersHorizontal, X } from "@/lib/icons";
import { levelTitle, pts, type Summary } from "@/lib/certification";

/**
 * O topo da página: os pontos, o nível e o que é preciso para subir.
 *
 * ## À direita, três linhas e não um gráfico
 *
 * A FPF decide o nível por três verificações — equipas, requisitos
 * obrigatórios e pontos — e o resultado é a mais fraca das três. Isso já
 * esteve aqui desenhado como três colunas de blocos, e ninguém percebeu o que
 * eram: obrigavam a aprender a ler um gráfico para saber uma coisa que se diz
 * numa frase. Agora são três linhas com um visto ou uma cruz, a responder à
 * única pergunta que interessa: **o que é preciso para a estrela seguinte, e o
 * que já está**.
 *
 * ## O arco
 *
 * Os pontos, de 0 a 100, com as três marcas que abrem estrelas (50, 80 e 90).
 * O troço tracejado no fim são os pontos que só o avaliador atribui.
 */
export function Cockpit({ data, onProfile }: { data: Summary; onProfile: () => void }) {
  const { level, points } = data;

  return (
    <section className="panel cert-hero" aria-label="Nível de certificação">
      <div className="grid items-center gap-x-10 gap-y-7 p-7 max-md:p-5 lg:grid-cols-[auto_minmax(0,1fr)] xl:grid-cols-[auto_minmax(0,1fr)_minmax(0,340px)]">
        <Gauge got={points.got} max={points.max} assessor={points.assessor} />

        <div className="flex min-w-0 flex-col gap-3.5 max-lg:items-center max-lg:text-center">
          <span className="cert-label">Nível com os dados de hoje</span>
          <Stars n={level.stars} />
          <div>
            <h2 className="text-[26px] leading-[1.15] font-semibold tracking-[-0.02em] text-ink">{levelTitle(level)}</h2>
            <p className="mt-2 max-w-[46ch] text-[14px] leading-relaxed text-ink-2">{headline(data)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 max-lg:justify-center">
            {data.canWrite && (
              <button type="button" className="ctl-outline" onClick={onProfile}>
                <SlidersHorizontal className="size-3.5" strokeWidth={1.75} />
                Perfil da candidatura
              </button>
            )}
            <span className="text-meta text-ink-3">É uma estimativa. Quem certifica é a FPF.</span>
          </div>
        </div>

        <Needs data={data} />
      </div>
    </section>
  );
}

/** A frase do topo: o que falta para o nível seguinte. */
function headline({ next, level }: Summary): string {
  if (!next) return "É o nível mais alto. O que conta agora é manter os documentos e os registos em dia.";

  const partes: string[] = [];
  if (!next.accessOk) partes.push("a estrutura de equipas pedida");
  if (next.mandatory.length) partes.push(`${next.mandatory.length} ${next.mandatory.length === 1 ? "requisito obrigatório" : "requisitos obrigatórios"}`);
  if (next.points > 0) partes.push(`${pts(next.points)} pontos`);

  const alvo = next.target.stars > 0 ? `ser ${next.target.name} de ${next.target.short}` : "o reconhecimento como CBFF";
  // Uma só coisa em falta, e no singular: "Falta 1 requisito", "Falta a estrutura".
  const singular = partes.length === 1 && (!next.accessOk || next.mandatory.length === 1);
  if (!partes.length) return level.stars > 0 ? `Está a um passo de ${alvo}.` : `Tudo pronto para ${alvo}.`;
  const lista = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
  return `${singular ? "Falta" : "Faltam"} ${lista} para ${alvo}.`;
}

/* -------------------------------------------------------------------------- */
/* O que é preciso para a estrela seguinte                                     */
/* -------------------------------------------------------------------------- */

function Needs({ data }: { data: Summary }) {
  const { next, points } = data;
  const titulo = !next
    ? "Para manter as 5 estrelas"
    : next.target.stars === 1
      ? "Para 1 estrela é preciso"
      : next.target.stars > 1
        ? `Para as ${next.target.stars} estrelas é preciso`
        : "Para o CBFF é preciso";

  const obrigatorios = next?.mandatory.length ?? 0;
  const pede = next?.needPoints ?? 90;

  return (
    <div className="min-w-0 max-xl:col-span-full xl:border-l xl:border-line xl:pl-8">
      <div className="cert-label mb-1">{titulo}</div>
      <Need
        ok={next?.accessOk ?? true}
        label="As equipas pedidas"
        detail={(next?.accessOk ?? true) ? "O clube tem os escalões que este nível pede." : (data.access.missing[0] ?? "Faltam escalões com equipa.")}
      />
      <Need
        ok={obrigatorios === 0}
        label="Os requisitos obrigatórios"
        detail={obrigatorios === 0 ? "Todos cumpridos." : `${obrigatorios === 1 ? "Falta 1" : `Faltam ${obrigatorios}`}. Sem eles o nível não sobe, com os pontos que for.`}
      />
      <Need
        ok={(next?.points ?? 0) === 0}
        label={pede > 0 ? `${pede} pontos` : "Pontos"}
        detail={
          pede === 0
            ? "Este nível não pede pontos."
            : (next?.points ?? 0) === 0
              ? `O clube tem ${pts(points.got)}.`
              : `O clube tem ${pts(points.got)}. Faltam ${pts(next!.points)}.`
        }
      />
    </div>
  );
}

function Need({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 border-t border-line py-3 first:border-t-0">
      <span className="cert-need" data-ok={ok} aria-hidden>
        {ok ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
      </span>
      <div className="min-w-0">
        <div className="text-body font-medium text-ink">
          {label}
          <span className="sr-only">{ok ? ": cumprido" : ": em falta"}</span>
        </div>
        <p className="mt-0.5 text-meta text-ink-3">{detail}</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Peças                                                                       */
/* -------------------------------------------------------------------------- */

const ESTRELA = "M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5l-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9z";

export function Stars({ n, small = false }: { n: number; small?: boolean }) {
  return (
    <span className={small ? "cert-stars-sm" : "cert-stars"} role="img" aria-label={`${n} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} viewBox="0 0 24 24" className={small ? undefined : "cert-star"} data-on={i <= n} aria-hidden>
          <path d={ESTRELA} />
        </svg>
      ))}
    </span>
  );
}

/* O arco: 270°, a abrir em baixo. Tudo em unidades do viewBox. */
const C = 130;
const R = 92;
const ponto = (t: number, raio: number) => {
  const a = ((135 + 270 * t) * Math.PI) / 180;
  return [C + raio * Math.cos(a), C + raio * Math.sin(a)] as const;
};
function arco(de: number, ate: number): string {
  const [x0, y0] = ponto(de, R);
  const [x1, y1] = ponto(ate, R);
  return `M ${x0} ${y0} A ${R} ${R} 0 ${(ate - de) * 270 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

/** As marcas que abrem estrelas. */
const MARCAS = [50, 80, 90];

function Gauge({ got, max, assessor }: { got: number; max: number; assessor: number }) {
  const mostrado = useContagem(got);
  // O arco nasce vazio e enche-se depois de montado: é o que dá a transição.
  const [armado, setArmado] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setArmado(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const valor = armado ? Math.max(0, Math.min(100, got)) : 0;

  return (
    <div className="cert-gauge max-lg:mx-auto">
      <svg viewBox="0 0 260 260" role="img" aria-label={`${pts(got)} pontos em 100`}>
        <path className="cert-arc-track" d={arco(0, 1)} />
        {/* Os pontos que só o avaliador atribui: o fim do que está ao alcance. */}
        {assessor > 0 && <path className="cert-arc-assessor" d={arco(Math.max(0, max - assessor) / 100, Math.min(100, max) / 100)} />}
        <path
          className="cert-arc-value"
          d={arco(0, 1)}
          pathLength={100}
          strokeDasharray={`${valor} 100`}
          style={{ opacity: valor > 0 ? 1 : 0 }}
        />
        {MARCAS.map((m) => {
          const [x0, y0] = ponto(m / 100, R + 10);
          const [x1, y1] = ponto(m / 100, R + 17);
          const [tx, ty] = ponto(m / 100, R + 28);
          const on = got >= m;
          return (
            <g key={m}>
              <line className="cert-tick" data-on={on} x1={x0} y1={y0} x2={x1} y2={y1} />
              <text className="cert-tick-label" data-on={on} x={tx} y={ty} textAnchor="middle" dominantBaseline="middle">
                {m}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="cert-gauge-read">
        {/* O "de 100" vai por baixo e não ao lado: com casas decimais (59,25)
            o número já ocupa a largura toda do arco. */}
        <span className="cert-points">{pts(Math.round(mostrado * 4) / 4)}</span>
        <span className="cert-label">de 100 pontos</span>
      </div>
    </div>
  );
}

/**
 * Um número que chega ao valor em vez de aparecer.
 *
 * Parte de onde estava: ao responder a um requisito, os pontos sobem do valor
 * antigo para o novo, e é esse movimento que diz "isto contou". Sem movimento
 * para quem o pediu ao sistema.
 */
function useContagem(alvo: number, duracao = 900): number {
  const [valor, setValor] = useState(0);
  const actual = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      actual.current = alvo;
      setValor(alvo);
      return;
    }
    const partida = actual.current;
    const inicio = performance.now();
    let raf = 0;
    const passo = (agora: number) => {
      const p = Math.min(1, (agora - inicio) / duracao);
      const v = partida + (alvo - partida) * (1 - Math.pow(1 - p, 3));
      actual.current = v;
      setValor(v);
      if (p < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [alvo, duracao]);

  return valor;
}
