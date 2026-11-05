import { cx } from "@/components/primitives";
import { Shirt } from "@/lib/icons";
import { MOVEMENT_SIGN, STATUS_LABEL, type MovementType, type StockStatus, type Variant } from "@/lib/inventory";

/** "+5" a verde, "−2" a vermelho, o ajuste sem sinal. */
export function Sinal({ tipo, n }: { tipo: MovementType; n: number }) {
  const s = MOVEMENT_SIGN[tipo];
  return (
    <span
      className={cx(
        "w-10 shrink-0 text-right text-body font-semibold tabular",
        s === "+" ? "text-ok" : s === "−" ? "text-risk" : "text-ink-3",
      )}
    >
      {s}
      {n}
    </span>
  );
}

/**
 * As peças visuais que o Inventário repete: a prateleira de tamanhos, o estado
 * do stock e a miniatura do artigo.
 *
 * A cor só aparece quando há um problema. Um armazém em ordem lê-se a cinzento;
 * o âmbar e o vermelho saltam porque são os únicos.
 */

/** A parte da barra que está cheia: o que há para entregar sobre o que o clube tem. */
const cheio = (v: Pick<Variant, "available" | "total">) => (v.total > 0 ? Math.max(0, Math.min(1, v.available / v.total)) : 0);

const BARRA: Record<StockStatus, string> = { ok: "bg-ink-3", low: "bg-warn", out: "bg-risk" };

/**
 * Os tamanhos de um artigo em fila, cada um com o que está pronto a entregar e
 * uma barra fina por baixo. É a primeira coisa que quem gere o material procura
 * num cartão: "há M?".
 */
export function TamanhosCompactos({ variants, max = 8 }: { variants: Variant[]; max?: number }) {
  if (variants.length === 0) return <p className="text-meta text-ink-4">Sem tamanhos</p>;
  const vistos = variants.slice(0, max);
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Disponíveis por tamanho">
      {vistos.map((v) => (
        <li
          key={v.id}
          title={`${v.label}: ${v.available} disponíveis de ${v.total}`}
          className={cx(
            "relative min-w-[38px] overflow-hidden rounded-[6px] px-1.5 pt-1 pb-1.5 text-center",
            v.status === "out" ? "bg-risk-soft" : v.status === "low" ? "bg-warn-soft" : "bg-sunken",
          )}
        >
          <span className="block text-[10px] leading-none font-medium text-ink-3">{v.label}</span>
          <span
            className={cx(
              "mt-0.5 block text-meta leading-tight font-semibold tabular",
              v.status === "out" ? "text-risk" : v.status === "low" ? "text-warn" : "text-ink",
            )}
          >
            {v.available}
          </span>
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-line/60">
            <span className={cx("block h-full", BARRA[v.status])} style={{ width: `${cheio(v) * 100}%` }} />
          </span>
        </li>
      ))}
      {variants.length > max && (
        <li className="flex items-center px-1 text-meta text-ink-4">+{variants.length - max}</li>
      )}
    </ul>
  );
}

/** A barra de um tamanho na ficha do artigo, maior e com o mínimo marcado. */
export function BarraDoTamanho({ v }: { v: Variant }) {
  const minimo = v.total > 0 && v.minimumStock > 0 ? Math.min(1, v.minimumStock / v.total) : null;
  return (
    <span className="relative block h-1.5 overflow-hidden rounded-full bg-sunken">
      <span className={cx("block h-full rounded-full", BARRA[v.status])} style={{ width: `${cheio(v) * 100}%` }} />
      {minimo !== null && (
        <span
          className="absolute inset-y-0 w-px bg-ink-2/50"
          style={{ left: `${minimo * 100}%` }}
          title={`Mínimo: ${v.minimumStock}`}
        />
      )}
    </span>
  );
}

/** O estado em texto, com um ponto. `quieto` esconde o "Disponível". */
export function EstadoDoStock({ status, quieto }: { status: StockStatus; quieto?: boolean }) {
  if (quieto && status === "ok") return null;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 text-meta font-medium whitespace-nowrap",
        status === "out" ? "text-risk" : status === "low" ? "text-warn" : "text-ink-3",
      )}
    >
      <span
        className={cx(
          "size-1.5 shrink-0 rounded-full",
          status === "out" ? "bg-risk" : status === "low" ? "bg-warn" : "bg-ok",
        )}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** A fotografia do artigo, ou uma camisola desenhada quando não há. */
export function Miniatura({ src, className }: { src?: string | null; className?: string }) {
  return src ? (
    <img src={src} alt="" loading="lazy" className={cx("shrink-0 rounded-[8px] bg-sunken object-cover", className)} />
  ) : (
    <span className={cx("flex shrink-0 items-center justify-center rounded-[8px] bg-sunken text-ink-4", className)}>
      <Shirt className="size-[45%] max-h-5 max-w-5" strokeWidth={1.5} />
    </span>
  );
}
