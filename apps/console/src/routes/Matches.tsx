import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Attention } from "@/components/Attention";
import { Empty, Loading, Panel, Pill, cx } from "@/components/primitives";
import { ChevronRight, MapPin } from "@/lib/icons";
import { useStore } from "@/lib/store";
import { listMatches, matchAttention, myMatchDuty, outcome, type MatchListRow } from "@/lib/matches";
import { useSession } from "@/session";
import { can } from "@/lib/permissions";

type Vista = "proximos" | "passados";

/**
 * Jogos.
 *
 * ## Quem vê o quê
 *
 * Um treinador vê os jogos das equipas dele; quem tem alcance de clube vê-os
 * todos. Isso **não** se decide aqui — decide-se no servidor, em
 * `teamScopeFilter`, e a lista que chega já é a certa. Filtrar no cliente dava a
 * mesma imagem e nenhuma das garantias.
 *
 * ## O que mudou nesta página
 *
 * Era uma lista plana de linhas iguais, e não parecia nada. Agora:
 *
 *  - **duas fichas de trabalho no topo** dizem o que falta, com o número em
 *    grande, e são elas próprias o filtro — a pergunta "o que tenho para fazer?"
 *    responde-se e resolve-se no mesmo gesto;
 *  - **as linhas são um mini-marcador**, com os dois nomes e o resultado no meio,
 *    porque é assim que um jogo se lê em qualquer lado;
 *  - **os jogos agrupam-se por mês**, com cabeçalho pegajoso — trinta jogos numa
 *    fila só não têm por onde se agarrar.
 */
export default function Matches() {
  const store = useStore();
  const { session } = useSession();

  /*
   * Quem convoca e quem preenche fichas.
   *
   * Sem esta linha, o departamento clínico abria os Jogos e lia "2 convocatórias
   * por enviar · Convocar" — trabalho que não é dele e que o servidor lhe recusa.
   * A Visão geral já tinha o filtro; esta página não, e foi assim que apareceu.
   */
  const podeDespachar = can(session, "attendance:read");

  const [rows, setRows] = useState<MatchListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [equipa, setEquipa] = useState<string>("todas");

  /*
   * A vista e o filtro vivem no endereço.
   *
   * `?falta=convocar` e `?falta=preencher` são os dois destinos do painel de
   * atenção — e, por serem URLs, ficam partilháveis e o botão de voltar desfaz o
   * filtro. `?vista=passados` guarda só a metade do tempo que se está a ver.
   */
  const [params, setParams] = useSearchParams();
  const falta = params.get("falta");
  const vista: Vista =
    falta === "preencher" ? "passados" : falta === "convocar" ? "proximos" : params.get("vista") === "passados" ? "passados" : "proximos";
  const soPendentes = podeDespachar && (falta === "convocar" || falta === "preencher");

  /** `?meus=1`: só os jogos onde esta pessoa está escalada. */
  const soMeus = params.get("meus") === "1";

  const setVista = (v: Vista) => setParams(v === "passados" ? { vista: "passados" } : {}, { replace: true });

  useEffect(() => {
    /*
     * Uma janela larga, e uma leitura só.
     *
     * Um ano para trás e seis meses para a frente apanha a época toda de qualquer
     * clube. Paginar seria resolver um problema que um clube com trinta jogos por
     * época não tem.
     */
    const from = new Date(Date.now() - 365 * 86_400_000);
    const to = new Date(Date.now() + 180 * 86_400_000);
    listMatches(from, to)
      .then(setRows)
      .catch((e) => setErro(e instanceof Error ? e.message : "Não foi possível carregar os jogos."))
      .finally(() => setLoading(false));
  }, []);

  const equipas = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.teamId, r.teamName);
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt"));
  }, [rows]);

  const agora = Date.now();
  const activo = (r: MatchListRow) => r.status !== "CANCELLED";
  const jaFoi = (r: MatchListRow) => new Date(r.startsAt).getTime() < agora;

  /** Em quantos jogos por vir esta pessoa está escalada. Zero esconde o filtro. */
  const escalado = rows.filter(
    (r) => r.myStaffRole !== null && activo(r) && !jaFoi(r),
  ).length;

  /** Já jogados e sem resultado — o trabalho por fazer, do lado do passado. */
  const porPreencher = rows.filter((r) => activo(r) && jaFoi(r) && r.ourScore === null);

  /**
   * A chegar e sem convocatória enviada, dentro de dez dias.
   *
   * A janela tem de ser a mesma de `matchAttention`: sem ela, o painel contava
   * "2 convocatórias por enviar" e o filtro que ele abre mostrava sete — as duas
   * urgentes mais cinco de daqui a dois meses. Um número que não bate com a lista
   * que ele próprio abre é a maneira mais rápida de deixar de se acreditar nele.
   */
  const porConvocar = rows.filter(
    (r) =>
      activo(r) &&
      !r.submitted &&
      !jaFoi(r) &&
      new Date(r.startsAt).getTime() - agora <= 10 * 86_400_000,
  );

  const pendentesDaVista = vista === "proximos" ? porConvocar : porPreencher;
  const pendenteIds = useMemo(() => new Set(pendentesDaVista.map((r) => r.id)), [pendentesDaVista]);

  const filtrados = rows
    .filter((r) => (equipa === "todas" ? true : r.teamId === equipa))
    .filter((r) => (vista === "proximos" ? !jaFoi(r) : jaFoi(r)))
    .filter((r) => (soPendentes ? pendenteIds.has(r.id) : true))
    .filter((r) => (soMeus ? r.myStaffRole !== null : true))
    // Os próximos sobem no tempo (o mais perto primeiro); os passados descem (o
    // mais recente primeiro). É a ordem em que cada um deles se procura.
    .sort((a, b) =>
      vista === "proximos"
        ? new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
        : new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
    );

  /** Agrupado por mês, para a lista ter por onde se agarrar. */
  const meses = useMemo(() => {
    const out: { chave: string; label: string; jogos: MatchListRow[] }[] = [];
    for (const m of filtrados) {
      const d = new Date(m.startsAt);
      const chave = `${d.getFullYear()}-${d.getMonth()}`;
      const ultimo = out[out.length - 1];
      if (ultimo?.chave === chave) ultimo.jogos.push(m);
      else out.push({ chave, label: d.toLocaleDateString("pt-PT", { month: "long", year: "numeric" }), jogos: [m] });
    }
    return out;
  }, [filtrados]);

  /*
   * Os mesmos itens da Visão geral, da mesma função.
   *
   * A página tem uma janela de leitura mais larga do que o arranque, por isso as
   * contagens podem não bater ao dígito — mas as frases, os destinos e a regra do
   * "urgente a três dias" são os mesmos, que é o que interessa não divergir.
   */
  const atencao = [
    ...myMatchDuty(rows, agora),
    ...(podeDespachar ? matchAttention(rows, agora) : []),
  ];

  return (
    <>
      <PageHeader eyebrow={store.academy.name} title="Jogos" />

      {/*
        O mesmo painel da Visão geral, e não um aviso próprio.
        Já houve aqui dois cartões grandes com o número em corpo 32, e depois uma
        barra âmbar — os dois inventavam uma linguagem só para esta página. "O que
        precisa de atenção" já tem uma forma nesta aplicação: título, contagem,
        uma linha por assunto com o facto, a consequência e um verbo. Reusá-la é o
        que faz esta página parecer parte do produto e não um anexo.

        Os destinos são URLs (`?falta=convocar`) e não estado local: o filtro
        passa a poder ser guardado nos favoritos, partilhado, e desfeito com o
        botão de voltar.
      */}
      {atencao.length > 0 && (
        <div className="mb-3">
          <Attention items={atencao} />
        </div>
      )}

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          <div className="flex rounded-[var(--radius-control)] border border-line p-0.5" role="group" aria-label="Período">
            {(["proximos", "passados"] as Vista[]).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={vista === v}
                onClick={() => setVista(v)}
                className={cx(
                  "min-h-9 rounded-[6px] px-3.5 text-meta font-medium transition-colors",
                  vista === v ? "bg-ink text-surface" : "text-ink-3 hover:text-ink",
                )}
              >
                {v === "proximos" ? "A chegar" : "Já jogados"}
              </button>
            ))}
          </div>

          {soPendentes && (
            <button
              type="button"
              onClick={() => setVista(vista)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] bg-warn-soft px-2.5 text-meta font-medium text-warn"
            >
              só o que falta
              <span aria-hidden>×</span>
            </button>
          )}

          {/*
            "Onde estou escalado" só aparece a quem está escalado nalgum sítio.
            Um filtro que só devolve zero é um botão que ensina a não carregar em
            botões. Para a massagista, é o único filtro desta página que lhe diz
            alguma coisa.
          */}
          {(soMeus || escalado > 0) && (
            <button
              type="button"
              aria-pressed={soMeus}
              onClick={() => setParams(soMeus ? {} : { meus: "1" }, { replace: true })}
              className={cx(
                "inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-meta font-medium transition-colors",
                soMeus ? "bg-ink text-surface" : "border border-line text-ink-2 hover:border-line-strong",
              )}
            >
              Onde estou escalado
              {!soMeus && <span className="tabular opacity-60">{escalado}</span>}
              {soMeus && <span aria-hidden>×</span>}
            </button>
          )}

          {/* Só com mais do que uma equipa: uma caixa com uma opção é ruído. */}
          {equipas.length > 1 && (
            <label className="ml-auto flex items-center gap-2">
              <span className="text-meta text-ink-3">Equipa</span>
              <select
                value={equipa}
                onChange={(e) => setEquipa(e.target.value)}
                className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-meta text-ink outline-none focus:border-line-strong"
              >
                <option value="todas">Todas</option>
                {equipas.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {loading ? (
          <Loading />
        ) : erro ? (
          <Empty title="Não foi possível carregar" detail={erro} />
        ) : meses.length === 0 ? (
          <Empty
            title={
              soMeus
                ? "Não estás escalado para nenhum jogo"
                : soPendentes
                  ? "Nada por fazer aqui"
                  : vista === "proximos"
                    ? "Nenhum jogo marcado"
                    : "Nenhum jogo jogado"
            }
            detail={
              soMeus
                ? "Quando alguém te puser na ficha técnica de um jogo, recebes aviso e ele aparece aqui."
                : soPendentes
                  ? "Tudo em dia nesta vista."
                  : vista === "proximos"
                    ? "Os jogos marcam-se no calendário, e aparecem aqui."
                    : "Assim que houver jogos passados, aparecem aqui para preencheres a ficha."
            }
          />
        ) : (
          meses.map((mes) => (
            <section key={mes.chave}>
              <h2 className="sticky top-0 z-10 border-b border-line bg-sunken/90 px-5 py-2 text-group text-ink-3 uppercase backdrop-blur">
                {mes.label}
              </h2>
              <ul>
                {mes.jogos.map((m) => (
                  <Row key={m.id} match={m} passado={vista === "passados"} pendente={pendenteIds.has(m.id)} />
                ))}
              </ul>
            </section>
          ))
        )}
      </Panel>
    </>
  );
}

/** Uma linha: data à esquerda como régua, mini-marcador ao centro, estado à direita. */
function Row({ match, passado, pendente }: { match: MatchListRow; passado: boolean; pendente: boolean }) {
  const inicio = new Date(match.startsAt);
  const res = outcome(match);
  const cancelado = match.status === "CANCELLED";

  const casa = match.isHome ? match.teamName : match.opponent;
  const fora = match.isHome ? match.opponent : match.teamName;
  const golosCasa = match.isHome ? match.ourScore : match.theirScore;
  const golosFora = match.isHome ? match.theirScore : match.ourScore;

  return (
    <li className="border-b border-line last:border-b-0">
      <Link
        to={`/jogos/${match.id}`}
        className="flex min-h-16 items-center gap-3 px-5 py-3 transition-colors hover:bg-sunken/60 sm:gap-4"
      >
        {/* A data como régua: o olho desce por ela sem ler. */}
        <span className="w-11 shrink-0 text-center">
          <span className="block text-[19px] leading-tight font-semibold tabular text-ink">{inicio.getDate()}</span>
          <span className="block text-[11px] uppercase text-ink-4">
            {inicio.toLocaleDateString("pt-PT", { weekday: "short" }).replace(".", "")}
          </span>
        </span>

        {/* O mini-marcador. */}
        <span className="grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3">
          <span
            className={cx(
              "truncate text-right text-body",
              cancelado ? "text-ink-4 line-through" : match.isHome ? "font-medium text-ink" : "text-ink-2",
            )}
          >
            {casa}
          </span>

          <span className="shrink-0 text-center">
            {res ? (
              <span
                className={cx(
                  "inline-block rounded-[6px] px-2 py-0.5 text-body font-semibold tabular",
                  res === "win" && "bg-ok-soft text-ok",
                  res === "draw" && "bg-sunken text-ink-2",
                  res === "loss" && "bg-risk-soft text-risk",
                )}
              >
                {golosCasa}–{golosFora}
              </span>
            ) : (
              <span className="text-meta tabular text-ink-3">
                {inicio.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </span>

          <span
            className={cx(
              "truncate text-body",
              cancelado ? "text-ink-4 line-through" : !match.isHome ? "font-medium text-ink" : "text-ink-2",
            )}
          >
            {fora}
          </span>
        </span>

        {/*
          O selo de escalado, antes do resto.
          Fica fora do bloco `md:flex` de propósito: num telemóvel, "vou trabalhar
          neste jogo" é a informação que sobrevive ao corte — o campo e o escalão
          não são.
        */}
        {match.myStaffRole && <Pill tone="signal">{match.myStaffRole}</Pill>}

        {/* O contexto e o que falta, à direita. */}
        <span className="hidden shrink-0 items-center gap-2 md:flex">
          <span className="inline-flex max-w-[160px] items-center gap-1 truncate text-meta text-ink-3">
            <MapPin className="size-3.5 shrink-0" strokeWidth={1.75} />
            {match.venue}
          </span>
          <span className="w-[86px] text-right">
            {cancelado ? (
              <Pill>cancelado</Pill>
            ) : pendente ? (
              <Pill tone="warn">{passado ? "sem resultado" : "por convocar"}</Pill>
            ) : (
              <span className="text-meta text-ink-4">{match.teamName}</span>
            )}
          </span>
        </span>

        <ChevronRight className="size-4 shrink-0 text-ink-4" strokeWidth={1.75} />
      </Link>
    </li>
  );
}
