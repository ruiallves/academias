import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/Shell";
import { Empty, Panel, Pill, cx, type Tone } from "@/components/primitives";
import { Dialog, Field, INPUT, Numeros } from "@/components/comercial/ui";
import { Failed, Skeleton } from "../Overview";
import { apiDelete, apiPatch, apiPost } from "@/lib/http";
import { useApi } from "@/lib/query";
import { euros, eurosExact } from "@/lib/format";
import type { Carteira as CarteiraT, CarteiraClube, ComercialPessoa, EstadoNaCarteira, Me } from "@/lib/types";

/**
 * A carteira de um comercial pago à comissão: os clubes que trouxe e o que lhe
 * rendem.
 *
 * O comercial vê a sua, sem mexer. O dono e os administradores escolhem a
 * pessoa, juntam clubes (os que vieram de reuniões dela aparecem primeiro) e
 * ajustam a percentagem, o prazo e o início de cada um.
 *
 * "Por mês" é a estimativa pela mensalidade de hoje de cada clube a pagar. O que
 * se paga de facto sai do que os clubes pagaram em cada mês (ver "O meu mês").
 */
export default function Carteira({ me }: { me: Me }) {
  const gere = me.role === "OWNER" || me.role === "ADMIN";
  const equipa = useApi<ComercialPessoa[]>(gere ? "/comercial/equipa" : null);
  const [pessoa, setPessoa] = useState<string | null>(gere ? null : me.id);

  useEffect(() => {
    if (!gere || pessoa || !equipa.data?.length) return;
    // Abre na primeira pessoa à comissão, que é quem tem carteira.
    const aComissao = equipa.data.find((p) => p.compensation.payModel === "COMMISSION");
    setPessoa((aComissao ?? equipa.data[0]).id);
  }, [gere, pessoa, equipa.data]);

  const caminho = pessoa ? `/comercial/carteira${gere ? `?pessoa=${pessoa}` : ""}` : null;
  const { data, loading, error, reload } = useApi<CarteiraT>(caminho);
  const [juntar, setJuntar] = useState(false);
  const [editar, setEditar] = useState<CarteiraClube | null>(null);

  if (gere && equipa.loading && !equipa.data) return <Skeleton />;
  if (gere && equipa.data && equipa.data.length === 0) {
    return (
      <>
        <PageHeader title="Carteira" />
        <Panel>
          <Empty title="Ainda não há comerciais" detail="Convida a pessoa em Administradores com o papel Comercial e escolhe o pagamento à comissão nas Condições." />
        </Panel>
      </>
    );
  }
  if (loading && !data) return <Skeleton />;
  if (error && !data) return <Failed message={error} onRetry={reload} />;
  if (!data) return <Skeleton />;

  const d = data;
  const t = d.totals;
  const max = Math.max(1, ...d.months.map((m) => m.cents));
  const primeiro = d.admin.name.split(" ")[0];

  return (
    <>
      <PageHeader
        title={gere ? "Carteira" : "A minha carteira"}
        subtitle={gere ? d.admin.name : "Os clubes que trouxeste e o que te rendem"}
      >
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
        {gere && (
          <button type="button" onClick={() => setJuntar(true)} className="ctl-primary h-9 cursor-pointer px-3">
            <Plus className="size-3.5" strokeWidth={2} />
            Juntar clube
          </button>
        )}
      </PageHeader>

      {gere && d.payModel !== "COMMISSION" && (
        <p className="mb-5 rounded-[var(--radius-panel)] border border-line bg-surface px-5 py-3.5 text-body text-ink-2">
          {primeiro} recebe à hora, por isso a carteira não lhe paga nada. Para pagar à comissão, muda nas{" "}
          <Link to="/comercial/mes" className="text-ink underline underline-offset-2">
            Condições do mês
          </Link>
          .
        </p>
      )}

      <div className="mb-5">
        <Numeros
          items={[
            { label: "A receber por mês", value: euros(t.porMesCents), note: `${t.aPagar} ${t.aPagar === 1 ? "clube a pagar" : "clubes a pagar"}` },
            { label: "Este mês", value: euros(t.esteMesCents), note: "dos clubes que já pagaram" },
            { label: "Clubes na carteira", value: String(t.clubes), note: t.emExperiencia ? `${t.emExperiencia} em experiência` : "nenhum em experiência" },
            { label: "Ganho no total", value: euros(t.ganhoCents), note: "desde o primeiro clube" },
          ]}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel className="min-w-0">
          <header className="border-b border-line px-5 py-3.5">
            <h2 className="text-panel text-ink">Clubes</h2>
          </header>
          {d.clubs.length === 0 ? (
            <Empty
              title="Ainda não há clubes na carteira"
              detail={
                gere
                  ? `Quando um clube de uma reunião de ${primeiro} passar a cliente, junta-o aqui com "Juntar clube".`
                  : "Quando um clube de uma reunião tua passar a cliente, aparece aqui com o que te rende por mês."
              }
            />
          ) : (
            <ul>
              {d.clubs.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3.5 last:border-b-0">
                  <div className="min-w-0 flex-1 basis-[220px]">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-body font-medium text-ink">{c.name}</span>
                      <Pill tone={ESTADO[c.estado].tone}>{ESTADO[c.estado].label}</Pill>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-ink-4">
                      {[c.plan, c.mensalidadeCents ? `${eurosExact(c.mensalidadeCents)}/mês` : null, `${c.percent} %`, prazo(c)].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <dl className="flex shrink-0 gap-6 text-right">
                    <div>
                      <dt className="text-[11px] text-ink-4">Por mês</dt>
                      <dd className={cx("text-body font-semibold tabular", c.porMesCents ? "text-ink" : "text-ink-4")}>{eurosExact(c.porMesCents)}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-ink-4">Ganho</dt>
                      <dd className="text-body text-ink-2 tabular">{eurosExact(c.ganhoCents)}</dd>
                    </div>
                  </dl>
                  {gere && (
                    <button type="button" onClick={() => setEditar(c)} className="ctl-ghost size-8 shrink-0 cursor-pointer justify-center px-0" aria-label={`Ajustar ${c.name}`}>
                      <Pencil className="size-3.5" strokeWidth={1.75} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="min-w-0">
          <header className="border-b border-line px-5 py-3.5">
            <h2 className="text-panel text-ink">Últimos 12 meses</h2>
            <p className="mt-0.5 text-[11px] text-ink-4">Comissão dos pagamentos que os clubes fizeram em cada mês</p>
          </header>
          <ul className="px-5 py-3">
            {d.months.map((m) => (
              <li key={m.month} className="grid grid-cols-[64px_minmax(0,1fr)_72px] items-center gap-3 py-1.5">
                <span className="text-meta text-ink-3" title={m.label}>{mesCurto(m.month)}</span>
                <span className="h-2 overflow-hidden rounded-full bg-sunken">
                  <span className="block h-full rounded-full bg-signal" style={{ width: `${(m.cents / max) * 100}%` }} />
                </span>
                <span className={cx("text-right text-meta tabular", m.cents ? "text-ink" : "text-ink-4")}>{euros(m.cents)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <p className="mt-4 max-w-[720px] text-meta leading-relaxed text-ink-3">
        "Por mês" é a conta pela mensalidade atual de cada clube a pagar, sem IVA. O valor de cada mês sai dos pagamentos que os clubes fizeram nesse mês: um clube que paga o ano de uma vez dá a comissão do ano nesse mês.
      </p>

      {juntar && <JuntarDialog carteira={d} onClose={() => setJuntar(false)} onSaved={reload} />}
      {editar && <EditarDialog clube={editar} onClose={() => setEditar(null)} onSaved={reload} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */

const ESTADO: Record<EstadoNaCarteira, { label: string; tone: Tone }> = {
  ativo: { label: "A pagar", tone: "ok" },
  "em-atraso": { label: "Em atraso", tone: "warn" },
  experiencia: { label: "Em experiência", tone: "signal" },
  suspenso: { label: "Suspenso", tone: "risk" },
  cancelado: { label: "Cancelado", tone: "neutral" },
  terminou: { label: "Prazo acabou", tone: "neutral" },
  retirado: { label: "Fora da carteira", tone: "neutral" },
};

const dia = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("pt-PT");

/** `2026-11` → "nov 26". */
function mesCurto(ym: string): string {
  const nome = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString("pt-PT", { month: "short" }).replace(".", "");
  return `${nome} ${ym.slice(2, 4)}`;
}

function prazo(c: CarteiraClube): string {
  if (c.endedOn) return `saiu a ${dia(c.endedOn)}`;
  if (c.endsOn) return `de ${dia(c.startsOn)} a ${dia(c.endsOn)}`;
  return `desde ${dia(c.startsOn)}, enquanto pagar`;
}

const PRAZOS = [6, 12, 18, 24, 36, 48, 60];

function PrazoSelect({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const opcoes = value !== null && !PRAZOS.includes(value) ? [...PRAZOS, value].sort((a, b) => a - b) : PRAZOS;
  return (
    <select className={INPUT} value={value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">Enquanto o clube pagar</option>
      {opcoes.map((m) => (
        <option key={m} value={m}>
          {m} meses
        </option>
      ))}
    </select>
  );
}

function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function percentValido(s: string): number | null {
  const n = Number(s.replace(",", "."));
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
}

function JuntarDialog({ carteira, onClose, onSaved }: { carteira: CarteiraT; onClose: () => void; onSaved: () => void }) {
  const livres = carteira.livres ?? [];
  const [clube, setClube] = useState(livres.find((l) => l.sugerido)?.id ?? "");
  const [percent, setPercent] = useState(String(carteira.defaults.percent));
  const [months, setMonths] = useState<number | null>(carteira.defaults.months);
  const [inicio, setInicio] = useState(hojeISO());
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const p = percentValido(percent);
  const valido = Boolean(clube) && p !== null && Boolean(inicio);
  const escolhido = livres.find((l) => l.id === clube);

  async function guardar() {
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await apiPost(`/comercial/equipa/${carteira.admin.id}/carteira`, { academyId: clube, percent: p, months, startsOn: inicio, note: nota.trim() || null });
      onSaved();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível juntar o clube.");
    } finally {
      setBusy(false);
    }
  }

  const sugeridos = livres.filter((l) => l.sugerido);
  const outros = livres.filter((l) => !l.sugerido);

  return (
    <Dialog title="Juntar clube à carteira" subtitle={carteira.admin.name} onClose={onClose} width={460}>
      <div className="space-y-4 px-5 py-5">
        {livres.length === 0 ? (
          <p className="text-body text-ink-2">Todos os clubes já estão numa carteira.</p>
        ) : (
          <Field label="Clube">
            <select className={INPUT} value={clube} onChange={(e) => setClube(e.target.value)}>
              <option value="">Escolhe o clube</option>
              {sugeridos.length > 0 && (
                <optgroup label={`De reuniões de ${carteira.admin.name.split(" ")[0]}`}>
                  {sugeridos.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label={sugeridos.length ? "Outros clubes" : "Clubes"}>
                {outros.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </Field>
        )}
        {escolhido && <p className="-mt-2 text-[11px] text-ink-4">{[escolhido.plan, ESTADO_DA_SUBSCRICAO[escolhido.status ?? ""] ?? "Sem plano"].filter(Boolean).join(" · ")}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Comissão" hint="% sem IVA">
            <input className={INPUT} inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^\d]/g, "").slice(0, 3))} />
          </Field>
          <Field label="Começa a contar">
            <input type="date" className={INPUT} value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </Field>
        </div>
        <Field label="Durante">
          <PrazoSelect value={months} onChange={setMonths} />
        </Field>
        <Field label="Nota" hint="opcional">
          <input className={INPUT} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Reunião de 12/11, fechou no dia seguinte" />
        </Field>
        <p className="text-meta leading-relaxed text-ink-3">
          Cada pagamento do clube a partir do dia escolhido dá {p ?? "…"} % do valor sem IVA a {carteira.admin.name.split(" ")[0]}
          {months ? `, durante ${months} meses.` : ", enquanto o clube pagar."}
        </p>
        {erro && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="ctl-ghost h-10 cursor-pointer px-3">
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={!valido || busy} className="ctl-primary h-10 cursor-pointer px-4">
            {busy ? "A juntar…" : "Juntar"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

const ESTADO_DA_SUBSCRICAO: Record<string, string> = {
  TRIALING: "Em experiência",
  ACTIVE: "A pagar",
  PAST_DUE: "Em atraso",
  CANCELLED: "Cancelado",
};

function EditarDialog({ clube, onClose, onSaved }: { clube: CarteiraClube; onClose: () => void; onSaved: () => void }) {
  const [percent, setPercent] = useState(String(clube.percent));
  const [months, setMonths] = useState<number | null>(clube.months);
  const [inicio, setInicio] = useState(clube.startsOn);
  const [nota, setNota] = useState(clube.note ?? "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const p = percentValido(percent);
  const fora = Boolean(clube.endedOn);

  async function enviar(extra: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(true);
    setErro(null);
    try {
      await apiPatch(`/comercial/carteira/${clube.id}`, { percent: p, months, startsOn: inicio, note: nota.trim() || null, ...extra });
      onSaved();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function apagar() {
    if (busy || !confirm(`Apagar ${clube.name} da carteira? Usa isto só para enganos: os meses já aprovados ficam como foram pagos.`)) return;
    setBusy(true);
    try {
      await apiDelete(`/comercial/carteira/${clube.id}`);
      onSaved();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível apagar.");
      setBusy(false);
    }
  }

  return (
    <Dialog title={clube.name} subtitle="Na carteira" onClose={onClose} width={460}>
      <div className="space-y-4 px-5 py-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Comissão" hint="% sem IVA">
            <input className={INPUT} inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^\d]/g, "").slice(0, 3))} />
          </Field>
          <Field label="Começa a contar">
            <input type="date" className={INPUT} value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </Field>
        </div>
        <Field label="Durante">
          <PrazoSelect value={months} onChange={setMonths} />
        </Field>
        <Field label="Nota" hint="opcional">
          <input className={INPUT} value={nota} onChange={(e) => setNota(e.target.value)} />
        </Field>
        <p className="text-[11px] text-ink-4">Mudar a comissão muda as contas dos meses por aprovar. Os meses aprovados ficam como estão.</p>
        {erro && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{erro}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1">
            <button type="button" onClick={() => enviar({ endedOn: fora ? null : hojeISO() })} disabled={busy || p === null} className="ctl-ghost h-10 cursor-pointer px-3">
              {fora ? "Voltar a pôr na carteira" : "Tirar da carteira"}
            </button>
            <button type="button" onClick={apagar} disabled={busy} className="ctl-ghost h-10 cursor-pointer px-3 text-risk" aria-label="Apagar da carteira">
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="ctl-ghost h-10 cursor-pointer px-3">
              Cancelar
            </button>
            <button type="button" onClick={() => enviar()} disabled={busy || p === null || !inicio} className="ctl-primary h-10 cursor-pointer px-4">
              {busy ? "A guardar…" : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
