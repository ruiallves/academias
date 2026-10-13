import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CalendarCheck, CalendarDays, ChevronLeft, CircleCheck, Hourglass, PackageX, Shirt, Tag, Undo2, Wallet, type LucideIcon } from "lucide-react";
import { apiGet } from "@/lib/http";
import { useStore } from "@/lib/store";
import { useAceitaPagamentos } from "@/lib/cotacao";
import { cx } from "@/ui";
import { FIM, dataCurta, euros, type EstadoDaPeca } from "./Equipamento";

type Peca = {
  id: string;
  item: string;
  descricao: string | null;
  marca: string | null;
  categoria: string | null;
  variant: string;
  quantity: number;
  status: EstadoDaPeca;
  assignedAt: string;
  returnedAt: string | null;
  epoca: string | null;
  fotos: string[];
  pagamento: {
    estado: "porPagar" | "pago";
    valorCents: number | null;
    /** Também está nos Pagamentos da app, e paga-se lá. */
    naApp: boolean;
    metodo: string | null;
    pagoEm: string | null;
    ate: string | null;
  } | null;
};

const METODO: Record<string, string> = {
  MBWAY: "MB Way",
  MULTIBANCO: "Multibanco",
  CARD: "cartão",
  CASH: "numerário",
  TRANSFER: "transferência",
  GOOGLE_PAY: "Google Pay",
  APPLE_PAY: "Apple Pay",
  DIRECT_DEBIT: "débito directo",
  PAYSAFECARD: "Paysafecard",
};

/**
 * Uma peça de equipamento, por dentro.
 *
 * O que a linha na ficha do atleta não tem espaço para dizer: as fotos do
 * artigo (para se reconhecer a peça certa entre duas camisolas parecidas), a
 * descrição, a época em que foi entregue, se ainda está com o atleta, e o
 * pagamento por inteiro (quanto, se já foi pago, quando e como).
 *
 * Quem ainda tem de pagar e o clube pôs a cobrança na app vê o botão para os
 * Pagamentos. A área de atleta não tem Pagamentos, e por isso não o vê.
 */
export default function EquipamentoPeca() {
  const { athleteId, id } = useParams<{ athleteId: string; id: string }>();
  const navigate = useNavigate();
  const store = useStore();
  const [peca, setPeca] = useState<Peca | null | "erro">(null);
  /*
   * Com os pagamentos do clube desligados não há botão de pagar: a cobrança
   * está nos Pagamentos, mas lá só se lê. Enquanto não se sabe, também não,
   * para o botão não aparecer e sumir logo a seguir. Ver `Payments`.
   */
  const pagaPelaApp = useAceitaPagamentos(store.academy.name).aceita === true;

  useEffect(() => {
    let vivo = true;
    apiGet<Peca>(`/api/inventory/familia/${athleteId}/${id}`)
      .then((r) => vivo && setPeca(r))
      .catch(() => vivo && setPeca("erro"));
    return () => {
      vivo = false;
    };
  }, [athleteId, id]);

  const voltar = (
    <button
      type="button"
      onClick={() => navigate(-1)}
      className="-ml-2 mb-2 inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[14px] font-medium text-ink-2"
    >
      <ChevronLeft className="size-4" strokeWidth={2.2} />
      Voltar
    </button>
  );

  if (peca === "erro") {
    return (
      <div className="pt-2">
        {voltar}
        <div className="mt-6 rounded-[var(--radius-xl)] bg-surface p-10 text-center shadow-[var(--shadow-soft)]">
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-sunken text-ink-3">
            <Shirt className="size-6" strokeWidth={1.75} />
          </span>
          <p className="text-[15px] font-semibold text-ink">Não foi possível abrir esta peça</p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-3">Pode já não estar no equipamento. Tenta outra vez daqui a pouco.</p>
        </div>
      </div>
    );
  }

  if (!peca) return <div className="pt-2">{voltar}</div>;

  const filho = store.children.find((c) => c.id === athleteId);
  const comEle = peca.status === "ACTIVE";
  const pg = peca.pagamento;

  return (
    <div className="pt-2">
      {voltar}

      <Fotos fotos={peca.fotos} />

      <header className="mt-4 px-1">
        <p className="text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
          Equipamento{!store.atleta && filho && store.children.length > 1 ? ` · ${filho.firstName ?? filho.name}` : ""}
        </p>
        <h1 className="mt-0.5 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">{peca.item}</h1>
        <p className="mt-1 text-[14px] text-ink-2">
          Tamanho {peca.variant}
          {peca.quantity > 1 ? ` · ${peca.quantity} unidades` : ""}
        </p>
      </header>

      {/* Onde está a peça: em casa, ou já voltou (e como). */}
      <Estado
        icone={comEle ? CalendarCheck : peca.status === "RETURNED" ? Undo2 : PackageX}
        tom={comEle ? "signal" : peca.status === "RETURNED" ? "ok" : "risk"}
        titulo={
          comEle
            ? store.atleta
              ? "Está contigo"
              : `Está com ${filho?.firstName ?? "o atleta"}`
            : FIM[peca.status as Exclude<EstadoDaPeca, "ACTIVE">]
        }
        texto={
          comEle
            ? `Entregue a ${dataCurta(peca.assignedAt)}.`
            : peca.returnedAt
              ? `A ${dataCurta(peca.returnedAt)}.`
              : ""
        }
      />

      {pg && (
        <section className="mt-3 overflow-hidden rounded-[var(--radius-xl)] bg-surface shadow-[var(--shadow-soft)]">
          <div className="flex items-start gap-3 p-4">
            <span
              className={cx(
                "flex size-11 shrink-0 items-center justify-center rounded-[14px]",
                pg.estado === "pago" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn",
              )}
            >
              {pg.estado === "pago" ? <CircleCheck className="size-[21px]" strokeWidth={1.9} /> : <Hourglass className="size-[21px]" strokeWidth={1.9} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[17px] leading-tight font-semibold tracking-[-0.01em] text-ink">
                  {pg.estado === "pago" ? "Pago" : "Por pagar"}
                </span>
                {pg.valorCents ? <span className="text-[17px] font-semibold text-ink tabular-nums">{euros(pg.valorCents)}</span> : null}
              </span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-2">
                {pg.estado === "pago"
                  ? [pg.pagoEm ? `A ${dataCurta(pg.pagoEm)}` : null, pg.metodo ? `por ${METODO[pg.metodo] ?? pg.metodo}` : null]
                      .filter(Boolean)
                      .join(", ") || "O clube marcou como pago."
                  : pg.naApp && pagaPelaApp
                    ? store.atleta
                      ? "O pedido está na app do teu encarregado."
                      : `Está nos Pagamentos${pg.ate ? `, até ${dataCurta(pg.ate)}` : ""}. Quando pagares, fica pago aqui também.`
                    : "Paga-se diretamente ao clube. Quando o clube registar, fica pago aqui."}
              </span>
            </span>
          </div>
          {pg.estado === "porPagar" && pg.naApp && pagaPelaApp && !store.atleta && (
            <div className="border-t border-ink/5 p-4">
              <Link to="/pagamentos" className="cta w-full justify-center">
                <Wallet className="size-[18px]" strokeWidth={2.2} />
                Pagar
              </Link>
            </div>
          )}
        </section>
      )}

      <section className="mt-3 overflow-hidden rounded-[var(--radius-xl)] bg-surface shadow-[var(--shadow-soft)]">
        <Facto icone={CalendarDays} rotulo="Entregue" valor={dataCurta(peca.assignedAt)} />
        {peca.returnedAt && <Facto icone={Undo2} rotulo={peca.status === "LOST" ? "Dado como perdido" : "Devolvido"} valor={dataCurta(peca.returnedAt)} />}
        {peca.epoca && <Facto icone={CalendarCheck} rotulo="Época" valor={peca.epoca} />}
        {(peca.categoria || peca.marca) && (
          <Facto icone={Tag} rotulo={peca.categoria && peca.marca ? "Categoria e marca" : peca.categoria ? "Categoria" : "Marca"} valor={[peca.categoria, peca.marca].filter(Boolean).join(" · ")} />
        )}
        {peca.descricao && <Facto icone={Shirt} rotulo="Descrição" valor={peca.descricao} />}
      </section>
    </div>
  );
}

/** As fotos do artigo, a deslizar. Sem fotos, um quadrado com a camisola. */
function Fotos({ fotos }: { fotos: string[] }) {
  const [boas, setBoas] = useState(fotos);
  const [actual, setActual] = useState(0);

  if (boas.length === 0) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-[var(--radius-xl)] bg-surface text-ink-4 shadow-[var(--shadow-soft)]">
        <Shirt className="size-14" strokeWidth={1.4} />
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex aspect-[4/3] snap-x snap-mandatory overflow-x-auto rounded-[var(--radius-xl)] bg-surface shadow-[var(--shadow-soft)] [scrollbar-width:none]"
        onScroll={(e) => {
          const el = e.currentTarget;
          setActual(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {boas.map((url) => (
          <img
            key={url}
            src={url}
            alt=""
            onError={() => setBoas((b) => b.filter((u) => u !== url))}
            className="h-full w-full shrink-0 snap-center object-contain"
          />
        ))}
      </div>
      {boas.length > 1 && (
        <div className="mt-2 flex justify-center gap-1.5" aria-hidden>
          {boas.map((url, i) => (
            <span key={url} className={cx("size-1.5 rounded-full", i === actual ? "bg-ink-2" : "bg-ink/15")} />
          ))}
        </div>
      )}
    </div>
  );
}

function Estado({ icone: Icone, tom, titulo, texto }: { icone: LucideIcon; tom: "signal" | "ok" | "risk"; titulo: string; texto: string }) {
  const cor = { signal: "bg-signal-soft text-signal-ink", ok: "bg-ok-soft text-ok", risk: "bg-risk-soft text-risk" }[tom];
  return (
    <section className="mt-4 flex items-start gap-3 rounded-[var(--radius-xl)] bg-surface p-4 shadow-[var(--shadow-soft)]">
      <span className={cx("flex size-11 shrink-0 items-center justify-center rounded-[14px]", cor)}>
        <Icone className="size-[21px]" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] leading-tight font-semibold tracking-[-0.01em] text-ink">{titulo}</span>
        {texto && <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-2">{texto}</span>}
      </span>
    </section>
  );
}

function Facto({ icone: Icone, rotulo, valor }: { icone: LucideIcon; rotulo: string; valor: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-ink/5 px-4 py-3 last:border-0">
      <Icone className="mt-0.5 size-[18px] shrink-0 text-ink-4" strokeWidth={1.9} />
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-ink-3">{rotulo}</span>
        <span className="block text-[15px] font-medium whitespace-pre-line text-ink">{valor}</span>
      </span>
    </div>
  );
}
