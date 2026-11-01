import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarPlus, Check, Copy, MessageCircle, Phone, Play, SkipForward, Square, Video, MapPin } from "lucide-react";
import { PageHeader } from "@/components/Shell";
import { Empty, Panel, cx } from "@/components/primitives";
import { ContactDialog } from "@/components/ContactDialog";
import { CalendarDialog } from "@/components/CalendarDialog";
import { RegistarChamada } from "@/components/comercial/RegistarChamada";
import { AnelComissao, Kbd, Numeros, QrLigar, Segmented } from "@/components/comercial/ui";
import { Failed, Skeleton } from "../Overview";
import { apiPost } from "@/lib/http";
import { useApi } from "@/lib/query";
import { whatsappHref } from "@/lib/google";
import { euros, since } from "@/lib/format";
import {
  cronometro,
  diaCurto,
  diasAte,
  filaDoDia,
  hhmm,
  horas,
  motivoNaFila,
  OUTCOME_LABEL,
  saudacao,
  telefoneLegivel,
} from "@/lib/comercial";
import type { CallOutcome, ComercialHoje, Contact, Me } from "@/lib/types";

type Aba = "seguimentos" | "novos" | "semResposta";

/**
 * Hoje: a próxima chamada, a fila do dia e como vai o mês.
 *
 * O cartão grande é o clube a quem ligar agora, com o número em grande e em QR
 * (o comercial liga do telemóvel). Regista-se o resultado e o cartão passa ao
 * seguinte. Por baixo, a fila: seguimentos marcados para hoje ou atrasados,
 * clubes novos e os que ficaram sem resposta. À direita, o turno, a comissão e
 * as próximas reuniões.
 */
export default function Hoje({ me }: { me: Me }) {
  const contactos = useApi<Contact[]>("/contactos");
  const hoje = useApi<ComercialHoje>("/comercial/hoje");
  const [lista, setLista] = useState<Contact[] | null>(null);
  const [focoId, setFocoId] = useState<string | null>(null);
  const [feitos, setFeitos] = useState<Set<string>>(new Set());
  const [aba, setAba] = useState<Aba>("seguimentos");
  const [zona, setZona] = useState("");
  const [aviso, setAviso] = useState<{ texto: string; id: number } | null>(null);
  const [ficha, setFicha] = useState<Contact | null>(null);
  const [calendario, setCalendario] = useState(false);

  useEffect(() => {
    if (contactos.data) setLista(contactos.data);
  }, [contactos.data]);

  const todos = useMemo(() => lista ?? [], [lista]);
  const naZona = useCallback((c: Contact) => !zona || (c.association ?? "Sem associação") === zona, [zona]);
  const fila = useMemo(() => {
    const f = filaDoDia(todos, me);
    return { seguimentos: f.seguimentos.filter(naZona), novos: f.novos.filter(naZona), semResposta: f.semResposta.filter(naZona) };
  }, [todos, me, naZona]);
  const zonas = useMemo(
    () => [...new Set(todos.map((c) => c.association ?? "Sem associação"))].sort((a, b) => a.localeCompare(b, "pt")),
    [todos],
  );

  /** O clube do cartão grande: o escolhido, ou o primeiro da fila que ainda não se fez hoje. */
  const foco = useMemo(() => {
    const escolhido = focoId ? todos.find((c) => c.id === focoId) : undefined;
    if (escolhido) return escolhido;
    const agora = Date.now();
    const porFazer = (c: Contact) => !feitos.has(c.id);
    return (
      fila.seguimentos.find((c) => porFazer(c) && new Date(c.nextActionAt!).getTime() <= agora) ??
      fila.seguimentos.find(porFazer) ??
      fila.novos.find(porFazer) ??
      null
    );
  }, [focoId, todos, fila, feitos]);

  // O aviso de "registado" some ao fim de 3,5 s.
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 3500);
    return () => clearTimeout(t);
  }, [aviso]);

  const saltar = useCallback(() => {
    if (!foco) return;
    setFeitos((s) => new Set(s).add(foco.id));
    setFocoId(null);
  }, [foco]);

  // S salta para o próximo, fora dos campos de texto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === "s" && foco && !ficha) {
        e.preventDefault();
        saltar();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [foco, ficha, saltar]);

  if ((contactos.loading && !lista) || (hoje.loading && !hoje.data)) return <Skeleton />;
  if (contactos.error && !lista) return <Failed message={contactos.error} onRetry={contactos.reload} />;

  const h = hoje.data;
  const comercial = me.role === "COMERCIAL";

  function registado(c: Contact, resultado: CallOutcome) {
    setLista((l) => (l ?? []).map((x) => (x.id === c.id ? c : x)));
    setFeitos((s) => new Set(s).add(c.id));
    setFocoId(null);
    setAviso({ texto: `${c.name}: ${OUTCOME_LABEL[resultado].toLowerCase()}`, id: Date.now() });
    hoje.reload();
  }

  const totalFila = fila.seguimentos.length + fila.novos.length;
  const linhas = fila[aba];
  const dataDeHoje = new Date().toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <PageHeader
        title={`${saudacao()}, ${me.name.split(" ")[0]}`}
        subtitle={`${dataDeHoje.charAt(0).toUpperCase()}${dataDeHoje.slice(1)} · ${
          totalFila === 0 ? "fila vazia" : `${fila.seguimentos.length} seguimentos e ${fila.novos.length} clubes novos na fila`
        }`}
      >
        {comercial && h && <Turno turno={h.turno} onChange={hoje.reload} />}
      </PageHeader>

      {h && (
        <div className="mb-5">
          <Numeros
            items={[
              { label: "Chamadas hoje", value: String(h.hoje.chamadas), note: `${h.semana.chamadas} esta semana` },
              {
                label: "Atenderam",
                value: h.hoje.chamadas ? `${Math.round((h.hoje.atendidas / h.hoje.chamadas) * 100)}%` : "—",
                note: `${h.hoje.atendidas} de ${h.hoje.chamadas} hoje`,
              },
              { label: "Reuniões marcadas", value: String(h.hoje.reunioes), note: `${h.semana.reunioes} esta semana` },
              ...(comercial ? [{ label: "Turno hoje", value: horas(h.hoje.minutos), note: `${horas(h.mes.minutos)} este mês` }] : []),
            ]}
          />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          {foco ? (
            <ProximaChamada key={foco.id} contact={foco} onDone={registado} onSkip={saltar} onOpen={() => setFicha(foco)} />
          ) : (
            <Panel>
              <Empty
                title={todos.length === 0 ? "Ainda não há clubes" : "Fila do dia feita"}
                detail={
                  todos.length === 0
                    ? "Acrescenta clubes em Clubes para começares a ligar."
                    : "Não há seguimentos nem clubes novos por ligar nesta zona. Escolhe outra zona ou um clube sem resposta."
                }
              />
            </Panel>
          )}

          <Panel>
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-line px-5">
              <Segmented<Aba>
                value={aba}
                onChange={setAba}
                options={[
                  { id: "seguimentos", label: "Seguimentos", count: fila.seguimentos.length },
                  { id: "novos", label: "Novos", count: fila.novos.length },
                  { id: "semResposta", label: "Sem resposta", count: fila.semResposta.length },
                ]}
              />
              <select
                value={zona}
                onChange={(e) => {
                  setZona(e.target.value);
                  setFocoId(null);
                }}
                aria-label="Zona"
                className="mb-1.5 h-8 cursor-pointer rounded-[var(--radius-control)] border border-line bg-surface px-2 text-meta text-ink-2 focus:border-line-strong focus:outline-none"
              >
                <option value="">Todas as zonas</option>
                {zonas.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
            {linhas.length === 0 ? (
              <Empty title="Nada aqui" detail={aba === "novos" ? "Todos os clubes desta zona já foram contactados." : undefined} />
            ) : (
              <ul>
                {linhas.slice(0, 60).map((c) => {
                  const ativo = foco?.id === c.id;
                  const atrasado = c.nextActionAt ? diasAte(new Date(c.nextActionAt)) < 0 : false;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setFocoId(c.id);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className={cx(
                          "flex w-full cursor-pointer items-center gap-3 border-b border-line px-5 py-3 text-left transition-colors duration-150 last:border-b-0",
                          ativo ? "bg-signal-soft/60" : "hover:bg-canvas",
                        )}
                      >
                        <span className={cx("size-1.5 shrink-0 rounded-full", atrasado ? "bg-risk" : ativo ? "bg-signal" : "bg-line-strong")} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body font-medium text-ink">{c.name}</span>
                          <span className="block truncate text-[11px] text-ink-4">
                            {[c.locality, c.association, c.personName].filter(Boolean).join(" · ") || "Sem mais dados"}
                          </span>
                        </span>
                        <span className={cx("hidden shrink-0 text-meta sm:block", atrasado ? "text-risk" : "text-ink-3")}>{motivoNaFila(c)}</span>
                        {feitos.has(c.id) && <Check className="size-3.5 shrink-0 text-ok" strokeWidth={2} aria-label="Já feito hoje" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <aside className="min-w-0 space-y-5">
          {h && (comercial || h.mes.configured) && <CartaoComissao h={h} />}

          <Panel>
            <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="text-panel text-ink">Próximas reuniões</h2>
              <Link to="/comercial/reunioes" className="text-meta text-ink-3 hover:text-ink">
                Ver todas
              </Link>
            </header>
            {!h || h.proximas.length === 0 ? (
              <p className="px-5 py-6 text-meta text-ink-3">Nenhuma marcada. A próxima sai de uma destas chamadas.</p>
            ) : (
              <ul>
                {h.proximas.map((r) => {
                  const d = new Date(r.scheduledAt);
                  return (
                    <li key={r.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-b-0">
                      <div className="flex w-10 shrink-0 flex-col items-center rounded-[8px] border border-line py-1">
                        <span className="text-[10px] font-medium text-ink-4 uppercase">{d.toLocaleDateString("pt-PT", { month: "short" }).replace(".", "")}</span>
                        <span className="text-[17px] leading-tight font-semibold text-ink tabular">{d.getDate()}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-body font-medium text-ink">{r.contact.name}</div>
                        <div className="flex items-center gap-1 truncate text-[11px] text-ink-3">
                          {r.mode === "PRESENCIAL" ? <MapPin className="size-3" /> : r.mode === "VIDEOCHAMADA" ? <Video className="size-3" /> : <Phone className="size-3" />}
                          {diaCurto(d)}, {hhmm(d)} · {r.personName}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="border-t border-line px-5 py-3">
              <button type="button" onClick={() => setCalendario(true)} className="ctl-ghost -ml-2.5 cursor-pointer">
                <CalendarPlus className="size-3.5" strokeWidth={1.75} />
                Ver no calendário do telemóvel
              </button>
            </div>
          </Panel>
        </aside>
      </div>

      {ficha && (
        <ContactDialog
          contact={ficha}
          todos={todos}
          grupo=""
          me={me}
          onClose={() => setFicha(null)}
          onSaved={() => contactos.reload()}
        />
      )}
      {calendario && <CalendarDialog onClose={() => setCalendario(false)} />}

      {aviso && (
        <div
          key={aviso.id}
          role="status"
          className="com-rise fixed right-5 bottom-5 z-[70] flex items-center gap-2.5 rounded-[10px] bg-ink px-4 py-3 text-body text-surface shadow-[var(--shadow-pop)] max-md:right-3 max-md:bottom-[84px] max-md:left-3"
        >
          <Check className="size-4 shrink-0 text-[#7fd1a8]" strokeWidth={2} />
          <span className="min-w-0 truncate">Registado. {aviso.texto}</span>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function ProximaChamada({
  contact: c,
  onDone,
  onSkip,
  onOpen,
}: {
  contact: Contact;
  onDone: (c: Contact, r: CallOutcome) => void;
  onSkip: () => void;
  onOpen: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const atrasado = c.nextActionAt ? diasAte(new Date(c.nextActionAt)) < 0 : false;
  const onde = [c.locality, c.association, c.sport !== "Futebol" ? c.sport : null].filter(Boolean).join(" · ");

  async function copiar() {
    if (!c.phone) return;
    try {
      await navigator.clipboard.writeText(c.phone.replace(/\s+/g, ""));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      /* sem permissão de área de transferência: o número está à vista */
    }
  }

  return (
    <section className="panel com-enter overflow-hidden">
      <div className="flex flex-col gap-6 p-6 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <p className={cx("flex items-center gap-1.5 text-meta", atrasado ? "text-risk" : "text-ink-3")}>
            <span className={cx("size-1.5 rounded-full", atrasado ? "bg-risk" : "bg-signal")} />
            {motivoNaFila(c) || "Próxima chamada"}
          </p>
          <h2 className="mt-2 text-[26px] leading-[1.15] font-semibold tracking-[-0.02em] text-ink">{c.name}</h2>
          {onde && <p className="mt-1 text-body text-ink-3">{onde}</p>}

          <div className="mt-5 space-y-1.5 text-body text-ink-2">
            {c.personName ? (
              <p>
                Falar com <span className="font-medium text-ink">{c.personName}</span>
                {c.role ? `, ${c.role.toLowerCase()}` : ""}
              </p>
            ) : (
              <p className="text-ink-3">Ainda não se sabe com quem falar. Pergunta pelo presidente ou pelo coordenador.</p>
            )}
            {c.lastTouch?.note && (
              <p className="text-meta text-ink-3">
                Última vez, {since(c.lastTouch.happenedAt)}: <span className="text-ink-2">{c.lastTouch.note}</span>
              </p>
            )}
            {c.notes && <p className="line-clamp-2 text-meta text-ink-3">Notas: {c.notes}</p>}
          </div>

          <div className="mt-5 flex flex-wrap gap-1.5">
            <button type="button" onClick={onOpen} className="ctl-outline cursor-pointer">
              Abrir ficha
              <ArrowRight className="size-3.5" strokeWidth={1.75} />
            </button>
            <button type="button" onClick={onSkip} className="ctl-ghost cursor-pointer">
              <SkipForward className="size-3.5" strokeWidth={1.75} />
              Saltar
              <Kbd>S</Kbd>
            </button>
          </div>
        </div>

        {c.phone ? (
          <div className="flex shrink-0 items-center gap-4 rounded-[12px] border border-line bg-canvas p-4">
            {/* No telemóvel já se está no telemóvel: toca-se no número. */}
            <div className="max-md:hidden">
              <QrLigar phone={c.phone} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] leading-snug text-ink-4 max-md:hidden">
                Aponta a câmara
                <br />
                do telemóvel para ligar
              </p>
              <p className="text-[11px] text-ink-4 md:hidden">Toca no número para ligar</p>
              <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="mt-2 block font-mono text-[21px] leading-tight font-medium tracking-tight whitespace-nowrap text-ink tabular hover:text-signal">
                {telefoneLegivel(c.phone)}
              </a>
              <div className="mt-2.5 flex gap-1">
                <button type="button" onClick={copiar} className="ctl-outline h-8 cursor-pointer px-2" aria-label="Copiar número">
                  {copiado ? <Check className="size-3.5 text-ok" strokeWidth={2} /> : <Copy className="size-3.5" strokeWidth={1.75} />}
                  {copiado ? "Copiado" : "Copiar"}
                </button>
                <a href={whatsappHref(c.phone)} target="_blank" rel="noreferrer" className="ctl-outline h-8 px-2" aria-label="Abrir no WhatsApp">
                  <MessageCircle className="size-3.5" strokeWidth={1.75} />
                </a>
              </div>
            </div>
          </div>
        ) : (
          <div className="shrink-0 rounded-[12px] border border-dashed border-line-strong p-4 text-meta text-ink-3 md:w-[230px]">
            Este clube não tem telefone.{" "}
            <button type="button" onClick={onOpen} className="cursor-pointer font-medium text-ink underline underline-offset-2">
              Acrescentar na ficha
            </button>
            {c.email && <span className="mt-1 block">Email: {c.email}</span>}
          </div>
        )}
      </div>

      <div className="border-t border-line bg-canvas/50 px-6 py-5">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h3 className="text-panel text-ink">Como correu?</h3>
          <span className="hidden text-[11px] text-ink-4 [@media(hover:hover)]:inline">1 a 6 escolhe · ↵ regista · S salta</span>
        </div>
        <RegistarChamada contact={c} atalhos onDone={onDone} />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/** O turno: um botão para começar e um cronómetro enquanto corre. */
function Turno({ turno, onChange }: { turno: ComercialHoje["turno"]; onChange: () => void }) {
  const [agora, setAgora] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!turno) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [turno]);

  async function mudar() {
    if (busy) return;
    if (turno && !confirm("Terminar o turno agora?")) return;
    setBusy(true);
    try {
      await apiPost(turno ? "/comercial/turno/terminar" : "/comercial/turno/iniciar", {});
      onChange();
    } catch {
      /* o erro aparece no cartão global de avisos */
    } finally {
      setBusy(false);
    }
  }

  if (!turno) {
    return (
      <button
        type="button"
        onClick={mudar}
        disabled={busy}
        className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] bg-signal px-4 text-body font-medium text-white transition-colors duration-150 hover:bg-signal-ink disabled:opacity-50"
      >
        <Play className="size-3.5 fill-current" strokeWidth={0} />
        Começar turno
      </button>
    );
  }

  return (
    <div className="flex h-10 items-center gap-3 rounded-[var(--radius-control)] border border-line bg-surface pr-1 pl-3.5">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-signal/50" />
        <span className="relative inline-flex size-2 rounded-full bg-signal" />
      </span>
      <span className="text-meta text-ink-3">Em turno</span>
      <span className="font-mono text-body font-medium text-ink tabular">{cronometro(agora - new Date(turno.startedAt).getTime())}</span>
      <button type="button" onClick={mudar} disabled={busy} className="ctl-ghost h-8 cursor-pointer px-2.5">
        <Square className="size-3 fill-current" strokeWidth={0} />
        Terminar
      </button>
    </div>
  );
}

function CartaoComissao({ h }: { h: ComercialHoje }) {
  const c = h.mes.comissao;
  return (
    <Panel>
      <header className="border-b border-line px-5 py-3.5">
        <h2 className="text-panel text-ink">Comissão</h2>
      </header>
      <div className="flex items-center gap-4 px-5 py-5">
        <AnelComissao feito={c.progresso} total={c.porComissao} size={112} />
        <p className="text-meta leading-relaxed text-ink-2">
          {c.faltam === 1 ? "Falta 1 reunião" : `Faltam ${c.faltam} reuniões`} para a próxima comissão.
          {c.novas > 0 && (
            <span className="mt-1 block font-medium text-ok">
              {c.novas} {c.novas === 1 ? "comissão ganha" : "comissões ganhas"} este mês.
            </span>
          )}
        </p>
      </div>
      <dl className="grid grid-cols-3 border-t border-line text-center">
        <div className="border-r border-line px-2 py-3">
          <dt className="text-[11px] text-ink-4">Horas</dt>
          <dd className="mt-0.5 text-body font-semibold text-ink tabular">{horas(h.mes.minutos)}</dd>
        </div>
        <div className="border-r border-line px-2 py-3">
          <dt className="text-[11px] text-ink-4">Reuniões</dt>
          <dd className="mt-0.5 text-body font-semibold text-ink tabular">{h.mes.reunioes}</dd>
        </div>
        <div className="px-2 py-3">
          <dt className="text-[11px] text-ink-4">Este mês</dt>
          <dd className="mt-0.5 text-body font-semibold text-ink tabular">{euros(h.mes.totalCents)}</dd>
        </div>
      </dl>
      <div className="border-t border-line px-5 py-3">
        <Link to="/comercial/mes" className="text-meta text-ink-3 hover:text-ink">
          Ver o mês
        </Link>
      </div>
    </Panel>
  );
}
