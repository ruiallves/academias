import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Empty, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { SaveVeil, useSaving } from "@/components/Busy";
import { dialogInputClass } from "@/components/Dialog";
import { ChevronRight, ExternalLink, Film, Plus, Shield, Trash2 } from "@/lib/icons";
import {
  saveMatchReport,
  saveOpponentReport,
  type MatchDetail,
  type MatchReport,
  type OpponentHistoryRow,
  type OpponentReport,
  type VideoLink,
} from "@/lib/matches";

/**
 * Os relatórios de um jogo: o do jogo e o do adversário.
 *
 * ## Duas perguntas, dois painéis
 *
 * "Como correu?" e "como é que eles jogam?" são perguntas diferentes, com
 * leitores diferentes. O relatório do jogo lê-o o treinador na segunda-feira,
 * para preparar o treino. O do adversário lê-o quem for jogar contra eles
 * daqui a quatro meses, e é por isso que ele aparece **antes** do jogo
 * seguinte, no `OpponentHistoryPanel`.
 *
 * ## Campos e não um texto só
 *
 * Um campo "Relatório" em branco é uma folha em branco, e uma folha em branco
 * adia-se. Perguntas curtas respondem-se: o que correu bem, o que correu mal, o
 * que se vai trabalhar. Nenhuma é obrigatória, e um relatório com uma linha só
 * vale mais do que nenhum.
 *
 * ## Grava-se inteiro
 *
 * Como a ficha: um botão no fim, o painel inteiro de cada vez. Um pedido por
 * campo dava um relatório meio gravado quando a rede falhasse a meio de uma
 * frase.
 */

/** Os textos do relatório do jogo; os vídeos vivem à parte. */
type TextosJogo = Omit<MatchReport, "updatedAt" | "authorName" | "videos">;

const VAZIO_JOGO: TextosJogo = {
  summary: null,
  positives: null,
  negatives: null,
  toImprove: null,
  difficulties: null,
};

const VAZIO_ADVERSARIO: Omit<OpponentReport, "updatedAt" | "authorName"> = {
  formation: null,
  style: null,
  strengths: null,
  weaknesses: null,
  keyPlayers: null,
  setPieces: null,
  notes: null,
};

/* ========================================================================== */
/* O relatório do jogo                                                         */
/* ========================================================================== */

export function MatchReportPanel({
  match,
  mayRecord,
  onSaved,
}: {
  match: MatchDetail;
  mayRecord: boolean;
  onSaved: () => void;
}) {
  const gravado = match.report;
  const [texto, setTexto] = useState<TextosJogo>(() => ({ ...VAZIO_JOGO, ...textosDe(gravado) }));
  const [videos, setVideos] = useState<VideoLink[]>(() => gravado?.videos ?? []);
  const [aberto, setAberto] = useState(Boolean(gravado));
  const [erro, setErro] = useState<string | null>(null);
  const { estado, gravar: correr, aGravar: busy } = useSaving();

  useEffect(() => {
    setTexto({ ...VAZIO_JOGO, ...textosDe(match.report) });
    setVideos(match.report?.videos ?? []);
    if (match.report) setAberto(true);
  }, [match.report]);

  const set = (campo: keyof TextosJogo, valor: string) => setTexto((t) => ({ ...t, [campo]: valor }));

  const mudou =
    CAMPOS_JOGO.some(([campo]) => (texto[campo] ?? "").trim() !== (gravado?.[campo] ?? "").trim()) ||
    JSON.stringify(videos.filter((v) => v.url.trim())) !== JSON.stringify(gravado?.videos ?? []);

  const temAlgo = CAMPOS_JOGO.some(([campo]) => (texto[campo] ?? "").trim()) || videos.some((v) => v.url.trim());

  async function gravar() {
    setErro(null);
    try {
      await correr(async () => {
        await saveMatchReport(match.id, {
          summary: texto.summary,
          positives: texto.positives,
          negatives: texto.negatives,
          toImprove: texto.toImprove,
          difficulties: texto.difficulties,
          videos: videos.filter((v) => v.url.trim()).map((v) => ({ url: v.url.trim(), label: v.label })),
        });
        onSaved();
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar o relatório.");
    }
  }

  if (!mayRecord && !gravado) return null;

  if (!aberto) {
    return (
      <Panel>
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="flex min-h-11 w-full items-center justify-between px-5 py-3 text-left text-body text-ink-3 transition-colors hover:text-ink"
        >
          <span>Escrever o relatório do jogo</span>
          <ChevronRight className="size-4" strokeWidth={1.75} />
        </button>
      </Panel>
    );
  }

  return (
    <Panel>
      <SaveVeil estado={estado}>
        <PanelHead
          title="Relatório do jogo"
          hint={gravado ? `por ${gravado.authorName ?? "alguém"} · ${quando(gravado.updatedAt)}` : "por escrever"}
        />

        {mayRecord ? (
          <div className="space-y-4 px-5 py-4">
            {CAMPOS_JOGO.map(([campo, rotulo, dica]) => (
              <Campo key={campo} label={rotulo}>
                <textarea
                  value={texto[campo] ?? ""}
                  onChange={(e) => set(campo, e.target.value)}
                  rows={campo === "summary" ? 4 : 3}
                  placeholder={dica}
                  maxLength={4000}
                  className={cx(dialogInputClass, "h-auto resize-y py-2 leading-relaxed")}
                />
              </Campo>
            ))}

            <Campo label="Vídeos">
              <Videos videos={videos} onChange={setVideos} />
            </Campo>
          </div>
        ) : (
          <Leitura>
            {CAMPOS_JOGO.map(([campo, rotulo]) =>
              gravado?.[campo] ? <Bloco key={campo} titulo={rotulo} texto={gravado[campo]!} /> : null,
            )}
            {gravado && gravado.videos.length > 0 && (
              <div>
                <p className="text-meta font-medium text-ink-3">Vídeos</p>
                <ul className="mt-1 space-y-1">
                  {gravado.videos.map((v) => (
                    <li key={v.url}>
                      <LigacaoVideo v={v} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Leitura>
        )}

        {mayRecord && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
            <button
              type="button"
              className="ctl-primary h-11"
              disabled={busy || !mudou || !temAlgo}
              onClick={() => void gravar()}
            >
              Gravar relatório
            </button>
            {mudou && temAlgo && !busy && <span className="text-meta font-medium text-warn">Há alterações por gravar.</span>}
            {!gravado && (
              <button type="button" className="ctl-ghost ml-auto" onClick={() => setAberto(false)}>
                Fechar
              </button>
            )}
            {erro && (
              <span role="alert" className="w-full text-meta text-risk">
                {erro}
              </span>
            )}
          </div>
        )}
      </SaveVeil>
    </Panel>
  );
}

function textosDe(r: MatchReport | null): Partial<TextosJogo> {
  if (!r) return {};
  return { summary: r.summary, positives: r.positives, negatives: r.negatives, toImprove: r.toImprove, difficulties: r.difficulties };
}

const CAMPOS_JOGO: [keyof TextosJogo, string, string][] = [
  ["summary", "Como correu", "A leitura geral do jogo, em duas ou três frases."],
  ["positives", "Pontos positivos", "O que se fez bem e vale a pena repetir."],
  ["negatives", "Pontos negativos", "O que correu mal."],
  ["toImprove", "A melhorar", "O que se vai trabalhar no treino a seguir."],
  ["difficulties", "Dificuldades", "O que custou: o campo, o calor, a falta de banco, a arbitragem."],
];

/* ========================================================================== */
/* O adversário                                                                */
/* ========================================================================== */

export function OpponentReportPanel({
  match,
  mayRecord,
  onSaved,
}: {
  match: MatchDetail;
  mayRecord: boolean;
  onSaved: () => void;
}) {
  const gravado = match.opponentReport;
  const [texto, setTexto] = useState(() => ({ ...VAZIO_ADVERSARIO, ...(gravado ?? {}) }));
  const [aberto, setAberto] = useState(Boolean(gravado));
  const [erro, setErro] = useState<string | null>(null);
  const { estado, gravar: correr, aGravar: busy } = useSaving();

  useEffect(() => {
    setTexto({ ...VAZIO_ADVERSARIO, ...(match.opponentReport ?? {}) });
    if (match.opponentReport) setAberto(true);
  }, [match.opponentReport]);

  const set = (campo: keyof typeof VAZIO_ADVERSARIO, valor: string) =>
    setTexto((t) => ({ ...t, [campo]: valor }));

  const mudou = CAMPOS_ADVERSARIO.some(([campo]) => (texto[campo] ?? "").trim() !== (gravado?.[campo] ?? "").trim());
  const temAlgo = CAMPOS_ADVERSARIO.some(([campo]) => (texto[campo] ?? "").trim());

  async function gravar() {
    setErro(null);
    try {
      await correr(async () => {
        await saveOpponentReport(match.id, texto);
        onSaved();
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar o relatório do adversário.");
    }
  }

  if (!mayRecord && !gravado) return null;

  if (!aberto) {
    return (
      <Panel>
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="flex min-h-11 w-full items-center justify-between px-5 py-3 text-left text-body text-ink-3 transition-colors hover:text-ink"
        >
          <span className="inline-flex items-center gap-2">
            <Shield className="size-4" strokeWidth={1.75} />
            Registar como jogou o {match.opponent}
          </span>
          <ChevronRight className="size-4" strokeWidth={1.75} />
        </button>
      </Panel>
    );
  }

  return (
    <Panel>
      <SaveVeil estado={estado}>
        <PanelHead
          title={`Adversário · ${match.opponent}`}
          hint={gravado ? `por ${gravado.authorName ?? "alguém"} · ${quando(gravado.updatedAt)}` : "por registar"}
        />

        {mayRecord ? (
          <div className="space-y-4 px-5 py-4">
            <Campo label="Formação">
              <input
                value={texto.formation ?? ""}
                onChange={(e) => set("formation", e.target.value)}
                placeholder="4-3-3"
                maxLength={40}
                className={cx(dialogInputClass, "w-40")}
              />
            </Campo>
            {CAMPOS_ADVERSARIO.filter(([campo]) => campo !== "formation").map(([campo, rotulo, dica]) => (
              <Campo key={campo} label={rotulo}>
                <textarea
                  value={texto[campo] ?? ""}
                  onChange={(e) => set(campo, e.target.value)}
                  rows={3}
                  placeholder={dica}
                  maxLength={4000}
                  className={cx(dialogInputClass, "h-auto resize-y py-2 leading-relaxed")}
                />
              </Campo>
            ))}
          </div>
        ) : (
          <Leitura>
            <RelatorioDoAdversario r={gravado!} />
          </Leitura>
        )}

        {mayRecord && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
            <button
              type="button"
              className="ctl-primary h-11"
              disabled={busy || !mudou || !temAlgo}
              onClick={() => void gravar()}
            >
              Gravar
            </button>
            {mudou && temAlgo && !busy && <span className="text-meta font-medium text-warn">Há alterações por gravar.</span>}
            {!gravado && (
              <button type="button" className="ctl-ghost ml-auto" onClick={() => setAberto(false)}>
                Fechar
              </button>
            )}
            {erro && (
              <span role="alert" className="w-full text-meta text-risk">
                {erro}
              </span>
            )}
          </div>
        )}
      </SaveVeil>
    </Panel>
  );
}

const CAMPOS_ADVERSARIO: [keyof typeof VAZIO_ADVERSARIO, string, string][] = [
  ["formation", "Formação", "4-3-3"],
  ["style", "Como jogam", "Pressão alta, jogo directo, posse, saída a três."],
  ["strengths", "Pontos fortes", "Onde nos fizeram mal."],
  ["weaknesses", "Pontos fracos", "Onde se pode entrar."],
  ["keyPlayers", "Jogadores em destaque", "O 10, canhoto, remata de fora. O 9 ganha tudo no ar."],
  ["setPieces", "Bolas paradas", "Como marcam os cantos, quem bate as faltas, como defendem."],
  ["notes", "Notas", "O resto: o treinador, o campo deles, o público."],
];

/** Um relatório do adversário em leitura: só os campos com alguma coisa. */
export function RelatorioDoAdversario({ r }: { r: OpponentReport }) {
  return (
    <>
      {r.formation && (
        <div className="flex items-center gap-2">
          <span className="text-meta font-medium text-ink-3">Formação</span>
          <Pill tone="signal">{r.formation}</Pill>
        </div>
      )}
      {CAMPOS_ADVERSARIO.filter(([campo]) => campo !== "formation").map(([campo, rotulo]) =>
        r[campo] ? <Bloco key={campo} titulo={rotulo} texto={r[campo]!} /> : null,
      )}
    </>
  );
}

/* ========================================================================== */
/* O que já se sabe deste adversário                                           */
/* ========================================================================== */

/**
 * Os outros jogos contra o mesmo adversário, e o que se escreveu deles.
 *
 * É este painel que faz os relatórios valerem a pena: antes de jogar com o
 * Fafe outra vez, o treinador lê aqui como é que o Fafe jogou da última vez,
 * sem procurar. Aparece antes e depois do jogo. Sem histórico, não aparece —
 * um painel a dizer "ainda não jogámos contra eles" não ajuda ninguém.
 */
export function OpponentHistoryPanel({ match }: { match: MatchDetail }) {
  const linhas = match.opponentHistory;
  if (linhas.length === 0) return null;

  const jogados = linhas.filter((l) => l.ourScore !== null && l.theirScore !== null);
  const v = jogados.filter((l) => l.ourScore! > l.theirScore!).length;
  const e = jogados.filter((l) => l.ourScore === l.theirScore).length;
  const d = jogados.filter((l) => l.ourScore! < l.theirScore!).length;
  const ultimoRelatorio = linhas.find((l) => l.report)?.report ?? null;

  return (
    <Panel>
      <PanelHead
        title={`Já defrontámos o ${match.opponent}`}
        hint={jogados.length > 0 ? `${jogados.length} ${jogados.length === 1 ? "jogo" : "jogos"} · ${v}-${e}-${d}` : undefined}
      />

      {ultimoRelatorio && (
        <div className="space-y-3 border-b border-line px-5 py-4">
          <p className="text-meta text-ink-4">Da última vez que os vimos</p>
          <RelatorioDoAdversario r={ultimoRelatorio} />
        </div>
      )}

      <ul>
        {linhas.slice(0, 6).map((l) => (
          <li key={l.matchId} className="border-b border-line last:border-b-0">
            <Link
              to={`/jogos/${l.matchId}`}
              className="flex min-h-11 items-center gap-3 px-5 py-2.5 text-meta transition-colors hover:bg-sunken/60"
            >
              <span className="w-16 shrink-0 tabular text-ink-3">{dataCurta(l.startsAt)}</span>
              <span className="min-w-0 flex-1 truncate text-ink-2">
                {l.teamName}
                {l.competition && <span className="text-ink-4"> · {l.competition}</span>}
              </span>
              <Resultado l={l} />
              {l.report && <Pill tone="signal">relatório</Pill>}
            </Link>
          </li>
        ))}
      </ul>

      <Link
        to={`/jogos/adversarios?nome=${encodeURIComponent(match.opponent)}`}
        className="flex items-center justify-center gap-1.5 border-t border-line px-5 py-2.5 text-meta font-medium text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
      >
        Tudo sobre o {match.opponent}
        <ChevronRight className="size-3.5" strokeWidth={1.75} />
      </Link>
    </Panel>
  );
}

/** O resultado de um jogo contra o adversário, visto do nosso lado. */
export function Resultado({ l }: { l: Pick<OpponentHistoryRow, "ourScore" | "theirScore" | "isHome"> }) {
  if (l.ourScore === null || l.theirScore === null) return <span className="text-ink-4">sem resultado</span>;
  const tom = l.ourScore > l.theirScore ? "bg-ok-soft text-ok" : l.ourScore < l.theirScore ? "bg-risk-soft text-risk" : "bg-sunken text-ink-2";
  return (
    <span className={cx("inline-block shrink-0 rounded-[6px] px-2 py-0.5 font-semibold tabular", tom)}>
      {l.ourScore}–{l.theirScore}
      <span className="ml-1 font-normal text-ink-4">{l.isHome ? "casa" : "fora"}</span>
    </span>
  );
}

/* ========================================================================== */
/* Peças                                                                       */
/* ========================================================================== */

function Videos({ videos, onChange }: { videos: VideoLink[]; onChange: (v: VideoLink[]) => void }) {
  const mudar = (i: number, patch: Partial<VideoLink>) =>
    onChange(videos.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));

  return (
    <div className="space-y-2">
      {videos.map((v, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <input
            value={v.url}
            onChange={(e) => mudar(i, { url: e.target.value })}
            placeholder="https://youtube.com/…"
            inputMode="url"
            className={cx(dialogInputClass, "min-w-0 flex-1")}
          />
          <input
            value={v.label ?? ""}
            onChange={(e) => mudar(i, { label: e.target.value || null })}
            placeholder="1.ª parte"
            maxLength={80}
            className={cx(dialogInputClass, "w-full sm:w-36")}
          />
          <button
            type="button"
            onClick={() => onChange(videos.filter((_, idx) => idx !== i))}
            className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-ink-4 hover:bg-risk-soft hover:text-risk"
            aria-label="Remover vídeo"
          >
            <Trash2 className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      ))}
      {videos.length < 10 && (
        <button
          type="button"
          onClick={() => onChange([...videos, { url: "", label: null }])}
          className="ctl-ghost h-8 gap-1.5 text-meta text-ink-3"
        >
          <Plus className="size-3.5" strokeWidth={2} />
          {videos.length === 0 ? "Juntar um vídeo" : "Mais um"}
        </button>
      )}
      {/*
        Ligações e não ficheiros. Um jogo inteiro são gigabytes, e o
        armazenamento aceita 50 MB por ficheiro: o vídeo fica no YouTube, no
        Veo ou no Drive do clube, e aqui fica o caminho até lá.
      */}
      <p className="text-meta text-ink-4">Cola a ligação do YouTube, do Veo ou do Drive. O vídeo fica lá, o caminho fica aqui.</p>
    </div>
  );
}

function LigacaoVideo({ v }: { v: VideoLink }) {
  return (
    <a
      href={v.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 text-body text-ink underline-offset-2 hover:underline"
    >
      <Film className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
      <span className="truncate">{v.label || v.url.replace(/^https?:\/\//, "")}</span>
      <ExternalLink className="size-3 shrink-0 text-ink-4" strokeWidth={1.75} />
    </a>
  );
}

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-meta font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}

function Leitura({ children }: { children: ReactNode }) {
  return <div className="space-y-4 px-5 py-4">{children}</div>;
}

function Bloco({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div>
      <p className="text-meta font-medium text-ink-3">{titulo}</p>
      <p className="mt-1 whitespace-pre-line text-body leading-relaxed text-ink">{texto}</p>
    </div>
  );
}

export function quando(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function dataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** Um vazio para as páginas que listam relatórios. */
export function SemRelatorios() {
  return <Empty title="Ainda sem relatórios" detail="Depois de um jogo, regista-se na página dele como o adversário jogou." />;
}
