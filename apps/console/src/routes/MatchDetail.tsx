import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Empty, Loading, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  MapPin,
  Download,
  Users,
} from "@/lib/icons";
import { useSession } from "@/session";
import { can } from "@/lib/permissions";
import { athleteById, numeroNaEquipa, sportById } from "@/lib/api";
import { profileOf } from "@/lib/sports";
import { tallyNoun } from "@/lib/calendar";
import { reloadAcademy, useStore } from "@/lib/store";
import { SaveVeil, Spinner, useSaving } from "@/components/Busy";
import { descarregarFolha, folhaDoJogo } from "@/lib/callup-export";
import { MatchStaffEditor } from "@/components/MatchStaff";
import { GamePlan, ObjetivosNaAnalise, useJogadores } from "@/components/match/GamePlan";
import { PitchBoard } from "@/components/match/PitchBoard";
import { LinhaDaFicha, ResumoDaFicha } from "@/components/match/Ficha";
import { AbasDoJogo, Cartao, CartaoTopo, Emblema, Vazio } from "@/components/match/ui";
import { CabecalhoDoJogo } from "@/components/match/views";
import { VisaoGeral } from "@/components/match/VisaoGeral";
import { Adversario } from "@/components/match/Adversario";
import { Analise } from "@/components/match/Analise";
import type { GameFormat } from "@/lib/training";
import { LiveMatch } from "@/components/match/LiveMatch";
import type { SheetRow } from "@/lib/callup-sheet";
import {
  OUTCOME_LABEL,
  getMatch,
  outcome,
  retroPool,
  saveAddedTime,
  saveAppearances,
  saveMatchReport,
  saveOpponentReport,
  saveResult,
  saveRetroSquad,
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
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

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

  /*
   * Depois de gravar: esta página **e** o resto da consola.
   *
   * `getMatch` só actualiza o que está neste ecrã. O calendário, as
   * convocatórias e a ficha do atleta leem `store.matches`, que é carregada uma
   * vez no arranque — sem este `reloadAcademy`, um resultado gravado aqui só
   * chegava lá na recarga seguinte da página, e até lá a gaveta do jogo no
   * calendário continuava a dizer "ainda não tem resultado registado" sobre um
   * jogo que já o tinha.
   *
   * Sem `await`: o ecrã já tem o que precisa do `recarregar`, e prender o botão
   * a nove pedidos da academia inteira era pagar duas vezes pelo mesmo gesto.
   */
  async function guardado() {
    await recarregar();
    void reloadAcademy();
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

  /*
   * A área aberta vive no endereço. Sem escolha, abre a visão geral: é ela que
   * diz onde o jogo está e o que falta.
   */
  const pedida = params.get("aba") === "plano" ? "pre" : params.get("aba");
  const aba: Aba = ABAS.some((x) => x.key === pedida) ? (pedida as Aba) : "geral";
  const irPara = (key: Aba) => {
    const q = new URLSearchParams(params);
    if (key === "geral") q.delete("aba");
    else q.set("aba", key);
    setParams(q);
  };

  const cancelado = match.status === "CANCELLED";
  const onze = match.plan?.slots ?? [];
  const titulares = onze.filter((x) => x.athleteId).length;
  const onzeCompleto = onze.length > 0 && titulares === onze.length;
  const temFicha = match.squad.some((x) => x.played);
  const temResultado = match.ourScore !== null;
  const objetivos = match.plan?.objectives ?? [];

  /** O que falta, por ordem. É o que a visão geral lista e o que dá o estado ao jogo. */
  const passos: { feito: boolean; texto: string; area: Aba; depois?: boolean; convocatoria?: boolean }[] = [
    // Antes do jogo, a convocatória faz-se no ecrã dela: o passo leva para lá, já neste jogo.
    { feito: match.submitted, texto: passou ? "Plantel registado" : "Convocatória enviada", area: passou ? "pos" : "pre", convocatoria: !passou },
    { feito: onzeCompleto, texto: onze.length ? `Equipa inicial escolhida (${titulares} de ${onze.length})` : "Equipa inicial escolhida", area: "pre" },
    { feito: (match.plan?.bench.length ?? 0) > 0, texto: "Suplentes escolhidos", area: "pre" },
    { feito: Boolean(match.plan?.captainId), texto: "Capitão definido", area: "pre" },
    { feito: objetivos.length > 0, texto: "Objetivos do jogo definidos", area: "pre" },
    { feito: Boolean(match.opponentReport), texto: "Notas sobre o adversário", area: "adversario" },
    { feito: temResultado, texto: "Resultado registado", area: "pos", depois: true },
    { feito: temFicha, texto: "Ficha preenchida (quem jogou e quanto)", area: "pos", depois: true },
    { feito: Boolean(match.report), texto: "Análise escrita", area: "analise", depois: true },
    ...(objetivos.length > 0
      ? [{ feito: objetivos.every((o) => o.met !== null), texto: "Objetivos avaliados", area: "analise" as Aba, depois: true }]
      : []),
  ];
  const preparado = match.submitted && onzeCompleto;

  /*
   * O estado do jogo, calculado do que existe. Não se escolhe à mão: um estado
   * escolhido fica errado no dia em que alguém se esquece de o mudar.
   */
  const estado: { texto: string; tom: "neutro" | "aviso" | "ok" | "vivo" | "risco" } = cancelado
    ? { texto: "Cancelado", tom: "risco" }
    : aDecorrer
      ? { texto: "A decorrer", tom: "vivo" }
      : passou
        ? match.report && temResultado
          ? { texto: "Analisado", tom: "neutro" }
          : temResultado
            ? { texto: "Terminado · por analisar", tom: "aviso" }
            : { texto: "Terminado · sem resultado", tom: "aviso" }
        : preparado
          ? { texto: "Pronto", tom: "ok" }
          : match.plan || match.submitted
            ? { texto: "Em preparação", tom: "aviso" }
            : { texto: "Por preparar", tom: "neutro" };

  const dia = inicio.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
  const hora = (d: Date) => d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  const jogados = match.opponentHistory.filter((h) => h.ourScore !== null && h.theirScore !== null);
  const vitorias = jogados.filter((h) => h.ourScore! > h.theirScore!).length;
  const derrotas = jogados.filter((h) => h.ourScore! < h.theirScore!).length;

  return (
    /*
      Os painéis que já existiam (a ficha, a convocatória, o relatório) ganham
      aqui os cantos e a sombra dos cartões desta área, para a página ler como
      uma coisa só.
    */
    <div className="mx-auto max-w-[1280px] space-y-4 [&_.panel]:rounded-[20px] [&_.panel]:border-line/80 [&_.panel]:shadow-[0_1px_2px_rgb(26_25_23/0.04),0_16px_36px_-24px_rgb(26_25_23/0.22)]">
      <Link to="/jogos" className="inline-flex items-center gap-1.5 text-meta font-medium text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" strokeWidth={1.75} />
        Todos os jogos
      </Link>

      <Scoreboard match={match} aDecorrer={aDecorrer} passou={passou} mayRecord={mayRecord} onSaved={guardado} estado={estado} />

      <div className="sticky top-0 z-20 -mx-2 bg-canvas/85 px-2 py-2 backdrop-blur-md">
        <AbasDoJogo
          ativa={aba}
          onIr={irPara}
          abas={[
            { key: "geral", label: "Visão geral" },
            { key: "pre", label: "Pré-jogo", feito: preparado, nota: onze.length ? `${titulares}/${onze.length}` : undefined },
            { key: "vivo", label: "Ao vivo" },
            { key: "pos", label: "Pós-jogo", feito: temResultado && temFicha, nota: temResultado ? `${match.ourScore}–${match.theirScore}` : undefined },
            { key: "analise", label: "Análise", feito: Boolean(match.report) },
            { key: "adversario", label: "Adversário", feito: Boolean(match.opponentReport), nota: match.opponentHistory.length ? String(match.opponentHistory.length) : undefined },
          ]}
        />
      </div>

      {/* ------------------------------------------------------ Visão geral */}
      {aba === "geral" && (
        <VisaoGeral<Aba>
          passos={passos.map((x) => ({
            feito: x.feito,
            texto: x.texto,
            area: x.area,
            areaNome: x.convocatoria ? "convocatórias" : (ABAS.find((a) => a.key === x.area)?.label.toLowerCase() ?? ""),
            bloqueado: Boolean(x.depois) && !passou,
            ...(x.convocatoria ? { ir: () => navigate(`/convocatorias?jogo=${match.id}`) } : {}),
          }))}
          onIr={irPara}
          onze={match.plan ? <ResumoDoOnze match={match} /> : null}
          onzeApoio={match.plan ? [match.plan.system, `${titulares} titulares`, `${match.plan.bench.length} suplentes`].filter(Boolean).join(" · ") : "Ainda sem equipa inicial"}
          onzeArea="pre"
          factos={[
            { rotulo: "Quando", valor: `${dia.charAt(0).toUpperCase()}${dia.slice(1)}, ${hora(inicio)}` },
            { rotulo: "Onde", valor: `${match.venue} · ${match.isHome ? "em casa" : "fora"}` },
            {
              rotulo: "Equipa",
              valor: (
                <Link to={`/equipas/${match.teamId}`} className="underline-offset-2 hover:underline">
                  {match.teamName}
                </Link>
              ),
            },
            ...(match.competition ? [{ rotulo: "Prova", valor: [match.competition.label, match.roundLabel].filter(Boolean).join(" · ") }] : []),
            ...(match.coachName ? [{ rotulo: "Treinador", valor: match.coachName }] : []),
            ...(match.meetingAt ? [{ rotulo: "Ponto de encontro", valor: `${hora(new Date(match.meetingAt))}${match.meetingPoint ? ` · ${match.meetingPoint}` : ""}` }] : []),
            { rotulo: "Convocatória", valor: match.submitted ? `Enviada · ${match.squad.length} convocados` : passou ? "Sem convocatória" : "Por enviar" },
          ]}
          adversario={
            <Cartao>
              <CartaoTopo titulo={match.opponent} apoio={jogados.length === 0 ? "Primeiro jogo registado contra este adversário" : `${jogados.length} ${jogados.length === 1 ? "jogo anterior" : "jogos anteriores"}`}>
                <button type="button" className="ctl-ghost h-8" onClick={() => irPara("adversario")}>
                  Ver
                  <ChevronRight className="size-3.5" strokeWidth={1.75} />
                </button>
              </CartaoTopo>
              <div className="flex items-center gap-3 px-5 pb-5">
                <Emblema nome={match.opponent} tamanho={44} />
                {jogados.length > 0 ? (
                  <div className="flex gap-4 text-center">
                    {[
                      [vitorias, "V", "text-ok"],
                      [jogados.length - vitorias - derrotas, "E", "text-ink"],
                      [derrotas, "D", "text-risk"],
                    ].map(([n, l, cor]) => (
                      <div key={l as string}>
                        <div className={cx("text-[22px] leading-none font-semibold tabular", cor as string)}>{n}</div>
                        <div className="mt-1 text-[11px] text-ink-3">{l}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-meta text-ink-3">{match.opponentReport ? "Já tem notas para este jogo." : "Ainda sem notas. Escreve o que souberes dele."}</p>
                )}
              </div>
            </Cartao>
          }
          extra={<StaffPanel match={match} passou={passou} mayRecord={mayRecord} onSaved={guardado} />}
        />
      )}

      {/* --------------------------------------------------------- Pré-jogo */}
      {aba === "pre" && (
        <div className="space-y-4">
          <GamePlan match={match} mayEdit={mayRecord} onSaved={guardado} />
          {/* A convocatória monta-se no ecrã dela; aqui vê-se como está. */}
          {!passou && <CallUpPanel match={match} />}
        </div>
      )}

      {/* ---------------------------------------------------------- Ao vivo */}
      {aba === "vivo" &&
        (cancelado ? (
          <PorVir titulo="Este jogo foi cancelado" texto="Não há nada para acompanhar." />
        ) : (
          <LiveMatch match={match} mayRecord={mayRecord} onSaved={guardado} />
        ))}

      {/* --------------------------------------------------------- Pós-jogo */}
      {aba === "pos" &&
        (passou ? (
          <div className="space-y-4">
            {temPlantel ? (
              <SheetPanel match={match} mayRecord={mayRecord} onSaved={guardado} />
            ) : (
              <RetroSquadPanel match={match} mayRecord={mayRecord} onSaved={guardado} />
            )}
            {/* Corrigir um plantel retroactivo já registado — discreto, mas à mão. */}
            {temPlantel && mayRecord && <RetroSquadPanel match={match} mayRecord={mayRecord} onSaved={guardado} collapsed />}
          </div>
        ) : (
          <PorVir titulo="O pós-jogo abre depois do apito" texto="É aqui que se regista o resultado, quem entrou, quantos minutos jogou cada um, os golos e os cartões." />
        ))}

      {/* ---------------------------------------------------------- Análise */}
      {aba === "analise" &&
        (passou ? (
          <div className="space-y-4">
            <ObjetivosNaAnalise match={match} mayEdit={mayRecord} onSaved={guardado} />
            <Analise
              relatorio={match.report}
              podeEditar={mayRecord}
              contexto={
                temResultado ? (
                  <span
                    className={cx(
                      "rounded-full px-3 py-1 text-meta font-semibold tabular",
                      match.ourScore! > match.theirScore! ? "bg-ok-soft text-ok" : match.ourScore! < match.theirScore! ? "bg-risk-soft text-risk" : "bg-sunken text-ink-2",
                    )}
                  >
                    {match.ourScore! > match.theirScore! ? "Vitória" : match.ourScore! < match.theirScore! ? "Derrota" : "Empate"} {match.ourScore}–{match.theirScore}
                  </span>
                ) : undefined
              }
              onGuardar={async (corpo) => {
                await saveMatchReport(match.id, corpo);
                await guardado();
              }}
            />
          </div>
        ) : (
          <PorVir titulo="A análise escreve-se depois do jogo" texto="Os objetivos definidos no Pré-jogo voltam aqui para dizer se foram cumpridos, ao lado do que correu bem e do que há a melhorar." />
        ))}

      {/* ------------------------------------------------------- Adversário */}
      {aba === "adversario" && (
        <Adversario
          nome={match.opponent}
          registo={match.opponentReport}
          historico={match.opponentHistory}
          podeEditar={mayRecord}
          onGuardar={async (notas) => {
            await saveOpponentReport(match.id, notas);
            await guardado();
          }}
        />
      )}
    </div>
  );
}

type Aba = "geral" | "pre" | "vivo" | "pos" | "analise" | "adversario";
const ABAS: { key: Aba; label: string }[] = [
  { key: "geral", label: "Visão geral" },
  { key: "pre", label: "Pré-jogo" },
  { key: "vivo", label: "Ao vivo" },
  { key: "pos", label: "Pós-jogo" },
  { key: "analise", label: "Análise" },
  { key: "adversario", label: "Adversário" },
];

/** O onze em pequeno, só de leitura, para a visão geral. */
function ResumoDoOnze({ match }: { match: Match }) {
  const jogadores = useJogadores(match);
  const porId = useMemo(() => new Map(jogadores.map((j) => [j.id, j])), [jogadores]);
  if (!match.plan) return null;
  return (
    <PitchBoard
      format={match.plan.pitch as GameFormat}
      className="rounded-[18px]"
      pecas={match.plan.slots.map((x) => {
        const j = x.athleteId ? porId.get(x.athleteId) : undefined;
        return {
          id: x.id,
          label: x.label,
          x: x.x,
          y: x.y,
          jogador: x.athleteId
            ? { numero: j?.numero ?? null, nome: j?.curto ?? "Atleta", foto: j?.foto, marca: match.plan!.captainId === x.athleteId ? "C" : match.plan!.viceCaptainId === x.athleteId ? "SC" : null }
            : null,
        };
      })}
    />
  );
}

/** Uma área que ainda não chegou. */
function PorVir({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <Cartao>
      <Vazio icone={<Clock className="size-5" strokeWidth={1.75} />} titulo={titulo} texto={texto} />
    </Cartao>
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
  estado,
}: {
  match: Match;
  aDecorrer: boolean;
  passou: boolean;
  mayRecord: boolean;
  onSaved: () => void;
  /** O estado do jogo, calculado na página. */
  estado: { texto: string; tom: "neutro" | "aviso" | "ok" | "vivo" | "risco" };
}) {
  const inicio = new Date(match.startsAt);
  const cancelado = match.status === "CANCELLED";
  const temResultado = match.ourScore !== null && match.theirScore !== null;
  const res = outcome(match);

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
  const { academy } = useStore();
  const r = useResultado(match, onSaved);

  const estados = (
    <>
      <span className="inline-flex items-center gap-1.5">
        <Clock className="size-3.5 text-ink-4" strokeWidth={1.75} />
        {inicio.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" })}, {inicio.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <MapPin className="size-3.5 text-ink-4" strokeWidth={1.75} />
        {match.venue}
      </span>
      <Estado
        feito={match.submitted}
        feitoLabel={passou ? "Plantel registado" : "Convocatória enviada"}
        faltaLabel={passou ? "Plantel por registar" : "Convocatória por enviar"}
      />
      {passou && !cancelado && (
        <>
          <Estado feito={match.ourScore !== null} feitoLabel="Resultado registado" faltaLabel="Resultado por registar" />
          <Estado feito={match.squad.some((x) => x.played)} feitoLabel="Ficha preenchida" faltaLabel="Ficha por preencher" />
        </>
      )}
    </>
  );

  return (
    <CabecalhoDoJogo
      equipa={match.teamName}
      adversario={match.opponent}
      emCasa={match.isHome}
      logo={academy.logoUrl}
      contexto={[match.competition?.label, match.roundLabel].filter(Boolean).join(" · ") || "Jogo"}
      estado={{ chave: "", ...estado }}
      rodape={estados}
      centro={
        escrevivel ? (
          <>
            <ScoreInputs match={match} r={r} />
            {/* O selo de vitória, empate ou derrota não desaparece por o resultado estar editável. */}
            {temResultado && res && <OutcomePill res={res} />}
            <ResultActions r={r} />
          </>
        ) : temResultado ? (
          <>
            <div className="flex items-baseline gap-2.5">
              <span className="placar text-[52px] leading-none font-semibold tracking-[-0.03em] text-ink tabular">{golosCasa}</span>
              <span className="text-[30px] leading-none font-light text-ink-4">–</span>
              <span className="placar text-[52px] leading-none font-semibold tracking-[-0.03em] text-ink tabular">{golosFora}</span>
            </div>
            {res && <OutcomePill res={res} />}
          </>
        ) : passou && !cancelado ? (
          <>
            <span className="text-[44px] leading-none font-light text-ink-4">–</span>
            <span className="text-meta text-ink-3">{aDecorrer ? "a decorrer" : "sem resultado"}</span>
          </>
        ) : (
          <>
            <span className="placar text-[44px] leading-none font-semibold tracking-[-0.03em] text-ink tabular">
              {inicio.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="text-meta text-ink-3">{cancelado ? "cancelado" : quandoFalta(inicio)}</span>
          </>
        )
      }
    />
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
    <div className="mt-2">
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
  const [folha, setFolha] = useState(false);
  // O emblema e a época, para a folha em PDF.
  const { academy, season } = useStore();

  const confirmados = match.squad.filter((s) => s.callUpStatus === "CONFIRMED").length;
  const recusaram = match.squad.filter((s) => s.callUpStatus === "DECLINED").length;
  const semResposta = match.squad.length - confirmados - recusaram;

  /*
   * A ficha do jogo traz o plantel com nome e posição, mas não com o número de
   * camisola — ele vive na passagem do atleta pela equipa (o 10 no futebol pode
   * ser o 7 no futsal), e é o número **desta** equipa que a folha imprime na segunda
   * coluna. Vai buscá-lo aqui em vez de o acrescentar a `SquadRow`: é a única
   * coisa desta página que precisa dele, e uma coluna a mais na resposta do
   * servidor para uma folha que se imprime uma vez por semana não se paga.
   */
  const sheetRows: SheetRow[] = match.squad.map((s) => ({
    squadNumber: (() => {
      const a = athleteById(s.athleteId);
      return a ? (numeroNaEquipa(a, match.teamId) ?? a.squadNumber ?? null) : null;
    })(),
    name: s.name,
    position: s.position,
    status: s.callUpStatus,
    guestFrom: s.isGuest ? (s.guestFromTeam ?? "outro escalão") : null,
  }));

  // O jogo como a folha o lê — com a equipa de trabalho. Ver `folhaDoJogo`.
  const sheetMatch = folhaDoJogo(match);

  /**
   * A folha, sem perguntar nada.
   *
   * O diálogo que perguntava a prova, o ponto de encontro e as horas
   * desapareceu: essas coisas são ditas ao **submeter** a convocatória e vivem
   * no jogo, que é também de onde a app da família as lê. Perguntá-las outra
   * vez aqui era arriscar que o papel dissesse uma coisa e o telemóvel do pai
   * outra.
   */
  async function exportar() {
    if (folha) return;
    setFolha(true);
    try {
      await descarregarFolha({ match: sheetMatch, rows: sheetRows, academy, season });
    } finally {
      setFolha(false);
    }
  }

  return (
    <Panel>
      <PanelHead title="Convocatória" hint={match.submitted ? "enviada às famílias" : "por enviar"}>
        {/* Só depois de submetida: a folha é da lista que saiu para as famílias,
            e um rascunho ainda muda. Ver a nota do mesmo botão em `CallUps`. */}
        {match.submitted && (
          <button
            type="button"
            onClick={() => void exportar()}
            disabled={folha}
            className="ctl-outline"
            title="PDF da convocatória, para assinar no ponto de encontro"
          >
            <Download className="size-3.5" strokeWidth={1.75} />
            {folha ? "A gerar…" : "Exportar PDF"}
          </button>
        )}
        <Link to={`/convocatorias?jogo=${match.id}`} className="ctl-primary">
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
  /**
   * Por quem entrou (só no futebol). Não se grava como tal: fica escrito no
   * minuto de saída do outro jogador, igual ao minuto de entrada deste. Ao
   * abrir a ficha, reconstitui-se por aí. Ver `daFicha`.
   */
  substitui: string | null;
};

/** Titular e suplente utilizado entram na ficha; quem não jogou não tem linha. */
const jogou = (l: Linha) => l.papel !== "nao";

/**
 * Um suplente de quem ninguém registou o minuto de entrada.
 *
 * Já foi obrigatório: sem ele não havia minutos, e a ficha não gravava. Deixou
 * de ser — obrigar o treinador a lembrar-se do minuto exacto de cada
 * substituição, em vinte atletas, era o que fazia a ficha ficar por preencher.
 * Quem entrou sem minuto fica com os minutos por saber (zero na conta da época,
 * "—" no ecrã), e quem quiser o detalhe continua a ter onde o escrever.
 */
function semEntrada(l: Linha): boolean {
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
 * A linha da ficha de um convocado que ainda não tem linha no estado.
 *
 * Acontece de cada vez que o plantel muda debaixo da ficha: corrigir o plantel
 * retroactivo mete um convocado novo em `match.squad`, e a página desenha as
 * linhas **antes** de o `useEffect` refazer o estado. Ler `linhas[id]` nesse
 * instante dava `undefined`, e a página caía inteira ("Cannot read properties
 * of undefined (reading 'papel')") até a alguém carregar em F5. A linha nasce
 * do que o servidor sabe do atleta — que, num convocado acabado de juntar, é
 * "não jogou".
 */
function linhaDe(s: SquadRow): Linha {
  return {
    athleteId: s.athleteId,
    // Os dois campos antigos colapsam num: não jogou / entrou / titular.
    papel: !s.played ? "nao" : s.started ? "titular" : "entrou",
    substitui: null,
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
  };
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
 * um número plausível. Grava-se zero (o servidor faz a mesma conta) e o ecrã
 * mostra "—". Não trava nada: ver `semEntrada`.
 */
function minutosDerivados(l: Linha, duracao: number, tempo: TempoDoJogo = SEM_ADICIONAL): number | null {
  const entrada = l.papel === "titular" ? 0 : l.onMinute;
  if (entrada == null) return null;
  const saida = l.offMinute ?? duracao;
  let minutos = saida - entrada;
  /*
   * O tempo adicional soma a quem estava em campo quando a parte acabou. A
   * última parte só soma a quem não tem minuto de saída: uma saída escrita aos
   * 93 já traz os descontos dentro. A mesma conta de `minutosEmCampo`, no
   * servidor, que é quem decide o que fica gravado.
   */
  if (tempo.partes > 0 && duracao > 0) {
    for (let i = 0; i < tempo.partes; i++) {
      const fim = (duracao * (i + 1)) / tempo.partes;
      const ultima = i === tempo.partes - 1;
      const estavaLa = entrada < fim && (ultima ? l.offMinute == null : l.offMinute == null || l.offMinute >= fim);
      if (estavaLa) minutos += tempo.adicional[i] ?? 0;
    }
  }
  return Math.max(0, minutos);
}

/** As partes de um jogo e o tempo adicional de cada uma. Sem partes, não há tempo adicional. */
type TempoDoJogo = { partes: number; adicional: number[] };
const SEM_ADICIONAL: TempoDoJogo = { partes: 0, adicional: [] };

/** "1.ª parte", "3.º período". */
const nomeDaParte = (i: number, nome: "parte" | "período") => `${i + 1}.${nome === "parte" ? "ª" : "º"} ${nome}`;

/**
 * O tempo adicional de cada parte.
 *
 * Só aparece nas modalidades que o têm (`SportProfile.match.addedTime`): no
 * futebol há compensação no fim de cada parte; no futsal e no basquetebol o
 * cronómetro pára e a pergunta nem se faz.
 *
 * Grava-se à parte da ficha, com o seu próprio botão: é um facto do jogo e não
 * de um atleta, e quem só quer acertar "+5 na segunda" não tem de gravar a
 * ficha inteira. Soma aos minutos de quem estava em campo: num jogo de 90 com
 * +2 e +3, quem joga tudo fica com 95. O servidor refaz os minutos da ficha ao
 * gravar isto.
 */
function TempoAdicional({ match, mayRecord, onSaved }: { match: Match; mayRecord: boolean; onSaved: () => void }) {
  const jogo = profileOf(sportById(match.sportId))?.match;
  const partes = jogo?.addedTime ? jogo.periods : 0;
  const gravado = Array.from({ length: partes }, (_, i) => (match.addedMinutes ?? [])[i] ?? 0); // um servidor antigo não manda o campo
  const chave = gravado.join(",");

  const [valores, setValores] = useState<string[]>(() => gravado.map((m) => (m ? String(m) : "")));
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setValores(gravado.map((m) => (m ? String(m) : "")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  if (!jogo || partes === 0) return null;

  const total = gravado.reduce((n, m) => n + m, 0);
  // Quem só lê vê o que ficou registado, e nada quando não ficou nada.
  if (!mayRecord) {
    if (total === 0) return null;
    return (
      <p className="rounded-[14px] bg-sunken/60 px-4 py-2.5 text-meta text-ink-3">
        Tempo adicional:{" "}
        <span className="text-ink-2">
          {gravado.map((m, i) => `+${m}′ na ${nomeDaParte(i, jogo.periodName)}`).join(" · ")}
        </span>
      </p>
    );
  }

  const numeros = valores.map((v) => (v === "" ? 0 : Number(v)));
  const mudou = numeros.join(",") !== chave;

  async function gravar() {
    setBusy(true);
    setErro(null);
    try {
      await saveAddedTime(match.id, numeros);
      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar o tempo adicional.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[14px] bg-sunken/60 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-meta font-medium text-ink">Tempo adicional</span>
        {valores.map((v, i) => {
          const id = `tempo-adicional-${i}`;
          return (
            <span key={i} className="inline-flex items-center gap-1.5">
              <label htmlFor={id} className="text-meta text-ink-3">
                {nomeDaParte(i, jogo.periodName)}
              </label>
              <span className="text-meta text-ink-4" aria-hidden>
                +
              </span>
              <input
                id={id}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={2}
                value={v}
                placeholder="0"
                disabled={busy}
                onChange={(e) => {
                  const limpo = e.target.value.replace(/\D/g, "");
                  setValores((x) => x.map((y, j) => (j === i ? limpo : y)));
                }}
                className="h-9 w-12 rounded-full border border-line bg-surface text-center text-body tabular text-ink outline-none placeholder:text-ink-4/60 focus:border-ink-3"
              />
              <span className="text-meta text-ink-3">min</span>
            </span>
          );
        })}
        {mudou && (
          <button type="button" className="ctl-outline h-9" disabled={busy || numeros.some((n) => n > 30)} onClick={() => void gravar()}>
            {busy ? "A gravar…" : "Gravar"}
          </button>
        )}
        <span className="text-[11px] text-ink-4">opcional</span>
      </div>
      {numeros.some((n) => n > 30) && (
        <p role="alert" className="mt-1.5 text-meta text-risk">
          O tempo adicional de cada parte vai de 0 a 30 minutos.
        </p>
      )}
      {erro && (
        <p role="alert" className="mt-1.5 text-meta text-risk">
          {erro}
        </p>
      )}
    </div>
  );
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
   * Quanto dura um jogo desta equipa.
   *
   * Vem de `Team.matchMinutes` — é do escalão, não da modalidade: um Sub-11 de
   * futebol joga 60 e um Sub-19 joga 90. Serve para calcular os minutos de quem
   * entrou e não saiu. O 90 é só para uma modalidade sem duração declarada.
   */
  const duracao = match.matchMinutes ?? 90;
  /* O tempo adicional gravado: soma aos minutos de quem estava em campo. Ver `minutosDerivados`. */
  const regras = profileOf(sportById(match.sportId))?.match;
  const tempo = useMemo<TempoDoJogo>(
    () => ({ partes: regras?.addedTime ? regras.periods : 0, adicional: match.addedMinutes ?? [] }),
    [regras, match.addedMinutes],
  );

  const [linhas, setLinhas] = useState<Record<string, Linha>>(() => daFicha(match));
  const [erro, setErro] = useState<string | null>(null);
  const { estado, gravar: correr, aGravar: busy } = useSaving();

  useEffect(() => {
    setLinhas(daFicha(match));
  }, [match]);

  /*
   * A linha de cada convocado, com rede.
   *
   * `linhas` é estado e `match.squad` é a verdade do servidor; entre uma
   * gravação do plantel e o `useEffect` acima, a segunda pode ter um convocado
   * que a primeira ainda não tem. Ler pelo `squad` e cair em `linhaDe` é o que
   * faz a página aguentar esse instante — e é também o que deixa um convocado
   * retirado do plantel desaparecer da ficha sem esperar pelo efeito.
   */
  const linhaDo = (s: SquadRow): Linha => linhas[s.athleteId] ?? linhaComPlano(match, s);
  const set = (id: string, patch: Partial<Linha>) =>
    setLinhas((x) => {
      const base = x[id] ?? linhaComPlano(match, match.squad.find((s) => s.athleteId === id)!);
      return { ...x, [id]: { ...base, ...patch } };
    });

  const emCampo = match.squad.map(linhaDo).filter(jogou);
  const golos = emCampo.reduce((n, l) => n + l.tally, 0);
  const titulares = emCampo.filter((l) => l.papel === "titular").length;
  /*
   * Quantas linhas não fecham.
   *
   * Trava o Gravar. O servidor recusa as contradições de qualquer maneira, mas
   * descobrir isso depois de carregar no botão — com um erro genérico no fundo
   * do painel — era mandar o treinador procurar em vinte linhas qual delas
   * estava errada. Um suplente sem minuto de entrada **não** conta: já não é um
   * erro, é um detalhe por preencher. Ver `semEntrada`.
   */
  const semMinutos = emCampo.filter(semEntrada).length;

  /*
   * Como se entra e sai nesta modalidade.
   *
   * No futebol as substituições são poucas e contam-se: para um entrar, um tem
   * de sair, e a ficha pergunta por quem e a que minuto. No futsal e no
   * basquetebol entra-se e sai-se a toda a hora: diz-se só quem foi titular e
   * quem entrou, e não se contam minutos.
   */
  const codigo = sportById(match.sportId)?.code;
  const rotativo = codigo === "futsal" || codigo === "basketball";
  const comSubstituicoes = !rotativo && Boolean(regras?.addedTime);
  const nomeDe = (id: string) => match.squad.find((s) => s.athleteId === id)?.name ?? "Atleta";

  /**
   * Mudar a substituição de quem entrou: por quem, e a que minuto.
   *
   * As duas linhas mexem juntas. Quem saiu fica com o minuto de saída igual ao
   * de entrada de quem o substituiu; quem deixa de ser o substituído perde o
   * minuto de saída que lhe tinha sido posto por esta substituição.
   */
  function substituir(id: string, alvo: string | null, minuto: number | null) {
    setLinhas((x) => {
      const eu = x[id] ?? linhaComPlano(match, match.squad.find((s) => s.athleteId === id)!);
      const y = { ...x, [id]: { ...eu, substitui: alvo, onMinute: minuto } };
      const antes = eu.substitui;
      if (antes && antes !== alvo && y[antes] && y[antes].offMinute === eu.onMinute) y[antes] = { ...y[antes], offMinute: null };
      if (alvo && y[alvo] && minuto != null) y[alvo] = { ...y[alvo], offMinute: minuto };
      return y;
    });
  }

  /**
   * O que a ficha tem de errado, visto só quando se tenta gravar.
   *
   * Enquanto se preenche, a ficha deixa escrever à vontade: a meio de acertar
   * dois números, um aviso a cada tecla só atrapalha. Ao gravar, lê-se tudo de
   * uma vez. Os **erros** são impossíveis e travam (o servidor recusava-os de
   * qualquer maneira); os **avisos** são faltas prováveis e deixam gravar na
   * mesma, porque há clubes que não registam minutos.
   */
  function verificar(): { erros: string[]; avisos: string[] } {
    const erros: string[] = [];
    const avisos: string[] = [];
    if (excedeMarcador) erros.push(excedeMarcador);
    for (const l of emCampo) for (const p of incoerencias(l)) erros.push(`${nomeDe(l.athleteId)}: ${p}`);

    if (comSubstituicoes) {
      const saidas = new Map<string, string>();
      for (const l of emCampo.filter((e) => e.papel === "entrou")) {
        const nome = nomeDe(l.athleteId);
        if (!l.substitui) avisos.push(`${nome} entrou, mas falta dizer por quem.`);
        if (l.onMinute == null) avisos.push(`${nome} entrou, mas falta o minuto.`);
        if (!l.substitui) continue;
        const saiu = linhas[l.substitui];
        if (saidas.has(l.substitui)) erros.push(`${nomeDe(l.substitui)} aparece como substituído por ${saidas.get(l.substitui)} e por ${nome}.`);
        saidas.set(l.substitui, nome);
        if (!saiu || !jogou(saiu)) erros.push(`${nome} entrou por ${nomeDe(l.substitui)}, que não chegou a jogar.`);
        else if (saiu.papel === "entrou" && saiu.onMinute != null && l.onMinute != null && saiu.onMinute > l.onMinute) {
          erros.push(`${nome} entrou ao ${l.onMinute}′ por ${nomeDe(l.substitui)}, que só entrou ao ${saiu.onMinute}′.`);
        }
      }
      // Quem saiu a meio sem ninguém entrar por ele (e sem ser expulso) deixa a equipa com menos um.
      for (const l of emCampo) {
        if (l.offMinute != null && !l.redCard && !saidas.has(l.athleteId)) avisos.push(`${nomeDe(l.athleteId)} saiu ao ${l.offMinute}′ e ninguém entrou por ele.`);
      }
    }
    return { erros, avisos };
  }
  const [revisao, setRevisao] = useState<{ erros: string[]; avisos: string[] } | null>(null);
  // Depois de uma tentativa, a revisão acompanha as correções em vez de ficar parada.
  const emRevisao = revisao ? verificar() : null;

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
        const l = linhaDo(s);
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
          // acende o Gravar, em vez de ficar por corrigir para sempre. Um
          // suplente sem entrada vale zero dos dois lados — ver `semEntrada`.
          (minutosDerivados(l, duracao, tempo) ?? 0) !== s.minutes ||
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
    [linhas, match.squad, duracao, tempo],
  );

  async function gravar(mesmoAssim = false) {
    setErro(null);
    const v = verificar();
    if (v.erros.length > 0 || (v.avisos.length > 0 && !mesmoAssim)) {
      setRevisao(v);
      return;
    }
    setRevisao(null);
    try {
      await correr(async () => {
        await saveAppearances(
          match.id,
          emCampo.map((l) => ({
            athleteId: l.athleteId,
            // Os minutos vêm sempre da conta. Um suplente sem minuto de entrada
            // vai a zero, e não a um palpite — o servidor faz a mesma conta.
            minutes: minutosDerivados(l, duracao, tempo) ?? 0,
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

  /* O basquetebol não tem cartões. */
  const semCartoes = sportById(match.sportId)?.code === "basketball";
  /* Os titulares vieram do pré-jogo e ainda não foram gravados. */
  const doPlano = fichaPorAbrir(match) && Boolean(match.plan?.slots.some((x) => x.athleteId)) && titulares > 0;
  const amarelos = emCampo.reduce((n, l) => n + l.yellowCards, 0);
  const vermelhos = emCampo.filter((l) => l.redCard).length;

  return (
    <>
      <Cartao className="overflow-hidden">
        {/*
          O véu cobre o cartão inteiro, resumo incluído.

          Enquanto grava, nada aqui dentro é verdade: o resumo conta os titulares
          do que está no ecrã, e o que está no ecrã ainda não é o que ficou
          gravado.
        */}
        <SaveVeil estado={estado}>
          <CartaoTopo
            titulo="Ficha de jogo"
            apoio={
              mayRecord
                ? doPlano
                  ? "Os titulares vêm da equipa inicial do Pré-jogo. Acerta o que mudou, diz quem entrou do banco e grava."
                  : "Diz de cada um se foi titular, se entrou do banco ou se não jogou. O resto é opcional."
                : emCampo.length === 0
                  ? "Por preencher."
                  : undefined
            }
          />
          <div className="space-y-3 px-5 pb-4">
            <ResumoDaFicha
              itens={[
                { valor: titulares, rotulo: titulares === 1 ? "titular" : "titulares" },
                { valor: emCampo.length - titulares, rotulo: emCampo.length - titulares === 1 ? "suplente utilizado" : "suplentes utilizados" },
                { valor: golos, rotulo: golos === 1 ? golo : `${golo}s`, tom: golos > 0 ? "ok" : undefined },
                ...(semCartoes
                  ? []
                  : [{
                  valor: (
                    <span className="inline-flex items-baseline gap-2">
                      <span className="text-warn">{amarelos}</span>
                      <span className="text-[15px] font-normal text-ink-4">·</span>
                      <span className="text-risk">{vermelhos}</span>
                    </span>
                  ),
                  rotulo: "amarelos · vermelhos",
                }]),
              ]}
            />
            <TempoAdicional match={match} mayRecord={mayRecord} onSaved={onSaved} />
          </div>

          <ul className="border-t border-line">
            {match.squad.map((s) => (
              <SheetRow
                key={s.athleteId}
                atleta={s}
                teamId={match.teamId}
                linha={linhaDo(s)}
                golo={golo}
                duracao={duracao}
                tempo={tempo}
                mayRecord={mayRecord}
                semCartoes={semCartoes}
                rotativo={rotativo}
                problemas={emRevisao ? incoerencias(linhaDo(s)) : []}
                substituicao={
                  comSubstituicoes && linhaDo(s).papel === "entrou"
                    ? {
                        valor: linhaDo(s).substitui,
                        // Quem estava em campo: os titulares e quem já tinha entrado, menos quem já foi substituído por outro.
                        opcoes: match.squad
                          .filter((o) => o.athleteId !== s.athleteId && jogou(linhaDo(o)))
                          .filter((o) => !match.squad.some((e) => e.athleteId !== s.athleteId && linhaDo(e).substitui === o.athleteId))
                          .map((o) => ({ id: o.athleteId, nome: o.name })),
                        onChange: (alvo) => substituir(s.athleteId, alvo, linhaDo(s).onMinute),
                      }
                    : undefined
                }
                onChange={(patch) => {
                  // No futebol, mudar o minuto de entrada arrasta o minuto de saída de quem foi substituído.
                  if (comSubstituicoes && "onMinute" in patch && linhaDo(s).papel === "entrou" && linhaDo(s).substitui) {
                    substituir(s.athleteId, linhaDo(s).substitui, patch.onMinute ?? null);
                    const { onMinute: _m, ...resto } = patch;
                    if (Object.keys(resto).length > 0) set(s.athleteId, resto);
                  } else if ("papel" in patch && patch.papel !== "entrou" && linhaDo(s).substitui) {
                    // Deixou de ser suplente utilizado: a substituição desfaz-se.
                    substituir(s.athleteId, null, null);
                    set(s.athleteId, patch);
                  } else set(s.athleteId, patch);
                }}
              />
            ))}
          </ul>
        </SaveVeil>
      </Cartao>

      {/*
        A revisão: o que a ficha tem de errado, dito de uma vez, quando se tenta
        gravar. Os erros travam; os avisos deixam gravar na mesma.
      */}
      {mayRecord && emRevisao && (emRevisao.erros.length > 0 || emRevisao.avisos.length > 0) && (
        <Cartao className="mc-entra">
          <CartaoTopo
            titulo={emRevisao.erros.length > 0 ? "Há coisas que não batem certo" : "Antes de gravar, confirma isto"}
            apoio={emRevisao.erros.length > 0 ? "Corrige o que está a vermelho para poder gravar." : "Podem ser esquecimentos. Se estiver certo assim, grava na mesma."}
          >
            <button type="button" className="ctl-ghost h-8" onClick={() => setRevisao(null)}>
              Fechar
            </button>
          </CartaoTopo>
          <ul className="space-y-1.5 px-5 pb-5">
            {emRevisao.erros.map((e) => (
              <li key={e} className="flex items-start gap-2.5 rounded-[12px] bg-risk-soft px-3 py-2 text-meta leading-relaxed text-risk">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-risk" />
                {e}
              </li>
            ))}
            {emRevisao.avisos.map((a) => (
              <li key={a} className="flex items-start gap-2.5 rounded-[12px] bg-warn-soft px-3 py-2 text-meta leading-relaxed text-warn">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" />
                {a}
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      {/* Gravar, sempre à mão: a ficha é comprida e o botão não pode ficar no fundo. */}
      {mayRecord && (
        <div className="sticky bottom-3 z-10 max-md:bottom-[calc(72px+env(safe-area-inset-bottom))] flex flex-wrap items-center gap-3 rounded-[16px] border border-line bg-surface/95 px-4 py-2.5 shadow-[0_10px_30px_-14px_rgb(26_25_23/0.35)] backdrop-blur">
          <span className="min-w-0 flex-1 text-meta">
            {erro ? (
              <span role="alert" className="text-risk">
                {erro}
              </span>
            ) : emRevisao && emRevisao.erros.length > 0 ? (
              <span className="font-medium text-risk">
                {emRevisao.erros.length === 1 ? "Há um erro por corrigir." : `Há ${emRevisao.erros.length} erros por corrigir.`}
              </span>
            ) : emRevisao && emRevisao.avisos.length > 0 ? (
              <span className="font-medium text-warn">
                {emRevisao.avisos.length === 1 ? "Há um aviso por confirmar." : `Há ${emRevisao.avisos.length} avisos por confirmar.`}
              </span>
            ) : mudou && !busy ? (
              <span className="font-medium text-warn">Há alterações por gravar.</span>
            ) : rotativo ? (
              <span className="text-ink-3">{emCampo.length === 0 ? "Ainda sem ninguém em campo." : "Ficha gravada."}</span>
            ) : semMinutos > 0 ? (
              /* Um aviso e não um travão: quem quiser os minutos dos suplentes escreve a entrada. */
              <span className="text-ink-3">
                {semMinutos === 1 ? "Um suplente sem minuto de entrada fica sem minutos contados." : `${semMinutos} suplentes sem minuto de entrada ficam sem minutos contados.`}
              </span>
            ) : (
              <span className="text-ink-3">{emCampo.length === 0 ? "Ainda sem ninguém em campo." : "Ficha gravada."}</span>
            )}
          </span>
          {/* Só com avisos (e sem erros) se pode gravar na mesma. */}
          {emRevisao && emRevisao.erros.length === 0 && emRevisao.avisos.length > 0 && (
            <button type="button" className="ctl-outline h-9" disabled={busy} onClick={() => void gravar(true)}>
              Gravar mesmo assim
            </button>
          )}
          <button type="button" className="ctl-primary h-9" disabled={busy || !mudou} onClick={() => void gravar()}>
            {busy ? "A gravar…" : "Gravar ficha"}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * A ficha ainda está por abrir: ninguém tem linha gravada.
 *
 * É só neste caso que o plano do pré-jogo preenche os titulares. Depois de uma
 * gravação, o que vale é o que ficou gravado: o plano não volta a mexer.
 */
const fichaPorAbrir = (match: Match) => !match.squad.some((s) => s.played);

/**
 * A linha de um convocado, a partir do que está gravado e, numa ficha por
 * abrir, do plano do pré-jogo: quem lá estava no campo entra como titular.
 *
 * O treinador montou a equipa antes do jogo; pedir-lhe para a marcar outra vez,
 * um a um, era perguntar duas vezes o mesmo. Fica por gravar (o botão acende),
 * para ele confirmar o que mudou à última hora.
 */
function linhaComPlano(match: Match, s: SquadRow): Linha {
  const l = linhaDe(s);
  if (fichaPorAbrir(match) && match.plan?.slots.some((x) => x.athleteId === s.athleteId)) return { ...l, papel: "titular" };
  return l;
}

function daFicha(match: Match): Record<string, Linha> {
  const linhas = Object.fromEntries(match.squad.map((s) => [s.athleteId, linhaComPlano(match, s)]));
  /*
   * Quem substituiu quem: lê-se dos minutos. Quem entrou ao 63 substituiu quem
   * saiu ao 63. Cada saída serve uma entrada só.
   */
  const usados = new Set<string>();
  for (const l of Object.values(linhas)) {
    if (l.papel !== "entrou" || l.onMinute == null) continue;
    const saiu = Object.values(linhas).find((o) => o.athleteId !== l.athleteId && jogou(o) && o.offMinute === l.onMinute && !usados.has(o.athleteId));
    if (saiu) {
      l.substitui = saiu.athleteId;
      usados.add(saiu.athleteId);
    }
  }
  return linhas;
}

function SheetRow({
  atleta,
  teamId,
  linha,
  golo,
  duracao,
  tempo,
  mayRecord,
  semCartoes,
  rotativo,
  problemas,
  substituicao,
  onChange,
}: {
  atleta: SquadRow;
  teamId: string;
  linha: Linha;
  golo: string;
  duracao: number;
  tempo: TempoDoJogo;
  mayRecord: boolean;
  semCartoes: boolean;
  rotativo: boolean;
  /** As contradições da linha. Só chegam depois de uma tentativa de gravar. */
  problemas: string[];
  substituicao?: { opcoes: { id: string; nome: string }[]; valor: string | null; onChange: (id: string | null) => void };
  onChange: (p: Partial<Linha>) => void;
}) {
  const a = athleteById(atleta.athleteId);

  /**
   * Escolher o papel arruma o resto.
   *
   * Passar a titular limpa o minuto de entrada (um titular entra aos 0, e um 63
   * ali seria uma contradição). Deixar de jogar limpa tudo: golos de quem não
   * entrou em campo é a linha que faz um pai telefonar.
   */
  function escolher(papel: Papel) {
    if (papel === "nao") {
      onChange({
        papel,
        minutes: 0, tally: 0, assists: 0, yellowCards: 0, redCard: false,
        onMinute: null, offMinute: null, yellowAt: [], redAt: null, tallyAt: [], assistsAt: [],
      });
      return;
    }
    // Os minutos já não se guardam aqui: saem de `minutosDerivados`.
    onChange({ papel, ...(papel === "titular" ? { onMinute: null } : {}) });
  }

  return (
    <LinhaDaFicha
      nome={atleta.name}
      numero={a ? (numeroNaEquipa(a, teamId) ?? a.squadNumber ?? null) : null}
      foto={a?.photoUrl}
      apoio={[atleta.position ?? "sem posição", atleta.isGuest ? `de ${atleta.guestFromTeam}` : null, atleta.callUpStatus === "DECLINED" ? "tinha dito que não podia" : null].filter(Boolean).join(" · ")}
      linha={linha}
      golo={golo}
      duracao={duracao}
      minutos={minutosDerivados(linha, duracao, tempo)}
      problemas={problemas}
      podeEditar={mayRecord}
      semCartoes={semCartoes}
      rotativo={rotativo}
      substituicao={substituicao}
      onPapel={escolher}
      onChange={onChange}
    />
  );
}

/* ========================================================================== */
/* A equipa de trabalho                                                       */
/* ========================================================================== */

/**
 * A equipa de trabalho, com a moldura desta página.
 *
 * O editor é partilhado com as Convocatórias — ver `components/MatchStaff`.
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
  return (
    <Panel>
      <MatchStaffEditor
        matchId={match.id}
        staff={match.staff}
        passou={passou}
        mayRecord={mayRecord}
        onSaved={onSaved}
        cabecalho={(juntar, n) => (
          <PanelHead title="Equipa de trabalho" hint={n > 0 ? `${n}` : undefined}>
            {juntar}
          </PanelHead>
        )}
      />
    </Panel>
  );
}
