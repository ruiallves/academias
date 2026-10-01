import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Attention } from "@/components/Attention";
import { Empty, Loading, cx } from "@/components/primitives";
import { SearchInput } from "@/components/filters";
import { Cartao } from "@/components/match/ui";
import { LinhaDeJogo, ProximoJogo, type EstadoDoJogo, type JogoNaLista } from "@/components/match/views";
import { Segmented } from "@/components/filters";
import { CircleCheck, Plus, Shield, SlidersHorizontal, Trophy } from "@/lib/icons";
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
   * A procura e os filtros que se usam de vez em quando. A equipa e o período
   * estão sempre à vista; onde se joga e o estado só aparecem em "Filtrar",
   * para a barra não ser uma fila de caixas.
   */
  const [procura, setProcura] = useState("");
  const [maisFiltros, setMaisFiltros] = useState(false);
  const [onde, setOnde] = useState<"todos" | "casa" | "fora">("todos");
  const [estadoFiltro, setEstadoFiltro] = useState<string>("todos");

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
  /*
   * O que é **trabalho meu** — e não o que está na lista.
   *
   * A lista passou a trazer os jogos de todas as equipas: um treinador tem de
   * poder ver quando joga o escalão de cima. Mas convocar e preencher a ficha
   * continuam a ser das equipas dele, e as duas fichas de trabalho no topo desta
   * página contam só essas. Ver `calendarScopeFilter` no servidor.
   */
  const meu = (r: MatchListRow) => r.mine && activo(r);
  const jaFoi = (r: MatchListRow) => new Date(r.startsAt).getTime() < agora;

  /** Em quantos jogos por vir esta pessoa está escalada. Zero esconde o filtro. */
  const escalado = rows.filter(
    (r) => r.myStaffRole !== null && activo(r) && !jaFoi(r),
  ).length;

  /** Já jogados e sem resultado — o trabalho por fazer, do lado do passado. */
  const porPreencher = rows.filter((r) => meu(r) && jaFoi(r) && r.ourScore === null);

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
      meu(r) &&
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
    .filter((r) => (onde === "todos" ? true : onde === "casa" ? r.isHome : !r.isHome))
    .filter((r) => (estadoFiltro === "todos" ? true : estadoDoJogo(r, agora).chave === estadoFiltro))
    .filter((r) => {
      const t = semAcentos(procura.trim());
      return t === "" || semAcentos(r.opponent).includes(t) || semAcentos(r.teamName).includes(t) || semAcentos(r.competition?.label ?? "").includes(t);
    })
    // Os próximos sobem no tempo (o mais perto primeiro); os passados descem (o
    // mais recente primeiro). É a ordem em que cada um deles se procura.
    .sort((a, b) =>
      vista === "proximos"
        ? new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
        : new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
    );

  /** Agrupado por semana (segunda a domingo): é assim que um clube pensa nos jogos. */
  const semanas = useMemo(() => {
    const out: { chave: string; label: string; jogos: MatchListRow[] }[] = [];
    for (const m of filtrados) {
      const seg = segundaDe(new Date(m.startsAt));
      const chave = seg.toDateString();
      const ultimo = out[out.length - 1];
      if (ultimo?.chave === chave) ultimo.jogos.push(m);
      else out.push({ chave, label: nomeDaSemana(seg), jogos: [m] });
    }
    return out;
  }, [filtrados]);
  const filtrosAtivos = (onde !== "todos" ? 1 : 0) + (estadoFiltro !== "todos" ? 1 : 0);
  /*
   * O próximo jogo. Só na vista "A chegar" e sem filtros nem procura: com um
   * filtro posto, um destaque que o ignora parecia um engano.
   */
  const destaque =
    vista === "proximos" && !soPendentes && !soMeus && filtrosAtivos === 0 && procura.trim() === ""
      ? (filtrados.find((r) => r.status !== "CANCELLED" && (r.mine || equipa !== "todas")) ?? filtrados.find((r) => r.status !== "CANCELLED"))
      : undefined;

  /*
   * Os mesmos itens da Visão geral, da mesma função.
   *
   * A página tem uma janela de leitura mais larga do que o arranque, por isso as
   * contagens podem não bater ao dígito — mas as frases, os destinos e a regra do
   * "urgente a três dias" são os mesmos, que é o que interessa não divergir.
   */
  const podeMarcar = can(session, "calendar:write");

  const atencao = [
    ...myMatchDuty(rows, agora),
    ...(podeDespachar ? matchAttention(rows, agora) : []),
  ];

  return (
    <>
      <PageHeader eyebrow={store.academy.name} title="Jogos">
        {/*
          Marcar um jogo é do calendário, e é para lá que este botão leva — com
          o "Novo evento" já aberto no tipo certo (`?novo=jogo`).

          Um formulário próprio aqui seria a mesma coisa em dois sítios, com dois
          conjuntos de regras a divergirem. E marcar às cegas, sem ver o mês, é
          como nascem dois jogos à mesma hora no mesmo campo — no calendário, o
          que já está ocupado está à vista antes de se escolher a data.
        */}
        {/*
          Os adversários: o que o clube já sabe de cada um. Vive aqui dentro
          dos Jogos e não num menu próprio — é uma leitura dos jogos, e é a
          caminho de um jogo que se procura.
        */}
        <Link to="/jogos/adversarios" className="ctl-ghost">
          <Shield className="size-3.5" strokeWidth={1.75} />
          Adversários
        </Link>
        {podeMarcar && (
          <Link to="/calendario?novo=jogo" className="ctl-primary">
            <Plus className="size-3.5" strokeWidth={2} />
            Agendar jogo
          </Link>
        )}
      </PageHeader>

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

      {/* O próximo jogo, em destaque: é a primeira pergunta de quem abre esta página. */}
      {destaque && (
        <div className="mb-4">
          <ProximoJogo jogo={paraLinha(destaque, agora)} logo={store.academy.logoUrl} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          size="md"
          label="Período"
          value={vista}
          onChange={setVista}
          options={[
            { value: "proximos", label: "A chegar" },
            { value: "passados", label: "Já jogados" },
          ]}
        />

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
          botões.
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

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SearchInput value={procura} onChange={setProcura} placeholder="Procurar adversário…" />
          {/* Só com mais do que uma equipa: uma caixa com uma opção é ruído. */}
          {equipas.length > 1 && (
            <select
              aria-label="Equipa"
              value={equipa}
              onChange={(e) => setEquipa(e.target.value)}
              className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-meta text-ink outline-none focus:border-line-strong"
            >
              <option value="todas">Todas as equipas</option>
              {equipas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            aria-expanded={maisFiltros}
            onClick={() => setMaisFiltros((v) => !v)}
            className={cx("ctl-outline h-9", (maisFiltros || filtrosAtivos > 0) && "border-ink text-ink")}
          >
            <SlidersHorizontal className="size-3.5" strokeWidth={1.75} />
            Filtrar
            {filtrosAtivos > 0 && <span className="tabular">{filtrosAtivos}</span>}
          </button>
        </div>
      </div>

      {maisFiltros && (
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[16px] border border-line bg-surface px-4 py-3">
          <span className="flex items-center gap-2">
            <span className="text-meta text-ink-3">Onde</span>
            <Segmented
              label="Onde se joga"
              value={onde}
              onChange={setOnde}
              options={[
                { value: "todos", label: "Todos" },
                { value: "casa", label: "Casa" },
                { value: "fora", label: "Fora" },
              ]}
            />
          </span>
          <span className="flex items-center gap-2">
            <span className="text-meta text-ink-3">Estado</span>
            <select
              aria-label="Estado do jogo"
              value={estadoFiltro}
              onChange={(e) => setEstadoFiltro(e.target.value)}
              className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-meta text-ink outline-none focus:border-line-strong"
            >
              <option value="todos">Todos</option>
              {(vista === "proximos"
                ? [
                    ["por-preparar", "Por preparar"],
                    ["em-preparacao", "Em preparação"],
                    ["pronto", "Pronto"],
                  ]
                : [
                    ["sem-resultado", "Sem resultado"],
                    ["por-analisar", "Por analisar"],
                    ["analisado", "Analisado"],
                  ]
              ).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </span>
          {filtrosAtivos > 0 && (
            <button
              type="button"
              className="text-meta font-medium text-ink-3 underline-offset-2 hover:text-ink hover:underline"
              onClick={() => {
                setOnde("todos");
                setEstadoFiltro("todos");
              }}
            >
              Limpar
            </button>
          )}
        </div>
      )}

      <div className="mt-2">
        {loading ? (
          <Loading />
        ) : erro ? (
          <Empty title="Não foi possível carregar" detail={erro} />
        ) : semanas.length === 0 ? (
          <Empty
            icon={soPendentes ? CircleCheck : Trophy}
            tone={soPendentes ? "ok" : "neutral"}
            title={
              soMeus
                ? "Não estás escalado para nenhum jogo"
                : soPendentes
                  ? "Nada por fazer aqui"
                  : procura.trim() || filtrosAtivos > 0
                    ? "Nenhum jogo com esses filtros"
                    : vista === "proximos"
                      ? "Nenhum jogo marcado"
                      : "Nenhum jogo jogado"
            }
            detail={
              soMeus
                ? "Quando alguém te puser na ficha técnica de um jogo, recebes aviso e ele aparece aqui."
                : soPendentes
                  ? "Tudo em dia nesta vista."
                  : procura.trim() || filtrosAtivos > 0
                    ? "Experimenta outro nome, ou limpa os filtros."
                    : vista === "proximos"
                      ? "Os jogos marcam-se no calendário, e aparecem aqui."
                      : "Assim que houver jogos passados, aparecem aqui para preencheres a ficha."
            }
          />
        ) : (
          semanas.map((sem) => (
            <section key={sem.chave} className="mt-5 first:mt-3">
              <h2 className="mb-2 flex items-baseline justify-between px-1">
                <span className="text-meta font-semibold text-ink">{sem.label}</span>
                <span className="text-[11.5px] text-ink-4 tabular">
                  {sem.jogos.length} {sem.jogos.length === 1 ? "jogo" : "jogos"}
                </span>
              </h2>
              <Cartao className="overflow-hidden">
                <ul>
                  {sem.jogos.map((m) => (
                    <LinhaDeJogo key={m.id} jogo={paraLinha(m, agora)} />
                  ))}
                </ul>
              </Cartao>
            </section>
          ))
        )}
      </div>
    </>
  );
}

const semAcentos = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** A segunda-feira (à meia-noite) da semana de uma data. */
function segundaDe(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** "Esta semana", "Próxima semana", "Semana passada", ou "12 a 18 de outubro". */
function nomeDaSemana(seg: Date): string {
  const esta = segundaDe(new Date()).getTime();
  const dif = Math.round((seg.getTime() - esta) / (7 * 86_400_000));
  if (dif === 0) return "Esta semana";
  if (dif === 1) return "Próxima semana";
  if (dif === -1) return "Semana passada";
  const dom = new Date(seg.getFullYear(), seg.getMonth(), seg.getDate() + 6);
  const mes = (d: Date) => d.toLocaleDateString("pt-PT", { month: "long" });
  const ano = seg.getFullYear() !== new Date().getFullYear() ? ` de ${dom.getFullYear()}` : "";
  return seg.getMonth() === dom.getMonth()
    ? `${seg.getDate()} a ${dom.getDate()} de ${mes(dom)}${ano}`
    : `${seg.getDate()} de ${mes(seg)} a ${dom.getDate()} de ${mes(dom)}${ano}`;
}

/** A preparação de um jogo. Uma API ainda por atualizar não a manda: conta como vazia. */
const prepDe = (m: MatchListRow) => m.prep ?? { slots: 0, starters: 0, bench: 0 };


/**
 * O estado de um jogo, calculado do que existe.
 *
 * A mesma leitura da página do jogo: ninguém escolhe o estado à mão. Antes do
 * apito conta a preparação (convocatória e onze); depois, o resultado e a
 * análise.
 */
function estadoDoJogo(m: MatchListRow, agora: number): EstadoDoJogo {
  const inicio = new Date(m.startsAt).getTime();
  const fim = new Date(m.endsAt).getTime();
  if (m.status === "CANCELLED") return { chave: "cancelado", texto: "Cancelado", tom: "risco" };
  if (inicio <= agora && fim > agora) return { chave: "a-decorrer", texto: "A decorrer", tom: "vivo" };
  if (inicio <= agora) {
    if (m.ourScore === null) return { chave: "sem-resultado", texto: "Sem resultado", tom: "aviso" };
    return m.analysed ? { chave: "analisado", texto: "Analisado", tom: "neutro" } : { chave: "por-analisar", texto: "Por analisar", tom: "aviso" };
  }
  const onzeCompleto = prepDe(m).slots > 0 && prepDe(m).starters === prepDe(m).slots;
  if (m.submitted && onzeCompleto) return { chave: "pronto", texto: "Pronto", tom: "ok" };
  if (m.submitted || prepDe(m).starters > 0) return { chave: "em-preparacao", texto: "Em preparação", tom: "aviso" };
  return { chave: "por-preparar", texto: "Por preparar", tom: "neutro" };
}

/** Um jogo da lista, no formato que as vistas desenham. */
function paraLinha(m: MatchListRow, agora: number): JogoNaLista {
  const inicio = new Date(m.startsAt);
  const res = outcome(m);
  const prep = prepDe(m);
  return {
    id: m.id,
    equipa: m.teamName,
    adversario: m.opponent,
    emCasa: m.isHome,
    prova: m.competition?.label ?? null,
    inicio,
    local: m.venue,
    estado: estadoDoJogo(m, agora),
    resultado: res && m.ourScore !== null && m.theirScore !== null ? { nos: m.ourScore, eles: m.theirScore, desfecho: res } : null,
    // Os quatro passos da preparação, pela ordem em que se fazem.
    preparacao: [m.submitted, prep.slots > 0 && prep.starters === prep.slots, prep.bench > 0, Boolean(m.opponentKnown)],
    cancelado: m.status === "CANCELLED",
    passado: inicio.getTime() <= agora,
    funcao: m.myStaffRole,
  };
}
