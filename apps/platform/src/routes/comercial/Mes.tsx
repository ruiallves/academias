import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/Shell";
import { Empty, Panel, Pill, cx } from "@/components/primitives";
import { AnelComissao, Dialog, Field, INPUT, Numeros } from "@/components/comercial/ui";
import { ReuniaoDialog } from "@/components/comercial/ReuniaoDialog";
import { Failed, Skeleton } from "../Overview";
import { apiDelete, apiPatch, apiPost, apiPut } from "@/lib/http";
import { useApi } from "@/lib/query";
import { euros, eurosExact } from "@/lib/format";
import { dataCurta, hhmm, horas, mesAtual, nomeDoMes, paraInputLocal, somarMes } from "@/lib/comercial";
import { MEETING_STATUS_LABEL, type ComercialMes, type ComercialPessoa, type Me, type SalesMeeting, type SalesShift } from "@/lib/types";

/**
 * O mês de um comercial: quanto trabalhou, o que marcou e quanto se lhe paga.
 *
 * O comercial vê o seu, sem poder mexer. O dono e os administradores escolhem a
 * pessoa, corrigem turnos, decidem que reuniões contam, ajustam as condições e
 * aprovam o mês (o total entra nas Contas como gasto).
 */
export default function Mes({ me }: { me: Me }) {
  const gere = me.role === "OWNER" || me.role === "ADMIN";
  const [mes, setMes] = useState(mesAtual());
  const equipa = useApi<ComercialPessoa[]>(gere ? "/comercial/equipa" : null);
  const [pessoa, setPessoa] = useState<string | null>(gere ? null : me.id);

  useEffect(() => {
    if (gere && !pessoa && equipa.data?.length) setPessoa(equipa.data[0].id);
  }, [gere, pessoa, equipa.data]);

  const caminho = pessoa ? `/comercial/mes?mes=${mes}${gere ? `&pessoa=${pessoa}` : ""}` : null;
  const { data, loading, error, reload } = useApi<ComercialMes>(caminho);
  const [condicoes, setCondicoes] = useState(false);
  const [turno, setTurno] = useState<SalesShift | "novo" | null>(null);
  const [reuniao, setReuniao] = useState<SalesMeeting | null>(null);
  const [busy, setBusy] = useState(false);

  if (gere && equipa.loading && !equipa.data) return <Skeleton />;
  if (gere && equipa.data && equipa.data.length === 0) {
    return (
      <>
        <PageHeader title="Mês" />
        <Panel>
          <Empty
            title="Ainda não há comerciais"
            detail="Convida a pessoa em Administradores com o papel Comercial. Depois aparecem aqui as horas, as reuniões e quanto se lhe paga."
          />
          {me.role === "OWNER" && (
            <div className="flex justify-center pb-8">
              <Link to="/administradores" className="ctl-outline">
                Ir a Administradores
              </Link>
            </div>
          )}
        </Panel>
      </>
    );
  }
  if (loading && !data) return <Skeleton />;
  if (error && !data) return <Failed message={error} onRetry={reload} />;
  if (!data) return <Skeleton />;

  const d = data;
  const aprovado = Boolean(d.payout);
  const futuro = mes > mesAtual();
  const taxa = d.calls ? Math.round((d.answered / d.calls) * 100) : null;

  async function aprovar() {
    if (busy) return;
    if (!confirm(`Aprovar ${d.monthLabel} de ${d.admin.name} e lançar ${eurosExact(d.totalCents)} nas Contas?`)) return;
    setBusy(true);
    try {
      await apiPost(`/comercial/equipa/${d.admin.id}/meses/${d.month}/aprovar`, {});
      reload();
    } catch {
      /* cartão global de avisos */
    } finally {
      setBusy(false);
    }
  }

  async function desaprovar() {
    if (busy || !confirm("Desaprovar o mês? O gasto sai das Contas e os números voltam a ser os de hoje.")) return;
    setBusy(true);
    try {
      await apiDelete(`/comercial/equipa/${d.admin.id}/meses/${d.month}/aprovar`);
      reload();
    } catch {
      /* cartão global de avisos */
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={gere ? "Mês da equipa" : "O meu mês"} subtitle={gere ? d.admin.name : `As tuas horas, reuniões e o que tens a receber`}>
        {gere && equipa.data && equipa.data.length > 1 && (
          <select
            value={pessoa ?? ""}
            onChange={(e) => setPessoa(e.target.value)}
            aria-label="Comercial"
            className="h-9 cursor-pointer rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body text-ink focus:border-line-strong focus:outline-none"
          >
            {equipa.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <div className="flex h-9 items-center rounded-[var(--radius-control)] border border-line bg-surface">
          <button type="button" onClick={() => setMes(somarMes(mes, -1))} className="flex h-full w-9 cursor-pointer items-center justify-center text-ink-3 hover:text-ink" aria-label="Mês anterior">
            <ChevronLeft className="size-4" strokeWidth={1.75} />
          </button>
          <span className="min-w-[132px] text-center text-body font-medium text-ink">{nomeDoMes(mes)}</span>
          <button
            type="button"
            onClick={() => setMes(somarMes(mes, 1))}
            disabled={mes >= mesAtual()}
            className="flex h-full w-9 cursor-pointer items-center justify-center text-ink-3 hover:text-ink disabled:cursor-default disabled:opacity-30"
            aria-label="Mês seguinte"
          >
            <ChevronRight className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      </PageHeader>

      {/* O resumo: quanto, de onde vem, e a comissão a andar. */}
      <section className="panel mb-5 grid overflow-hidden md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 p-6">
          <p className="text-meta text-ink-3">{aprovado ? "Aprovado para pagar" : mes === mesAtual() ? "A receber até agora" : "A receber"}</p>
          <p className="mt-1 text-[40px] leading-none font-semibold tracking-[-0.03em] text-ink tabular">{eurosExact(d.totalCents)}</p>
          <dl className="mt-5 max-w-[420px] space-y-2 text-body">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-2">
                {horas(d.minutes)} de turnos × {euros(d.compensation.hourlyCents)}/h
              </dt>
              <dd className="text-ink tabular">{eurosExact(d.hoursCents)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-2">
                {d.commission.novas} {d.commission.novas === 1 ? "comissão" : "comissões"} × {euros(d.compensation.commissionCents)}
              </dt>
              <dd className="text-ink tabular">{eurosExact(d.commissionCents)}</dd>
            </div>
          </dl>
          {!d.configured && gere && (
            <p className="mt-4 text-meta text-warn">As condições ainda não foram definidas: está a contar 7 €/h, comissão a 0 € a cada 10 reuniões.</p>
          )}
        </div>
        <div className="flex items-center gap-5 border-t border-line bg-canvas/60 p-6 md:border-t-0 md:border-l">
          <AnelComissao feito={d.commission.progresso} total={d.commission.porComissao} />
          <div className="max-w-[170px] text-meta leading-relaxed text-ink-2">
            Uma comissão a cada <span className="font-medium text-ink">{d.commission.porComissao}</span> reuniões marcadas.
            <span className="mt-1 block text-ink-3">
              {d.commission.faltam === 1 ? "Falta 1" : `Faltam ${d.commission.faltam}`} para a próxima. O que sobra passa para o mês seguinte.
            </span>
          </div>
        </div>
      </section>

      <div className="mb-5">
        <Numeros
          items={[
            { label: "Horas", value: horas(d.minutes), note: `${d.shifts.length} ${d.shifts.length === 1 ? "turno" : "turnos"}` },
            { label: "Chamadas", value: String(d.calls), note: taxa !== null ? `${taxa}% atenderam` : "nenhuma ainda" },
            { label: "Reuniões marcadas", value: String(d.meetings.length), note: `${d.meetingsCounted} contam para a comissão` },
            {
              label: "Feitas",
              value: String(d.meetings.filter((m) => m.status === "REALIZADA").length),
              note: `${d.meetings.filter((m) => m.status === "MARCADA").length} por acontecer`,
            },
          ]}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel>
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <h2 className="text-panel text-ink">Turnos</h2>
            {gere && !aprovado && !futuro && (
              <button type="button" onClick={() => setTurno("novo")} className="ctl-ghost cursor-pointer">
                <Plus className="size-3.5" strokeWidth={2} />
                Acrescentar
              </button>
            )}
          </header>
          {d.shifts.length === 0 ? (
            <Empty title="Sem turnos neste mês" />
          ) : (
            <ul>
              {d.shifts.map((t) => (
                <li key={t.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-b-0">
                  <span className="w-16 shrink-0 text-body text-ink-2">{dataCurta(t.startedAt)}</span>
                  <span className="min-w-0 flex-1 font-mono text-meta text-ink-2 tabular">
                    {hhmm(t.startedAt)} – {t.endedAt ? hhmm(t.endedAt) : <span className="text-signal">a correr</span>}
                    {t.note && <span className="ml-2 font-sans text-ink-4">{t.note}</span>}
                  </span>
                  {t.tooLong && <Pill tone="warn">Esqueceu-se de terminar?</Pill>}
                  <span className="shrink-0 text-body font-medium text-ink tabular">{horas(t.minutes)}</span>
                  {gere && !aprovado && (
                    <button type="button" onClick={() => setTurno(t)} className="ctl-ghost size-8 shrink-0 cursor-pointer justify-center px-0" aria-label="Corrigir turno">
                      <Pencil className="size-3.5" strokeWidth={1.75} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <header className="border-b border-line px-5 py-3.5">
            <h2 className="text-panel text-ink">Reuniões marcadas no mês</h2>
          </header>
          {d.meetings.length === 0 ? (
            <Empty title="Nenhuma reunião marcada neste mês" />
          ) : (
            <ul>
              {d.meetings.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => setReuniao(m)}
                    className="flex w-full cursor-pointer items-center gap-3 border-b border-line px-5 py-3 text-left transition-colors duration-150 last:border-b-0 hover:bg-canvas"
                  >
                    <span className={cx("size-1.5 shrink-0 rounded-full", m.countsForCommission ? "bg-signal" : "bg-line-strong")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-ink">{m.contact?.name}</span>
                      <span className="block truncate text-[11px] text-ink-4">
                        Marcada a {dataCurta(m.createdAt)} para {dataCurta(m.scheduledAt)}
                        {!m.countsForCommission && " · não conta"}
                      </span>
                    </span>
                    <span className="shrink-0 text-meta text-ink-3">{MEETING_STATUS_LABEL[m.status]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* A aprovação, ao fundo, onde se chega depois de ver os números. */}
      {gere && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-line bg-surface px-5 py-4">
          <div className="min-w-0 text-body text-ink-2">
            {aprovado ? (
              <>
                Aprovado a {dataCurta(d.payout!.approvedAt)}
                {d.payout!.approvedBy ? ` por ${d.payout!.approvedBy}` : ""}.{" "}
                {d.payout!.transactionId ? (
                  <Link to="/contas" className="text-ink underline underline-offset-2">
                    Está nas Contas
                  </Link>
                ) : (
                  "Sem valor a lançar."
                )}
              </>
            ) : d.openShift ? (
              "Há um turno a correr neste mês. Termina-o ou corrige-o antes de aprovar."
            ) : (
              <>Ao aprovar, os números ficam fechados e {eurosExact(d.totalCents)} entram nas Contas como gasto.</>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => setCondicoes(true)} className="ctl-outline h-10 cursor-pointer px-3">
              <Settings2 className="size-3.5" strokeWidth={1.75} />
              Condições
            </button>
            {aprovado ? (
              <button type="button" onClick={desaprovar} disabled={busy} className="ctl-ghost h-10 cursor-pointer px-3">
                Desaprovar
              </button>
            ) : (
              <button type="button" onClick={aprovar} disabled={busy || d.openShift || futuro} className="ctl-primary h-10 cursor-pointer px-4">
                Aprovar {nomeDoMes(mes).split(" ")[0].toLowerCase()}
              </button>
            )}
          </div>
        </div>
      )}

      {condicoes && <CondicoesDialog pessoa={d.admin} atual={d.compensation} onClose={() => setCondicoes(false)} onSaved={reload} />}
      {turno && <TurnoDialog turno={turno === "novo" ? null : turno} adminId={d.admin.id} onClose={() => setTurno(null)} onSaved={reload} />}
      {reuniao && <ReuniaoDialog reuniao={reuniao} me={me} onClose={() => setReuniao(null)} onSaved={() => reload()} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function CondicoesDialog({
  pessoa,
  atual,
  onClose,
  onSaved,
}: {
  pessoa: { id: string; name: string };
  atual: ComercialMes["compensation"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [hora, setHora] = useState(centimosParaTexto(atual.hourlyCents));
  const [x, setX] = useState(String(atual.meetingsPerCommission));
  const [comissao, setComissao] = useState(centimosParaTexto(atual.commissionCents));
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const h = textoParaCentimos(hora);
  const c = textoParaCentimos(comissao);
  const n = Number(x);
  const valido = h !== null && c !== null && Number.isInteger(n) && n >= 1 && n <= 100;

  async function guardar() {
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await apiPut(`/comercial/equipa/${pessoa.id}/condicoes`, { hourlyCents: h, meetingsPerCommission: n, commissionCents: c });
      onSaved();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Condições" subtitle={pessoa.name} onClose={onClose} width={440}>
      <div className="space-y-4 px-5 py-5">
        <Field label="Valor por hora" hint="€">
          <input className={INPUT} inputMode="decimal" value={hora} onChange={(e) => setHora(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reuniões por comissão">
            <input className={INPUT} inputMode="numeric" value={x} onChange={(e) => setX(e.target.value.replace(/\D/g, "").slice(0, 3))} />
          </Field>
          <Field label="Valor da comissão" hint="€">
            <input className={INPUT} inputMode="decimal" value={comissao} onChange={(e) => setComissao(e.target.value)} />
          </Field>
        </div>
        <p className="text-meta leading-relaxed text-ink-3">
          {valido
            ? `A cada ${n} reuniões marcadas, ${pessoa.name.split(" ")[0]} ganha ${eurosExact(c!)}. A conta é acumulada: o que sobra de um mês passa para o seguinte. Uma reunião cancelada deixa de contar, e podes tirar ou pôr qualquer uma à mão.`
            : "Escreve os valores em euros (ex.: 7 ou 7,50) e um número de reuniões entre 1 e 100."}
        </p>
        <p className="text-[11px] text-ink-4">Mudar as condições muda as contas dos meses por aprovar. Os meses aprovados ficam como estão.</p>
        {erro && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="ctl-ghost h-10 cursor-pointer px-3">
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={!valido || busy} className="ctl-primary h-10 cursor-pointer px-4">
            {busy ? "A guardar…" : "Guardar"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function TurnoDialog({
  turno,
  adminId,
  onClose,
  onSaved,
}: {
  turno: SalesShift | null;
  adminId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [inicio, setInicio] = useState(paraInputLocal(turno?.startedAt ?? null));
  const [fim, setFim] = useState(paraInputLocal(turno?.endedAt ?? null));
  const [nota, setNota] = useState(turno?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const minutos = inicio && fim ? Math.round((new Date(fim).getTime() - new Date(inicio).getTime()) / 60_000) : null;

  async function guardar() {
    if (!inicio || !fim || busy) return;
    setBusy(true);
    setErro(null);
    const body = { startedAt: new Date(inicio).toISOString(), endedAt: new Date(fim).toISOString(), note: nota.trim() || null };
    try {
      if (turno) await apiPatch(`/comercial/turnos/${turno.id}`, body);
      else await apiPost(`/comercial/equipa/${adminId}/turnos`, body);
      onSaved();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function apagar() {
    if (!turno || !confirm("Apagar este turno? As horas saem do mês.")) return;
    try {
      await apiDelete(`/comercial/turnos/${turno.id}`);
      onSaved();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível apagar.");
    }
  }

  return (
    <Dialog title={turno ? "Corrigir turno" : "Acrescentar turno"} subtitle="Fica no registo, com a hora de antes e a de depois" onClose={onClose} width={440}>
      <div className="space-y-4 px-5 py-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Começou">
            <input type="datetime-local" className={INPUT} value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </Field>
          <Field label="Acabou">
            <input type="datetime-local" className={INPUT} value={fim} onChange={(e) => setFim(e.target.value)} />
          </Field>
        </div>
        {minutos !== null && <p className={cx("text-meta", minutos > 0 ? "text-ink-3" : "text-risk")}>{minutos > 0 ? `${horas(minutos)} de turno.` : "Tem de acabar depois de começar."}</p>}
        <Field label="Nota" hint="opcional">
          <input className={INPUT} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Esqueceu-se de terminar" />
        </Field>
        {erro && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{erro}</p>}
        <div className="flex items-center justify-between gap-2">
          {turno ? (
            <button type="button" onClick={apagar} className="ctl-ghost h-10 cursor-pointer px-3 text-risk">
              <Trash2 className="size-3.5" strokeWidth={1.75} />
              Apagar
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="ctl-ghost h-10 cursor-pointer px-3">
              Cancelar
            </button>
            <button type="button" onClick={guardar} disabled={!inicio || !fim || busy || (minutos ?? 0) <= 0} className="ctl-primary h-10 cursor-pointer px-4">
              {busy ? "A guardar…" : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function centimosParaTexto(c: number): string {
  return (c / 100).toLocaleString("pt-PT", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
}

function textoParaCentimos(s: string): number | null {
  const t = s.trim().replace(/\s|€/g, "").replace(",", ".");
  if (!t) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
