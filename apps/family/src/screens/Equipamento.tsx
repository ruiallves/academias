import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Shirt } from "lucide-react";
import { apiGet } from "@/lib/http";
import { cx } from "@/ui";

export type EstadoDaPeca = "ACTIVE" | "RETURNED" | "DAMAGED" | "LOST";

/** `pagamento` nulo: sem pagamento. Ausente num servidor antigo. */
type Peca = {
  id: string;
  item: string;
  variant: string;
  quantity: number;
  /** Ausente num servidor antigo, que só mandava o que estava com o atleta. */
  status?: EstadoDaPeca;
  assignedAt: string;
  returnedAt?: string | null;
  foto?: string | null;
  pagamento?: { estado: "porPagar" | "pago"; valorCents: number | null } | null;
};

export const euros = (c: number) => (c / 100).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });

export const dataCurta = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-PT", { day: "numeric", month: "short", year: "numeric" });

/** Como acabou uma peça que já não está com o atleta. */
export const FIM: Record<Exclude<EstadoDaPeca, "ACTIVE">, string> = {
  RETURNED: "Devolvido",
  DAMAGED: "Devolvido estragado",
  LOST: "Perdido",
};

/** Quantas peças antigas se mostram antes de "Ver todas". */
const HISTORICO_VISIVEL = 3;

/**
 * O equipamento do atleta: o que tem com ele e o que já teve.
 *
 * Em cima, o que o clube entregou e ainda não voltou, para a família saber o
 * que está em casa e o que devolver no fim da época. Por baixo, o histórico: o
 * que foi devolvido, estragado ou perdido, com a data. Cada linha abre a peça
 * (`EquipamentoPeca`), com as fotos, a época e o pagamento por inteiro.
 *
 * Cada peça diz se está paga ou por pagar, e quanto. "Por pagar" aqui não é
 * necessariamente uma cobrança nos Pagamentos: o clube pode só deixar a nota
 * (ver `definirPagamento` na API), e é por isso que se diz aqui.
 *
 * Carrega-se sozinho e só aparece quando há alguma coisa, como as notas da
 * escola: um bloco vazio na ficha de todos os atletas de um clube que nem usa o
 * inventário seria ruído. Um erro a ler também o esconde: isto é informação a
 * mais, não pode partir a ficha.
 */
export function Equipamento({ childId }: { childId: string }) {
  const [pecas, setPecas] = useState<Peca[] | null>(null);
  const [tudo, setTudo] = useState(false);

  useEffect(() => {
    let vivo = true;
    apiGet<Peca[]>(`/api/inventory/familia/${childId}`)
      .then((r) => vivo && setPecas(r))
      .catch(() => vivo && setPecas([]));
    return () => {
      vivo = false;
    };
  }, [childId]);

  if (!pecas || pecas.length === 0) return null;

  const comEle = pecas.filter((p) => (p.status ?? "ACTIVE") === "ACTIVE");
  const antigas = pecas.filter((p) => (p.status ?? "ACTIVE") !== "ACTIVE");
  const visiveis = tudo ? antigas : antigas.slice(0, HISTORICO_VISIVEL);

  return (
    <section className="space-y-4">
      {comEle.length > 0 && (
        <div>
          <h2 className="mb-1 px-1 text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">Equipamento</h2>
          <ul className="overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-soft)]">
            {comEle.map((p) => (
              <Linha key={p.id} p={p} childId={childId} />
            ))}
          </ul>
        </div>
      )}

      {antigas.length > 0 && (
        <div>
          <h2 className="mb-1 px-1 text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
            {comEle.length > 0 ? "Equipamento que já teve" : "Equipamento"}
          </h2>
          <ul className="overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-soft)]">
            {visiveis.map((p) => (
              <Linha key={p.id} p={p} childId={childId} />
            ))}
          </ul>
          {antigas.length > HISTORICO_VISIVEL && (
            <button
              type="button"
              onClick={() => setTudo((v) => !v)}
              className="mt-1.5 px-1 text-[13px] font-semibold text-signal-ink"
            >
              {tudo ? "Ver menos" : `Ver todas (${antigas.length})`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Linha({ p, childId }: { p: Peca; childId: string }) {
  const antiga = (p.status ?? "ACTIVE") !== "ACTIVE";
  const linha = antiga
    ? [
        `Tamanho ${p.variant}`,
        `${FIM[p.status as Exclude<EstadoDaPeca, "ACTIVE">]}${p.returnedAt ? ` a ${dataCurta(p.returnedAt)}` : ""}`,
      ]
    : [`Tamanho ${p.variant}`, p.quantity > 1 ? `${p.quantity} unidades` : null, `entregue a ${dataCurta(p.assignedAt)}`];

  return (
    <li className="border-b border-line last:border-0">
      <Link to={`/equipamento/${childId}/${p.id}`} className="flex items-center gap-3 p-4 active:bg-sunken">
        <Miniatura foto={p.foto} apagada={antiga} />
        <span className="min-w-0 flex-1">
          <span className={cx("block truncate text-body font-semibold", antiga ? "text-ink-2" : "text-ink")}>{p.item}</span>
          <span className="block truncate text-meta text-ink-3">{linha.filter(Boolean).join(" · ")}</span>
        </span>
        {p.pagamento && <PagamentoPill p={p.pagamento} />}
        <ChevronRight className="size-5 shrink-0 text-ink-4" strokeWidth={2} />
      </Link>
    </li>
  );
}

function Miniatura({ foto, apagada }: { foto?: string | null; apagada?: boolean }) {
  const [falhou, setFalhou] = useState(false);
  if (foto && !falhou) {
    return (
      <img
        src={foto}
        alt=""
        loading="lazy"
        onError={() => setFalhou(true)}
        className={cx("size-11 shrink-0 rounded-[12px] bg-sunken object-cover", apagada && "opacity-60 grayscale")}
      />
    );
  }
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-sunken text-ink-3">
      <Shirt className="size-[20px]" strokeWidth={1.9} />
    </span>
  );
}

export function PagamentoPill({ p }: { p: { estado: "porPagar" | "pago"; valorCents: number | null } }) {
  return (
    <span
      className={cx(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        p.estado === "pago" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn",
      )}
    >
      {p.estado === "pago" ? "Pago" : "Por pagar"}
      {p.valorCents ? ` · ${euros(p.valorCents)}` : ""}
    </span>
  );
}
