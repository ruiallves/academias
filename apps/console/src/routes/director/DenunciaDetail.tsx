import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { cx, Empty, Monogram, Panel, PanelHead, Pill } from "@/components/primitives";
import { ChevronRight, EyeOff, Lock, MessageSquare, Send, ShieldAlert } from "@/lib/icons";
import { useApi } from "@/lib/query";
import { longDate, shortDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import {
  atualizarDenuncia,
  ESTADOS,
  responderDenuncia,
  responsaveisDasDenuncias,
  tomDoEstado,
  type DenunciaCompleta,
  type EstadoDaDenuncia,
  type MensagemDaDenuncia,
} from "@/lib/conduta";

/**
 * Um caso do canal de denúncia.
 *
 * ## O desenho
 *
 * À esquerda, o que aconteceu (como a família o contou) e a conversa; à
 * direita, o que o clube decide: o estado, quem trata, e quem enviou. A
 * conversa tem dois registos, e a diferença tem de se ver sem ler: a
 * **resposta à família** é uma mensagem como as outras, a **nota interna** fica
 * com fundo tingido e um cadeado, porque a família nunca a vê.
 *
 * ## O anonimato
 *
 * Numa denúncia anónima o cartão de quem enviou diz só isso. O servidor não
 * manda o nome, e por isso nem com a consola aberta no inspector se chega lá.
 */
export default function DenunciaDetail() {
  const { id } = useParams<{ id: string }>();
  const { session } = useSession();
  const podeTratar = can(session, "conduct:write");
  const { data, loading, error, reload } = useApi<DenunciaCompleta>(id ? `/api/denuncias/${id}` : null);

  if (error) return <Empty icon={ShieldAlert} title="Denúncia não encontrada" detail={error} />;
  if (loading && !data) return null;
  if (!data) return null;
  const d = data;

  return (
    <>
      <nav className="mb-3 flex items-center gap-1 text-meta text-ink-3" aria-label="Caminho">
        <Link to="/denuncias" className="hover:text-ink">
          Denúncias
        </Link>
        <ChevronRight className="size-3.5" strokeWidth={1.75} />
        <span className="text-ink-2">Caso #{d.number}</span>
      </nav>

      <PageHeader eyebrow={d.categoryLabel} title={`Caso #${d.number}`} subtitle={`Chegou a ${longDate(new Date(d.createdAt))}.`}>
        <Pill tone={tomDoEstado(d.status)}>{d.statusLabel}</Pill>
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Panel>
            <PanelHead title="O que aconteceu" />
            <div className="px-5 pb-5">
              <p className="whitespace-pre-wrap text-body leading-relaxed text-ink">{d.description}</p>
              <dl className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {d.happenedOn && <Facto rotulo="Quando" valor={shortDate(new Date(`${d.happenedOn}T12:00:00`))} />}
                {d.place && <Facto rotulo="Onde" valor={d.place} />}
                {d.involved && <Facto rotulo="Quem esteve envolvido" valor={d.involved} />}
                {d.athlete && <Facto rotulo="Educando" valor={d.athlete.team ? `${d.athlete.name} · ${d.athlete.team}` : d.athlete.name} />}
              </dl>
            </div>
          </Panel>

          <Conversa caso={d} podeEscrever={podeTratar} onChanged={reload} />
        </div>

        <aside className="space-y-5">
          <Decisoes caso={d} podeTratar={podeTratar} onChanged={reload} />
          <QuemEnviou caso={d} />
        </aside>
      </div>
    </>
  );
}

function Facto({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-4">{rotulo}</dt>
      <dd className="mt-0.5 text-body text-ink-2">{valor}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function QuemEnviou({ caso }: { caso: DenunciaCompleta }) {
  return (
    <Panel>
      <PanelHead title="Quem enviou" />
      <div className="px-5 pb-5">
        {caso.anonymous || !caso.reporter ? (
          <div className="flex items-start gap-3 rounded-[12px] bg-sunken/60 px-3.5 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-ink-3">
              <EyeOff className="size-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <div className="text-body font-medium text-ink">{caso.anonymous ? "Denúncia anónima" : "Conta removida"}</div>
              <p className="mt-0.5 text-meta leading-relaxed text-ink-3">
                {caso.anonymous
                  ? "Quem enviou pediu para não ser identificado. Continua a receber as respostas na app."
                  : "A conta de quem enviou já não existe no clube."}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <Monogram name={caso.reporter.name} />
            <div className="min-w-0">
              <div className="text-body font-medium text-ink">{caso.reporter.name}</div>
              {caso.reporter.role && <div className="text-meta text-ink-3">{caso.reporter.role}</div>}
              {caso.reporter.email && (
                <a href={`mailto:${caso.reporter.email}`} className="mt-1.5 block truncate text-meta text-ink-2 hover:underline">
                  {caso.reporter.email}
                </a>
              )}
              {caso.reporter.phone && (
                <a href={`tel:${caso.reporter.phone}`} className="block text-meta text-ink-2 hover:underline">
                  {caso.reporter.phone}
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

/** O estado e quem trata. Grava a cada escolha: são decisões de uma só pergunta. */
function Decisoes({ caso, podeTratar, onChanged }: { caso: DenunciaCompleta; podeTratar: boolean; onChanged: () => void }) {
  const [responsaveis, setResponsaveis] = useState<{ id: string; name: string; title: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (podeTratar) responsaveisDasDenuncias().then(setResponsaveis).catch(() => setResponsaveis([]));
  }, [podeTratar]);

  async function gravar(patch: { status?: EstadoDaDenuncia; assigneeId?: string | null }) {
    setBusy(true);
    setErro(null);
    try {
      await atualizarDenuncia(caso.id, patch);
      onChanged();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHead title="Seguimento" />
      <div className="space-y-4 px-5 pb-5">
        <div>
          <div className="mb-1.5 text-meta font-medium text-ink">Estado</div>
          <div role="radiogroup" aria-label="Estado da denúncia" className="grid grid-cols-2 gap-1.5">
            {ESTADOS.map((e) => {
              const on = caso.status === e.value;
              return (
                <button
                  key={e.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!podeTratar || busy}
                  onClick={() => !on && void gravar({ status: e.value })}
                  title={e.hint}
                  className={cx(
                    "flex h-10 items-center justify-center rounded-[var(--radius-control)] border text-meta font-medium transition-colors duration-[120ms] disabled:opacity-60",
                    on ? "border-signal-line bg-signal-soft text-signal-ink" : "border-line bg-surface text-ink-2 hover:bg-sunken",
                  )}
                >
                  {e.label}
                </button>
              );
            })}
          </div>
          {caso.resolvedAt && <p className="mt-1.5 text-[11px] text-ink-4">Fechada a {longDate(new Date(caso.resolvedAt))}.</p>}
        </div>

        <div>
          <label className="mb-1.5 block text-meta font-medium text-ink" htmlFor="denuncia-responsavel">
            Quem trata
          </label>
          <select
            id="denuncia-responsavel"
            value={caso.assignee?.id ?? ""}
            disabled={!podeTratar || busy}
            onChange={(e) => void gravar({ assigneeId: e.target.value || null })}
            className="h-10 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-body text-ink focus:border-line-strong focus:outline-none disabled:opacity-60"
          >
            <option value="">Ninguém ainda</option>
            {responsaveis.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.title ? ` · ${r.title}` : ""}
              </option>
            ))}
            {caso.assignee && !responsaveis.some((r) => r.id === caso.assignee?.id) && (
              <option value={caso.assignee.id}>{caso.assignee.name}</option>
            )}
          </select>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">Só quem tem acesso às denúncias pode ficar responsável.</p>
        </div>

        {erro && <p className="text-meta text-risk">{erro}</p>}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A conversa com quem enviou, e as notas só para o clube.
 *
 * O registo escolhe-se antes de escrever, e a caixa muda de cor com ele: quem
 * está a escrever uma nota interna vê o fundo tingido e o cadeado o tempo todo,
 * e não só num rótulo pequeno. É a diferença entre "o pai vai ler isto" e
 * "ninguém de fora lê isto", e não pode depender de ler letra miúda.
 */
function Conversa({ caso, podeEscrever, onChanged }: { caso: DenunciaCompleta; podeEscrever: boolean; onChanged: () => void }) {
  const [registo, setRegisto] = useState<"familia" | "interna">("familia");
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);
  const fechada = caso.status === "RESOLVED" || caso.status === "ARCHIVED";

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "nearest" });
  }, [caso.messages.length]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!texto.trim() || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await responderDenuncia(caso.id, texto.trim(), registo === "interna");
      setTexto("");
      onChanged();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível enviar.");
    } finally {
      setBusy(false);
    }
  }

  const interna = registo === "interna";

  return (
    <Panel>
      <PanelHead title="Conversa" hint={caso.messages.length > 0 ? String(caso.messages.length) : undefined} />

      {caso.messages.length === 0 ? (
        <p className="px-5 pb-5 text-meta leading-relaxed text-ink-3">
          Ainda sem mensagens. Uma resposta à família chega-lhe à app como notificação; uma nota interna fica só aqui.
        </p>
      ) : (
        <ol className="space-y-3 px-5 pb-5">
          {caso.messages.map((m) => (
            <Mensagem key={m.id} m={m} />
          ))}
          <div ref={fim} />
        </ol>
      )}

      {podeEscrever && (
        <form onSubmit={enviar} className={cx("border-t border-line px-5 py-4 transition-colors duration-150", interna && "bg-warn-soft/40")}>
          <div role="radiogroup" aria-label="A quem se escreve" className="mb-3 inline-flex rounded-full bg-sunken p-0.5">
            {(
              [
                ["familia", "Responder a quem enviou", MessageSquare],
                ["interna", "Nota interna", Lock],
              ] as const
            ).map(([v, rotulo, Icone]) => {
              const on = registo === v;
              return (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setRegisto(v)}
                  className={cx(
                    "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-meta font-medium transition-colors duration-[120ms]",
                    on ? "bg-surface text-ink shadow-[0_1px_2px_rgb(26_25_23/0.12)]" : "text-ink-3 hover:text-ink",
                  )}
                >
                  <Icone className="size-3.5" strokeWidth={1.75} />
                  {rotulo}
                </button>
              );
            })}
          </div>

          <label htmlFor="denuncia-mensagem" className="sr-only">
            {interna ? "Nota interna" : "Resposta a quem enviou"}
          </label>
          <textarea
            id="denuncia-mensagem"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            maxLength={3000}
            placeholder={interna ? "Só o clube vê isto. O que se apurou, com quem se falou…" : fechada ? "O caso está fechado, mas ainda se pode escrever à família." : "A família recebe isto na app."}
            className="w-full resize-y rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2.5 text-body text-ink placeholder:text-ink-4 focus:border-line-strong focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-[11px] leading-relaxed text-ink-4">
              {interna ? "A família nunca vê as notas internas." : "Responder a um caso novo passa-o a «Em análise»."}
            </p>
            <button type="submit" className={cx("h-9", interna ? "ctl-outline" : "ctl-primary")} disabled={!texto.trim() || busy}>
              {busy ? "A enviar…" : interna ? <><Lock className="size-3.5" strokeWidth={1.75} /> Guardar nota</> : <><Send className="size-3.5" strokeWidth={1.75} /> Responder</>}
            </button>
          </div>
          {erro && <p className="mt-2 text-meta text-risk">{erro}</p>}
        </form>
      )}
    </Panel>
  );
}

function Mensagem({ m }: { m: MensagemDaDenuncia }) {
  const quem = m.fromStaff ? (m.authorName ?? "O clube") : (m.authorName ?? "Quem enviou");
  return (
    <li
      className={cx(
        "rounded-[14px] px-4 py-3",
        m.internal ? "border border-dashed border-warn/40 bg-warn-soft/50" : m.fromStaff ? "bg-signal-soft/50" : "bg-sunken/60",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
        {m.internal && (
          <span className="inline-flex items-center gap-1 font-medium text-warn">
            <Lock className="size-3" strokeWidth={2} />
            Nota interna
          </span>
        )}
        <span className="font-medium text-ink-2">{quem}</span>
        <span className="text-ink-4">{longDate(new Date(m.createdAt))}</span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-body leading-relaxed text-ink">{m.body}</p>
    </li>
  );
}
