import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Empty, Loading, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { ArrowLeft, ChevronRight, Search, Shield } from "@/lib/icons";
import { useStore } from "@/lib/store";
import { listOpponents, type OpponentSummary } from "@/lib/matches";
import { RelatorioDoAdversario, Resultado, dataCurta, quando } from "@/components/MatchReports";

/**
 * Os adversários do clube.
 *
 * ## O que é isto
 *
 * A memória do clube sobre os outros. Cada jogo já jogado deixa aqui o nome de
 * quem se defrontou, o resultado e, quando alguém o escreveu, como é que eles
 * jogaram. Um clube que joga com o Fafe em Outubro e outra vez em Março
 * encontra aqui o que viu em Outubro.
 *
 * ## Sem menu próprio
 *
 * Chega-se pelos Jogos e pela página de cada jogo. É uma leitura dos jogos,
 * não uma área nova, e um item de menu a mais era pedir a cada clube que
 * decidisse quem o vê.
 *
 * ## Agrupado pelo nome
 *
 * O adversário é o nome que ficou escrito no jogo. Se um clube escreveu
 * "Fafe" numa vez e "AD Fafe" noutra, vê dois — e é esta lista que lho mostra,
 * para corrigir no jogo. Uma tabela de adversários à parte obrigava a escolher
 * de uma lista ao marcar cada jogo, e ninguém quer isso.
 */
export default function Opponents() {
  const store = useStore();
  const [rows, setRows] = useState<OpponentSummary[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [procura, setProcura] = useState("");
  const [params, setParams] = useSearchParams();
  const nome = params.get("nome");

  useEffect(() => {
    listOpponents()
      .then(setRows)
      .catch((e) => setErro(e instanceof Error ? e.message : "Não foi possível carregar os adversários."));
  }, []);

  const escolhido = useMemo(
    () => (nome && rows ? rows.find((r) => r.name.toLowerCase() === nome.trim().toLowerCase()) ?? null : null),
    [rows, nome],
  );

  const filtrados = useMemo(() => {
    const q = procura.trim().toLowerCase();
    return (rows ?? []).filter((r) => !q || r.name.toLowerCase().includes(q));
  }, [rows, procura]);

  if (erro) return <Empty title="Não foi possível abrir os adversários" detail={erro} />;
  if (!rows) return <Loading />;

  if (escolhido) {
    return <OpponentPage r={escolhido} onBack={() => setParams({}, { replace: true })} />;
  }

  return (
    <>
      <PageHeader eyebrow={store.academy.name} title="Adversários">
        <Link to="/jogos" className="ctl-ghost">
          <ArrowLeft className="size-3.5" strokeWidth={2} />
          Jogos
        </Link>
      </PageHeader>

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          <label className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
            <input
              value={procura}
              onChange={(e) => setProcura(e.target.value)}
              placeholder="Procurar adversário"
              className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface pl-8 pr-2.5 text-body text-ink focus:border-line-strong focus:outline-none"
            />
          </label>
          <span className="text-meta text-ink-3">
            {rows.length} {rows.length === 1 ? "adversário" : "adversários"}
          </span>
        </div>

        {filtrados.length === 0 ? (
          <Empty
            icon={Shield}
            title={rows.length === 0 ? "Ainda sem adversários" : "Nenhum adversário com esse nome"}
            detail={rows.length === 0 ? "Aparecem aqui à medida que os jogos se jogam." : undefined}
          />
        ) : (
          <ul>
            {filtrados.map((r) => (
              <li key={r.name} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => setParams({ nome: r.name })}
                  className="flex min-h-14 w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-sunken/60"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-3">
                    <Shield className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-ink">{r.name}</span>
                    <span className="block truncate text-meta text-ink-3">
                      {r.teams.join(", ")}
                      {r.lastPlayedAt && ` · último jogo ${dataCurta(r.lastPlayedAt)}`}
                    </span>
                  </span>
                  <Registo r={r} />
                  {r.lastFormation && <Pill tone="signal">{r.lastFormation}</Pill>}
                  {r.reports > 0 && (
                    <span className="hidden text-meta text-ink-4 sm:inline">
                      {r.reports} {r.reports === 1 ? "relatório" : "relatórios"}
                    </span>
                  )}
                  <ChevronRight className="size-4 shrink-0 text-ink-4" strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

/** Vitórias, empates e derrotas contra este adversário, como na ficha da equipa. */
function Registo({ r }: { r: OpponentSummary }) {
  if (r.played === 0) return <span className="text-meta text-ink-4">sem jogos</span>;
  return (
    <span className="shrink-0 text-meta tabular text-ink-2" title="Vitórias-Empates-Derrotas">
      <span className={cx("font-semibold", r.wins > r.losses ? "text-ok" : r.wins < r.losses ? "text-risk" : "text-ink")}>
        {r.wins}-{r.draws}-{r.losses}
      </span>
      <span className="text-ink-4"> · {r.played} {r.played === 1 ? "jogo" : "jogos"}</span>
    </span>
  );
}

/**
 * Um adversário: os jogos contra ele e o que se escreveu em cada um, do mais
 * recente para trás. O relatório mais recente vem em cima, aberto, porque é o
 * que se quer ler antes do próximo jogo.
 */
function OpponentPage({ r, onBack }: { r: OpponentSummary; onBack: () => void }) {
  const comRelatorio = r.matches.filter((m) => m.report);

  return (
    <>
      <PageHeader eyebrow="Adversário" title={r.name} subtitle={r.teams.join(", ")}>
        <button type="button" onClick={onBack} className="ctl-ghost">
          <ArrowLeft className="size-3.5" strokeWidth={2} />
          Todos os adversários
        </button>
      </PageHeader>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <Panel>
            <PanelHead title="Relatórios" hint={comRelatorio.length ? `${comRelatorio.length}` : undefined} />
            {comRelatorio.length === 0 ? (
              <Empty
                compact
                title="Ainda sem relatórios"
                detail="Depois de um jogo, regista-se na página dele como o adversário jogou."
              />
            ) : (
              <ul>
                {comRelatorio.map((m) => (
                  <li key={m.matchId} className="space-y-3 border-b border-line px-5 py-4 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-3">
                      <span className="tabular">{dataCurta(m.startsAt)}</span>
                      <span className="text-ink-2">{m.teamName}</span>
                      {m.competition && <span>{m.competition}</span>}
                      <Resultado l={m} />
                      <Link to={`/jogos/${m.matchId}`} className="ml-auto font-medium text-ink underline-offset-2 hover:underline">
                        Abrir jogo
                      </Link>
                    </div>
                    <RelatorioDoAdversario r={m.report!} />
                    <p className="text-meta text-ink-4">
                      por {m.report!.authorName ?? "alguém"} · {quando(m.report!.updatedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel>
          <PanelHead title="Jogos" hint={r.played > 0 ? `${r.wins}-${r.draws}-${r.losses}` : undefined} />
          <ul>
            {r.matches.map((m) => (
              <li key={m.matchId} className="border-b border-line last:border-b-0">
                <Link
                  to={`/jogos/${m.matchId}`}
                  className="flex min-h-11 items-center gap-3 px-5 py-2.5 text-meta transition-colors hover:bg-sunken/60"
                >
                  <span className="w-16 shrink-0 tabular text-ink-3">{dataCurta(m.startsAt)}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{m.teamName}</span>
                  <Resultado l={m} />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
