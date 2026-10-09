import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { DataTable, Empty, Loading, Monogram, Pill, cx, type Column } from "@/components/primitives";
import { ResultCount, SearchInput, Segmented, Select, Toolbar } from "@/components/filters";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileSignature,
  FileText,
  Printer,
  RotateCcw,
  Stamp,
  TriangleAlert,
  Upload,
  X,
  type LucideIcon,
} from "@/lib/icons";
import { mostrarOk } from "@/lib/avisos";
import { shortDate } from "@/lib/format";
import {
  PASSOS,
  TIPOS,
  carregarAssinada,
  dataDoPasso,
  entregarPdf,
  gerarFolhas,
  getInscricoes,
  indiceDoPasso,
  mudarEstado,
  nomeDoTipo,
  passoDe,
  type Linha,
  type Lista,
  type Passo,
  type Tipo,
} from "@/lib/inscricoes";

/**
 * Inscrições — os boletins de inscrição na FPF (Modelo 2).
 *
 * ## O que a página responde
 *
 * Em que ponto está cada jogador: por gerar, folha gerada, assinada pelos
 * pais, entregue na associação, validada. O funil no topo diz quantos há em
 * cada passo e filtra a lista; a lista diz o resto.
 *
 * ## O que a plataforma preenche
 *
 * Do topo da folha até ao clube em que se inscreve: época, associação,
 * modalidade, tipo de boletim, licença, identificação do jogador e categoria.
 * As autorizações e as assinaturas são de quem assina. O que a ficha não tem
 * sai em branco, e a lista diz o quê antes de se gerar.
 *
 * ## Várias de uma vez
 *
 * Escolhem-se linhas e gera-se um PDF só, uma página por jogador, pronto a
 * imprimir. Os passos seguintes também se marcam em lote: quem entrega vinte
 * folhas na associação marca vinte de uma vez.
 */
export default function Inscricoes() {
  const [data, setData] = useState<Lista | null>(null);
  const [erro, setErro] = useState(false);
  const [seasonId, setSeasonId] = useState<string | undefined>(undefined);
  const [passo, setPasso] = useState<Passo | "all" | "missing">("all");
  const [sport, setSport] = useState("all");
  const [team, setTeam] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [gerar, setGerar] = useState<Linha[] | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [aMarcar, setAMarcar] = useState(false);
  const [retirar, setRetirar] = useState<Linha[] | null>(null);
  const [aDescarregar, setADescarregar] = useState(false);

  const carregar = useCallback(async (season?: string) => {
    try {
      setData(await getInscricoes(season));
      setErro(false);
    } catch {
      // O aviso já apareceu ao canto (`lib/http`).
      setErro(true);
    }
  }, []);

  useEffect(() => {
    void carregar(seasonId);
  }, [carregar, seasonId]);

  const chave = (l: Linha) => `${l.athleteId}|${l.sportId}`;
  const rows = data?.rows ?? [];

  const equipas = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (sport === "all" || r.sportId === sport) for (const t of r.teams) m.set(t.id, t.name);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "pt"));
  }, [rows, sport]);

  /* Os filtros que não são o do passo: o funil conta dentro deles. */
  const base = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("pt");
    return rows.filter(
      (r) =>
        (sport === "all" || r.sportId === sport) &&
        (team === "all" || r.teams.some((t) => t.id === team)) &&
        (!q || r.name.toLocaleLowerCase("pt").includes(q)),
    );
  }, [rows, sport, team, query]);

  const visiveis = useMemo(
    () =>
      base.filter((r) =>
        passo === "all" ? true : passo === "missing" ? r.missing.length > 0 && passoDe(r) === "PENDING" : passoDe(r) === passo,
      ),
    [base, passo],
  );

  if (erro) return <Empty title="Inscrições" detail="Não foi possível carregar as inscrições. Tente outra vez daqui a pouco." icon={TriangleAlert} />;
  if (!data) return <Loading />;

  if (!data.available || !data.season) {
    return (
      <>
        <PageHeader title="Inscrições" />
        <Empty title="Sem inscrições para mostrar" detail={data.reason} icon={FileSignature} />
      </>
    );
  }

  const season = data.season;
  const escolhidas = rows.filter((r) => selected.has(chave(r)));
  const nomeDaModalidade = (id: string) => data.sports.find((s) => s.id === id)?.name ?? "";
  const variasModalidades = data.sports.length > 1;
  const linhaAberta = aberta ? rows.find((r) => chave(r) === aberta) ?? null : null;

  const recarregar = async () => {
    await carregar(season.id);
  };

  /** Põe estes jogadores num passo qualquer. Devolve se correu bem. */
  async function aplicar(alvo: Linha[], p: Passo, license?: string): Promise<boolean> {
    if (alvo.length === 0) return false;
    setAMarcar(true);
    try {
      await mudarEstado(season.id, alvo, p, license);
      const rotulo = PASSOS[indiceDoPasso(p)].curto.toLowerCase();
      mostrarOk(alvo.length === 1 ? `Passou a «${rotulo}»` : `${alvo.length} jogadores passaram a «${rotulo}»`);
      if (alvo.length > 1) setSelected(new Set());
      await recarregar();
      return true;
    } catch {
      /* O erro já foi mostrado pelo cliente HTTP. */
      return false;
    } finally {
      setAMarcar(false);
    }
  }

  /**
   * As folhas já geradas dos escolhidos, num PDF só, sem mudar nada.
   *
   * Montam-se outra vez com o tipo de boletim e a categoria guardados na
   * inscrição; os dados do jogador são os de agora (uma ficha corrigida depois
   * de gerar sai corrigida). Os escolhidos ainda por gerar ficam de fora.
   */
  async function descarregar() {
    const alvo = escolhidas.filter((r) => r.registration);
    if (alvo.length === 0) return;
    setADescarregar(true);
    try {
      const r = await gerarFolhas({
        seasonId: season.id,
        items: alvo.map((l) => ({ athleteId: l.athleteId, sportId: l.sportId })),
        attach: false,
        register: false,
      });
      entregarPdf(r.pdf, r.filename);
    } catch {
      /* O erro já foi mostrado pelo cliente HTTP. */
    } finally {
      setADescarregar(false);
    }
  }

  /**
   * Voltar a "por gerar" retira a inscrição e as datas dos passos: pergunta-se
   * antes. Os outros passos mudam logo, e desfazem-se escolhendo o anterior.
   */
  function pedir(alvo: Linha[], p: Passo) {
    if (p === "PENDING" && alvo.some((r) => r.registration)) setRetirar(alvo);
    else void aplicar(alvo, p);
  }

  const columns: Column<Linha>[] = [
    {
      key: "name",
      header: "Jogador",
      primary: true,
      render: (r) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Monogram name={r.name} />
          <div className="min-w-0">
            {/* O nome leva à ficha do atleta; a inscrição abre-se ao lado do estado. */}
            <Link
              to={`/atletas/${r.athleteId}`}
              onClick={(e) => e.stopPropagation()}
              className="block truncate font-medium text-ink underline-offset-2 hover:underline"
            >
              {r.name}
            </Link>
            <div className="truncate text-meta text-ink-3">
              {r.birthdate.slice(0, 10).split("-").reverse().join("/")}
              {variasModalidades && ` · ${nomeDaModalidade(r.sportId)}`}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "team",
      header: "Equipa",
      hideBelow: "lg",
      render: (r) => <span className="text-ink-2">{r.teams.map((t) => t.name).join(", ") || "—"}</span>,
    },
    {
      key: "category",
      header: "Categoria",
      hideBelow: "md",
      render: (r) => (
        <span className="whitespace-nowrap text-ink-2">
          <span className="font-mono text-meta text-ink-4">{r.category}</span> {r.categoryLabel}
        </span>
      ),
    },
    {
      key: "kind",
      header: "Boletim",
      hideBelow: "lg",
      render: (r) => <span className="text-ink-2">{nomeDoTipo(r.kind)}</span>,
    },
    {
      key: "data",
      header: "Dados",
      render: (r) =>
        r.missing.length === 0 ? (
          <span className="inline-flex items-center gap-1 text-meta text-ok">
            <Check className="size-3.5" strokeWidth={2} />
            Completos
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-meta text-warn" title={`Em falta: ${r.missing.join(", ")}`}>
            <TriangleAlert className="size-3.5" strokeWidth={1.75} />
            {r.missing.length} em falta
          </span>
        ),
    },
    {
      key: "status",
      header: "Estado",
      render: (r) => (
        <EstadoDaLinha
          linha={r}
          ocupado={aMarcar}
          onMudar={data.canWrite ? (p) => pedir([r], p) : undefined}
          onAbrir={() => setAberta(chave(r))}
        />
      ),
    },
  ];

  /* Sem escolha, o botão do topo gera as que estão por gerar no filtro actual. */
  const porGerar = visiveis.filter((r) => passoDe(r) === "PENDING");

  return (
    <>
      <PageHeader title="Inscrições" subtitle={`Boletins de inscrição na FPF (Modelo 2) · Época ${season.label}`}>
        {data.seasons.length > 1 && (
          <Select
            label="Época"
            value={season.id}
            onChange={(v) => {
              setSelected(new Set());
              setSeasonId(v);
            }}
            options={data.seasons.map((s) => ({ value: s.id, label: `Época ${s.label}` }))}
          />
        )}
        {data.canWrite && (
          <button
            type="button"
            className="ctl-primary"
            disabled={selected.size === 0 && porGerar.length === 0}
            onClick={() => setGerar(selected.size > 0 ? escolhidas : porGerar)}
          >
            <FileSignature className="size-4" strokeWidth={1.75} />
            {selected.size > 0
              ? `Gerar ${selected.size} ${selected.size === 1 ? "folha" : "folhas"}`
              : porGerar.length > 0
                ? `Gerar ${porGerar.length} por gerar`
                : "Nada por gerar"}
          </button>
        )}
      </PageHeader>

      {data.club.missing.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-line bg-warn-soft px-5 py-3">
          <p className="min-w-0 text-body text-ink">
            <b className="font-semibold">Falta {juntar(data.club.missing)}.</b> Sem {data.club.missing.length === 1 ? "ele" : "eles"}, esse campo sai em branco
            em todas as folhas.
          </p>
          <Link to="/definicoes" className="ctl-outline shrink-0">
            Abrir Definições
            <ArrowRight className="size-3.5" strokeWidth={1.75} />
          </Link>
        </div>
      )}

      <Funil linhas={base} passo={passo} onPasso={(p) => setPasso((actual) => (actual === p ? "all" : p))} />

      <div className="panel mt-4">
        <Toolbar>
          <SearchInput value={query} onChange={setQuery} placeholder="Procurar jogador…" />
          {variasModalidades && (
            <Segmented
              label="Modalidade"
              value={sport}
              onChange={(v) => {
                setSport(v);
                setTeam("all");
              }}
              options={[{ value: "all", label: "Todas" }, ...data.sports.map((s) => ({ value: s.id, label: s.name }))]}
            />
          )}
          {equipas.length > 1 && (
            <Select
              label="Equipa"
              value={team}
              onChange={setTeam}
              options={[{ value: "all", label: "Todas as equipas" }, ...equipas.map(([id, name]) => ({ value: id, label: name }))]}
            />
          )}
          {/* O mesmo filtro do funil, onde se procura um filtro: mudar um muda o outro. */}
          <Select
            label="Estado"
            value={passo}
            onChange={setPasso}
            options={[
              { value: "all", label: "Todos os estados" },
              ...PASSOS.map((x) => ({ value: x.key, label: x.label })),
              { value: "missing", label: "Por gerar, com dados em falta" },
            ]}
          />
          <ResultCount n={visiveis.length} noun={["jogador", "jogadores"]} />
        </Toolbar>

        <DataTable
          columns={columns}
          rows={visiveis}
          keyOf={chave}
          onRowClick={(r) => setAberta(chave(r))}
          selection={data.canWrite ? { selected, onChange: setSelected } : undefined}
          empty={
            rows.length === 0 ? (
              <Empty
                title="Ninguém para inscrever"
                detail={`Não há atletas em equipas de futebol ou futsal na época ${season.label}.`}
                icon={FileSignature}
              />
            ) : (
              <Empty title="Sem resultados" detail="Nenhum jogador neste filtro." />
            )
          }
        />
      </div>

      {data.canWrite && selected.size > 0 && (
        <BarraDeEscolha
          n={selected.size}
          ocupado={aMarcar || aDescarregar}
          comFolha={escolhidas.filter((r) => r.registration).length}
          onGerar={() => setGerar(escolhidas)}
          onDescarregar={() => void descarregar()}
          onMudar={(p) => pedir(escolhidas, p)}
          onLimpar={() => setSelected(new Set())}
        />
      )}

      {gerar && (
        <GerarDialog
          linhas={gerar}
          seasonId={season.id}
          clubeEmFalta={data.club.missing}
          onClose={() => setGerar(null)}
          onDone={async () => {
            setGerar(null);
            setSelected(new Set());
            await recarregar();
          }}
        />
      )}

      {linhaAberta && (
        <InscricaoDialog
          linha={linhaAberta}
          modalidade={variasModalidades ? nomeDaModalidade(linhaAberta.sportId) : null}
          canWrite={data.canWrite}
          ocupado={aMarcar}
          onClose={() => setAberta(null)}
          onGerar={() => setGerar([linhaAberta])}
          onMudar={(p, license) => (p === "PENDING" ? (setRetirar([linhaAberta]), Promise.resolve(false)) : aplicar([linhaAberta], p, license))}
          onChanged={recarregar}
        />
      )}

      {retirar && (
        <ConfirmDialog
          title={retirar.length === 1 ? `Voltar ${retirar[0].name} a «por gerar»?` : `Voltar ${retirar.length} jogadores a «por gerar»?`}
          confirmLabel="Voltar a por gerar"
          onClose={() => setRetirar(null)}
          onConfirm={async () => {
            if (await aplicar(retirar, "PENDING")) {
              setRetirar(null);
              setAberta(null);
            }
          }}
        >
          A inscrição sai, com as datas dos passos. As folhas que estejam nos documentos do atleta ficam.
        </ConfirmDialog>
      )}
    </>
  );
}

const juntar = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`);

/* -------------------------------------------------------------------------- */
/* O funil                                                                     */
/* -------------------------------------------------------------------------- */

const ICONE_DO_PASSO: Record<Passo, LucideIcon> = {
  PENDING: FileText,
  GENERATED: Printer,
  SIGNED: FileSignature,
  SUBMITTED: Stamp,
  DONE: Check,
};

/**
 * Quantos jogadores em cada passo, e o filtro da lista.
 *
 * Cinco colunas lado a lado, pela ordem em que a folha anda: lê-se da esquerda
 * para a direita como o caminho que é. A barra por baixo de cada uma é a parte
 * do plantel que lá está. Os dados em falta vão à parte: não são um passo, são
 * o que impede a primeira folha de sair completa.
 */
function Funil({ linhas, passo, onPasso }: { linhas: Linha[]; passo: Passo | "all" | "missing"; onPasso: (p: Passo | "missing") => void }) {
  const total = linhas.length;
  const conta = (p: Passo) => linhas.filter((l) => passoDe(l) === p).length;
  const emFalta = linhas.filter((l) => l.missing.length > 0 && passoDe(l) === "PENDING").length;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="panel grid grid-cols-5 overflow-hidden max-md:grid-cols-2 max-md:[&>*:last-child]:col-span-2">
        {PASSOS.map((p, i) => {
          const n = conta(p.key);
          const on = passo === p.key;
          const Icone = ICONE_DO_PASSO[p.key];
          const feito = p.key === "DONE";
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={on}
              onClick={() => onPasso(p.key)}
              className={cx(
                "group relative min-w-0 px-4 py-3.5 text-left transition-colors duration-[120ms]",
                i > 0 && "md:border-l md:border-line",
                "max-md:border-b max-md:border-line",
                on ? "bg-signal-soft" : "hover:bg-sunken/60",
              )}
            >
              <div className={cx("flex items-center gap-1.5 text-meta", on ? "text-signal-ink" : "text-ink-3")}>
                <Icone className="size-3.5 shrink-0" strokeWidth={1.75} />
                <span className="truncate">{p.label}</span>
              </div>
              <div className={cx("mt-1 text-[26px] leading-none font-semibold tracking-[-0.02em] tabular", n === 0 ? "text-ink-4" : feito ? "text-ok" : "text-ink")}>
                {n}
              </div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-sunken">
                <div
                  className={cx("h-full rounded-full transition-[width] duration-300", feito ? "bg-ok" : on ? "bg-signal" : "bg-ink-3")}
                  style={{ width: `${total ? (n / total) * 100 : 0}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        aria-pressed={passo === "missing"}
        onClick={() => onPasso("missing")}
        disabled={emFalta === 0}
        className={cx(
          "panel flex min-w-[11rem] items-center gap-3 px-4 py-3.5 text-left transition-colors duration-[120ms] disabled:cursor-default",
          passo === "missing" ? "bg-warn-soft" : emFalta > 0 && "hover:bg-sunken/60",
        )}
      >
        <span className={cx("inline-flex size-9 shrink-0 items-center justify-center rounded-full", emFalta ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")}>
          {emFalta ? <TriangleAlert className="size-4" strokeWidth={1.75} /> : <Check className="size-4" strokeWidth={2} />}
        </span>
        <span className="min-w-0">
          <span className="block text-[20px] leading-none font-semibold tabular text-ink">{emFalta}</span>
          <span className="mt-1 block text-meta text-ink-3">por gerar com dados em falta</span>
        </span>
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* O estado de uma linha                                                       */
/* -------------------------------------------------------------------------- */

/**
 * O estado de uma linha: quatro traços (gerada, assinada, entregue, validada),
 * o passo num seletor, e a seta que abre a inscrição.
 *
 * O seletor vai para **qualquer** passo, e não só para o seguinte: quem
 * entregou as folhas em papel antes de a plataforma existir marca-as logo
 * como entregues. Os cliques aqui não chegam à linha (que escolhe para o lote).
 */
function EstadoDaLinha({
  linha,
  ocupado,
  onMudar,
  onAbrir,
}: {
  linha: Linha;
  ocupado: boolean;
  /** Ausente para quem só lê: aí o passo é texto. */
  onMudar?: (p: Passo) => void;
  onAbrir: () => void;
}) {
  const p = passoDe(linha);
  const i = indiceDoPasso(p);
  const data = dataDoPasso(linha.registration, p);
  const feito = p === "DONE";
  const cor = feito ? "text-ok" : p === "PENDING" ? "text-ink-3" : "text-ink";

  return (
    <div className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex gap-0.5" aria-hidden>
        {[1, 2, 3, 4].map((k) => (
          <span key={k} className={cx("h-3.5 w-1 rounded-full", k <= i ? (feito ? "bg-ok" : "bg-ink-2") : "bg-line-strong")} />
        ))}
      </div>
      <div className="min-w-0 leading-tight">
        {onMudar ? (
          <span className="relative inline-flex items-center">
            <select
              aria-label={`Estado da inscrição de ${linha.name}`}
              value={p}
              disabled={ocupado}
              onChange={(e) => onMudar(e.target.value as Passo)}
              className={cx(
                "h-7 cursor-pointer appearance-none rounded-[6px] border border-transparent bg-transparent pr-6 pl-1.5 -ml-1.5 text-meta font-medium whitespace-nowrap",
                "transition-colors duration-[120ms] hover:border-line hover:bg-surface focus:border-line-strong focus:outline-none disabled:opacity-50",
                cor,
              )}
            >
              {PASSOS.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.curto}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1.5 size-3.5 text-ink-4" strokeWidth={1.75} />
          </span>
        ) : (
          <div className={cx("text-meta font-medium whitespace-nowrap", cor)}>{PASSOS[i].curto}</div>
        )}
        {data && <div className="text-[11px] text-ink-4">{shortDate(new Date(data))}</div>}
      </div>
      <button
        type="button"
        onClick={onAbrir}
        aria-label={`Abrir a inscrição de ${linha.name}`}
        title="Abrir a inscrição"
        className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-[6px] text-ink-4 transition-colors duration-[120ms] hover:bg-sunken hover:text-ink"
      >
        <ChevronRight className="size-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* A barra da escolha                                                          */
/* -------------------------------------------------------------------------- */

/**
 * O que se faz às linhas escolhidas: gerar as folhas, ou pô-las todas num
 * passo de uma vez. Encostada ao fundo, como a dos sócios (`BulkBar`).
 */
function BarraDeEscolha({
  n,
  ocupado,
  comFolha,
  onGerar,
  onDescarregar,
  onMudar,
  onLimpar,
}: {
  n: number;
  ocupado: boolean;
  /** Quantos dos escolhidos já têm folha gerada: só esses se descarregam. */
  comFolha: number;
  onGerar: () => void;
  onDescarregar: () => void;
  onMudar: (p: Passo) => void;
  onLimpar: () => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 max-md:bottom-[calc(76px+env(safe-area-inset-bottom))]">
      <div className="scroll-x-clean pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-full border border-line bg-ink px-3 py-2 text-surface shadow-[var(--shadow-pop)]">
        <span className="pl-1.5 pr-1 text-body font-medium whitespace-nowrap tabular">
          {n} {n === 1 ? "jogador" : "jogadores"}
        </span>
        <button
          type="button"
          onClick={onGerar}
          disabled={ocupado}
          className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-meta font-semibold whitespace-nowrap text-ink hover:bg-surface/90 disabled:opacity-40"
        >
          <FileSignature className="size-3.5" strokeWidth={1.75} />
          Gerar folhas
        </button>
        {comFolha > 0 && (
          <button
            type="button"
            onClick={onDescarregar}
            disabled={ocupado}
            title={comFolha < n ? `Só os ${comFolha} com folha gerada` : undefined}
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-meta font-semibold whitespace-nowrap text-surface hover:bg-white/20 disabled:opacity-40"
          >
            <Download className="size-3.5" strokeWidth={1.75} />
            {/* Só os que têm folha: com escolhidos por gerar à mistura, o número diz quantos saem. */}
            Descarregar {comFolha < n ? `${comFolha} ${comFolha === 1 ? "folha" : "folhas"}` : comFolha === 1 ? "folha" : "folhas"}
          </button>
        )}
        {/* Um passo para todos: o valor fica sempre no rótulo, para poder escolher o mesmo duas vezes. */}
        <span className="relative inline-flex shrink-0 items-center">
          <select
            aria-label="Mudar o estado dos escolhidos"
            value=""
            disabled={ocupado}
            onChange={(e) => e.target.value && onMudar(e.target.value as Passo)}
            className="h-[30px] cursor-pointer appearance-none rounded-full bg-white/10 pr-8 pl-3 text-meta font-semibold text-surface hover:bg-white/20 focus:outline-none disabled:opacity-40 [&>option]:text-ink"
          >
            <option value="" disabled>
              Mudar estado para…
            </option>
            {PASSOS.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 size-3.5 text-surface/70" strokeWidth={1.75} />
        </span>
        <button
          type="button"
          onClick={onLimpar}
          aria-label="Limpar escolha"
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-surface/70 hover:bg-white/10 hover:text-surface"
        >
          <X className="size-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Gerar                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Gerar as folhas escolhidas.
 *
 * O tipo de boletim vem proposto por jogador (revalidação para quem já teve
 * licença, primeira inscrição para os outros) e pode trocar-se para todos de
 * uma vez. Antes de gerar diz-se o que vai acontecer: quantas saem com campos
 * em branco, e quantas já iam mais à frente e voltam a "gerada".
 */
function GerarDialog({
  linhas,
  seasonId,
  clubeEmFalta,
  onClose,
  onDone,
}: {
  linhas: Linha[];
  seasonId: string;
  clubeEmFalta: string[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [tipo, setTipo] = useState<Tipo | "proposto">("proposto");
  const [anexar, setAnexar] = useState(true);
  const [aGerar, setAGerar] = useState<"ver" | "gerar" | null>(null);

  const emFalta = linhas.filter((l) => l.missing.length > 0);
  const adiantadas = linhas.filter((l) => l.registration && l.registration.status !== "GENERATED");
  const itens = () => linhas.map((l) => ({ athleteId: l.athleteId, sportId: l.sportId, ...(tipo !== "proposto" ? { kind: tipo } : {}) }));
  const n = linhas.length;

  async function ver() {
    // Aberto já, no clique: depois do pedido o browser bloqueava-o.
    const separador = window.open("", "_blank");
    setAGerar("ver");
    try {
      const r = await gerarFolhas({ seasonId, items: itens(), attach: false, register: false });
      entregarPdf(r.pdf, r.filename, separador);
    } catch {
      separador?.close();
    } finally {
      setAGerar(null);
    }
  }

  async function gerar() {
    setAGerar("gerar");
    try {
      const r = await gerarFolhas({ seasonId, items: itens(), attach: anexar, register: true });
      entregarPdf(r.pdf, r.filename);
      mostrarOk(r.count === 1 ? "Folha gerada" : `${r.count} folhas geradas`);
      await onDone();
    } catch {
      /* O erro já foi mostrado pelo cliente HTTP. */
    } finally {
      setAGerar(null);
    }
  }

  return (
    <Dialog
      title={n === 1 ? `Gerar a folha de ${linhas[0].name}` : `Gerar ${n} folhas`}
      subtitle="Modelo 2 da FPF · um PDF, uma página por jogador"
      icon={<FileSignature className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={520}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <button type="button" className="ctl-ghost" onClick={() => void ver()} disabled={aGerar !== null}>
            <Eye className="size-3.5" strokeWidth={1.75} />
            {aGerar === "ver" ? "A preparar…" : "Pré-visualizar"}
          </button>
          <div className="flex gap-2">
            <button type="button" className="ctl-outline" onClick={onClose} disabled={aGerar !== null}>
              Cancelar
            </button>
            <button type="button" className="ctl-primary" onClick={() => void gerar()} disabled={aGerar !== null}>
              <Download className="size-3.5" strokeWidth={1.75} />
              {aGerar === "gerar" ? "A gerar…" : n === 1 ? "Gerar folha" : `Gerar ${n} folhas`}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <DialogField label="Tipo de boletim">
          <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo | "proposto")} className={dialogInputClass}>
            <option value="proposto">O proposto para cada jogador</option>
            {TIPOS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label} {n > 1 ? "(todos)" : ""}
              </option>
            ))}
          </select>
        </DialogField>
        {tipo === "proposto" && n > 1 && (
          <p className="-mt-2 text-meta text-ink-3">
            {contarTipos(linhas)}. Quem já teve licença nesta modalidade vai como revalidação.
          </p>
        )}

        {/* A caixa fora do rótulo: nada tocável dentro de `<label>` (ver `check:toque`). */}
        <div className="flex items-start gap-3 rounded-[10px] border border-line px-3.5 py-3">
          <input
            id="inscricoes-anexar"
            type="checkbox"
            checked={anexar}
            onChange={(e) => setAnexar(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--color-signal-strong)]"
          />
          <div className="min-w-0">
            <label htmlFor="inscricoes-anexar" className="block cursor-pointer text-body font-medium text-ink">
              Anexar aos documentos de cada jogador
            </label>
            <p className="mt-0.5 text-meta text-ink-3">
              Cada folha fica no separador Documentos da ficha, num documento da inscrição. É lá que depois fica também a cópia assinada.
            </p>
          </div>
        </div>

        {(clubeEmFalta.length > 0 || emFalta.length > 0 || adiantadas.length > 0) && (
          <ul className="space-y-2 rounded-[10px] bg-sunken px-3.5 py-3 text-meta text-ink-2">
            {clubeEmFalta.length > 0 && (
              <Aviso>
                Falta {juntar(clubeEmFalta)} nas Definições: sai em branco em todas as folhas.
              </Aviso>
            )}
            {emFalta.length > 0 && (
              <Aviso>
                {emFalta.length === 1 ? `${emFalta[0].name} tem` : `${emFalta.length} jogadores têm`} dados em falta na ficha. Esses campos saem em
                branco, para preencher à mão.
              </Aviso>
            )}
            {adiantadas.length > 0 && (
              <Aviso>
                {adiantadas.length === 1 ? `A inscrição de ${adiantadas[0].name} já ia` : `${adiantadas.length} inscrições já iam`} mais à frente.
                Uma folha nova tem de ser assinada outra vez: {adiantadas.length === 1 ? "volta" : "voltam"} a «gerada».
              </Aviso>
            )}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

function Aviso({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" strokeWidth={1.75} />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function contarTipos(linhas: Linha[]): string {
  const primeiras = linhas.filter((l) => l.kind === "FIRST").length;
  const revalidacoes = linhas.filter((l) => l.kind === "RENEWAL").length;
  const outras = linhas.length - primeiras - revalidacoes;
  const partes = [
    primeiras && `${primeiras} ${primeiras === 1 ? "primeira inscrição" : "primeiras inscrições"}`,
    revalidacoes && `${revalidacoes} ${revalidacoes === 1 ? "revalidação" : "revalidações"}`,
    outras && `${outras} ${outras === 1 ? "transferência" : "transferências"}`,
  ].filter(Boolean) as string[];
  return juntar(partes);
}

/* -------------------------------------------------------------------------- */
/* Uma inscrição                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A inscrição de um jogador: o que vai na folha, o que falta, e os passos.
 *
 * Os passos são uma linha do tempo em que cada um se pode escolher: carregar
 * num passo põe a inscrição lá, para a frente ou para trás. Carregar a folha
 * assinada marca "assinada" sozinho. Validar pode levar o n.º de licença, que
 * vai para a ficha do atleta.
 */
function InscricaoDialog({
  linha,
  modalidade,
  canWrite,
  ocupado: aMudar,
  onClose,
  onGerar,
  onMudar,
  onChanged,
}: {
  linha: Linha;
  modalidade: string | null;
  canWrite: boolean;
  ocupado: boolean;
  onClose: () => void;
  onGerar: () => void;
  onMudar: (p: Passo, license?: string) => Promise<boolean>;
  onChanged: () => Promise<void>;
}) {
  const r = linha.registration;
  const p = passoDe(linha);
  const i = indiceDoPasso(p);
  const [aCarregar, setACarregar] = useState(false);
  const [licenca, setLicenca] = useState(linha.license ?? "");
  const ficheiro = useRef<HTMLInputElement>(null);
  const ocupado = aMudar || aCarregar;

  async function carregar(f: File) {
    if (!r) return;
    setACarregar(true);
    try {
      await carregarAssinada(r.id, f);
      mostrarOk("Folha assinada guardada nos documentos");
      await onChanged();
    } catch {
      /* O erro já foi mostrado pelo cliente HTTP. */
    } finally {
      setACarregar(false);
    }
  }

  return (
    <Dialog
      title={linha.name}
      subtitle={[modalidade, linha.teams.map((t) => t.name).join(", "), `${linha.category} · ${linha.categoryLabel}`].filter(Boolean).join(" · ")}
      icon={<FileSignature className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={540}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Link to={`/atletas/${linha.athleteId}`} className="ctl-ghost">
            Abrir a ficha
            <ExternalLink className="size-3.5" strokeWidth={1.75} />
          </Link>
          {canWrite && (
            <button type="button" className={r ? "ctl-outline" : "ctl-primary"} onClick={onGerar} disabled={ocupado}>
              <FileSignature className="size-3.5" strokeWidth={1.75} />
              {r ? "Gerar outra vez" : "Gerar folha"}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-5 px-5 py-4">
        {/* O que vai na folha. */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-body sm:grid-cols-3">
          <Facto label="Boletim" valor={nomeDoTipo(r?.kind ?? linha.kind)} />
          <Facto label="Categoria" valor={`${linha.category} · ${linha.categoryLabel}`} />
          <Facto label="Licença FPF" valor={linha.license ?? "—"} mono />
        </dl>

        {linha.missing.length > 0 ? (
          <div className="rounded-[10px] border border-line bg-warn-soft px-3.5 py-3">
            <p className="flex items-center gap-1.5 text-body font-medium text-ink">
              <TriangleAlert className="size-4 text-warn" strokeWidth={1.75} />
              Em falta na ficha
            </p>
            <p className="mt-1 text-meta text-ink-2">
              {juntar(linha.missing)[0].toUpperCase() + juntar(linha.missing).slice(1)}. Saem em branco na folha.{" "}
              <Link to={`/atletas/${linha.athleteId}`} className="font-medium text-ink underline underline-offset-2">
                Corrigir na ficha
              </Link>
            </p>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-meta text-ok">
            <Check className="size-3.5" strokeWidth={2} />
            A ficha tem tudo o que a folha pede.
          </p>
        )}

        {/* Os passos. Cada um escolhe-se: põe a inscrição lá. */}
        <div>
          {canWrite && <p className="mb-2 text-meta text-ink-3">Carrega num passo para pôr a inscrição nele.</p>}
          <ol className="relative">
            {PASSOS.slice(1).map((passo, k) => {
              const idx = k + 1;
              const feito = idx <= i;
              const actual = idx === i;
              const data = dataDoPasso(r, passo.key);
              const conteudo = (
                <>
                  <span
                    className={cx(
                      "relative z-[1] inline-flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors duration-[120ms]",
                      feito ? (passo.key === "DONE" ? "border-ok bg-ok text-white" : "border-ink-2 bg-ink-2 text-surface") : "border-line-strong bg-surface text-ink-4",
                    )}
                  >
                    {feito ? <Check className="size-3.5" strokeWidth={2.5} /> : <span className="text-[11px] font-semibold">{idx}</span>}
                  </span>
                  <span className="min-w-0 pt-0.5 text-left">
                    <span className={cx("block text-body", feito ? "font-medium text-ink" : "text-ink-3")}>
                      {passo.label}
                      {actual && (
                        <span className="ml-2">
                          <Pill tone={passo.key === "DONE" ? "ok" : "neutral"}>agora</Pill>
                        </span>
                      )}
                    </span>
                    {data && (
                      <span className="block text-meta text-ink-3">
                        {shortDate(new Date(data))} {new Date(data).getFullYear()}
                        {passo.key === "GENERATED" && r?.generatedByName && ` · ${r.generatedByName}`}
                      </span>
                    )}
                  </span>
                </>
              );
              return (
                <li key={passo.key} className="relative pb-1 last:pb-0">
                  {idx < 4 && <span className={cx("absolute top-8 left-[19px] h-[calc(100%-1.5rem)] w-px", idx < i ? "bg-ink-2" : "bg-line")} aria-hidden />}
                  {canWrite && !actual ? (
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => void onMudar(passo.key, passo.key === "DONE" ? licenca.trim() || undefined : undefined)}
                      className="flex w-full gap-3 rounded-[10px] px-2 py-1.5 transition-colors duration-[120ms] hover:bg-sunken disabled:opacity-50"
                    >
                      {conteudo}
                    </button>
                  ) : (
                    <div className="flex gap-3 px-2 py-1.5">{conteudo}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        {canWrite && (
          <div className="space-y-3 border-t border-line pt-4">
            {p !== "DONE" && (
              <DialogField label="N.º de licença da FPF" hint="opcional; ao validar, fica na ficha do atleta, nesta modalidade e época">
                <input value={licenca} onChange={(e) => setLicenca(e.target.value)} maxLength={40} className={cx(dialogInputClass, "font-mono")} />
              </DialogField>
            )}
            <div className="flex flex-wrap gap-2">
              {p !== "DONE" && (
                <button type="button" className="ctl-primary" disabled={ocupado} onClick={() => void onMudar("DONE", licenca.trim() || undefined)}>
                  <Check className="size-3.5" strokeWidth={2} />
                  Validar
                </button>
              )}
              {r && (
                <>
                  <button type="button" className="ctl-outline" disabled={ocupado} onClick={() => ficheiro.current?.click()}>
                    <Upload className="size-3.5" strokeWidth={1.75} />
                    {aCarregar ? "A carregar…" : "Carregar folha assinada"}
                  </button>
                  <input
                    ref={ficheiro}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void carregar(f);
                    }}
                  />
                </>
              )}
            </div>
            {r && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-meta">
                {r.documentId ? (
                  <Link to={`/atletas/${linha.athleteId}?separador=documentos`} className="inline-flex items-center gap-1 text-ink-2 hover:text-ink">
                    <FileText className="size-3.5" strokeWidth={1.75} />
                    Ver nos documentos do atleta
                  </Link>
                ) : (
                  <span className="text-ink-4">A folha não foi anexada aos documentos.</span>
                )}
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-ink-4 hover:text-risk"
                  disabled={ocupado}
                  onClick={() => void onMudar("PENDING")}
                >
                  <RotateCcw className="size-3.5" strokeWidth={1.75} />
                  Voltar a «por gerar»
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Facto({ label, valor, mono }: { label: string; valor: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-meta text-ink-3">{label}</dt>
      <dd className={cx("mt-0.5 truncate text-ink", mono && "font-mono")}>{valor}</dd>
    </div>
  );
}
