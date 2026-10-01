import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cx } from "@/components/primitives";
import { Check, ChevronDown, History } from "@/lib/icons";
import type { OpponentHistoryRow, OpponentReport } from "@/lib/matches";
import { Cartao, CartaoTopo, Emblema, Vazio } from "./ui";

/**
 * O adversário: o que se sabe dele, e tudo o que já se escreveu antes.
 *
 * ## Dois lados
 *
 * À esquerda, as notas deste jogo, que se escrevem antes (a preparação) e se
 * acertam depois (o que se viu). À direita, a memória do clube sobre este
 * adversário: o balanço dos jogos e cada registo anterior, com a data, a época
 * e quem o escreveu. É o que impede de começar do zero de cada vez que se volta
 * a jogar contra o mesmo clube.
 *
 * "Começar pelo último registo" copia as notas da última vez para este jogo,
 * para se corrigir em vez de reescrever.
 */

type Notas = Omit<OpponentReport, "updatedAt" | "authorName">;
const VAZIO: Notas = { formation: null, style: null, strengths: null, weaknesses: null, keyPlayers: null, setPieces: null, notes: null };

const CAMPOS: { campo: keyof Notas; rotulo: string; exemplo: string }[] = [
  { campo: "style", rotulo: "Como jogam", exemplo: "Bloco baixo, saem em transição pelo corredor esquerdo." },
  { campo: "strengths", rotulo: "Pontos fortes", exemplo: "Bolas paradas ofensivas, o ponta de lança no jogo aéreo." },
  { campo: "weaknesses", rotulo: "Pontos fracos", exemplo: "Espaço nas costas dos laterais, quebram depois dos 60 minutos." },
  { campo: "keyPlayers", rotulo: "Jogadores a ter em conta", exemplo: "O 10 organiza tudo. O 7 é muito rápido." },
  { campo: "setPieces", rotulo: "Bolas paradas", exemplo: "Cantos ao segundo poste. Marcam à zona." },
  { campo: "notes", rotulo: "Outras notas", exemplo: "O campo é pequeno e o piso é sintético." },
];

/** A época de uma data: de agosto a julho. `2026-10-03` → "2026/27". */
export function epocaDe(d: Date): string {
  const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}/${String((y + 1) % 100).padStart(2, "0")}`;
}

const dataLonga = (d: Date) => d.toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" });
const dataCurta = (d: Date) => d.toLocaleDateString("pt-PT", { day: "numeric", month: "short", year: "numeric" }).replace(/\./g, "");

function desfecho(l: { ourScore: number | null; theirScore: number | null }): "win" | "draw" | "loss" | null {
  if (l.ourScore === null || l.theirScore === null) return null;
  return l.ourScore > l.theirScore ? "win" : l.ourScore < l.theirScore ? "loss" : "draw";
}

export function Adversario({
  nome,
  registo,
  historico,
  podeEditar,
  onGuardar,
}: {
  nome: string;
  /** As notas deste jogo, se já existem. */
  registo: OpponentReport | null;
  /** Os outros jogos contra este adversário, do mais recente para trás. */
  historico: OpponentHistoryRow[];
  podeEditar: boolean;
  onGuardar: (notas: Notas) => Promise<void>;
}) {
  const inicial = (): Notas => ({ ...VAZIO, ...(registo ? { formation: registo.formation, style: registo.style, strengths: registo.strengths, weaknesses: registo.weaknesses, keyPlayers: registo.keyPlayers, setPieces: registo.setPieces, notes: registo.notes } : {}) });
  const [notas, setNotas] = useState<Notas>(inicial);
  const [aGuardar, setAGuardar] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setNotas(inicial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registo?.updatedAt]);

  const limpo = (v: string | null) => (v ?? "").trim();
  const mudou = (Object.keys(VAZIO) as (keyof Notas)[]).some((k) => limpo(notas[k]) !== limpo(registo?.[k] ?? null));
  const vazio = (Object.keys(VAZIO) as (keyof Notas)[]).every((k) => !limpo(notas[k]));
  const comRegisto = historico.filter((h) => h.report);
  const ultimo = comRegisto[0]?.report ?? null;

  async function guardar() {
    if (aGuardar) return;
    setAGuardar(true);
    setErro(null);
    try {
      await onGuardar(notas);
      setGuardado(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar as notas.");
    } finally {
      setAGuardar(false);
    }
  }

  const jogados = historico.filter((h) => desfecho(h));
  const v = jogados.filter((h) => desfecho(h) === "win").length;
  const e = jogados.filter((h) => desfecho(h) === "draw").length;
  const d = jogados.filter((h) => desfecho(h) === "loss").length;
  const campo = "w-full rounded-[12px] border border-line bg-surface px-3 text-body text-ink outline-none transition-colors placeholder:text-ink-4 focus:border-ink-3 read-only:bg-sunken/40";

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      {/* ------------------------------------------------------------ as notas deste jogo */}
      <Cartao>
        <header className="flex flex-wrap items-center gap-3.5 px-5 pt-5 pb-4">
          <Emblema nome={nome} tamanho={52} />
          <div className="min-w-0 flex-1 basis-[180px]">
            <h3 className="truncate text-[19px] leading-tight font-semibold tracking-[-0.015em] text-ink">{nome}</h3>
            <p className="mt-0.5 text-meta text-ink-3">
              {registo
                ? `Notas deste jogo, atualizadas a ${dataLonga(new Date(registo.updatedAt))}${registo.authorName ? ` por ${registo.authorName.split(" ")[0]}` : ""}.`
                : "Ainda sem notas para este jogo."}
            </p>
          </div>
          {podeEditar && vazio && ultimo && (
            <button
              type="button"
              className="ctl-outline h-9 max-sm:w-full max-sm:justify-center"
              onClick={() => {
                setNotas({ formation: ultimo.formation, style: ultimo.style, strengths: ultimo.strengths, weaknesses: ultimo.weaknesses, keyPlayers: ultimo.keyPlayers, setPieces: ultimo.setPieces, notes: ultimo.notes });
                setGuardado(false);
              }}
            >
              <History className="size-3.5" strokeWidth={1.75} />
              Começar pelo último registo
            </button>
          )}
        </header>

        <div className="space-y-4 px-5 pb-5">
          <div className="max-w-[220px]">
            <Rotulo>Sistema habitual</Rotulo>
            <input
              value={notas.formation ?? ""}
              onChange={(ev) => {
                setNotas({ ...notas, formation: ev.target.value });
                setGuardado(false);
              }}
              readOnly={!podeEditar}
              maxLength={40}
              placeholder="4-4-2"
              aria-label="Sistema habitual do adversário"
              className={cx(campo, "h-10")}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {CAMPOS.map((c) => (
              <div key={c.campo} className={c.campo === "notes" ? "md:col-span-2" : undefined}>
                <Rotulo>{c.rotulo}</Rotulo>
                <textarea
                  value={notas[c.campo] ?? ""}
                  onChange={(ev) => {
                    setNotas({ ...notas, [c.campo]: ev.target.value });
                    setGuardado(false);
                  }}
                  readOnly={!podeEditar}
                  maxLength={4000}
                  rows={3}
                  placeholder={podeEditar ? c.exemplo : "—"}
                  aria-label={c.rotulo}
                  className={cx(campo, "resize-y py-2.5 leading-relaxed")}
                />
              </div>
            ))}
          </div>

          {podeEditar && (
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <span className="text-meta text-ink-3">
                {erro ? (
                  <span className="text-risk" role="alert">
                    {erro}
                  </span>
                ) : guardado && !mudou ? (
                  <span className="inline-flex items-center gap-1 text-ok">
                    <Check className="size-3.5" strokeWidth={2} /> Notas guardadas
                  </span>
                ) : mudou ? (
                  "Há alterações por guardar."
                ) : (
                  "Ficam no histórico deste adversário, para a próxima vez."
                )}
              </span>
              <button type="button" className="ctl-primary ml-auto h-9" disabled={aGuardar || !mudou} onClick={() => void guardar()}>
                {aGuardar ? "A guardar…" : "Guardar notas"}
              </button>
            </div>
          )}
        </div>
      </Cartao>

      {/* ------------------------------------------------------------ a memória do clube */}
      <div className="space-y-4">
        <Cartao>
          <CartaoTopo titulo="Balanço" apoio={jogados.length === 0 ? "Ainda sem jogos com resultado contra este adversário." : `${jogados.length} ${jogados.length === 1 ? "jogo com resultado" : "jogos com resultado"}`} />
          {jogados.length > 0 && (
            <div className="px-5 pb-5">
              <div className="grid grid-cols-3 gap-2">
                <Numero valor={v} rotulo={v === 1 ? "vitória" : "vitórias"} tom="ok" />
                <Numero valor={e} rotulo={e === 1 ? "empate" : "empates"} />
                <Numero valor={d} rotulo={d === 1 ? "derrota" : "derrotas"} tom="risco" />
              </div>
              {/* Os últimos, do mais antigo para o mais recente: lê-se a tendência. */}
              <div className="mt-3 flex items-center gap-1.5">
                <span className="mr-1 text-[11.5px] text-ink-3">Últimos</span>
                {[...jogados].slice(0, 6).reverse().map((h) => {
                  const r = desfecho(h)!;
                  return (
                    <span
                      key={h.matchId}
                      title={`${dataCurta(new Date(h.startsAt))}: ${h.ourScore}–${h.theirScore}`}
                      className={cx("flex size-6 items-center justify-center rounded-full text-[10.5px] font-bold", r === "win" ? "bg-ok text-white" : r === "loss" ? "bg-risk text-white" : "bg-line-strong text-ink-2")}
                    >
                      {r === "win" ? "V" : r === "loss" ? "D" : "E"}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </Cartao>

        <Cartao>
          <CartaoTopo titulo="Registos anteriores" apoio={historico.length === 0 ? undefined : `${comRegisto.length} com notas · ${historico.length} ${historico.length === 1 ? "jogo" : "jogos"}`} />
          {historico.length === 0 ? (
            <Vazio icone={<History className="size-5" strokeWidth={1.75} />} titulo="É a primeira vez" texto="As notas que escreveres aqui ficam guardadas e aparecem da próxima vez que jogarem contra este clube." />
          ) : (
            <ol className="px-2 pb-2">
              {historico.map((h, i) => (
                <Registo key={h.matchId} linha={h} aberto={i === 0 && Boolean(h.report)} />
              ))}
            </ol>
          )}
        </Cartao>
      </div>
    </div>
  );
}

function Rotulo({ children }: { children: string }) {
  return <div className="mb-1.5 text-meta font-medium text-ink-2">{children}</div>;
}

function Numero({ valor, rotulo, tom }: { valor: number; rotulo: string; tom?: "ok" | "risco" }) {
  return (
    <div className="rounded-[14px] bg-sunken/60 px-3 py-3 text-center">
      <div className={cx("text-[26px] leading-none font-semibold tracking-[-0.02em] tabular", tom === "ok" ? "text-ok" : tom === "risco" ? "text-risk" : "text-ink")}>{valor}</div>
      <div className="mt-1 text-[11.5px] text-ink-3">{rotulo}</div>
    </div>
  );
}

/**
 * Um registo anterior: o jogo em que foi escrito, e o que se escreveu.
 *
 * Diz quando foi (a data e a época), em que equipa e prova, como acabou e quem
 * escreveu. Abre para mostrar as notas; um jogo sem notas mostra só o resultado.
 */
function Registo({ linha, aberto: abertoDeInicio }: { linha: OpponentHistoryRow; aberto: boolean }) {
  const [aberto, setAberto] = useState(abertoDeInicio);
  const d = new Date(linha.startsAt);
  const r = desfecho(linha);
  const rep = linha.report;
  const preenchidos = rep ? CAMPOS.filter((c) => (rep[c.campo] ?? "").trim()) : [];

  return (
    <li className="rounded-[14px] transition-colors hover:bg-sunken/40">
      <button type="button" disabled={!rep} aria-expanded={rep ? aberto : undefined} onClick={() => setAberto((x) => !x)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-body font-medium text-ink">{dataCurta(d)}</span>
            <span className="rounded-full bg-sunken px-2 py-px text-[11px] font-medium text-ink-2">Época {epocaDe(d)}</span>
          </span>
          <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">
            {[linha.teamName, linha.competition, linha.isHome ? "em casa" : "fora"].filter(Boolean).join(" · ")}
            {rep ? "" : " · sem notas"}
          </span>
        </span>
        {r ? (
          <span className={cx("shrink-0 rounded-[10px] px-2.5 py-1.5 text-[14px] leading-none font-semibold tabular", r === "win" ? "bg-ok-soft text-ok" : r === "loss" ? "bg-risk-soft text-risk" : "bg-sunken text-ink-2")}>
            {linha.ourScore}–{linha.theirScore}
          </span>
        ) : (
          <span className="shrink-0 text-[11.5px] text-ink-4">sem resultado</span>
        )}
        {rep && <ChevronDown className={cx("size-4 shrink-0 text-ink-4 transition-transform duration-150", aberto && "rotate-180")} strokeWidth={1.75} />}
      </button>

      {rep && aberto && (
        <div className="space-y-3 px-3 pb-3">
          <p className="text-[11.5px] text-ink-3">
            Registado a {dataLonga(new Date(rep.updatedAt))}
            {rep.authorName ? ` por ${rep.authorName}` : ""}.
          </p>
          {rep.formation && (
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-1 text-[11.5px] font-semibold text-surface">Sistema {rep.formation}</span>
            </div>
          )}
          {preenchidos.map((c) => (
            <div key={c.campo}>
              <div className="text-[11.5px] font-medium text-ink-3">{c.rotulo}</div>
              <p className="mt-0.5 text-body leading-relaxed whitespace-pre-line text-ink">{rep[c.campo]}</p>
            </div>
          ))}
          {preenchidos.length === 0 && !rep.formation && <p className="text-meta text-ink-4">O registo foi criado, mas ficou vazio.</p>}
          <Link to={`/jogos/${linha.matchId}?aba=adversario`} className="inline-flex text-meta font-medium text-ink-3 underline-offset-2 hover:text-ink hover:underline">
            Abrir esse jogo
          </Link>
        </div>
      )}
    </li>
  );
}
