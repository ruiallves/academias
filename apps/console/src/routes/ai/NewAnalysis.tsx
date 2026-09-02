import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Bar, Empty, Panel, PanelHead, Pill, SelectField, cx } from "@/components/primitives";
import { dialogInputClass } from "@/components/Dialog";
import { ArrowLeft, ArrowRight, Check, Film, Upload, Users } from "@/lib/icons";
import { athletes, matches, teams } from "@/lib/store";
import { shortDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { createAnalysis, uploadAnalysisVideo } from "@/lib/ai";

/**
 * Nova análise — três passos: jogo, plantel, vídeo.
 *
 * ## Porque é que o plantel vem antes do vídeo
 *
 * É a decisão que torna a identificação possível sem biometria facial: dizer
 * "#10 = Rui Silva" **antes** de processar transforma a pergunta aberta "quem é
 * esta pessoa?" na pergunta fechada "qual destes dezasseis?". O treinador gasta
 * um minuto aqui e poupa uma tarde de correções.
 *
 * ## O vídeo não passa pela API
 *
 * O browser carrega directo para o Storage com um endereço assinado — noventa
 * minutos de jogo são gigabytes, e é por isso que há barra de progresso e se
 * pode ir buscar um café. Depois de confirmado, o processamento corre sozinho:
 * pode-se fechar a consola, a notificação diz quando acabar.
 */
export default function NewAnalysis() {
  const { session } = useSession();
  const navigate = useNavigate();

  // As equipas onde posso criar: o âmbito do treinador manda, como no servidor.
  const myTeams = useMemo(() => {
    const scoped = session.scope?.teamIds;
    return scoped?.length ? teams.filter((t) => scoped.includes(t.id)) : teams;
  }, [session]);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [teamId, setTeamId] = useState(myTeams[0]?.id ?? "");
  const [matchId, setMatchId] = useState("");
  const [opponent, setOpponent] = useState("");
  const [competition, setCompetition] = useState("");
  const [playedOn, setPlayedOn] = useState("");
  const [squad, setSquad] = useState<Map<string, number | null>>(new Map());
  const [file, setFile] = useState<File | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!can(session, "ai:write")) {
    return (
      <Panel>
        <Empty title="Sem permissão" detail="Criar análises pede a permissão de escrita da Academias AI." />
      </Panel>
    );
  }
  if (myTeams.length === 0) {
    return (
      <Panel>
        <Empty icon={Users} title="Sem equipas" detail="Uma análise pertence a uma equipa — cria primeiro a equipa." />
      </Panel>
    );
  }

  const teamMatches = matches
    .filter((m) => m.teamId === teamId && m.status !== "CANCELLED")
    .sort((a, b) => +new Date(b.startsAt) - +new Date(a.startsAt))
    .slice(0, 20);
  const teamAthletes = athletes.filter((a) => a.teamId === teamId && a.status === "active");
  const selectedMatch = teamMatches.find((m) => m.id === matchId) ?? null;

  /** Entrar no passo do plantel: todos convocáveis pré-escolhidos, número da ficha. */
  const goToSquad = () => {
    if (squad.size === 0) {
      setSquad(new Map(teamAthletes.map((a) => [a.id, a.squadNumber ?? null])));
    }
    setStep(2);
  };

  const toggleAthlete = (id: string, defaultNumber: number | null) => {
    setSquad((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, defaultNumber);
      return next;
    });
  };

  const setNumber = (id: string, value: string) => {
    setSquad((prev) => {
      const next = new Map(prev);
      const n = parseInt(value, 10);
      next.set(id, Number.isFinite(n) ? n : null);
      return next;
    });
  };

  /** Criar a análise e carregar o vídeo — o passo que entrega à máquina. */
  const submit = async () => {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      // Repetir depois de uma falha de rede reaproveita a análise criada — não
      // se semeiam rascunhos por cada tentativa.
      let id = analysisId;
      if (!id) {
        const created = await createAnalysis({
          teamId,
          ...(matchId ? { matchId } : {}),
          ...(opponent.trim() ? { opponent: opponent.trim() } : {}),
          ...(competition.trim() ? { competition: competition.trim() } : {}),
          ...(playedOn ? { playedOn } : {}),
          squad: [...squad.entries()].map(([athleteId, jerseyNumber]) => ({
            athleteId,
            ...(jerseyNumber != null ? { jerseyNumber } : {}),
          })),
        });
        id = created.id;
        setAnalysisId(id);
      }
      await uploadAnalysisVideo(id, file, setProgress);
      navigate(`/ai/analises/${id}`);
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : "Não foi possível carregar o vídeo");
    }
  };

  const steps = ["Jogo", "Plantel", "Vídeo"] as const;

  return (
    <>
      <PageHeader eyebrow="Academias AI" title="Nova análise">
        <Link to="/ai/analises" className="ctl-outline gap-1">
          <ArrowLeft className="size-3.5" strokeWidth={1.75} />
          Cancelar
        </Link>
      </PageHeader>

      {/* O fio dos três passos — sempre à vista, nunca clicável para a frente. */}
      <div className="mb-4 flex items-center gap-2">
        {steps.map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          const done = step > n;
          const current = step === n;
          return (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && <span className="h-px w-6 bg-line" aria-hidden />}
              <button
                type="button"
                onClick={() => done && setStep(n)}
                disabled={!done}
                className={cx(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-meta font-semibold",
                  current && "bg-signal-soft text-signal-ink",
                  done && "text-ink-2 hover:bg-sunken",
                  !current && !done && "text-ink-4",
                )}
              >
                <span
                  className={cx(
                    "inline-flex size-4.5 items-center justify-center rounded-full text-[10px]",
                    current ? "bg-signal text-white" : done ? "bg-ok-soft text-ok" : "bg-sunken",
                  )}
                >
                  {done ? <Check className="size-3" strokeWidth={2.5} /> : n}
                </span>
                {label}
              </button>
            </div>
          );
        })}
      </div>

      {step === 1 && (
        <Panel className="max-w-2xl">
          <PanelHead title="O jogo" hint="equipa, adversário e prova" />
          <div className="space-y-4 px-5 py-4">
            <Field label="Equipa">
              <SelectField
                aria-label="Equipa"
                value={teamId}
                onChange={(v) => {
                  setTeamId(v);
                  setMatchId("");
                  setSquad(new Map());
                }}
                options={myTeams.map((t) => ({ value: t.id, label: t.name }))}
              />
            </Field>

            <Field label="Jogo do calendário" hint="preenche o resto sozinho — ou deixa em branco">
              <SelectField
                aria-label="Jogo"
                value={matchId}
                onChange={setMatchId}
                options={[
                  { value: "", label: "Sem jogo associado" },
                  ...teamMatches.map((m) => ({
                    value: m.id,
                    label: `${shortDate(new Date(m.startsAt))} · vs ${m.opponent}`,
                  })),
                ]}
              />
            </Field>

            {!selectedMatch && (
              <>
                <Field label="Adversário">
                  <input
                    className={dialogInputClass}
                    value={opponent}
                    onChange={(e) => setOpponent(e.target.value)}
                    placeholder="FC Exemplo"
                  />
                </Field>
                <Field label="Competição">
                  <input
                    className={dialogInputClass}
                    value={competition}
                    onChange={(e) => setCompetition(e.target.value)}
                    placeholder="Campeonato Distrital"
                  />
                </Field>
                <Field label="Data do jogo">
                  <input
                    type="date"
                    className={dialogInputClass}
                    value={playedOn}
                    onChange={(e) => setPlayedOn(e.target.value)}
                  />
                </Field>
              </>
            )}

            <div className="flex justify-end border-t border-line pt-4">
              <button type="button" className="ctl-primary gap-1" onClick={goToSquad} disabled={!teamId}>
                Confirmar plantel
                <ArrowRight className="size-3.5" strokeWidth={2} />
              </button>
            </div>
          </div>
        </Panel>
      )}

      {step === 2 && (
        <Panel className="max-w-2xl">
          <PanelHead
            title="Quem está em campo"
            hint={`${squad.size} de ${teamAthletes.length} escolhidos`}
          />
          <div className="px-5 py-3">
            <p className="mb-3 text-meta leading-relaxed text-ink-3">
              A IA vai saber que <strong className="text-ink-2">#10 = nome</strong> durante o jogo inteiro — é
              isto que dispensa reconhecimento facial. Confirma quem jogou e com que número.
            </p>
            {teamAthletes.length === 0 ? (
              <Empty compact title="Esta equipa não tem atletas ativos" detail="Inscreve-os primeiro na página de Atletas." />
            ) : (
              <ul className="divide-y divide-line">
                {teamAthletes.map((a) => {
                  const on = squad.has(a.id);
                  return (
                    <li key={a.id} className="flex items-center gap-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Convocar ${a.name}`}
                        checked={on}
                        onChange={() => toggleAthlete(a.id, a.squadNumber ?? null)}
                        className="size-3.5 accent-[var(--color-signal)]"
                      />
                      <input
                        type="number"
                        aria-label={`Número de ${a.name}`}
                        className={`${dialogInputClass} w-16 text-center tabular`}
                        value={on ? (squad.get(a.id) ?? "") : ""}
                        disabled={!on}
                        min={0}
                        max={999}
                        placeholder="#"
                        onChange={(e) => setNumber(a.id, e.target.value)}
                      />
                      <span className={cx("min-w-0 truncate text-body", on ? "text-ink" : "text-ink-4")}>{a.name}</span>
                      {a.position && <span className="ml-auto shrink-0 text-meta text-ink-3">{a.position}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex items-center justify-between border-t border-line pt-4">
              <button type="button" className="ctl-outline gap-1" onClick={() => setStep(1)}>
                <ArrowLeft className="size-3.5" strokeWidth={1.75} />
                Voltar
              </button>
              <button type="button" className="ctl-primary gap-1" onClick={() => setStep(3)} disabled={squad.size === 0}>
                Escolher o vídeo
                <ArrowRight className="size-3.5" strokeWidth={2} />
              </button>
            </div>
          </div>
        </Panel>
      )}

      {step === 3 && (
        <Panel className="max-w-2xl">
          <PanelHead title="O vídeo do jogo" hint="MP4, MOV, WebM ou MKV" />
          <div className="space-y-4 px-5 py-4">
            <input
              ref={fileInput}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />

            {!file ? (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-[var(--radius-control)] border border-dashed border-line-strong px-5 py-12 text-ink-3 transition-colors hover:border-signal hover:text-ink"
              >
                <Upload className="size-6" strokeWidth={1.5} />
                <span className="text-body font-medium">Escolher o ficheiro de vídeo</span>
                <span className="text-meta">Câmara fixa e elevada dá o melhor tracking</span>
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-line px-4 py-3">
                <Film className="size-5 shrink-0 text-ink-3" strokeWidth={1.5} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-medium text-ink">{file.name}</div>
                  <div className="text-meta text-ink-3">{(file.size / 1_048_576).toFixed(0)} MB</div>
                </div>
                {progress === null && (
                  <button type="button" className="ctl-outline" onClick={() => fileInput.current?.click()}>
                    Trocar
                  </button>
                )}
              </div>
            )}

            {progress !== null && (
              <div>
                <Bar value={progress} />
                <p className="mt-1.5 text-meta text-ink-3">
                  {progress < 1
                    ? `A carregar — ${Math.round(progress * 100)}%. Não feches este separador.`
                    : "A confirmar o carregamento…"}
                </p>
              </div>
            )}

            {error && <Pill tone="risk">{error}</Pill>}

            <div className="flex items-center justify-between border-t border-line pt-4">
              <button type="button" className="ctl-outline gap-1" onClick={() => setStep(2)} disabled={progress !== null}>
                <ArrowLeft className="size-3.5" strokeWidth={1.75} />
                Voltar
              </button>
              <button type="button" className="ctl-primary" onClick={submit} disabled={!file || progress !== null}>
                {error ? "Tentar outra vez" : "Criar análise e carregar"}
              </button>
            </div>
            <p className="text-meta leading-relaxed text-ink-4">
              Depois do carregamento o processamento corre sozinho — podes fechar a consola. Recebes uma
              notificação quando a análise terminar.
            </p>
          </div>
        </Panel>
      )}
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline gap-2 text-meta font-medium text-ink-2">
        {label}
        {hint && <span className="font-normal text-ink-4">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
