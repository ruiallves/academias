import { useRef, useState } from "react";
import { Check, Download, FileUp, Undo2 } from "lucide-react";
import { Empty, Panel, PanelHead, Pill } from "@/components/primitives";
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/http";
import { eurosExact, shortDate } from "@/lib/format";
import { useApi } from "@/lib/query";

type Periodo = {
  chave: string;
  noticeId: string | null;
  periodStart: string;
  periodEnd: string;
  dueOn: string | null;
  amountCents: number;
  enviado: boolean;
  paidAt: string | null;
  paidNote: string | null;
  paidBy: string | null;
  /** `MBWAY`, `MULTIBANCO` ou `MANUAL`. Nulo por pagar. */
  metodo: string | null;
  lembretes: number;
  suspensaoAvisada: boolean;
  /** Nulo numa paga = falta a fatura. `ficheiro` nulo = marcada como enviada sem anexo. */
  fatura: { em: string; ficheiro: string | null; emailPara: string | null; emailEm: string | null } | null;
};

const METODO: Record<string, string> = { MBWAY: "MB WAY", MULTIBANCO: "Multibanco", MANUAL: "transferência" };

type Mensalidades = {
  condicoes: {
    planName: string;
    billingPeriod: "MONTHLY" | "ANNUAL";
    amountCents: number;
    assinadas: boolean;
    startsOn: string;
  } | null;
  periodos: Periodo[];
};

/**
 * O que o clube nos paga, na ficha dele, e o botão de dar como recebido.
 *
 * Os pagamentos chegam pela consola do clube (MB WAY ou Multibanco, pela euPago
 * da plataforma) e marcam-se sozinhos; uma transferência à mão marca-se aqui,
 * com o botão. Aparecem os avisos que já saíram e também
 * os períodos que ainda não têm aviso (o que está a correr e o seguinte), para
 * se poder registar um pagamento adiantado ou de um clube que ainda não assinou
 * as condições. Contam as condições assinadas, ou as que estão por assinar.
 *
 * Marcar escreve o ganho nas Contas; desmarcar tira-o.
 */
export function MensalidadesDaPlataformaPanel({ academyId }: { academyId: string }) {
  const q = useApi<Mensalidades>(`/contas/clubes/${academyId}/mensalidades`);
  const [busy, setBusy] = useState<string | null>(null);

  if (q.loading && !q.data) return <Panel><div className="h-[120px] animate-pulse" /></Panel>;
  if (!q.data) return null;

  const { condicoes, periodos } = q.data;
  const hoje = new Date().toISOString().slice(0, 10);

  async function alternar(p: Periodo) {
    if (busy) return;
    setBusy(p.chave);
    try {
      if (p.paidAt && p.noticeId) await apiDelete(`/contas/mensalidades/${p.noticeId}/pago`);
      else if (p.noticeId) await apiPost(`/contas/mensalidades/${p.noticeId}/pago`, {});
      else await apiPost(`/contas/clubes/${academyId}/mensalidades`, { periodStart: p.chave });
      q.reload();
    } finally {
      setBusy(null);
    }
  }

  const hint = condicoes
    ? `${eurosExact(condicoes.amountCents)} ${condicoes.billingPeriod === "ANNUAL" ? "por ano" : "por mês"}${
        condicoes.assinadas ? "" : " · condições por assinar"
      }`
    : undefined;

  return (
    <Panel>
      <PanelHead title="Mensalidade da plataforma" hint={hint} />
      {!condicoes && periodos.length === 0 ? (
        <Empty
          title="Sem condições emitidas"
          detail="Os pagamentos aparecem aqui depois de se emitirem as condições do clube."
        />
      ) : (
        <ul>
          {periodos.map((p) => {
            const aCorrer = !p.paidAt && p.periodStart.slice(0, 10) <= hoje && p.periodEnd.slice(0, 10) >= hoje;
            const futuro = p.periodStart.slice(0, 10) > hoje;
            const vencido = !p.paidAt && p.dueOn !== null && p.dueOn.slice(0, 10) < hoje;
            return (
              <li key={p.chave} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-ink">
                    {shortDate(p.periodStart)} a {shortDate(p.periodEnd)}
                  </span>
                  <span className="block text-[11px] text-ink-4">
                    {p.paidAt
                      ? `recebido a ${shortDate(p.paidAt)}${p.metodo ? ` · ${METODO[p.metodo] ?? p.metodo}` : ""}${p.paidBy ? ` · ${p.paidBy}` : ""}`
                      : p.suspensaoAvisada
                        ? "suspenso por falta de pagamento"
                      : p.enviado
                        ? `aviso enviado${p.lembretes > 0 ? ` · ${p.lembretes} ${p.lembretes === 1 ? "lembrete" : "lembretes"}` : ""} · limite ${shortDate(p.dueOn)}`
                        : futuro
                          ? "próximo período"
                          : aCorrer
                            ? "período a correr"
                            : "sem aviso enviado"}
                  </span>
                </span>
                {p.paidAt ? (
                  <Pill tone="ok">Recebido</Pill>
                ) : vencido ? (
                  <Pill tone="risk">Vencido</Pill>
                ) : (
                  <Pill tone={futuro || aCorrer ? "neutral" : "warn"}>Por receber</Pill>
                )}
                <span className="shrink-0 text-body text-ink tabular">{eurosExact(p.amountCents)}</span>
                <button type="button" className="ctl-ghost shrink-0" disabled={busy !== null} onClick={() => void alternar(p)}>
                  {p.paidAt ? (
                    <>
                      <Undo2 className="size-3.5" strokeWidth={1.75} />
                      Desmarcar
                    </>
                  ) : (
                    <>
                      <Check className="size-3.5" strokeWidth={2} />
                      {busy === p.chave ? "A registar…" : "Recebido"}
                    </>
                  )}
                </button>
                {p.paidAt && p.noticeId && <FaturaDaMensalidade noticeId={p.noticeId} fatura={p.fatura} onMudou={q.reload} />}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/**
 * A fatura de uma mensalidade paga, por baixo da linha.
 *
 * A euPago não emite faturas: emitem-se no Portal das Finanças e anexam-se
 * aqui. Três gestos: anexar o PDF e enviá-lo ao responsável do clube por
 * email; anexar sem enviar; ou só marcar como enviada, quando a fatura seguiu
 * por outro caminho. Enquanto nenhum dos três acontecer, a lista dos clubes
 * diz "falta fatura". O PDF anexado fica também na consola do clube.
 */
function FaturaDaMensalidade({
  noticeId,
  fatura,
  onMudou,
}: {
  noticeId: string;
  fatura: Periodo["fatura"];
  onMudou: () => void;
}) {
  const ficheiro = useRef<HTMLInputElement>(null);
  const [enviar, setEnviar] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tom: "ok" | "risk"; texto: string } | null>(null);

  async function correr(trabalho: () => Promise<string | null>) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const texto = await trabalho();
      if (texto) setMsg({ tom: "ok", texto });
      onMudou();
    } catch (e) {
      setMsg({ tom: "risk", texto: e instanceof ApiError ? e.message : "Não foi possível." });
    } finally {
      setBusy(false);
    }
  }

  function anexar(f: File) {
    void correr(async () => {
      if (f.size > 5 * 1024 * 1024) throw new ApiError(400, "A fatura tem mais de 5 MB.");
      const base64 = await new Promise<string>((ok, falha) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
        r.onerror = () => falha(r.error);
        r.readAsDataURL(f);
      });
      const r = await apiPost<{ enviadaPara: string | null; motivo: string | null }>(
        `/contas/mensalidades/${noticeId}/fatura`,
        { fileName: f.name, base64, enviar },
      );
      if (enviar && !r.enviadaPara) return `Anexada, mas o email não saiu${r.motivo ? `: ${r.motivo}` : "."}`;
      return r.enviadaPara ? `Anexada e enviada para ${r.enviadaPara}.` : "Anexada, sem email.";
    });
  }

  async function abrir() {
    const r = await apiGet<{ ficheiro: string; base64: string }>(`/contas/mensalidades/${noticeId}/fatura`);
    const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = r.ficheiro;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-control)] bg-sunken/50 px-3 py-2">
      <input
        ref={ficheiro}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) anexar(f);
        }}
      />
      {fatura ? (
        <>
          <Pill tone="ok">Fatura</Pill>
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">
            {fatura.ficheiro ? fatura.ficheiro : "marcada como enviada, sem anexo"}
            {fatura.emailPara ? ` · enviada a ${fatura.emailPara}, ${shortDate(fatura.emailEm)}` : fatura.ficheiro ? " · sem email" : ""}
          </span>
          {fatura.ficheiro && (
            <button type="button" className="ctl-ghost" disabled={busy} onClick={() => void correr(async () => (await abrir(), null))}>
              <Download className="size-3.5" strokeWidth={1.75} />
              Abrir
            </button>
          )}
          <button
            type="button"
            className="ctl-ghost"
            disabled={busy}
            onClick={() => void correr(async () => (await apiDelete(`/contas/mensalidades/${noticeId}/fatura`), null))}
          >
            <Undo2 className="size-3.5" strokeWidth={1.75} />
            Tirar
          </button>
        </>
      ) : (
        <>
          <Pill tone="warn">Falta fatura</Pill>
          <span className="flex-1" />
          <span className="inline-flex items-center gap-1.5">
            <input
              id={`enviar-${noticeId}`}
              type="checkbox"
              checked={enviar}
              onChange={(e) => setEnviar(e.target.checked)}
              className="size-3.5 accent-[#1f7a45]"
            />
            <label htmlFor={`enviar-${noticeId}`} className="text-[11px] text-ink-3">
              enviar ao clube por email
            </label>
          </span>
          <button type="button" className="ctl-outline" disabled={busy} onClick={() => ficheiro.current?.click()}>
            <FileUp className="size-3.5" strokeWidth={1.75} />
            {busy ? "A anexar…" : "Anexar fatura"}
          </button>
          <button
            type="button"
            className="ctl-ghost"
            disabled={busy}
            onClick={() => void correr(async () => (await apiPost(`/contas/mensalidades/${noticeId}/fatura/enviada`, {}), null))}
          >
            Marcar como enviada
          </button>
        </>
      )}
      {msg && <span className={`basis-full text-[11px] ${msg.tom === "ok" ? "text-[#1f7a45]" : "text-[#a82a20]"}`}>{msg.texto}</span>}
    </div>
  );
}
