import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Empty, Loading, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  ExternalLink,
  MapPin,
  Plus,
  Trash2,
  Trophy,
  Users,
  Whistle,
} from "@/lib/icons";
import { useSession } from "@/session";
import { can } from "@/lib/permissions";
import { tallyNoun } from "@/lib/calendar";
import { Spinner } from "@/components/Busy";
import {
  OUTCOME_LABEL,
  STAFF_ROLES,
  getMatch,
  outcome,
  retroPool,
  saveAppearances,
  saveMatchStaff,
  saveResult,
  saveRetroSquad,
  staffPool,
  type MatchDetail as Match,
  type SquadRow,
} from "@/lib/matches";

/**
 * A página de um jogo.
 *
 * ## O marcador é a página
 *
 * A primeira versão disto era um empilhado de painéis iguais aos das outras
 * páginas, e não parecia um jogo — parecia um formulário. Um jogo tem uma cara
 * que toda a gente reconhece do café e da televisão: dois nomes e um número no
 * meio. É por isso que o topo é um **marcador**: os nomes das equipas em grande,
 * o resultado (ou a hora, antes do apito) no centro, e o estado do jogo por
 * baixo. Quem abre a página sabe em meio segundo como ficou.
 *
 * ## O resultado escreve-se, não se clica
 *
 * O registo é **escrita directa**: dois campos numéricos grandes, no sítio exacto
 * onde o número vai ficar. Houve uma versão com botões de mais e menos e foi
 * rejeitada — quem sabe que ficou 3–1 quer escrever 3 e 1, não carregar quatro
 * vezes. O teclado numérico abre sozinho (`inputMode="numeric"`), valida-se ao
 * sair do campo, e o erro aparece junto ao campo com `role="alert"`.
 *
 * E só existe **depois do apito**. Um resultado antes do jogo é um palpite, e o
 * servidor recusa-o também — a interface esconder não é regra nenhuma.
 *
 * ## O passado regista-se aqui, o futuro monta-se nas Convocatórias
 *
 * Um jogo futuro mostra a convocatória e leva ao ecrã dela — montar um convite
 * (com avisos às famílias) tem casa própria. Um jogo passado **sem** plantel no
 * sistema mostra o registo retroactivo: escolhe-se quem esteve, sem avisar
 * ninguém, porque isso é história e não convite. Só esta página o faz; o ecrã de
 * Convocatórias continua a recusar jogos passados.
 *
 * ## Feita para quem tem pouca paciência
 *
 * Alvos de 44px, rótulos sempre visíveis, números escritos e não clicados, uma
 * gravação só no fim de cada bloco, e a página inteira num scroll — sem abas para
 * descobrir. Ver `references` da skill de UI: contraste 4.5:1, erro junto ao
 * campo, feedback de sucesso breve, confirmação antes de apagar.
 */
export default function MatchDetail() {
  const { id = "" } = useParams();
  const { session } = useSession();

  const [match, setMatch] = useState<Match | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const mayRecord = can(session, "attendance:write");

  async function recarregar() {
    try {
      setMatch(await getMatch(id));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar o jogo.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void recarregar();
  }, [id]);

  if (loading && !match) return <Loading />;
  if (erro || !match) return <Empty title="Não foi possível abrir o jogo" detail={erro ?? undefined} />;

  const inicio = new Date(match.startsAt);
  const fim = new Date(match.endsAt);
  const agora = Date.now();
  const passou = inicio.getTime() < agora;
  const aDecorrer = passou && fim.getTime() > agora && match.status !== "CANCELLED";
  const temPlantel = match.squad.length > 0;

  return (
    <>
      <PageHeader eyebrow={match.teamName} title="Jogo">
        <Link to="/jogos" className="ctl-ghost">
          <ArrowLeft className="size-3.5" strokeWidth={2} />
          Todos os jogos
        </Link>
      </PageHeader>

      <Scoreboard match={match} aDecorrer={aDecorrer} passou={passou} mayRecord={mayRecord} onSaved={recarregar} />

      <div className="mt-3 grid items-start gap-3 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {passou ? (
            temPlantel ? (
              <SheetPanel match={match} mayRecord={mayRecord} onSaved={recarregar} />
            ) : (
              <RetroSquadPanel match={match} mayRecord={mayRecord} onSaved={recarregar} />
            )
          ) : (
            <CallUpPanel match={match} />
          )}

          {/* Corrigir um plantel retroactivo já registado — discreto, mas à mão. */}
          {passou && temPlantel && mayRecord && (
            <RetroSquadPanel match={match} mayRecord={mayRecord} onSaved={recarregar} collapsed />
          )}
        </div>

        <div className="space-y-3">
          <StaffPanel match={match} passou={passou} mayRecord={mayRecord} onSaved={recarregar} />
          <FactsPanel match={match} passou={passou} />
        </div>
      </div>
    </>
  );
}

/* ========================================================================== */
/* O marcador                                                                 */
/* ========================================================================== */

/**
 * O topo da página: dois nomes, um número no meio.
 *
 * A faixa de cor no topo é a do clube (`--signal`) — é o único sítio da página
 * onde ela aparece como identidade, e chega: mais do que isto e um clube de
 * amarelo tinha uma página ilegível. Ver a regra da casa nas Definições.
 */
function Scoreboard({
  match,
  aDecorrer,
  passou,
  mayRecord,
  onSaved,
}: {
  match: Match;
  aDecorrer: boolean;
  passou: boolean;
  mayRecord: boolean;
  onSaved: () => void;
}) {
  const inicio = new Date(match.startsAt);
  const cancelado = match.status === "CANCELLED";
  const temResultado = match.ourScore !== null && match.theirScore !== null;
  const res = outcome(match);

  const casa = match.isHome ? match.teamName : match.opponent;
  const fora = match.isHome ? match.opponent : match.teamName;
  const golosCasa = match.isHome ? match.ourScore : match.theirScore;
  const golosFora = match.isHome ? match.theirScore : match.ourScore;

  return (
    <Panel className="overflow-hidden">
      {/* A faixa do clube. 3px — identidade, não decoração. */}
      <div aria-hidden className="h-[3px] w-full" style={{ background: "var(--signal)" }} />

      <div className="px-5 pt-5 pb-4 sm:px-8">
        {/* A linha de contexto por cima do marcador. */}
        <div className="mb-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-meta text-ink-3">
          <span className="font-medium text-ink-2">
            {inicio.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" })}
          </span>
          <span aria-hidden>·</span>
          <span>{inicio.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" strokeWidth={1.75} />
            {match.venue}
          </span>
          <Pill>{match.isHome ? "em casa" : "fora"}</Pill>
          {cancelado && <Pill tone="risk">cancelado</Pill>}
          {aDecorrer && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-2 py-0.5 text-meta font-medium text-ok">
              <span className="size-1.5 animate-pulse rounded-full bg-ok" aria-hidden />
              a decorrer
            </span>
          )}
        </div>

        {/* O marcador em si: nome — número — nome. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6">
          <TeamSide name={casa} ours={match.isHome} align="right" />

          <div className="flex flex-col items-center gap-1.5">
            {temResultado ? (
              <>
                <div className="flex items-baseline gap-2 sm:gap-3">
                  <span className="text-[44px] leading-none font-semibold tabular text-ink sm:text-[60px]">
                    {golosCasa}
                  </span>
                  <span className="text-[28px] leading-none font-light text-ink-4 sm:text-[36px]">–</span>
                  <span className="text-[44px] leading-none font-semibold tabular text-ink sm:text-[60px]">
                    {golosFora}
                  </span>
                </div>
                {res && (
                  <span
                    className={cx(
                      "rounded-full px-2.5 py-0.5 text-meta font-semibold uppercase tracking-wide",
                      res === "win" && "bg-ok-soft text-ok",
                      res === "draw" && "bg-sunken text-ink-3",
                      res === "loss" && "bg-risk-soft text-risk",
                    )}
                  >
                    {OUTCOME_LABEL[res]}
                  </span>
                )}
              </>
            ) : passou && !cancelado ? (
              <span className="text-[44px] leading-none font-light tabular text-ink-4 sm:text-[60px]">–</span>
            ) : (
              <>
                <span className="text-[36px] leading-none font-semibold tabular text-ink sm:text-[44px]">
                  {inicio.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="text-meta text-ink-4">{quandoFalta(inicio)}</span>
              </>
            )}
          </div>

          <TeamSide name={fora} ours={!match.isHome} align="left" />
        </div>

        {/* A escrita do resultado, no sítio onde o número vai ficar. */}
        {passou && !cancelado && mayRecord && (
          <ResultEntry match={match} onSaved={onSaved} />
        )}

        {!passou && !cancelado && mayRecord && (
          <p className="mt-4 text-center text-meta text-ink-4">
            O resultado regista-se aqui depois do apito.
          </p>
        )}
      </div>

      {/* A faixa de estado: o que está feito e o que falta, num relance. */}
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 border-t border-line bg-sunken/40 px-5 py-2.5 text-meta">
        <Estado
          feito={match.submitted}
          feitoLabel={passou ? "Plantel registado" : "Convocatória enviada"}
          faltaLabel={passou ? "Plantel por registar" : "Convocatória por enviar"}
        />
        {passou && !cancelado && (
          <>
            <Estado feito={match.ourScore !== null} feitoLabel="Resultado registado" faltaLabel="Resultado por registar" />
            <Estado
              feito={match.squad.some((s) => s.played)}
              feitoLabel="Ficha preenchida"
              faltaLabel="Ficha por preencher"
            />
          </>
        )}
      </div>
    </Panel>
  );
}

function TeamSide({ name, ours, align }: { name: string; ours: boolean; align: "left" | "right" }) {
  return (
    <div className={cx("min-w-0", align === "right" ? "text-right" : "text-left")}>
      <div
        className={cx(
          "truncate text-[17px] leading-snug font-semibold sm:text-[21px]",
          ours ? "text-ink" : "text-ink-2",
        )}
      >
        {name}
      </div>
    </div>
  );
}

function Estado({ feito, feitoLabel, faltaLabel }: { feito: boolean; feitoLabel: string; faltaLabel: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5", feito ? "text-ink-3" : "font-medium text-warn")}>
      {feito ? (
        <Check className="size-3.5 text-ok" strokeWidth={2.5} />
      ) : (
        <span className="size-1.5 rounded-full bg-warn" aria-hidden />
      )}
      {feito ? feitoLabel : faltaLabel}
    </span>
  );
}

function quandoFalta(inicio: Date): string {
  const dias = Math.ceil((inicio.getTime() - Date.now()) / 86_400_000);
  if (dias <= 0) return "é hoje";
  if (dias === 1) return "é amanhã";
  return `faltam ${dias} dias`;
}

/* ========================================================================== */
/* O resultado — escrita directa                                              */
/* ========================================================================== */

/**
 * Dois campos, escreve-se o número.
 *
 * `inputMode="numeric"` abre o teclado certo no telemóvel; `maxLength 2` e a
 * validação ao sair do campo seguram o disparate. O erro aparece junto aos
 * campos, com `role="alert"` para ser anunciado — nunca só uma borda vermelha.
 */
function ResultEntry({ match, onSaved }: { match: Match; onSaved: () => void }) {
  const [nos, setNos] = useState(match.ourScore === null ? "" : String(match.ourScore));
  const [eles, setEles] = useState(match.theirScore === null ? "" : String(match.theirScore));
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gravado, setGravado] = useState(false);
  const [confirmarApagar, setConfirmarApagar] = useState(false);

  useEffect(() => {
    setNos(match.ourScore === null ? "" : String(match.ourScore));
    setEles(match.theirScore === null ? "" : String(match.theirScore));
  }, [match.ourScore, match.theirScore]);

  const temResultado = match.ourScore !== null && match.theirScore !== null;
  const valido = /^\d{1,2}$/.test(nos) && /^\d{1,2}$/.test(eles);
  const mudou = nos !== (match.ourScore === null ? "" : String(match.ourScore)) || eles !== (match.theirScore === null ? "" : String(match.theirScore));

  async function gravar() {
    if (!valido) {
      setErro("Escreve os dois números — 0 também conta.");
      return;
    }
    setBusy(true);
    setErro(null);
    try {
      await saveResult(match.id, Number(nos), Number(eles));
      setGravado(true);
      setTimeout(() => setGravado(false), 2000);
      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setBusy(false);
    }
  }

  async function apagar() {
    setBusy(true);
    setErro(null);
    try {
      await saveResult(match.id, null, null);
      setConfirmarApagar(false);
      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível apagar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex flex-wrap items-end justify-center gap-x-4 gap-y-3">
        <ScoreField
          label={match.teamName}
          value={nos}
          onChange={setNos}
          disabled={busy}
        />
        <span className="pb-3 text-[22px] font-light text-ink-4" aria-hidden>
          –
        </span>
        <ScoreField label={match.opponent} value={eles} onChange={setEles} disabled={busy} />

        <div className="flex items-center gap-2 pb-0.5 pl-2">
          <button
            type="button"
            className="ctl-primary h-11 px-5"
            disabled={busy || !mudou || !valido}
            onClick={() => void gravar()}
          >
            {busy ? "A gravar…" : temResultado ? "Gravar" : "Registar resultado"}
          </button>
          {gravado && !busy && (
            <span className="inline-flex items-center gap-1 text-meta text-ok">
              <Check className="size-3.5" strokeWidth={2} />
              gravado
            </span>
          )}
        </div>
      </div>

      {erro && (
        <p role="alert" className="mt-2 text-center text-meta text-risk">
          {erro}
        </p>
      )}

      {temResultado && (
        <div className="mt-3 text-center">
          {confirmarApagar ? (
            <span className="inline-flex items-center gap-2 text-meta">
              <span className="text-ink-2">Apagar o resultado e voltar a "por jogar"?</span>
              <button type="button" className="ctl-ghost h-8" onClick={() => setConfirmarApagar(false)}>
                Não
              </button>
              <button type="button" className="ctl-risk h-8" disabled={busy} onClick={() => void apagar()}>
                Apagar
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmarApagar(true)}
              className="text-meta text-ink-4 underline-offset-2 hover:text-risk hover:underline"
            >
              Apagar resultado
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Um campo do marcador: grande, com o nome da equipa como rótulo visível. */
function ScoreField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex flex-col items-center gap-1">
      <span className="max-w-[120px] truncate text-meta font-medium text-ink-2">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        value={value}
        placeholder="0"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        className="h-14 w-20 rounded-[10px] border border-line bg-surface text-center text-[28px] font-semibold tabular text-ink outline-none transition-colors placeholder:text-ink-4/50 focus:border-line-strong focus:ring-2 focus:ring-[color-mix(in_oklab,var(--signal)_35%,transparent)]"
      />
    </label>
  );
}

/* ========================================================================== */
/* Antes do jogo: a convocatória                                              */
/* ========================================================================== */

/**
 * Um jogo futuro mostra em que pé está a convocatória e leva ao ecrã dela — que
 * é onde se monta, porque montar é um processo com hesitação e avisos às
 * famílias. Aqui responde-se e aponta-se, não se edita.
 */
function CallUpPanel({ match }: { match: Match }) {
  const confirmados = match.squad.filter((s) => s.callUpStatus === "CONFIRMED").length;
  const recusaram = match.squad.filter((s) => s.callUpStatus === "DECLINED").length;
  const semResposta = match.squad.length - confirmados - recusaram;

  return (
    <Panel>
      <PanelHead title="Convocatória" hint={match.submitted ? "enviada às famílias" : "por enviar"}>
        <Link to="/convocatorias" className="ctl-primary">
          {match.submitted ? "Ver nas Convocatórias" : "Montar convocatória"}
          <ChevronRight className="size-3.5" strokeWidth={2} />
        </Link>
      </PanelHead>

      {match.squad.length === 0 ? (
        <Empty
          title="Ainda ninguém convocado"
          detail="Este jogo ainda não tem plantel escolhido. Monta a convocatória para as famílias serem avisadas."
        />
      ) : (
        <>
          {/* Três números que respondem à pergunta antes da lista. */}
          <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
            <Contagem n={match.squad.length} label={`convocados de ${match.maxCallUps}`} />
            <Contagem n={confirmados} label="confirmaram" tone={confirmados > 0 ? "ok" : undefined} />
            <Contagem
              n={match.submitted ? recusaram : semResposta}
              label={match.submitted ? "não podem" : "sem resposta"}
              tone={match.submitted && recusaram > 0 ? "risk" : undefined}
            />
          </div>

          <ul className="grid gap-x-4 px-5 py-3 sm:grid-cols-2">
            {match.squad.map((s) => (
              <li key={s.athleteId} className="flex min-h-9 items-center gap-2.5 text-body">
                <span
                  className={cx(
                    "size-2 shrink-0 rounded-full",
                    s.callUpStatus === "CONFIRMED" ? "bg-ok" : s.callUpStatus === "DECLINED" ? "bg-risk" : "bg-line-strong",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-ink-2">{s.name}</span>
                {s.isGuest && <Pill>de {s.guestFromTeam}</Pill>}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function Contagem({ n, label, tone }: { n: number; label: string; tone?: "ok" | "risk" }) {
  return (
    <div className="px-4 py-3 text-center">
      <div className={cx("text-[24px] leading-none font-semibold tabular", tone === "ok" ? "text-ok" : tone === "risk" ? "text-risk" : "text-ink")}>
        {n}
      </div>
      <div className="mt-1 text-meta text-ink-3">{label}</div>
    </div>
  );
}

/* ========================================================================== */
/* Depois do jogo, sem plantel: registar quem esteve                          */
/* ========================================================================== */

/**
 * O registo retroactivo do plantel — só aqui, e só para jogos já disputados.
 *
 * Não é um convite: ninguém é avisado, e o plantel fecha logo. É a porta para o
 * clube que geria as convocatórias em papel e quer a ficha na mesma — sem
 * plantel não há ficha, porque a ficha só aceita convocados.
 */
function RetroSquadPanel({
  match,
  mayRecord,
  onSaved,
  collapsed,
}: {
  match: Match;
  mayRecord: boolean;
  onSaved: () => void;
  collapsed?: boolean;
}) {
  const [aberto, setAberto] = useState(!collapsed);
  const [pool, setPool] = useState<{ athleteId: string; name: string; position: string | null }[] | null>(null);
  const [escolhidos, setEscolhidos] = useState<Set<string>>(() => new Set(match.squad.map((s) => s.athleteId)));
  const [busy, setBusy] = useState(false);
  const [gravado, setGravado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto || !mayRecord || pool !== null) return;
    retroPool(match.id)
      .then(setPool)
      .catch((e) => setErro(e instanceof Error ? e.message : "Não foi possível carregar o plantel."));
  }, [aberto, mayRecord, pool, match.id]);

  if (!mayRecord) {
    return (
      <Panel>
        <PanelHead title="Plantel" />
        <Empty title="Plantel por registar" detail="Quem tem permissão de registo pode marcar quem esteve neste jogo." />
      </Panel>
    );
  }

  function toggle(id: string) {
    setEscolhidos((xs) => {
      const next = new Set(xs);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function gravar() {
    setBusy(true);
    setErro(null);
    try {
      await saveRetroSquad(match.id, [...escolhidos]);

      /*
       * O visto, antes de o painel se ir embora.
       *
       * A gravação fechava o painel e mais nada — e um painel que desaparece é
       * ambíguo: pode ter gravado, pode ter desistido. Vale sobretudo quando se
       * está a **corrigir** um plantel já registado (`collapsed`), porque aí a
       * lista por baixo pode nem mudar de tamanho, e sem sinal nenhum a pessoa
       * carrega outra vez para ter a certeza.
       */
      setGravado(true);
      setTimeout(() => {
        setGravado(false);
        setAberto(!collapsed);
      }, 1200);

      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar o plantel.");
    } finally {
      setBusy(false);
    }
  }

  if (collapsed && !aberto) {
    return (
      <Panel>
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="flex min-h-11 w-full items-center justify-between px-5 py-3 text-left text-body text-ink-3 transition-colors hover:text-ink"
        >
          <span className="inline-flex items-center gap-2">
            <Users className="size-4" strokeWidth={1.75} />
            Corrigir o plantel deste jogo
          </span>
          <ChevronRight className="size-4" strokeWidth={1.75} />
        </button>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHead
        title={collapsed ? "Corrigir o plantel" : "Quem esteve neste jogo?"}
        hint={`${escolhidos.size} ${escolhidos.size === 1 ? "escolhido" : "escolhidos"}`}
      />

      <p className="border-b border-line px-5 py-3 text-meta leading-relaxed text-ink-3">
        O jogo já aconteceu, por isso isto não envia convite nenhum — é só o registo de quem foi
        convocado. Marca os nomes e grava; a ficha de jogo abre a seguir.
      </p>

      {pool === null && !erro ? (
        <Spinner />
      ) : erro && pool === null ? (
        <p role="alert" className="px-5 py-4 text-meta text-risk">
          {erro}
        </p>
      ) : (
        <ul className="grid sm:grid-cols-2">
          {(pool ?? []).map((a) => {
            const on = escolhidos.has(a.athleteId);
            return (
              <li key={a.athleteId} className="border-b border-line sm:odd:border-r">
                <button
                  type="button"
                  onClick={() => toggle(a.athleteId)}
                  aria-pressed={on}
                  className={cx(
                    "flex min-h-12 w-full items-center gap-3 px-5 py-2.5 text-left transition-colors",
                    on ? "bg-sunken/50" : "hover:bg-sunken/30",
                  )}
                >
                  <span
                    className={cx(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors",
                      on ? "border-transparent bg-signal text-white" : "border-line-strong",
                    )}
                    aria-hidden
                  >
                    {on && <Check className="size-3.5" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cx("block truncate text-body", on ? "font-medium text-ink" : "text-ink-2")}>
                      {a.name}
                    </span>
                    {a.position && <span className="block text-meta text-ink-4">{a.position}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        <button
          type="button"
          className="ctl-primary h-11"
          disabled={busy || gravado || escolhidos.size === 0}
          onClick={() => void gravar()}
        >
          {busy ? "A gravar…" : `Registar plantel (${escolhidos.size})`}
        </button>

        {gravado && (
          <span role="status" className="inline-flex items-center gap-1.5 text-meta font-medium text-ok">
            <Check className="size-4" strokeWidth={2.5} />
            Plantel registado
          </span>
        )}
        {collapsed && (
          <button type="button" className="ctl-ghost" onClick={() => setAberto(false)}>
            Cancelar
          </button>
        )}
        {erro && pool !== null && (
          <span role="alert" className="text-meta text-risk">
            {erro}
          </span>
        )}
      </div>
    </Panel>
  );
}

/* ========================================================================== */
/* Depois do jogo: a ficha                                                    */
/* ========================================================================== */

type Linha = Pick<SquadRow, "athleteId" | "minutes" | "started" | "tally" | "assists" | "yellowCards" | "redCard"> & {
  played: boolean;
};

/**
 * Quem jogou, quanto tempo, quem marcou, quem viu cartão.
 *
 * Um toque no nome põe o atleta em campo e abre a linha de registo dele — quem
 * ficou no banco fica por marcar, e é assim que fica registado que não jogou.
 * Os números **escrevem-se** (minutos, golos, assistências); só os amarelos são
 * botões, porque 0/1/2 é uma escolha e não um número que se escreva.
 */
function SheetPanel({ match, mayRecord, onSaved }: { match: Match; mayRecord: boolean; onSaved: () => void }) {
  const golo = tallyNoun(match.teamId);

  const [linhas, setLinhas] = useState<Record<string, Linha>>(() => daFicha(match));
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gravado, setGravado] = useState(false);

  useEffect(() => {
    setLinhas(daFicha(match));
  }, [match]);

  const set = (id: string, patch: Partial<Linha>) => setLinhas((x) => ({ ...x, [id]: { ...x[id], ...patch } }));

  const emCampo = Object.values(linhas).filter((l) => l.played);
  const golos = emCampo.reduce((n, l) => n + l.tally, 0);

  const mudou = useMemo(
    () =>
      match.squad.some((s) => {
        const l = linhas[s.athleteId];
        return (
          !l ||
          l.played !== s.played ||
          l.minutes !== s.minutes ||
          l.started !== s.started ||
          l.tally !== s.tally ||
          l.assists !== s.assists ||
          l.yellowCards !== s.yellowCards ||
          l.redCard !== s.redCard
        );
      }),
    [linhas, match.squad],
  );

  async function gravar() {
    setBusy(true);
    setErro(null);
    try {
      await saveAppearances(
        match.id,
        emCampo.map((l) => ({
          athleteId: l.athleteId,
          minutes: l.minutes,
          started: l.started,
          tally: l.tally,
          assists: l.assists,
          yellowCards: l.yellowCards,
          redCard: l.redCard,
        })),
      );
      setGravado(true);
      setTimeout(() => setGravado(false), 2000);
      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar a ficha.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHead
        title="Ficha de jogo"
        hint={`${emCampo.length} ${emCampo.length === 1 ? "jogou" : "jogaram"} · ${golos} ${golos === 1 ? golo : `${golo}s`}`}
      >
        {gravado && (
          <span className="flex items-center gap-1 text-meta text-ok">
            <Check className="size-3.5" strokeWidth={2} />
            gravado
          </span>
        )}
      </PanelHead>

      {mayRecord && (
        <p className="border-b border-line px-5 py-2.5 text-meta leading-relaxed text-ink-3">
          Toca no nome de quem entrou em campo e escreve os números. Quem ficou no banco fica por
          marcar — e é assim que fica registado que não jogou.
        </p>
      )}

      <ul>
        {match.squad.map((s) => (
          <SheetRow
            key={s.athleteId}
            atleta={s}
            linha={linhas[s.athleteId]}
            golo={golo}
            mayRecord={mayRecord}
            onChange={(patch) => set(s.athleteId, patch)}
          />
        ))}
      </ul>

      {mayRecord && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
          <button type="button" className="ctl-primary h-11" disabled={busy || !mudou} onClick={() => void gravar()}>
            {busy ? "A gravar…" : "Gravar ficha"}
          </button>
          {mudou && !busy && <span className="text-meta font-medium text-warn">Há alterações por gravar.</span>}
          {erro && (
            <span role="alert" className="text-meta text-risk">
              {erro}
            </span>
          )}
        </div>
      )}
    </Panel>
  );
}

function daFicha(match: Match): Record<string, Linha> {
  return Object.fromEntries(
    match.squad.map((s) => [
      s.athleteId,
      {
        athleteId: s.athleteId,
        played: s.played,
        minutes: s.minutes,
        started: s.started,
        tally: s.tally,
        assists: s.assists,
        yellowCards: s.yellowCards,
        redCard: s.redCard,
      },
    ]),
  );
}

function SheetRow({
  atleta,
  linha,
  golo,
  mayRecord,
  onChange,
}: {
  atleta: SquadRow;
  linha: Linha;
  golo: string;
  mayRecord: boolean;
  onChange: (p: Partial<Linha>) => void;
}) {
  const jogou = linha?.played ?? false;

  return (
    <li className={cx("border-b border-line last:border-b-0", jogou && "bg-sunken/30")}>
      <div className="flex items-center gap-3 px-5 py-2">
        <button
          type="button"
          disabled={!mayRecord}
          onClick={() => onChange({ played: !jogou, ...(jogou ? {} : { minutes: linha.minutes || 60, started: true }) })}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
          aria-pressed={jogou}
        >
          <span
            className={cx(
              "flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors",
              jogou ? "border-transparent bg-signal text-white" : "border-line-strong",
            )}
            aria-hidden
          >
            {jogou && <Check className="size-3.5" strokeWidth={3} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className={cx("block truncate text-body", jogou ? "font-medium text-ink" : "text-ink-3")}>
              {atleta.name}
            </span>
            <span className="block text-meta text-ink-4">
              {atleta.position ?? "sem posição"}
              {atleta.isGuest && ` · de ${atleta.guestFromTeam}`}
              {atleta.callUpStatus === "DECLINED" && " · tinha dito que não podia"}
            </span>
          </span>
        </button>

        {jogou && (
          <div className="flex shrink-0 items-center gap-1.5">
            {linha.redCard && <Pill tone="risk">vermelho</Pill>}
            {linha.yellowCards > 0 && !linha.redCard && (
              <Pill tone="warn">{linha.yellowCards === 2 ? "2 amarelos" : "amarelo"}</Pill>
            )}
            {linha.tally > 0 && (
              <Pill tone="ok">
                {linha.tally} {linha.tally === 1 ? golo : `${golo}s`}
              </Pill>
            )}
            <span className="w-12 text-right text-meta tabular text-ink-2">{linha.minutes}′</span>
          </div>
        )}
      </div>

      {jogou && mayRecord && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 border-t border-line/60 px-5 py-3 pl-14">
          <NumField label="Minutos" value={linha.minutes} max={300} wide onCommit={(n) => onChange({ minutes: n })} />
          <NumField
            label={golo === "golo" ? "Golos" : "Pontos"}
            value={linha.tally}
            max={99}
            onCommit={(n) => onChange({ tally: n })}
          />
          <NumField label="Assist." value={linha.assists} max={99} onCommit={(n) => onChange({ assists: n })} />

          <SmallToggle on={linha.started} onClick={() => onChange({ started: !linha.started })}>
            Titular
          </SmallToggle>

          {/* Amarelos são uma escolha 0/1/2, não um número que se escreva. */}
          <div className="flex items-center gap-1.5">
            <span className="text-meta text-ink-3">Amarelos</span>
            <div className="flex rounded-[var(--radius-control)] border border-line p-0.5" role="group" aria-label="Cartões amarelos">
              {[0, 1, 2].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={linha.yellowCards === n}
                  onClick={() => onChange({ yellowCards: n })}
                  className={cx(
                    "min-h-9 min-w-9 rounded-[6px] px-2 text-meta font-medium transition-colors",
                    linha.yellowCards === n ? "bg-warn text-white" : "text-ink-3 hover:text-ink",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <SmallToggle on={linha.redCard} tone="risk" onClick={() => onChange({ redCard: !linha.redCard })}>
            Vermelho
          </SmallToggle>
        </div>
      )}
    </li>
  );
}

/**
 * Um número que se escreve.
 *
 * Guarda o texto enquanto se escreve — apagar tudo para escrever outro número
 * não pode fazer o campo saltar para 0 — e só compromete ao sair do campo, já
 * validado e preso ao limite.
 */
function NumField({
  label,
  value,
  onCommit,
  max,
  wide,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
  max: number;
  wide?: boolean;
}) {
  const [texto, setTexto] = useState(String(value));

  useEffect(() => {
    setTexto(String(value));
  }, [value]);

  function commit() {
    const n = Math.max(0, Math.min(max, Number(texto) || 0));
    setTexto(String(n));
    if (n !== value) onCommit(n);
  }

  return (
    <label className="flex items-center gap-2">
      <span className="text-meta text-ink-3">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={3}
        value={texto}
        onChange={(e) => setTexto(e.target.value.replace(/\D/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={cx(
          "h-10 rounded-[8px] border border-line bg-surface text-center text-body font-medium tabular text-ink outline-none transition-colors focus:border-line-strong",
          wide ? "w-16" : "w-12",
        )}
      />
    </label>
  );
}

function SmallToggle({
  on,
  tone = "signal",
  onClick,
  children,
}: {
  on: boolean;
  tone?: "signal" | "risk";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cx(
        "min-h-10 rounded-[var(--radius-control)] border px-3 text-meta font-medium transition-colors",
        on
          ? tone === "risk"
            ? "border-transparent bg-risk text-white"
            : "border-transparent bg-ink text-surface"
          : "border-line text-ink-3 hover:border-line-strong hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/* ========================================================================== */
/* A equipa de trabalho                                                       */
/* ========================================================================== */

/**
 * A equipa de trabalho do jogo.
 *
 * ## O texto muda com o relógio
 *
 * Dizia "Junta quem **esteve** no jogo" — num jogo marcado para sábado, a quem
 * está a escalar a equipa de trabalho com dias de antecedência. Escalar é quase
 * sempre um acto anterior ao jogo: o pretérito só é verdade na metade das vezes,
 * e na outra metade lê-se como se o produto não soubesse em que dia estamos.
 *
 * Antes do apito é "vai estar", depois é "esteve". A mesma regra que já decide se
 * a página mostra a convocatória ou a ficha.
 */
function StaffPanel({
  match,
  passou,
  mayRecord,
  onSaved,
}: {
  match: Match;
  passou: boolean;
  mayRecord: boolean;
  onSaved: () => void;
}) {
  const [pool, setPool] = useState<{ membershipId: string; name: string; role: string | null }[]>([]);
  const [rows, setRows] = useState(match.staff.map((s) => ({ membershipId: s.membershipId, role: s.role })));
  const [aAdicionar, setAAdicionar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /*
   * Quem acabou de ser juntado, por dois segundos.
   *
   * Sem isto, juntar alguém era mudo: o formulário fechava-se e aparecia mais uma
   * linha numa lista — e uma linha a mais numa lista de três não é um sinal, é uma
   * coisa que se descobre a contar. Quem carrega num botão precisa de saber se ele
   * fez alguma coisa, e a resposta tem de chegar onde o olho já está: na linha da
   * pessoa que acabou de escolher.
   *
   * Dois segundos e volta ao botão de apagar. Um visto permanente seria uma
   * segunda coluna de ruído em cada linha, e ao fim de um minuto ninguém saberia
   * o que ele quer dizer.
   */
  const [acabado, setAcabado] = useState<string | null>(null);
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setRows(match.staff.map((s) => ({ membershipId: s.membershipId, role: s.role })));
  }, [match.staff]);

  // Um temporizador pendente quando o painel desaparece deixava um `setState` a
  // apontar para um componente que já não existe.
  useEffect(
    () => () => {
      if (relogio.current) clearTimeout(relogio.current);
    },
    [],
  );

  useEffect(() => {
    if (!mayRecord) return;
    staffPool()
      .then(setPool)
      .catch(() => {
        /* sem pool: o painel mostra o que está e não deixa acrescentar */
      });
  }, [mayRecord]);

  const nome = (id: string) =>
    pool.find((p) => p.membershipId === id)?.name ?? match.staff.find((s) => s.membershipId === id)?.name ?? "—";
  const disponivel = pool.filter((p) => !rows.some((r) => r.membershipId === p.membershipId));

  /**
   * Grava a lista inteira.
   *
   * `juntou` é o id de quem entrou agora, quando foi uma adição — é ele que
   * acende o visto. Numa remoção fica em branco: a linha desaparece, e o
   * desaparecimento **é** a confirmação.
   */
  async function gravar(next: { membershipId: string; role: string }[], juntou?: string) {
    setRows(next);
    setBusy(true);
    setErro(null);
    try {
      await saveMatchStaff(match.id, next);

      /*
       * O visto só acende **depois** de o servidor confirmar.
       *
       * Acendê-lo ao carregar seria mentir metade das vezes: se a gravação
       * falhasse, a pessoa tinha visto um certo e a linha desaparecia a seguir.
       */
      if (juntou) {
        if (relogio.current) clearTimeout(relogio.current);
        setAcabado(juntou);
        relogio.current = setTimeout(() => setAcabado(null), 2000);
      }

      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar.");
      setRows(match.staff.map((s) => ({ membershipId: s.membershipId, role: s.role })));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHead title="Equipa de trabalho" hint={rows.length > 0 ? `${rows.length}` : undefined}>
        {mayRecord && disponivel.length > 0 && !aAdicionar && (
          <button type="button" className="ctl-ghost" onClick={() => setAAdicionar(true)}>
            <Plus className="size-3.5" strokeWidth={2} />
            Juntar
          </button>
        )}
      </PanelHead>

      {rows.length === 0 && !aAdicionar ? (
        <p className="px-5 py-4 text-meta leading-relaxed text-ink-3">
          Ninguém atribuído. Junta quem {passou ? "esteve" : "vai estar"} no jogo — treinadores,
          massagista, delegado.
        </p>
      ) : (
        <ul>
          {rows.map((r) => {
            const novo = acabado === r.membershipId;
            return (
              <li
                key={r.membershipId}
                className={cx(
                  "flex min-h-12 items-center gap-3 border-b border-line px-5 py-2 transition-colors duration-300 last:border-b-0 motion-reduce:transition-none",
                  // A linha inteira acende, e não só o canto: é o que faz o olho
                  // aterrar na pessoa certa sem a procurar.
                  novo && "bg-ok-soft",
                )}
              >
                <Monograma nome={nome(r.membershipId)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body text-ink">{nome(r.membershipId)}</div>
                  <div className="text-meta text-ink-3">{r.role}</div>
                </div>

                {novo ? (
                  /*
                   * Ocupa o mesmo lugar do botão de apagar, com a mesma medida.
                   * Se fosse um elemento a mais, a linha mexia-se ao acender e
                   * outra vez ao apagar — e o salto rouba a atenção ao sinal.
                   */
                  <span
                    role="status"
                    className="flex size-8 shrink-0 items-center justify-center text-ok"
                    aria-label={`${nome(r.membershipId)} juntado ao jogo`}
                  >
                    <Check className="size-4" strokeWidth={2.5} />
                  </span>
                ) : (
                  mayRecord && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void gravar(rows.filter((x) => x.membershipId !== r.membershipId))}
                      className="ctl-ghost shrink-0 text-ink-3 hover:text-risk"
                      aria-label={`Tirar ${nome(r.membershipId)}`}
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}

      {aAdicionar && (
        <AddStaff
          pool={disponivel}
          passou={passou}
          onCancel={() => setAAdicionar(false)}
          onAdd={(membershipId, role) => {
            setAAdicionar(false);
            void gravar([...rows, { membershipId, role }], membershipId);
          }}
        />
      )}

      {erro && (
        <p role="alert" className="border-t border-line px-5 py-2.5 text-meta text-risk">
          {erro}
        </p>
      )}
    </Panel>
  );
}

/** As iniciais num círculo da cor do clube. Um rosto sem precisar de fotografia. */
function Monograma({ nome }: { nome: string }) {
  const iniciais = nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
      style={{ background: "var(--signal)" }}
    >
      {iniciais || "?"}
    </span>
  );
}

function AddStaff({
  pool,
  passou,
  onAdd,
  onCancel,
}: {
  pool: { membershipId: string; name: string; role: string | null }[];
  passou: boolean;
  onAdd: (membershipId: string, role: string) => void;
  onCancel: () => void;
}) {
  const [quem, setQuem] = useState("");
  const [role, setRole] = useState("");

  const escolhido = pool.find((p) => p.membershipId === quem);

  return (
    <div className="space-y-2 border-t border-line bg-sunken/40 px-5 py-3">
      <label className="block">
        <span className="mb-1 block text-meta font-medium text-ink-2">
          {passou ? "Quem esteve no jogo?" : "Quem vai estar no jogo?"}
        </span>
        <select
          autoFocus
          value={quem}
          onChange={(e) => {
            setQuem(e.target.value);
            const p = pool.find((x) => x.membershipId === e.target.value);
            if (p?.role) setRole(p.role);
          }}
          className="h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-body text-ink outline-none focus:border-line-strong"
        >
          <option value="">Escolher…</option>
          {pool.map((p) => (
            <option key={p.membershipId} value={p.membershipId}>
              {p.name}
              {p.role ? ` — ${p.role}` : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-meta font-medium text-ink-2">A fazer o quê?</span>
        <input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          list="funcoes-jogo"
          placeholder="Massagista, delegado ao jogo…"
          className="h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-body text-ink outline-none placeholder:text-ink-4 focus:border-line-strong"
        />
      </label>
      <datalist id="funcoes-jogo">
        {STAFF_ROLES.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      <div className="flex gap-2 pt-1">
        <button type="button" className="ctl-ghost h-10" onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="button"
          className="ctl-primary h-10"
          disabled={!escolhido || role.trim().length === 0}
          onClick={() => onAdd(quem, role.trim())}
        >
          Juntar ao jogo
        </button>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Os factos                                                                  */
/* ========================================================================== */

function FactsPanel({ match, passou }: { match: Match; passou: boolean }) {
  const inicio = new Date(match.startsAt);

  return (
    <Panel>
      <PanelHead title="Detalhes" />
      <dl className="space-y-3 px-5 py-4 text-meta">
        <Facto icon={<Clock className="size-3.5" strokeWidth={1.75} />} label="Quando">
          {inicio.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" })} às{" "}
          {inicio.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}
        </Facto>
        <Facto icon={<MapPin className="size-3.5" strokeWidth={1.75} />} label="Onde">
          {match.venue} · {match.isHome ? "em casa" : "fora"}
        </Facto>
        <Facto icon={<Trophy className="size-3.5" strokeWidth={1.75} />} label="Escalão">
          <Link to={`/equipas/${match.teamId}`} className="text-ink underline-offset-2 hover:underline">
            {match.teamName}
          </Link>
        </Facto>
        {match.coachName && (
          <Facto icon={<Whistle className="size-3.5" strokeWidth={1.75} />} label="Treinador">
            {match.coachName}
          </Facto>
        )}
      </dl>

      {/*
        De onde veio o jogo. Quem abre a página tem de perceber, sem perguntar,
        se o resultado foi escrito por um colega ou veio de fora — e isso passa a
        acontecer quando a integração (ZeroZero, FPF) existir.
      */}
      <div className="border-t border-line px-5 py-3 text-meta leading-relaxed text-ink-3">
        {match.source ? (
          <>
            Importado de <span className="text-ink-2">{match.source.provider}</span>
            {match.source.url && (
              <>
                {" · "}
                <a
                  href={match.source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-ink underline-offset-2 hover:underline"
                >
                  ver lá
                  <ExternalLink className="size-3" strokeWidth={1.75} />
                </a>
              </>
            )}
          </>
        ) : match.statsEnteredAt ? (
          <>Ficha preenchida à mão em {new Date(match.statsEnteredAt).toLocaleDateString("pt-PT")}.</>
        ) : (
          /*
            Mesma armadilha do painel do staff: "a ficha ainda não foi
            preenchida" é uma queixa quando o jogo já foi, e um disparate quando
            ele é para sábado — não há ficha por preencher de um jogo que ainda
            não aconteceu.
          */
          <>Marcado à mão.{passou ? " A ficha ainda não foi preenchida." : ""}</>
        )}
      </div>
    </Panel>
  );
}

function Facto({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0 text-ink-4">{icon}</span>
      <div className="min-w-0">
        <dt className="text-ink-4">{label}</dt>
        <dd className="text-ink-2">{children}</dd>
      </div>
    </div>
  );
}
