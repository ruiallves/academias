import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, ChevronRight, CreditCard } from "lucide-react";
import { Label, cx } from "@/ui";
import { useSocio, type SocioPartner } from "@/lib/socio";

/**
 * As parcerias do clube, na área de sócio.
 *
 * A lista é a de Gestão → Patrocinadores na consola, a mesma que o site do
 * clube mostra. Quem dá uma vantagem aos sócios aparece em cartão, com a
 * vantagem à vista; quem só patrocina aparece em logótipo, mais abaixo.
 * Tocar num parceiro abre o site dele, fora da app.
 *
 * O separador só existe quando o clube tem pelo menos um (`SocioTabBar`).
 */

/** Primeiro quem dá vantagem, pela ordem do clube; depois os outros. */
export function parceirosPorOrdem(lista: SocioPartner[]): SocioPartner[] {
  return [...lista.filter((p) => p.benefit), ...lista.filter((p) => !p.benefit)];
}

/** "https://www.farmacia.pt/loja" → "farmacia.pt". */
function dominio(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
}

/** O parceiro tocável: com site, abre-o fora da app; sem site, não é ligação. */
function Ligacao({ p, className, children }: { p: SocioPartner; className?: string; children: ReactNode }) {
  if (!p.url) return <div className={className}>{children}</div>;
  return (
    <a href={p.url} target="_blank" rel="noopener noreferrer" className={cx(className, "transition-transform duration-150 active:scale-[0.97]")}>
      {children}
    </a>
  );
}

/** O logótipo numa caixa branca (os logótipos são feitos para fundo branco). */
function Logotipo({ p, className, tamanho = "md" }: { p: SocioPartner; className?: string; tamanho?: "md" | "lg" }) {
  return (
    <span className={cx("grid shrink-0 place-items-center overflow-hidden bg-white", className)}>
      {p.logoUrl ? (
        <img
          src={p.logoUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className={cx("object-contain", tamanho === "lg" ? "max-h-[58%] max-w-[72%]" : "max-h-[70%] max-w-[78%]")}
        />
      ) : (
        <span className="text-[17px] font-semibold tracking-[-0.02em] text-signal-ink">{iniciais(p.name)}</span>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* No Início                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Algumas parcerias no Início: uma faixa que desliza para o lado, cartão a
 * cartão, com o logótipo grande e a vantagem por baixo. "Ver todas" leva ao
 * separador.
 */
export function ParceriasNoInicio({ style }: { style?: React.CSSProperties }) {
  const { data } = useSocio();
  const navigate = useNavigate();
  const lista = parceirosPorOrdem(data?.partners ?? []).slice(0, 8);
  if (lista.length === 0) return null;

  return (
    <section className="rise" style={style}>
      <Label
        action={
          <button type="button" onClick={() => navigate("/socio/parcerias")} className="text-[13px] font-semibold text-signal-ink">
            Ver todas
          </button>
        }
      >
        Parcerias
      </Label>
      <div className="faixa -mx-4 scroll-px-4 gap-3 px-4 pt-0.5 pb-2">
        {lista.map((p) => (
          <Ligacao
            key={p.id}
            p={p}
            className="flex w-[152px] shrink-0 flex-col overflow-hidden rounded-[20px] bg-surface shadow-[var(--shadow-soft)]"
          >
            <Logotipo p={p} tamanho="lg" className="aspect-[16/11] w-full" />
            <span className="flex min-h-[78px] flex-col gap-0.5 border-t border-ink/5 px-3 pt-2.5 pb-3">
              <span className="truncate text-[14px] font-semibold text-ink">{p.name}</span>
              {p.benefit ? (
                <span className="line-clamp-2 text-[13px] leading-snug font-medium text-signal-ink">{p.benefit}</span>
              ) : (
                <span className="text-[13px] text-ink-3">Patrocinador</span>
              )}
            </span>
          </Ligacao>
        ))}
        {/* Um espaço no fim, para o último cartão não colar à borda ao deslizar. */}
        <span className="w-1 shrink-0" aria-hidden />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* O separador                                                                  */
/* -------------------------------------------------------------------------- */

export function Parcerias() {
  const { data } = useSocio();
  const navigate = useNavigate();
  if (!data) return null;

  const lista = data.partners ?? [];
  const comVantagem = lista.filter((p) => p.benefit);
  const soPatrocinio = lista.filter((p) => !p.benefit);
  let i = 0;

  return (
    <div className="space-y-5 pt-3">
      <header className="rise px-1" style={{ ["--i" as string]: i++ }}>
        <h1 className="text-[26px] leading-[1.15] font-semibold tracking-[-0.03em] text-ink">Parcerias</h1>
        <p className="mt-1 text-[14px] text-ink-3">
          {comVantagem.length > 0 ? `As vantagens de ser sócio do ${data.academy.shortName}.` : `Quem apoia o ${data.academy.shortName}.`}
        </p>
      </header>

      {/* O cartão é o que se mostra no parceiro: fica a um toque. */}
      {data.academy.cardEnabled && comVantagem.length > 0 && (
        <button
          type="button"
          onClick={() => navigate("/socio")}
          className="rise flex w-full items-center gap-3 rounded-[20px] bg-surface p-4 text-left shadow-[var(--shadow-soft)] active:bg-sunken"
          style={{ ["--i" as string]: i++ }}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-signal-soft text-signal-ink">
            <CreditCard className="size-5" strokeWidth={1.9} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink">Mostra o cartão de sócio</span>
            <span className="block text-[13px] text-ink-3">É com ele que tens a vantagem no parceiro.</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-ink-4" strokeWidth={2} />
        </button>
      )}

      {comVantagem.length > 0 && (
        <section className="rise" style={{ ["--i" as string]: i++ }}>
          <Label>Com vantagem para sócios</Label>
          <div className="space-y-2.5">
            {comVantagem.map((p) => (
              <Ligacao key={p.id} p={p} className="flex items-center gap-3.5 rounded-[20px] bg-surface p-3 shadow-[var(--shadow-soft)]">
                <Logotipo p={p} className="h-[68px] w-[92px] rounded-[14px] ring-1 ring-ink/5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink">{p.name}</span>
                  <span className="mt-0.5 line-clamp-2 block text-[14px] leading-snug font-semibold text-signal-ink">{p.benefit}</span>
                  {p.url && <span className="mt-0.5 block truncate text-[12px] text-ink-4">{dominio(p.url)}</span>}
                </span>
                {p.url && (
                  <span className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-sunken px-3 text-[13px] font-semibold text-ink">
                    Visitar
                    <ArrowUpRight className="size-4" strokeWidth={2} />
                  </span>
                )}
              </Ligacao>
            ))}
          </div>
        </section>
      )}

      {soPatrocinio.length > 0 && (
        <section className="rise" style={{ ["--i" as string]: i++ }}>
          <Label>{comVantagem.length > 0 ? "Também apoiam o clube" : "Patrocinadores"}</Label>
          <div className="grid grid-cols-3 gap-2.5">
            {soPatrocinio.map((p) => (
              <Ligacao key={p.id} p={p} className="flex min-w-0 flex-col items-center gap-1.5">
                <Logotipo p={p} className="aspect-[4/3] w-full rounded-[16px] shadow-[var(--shadow-soft)]" />
                <span className="w-full truncate px-0.5 text-center text-[12px] text-ink-3">{p.name}</span>
              </Ligacao>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
