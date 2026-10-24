"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, Package, Smartphone, Truck } from "lucide-react";
import { BotaoLink } from "@/componentes/Botao";
import { Foto } from "@/componentes/Foto";
import { dataCompleta } from "@/lib/formatar";
import { CHAVE_DEMO, euroDeCents, type Encomenda, type EncomendaDeDemonstracao } from "@/lib/loja";

/**
 * O que quem encomendou vê depois de carregar em "Pagar", e o endereço que
 * vai no email: `/encomenda/<token>`.
 *
 * - **a pagar**: a contagem até ao fim dos 10 minutos e o que fazer (aceitar
 *   na app MB WAY, ou a entidade e a referência Multibanco). Volta a
 *   perguntar à API de 4 em 4 segundos até o estado mudar.
 * - **paga, pronta, enviada, entregue**: o número da encomenda, os artigos,
 *   e onde está (a preparar, pronta para levantar, a caminho, entregue).
 * - **expirada**, **fora do prazo** e **anulada**: o que aconteceu, o que é
 *   devolvido, e o caminho de volta à loja.
 *
 * Em demonstração não há API: lê a encomenda fingida que o carrinho guardou
 * neste separador (paga ao fim de alguns segundos).
 */

type Props = { slug: string; token: string; api: string; demonstracao: boolean };

type Carga = { fase: "a-ler" } | { fase: "pronto"; encomenda: Encomenda } | { fase: "nao-existe" } | { fase: "falhou" };

const INTERVALO_MS = 4000;

export function PaginaDaEncomenda({ slug, token, api, demonstracao }: Props) {
  const [carga, setCarga] = useState<Carga>({ fase: "a-ler" });

  const obter = useCallback(async (): Promise<Carga> => {
    if (demonstracao) {
      const e = lerDemonstracao(token);
      return e ? { fase: "pronto", encomenda: e } : { fase: "nao-existe" };
    }
    try {
      const r = await fetch(`${api}/api/clubes/${encodeURIComponent(slug)}/loja/encomendas/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (r.status === 404) return { fase: "nao-existe" };
      if (!r.ok) return { fase: "falhou" };
      return { fase: "pronto", encomenda: (await r.json()) as Encomenda };
    } catch {
      return { fase: "falhou" };
    }
  }, [api, slug, token, demonstracao]);

  useEffect(() => {
    let vivo = true;
    let espera: number | undefined;
    let jaViu = false;
    const ler = async () => {
      const r = await obter();
      if (!vivo) return;
      if (r.fase === "pronto") {
        jaViu = true;
        setCarga(r);
      } else if (r.fase === "nao-existe" || !jaViu) {
        setCarga(r);
      }
      if (r.fase === "falhou" || (r.fase === "pronto" && r.encomenda.estado === "a-pagar")) {
        espera = window.setTimeout(ler, INTERVALO_MS);
      }
    };
    void ler();
    return () => {
      vivo = false;
      window.clearTimeout(espera);
    };
  }, [obter]);

  if (carga.fase === "a-ler") {
    return (
      <div className="container-site grid place-items-center py-24 text-ink-3" role="status">
        <Loader2 size={28} className="animate-spin" aria-hidden />
        <span className="sr-only">A abrir a encomenda</span>
      </div>
    );
  }

  if (carga.fase === "nao-existe" || carga.fase === "falhou") {
    return (
      <>
        <Cabecalho titulo={carga.fase === "nao-existe" ? "Não encontrámos esta encomenda" : "Não foi possível abrir a encomenda"} />
        <div className="container-site mt-10 max-w-3xl">
          <p className="text-ink-2">{carga.fase === "nao-existe" ? "Confirma o endereço no email que recebeste depois de encomendar." : "Verifica a internet. A página tenta outra vez sozinha."}</p>
          <VoltarALoja />
        </div>
      </>
    );
  }

  const e = carga.encomenda;
  const titulos: Record<Encomenda["estado"], string> = {
    "a-pagar": "Falta pagar",
    paga: `Encomenda n.º ${e.numero} confirmada`,
    pronta: `A encomenda n.º ${e.numero} está pronta`,
    enviada: `A encomenda n.º ${e.numero} seguiu`,
    entregue: `Encomenda n.º ${e.numero} entregue`,
    expirada: "O prazo para pagar acabou",
    "fora-do-prazo": "O pagamento chegou tarde demais",
    anulada: `A encomenda n.º ${e.numero} foi anulada`,
  };
  const confirmada = e.estado === "paga" || e.estado === "pronta" || e.estado === "enviada" || e.estado === "entregue";

  return (
    <>
      <Cabecalho titulo={titulos[e.estado]} linha={e.estado === "a-pagar" ? `Encomenda n.º ${e.numero} · ${euroDeCents(e.totalCents)}` : undefined} />
      <div className="container-site mt-10 max-w-3xl">
        {e.estado === "a-pagar" && <APagar encomenda={e} />}
        {confirmada && <Confirmada encomenda={e} />}
        {e.estado === "expirada" && (
          <Explicacao>
            <p>Os 10 minutos para pagar acabaram e os artigos voltaram à venda.</p>
            {e.pagamento?.metodo !== "MBWAY" && <p>Não pagues a referência desta encomenda.</p>}
            <p>Se ainda quiseres os artigos, faz uma encomenda nova.</p>
          </Explicacao>
        )}
        {e.estado === "fora-do-prazo" && (
          <Explicacao>
            <p>O pagamento chegou depois dos 10 minutos, e entretanto os artigos esgotaram. Por isso esta encomenda não segue.</p>
            <Reembolso reembolso={e.reembolso} />
          </Explicacao>
        )}
        {e.estado === "anulada" && (
          <Explicacao>
            <p>O clube anulou esta encomenda.</p>
            <Reembolso reembolso={e.reembolso} />
          </Explicacao>
        )}
        {demonstracao && <p className="mt-8 text-xs text-ink-3">Isto é uma demonstração: não se pagou nada e a encomenda é de exemplo.</p>}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* As partes                                                                    */
/* -------------------------------------------------------------------------- */

function Cabecalho({ titulo, linha }: { titulo: string; linha?: React.ReactNode }) {
  return (
    <div className="border-b border-line bg-surface">
      <div className="container-site py-10 sm:py-14">
        <p className="eyebrow text-signal-ink">Loja</p>
        <h1 className="display mt-2 text-4xl sm:text-5xl">{titulo}</h1>
        {linha && <p className="mt-4 max-w-2xl text-lg text-ink-2">{linha}</p>}
      </div>
    </div>
  );
}

function VoltarALoja() {
  return (
    <BotaoLink href="/loja" variante="contorno" className="mt-8">
      Voltar à loja
    </BotaoLink>
  );
}

function Explicacao({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="space-y-3 text-lg text-ink-2">{children}</div>
      <VoltarALoja />
    </div>
  );
}

function Reembolso({ reembolso }: { reembolso: Encomenda["reembolso"] }) {
  if (!reembolso) return null;
  const valor = euroDeCents(reembolso.valorCents);
  return reembolso.feito ? (
    <p className="font-semibold text-ink">O clube já te devolveu {valor}.</p>
  ) : (
    <p>
      <span className="font-semibold text-ink">O clube vai devolver-te {valor}.</span> Se tiveres dúvidas,{" "}
      <Link href="/contactos?assunto=Loja%20e%20encomendas" className="font-semibold text-signal-ink hover:underline">
        fala com o clube
      </Link>
      .
    </p>
  );
}

/** Os artigos e os totais. */
function Artigos({ encomenda: e }: { encomenda: Encomenda }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <ul className="divide-y divide-line">
        {e.linhas.map((l, i) => (
          <li key={i} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
            <div className="relative aspect-[9/11] w-14 shrink-0 overflow-hidden rounded-control bg-sunken">
              <Foto src={l.imageUrl ?? undefined} alt="" sizes="56px" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">{l.nome}</p>
              <p className="text-sm text-ink-3">
                {l.quantidade} × {euroDeCents(l.unitPriceCents)}
                {l.tamanho ? ` · ${l.tamanho}` : ""}
              </p>
            </div>
            <p className="shrink-0 tabular text-ink">{euroDeCents(l.quantidade * l.unitPriceCents)}</p>
          </li>
        ))}
      </ul>
      <dl className="mt-4 space-y-1 border-t border-line pt-4">
        {e.envioCents > 0 && (
          <div className="flex items-baseline justify-between gap-4 text-ink-2">
            <dt>Envio</dt>
            <dd className="tabular">{euroDeCents(e.envioCents)}</dd>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-semibold text-ink">Total</dt>
          <dd className="display text-2xl tabular text-ink">{euroDeCents(e.totalCents)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** A contagem e o que fazer para pagar. */
function APagar({ encomenda: e }: { encomenda: Encomenda }) {
  const falta = useFalta(e.reservadoAte);
  const pag = e.pagamento;
  const valor = euroDeCents(pag?.valorCents ?? e.totalCents);
  const min = Math.floor(falta / 60);
  const seg = falta % 60;

  return (
    <div className="space-y-6">
      <div className="rounded-card bg-night p-5 text-night-ink sm:p-7">
        <p className="text-sm font-semibold text-night-ink-2">Os artigos estão guardados durante 10 minutos.</p>
        <p className="display mt-2 text-6xl tabular sm:text-7xl" role="timer" aria-live="off">
          {String(min).padStart(2, "0")}:{String(seg).padStart(2, "0")}
        </p>
        {falta === 0 && <p className="mt-2 text-sm text-night-ink-2">O tempo acabou. A confirmar se o pagamento chegou.</p>}
      </div>

      {pag?.metodo === "MBWAY" ? (
        <div className="flex gap-4 rounded-card border border-line bg-surface p-5">
          <Smartphone size={28} className="mt-0.5 shrink-0 text-signal-ink" aria-hidden />
          <div>
            <p className="text-xl font-semibold text-ink">Aceita o pedido na app MB WAY nos próximos 5 minutos.</p>
            <p className="mt-1 text-ink-2">Foi enviado um pedido de {valor} para o teu telemóvel. Depois disso o pedido caduca e tens de encomendar outra vez.</p>
          </div>
        </div>
      ) : pag ? (
        <div className="rounded-card border border-line bg-surface p-5">
          <p className="text-xl font-semibold text-ink">Paga por Multibanco</p>
          <p className="mt-1 text-ink-2">Em Pagamentos de serviços, no homebanking ou numa caixa.</p>
          <dl className="mt-5 divide-y divide-line border-y border-line">
            <Dado rotulo="Entidade" valor={pag.entidade ?? ""} copiar={pag.entidade ?? ""} />
            <Dado rotulo="Referência" valor={agrupar(pag.referencia ?? "")} copiar={pag.referencia ?? ""} />
            <Dado rotulo="Valor" valor={valor} copiar={(pag.valorCents / 100).toFixed(2).replace(".", ",")} />
          </dl>
          <p className="mt-4 text-sm font-semibold text-ink">Paga dentro dos 10 minutos. Se pagares depois, a encomenda segue se ainda houver stock; se não houver, o valor é devolvido.</p>
        </div>
      ) : null}

      <Artigos encomenda={e} />

      <p className="flex items-center gap-2 text-sm text-ink-3" role="status">
        <Loader2 size={16} className="animate-spin" aria-hidden />
        À espera do pagamento. Esta página muda sozinha quando ele chegar.
      </p>
    </div>
  );
}

/** Uma linha da referência Multibanco: o rótulo, o número em grande e o botão de copiar. */
function Dado({ rotulo, valor, copiar }: { rotulo: string; valor: string; copiar: string }) {
  const [copiado, setCopiado] = useState(false);
  const copiarAgora = async () => {
    try {
      await navigator.clipboard.writeText(copiar);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem acesso à área de transferência: o número está à vista.
    }
  };
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <dt className="text-sm text-ink-3">{rotulo}</dt>
        <dd className="display text-3xl tabular text-ink sm:text-4xl">{valor}</dd>
      </div>
      <button type="button" onClick={() => void copiarAgora()} aria-label={`Copiar ${rotulo.toLowerCase()}`} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-control border border-line-strong px-3 text-sm font-semibold text-ink transition hover:border-ink">
        {copiado ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
        <span aria-live="polite">{copiado ? "Copiado" : "Copiar"}</span>
      </button>
    </div>
  );
}

/** Uma encomenda paga: onde está, como se entrega, e o que leva. */
function Confirmada({ encomenda: e }: { encomenda: Encomenda }) {
  const passos: { chave: string; rotulo: string; data: string | null; feito: boolean }[] =
    e.entrega.tipo === "PICKUP"
      ? [
          { chave: "paga", rotulo: "Paga", data: e.datas.paga, feito: true },
          { chave: "pronta", rotulo: "Pronta para levantar", data: e.datas.pronta, feito: e.estado === "pronta" || e.estado === "entregue" },
          { chave: "entregue", rotulo: "Levantada", data: e.datas.entregue, feito: e.estado === "entregue" },
        ]
      : [
          { chave: "paga", rotulo: "Paga", data: e.datas.paga, feito: true },
          { chave: "enviada", rotulo: "Enviada", data: e.datas.enviada, feito: e.estado === "enviada" || e.estado === "entregue" },
          { chave: "entregue", rotulo: "Recebida", data: e.datas.entregue, feito: e.estado === "entregue" },
        ];

  const frase =
    e.estado === "paga"
      ? e.entrega.tipo === "PICKUP"
        ? "Recebemos o pagamento. O clube vai preparar a encomenda e avisa-te por email quando estiver pronta para levantar."
        : "Recebemos o pagamento. O clube vai preparar a encomenda e avisa-te por email quando seguir pelo correio."
      : e.estado === "pronta"
        ? "Já podes levantá-la. Leva este email ou o número da encomenda."
        : e.estado === "enviada"
          ? "Está a caminho da tua morada."
          : "Obrigado pela compra. Força ao clube!";

  return (
    <div className="space-y-6">
      <p className="text-xl font-semibold text-ink">{frase}</p>

      <ol className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Estado da encomenda">
        {passos.map((p) => (
          <li key={p.chave} className={`flex items-center gap-1.5 ${p.feito ? "font-semibold text-ink" : "text-ink-3"}`}>
            <span className={`grid size-5 place-items-center rounded-full ${p.feito ? "bg-signal-strong text-signal-on" : "border border-line-strong"}`} aria-hidden>
              {p.feito && <Check size={12} />}
            </span>
            {p.rotulo}
            {p.data && <span className="font-normal text-ink-3">· {dataCompleta(p.data)}</span>}
          </li>
        ))}
      </ol>

      <div className="flex gap-4 rounded-card border border-line bg-surface p-5">
        {e.entrega.tipo === "PICKUP" ? <Package size={26} className="mt-0.5 shrink-0 text-signal-ink" aria-hidden /> : <Truck size={26} className="mt-0.5 shrink-0 text-signal-ink" aria-hidden />}
        <div className="min-w-0">
          {e.entrega.tipo === "PICKUP" ? (
            <>
              <p className="font-semibold text-ink">Levantamento{e.entrega.local ? ` em ${e.entrega.local}` : " no clube"}</p>
              {e.entrega.nota && <p className="mt-1 text-sm text-ink-2">{e.entrega.nota}</p>}
            </>
          ) : (
            <>
              <p className="font-semibold text-ink">Envio para</p>
              <p className="mt-1 text-sm text-ink-2">{e.entrega.morada.join(", ")}</p>
              {e.entrega.rastreio && (
                <p className="mt-1 text-sm text-ink-2">
                  Código de seguimento: <span className="font-semibold tabular text-ink">{e.entrega.rastreio}</span>
                </p>
              )}
              {e.entrega.nota && <p className="mt-1 text-sm text-ink-3">{e.entrega.nota}</p>}
            </>
          )}
        </div>
      </div>

      <Artigos encomenda={e} />
      <p className="text-sm text-ink-3">
        A confirmação seguiu para {e.email}. Dúvidas?{" "}
        <Link href="/contactos?assunto=Loja%20e%20encomendas" className="font-semibold text-signal-ink hover:underline">
          Fala com o clube
        </Link>
        .
      </p>
      <VoltarALoja />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                   */
/* -------------------------------------------------------------------------- */

/** Os segundos que faltam até `ate`, contados de segundo a segundo. */
function useFalta(ate: string): number {
  const calcular = useCallback(() => Math.max(0, Math.ceil((new Date(ate).getTime() - Date.now()) / 1000)), [ate]);
  const [falta, setFalta] = useState(calcular);
  useEffect(() => {
    setFalta(calcular());
    const id = window.setInterval(() => setFalta(calcular()), 1000);
    return () => window.clearInterval(id);
  }, [calcular]);
  return falta;
}

/** "123456789" → "123 456 789", como no talão do multibanco. */
function agrupar(ref: string): string {
  return ref.replace(/\s/g, "").replace(/(\d{3})(?=\d)/g, "$1 ");
}

/** A encomenda fingida da demonstração, se estiver neste separador. Paga ao fim de alguns segundos. */
function lerDemonstracao(token: string): Encomenda | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE_DEMO(token));
    if (!bruto) return null;
    const { encomenda, pagaEm } = JSON.parse(bruto) as EncomendaDeDemonstracao;
    if (encomenda.estado === "a-pagar" && Date.now() >= pagaEm) {
      return { ...encomenda, estado: "paga", pagamento: null, datas: { ...encomenda.datas, paga: new Date(pagaEm).toISOString() } };
    }
    return encomenda;
  } catch {
    return null;
  }
}
