import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Empty, Loading, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { Segmented } from "@/components/filters";
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
import { sportById, teamById } from "@/lib/api";
import { tallyNoun } from "@/lib/calendar";
import { SaveVeil, Spinner, useSaving } from "@/components/Busy";
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

  /*
   * O resultado escreve-se **entre os nomes**, e grava-se por baixo do traco.
   *
   * O estado vive aqui e nao no bloco de baixo porque as duas metades sao a
   * mesma coisa: os campos no meio do marcador e o botao no rodape. Com um
   * componente por metade, cada uma teria o seu estado e escrever nos campos
   * nao acendia o botao.
   */
  const escrevivel = passou && !cancelado && mayRecord;
  const r = useResultado(match, onSaved);

  return (
    <Panel className="overflow-hidden">
      {/* A faixa do clube. 3px — identidade, não decoração. */}
      <div aria-hidden className="h-[3px] w-full" style={{ background: "var(--color-signal)" }} />

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
            {escrevivel ? (
              <>
                <ScoreInputs match={match} r={r} />
                {/* O selo de vitoria/empate/derrota nao desaparece so por o
                    resultado estar editavel — e a leitura do jogo, nao do modo. */}
                {temResultado && res && <OutcomePill res={res} />}
              </>
            ) : temResultado ? (
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
                {res && <OutcomePill res={res} />}
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

        {escrevivel && <ResultActions r={r} />}

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
function useResultado(match: Match, onSaved: () => void) {
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

  return {
    nos, setNos, eles, setEles,
    busy, erro, gravado, valido, mudou, temResultado,
    confirmarApagar, setConfirmarApagar,
    gravar, apagar,
  };
}

/**
 * O marcador escrevivel, no lugar do resultado.
 *
 * ## Porque e que os campos subiram para o meio
 *
 * Estavam numa segunda fila por baixo do traco, com o nome de cada equipa
 * repetido por cima de cada caixa — os mesmos dois nomes que ja estavam em
 * grande, dois centimetros acima. Lia-se duas vezes a mesma coisa e o numero
 * ficava longe das equipas a que pertence.
 *
 * ## A ordem, que estava trocada
 *
 * A segunda fila era sempre "nos - eles". O cabecalho e sempre "casa - fora".
 * Num jogo fora, as duas leem-se ao contrario uma da outra: o ecra dizia
 * "CD Fao — Sub-11" em cima e pedia "Sub-11 [ ] - [ ] CD Fao" em baixo. Aqui os
 * campos seguem a casa e o fora, que e a unica ordem que um marcador tem.
 */
function ScoreInputs({
  match,
  r,
}: {
  match: Match;
  r: ReturnType<typeof useResultado>;
}) {
  // Esquerda e sempre a casa. Em casa, a casa somos nos; fora, e o adversario.
  const esquerda = match.isHome
    ? { value: r.nos, onChange: r.setNos }
    : { value: r.eles, onChange: r.setEles };
  const direita = match.isHome
    ? { value: r.eles, onChange: r.setEles }
    : { value: r.nos, onChange: r.setNos };

  return (
    <div className="flex items-center justify-center gap-2 sm:gap-3">
      <ScoreField {...esquerda} disabled={r.busy} label={match.isHome ? match.teamName : match.opponent} />
      <span className="text-[28px] leading-none font-light text-ink-4 sm:text-[36px]" aria-hidden>
        –
      </span>
      <ScoreField {...direita} disabled={r.busy} label={match.isHome ? match.opponent : match.teamName} />
    </div>
  );
}

/** O botao e o que o acompanha — por baixo do traco, ao centro. */
function ResultActions({ r }: { r: ReturnType<typeof useResultado> }) {
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          className="ctl-primary h-11 px-5"
          disabled={r.busy || !r.mudou || !r.valido}
          onClick={() => void r.gravar()}
        >
          {r.busy ? "A gravar…" : r.temResultado ? "Gravar" : "Registar resultado"}
        </button>
        {r.gravado && !r.busy && (
          <span className="inline-flex items-center gap-1 text-meta text-ok">
            <Check className="size-3.5" strokeWidth={2} />
            gravado
          </span>
        )}
      </div>

      {r.erro && (
        <p role="alert" className="mt-2 text-center text-meta text-risk">
          {r.erro}
        </p>
      )}

      {r.temResultado && (
        <div className="mt-3 text-center">
          {r.confirmarApagar ? (
            <span className="inline-flex items-center gap-2 text-meta">
              <span className="text-ink-2">Apagar o resultado e voltar a "por jogar"?</span>
              <button type="button" className="ctl-ghost h-8" onClick={() => r.setConfirmarApagar(false)}>
                Não
              </button>
              <button type="button" className="ctl-risk h-8" disabled={r.busy} onClick={() => void r.apagar()}>
                Apagar
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => r.setConfirmarApagar(true)}
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

/** Vitoria, empate ou derrota — o mesmo selo, com ou sem o marcador editavel. */
function OutcomePill({ res }: { res: NonNullable<ReturnType<typeof outcome>> }) {
  return (
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
  );
}

/**
 * Um campo do marcador.
 *
 * O nome da equipa deixou de se ver e continua a ouvir-se. Os campos passaram
 * para o meio do marcador, e ali os dois nomes ja estao em grande dos dois lados
 * — repeti-los por cima das caixas era escrever a mesma coisa duas vezes, a dois
 * centimetros de distancia. `sr-only` guarda o rotulo para quem usa leitor de
 * ecra, que nao tem os nomes ao lado.
 */
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
      <span className="sr-only">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        value={value}
        placeholder="0"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        className="h-14 w-20 rounded-[10px] border border-line bg-surface text-center text-[28px] font-semibold tabular text-ink outline-none transition-colors placeholder:text-ink-4/50 focus:border-line-strong focus:ring-2 focus:ring-[color-mix(in_oklab,var(--color-signal-line,var(--color-signal))_45%,transparent)]"
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
                      on ? "border-transparent bg-signal-strong text-signal-on" : "border-line-strong",
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

/**
 * O que um atleta foi neste jogo. É **a** pergunta da ficha.
 *
 * Substituiu um par de controlos que a faziam de lado: um visto "jogou" e, lá
 * dentro, um interruptor "Titular". Duas perguntas para uma resposta só, e
 * nenhuma delas era a que o treinador tem na cabeça — que é esta, com três
 * respostas possíveis e nenhuma sobreposta.
 */
type Papel = "titular" | "entrou" | "nao";

type Linha = Pick<
  SquadRow,
  | "athleteId" | "minutes" | "tally" | "assists" | "yellowCards" | "redCard"
  | "onMinute" | "offMinute" | "yellowAt" | "redAt" | "tallyAt" | "assistsAt"
> & {
  papel: Papel;
};

/** Titular e suplente utilizado entram na ficha; quem não jogou não tem linha. */
const jogou = (l: Linha) => l.papel !== "nao";

const FALTA_ENTRADA = "Falta dizer ao minuto que entrou — é daí que saem os minutos jogados.";

/**
 * A única pergunta que a ficha passou a fazer a sério.
 *
 * Desde que os minutos são calculados e não escritos, um suplente sem minuto de
 * entrada é uma linha sem minutos — e gravá-la assim punha um zero no currículo
 * de um miúdo que jogou. Só se pede a quem foi lançado do banco, e só depois de
 * o treinador dizer que ele entrou.
 *
 * Vive à parte de `incoerencias` porque o campo que a resolve não está no painel
 * de detalhe, e é isso que decide se vale a pena abri-lo sozinho.
 */
function faltaEntrada(l: Linha): boolean {
  return l.papel === "entrou" && l.onMinute == null;
}

/**
 * O que, nesta linha, aconteceu fora do tempo em que o atleta esteve em campo.
 *
 * Gémeo de `foraDeCampo` no servidor — a mesma regra escrita dos dois lados, de
 * propósito: aqui para avisar enquanto se escreve, lá para recusar. Um golo aos
 * 60 de quem saiu aos 50 não é um dado, é um erro de escrita, e o treinador tem
 * de o ver **antes** de carregar em Gravar.
 */
function incoerencias(l: Linha): string[] {
  if (!jogou(l)) return [];

  const de = l.papel === "titular" ? 0 : (l.onMinute ?? 0);
  const ate = l.offMinute ?? Infinity;
  const fora: string[] = [];

  if (l.onMinute != null && l.offMinute != null && l.offMinute < l.onMinute) {
    fora.push(`Saiu ao ${l.offMinute}′, antes de ter entrado (${l.onMinute}′).`);
  }

  if (faltaEntrada(l)) fora.push(FALTA_ENTRADA);

  for (const [nome, minutos] of [
    ["golo", l.tallyAt],
    ["assistência", l.assistsAt],
    ["amarelo", l.yellowAt],
    ["vermelho", l.redAt == null ? [] : [l.redAt]],
  ] as [string, number[]][]) {
    for (const m of minutos) {
      if (m < de) fora.push(`${nome} ao ${m}′, mas entrou ao ${de}′.`);
      else if (m > ate) fora.push(`${nome} ao ${m}′, mas saiu ao ${ate}′.`);
    }
  }

  return fora;
}

/**
 * Os minutos jogados. Sempre calculados, nunca escritos.
 *
 * ## Porque é que deixou de haver campo
 *
 * Havia dois sítios a afirmar a mesma coisa: um campo "Minutos" que o treinador
 * escrevia e uma conta a partir da entrada e da saída. Quando discordavam — e
 * discordavam, porque ninguém volta atrás a acertar o primeiro depois de
 * preencher os segundos — ficava gravado o número escrito à mão, e era esse que
 * ia parar aos totais da época. Um número que ninguém consegue justificar é
 * pior do que nenhum.
 *
 * Agora entra-se pelos factos — começou ou entrou, e quando saiu — e o tempo
 * sai daí. Um titular sem minuto de saída jogou o jogo todo, que é a leitura
 * certa em quase todos os jogos de formação e a única que não inventa nada.
 *
 * ## O caso em que devolve `null`
 *
 * Um suplente sem minuto de entrada. Aí o sistema não sabe — pode ter entrado
 * ao 10 ou ao 80 — e a resposta honesta é dizer que não sabe, em vez de somar
 * um número plausível. É a única pergunta que a ficha passa a fazer a sério, e
 * só a quem foi lançado do banco.
 */
function minutosDerivados(l: Linha, duracao: number): number | null {
  const entrada = l.papel === "titular" ? 0 : l.onMinute;
  if (entrada == null) return null;
  const saida = l.offMinute ?? duracao;
  return Math.max(0, saida - entrada);
}

/**
 * Quem jogou, quanto tempo, quem marcou, quem viu cartão — e a que minutos.
 *
 * ## A forma segue a pergunta
 *
 * Cada linha começa por **Titular / Entrou / Não jogou**, que é a primeira coisa
 * que um treinador sabe e a única que ele é obrigado a dizer. Escolhida a
 * resposta, a linha mostra o essencial (golos, minutos) e esconde o resto atrás
 * de "detalhes" — os minutos de entrada e saída, os minutos dos cartões.
 *
 * ## Nada disto é obrigatório
 *
 * Um treinador que só queira dizer "estes onze jogaram" fecha a ficha em onze
 * toques. Quem quiser a ficha federada completa tem onde a escrever. O que não
 * se faz é pedir os dois ao mesmo: os campos de minuto só existem depois de
 * alguém pedir para os ver.
 *
 * ## Os minutos calculam-se sozinhos
 *
 * Registada a entrada e a saída, os minutos derivam daí e o campo passa a ser
 * uma confirmação, não uma conta de cabeça. Sem esse detalhe, escrevem-se à mão
 * como antes.
 */
function SheetPanel({ match, mayRecord, onSaved }: { match: Match; mayRecord: boolean; onSaved: () => void }) {
  const golo = tallyNoun(match.teamId);
  /*
   * Quanto dura um jogo desta modalidade.
   *
   * Vem de `Sport.matchMinutes` — o futebol de formação não joga 90, e o produto
   * já sabe isso. Serve para calcular os minutos de quem entrou e não saiu, e
   * para não sugerir "90" a um Sub-11 que joga 60.
   */
  const duracao = sportById(teamById(match.teamId)?.sportId ?? "")?.matchMinutes ?? 90;

  const [linhas, setLinhas] = useState<Record<string, Linha>>(() => daFicha(match));
  const [erro, setErro] = useState<string | null>(null);
  const { estado, gravar: correr, aGravar: busy } = useSaving();

  useEffect(() => {
    setLinhas(daFicha(match));
  }, [match]);

  const set = (id: string, patch: Partial<Linha>) => setLinhas((x) => ({ ...x, [id]: { ...x[id], ...patch } }));

  const emCampo = Object.values(linhas).filter(jogou);
  const golos = emCampo.reduce((n, l) => n + l.tally, 0);
  const titulares = emCampo.filter((l) => l.papel === "titular").length;
  /*
   * Quantas linhas não fecham.
   *
   * Trava o Gravar. O servidor recusa as contradições de qualquer maneira, mas
   * descobrir isso depois de carregar no botão — com um erro genérico no fundo
   * do painel — era mandar o treinador procurar em vinte linhas qual delas
   * estava errada. Contam-se à parte os suplentes a quem falta o minuto de
   * entrada, porque a frase que os resolve é outra.
   */
  const contraditorias = emCampo.filter((l) => incoerencias(l).some((p) => p !== FALTA_ENTRADA)).length;
  const semEntrada = emCampo.filter(faltaEntrada).length;
  const porCorrigir = contraditorias + semEntrada;

  /*
   * A ficha contra o marcador.
   *
   * Quatro golos num 3-2 não é uma discordância de opinião — é um dedo no sítio
   * errado que fica a viver no perfil do atleta e nos totais da época. O tecto
   * das assistências é o mesmo número porque cada golo tem no máximo uma, e há
   * golos sem nenhuma; é generoso de propósito, para apertar o impossível sem
   * discutir com o treinador sobre quem assistiu o quê.
   *
   * Sem resultado registado não há com que confrontar — marcar a ficha primeiro
   * e o resultado depois é uma ordem legítima de trabalho, e é por isso que isto
   * não obriga a nada, só recusa o impossível.
   */
  const assistencias = emCampo.reduce((n, l) => n + l.assists, 0);
  const excedeMarcador =
    match.ourScore === null
      ? null
      : golos > match.ourScore
        ? `A ficha atribui ${golos} ${golos === 1 ? "golo" : "golos"} e o jogo ficou ${match.ourScore}-${match.theirScore}.`
        : assistencias > match.ourScore
          ? `A ficha atribui ${assistencias} assistências para ${match.ourScore} ${match.ourScore === 1 ? "golo" : "golos"} marcados.`
          : null;

  const mudou = useMemo(
    () =>
      match.squad.some((s) => {
        const l = linhas[s.athleteId];
        if (!l) return true;
        const papelAntes: Papel = !s.played ? "nao" : s.started ? "titular" : "entrou";
        if (l.papel !== papelAntes) return true;

        /*
         * Quem não jogou não tem ficha para comparar.
         *
         * Sem esta linha, uma ficha por abrir dizia "Há alterações por gravar"
         * mal se entrava na página. `minutosDerivados` devolve `null` para quem
         * não entrou em campo — não há minuto de entrada de onde partir — e o
         * que está gravado é `0`. `null !== 0` dava alteração em **todas** as
         * linhas de uma convocatória ainda por preencher, que é precisamente o
         * caso em que ninguém mexeu em nada.
         *
         * Os restantes campos de uma linha destas não se comparam por serem
         * inalcançáveis: com "não jogou" escolhido, a linha não mostra golos nem
         * minutos, e a gravação só envia `emCampo`. Compará-los era inventar
         * diferenças em números que ninguém pode ter mudado.
         */
        if (l.papel === "nao") return false;

        return (
          // Os minutos já não se escrevem, comparam-se calculados: assim uma
          // ficha antiga com um número à mão que discorda da entrada e da saída
          // acende o Gravar, em vez de ficar por corrigir para sempre.
          minutosDerivados(l, duracao) !== s.minutes ||
          l.tally !== s.tally ||
          l.assists !== s.assists ||
          l.yellowCards !== s.yellowCards ||
          l.redCard !== s.redCard ||
          l.onMinute !== s.onMinute ||
          l.offMinute !== s.offMinute ||
          l.redAt !== s.redAt ||
          l.yellowAt.join() !== s.yellowAt.join() ||
          // Sem estes dois, escrever só o minuto de um golo não acendia o
          // Gravar e o trabalho perdia-se ao mudar de página.
          l.tallyAt.join() !== s.tallyAt.join() ||
          l.assistsAt.join() !== s.assistsAt.join()
        );
      }),
    [linhas, match.squad],
  );

  async function gravar() {
    setErro(null);
    try {
      await correr(async () => {
        await saveAppearances(
          match.id,
          emCampo.map((l) => ({
            athleteId: l.athleteId,
            // Os minutos vêm sempre da conta. O `?? 0` nunca chega a acontecer —
            // `porCorrigir` trava o botão enquanto houver um suplente sem minuto
            // de entrada — mas é o valor certo se alguma vez chegar: zero e não um
            // palpite.
            minutes: minutosDerivados(l, duracao) ?? 0,
            started: l.papel === "titular",
            tally: l.tally,
            assists: l.assists,
            yellowCards: l.yellowCards,
            redCard: l.redCard,
            ...(l.onMinute != null && l.papel === "entrou" ? { onMinute: l.onMinute } : {}),
            ...(l.offMinute != null ? { offMinute: l.offMinute } : {}),
            ...(l.yellowAt.length > 0 ? { yellowAt: l.yellowAt } : {}),
            ...(l.redAt != null ? { redAt: l.redAt } : {}),
            ...(l.tallyAt.length > 0 ? { tallyAt: l.tallyAt } : {}),
            ...(l.assistsAt.length > 0 ? { assistsAt: l.assistsAt } : {}),
          })),
        );
        onSaved();
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar a ficha.");
    }
  }

  return (
    <Panel>
      {/*
        O véu cobre o painel inteiro, cabeçalho incluído.

        Enquanto grava, nada aqui dentro é verdade: o resumo do cabeçalho conta
        os titulares do que está no ecrã, e o que está no ecrã ainda não é o que
        ficou gravado. Desfocar as linhas e deixar o cabeçalho nítido dava a
        impressão de que aquela contagem já era o resultado.
      */}
      <SaveVeil estado={estado}>
        <PanelHead
          title="Ficha de jogo"
          hint={
            emCampo.length === 0
              ? "por preencher"
              : `${titulares} ${titulares === 1 ? "titular" : "titulares"} · ${emCampo.length - titulares} ${
                  emCampo.length - titulares === 1 ? "suplente" : "suplentes"
                } · ${golos} ${golos === 1 ? golo : `${golo}s`}`
          }
        />

        {mayRecord && (
          <p className="border-b border-line px-5 py-2.5 text-meta leading-relaxed text-ink-3">
            Diz de cada um se foi <span className="font-medium text-ink-2">titular</span>, se{" "}
            <span className="font-medium text-ink-2">entrou</span> do banco, ou se{" "}
            <span className="font-medium text-ink-2">não jogou</span>. Só isso já fecha a ficha — os minutos de
            substituição e de cartões ficam em "Substituição e cartões", para quem os quiser registar.
          </p>
        )}

        <ul>
          {match.squad.map((s) => (
            <SheetRow
              key={s.athleteId}
              atleta={s}
              linha={linhas[s.athleteId]}
              golo={golo}
              duracao={duracao}
              mayRecord={mayRecord}
              onChange={(patch) => set(s.athleteId, patch)}
            />
          ))}
        </ul>

        {mayRecord && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
            <button
              type="button"
              className="ctl-primary h-11"
              disabled={busy || !mudou || porCorrigir > 0 || excedeMarcador !== null}
              onClick={() => void gravar()}
            >
              Gravar ficha
            </button>
            {excedeMarcador ? (
              <span className="text-meta font-medium text-risk">{excedeMarcador}</span>
            ) : contraditorias > 0 ? (
              <span className="text-meta font-medium text-risk">
                {contraditorias === 1
                  ? "Há uma linha com minutos impossíveis — corrige-a para gravar."
                  : `Há ${contraditorias} linhas com minutos impossíveis — corrige-as para gravar.`}
              </span>
            ) : semEntrada > 0 ? (
              <span className="text-meta font-medium text-risk">
                {semEntrada === 1
                  ? "Falta o minuto de entrada de um suplente — sem ele não há minutos para gravar."
                  : `Faltam os minutos de entrada de ${semEntrada} suplentes — sem eles não há minutos para gravar.`}
              </span>
            ) : (
              mudou && !busy && <span className="text-meta font-medium text-warn">Há alterações por gravar.</span>
            )}
            {erro && (
              <span role="alert" className="text-meta text-risk">
                {erro}
              </span>
            )}
          </div>
        )}
      </SaveVeil>
    </Panel>
  );
}

function daFicha(match: Match): Record<string, Linha> {
  return Object.fromEntries(
    match.squad.map((s) => [
      s.athleteId,
      {
        athleteId: s.athleteId,
        // Os dois campos antigos colapsam num: não jogou / entrou / titular.
        papel: !s.played ? "nao" : s.started ? "titular" : "entrou",
        minutes: s.minutes,
        tally: s.tally,
        assists: s.assists,
        yellowCards: s.yellowCards,
        redCard: s.redCard,
        onMinute: s.onMinute,
        offMinute: s.offMinute,
        yellowAt: s.yellowAt,
        redAt: s.redAt,
        tallyAt: s.tallyAt,
        assistsAt: s.assistsAt,
      } satisfies Linha,
    ]),
  );
}

const PAPEIS: { value: Papel; label: string; hint: string }[] = [
  { value: "titular", label: "Titular", hint: "Começou o jogo" },
  { value: "entrou", label: "Entrou", hint: "Saiu do banco" },
  { value: "nao", label: "Não jogou", hint: "Ficou no banco" },
];

function SheetRow({
  atleta,
  linha,
  golo,
  duracao,
  mayRecord,
  onChange,
}: {
  atleta: SquadRow;
  linha: Linha;
  golo: string;
  duracao: number;
  mayRecord: boolean;
  onChange: (p: Partial<Linha>) => void;
}) {
  const [detalhe, setDetalhe] = useState(false);
  const emCampo = jogou(linha);
  const derivados = minutosDerivados(linha, duracao);
  const problemas = incoerencias(linha);

  // Uma contradição escondida atrás de um painel fechado é uma contradição que
  // ninguém corrige: abre-se o detalhe, que é onde estão os campos em causa. O
  // minuto de entrada em falta não conta — resolve-se na linha de cima, e abrir
  // o painel a cada suplente marcado só dava ruído.
  const noDetalhe = problemas.filter((p) => p !== FALTA_ENTRADA).length;
  useEffect(() => {
    if (noDetalhe > 0) setDetalhe(true);
  }, [noDetalhe]);

  /**
   * Escolher o papel arruma o resto.
   *
   * Passar a titular limpa o minuto de entrada (um titular entra aos 0, e um 63
   * ali seria uma contradição). Deixar de jogar limpa tudo — golos de quem não
   * entrou em campo é a linha que faz um pai telefonar.
   */
  function escolher(papel: Papel) {
    if (papel === "nao") {
      onChange({
        papel,
        minutes: 0, tally: 0, assists: 0, yellowCards: 0, redCard: false,
        onMinute: null, offMinute: null, yellowAt: [], redAt: null,
      });
      return;
    }
    // Um titular entra aos 0, e um 63 no minuto de entrada seria uma contradição.
    // Os minutos já não se guardam aqui: saem de `minutosDerivados`.
    onChange({ papel, ...(papel === "titular" ? { onMinute: null } : {}) });
  }

  return (
    <li className="border-b border-line last:border-b-0">
      {/*
        A linha da pessoa e o registo do jogo dela são duas coisas, e agora
        parecem-no.

        Tinham o mesmo fundo, e num jogo com vinte atletas isso dava uma parede
        onde não se via onde acabava um jogador e começava o seguinte — as
        estatísticas de um pareciam pertencer ao nome de baixo. O nome fica no
        fundo levantado, os números no fundo da superfície.
      */}
      <div
        className={cx(
          "flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5",
          emCampo && "bg-sunken/60",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className={cx("block truncate text-body", emCampo ? "font-medium text-ink" : "text-ink-3")}>
            {atleta.name}
          </span>
          <span className="block text-meta text-ink-4">
            {atleta.position ?? "sem posição"}
            {atleta.isGuest && ` · de ${atleta.guestFromTeam}`}
            {atleta.callUpStatus === "DECLINED" && " · tinha dito que não podia"}
          </span>
        </span>

        {/* O resumo do que já está registado, para quem só passa os olhos. */}
        {emCampo && (
          <div className="flex shrink-0 items-center gap-1.5">
            {linha.tally > 0 && (
              <Pill tone="ok">
                {linha.tally} {linha.tally === 1 ? golo : `${golo}s`}
              </Pill>
            )}
            {linha.yellowCards > 0 && !linha.redCard && (
              <Pill tone="warn">{linha.yellowCards === 2 ? "2 amarelos" : "amarelo"}</Pill>
            )}
            {linha.redCard && <Pill tone="risk">vermelho</Pill>}
            <span className="w-12 text-right text-meta tabular text-ink-2">
              {derivados === null ? "—" : `${derivados}′`}
            </span>
          </div>
        )}

        {/*
          A pergunta, em três respostas.
          Substituiu um visto "jogou" mais um interruptor "Titular" escondido lá
          dentro — duas perguntas para uma resposta só, e nenhuma delas a que o
          treinador tem na cabeça.
        */}
        {mayRecord ? (
          // Ao pé do telemóvel o grupo passa a linha própria em vez de encolher:
          // encolher cortava "Não jogou" a meio, e a resposta mais importante da
          // linha é precisamente esta.
          <div className="w-full sm:w-auto sm:shrink-0">
            <Segmented
              size="md"
              label={`Papel de ${atleta.name}`}
              value={linha.papel}
              onChange={escolher}
              options={PAPEIS}
            />
          </div>
        ) : (
          emCampo && <Pill tone="signal">{linha.papel === "titular" ? "Titular" : "Entrou"}</Pill>
        )}
      </div>

      {emCampo && mayRecord && (
        <div className="border-t border-line/60 bg-surface px-5 py-3">
          {/* O essencial, sempre à vista. */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
            <NumField
              label={golo === "golo" ? "Golos" : "Pontos"}
              value={linha.tally}
              max={99}
              onCommit={(n) => onChange({ tally: n })}
            />
            <NumField label="Assist." value={linha.assists} max={99} onCommit={(n) => onChange({ assists: n })} />

            {/*
              Quem entrou do banco diz quando, aqui e não escondido no detalhe.

              É a única conta que o sistema não consegue fazer sozinho — um
              suplente tanto pode ter entrado ao 10 como ao 80 — e desde que os
              minutos deixaram de se escrever à mão, é este número que os
              determina. Escondê-lo atrás de "Mais detalhes" era esconder a
              pergunta e deixar a linha por saber.
            */}
            {linha.papel === "entrou" && (
              <MinuteField
                label="Entrou ao"
                value={linha.onMinute}
                max={duracao + 30}
                onCommit={(n) => onChange({ onMinute: n })}
              />
            )}

            {/*
              Os minutos são resultado, não pergunta.

              Havia aqui um campo que o treinador escrevia e que discordava, mais
              vezes do que não, da conta que sai da entrada e da saída — e era o
              escrito à mão que ficava gravado. Ver `minutosDerivados`.
            */}
            <span className="flex items-center gap-2 text-meta text-ink-3">
              Minutos
              <span
                className={cx(
                  "inline-flex h-10 min-w-14 items-center justify-center rounded-[8px] bg-sunken px-2 text-body font-medium tabular",
                  derivados === null ? "text-ink-4" : "text-ink",
                )}
                title={derivados === null ? "Falta o minuto de entrada" : "Calculado a partir da entrada e da saída"}
              >
                {derivados === null ? "—" : derivados}
              </span>
            </span>

            <button
              type="button"
              onClick={() => setDetalhe((v) => !v)}
              aria-expanded={detalhe}
              className="ctl-ghost h-9 gap-1.5 text-meta text-ink-3"
            >
              {detalhe ? "Menos detalhes" : "Mais detalhes"}
              <ChevronRight className={cx("size-3.5 transition-transform", detalhe && "rotate-90")} strokeWidth={2} />
            </button>
          </div>

          {/*
            O detalhe federado, atrás de um clique.

            Ninguém é obrigado a preenchê-lo — a ficha fecha sem isto — mas quem
            leva a acta a sério tem onde escrever os minutos exactos. Estava
            fechado porque a maioria dos jogos de formação nunca os regista, e
            oito campos vazios por atleta em vinte atletas era o que fazia esta
            página parecer trabalho em vez de registo.
          */}
          {detalhe && (
            <div className="mt-3 space-y-3 border-t border-line/60 pt-3">
              {/*
                Três assuntos, três linhas, cada uma com o seu nome.

                Estavam todos misturados numa só tira que ia dando a volta: "Saiu
                ao", "Amarelos", "Amarelo ao", "Vermelho", "1.º golo ao" — a
                mesma fila de caixas iguais, sem nada a dizer onde acabava um
                assunto e começava o outro, e com o que o treinador mais quer
                escrever no fim de tudo.

                O que se marcou vem primeiro porque é a pergunta que traz aqui a
                maioria das pessoas. A substituição vem a seguir porque explica os
                minutos. A disciplina vem por último porque é a excepção.
              */}
              {(linha.tally > 0 || linha.assists > 0) && (
                <Detalhe titulo={`${golo === "golo" ? "Golos" : "Pontos"} e assistências`}>
                  {/* Um campo por golo e por assistência declarados — nem mais um.
                      Pedir o minuto de um golo que ninguém marcou não faz pergunta
                      nenhuma, e por isso a linha só existe depois de haver contagem. */}
                  {Array.from({ length: Math.min(linha.tally, 12) }, (_, i) => (
                    <MinuteField
                      key={`g${i}`}
                      label={linha.tally === 1 ? `${golo === "golo" ? "Golo" : "Ponto"} ao` : `${i + 1}.º ${golo} ao`}
                      value={linha.tallyAt[i] ?? null}
                      max={duracao + 30}
                      onCommit={(n) => onChange({ tallyAt: substituirMinuto(linha.tallyAt, i, n, linha.tally) })}
                    />
                  ))}
                  {Array.from({ length: Math.min(linha.assists, 12) }, (_, i) => (
                    <MinuteField
                      key={`a${i}`}
                      label={linha.assists === 1 ? "Assistência ao" : `${i + 1}.ª assist. ao`}
                      value={linha.assistsAt[i] ?? null}
                      max={duracao + 30}
                      onCommit={(n) => onChange({ assistsAt: substituirMinuto(linha.assistsAt, i, n, linha.assists) })}
                    />
                  ))}
                </Detalhe>
              )}

              {/* "Entrou ao" não está aqui: subiu para a linha de cima, porque é
                  dele que saem os minutos jogados de um suplente. */}
              <Detalhe titulo="Em campo">
                <MinuteField
                  label="Saiu ao"
                  value={linha.offMinute}
                  max={duracao + 30}
                  hint={linha.offMinute == null ? "jogou até ao fim" : undefined}
                  onCommit={(n) => onChange({ offMinute: n })}
                />
              </Detalhe>

              <Detalhe titulo="Disciplina">
                <label className="flex items-center gap-2">
                  <span className="text-meta whitespace-nowrap text-ink-3">Amarelos</span>
                  <Segmented
                    size="md"
                    label="Cartões amarelos"
                    value={String(linha.yellowCards)}
                    // Reduzir o número corta os minutos a mais: dois minutos com
                    // um amarelo declarado são duas afirmações a discordar.
                    onChange={(v) =>
                      onChange({ yellowCards: Number(v), yellowAt: linha.yellowAt.slice(0, Number(v)) })
                    }
                    options={[
                      { value: "0", label: "0" },
                      { value: "1", label: "1" },
                      { value: "2", label: "2" },
                    ]}
                  />
                </label>

                {/* Um campo de minuto por amarelo declarado, e nem mais um. */}
                {Array.from({ length: linha.yellowCards }, (_, i) => (
                  <MinuteField
                    key={i}
                    label={linha.yellowCards === 1 ? "Amarelo ao" : `${i + 1}.º amarelo ao`}
                    value={linha.yellowAt[i] ?? null}
                    max={duracao + 30}
                    onCommit={(n) => {
                      const proximo = [...linha.yellowAt];
                      // Apagar o minuto do primeiro amarelo não pode deixar um
                      // buraco que empurre o segundo para o lugar do primeiro.
                      if (n == null) proximo.splice(i, 1);
                      else proximo[i] = n;
                      onChange({ yellowAt: proximo.filter((m) => m != null).slice(0, linha.yellowCards) });
                    }}
                  />
                ))}

                <SmallToggle
                  on={linha.redCard}
                  tone="risk"
                  onClick={() => onChange({ redCard: !linha.redCard, ...(linha.redCard ? { redAt: null } : {}) })}
                >
                  Vermelho
                </SmallToggle>
                {linha.redCard && (
                  <MinuteField
                    label="Expulso ao"
                    value={linha.redAt}
                    max={duracao + 30}
                    onCommit={(n) => onChange({ redAt: n })}
                  />
                )}
              </Detalhe>
            </div>
          )}

          {/*
            O aviso de contradição, na linha de quem a tem.
            Não trava a escrita — o treinador pode estar a meio de corrigir os
            dois números — mas trava o Gravar lá em baixo, e diz aqui porquê.
          */}
          {problemas.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-[var(--radius-control)] bg-risk-soft px-3 py-2">
              {problemas.map((p) => (
                <li key={p} className="text-meta leading-relaxed text-risk">
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/** Põe (ou tira) um minuto numa lista, sem deixar buracos nem passar do declarado. */
function substituirMinuto(lista: number[], i: number, n: number | null, tecto: number): number[] {
  const proximo = [...lista];
  if (n == null) proximo.splice(i, 1);
  else proximo[i] = n;
  return proximo.filter((m) => m != null).slice(0, tecto);
}

/**
 * Um minuto do jogo, que pode não estar registado.
 *
 * Gémeo de `NumField`, com uma diferença que é a razão de existir: **vazio é um
 * valor**. Um `NumField` a zero afirma "ao minuto zero"; aqui, vazio afirma
 * "ninguém registou", que é o estado da esmagadora maioria das fichas. Apagar o
 * campo volta a esse estado em vez de escrever um zero.
 */
/**
 * Um assunto do painel de detalhe, com o seu nome à esquerda.
 *
 * O rótulo fica na coluna e não por cima porque, em vinte atletas, vinte
 * cabeçalhos empilhados davam uma página de títulos. À largura de telemóvel a
 * coluna desfaz-se e o nome passa a linha própria — que é o único sítio onde
 * ainda cabe.
 */
function Detalhe({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="text-meta font-medium text-ink-3 sm:w-40 sm:shrink-0 sm:text-right">{titulo}</span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">{children}</div>
    </div>
  );
}

function MinuteField({
  label,
  value,
  max,
  hint,
  onCommit,
}: {
  label: string;
  value: number | null;
  max: number;
  hint?: string;
  onCommit: (n: number | null) => void;
}) {
  const [texto, setTexto] = useState(value == null ? "" : String(value));

  useEffect(() => {
    setTexto(value == null ? "" : String(value));
  }, [value]);

  function commit() {
    if (texto.trim() === "") {
      setTexto("");
      if (value !== null) onCommit(null);
      return;
    }
    const n = Math.max(0, Math.min(max, Number(texto) || 0));
    setTexto(String(n));
    if (n !== value) onCommit(n);
  }

  return (
    <label className="flex items-center gap-2">
      <span className="text-meta whitespace-nowrap text-ink-3">{label}</span>
      <span className="relative inline-flex items-center">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={3}
          value={texto}
          placeholder="—"
          onChange={(e) => setTexto(e.target.value.replace(/\D/g, ""))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="h-10 w-16 rounded-[8px] border border-line bg-surface pr-4 text-center text-body font-medium tabular text-ink outline-none transition-colors placeholder:font-normal placeholder:text-ink-4 focus:border-line-strong"
        />
        <span aria-hidden className="pointer-events-none absolute right-2 text-meta text-ink-4">
          ′
        </span>
      </span>
      {hint && <span className="text-meta text-ink-4">{hint}</span>}
    </label>
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

  /*
   * Este número comanda o que existe no ecrã: escrever 1 golo faz nascer o
   * campo do minuto desse golo. Por isso conta-se a cada tecla e não ao sair
   * do campo — esperar pelo `blur` fazia o campo aparecer só depois de a pessoa
   * carregar noutro sítio qualquer, e quem escrevia "1" ficava a olhar para uma
   * linha onde não acontecia nada.
   *
   * O `MinuteField` continua a contar ao sair, e de propósito: um minuto a meio
   * de ser escrito ("6" a caminho de "60") acendia avisos de contradição a cada
   * tecla, e o que ele comanda é uma verificação, não a existência de campos.
   */
  useEffect(() => {
    setTexto((t) => (Number(t === "" ? "0" : t) === value ? t : String(value)));
  }, [value]);

  function escrever(bruto: string) {
    setTexto(bruto);
    // Campo esvaziado conta como zero, mas deixa-se ficar vazio para se poder
    // escrever por cima sem apagar um "0" à frente.
    const n = bruto === "" ? 0 : Math.max(0, Math.min(max, Number(bruto) || 0));
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
        onChange={(e) => escrever(e.target.value.replace(/\D/g, ""))}
        onBlur={() => setTexto(String(value))}
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
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-signal-on"
      style={{ background: "var(--color-signal-strong)" }}
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
