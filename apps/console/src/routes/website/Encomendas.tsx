import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Ban, Check, Clock, Copy, Mail, MapPin, Package, PackageCheck, PackageOpen, Phone, Search, Send, Truck, Undo2 } from "@/lib/icons";
import { Empty, Loading, Monogram, Panel, Pill, SelectField, cx, type Tone } from "@/components/primitives";
import { Dialog, dialogInputClass } from "@/components/Dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Interruptor } from "@/components/definicoes/ui";
import { money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { mostrarOk } from "@/lib/avisos";
import { carregarSite } from "@/lib/website";
import { useStore } from "@/lib/store";
import {
  ESTADO_DA_ENCOMENDA,
  anularEncomenda,
  listarEncomendas,
  marcarEmProducao,
  marcarEntregue,
  marcarEnviada,
  marcarPronta,
  marcarReembolsado,
  mudarEstado,
  passosDaEncomenda,
  reenviarConfirmacao,
  type Encomenda,
  type EstadoDaEncomenda,
  type PassoDaEncomenda,
} from "@/lib/loja";

/**
 * As encomendas da loja do site.
 *
 * ## O desenho
 *
 * É a página que se abre todos os dias, por isso responde primeiro à pergunta
 * do dia: **o que há para preparar**. Em cima, o resumo (por preparar, a
 * caminho, entregues e vendido no mês, reembolsos por fazer), cada número a
 * abrir a vista certa. Depois as vistas, e a lista agrupada por dia, com as
 * fotografias dos artigos, quem comprou, o que levou e, nas que estão por
 * preparar, há quanto tempo esperam. A ação seguinte está na própria linha:
 * marcar pronta ou levantada sem abrir nada.
 *
 * A ficha de uma encomenda põe o estado à cabeça: o percurso (paga, pronta ou
 * enviada, levantada ou recebida) com as datas, e ao lado o botão do passo
 * seguinte. Por baixo, à esquerda, os artigos e a conta; à direita, quem
 * comprou, a entrega (com a morada para copiar) e o histórico, momento a
 * momento. Anular e reembolsar ficam no rodapé: são exceções, não o caminho.
 *
 * O passo "Em preparação" (`IN_PRODUCTION`, 15/11/2026; começou por ser "No
 * produtor" e o Rui pediu o nome geral) é opcional. Entra entre a paga e a
 * pronta ou enviada, tira a encomenda da lista por preparar, e só se vê nas
 * vistas quando há alguma. Os estados lidos: Pendente, Paga, Em preparação,
 * Pronta para levantamento (ou Enviada), Entregue, Cancelada.
 *
 * Cada passo do percurso é clicável (15/11/2026): a encomenda vai para
 * qualquer passo, para a frente ou para trás, com uma confirmação que diz o
 * que acontece (email ou não, datas que se apagam). Cada mudança fica no
 * histórico com quem a fez. Cada encomenda tem uma referência única em toda a
 * plataforma ("ENC-7K2F-9QXA"), além do número seguido do clube.
 *
 * Referências: o percurso com datas e a ação à cabeça (Shopify, FastSpring),
 * as ações rápidas na lista (Hostinger), a ficha em duas colunas com o
 * histórico ao lado (Medusa, Polaris).
 *
 * Lê-se de fresco ao abrir e depois de cada ação: as encomendas chegam a
 * qualquer hora, e uma lista guardada mentia sobre o que está pago.
 */

const TOM: Record<EstadoDaEncomenda, Tone> = { PAID: "signal", IN_PRODUCTION: "warn", READY: "ok", SHIPPED: "ok", DELIVERED: "neutral", RESERVED: "warn", LATE_PAYMENT: "risk", CANCELLED: "neutral" };

const LISBOA = "Europe/Lisbon";
const dataHora = (iso: string) => new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: LISBOA }).format(new Date(iso));
const hora = (iso: string) => new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: LISBOA }).format(new Date(iso));
const diaChave = (iso: string) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: LISBOA }).format(new Date(iso));
const diaLongo = (iso: string) => new Intl.DateTimeFormat("pt-PT", { weekday: "long", day: "numeric", month: "long", timeZone: LISBOA }).format(new Date(iso));

/** "Hoje", "Ontem", ou "sexta-feira, 14 de novembro". */
function nomeDoDia(iso: string): string {
  const k = diaChave(iso);
  const hoje = diaChave(new Date().toISOString());
  const ontem = diaChave(new Date(Date.now() - 86_400_000).toISOString());
  if (k === hoje) return "Hoje";
  if (k === ontem) return "Ontem";
  const s = diaLongo(iso);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Há quantos dias (inteiros) foi. */
const diasDesde = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

/** O momento que conta para ordenar e agrupar: o pagamento; sem ele, a criação. */
const quando = (e: Encomenda) => e.pagaEm ?? e.criadaEm;

const unidades = (e: Encomenda) => e.linhas.reduce((n, l) => n + l.quantidade, 0);

/** "Camisola de treino 12, Cachecol ×2". */
const resumoDosArtigos = (e: Encomenda) => e.linhas.map((l) => `${l.nome}${l.tamanho ? ` ${l.tamanho}` : ""}${l.quantidade > 1 ? ` ×${l.quantidade}` : ""}`).join(", ");

const porReembolsar = (e: Encomenda) => (e.reembolso && !e.reembolso.feitoEm ? e.reembolso : null);

const fold = (v: string) => v.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

/** O nome de cada passo, conforme a entrega. */
function nomeDoPasso(p: PassoDaEncomenda | EstadoDaEncomenda, _envio: boolean): string {
  switch (p) {
    case "PAID":
      return "Paga";
    case "IN_PRODUCTION":
      return "Em preparação";
    case "READY":
      return "Pronta para levantamento";
    case "SHIPPED":
      return "Enviada";
    case "DELIVERED":
      return "Entregue";
    default:
      return ESTADO_DA_ENCOMENDA[p];
  }
}

/** A data de cada passo, na encomenda. */
function dataDoPasso(e: Encomenda, p: PassoDaEncomenda): string | null {
  return p === "PAID" ? e.pagaEm : p === "IN_PRODUCTION" ? (e.producaoEm ?? null) : p === "READY" ? e.prontaEm : p === "SHIPPED" ? e.enviadaEm : e.entregueEm;
}

type Vista = "preparar" | "produtor" | "caminho" | "entregues" | "reembolsos" | "todas";

/* -------------------------------------------------------------------------- */
/* A página                                                                     */
/* -------------------------------------------------------------------------- */

export function Encomendas() {
  const { session } = useSession();
  const store = useStore();
  const podeEscrever = can(session, "website:write");
  const [lista, setLista] = useState<Encomenda[] | null>(null);
  const [falhou, setFalhou] = useState<string | null>(null);
  // Abre em Todas (pedido do Rui a 15/11/2026): o resumo em cima já diz quantas há por preparar.
  const [vista, setVista] = useState<Vista>("todas");
  const [q, setQ] = useState("");
  const [entrega, setEntrega] = useState<"" | "PICKUP" | "SHIPPING">("");
  const [periodo, setPeriodo] = useState<"" | "7" | "30">("");
  const [aberta, setAberta] = useState<string | null>(null);
  /** Abrir a ficha já com o diálogo de "enviada" (a ação rápida do envio precisa do código de seguimento). */
  const [abrirComEnvio, setAbrirComEnvio] = useState(false);
  const [aFazer, setAFazer] = useState<string | null>(null);

  const carregar = useCallback(() => {
    listarEncomendas()
      .then((l) => {
        setLista(l);
        setFalhou(null);
        // A contagem do site (encomendasPorTratar) acompanha o que se tratou.
        void carregarSite(store.academy.slug, true);
      })
      .catch((e: unknown) => setFalhou(e instanceof Error ? e.message : "Não foi possível ler as encomendas."));
  }, [store.academy.slug]);

  useEffect(carregar, [carregar]);

  /** Uma ação direta da lista (pronta, levantada), sem abrir a ficha. */
  const fazer = async (id: string, f: () => Promise<unknown>, ok: string) => {
    setAFazer(id);
    try {
      await f();
      mostrarOk(ok);
      carregar();
    } catch {
      // O erro já está no cartão de erros.
    } finally {
      setAFazer(null);
    }
  };

  const grupos = useMemo(() => {
    const l = lista ?? [];
    const mes = diaChave(new Date().toISOString()).slice(0, 7);
    const doMes = (iso: string | null) => !!iso && diaChave(iso).slice(0, 7) === mes;
    return {
      preparar: l.filter((e) => e.estado === "PAID"),
      produtor: l.filter((e) => e.estado === "IN_PRODUCTION"),
      caminho: l.filter((e) => e.estado === "READY" || e.estado === "SHIPPED"),
      entregues: l.filter((e) => e.estado === "DELIVERED"),
      reembolsos: l.filter((e) => porReembolsar(e)),
      todas: l,
      entreguesNoMes: l.filter((e) => e.estado === "DELIVERED" && doMes(e.entregueEm)).length,
      vendidoNoMes: l.filter((e) => e.estado !== "CANCELLED" && e.estado !== "RESERVED" && doMes(e.pagaEm)).reduce((s, e) => s + e.totalCents, 0),
      aEsperaCents: l.filter((e) => e.estado === "PAID").reduce((s, e) => s + e.totalCents, 0),
    };
  }, [lista]);

  const visiveis = useMemo(() => {
    const termo = fold(q);
    const limite = periodo ? Date.now() - Number(periodo) * 86_400_000 : 0;
    return grupos[vista]
      .filter((e) => {
        if (entrega && e.entrega !== entrega) return false;
        if (limite && new Date(quando(e)).getTime() < limite) return false;
        // A referência conta com e sem traços ("ENC-7K2F-9QXA", "7k2f9qxa").
        const ref = e.referencia ?? "";
        if (termo && !fold(`${e.numero} ${ref} ${ref.replace(/-/g, "")} ${e.comprador.nome} ${e.comprador.email} ${e.comprador.telefone ?? ""} ${resumoDosArtigos(e)} ${e.codigo ?? ""} ${e.rastreio ?? ""}`).includes(termo.replace(/\s+/g, " "))) return false;
        return true;
      })
      .sort((a, b) => quando(b).localeCompare(quando(a)));
  }, [grupos, vista, q, entrega, periodo]);

  /** Agrupadas por dia, do mais recente para trás. */
  const dias = useMemo(() => {
    const m = new Map<string, Encomenda[]>();
    for (const e of visiveis) {
      const k = diaChave(quando(e));
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.values()];
  }, [visiveis]);

  if (falhou && !lista) return <Empty icon={PackageOpen} title="Não foi possível ler as encomendas" detail={falhou} compact />;
  if (!lista) return <Loading size="panel" />;

  const escolhida = aberta ? (lista.find((e) => e.id === aberta) ?? null) : null;
  const algumFiltro = Boolean(q || entrega || periodo);

  if (lista.length === 0) {
    return (
      <Panel>
        <Empty
          icon={PackageOpen}
          title="Ainda não há encomendas"
          detail="As encomendas do site aparecem aqui assim que alguém paga. Chega também um email ao endereço da Identidade do site."
        />
      </Panel>
    );
  }

  const vistas: { k: Vista; rotulo: string; n: number; tom?: "warn" | "risk" }[] = [
    { k: "preparar", rotulo: "Por preparar", n: grupos.preparar.length, tom: grupos.preparar.length > 0 ? "warn" : undefined },
    // Só quando há encomendas em preparação: o passo é opcional.
    ...(grupos.produtor.length > 0 ? [{ k: "produtor" as const, rotulo: "Em preparação", n: grupos.produtor.length }] : []),
    { k: "caminho", rotulo: "A caminho", n: grupos.caminho.length },
    { k: "entregues", rotulo: "Entregues", n: grupos.entregues.length },
    ...(grupos.reembolsos.length > 0 ? [{ k: "reembolsos" as const, rotulo: "Reembolsos", n: grupos.reembolsos.length, tom: "risk" as const }] : []),
    { k: "todas", rotulo: "Todas", n: lista.length },
  ];

  return (
    <div className="space-y-5">
      <Resumo grupos={grupos} onVer={setVista} />

      <div className="overflow-x-auto">
        <div className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-sunken p-1" role="tablist" aria-label="Vistas das encomendas">
          {vistas.map((v) => (
            <button
              key={v.k}
              type="button"
              role="tab"
              aria-selected={vista === v.k}
              onClick={() => setVista(v.k)}
              className={cx(
                "inline-flex h-8 items-center gap-1.5 rounded-[7px] px-3 text-meta font-semibold whitespace-nowrap transition-colors duration-[120ms]",
                vista === v.k ? "bg-surface text-ink shadow-[0_1px_2px_rgb(26_25_23/0.06)]" : "text-ink-3 hover:text-ink-2",
              )}
            >
              {v.rotulo}
              <span className={cx("tabular", v.tom === "risk" ? "text-risk" : v.tom === "warn" ? "text-warn" : "text-ink-4")}>{v.n}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="-mt-2 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Procurar por número, referência, nome, email ou artigo…"
            className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface pl-8 text-body text-ink placeholder:text-ink-4"
          />
        </div>
        <SelectField
          aria-label="Entrega"
          value={entrega}
          onChange={setEntrega}
          options={[
            { value: "", label: "Qualquer entrega" },
            { value: "PICKUP", label: "Levantamento no clube" },
            { value: "SHIPPING", label: "Envio pelo correio" },
          ]}
        />
        <SelectField
          aria-label="Período"
          value={periodo}
          onChange={setPeriodo}
          options={[
            { value: "", label: "Desde sempre" },
            { value: "7", label: "Últimos 7 dias" },
            { value: "30", label: "Últimos 30 dias" },
          ]}
        />
        {algumFiltro && (
          <button
            type="button"
            className="ctl-ghost text-ink-3"
            onClick={() => {
              setQ("");
              setEntrega("");
              setPeriodo("");
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      {visiveis.length === 0 ? (
        <Panel>
          <Empty
            icon={algumFiltro ? Search : vista === "reembolsos" ? Undo2 : vista === "preparar" ? PackageCheck : PackageOpen}
            tone={!algumFiltro && (vista === "reembolsos" || vista === "preparar") ? "ok" : "neutral"}
            title={
              algumFiltro
                ? "Nada com esses filtros"
                : vista === "preparar"
                  ? "Não há encomendas por preparar"
                  : vista === "produtor"
                    ? "Nada em preparação"
                  : vista === "caminho"
                    ? "Nada pronto nem enviado à espera"
                    : vista === "entregues"
                      ? "Ainda não há encomendas entregues"
                      : "Ainda não há encomendas"
            }
            detail={algumFiltro ? "Tenta outra palavra, entrega ou período." : vista === "preparar" ? "Tudo o que foi pago já está pronto, a caminho ou entregue." : undefined}
            compact
          />
        </Panel>
      ) : (
        <Panel>
          {dias.map((doDia) => (
            <section key={diaChave(quando(doDia[0]))} className="border-b border-line last:border-b-0">
              <h3 className="flex items-baseline justify-between gap-3 bg-sunken/50 px-5 py-2 text-meta font-semibold text-ink-2 max-sm:px-3.5">
                {nomeDoDia(quando(doDia[0]))}
                <span className="font-normal text-ink-4 tabular">
                  {doDia.length} {doDia.length === 1 ? "encomenda" : "encomendas"} · {money(doDia.reduce((s, e) => s + e.totalCents, 0))}
                </span>
              </h3>
              <ul className="divide-y divide-line">
                {doDia.map((e) => (
                  <Linha
                    key={e.id}
                    e={e}
                    podeEscrever={podeEscrever}
                    aFazer={aFazer === e.id}
                    onAbrir={() => {
                      setAbrirComEnvio(false);
                      setAberta(e.id);
                    }}
                    onPronta={() => void fazer(e.id, () => marcarPronta(e.id), "Pronta para levantamento. Quem comprou recebe o aviso.")}
                    onEnviada={() => {
                      setAbrirComEnvio(true);
                      setAberta(e.id);
                    }}
                    onEntregue={() => void fazer(e.id, () => marcarEntregue(e.id), "Marcada como entregue.")}
                  />
                ))}
              </ul>
            </section>
          ))}
        </Panel>
      )}

      {escolhida && (
        <DetalheDaEncomenda
          encomenda={escolhida}
          podeEscrever={podeEscrever}
          comEnvio={abrirComEnvio}
          onClose={() => setAberta(null)}
          onMudou={carregar}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Resumo                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * O balcão numa olhadela: quantas esperam por alguém e quanto dinheiro já está
 * pago à espera, o que vai a caminho, o que se entregou e vendeu este mês, e
 * os reembolsos por fazer. Cada número abre a vista onde se trata dele.
 */
function Resumo({
  grupos,
  onVer,
}: {
  grupos: { preparar: Encomenda[]; produtor: Encomenda[]; caminho: Encomenda[]; reembolsos: Encomenda[]; entreguesNoMes: number; vendidoNoMes: number; aEsperaCents: number };
  onVer: (v: Vista) => void;
}) {
  const n = grupos.preparar.length;
  const antigas = grupos.preparar.filter((e) => diasDesde(quando(e)) >= 3).length;
  const reembolsoCents = grupos.reembolsos.reduce((s, e) => s + (e.reembolso?.valorCents ?? 0), 0);

  return (
    <Panel className="p-5 max-sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <button type="button" onClick={() => onVer("preparar")} className="group min-w-0 text-left">
          <p className="text-meta text-ink-3">Por preparar</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className={cx("text-metric tabular group-hover:underline", n > 0 ? "text-ink" : "text-ink-3")}>{n}</span>
            {n > 0 ? (
              <span className="text-body text-ink-3">
                {n === 1 ? "encomenda" : "encomendas"} · {money(grupos.aEsperaCents)} pagos
                {antigas > 0 && (
                  <>
                    {" · "}
                    <span className="font-medium text-warn">
                      {antigas} há 3 dias ou mais
                    </span>
                  </>
                )}
              </span>
            ) : (
              <span className="text-body text-ink-3">Nada à espera de ninguém</span>
            )}
          </p>
        </button>

        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          {grupos.produtor.length > 0 && (
            <Numero rotulo="Em preparação" valor={String(grupos.produtor.length)} nota={grupos.produtor.length === 1 ? "a ficar pronta" : "a ficarem prontas"} onClick={() => onVer("produtor")} />
          )}
          <Numero rotulo="A caminho" valor={String(grupos.caminho.length)} nota={grupos.caminho.length === 1 ? "pronta ou enviada" : "prontas ou enviadas"} onClick={() => onVer("caminho")} />
          <Numero rotulo="Entregues este mês" valor={String(grupos.entreguesNoMes)} onClick={() => onVer("entregues")} />
          <Numero rotulo="Vendido este mês" valor={money(grupos.vendidoNoMes)} onClick={() => onVer("todas")} />
          {grupos.reembolsos.length > 0 && (
            <Numero rotulo="Reembolsos por fazer" valor={money(reembolsoCents)} nota={`${grupos.reembolsos.length} ${grupos.reembolsos.length === 1 ? "encomenda" : "encomendas"}`} tom="risk" onClick={() => onVer("reembolsos")} />
          )}
        </dl>
      </div>
    </Panel>
  );
}

function Numero({ rotulo, valor, nota, tom, onClick }: { rotulo: string; valor: string; nota?: string; tom?: "risk"; onClick: () => void }) {
  return (
    <div>
      <dt className="text-meta text-ink-3">{rotulo}</dt>
      <dd>
        <button type="button" onClick={onClick} className="group mt-0.5 inline-flex items-baseline gap-1.5 rounded-[4px] text-left">
          <span className={cx("text-[20px] leading-tight font-semibold tabular group-hover:underline", tom === "risk" ? "text-risk" : "text-ink")}>{valor}</span>
          {nota && <span className="text-meta text-ink-3">{nota}</span>}
        </button>
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Uma linha da lista                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Uma encomenda numa linha: as fotografias dos artigos, o número e quem
 * comprou, o que levou, o estado, a hora e o total. Nas que estão por
 * preparar, há quanto tempo esperam. A ação do passo seguinte vive na linha
 * (aparece ao passar o rato no computador, está sempre à vista no telemóvel).
 */
function Linha({
  e,
  podeEscrever,
  aFazer,
  onAbrir,
  onPronta,
  onEnviada,
  onEntregue,
}: {
  e: Encomenda;
  podeEscrever: boolean;
  aFazer: boolean;
  onAbrir: () => void;
  onPronta: () => void;
  onEnviada: () => void;
  onEntregue: () => void;
}) {
  const devolver = porReembolsar(e);
  const espera = e.estado === "PAID" ? diasDesde(quando(e)) : 0;
  const Entrega = e.entrega === "SHIPPING" ? Truck : Package;

  const porPreparar = e.estado === "PAID" || e.estado === "IN_PRODUCTION";
  const acao =
    !podeEscrever ? null
    : porPreparar && e.entrega === "PICKUP" ? { rotulo: "Pronta", icone: PackageCheck, fazer: onPronta }
    : porPreparar ? { rotulo: "Enviada", icone: Truck, fazer: onEnviada }
    : e.estado === "READY" ? { rotulo: "Entregue", icone: Check, fazer: onEntregue }
    : e.estado === "SHIPPED" ? { rotulo: "Entregue", icone: Check, fazer: onEntregue }
    : null;

  /*
   * A linha é um botão (abre a ficha) e a coluna da direita fica fora dele:
   * o botão da ação rápida vive aí, por baixo do total, e um botão dentro de
   * outro não é HTML válido. A cor de fundo ao passar o rato é do `<li>`,
   * para a linha inteira reagir.
   */
  return (
    <li className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-sunken/40 max-sm:px-3.5">
      <button type="button" onClick={onAbrir} className="flex min-w-0 flex-1 items-center gap-3.5 text-left">
        <Fotos linhas={e.linhas} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-body font-semibold text-ink">{e.comprador.nome}</span>
            <span className="text-meta text-ink-4 tabular">
              n.º {e.numero}
              {e.referencia && <> · {e.referencia}</>}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-meta text-ink-3">{resumoDosArtigos(e)}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Pill tone={TOM[e.estado]}>{ESTADO_DA_ENCOMENDA[e.estado]}</Pill>
            {devolver && <Pill tone="risk">Reembolsar {money(devolver.valorCents)}</Pill>}
            <span className="inline-flex items-center gap-1 text-meta text-ink-3">
              <Entrega className="size-3.5" strokeWidth={1.75} />
              {e.entrega === "SHIPPING" ? "Envio" : "Levantamento"}
            </span>
            {espera >= 1 && (
              <span className={cx("inline-flex items-center gap-1 text-meta", espera >= 3 ? "font-medium text-warn" : "text-ink-3")}>
                <Clock className="size-3.5" strokeWidth={1.75} />
                {espera === 1 ? "espera há 1 dia" : `espera há ${espera} dias`}
              </span>
            )}
            {e.estado === "IN_PRODUCTION" && e.producaoEm && (
              <span className="inline-flex items-center gap-1 text-meta text-ink-3">
                <Package className="size-3.5" strokeWidth={1.75} />
                {diasDesde(e.producaoEm) === 0 ? "em preparação desde hoje" : diasDesde(e.producaoEm) === 1 ? "em preparação desde ontem" : `em preparação há ${diasDesde(e.producaoEm)} dias`}
              </span>
            )}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1 self-start">
        <span className="text-body font-semibold text-ink tabular">{money(e.totalCents)}</span>
        <span className="text-meta text-ink-4 tabular">
          {hora(quando(e))} · {unidades(e) === 1 ? "1 artigo" : `${unidades(e)} artigos`}
        </span>
        {acao && (
          <button
            type="button"
            disabled={aFazer}
            onClick={acao.fazer}
            className="ctl-outline mt-0.5 h-8 bg-surface md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:focus-visible:opacity-100"
          >
            <acao.icone className="size-3.5" strokeWidth={1.75} />
            {acao.rotulo}
          </button>
        )}
      </div>
    </li>
  );
}

/** As fotografias dos artigos, sobrepostas (até três, e "+N"). Sem fotografia, o ícone. */
function Fotos({ linhas }: { linhas: Encomenda["linhas"] }) {
  const comFoto = linhas.filter((l) => l.imageUrl).slice(0, 3);
  if (comFoto.length === 0) {
    return (
      <span className="flex size-11 shrink-0 items-center justify-center rounded-[8px] bg-sunken text-ink-4">
        <Package className="size-5" strokeWidth={1.5} />
      </span>
    );
  }
  const mais = linhas.length - comFoto.length;
  return (
    <span className="flex shrink-0 -space-x-3">
      {comFoto.map((l, i) => (
        <img key={i} src={l.imageUrl ?? ""} alt="" loading="lazy" className="size-11 rounded-[8px] border-2 border-surface bg-sunken object-cover" style={{ zIndex: 3 - i }} />
      ))}
      {mais > 0 && <span className="flex size-11 items-center justify-center rounded-[8px] border-2 border-surface bg-sunken text-[11px] font-semibold text-ink-2 tabular">+{mais}</span>}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* A ficha de uma encomenda                                                    */
/* -------------------------------------------------------------------------- */

function DetalheDaEncomenda({
  encomenda: e,
  podeEscrever,
  comEnvio,
  onClose,
  onMudou,
}: {
  encomenda: Encomenda;
  podeEscrever: boolean;
  comEnvio: boolean;
  onClose: () => void;
  onMudou: () => void;
}) {
  const [acao, setAcao] = useState<"enviada" | "anular" | "reembolsar" | null>(comEnvio ? "enviada" : null);
  const [texto, setTexto] = useState("");
  const [aFazer, setAFazer] = useState(false);
  /** O passo escolhido no percurso, à espera da confirmação. */
  const [mudarPara, setMudarPara] = useState<PassoDaEncomenda | null>(null);
  const [avisar, setAvisar] = useState(true);
  const devolver = porReembolsar(e);
  const viva = e.estado === "PAID" || e.estado === "IN_PRODUCTION" || e.estado === "READY" || e.estado === "SHIPPED";
  const envio = e.entrega === "SHIPPING";
  const porPreparar = e.estado === "PAID" || e.estado === "IN_PRODUCTION";

  const fazer = async (f: () => Promise<unknown>, ok: string) => {
    setAFazer(true);
    try {
      await f();
      mostrarOk(ok);
      onMudou();
    } catch {
      // O erro já está no cartão de erros.
    } finally {
      setAFazer(false);
    }
  };

  const fecharAcao = () => {
    setAcao(null);
    setTexto("");
  };

  const escolherPasso = (p: PassoDaEncomenda) => {
    setTexto(p === "SHIPPED" ? (e.rastreio ?? "") : "");
    setAvisar(true);
    setMudarPara(p);
  };

  /** O passo seguinte, o único botão grande da ficha. */
  const seguinte =
    !podeEscrever ? null
    : porPreparar && !envio
      ? { rotulo: "Marcar como pronta", nota: "Quem comprou recebe um email a dizer que pode levantar.", icone: PackageCheck, fazer: () => void fazer(() => marcarPronta(e.id), "Pronta para levantamento. Quem comprou recebe o aviso.") }
    : porPreparar
      ? { rotulo: "Marcar como enviada", nota: "Quem comprou recebe um email com o código de seguimento, se o puseres.", icone: Truck, fazer: () => setAcao("enviada") }
    : e.estado === "READY"
      ? { rotulo: "Marcar como entregue", nota: "Fecha a encomenda", icone: Check, fazer: () => void fazer(() => marcarEntregue(e.id), "Marcada como entregue.") }
    : e.estado === "SHIPPED"
      ? { rotulo: "Marcar como entregue", nota: "Fecha a encomenda", icone: Check, fazer: () => void fazer(() => marcarEntregue(e.id), "Marcada como entregue.") }
    : null;

  const copiar = async (texto: string, ok: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      mostrarOk(ok);
    } catch {
      // Sem área de transferência (http, permissões): fica sem copiar, o texto está à vista.
    }
  };

  const subtotal = e.linhas.reduce((s, l) => s + l.quantidade * l.unitPriceCents, 0);

  return (
    <Dialog
      title={`Encomenda n.º ${e.numero}`}
      subtitle={`${e.referencia ? `${e.referencia} · ` : ""}${e.comprador.nome} · ${e.pagaEm ? `paga a ${dataHora(e.pagaEm)}` : `feita a ${dataHora(e.criadaEm)}`}`}
      icon={<PackageOpen className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={920}
      footer={
        <>
          {podeEscrever && viva && (
            <button type="button" className="ctl-ghost text-risk" disabled={aFazer} onClick={() => setAcao("anular")}>
              <Ban className="size-3.5" strokeWidth={1.75} />
              Cancelar encomenda
            </button>
          )}
          {podeEscrever && devolver && (
            <button type="button" className="ctl-ghost" disabled={aFazer} onClick={() => setAcao("reembolsar")}>
              <Undo2 className="size-3.5" strokeWidth={1.75} />
              Marcar como reembolsado
            </button>
          )}
          {podeEscrever && viva && (
            <button type="button" className="ctl-ghost" disabled={aFazer} onClick={() => void fazer(() => reenviarConfirmacao(e.id), `Confirmação reenviada para ${e.comprador.email}.`)}>
              <Send className="size-3.5" strokeWidth={1.75} />
              Reenviar confirmação
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className="ctl-outline" onClick={onClose}>
            Fechar
          </button>
        </>
      }
    >
      <div className="space-y-5 px-5 py-5">
        {/* A referência única: é o que se procura quando alguém liga. */}
        {e.referencia && (
          <div className="-mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-3">
            <span>
              Referência <span className="font-semibold tracking-wide text-ink tabular">{e.referencia}</span>
            </span>
            <button type="button" className="ctl-ghost h-7 px-1.5 text-meta text-ink-3" onClick={() => void copiar(e.referencia ?? "", "Referência copiada.")}>
              <Copy className="size-3.5" strokeWidth={1.75} />
              Copiar
            </button>
          </div>
        )}

        {/* O estado à cabeça: o percurso com as datas, e o passo seguinte ao lado. */}
        {e.estado === "CANCELLED" ? (
          <Faixa tom="neutro" icone={<Ban className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />}>
            <strong className="font-semibold text-ink">Cancelada{e.anuladaEm ? ` a ${dataHora(e.anuladaEm)}` : ""}.</strong>
            {e.motivo && <> {e.motivo}</>} Os artigos voltaram ao stock.
            {devolver && (
              <>
                {" "}
                <span className="font-semibold text-risk">Falta devolver {money(devolver.valorCents)}.</span>
              </>
            )}
            {e.reembolso?.feitoEm && <> Reembolso feito a {dataHora(e.reembolso.feitoEm)}.</>}
          </Faixa>
        ) : e.estado === "RESERVED" || e.estado === "LATE_PAYMENT" ? (
          <Faixa tom={e.estado === "RESERVED" ? "aviso" : "risco"} icone={<Clock className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />}>
            <strong className="font-semibold">{ESTADO_DA_ENCOMENDA[e.estado]}.</strong>{" "}
            {e.estado === "RESERVED"
              ? "Os artigos ficam guardados dez minutos à espera do pagamento. Sem ele, a reserva cai e o stock volta."
              : "O pagamento chegou depois de a reserva cair. Confirma se há stock antes de preparar; se não houver, cancela e fica o reembolso por fazer."}
          </Faixa>
        ) : (
          <div className="grid gap-4 rounded-[12px] border border-line bg-sunken/40 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0">
              <Percurso e={e} onEscolher={podeEscrever ? escolherPasso : undefined} />
              {podeEscrever && <p className="mt-2.5 text-[11px] text-ink-4">Toca num passo para mudar a encomenda para lá, para a frente ou para trás.</p>}
            </div>
            {seguinte && (
              <div className="flex flex-col items-start gap-1.5 md:items-end md:pl-4 md:text-right">
                <div className="flex flex-wrap gap-2 max-md:w-full">
                  {/* Em preparação: opcional, só a partir da paga, e nunca o botão principal. */}
                  {e.estado === "PAID" && (
                    <button
                      type="button"
                      className="ctl-outline h-10 max-md:flex-1 max-md:justify-center"
                      title="A encomenda está a ser preparada (no clube ou no fornecedor). Sem email a quem comprou."
                      disabled={aFazer}
                      onClick={() => void fazer(() => marcarEmProducao(e.id), "Em preparação. Marca-a pronta ou enviada quando estiver.")}
                    >
                      <Package className="size-4" strokeWidth={1.75} />
                      Em preparação
                    </button>
                  )}
                  <button type="button" className="ctl-primary h-10 px-4 max-md:flex-1 max-md:justify-center" disabled={aFazer} onClick={seguinte.fazer}>
                    <seguinte.icone className="size-4" strokeWidth={1.75} />
                    {seguinte.rotulo}
                  </button>
                </div>
                <p className="max-w-[30ch] text-meta leading-snug text-ink-3">{e.estado === "IN_PRODUCTION" ? `Já está pronta? ${seguinte.nota}` : seguinte.nota}</p>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_300px]">
          {/* Esquerda: os artigos e a conta. */}
          <section className="min-w-0">
            <h3 className="mb-2 text-meta font-semibold text-ink-2">
              Artigos <span className="font-normal text-ink-4 tabular">{unidades(e)}</span>
            </h3>
            <ul className="overflow-hidden rounded-[10px] border border-line">
              {e.linhas.map((l, i) => (
                <li key={i} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
                  <span className="h-14 w-11 shrink-0 overflow-hidden rounded-[7px] bg-sunken">
                    {l.imageUrl ? (
                      <img src={l.imageUrl} alt="" className="size-full object-cover" loading="lazy" />
                    ) : (
                      <span className="flex size-full items-center justify-center text-ink-4">
                        <Package className="size-4" strokeWidth={1.5} />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-ink">{l.nome}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-ink-3">
                      {l.tamanho && <span className="rounded-[5px] border border-line bg-surface px-1.5 py-px text-[11px] font-semibold text-ink-2">{l.tamanho}</span>}
                      <span className="tabular">
                        {l.quantidade} × {money(l.unitPriceCents)}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-body font-medium text-ink tabular">{money(l.quantidade * l.unitPriceCents)}</span>
                </li>
              ))}
            </ul>

            <dl className="mt-3 space-y-1.5 px-1 text-body">
              {((e.descontoCents ?? 0) > 0 || e.envioCents > 0) && <LinhaDaConta rotulo="Artigos" valor={money(subtotal)} />}
              {(e.descontoCents ?? 0) > 0 && (
                <LinhaDaConta rotulo={e.codigo ? `Desconto · ${e.codigo}` : "Desconto"} valor={`−${money(e.descontoCents ?? 0)}`} tom="ok" />
              )}
              {e.envioCents > 0 && <LinhaDaConta rotulo="Envio" valor={money(e.envioCents)} />}
              <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
                <dt className="font-semibold text-ink">Total</dt>
                <dd className="text-[17px] font-semibold text-ink tabular">{money(e.totalCents)}</dd>
              </div>
              {e.pagoCents > 0 && e.pagoCents !== e.totalCents && (
                <LinhaDaConta rotulo="Recebido na conta do clube" valor={money(e.pagoCents)} nota="Já com a comissão do pagamento." />
              )}
            </dl>

            {e.nota && (
              <div className="mt-4 rounded-[10px] border border-line bg-sunken/40 px-3.5 py-3">
                <p className="text-meta font-semibold text-ink-2">Nota de quem comprou</p>
                <p className="mt-1 text-body text-ink">{e.nota}</p>
              </div>
            )}
          </section>

          {/* Direita: quem comprou, a entrega, o histórico. */}
          <aside className="min-w-0 space-y-4">
            <Cartao titulo="Quem comprou">
              <div className="flex items-center gap-2.5">
                <Monogram name={e.comprador.nome} size="lg" />
                <span className="min-w-0">
                  <span className="block truncate text-body font-medium text-ink">{e.comprador.nome}</span>
                </span>
              </div>
              <ul className="mt-2.5 space-y-1.5 text-meta">
                <li>
                  <a href={`mailto:${e.comprador.email}`} className="inline-flex max-w-full items-center gap-1.5 text-ink-2 hover:text-ink hover:underline">
                    <Mail className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
                    <span className="truncate">{e.comprador.email}</span>
                  </a>
                </li>
                {e.comprador.telefone && (
                  <li>
                    <a href={`tel:${e.comprador.telefone}`} className="inline-flex items-center gap-1.5 text-ink-2 tabular hover:text-ink hover:underline">
                      <Phone className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
                      {e.comprador.telefone}
                    </a>
                  </li>
                )}
              </ul>
            </Cartao>

            <Cartao
              titulo={envio ? "Envio pelo correio" : "Levantamento no clube"}
              icone={envio ? <Truck className="size-3.5" strokeWidth={1.75} /> : <Package className="size-3.5" strokeWidth={1.75} />}
              acao={
                envio && e.morada.length > 0 ? (
                  <button type="button" className="ctl-ghost h-7 px-1.5 text-meta text-ink-3" title="Copiar a morada" onClick={() => void copiar([e.comprador.nome, ...e.morada].join("\n"), "Morada copiada.")}>
                    <Copy className="size-3.5" strokeWidth={1.75} />
                    Copiar
                  </button>
                ) : undefined
              }
            >
              {envio ? (
                <>
                  {e.morada.length > 0 ? (
                    <address className="flex items-start gap-1.5 text-body not-italic text-ink">
                      <MapPin className="mt-1 size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
                      <span>
                        <span className="block font-medium">{e.comprador.nome}</span>
                        {e.morada.map((m, i) => (
                          <span key={i} className="block">
                            {m}
                          </span>
                        ))}
                      </span>
                    </address>
                  ) : (
                    <p className="text-meta text-ink-3">Sem morada.</p>
                  )}
                  {e.rastreio && (
                    <p className="mt-2.5 flex items-center justify-between gap-2 rounded-[8px] bg-sunken px-2.5 py-1.5 text-meta">
                      <span className="min-w-0 truncate text-ink-2">
                        Seguimento <span className="font-semibold text-ink tabular">{e.rastreio}</span>
                      </span>
                      <button type="button" className="shrink-0 text-ink-3 hover:text-ink" aria-label="Copiar o código de seguimento" onClick={() => void copiar(e.rastreio ?? "", "Código copiado.")}>
                        <Copy className="size-3.5" strokeWidth={1.75} />
                      </button>
                    </p>
                  )}
                </>
              ) : (
                <p className="text-body text-ink-2">
                  {e.estado === "READY"
                    ? "À espera de quem comprou. Confere o nome ao entregar."
                    : e.estado === "DELIVERED"
                      ? "Entregue no clube."
                      : e.estado === "IN_PRODUCTION"
                        ? "Em preparação. Quando estiver, marca-a como pronta e quem comprou vem buscá-la."
                        : "Quem comprou vem buscar ao clube quando a marcares como pronta."}
                </p>
              )}
            </Cartao>

            <Cartao titulo="Histórico">
              <Historico e={e} />
            </Cartao>
          </aside>
        </div>
      </div>

      {acao === "enviada" && (
        <ConfirmDialog
          title="Marcar como enviada?"
          confirmLabel="Marcar como enviada"
          danger={false}
          onClose={fecharAcao}
          onConfirm={async () => {
            await marcarEnviada(e.id, texto);
            mostrarOk("Marcada como enviada. Quem comprou recebe o aviso.");
            fecharAcao();
            onMudou();
          }}
        >
          <p>Quem comprou recebe um email a dizer que a encomenda seguiu para {e.morada.join(", ")}.</p>
          <Campo id="rastreio" valor={texto} onChange={setTexto} rotulo="Código de seguimento (opcional)" placeholder="RR123456789PT" />
        </ConfirmDialog>
      )}

      {mudarPara && (
        <MudarDePasso
          e={e}
          para={mudarPara}
          rastreio={texto}
          onRastreio={setTexto}
          avisar={avisar}
          onAvisar={() => setAvisar((v) => !v)}
          onClose={() => {
            setMudarPara(null);
            setTexto("");
          }}
          onConfirm={async () => {
            await mudarEstado(e.id, mudarPara, { rastreio: mudarPara === "SHIPPED" ? texto : undefined, avisar });
            mostrarOk(`Passou a «${nomeDoPasso(mudarPara, envio)}».`);
            setMudarPara(null);
            setTexto("");
            onMudou();
          }}
        />
      )}

      {acao === "anular" && (
        <ConfirmDialog
          title={`Cancelar a encomenda n.º ${e.numero}?`}
          confirmLabel="Cancelar encomenda"
          onClose={fecharAcao}
          onConfirm={async () => {
            if (texto.trim().length < 2) throw new Error("Escreve o motivo. Vai no email a quem comprou.");
            await anularEncomenda(e.id, texto.trim());
            mostrarOk("Encomenda cancelada.");
            fecharAcao();
            onMudou();
          }}
        >
          <p>Os artigos voltam ao stock. Quem comprou recebe um email com o motivo, e fica um reembolso por fazer de {money(e.pagoCents || e.totalCents)}.</p>
          <Campo id="motivo-anular" valor={texto} onChange={setTexto} rotulo="Motivo (vai no email)" placeholder="O artigo deixou de se fabricar." multiline />
        </ConfirmDialog>
      )}

      {acao === "reembolsar" && e.reembolso && (
        <ConfirmDialog
          title="Marcar como reembolsado?"
          confirmLabel="Marcar como reembolsado"
          danger={false}
          onClose={fecharAcao}
          onConfirm={async () => {
            await marcarReembolsado(e.id, texto);
            mostrarOk("Reembolso marcado como feito.");
            fecharAcao();
            onMudou();
          }}
        >
          <p>Devolveste {money(e.reembolso.valorCents)} a {e.comprador.nome} por fora (transferência, MB WAY, em mão). Fica marcado com o teu nome e a data.</p>
          <Campo id="nota-reembolso" valor={texto} onChange={setTexto} rotulo="Nota (opcional)" placeholder="Transferência a 24/10, ref. 123." multiline />
        </ConfirmDialog>
      )}
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Peças da ficha                                                              */
/* -------------------------------------------------------------------------- */

/**
 * O percurso da encomenda em quatro passos, com a data de cada um: paga, em
 * preparação (opcional), pronta para levantamento ou enviada, entregue. Até
 * ao estado de agora a verde, o seguinte aceso, os de depois apagados.
 *
 * Uma encomenda que já passou da preparação conta como preparada, mesmo que
 * ninguém tenha carregado no botão (pedido do Rui a 15/11): fica a verde, só
 * sem data. Antes aparecia em traço com "não passou".
 *
 * Com `onEscolher`, cada passo que não é o de agora é um botão: a encomenda
 * vai para lá, para a frente ou para trás (a confirmação diz o que acontece).
 */
function Percurso({ e, onEscolher }: { e: Encomenda; onEscolher?: (p: PassoDaEncomenda) => void }) {
  const envio = e.entrega === "SHIPPING";
  const passos = passosDaEncomenda(e.entrega);
  const atual = passos.indexOf(e.estado as PassoDaEncomenda);

  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="Percurso da encomenda">
      {passos.map((p, i) => {
        const quando = dataDoPasso(e, p);
        const agora = i === atual;
        const feito = i <= atual;
        const seguinte = i === atual + 1;
        const conteudo = (
          <>
            <span
              className={cx(
                "block h-1.5 rounded-full",
                feito ? "bg-ok" : seguinte ? "bg-signal/50" : "bg-line",
                agora && "ring-2 ring-ok/25",
              )}
              aria-hidden
            />
            <span className={cx("mt-2 flex items-center gap-1 text-meta font-semibold", feito ? "text-ink" : seguinte ? "text-signal-ink" : "text-ink-4")}>
              {feito && <Check className="size-3.5 shrink-0 text-ok" strokeWidth={2.25} />}
              <span className="truncate">{nomeDoPasso(p, envio)}</span>
            </span>
            <span className="block truncate text-meta text-ink-3 tabular">
              {quando && i <= atual ? dataHora(quando) : agora ? "agora" : i < atual ? " " : p === "IN_PRODUCTION" ? "opcional" : seguinte ? "a seguir" : ""}
            </span>
          </>
        );
        return (
          <li key={p} className="min-w-0">
            {onEscolher && !agora ? (
              <button
                type="button"
                onClick={() => onEscolher(p)}
                title={i < atual ? `Voltar a «${nomeDoPasso(p, envio)}»` : `Passar a «${nomeDoPasso(p, envio)}»`}
                className="-m-1.5 block w-[calc(100%+0.75rem)] rounded-[8px] p-1.5 text-left transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-signal"
              >
                {conteudo}
              </button>
            ) : (
              <div aria-current={agora ? "step" : undefined}>{conteudo}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A confirmação de uma mudança de passo. Diz o que acontece: para a frente,
 * se quem comprou recebe email (e deixa desligar); para trás, que datas se
 * apagam e que ninguém é avisado. Fica no histórico com o nome de quem mudou.
 */
function MudarDePasso({
  e,
  para,
  rastreio,
  onRastreio,
  avisar,
  onAvisar,
  onClose,
  onConfirm,
}: {
  e: Encomenda;
  para: PassoDaEncomenda;
  rastreio: string;
  onRastreio: (v: string) => void;
  avisar: boolean;
  onAvisar: () => void;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const envio = e.entrega === "SHIPPING";
  const passos = passosDaEncomenda(e.entrega);
  const de = passos.indexOf(e.estado as PassoDaEncomenda);
  const ate = passos.indexOf(para);
  const paraTras = ate < de;
  const comEmail = !paraTras && (para === "READY" || para === "SHIPPED");
  const apagados = paraTras ? passos.filter((p, i) => i > ate && i <= de && p !== "PAID" && dataDoPasso(e, p)).map((p) => nomeDoPasso(p, envio).toLowerCase()) : [];

  return (
    <ConfirmDialog
      title={paraTras ? `Voltar a «${nomeDoPasso(para, envio)}»?` : `Passar a «${nomeDoPasso(para, envio)}»?`}
      confirmLabel={paraTras ? "Voltar atrás" : `Passar a ${nomeDoPasso(para, envio).toLowerCase()}`}
      danger={false}
      onClose={onClose}
      onConfirm={onConfirm}
    >
      <p>
        A encomenda n.º {e.numero} passa de «{nomeDoPasso(e.estado, envio)}» para «{nomeDoPasso(para, envio)}».
        {paraTras && (
          <>
            {" "}
            {apagados.length > 0 ? `Sai a data de ${apagados.join(" e de ")}. ` : ""}
            Quem comprou não recebe email.
          </>
        )}
        {!paraTras && !comEmail && " Quem comprou não recebe email."}
        {" "}Fica no histórico com o teu nome.
      </p>
      {para === "SHIPPED" && <Campo id="rastreio-passo" valor={rastreio} onChange={onRastreio} rotulo="Código de seguimento (opcional)" placeholder="RR123456789PT" />}
      {comEmail && (
        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-line px-3 py-2.5">
          <span className="text-body text-ink-2">
            Avisar quem comprou por email
            <span className="block text-meta text-ink-3">{para === "READY" ? "Diz que já pode levantar." : "Diz que seguiu, com o código se o puseres."}</span>
          </span>
          <Interruptor ligado={avisar} onChange={onAvisar} label="Avisar quem comprou por email" />
        </div>
      )}
    </ConfirmDialog>
  );
}

/**
 * O que aconteceu, momento a momento, do mais antigo para o mais recente.
 *
 * As mudanças feitas na consola vêm do registo (`mudancas`), com quem as fez
 * e as voltas atrás. Antes do registo existir (15/11/2026), os passos
 * tiram-se das datas da encomenda; por isso as datas só contam até à
 * primeira mudança registada, e não aparecem duas vezes.
 */
function Historico({ e }: { e: Encomenda }) {
  const envio = e.entrega === "SHIPPING";
  const mudancas = e.mudancas ?? [];
  const desde = mudancas[0]?.em ?? null;
  const antes = (iso: string | null | undefined): iso is string => !!iso && (!desde || iso < desde);

  const eventos: { quando: string; titulo: string; detalhe?: string; tom?: Tone }[] = [{ quando: e.criadaEm, titulo: "Feita no site", detalhe: `${unidades(e)} ${unidades(e) === 1 ? "artigo" : "artigos"} · ${money(e.totalCents)}` }];
  if (e.pagaEm) eventos.push({ quando: e.pagaEm, titulo: "Paga", detalhe: e.pagoCents > 0 ? `Recebidos ${money(e.pagoCents)}` : undefined, tom: "ok" });
  if (antes(e.producaoEm)) eventos.push({ quando: e.producaoEm, titulo: "Em preparação", tom: "warn" });
  if (antes(e.prontaEm)) eventos.push({ quando: e.prontaEm, titulo: "Pronta para levantamento", detalhe: "Email a quem comprou", tom: "ok" });
  if (antes(e.enviadaEm)) eventos.push({ quando: e.enviadaEm, titulo: "Enviada", detalhe: e.rastreio ? `Seguimento ${e.rastreio}` : "Email a quem comprou", tom: "ok" });
  if (antes(e.entregueEm)) eventos.push({ quando: e.entregueEm, titulo: envio ? "Entregue" : "Entregue no clube", tom: "ok" });
  if (antes(e.anuladaEm)) eventos.push({ quando: e.anuladaEm, titulo: "Cancelada", detalhe: e.motivo ?? undefined, tom: "risk" });

  const ordem: EstadoDaEncomenda[] = ["PAID", "IN_PRODUCTION", "READY", "SHIPPED", "DELIVERED"];
  for (const m of mudancas) {
    const paraTras = !!m.de && ordem.indexOf(m.para) >= 0 && ordem.indexOf(m.para) < ordem.indexOf(m.de);
    const titulo =
      m.para === "CANCELLED" ? "Cancelada" : paraTras ? `Voltou a «${nomeDoPasso(m.para, envio)}»` : nomeDoPasso(m.para, envio);
    const detalhe = [m.quem ? `por ${m.quem}` : null, m.nota].filter(Boolean).join(" · ") || undefined;
    eventos.push({ quando: m.em, titulo, detalhe, tom: m.para === "CANCELLED" ? "risk" : paraTras || m.para === "IN_PRODUCTION" ? "warn" : "ok" });
  }
  if (e.reembolso?.feitoEm) eventos.push({ quando: e.reembolso.feitoEm, titulo: `Reembolsados ${money(e.reembolso.valorCents)}`, detalhe: e.reembolso.nota ?? undefined, tom: "ok" });
  if (e.reembolso && !e.reembolso.feitoEm) eventos.push({ quando: e.anuladaEm ?? e.criadaEm, titulo: `Reembolso por fazer · ${money(e.reembolso.valorCents)}`, detalhe: "Devolve por fora e marca aqui.", tom: "risk" });
  eventos.sort((a, b) => a.quando.localeCompare(b.quando));

  const cor: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", risk: "bg-risk", neutral: "bg-ink-4", signal: "bg-signal" };

  return (
    <ol className="relative space-y-3 before:absolute before:top-1.5 before:bottom-1.5 before:left-[5px] before:w-px before:bg-line">
      {eventos.map((ev, i) => (
        <li key={i} className="relative pl-5">
          <span className={cx("absolute top-1.5 left-0 size-[11px] rounded-full border-2 border-surface", cor[ev.tom ?? "neutral"])} aria-hidden />
          <p className={cx("text-meta font-semibold", ev.tom === "risk" ? "text-risk" : "text-ink")}>{ev.titulo}</p>
          {ev.detalhe && <p className="text-meta text-ink-3">{ev.detalhe}</p>}
          <p className="text-[11px] text-ink-4 tabular">{dataHora(ev.quando)}</p>
        </li>
      ))}
    </ol>
  );
}

function Cartao({ titulo, icone, acao, children }: { titulo: string; icone?: ReactNode; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-[10px] border border-line px-3.5 py-3">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-meta font-semibold text-ink-2">
          {icone && <span className="text-ink-3">{icone}</span>}
          {titulo}
        </h3>
        {acao}
      </header>
      {children}
    </section>
  );
}

function LinhaDaConta({ rotulo, valor, nota, tom }: { rotulo: string; valor: string; nota?: string; tom?: "ok" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-3">
        {rotulo}
        {nota && <span className="block text-meta text-ink-4">{nota}</span>}
      </dt>
      <dd className={cx("tabular", tom === "ok" ? "text-ok" : "text-ink-2")}>{valor}</dd>
    </div>
  );
}

function Faixa({ tom, icone, children }: { tom: "neutro" | "aviso" | "risco"; icone: ReactNode; children: ReactNode }) {
  return (
    <p
      className={cx(
        "flex items-start gap-2 rounded-[10px] border px-3.5 py-3 text-body leading-relaxed",
        tom === "neutro" && "border-line bg-sunken/60 text-ink-2",
        tom === "aviso" && "border-warn/25 bg-warn-soft text-warn",
        tom === "risco" && "border-risk/25 bg-risk-soft text-risk",
      )}
    >
      {icone}
      <span>{children}</span>
    </p>
  );
}

/** Um campo de texto com o rótulo por cima e nada tocável lá dentro. */
function Campo({ id, valor, onChange, rotulo, placeholder, multiline = false }: { id: string; valor: string; onChange: (v: string) => void; rotulo: string; placeholder?: string; multiline?: boolean }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-meta font-medium text-ink-2">
        {rotulo}
      </label>
      {multiline ? (
        <textarea id={id} className={cx(dialogInputClass, "h-20 py-2")} maxLength={300} placeholder={placeholder} value={valor} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} className={dialogInputClass} maxLength={80} placeholder={placeholder} value={valor} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
