import { useMemo, useState } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { Segmented } from "@/components/filters";
import { cx } from "@/components/primitives";
import { Ban, Check, Trash2, TriangleAlert } from "@/lib/icons";
import { listTeams } from "@/lib/api";
import { KIND_LABEL, useEvents, type CalendarEvent, type EventKind } from "@/lib/calendar";
import { apiPost } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import { isAcademyWide } from "@/lib/permissions";
import { useSession } from "@/session";

/**
 * Cancelar vários eventos de uma vez.
 *
 * O "Repetir" do novo evento cria uma série de treinos soltos, e um engano
 * (a hora errada, a equipa errada, até ao fim do ano) desfazia-se um a um. Aqui
 * escolhe-se o que apanhar (equipas, tipos, datas, dias da semana e hora),
 * vê-se a lista, tira-se o que não é para tirar, e confirma-se.
 *
 * ## As protecções
 *
 * - só entra o que ainda não começou;
 * - antes de gravar, o servidor verifica cada um (um ensaio) e a janela mostra
 *   o que fica de fora e porquê: fora das tuas equipas, presenças registadas,
 *   jogo disputado, e, para apagar, o que tem coisas agarradas (convocatória,
 *   plano, avisos de falta);
 * - **desmarcar** é o caminho por omissão: o evento fica riscado e reactiva-se
 *   à mão. Apagar é para enganos acabados de fazer, e pede-se de propósito.
 */
type Acao = "desmarcar" | "apagar";
type Linha = { id: string; ok: boolean; motivo?: string };
type Resposta = { ensaio: boolean; acao: Acao; feitos: number; ficamDeFora: number; linhas: Linha[] };

const TIPOS: EventKind[] = ["training", "match", "tournament", "other"];
const TIPO_PLURAL: Record<EventKind, string> = { training: "Treinos", match: "Jogos", tournament: "Torneios", other: "Outros" };
/** Segunda primeiro, como o calendário. `getDay()`: 0 é domingo. */
const DIAS = [
  { d: 1, l: "Seg" },
  { d: 2, l: "Ter" },
  { d: 3, l: "Qua" },
  { d: 4, l: "Qui" },
  { d: 5, l: "Sex" },
  { d: 6, l: "Sáb" },
  { d: 0, l: "Dom" },
];
/** Equipa "nenhuma": os eventos de toda a academia. */
const ACADEMIA = "__academia";

const paraInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const doInput = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};
const hora = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const diaCurto = (d: Date) =>
  d.toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");

export function CancelarEventosDialog({ onClose }: { onClose: () => void }) {
  const { session } = useSession();
  const equipas = listTeams(session);
  const daAcademia = isAcademyWide(session);

  const hoje = new Date();
  const [de, setDe] = useState(paraInput(hoje));
  // Por omissão, dois meses para a frente.
  const [ate, setAte] = useState(paraInput(new Date(hoje.getFullYear(), hoje.getMonth() + 2, hoje.getDate())));
  const [escolhidasEquipas, setEscolhidasEquipas] = useState<Set<string>>(() => new Set(equipas.map((t) => t.id)));
  const [tipos, setTipos] = useState<Set<EventKind>>(() => new Set<EventKind>(["training"]));
  const [dias, setDias] = useState<Set<number>>(() => new Set(DIAS.map((x) => x.d)));
  const [aHora, setAHora] = useState("");
  const [acao, setAcao] = useState<Acao>("desmarcar");
  /** Os que se tiraram à mão da lista. */
  const [tirados, setTirados] = useState<Set<string>>(new Set());

  const [ensaio, setEnsaio] = useState<Resposta | null>(null);
  const [feito, setFeito] = useState<Resposta | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // O intervalo pedido ao calendário: o dia "até" inteiro.
  const desde = doInput(de);
  const ateAoFim = new Date(doInput(ate).getTime() + 86_400_000);
  const intervaloOk = de !== "" && ate !== "" && desde < ateAoFim;
  const todos = useEvents(session, intervaloOk ? desde : hoje, intervaloOk ? ateAoFim : hoje);

  const apanhados: CalendarEvent[] = useMemo(() => {
    if (!intervaloOk) return [];
    const agora = Date.now();
    return todos
      .filter((e) => e.start.getTime() > agora)
      .filter((e) => e.start >= desde && e.start < ateAoFim)
      .filter((e) => e.mine !== false)
      .filter((e) => tipos.has(e.kind))
      .filter((e) => escolhidasEquipas.has(e.teamId ?? ACADEMIA))
      .filter((e) => dias.has(e.start.getDay()))
      .filter((e) => !aHora || hora(e.start) === aHora)
      // Desmarcar um desmarcado não faz nada; apagar um desmarcado é legítimo.
      .filter((e) => acao === "apagar" || !e.cancelled)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [todos, intervaloOk, de, ate, tipos, escolhidasEquipas, dias, aHora, acao]);

  const escolhidos = apanhados.filter((e) => !tirados.has(e.id));

  // Qualquer mudança aos filtros desfaz a verificação: ela era da lista anterior.
  const mexe = <A extends unknown[]>(f: (...a: A) => void) => (...a: A) => {
    setEnsaio(null);
    f(...a);
  };
  const alternar = <T,>(set: Set<T>, v: T): Set<T> => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };

  async function pedir(soEnsaio: boolean) {
    if (busy || escolhidos.length === 0) return;
    setBusy(true);
    setErro(null);
    try {
      const r = await apiPost<Resposta>("/api/events/cancelar-varios", {
        ids: escolhidos.map((e) => e.id),
        acao,
        ensaio: soEnsaio,
      });
      if (soEnsaio) setEnsaio(r);
      else {
        setFeito(r);
        await reloadAcademy();
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível.");
    } finally {
      setBusy(false);
    }
  }

  const porId = new Map(apanhados.map((e) => [e.id, e]));
  const ficam = ensaio?.linhas.filter((l) => !l.ok) ?? [];
  const verbo = acao === "apagar" ? "Apagar" : "Desmarcar";

  /* ---------------------------------------------------------- feito */
  if (feito) {
    return (
      <Dialog
        title={acao === "apagar" ? "Eventos apagados" : "Eventos desmarcados"}
        icon={<Check className="size-4" strokeWidth={2} />}
        onClose={onClose}
        width={460}
        labelledBy="cancelar-eventos-feito"
        footer={
          <button type="button" className="ctl-primary" onClick={onClose}>
            Fechar
          </button>
        }
      >
        <p className="p-5 text-body leading-relaxed text-ink-2">
          {feito.feitos === 1 ? "1 evento" : `${feito.feitos} eventos`} {acao === "apagar" ? (feito.feitos === 1 ? "apagado" : "apagados") : feito.feitos === 1 ? "desmarcado" : "desmarcados"}.
          {feito.ficamDeFora > 0 && ` ${feito.ficamDeFora} ficaram como estavam.`}
          {acao === "desmarcar" && " Ficam riscados no calendário, e cada um reactiva-se à mão se for preciso."}
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Cancelar eventos"
      subtitle="Escolhe o que apanhar, confere a lista e confirma."
      icon={<Ban className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={640}
      labelledBy="cancelar-eventos"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <span className="text-meta text-ink-3">
            {escolhidos.length === 0 ? "Nada escolhido" : `${escolhidos.length} ${escolhidos.length === 1 ? "evento escolhido" : "eventos escolhidos"}`}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" className="ctl-ghost" onClick={ensaio ? () => setEnsaio(null) : onClose} disabled={busy}>
              {ensaio ? "Voltar" : "Fechar"}
            </button>
            {!ensaio ? (
              <button type="button" className="ctl-primary" disabled={busy || escolhidos.length === 0} onClick={() => void pedir(true)}>
                {busy ? "A verificar…" : "Continuar"}
              </button>
            ) : (
              <button
                type="button"
                className={acao === "apagar" ? "ctl-risk" : "ctl-primary"}
                disabled={busy || ensaio.feitos === 0}
                onClick={() => void pedir(false)}
              >
                {acao === "apagar" && <Trash2 className="size-3.5" strokeWidth={1.9} />}
                {busy ? "A gravar…" : `${verbo} ${ensaio.feitos} ${ensaio.feitos === 1 ? "evento" : "eventos"}`}
              </button>
            )}
          </div>
        </div>
      }
    >
      {ensaio ? (
        /* ---------------------------------------------------------- a confirmação */
        <div className="space-y-4 p-5">
          <p className="text-body leading-relaxed text-ink-2">
            {ensaio.feitos === 0 ? (
              <>Nenhum destes eventos pode ser {acao === "apagar" ? "apagado" : "desmarcado"}.</>
            ) : (
              <>
                <strong className="font-medium text-ink">
                  {ensaio.feitos} {ensaio.feitos === 1 ? "evento vai ser" : "eventos vão ser"} {acao === "apagar" ? (ensaio.feitos === 1 ? "apagado" : "apagados") : ensaio.feitos === 1 ? "desmarcado" : "desmarcados"}.
                </strong>{" "}
                {acao === "apagar"
                  ? "Desaparecem do calendário e da app das famílias, sem volta."
                  : "Ficam riscados no calendário e na app das famílias. Ninguém recebe notificação."}
              </>
            )}
          </p>
          {ficam.length > 0 && (
            <div className="rounded-[var(--radius-control)] border border-line">
              <div className="flex items-center gap-2 border-b border-line bg-warn-soft/50 px-3 py-2 text-meta font-medium text-ink">
                <TriangleAlert className="size-3.5 text-warn" strokeWidth={1.9} />
                {ficam.length} {ficam.length === 1 ? "fica" : "ficam"} como {ficam.length === 1 ? "está" : "estão"}
              </div>
              <ul className="max-h-[260px] overflow-y-auto">
                {ficam.map((l) => {
                  const e = porId.get(l.id);
                  return (
                    <li key={l.id} className="border-b border-line px-3 py-2 last:border-0">
                      <div className="text-body text-ink-2">{e ? descrever(e) : "Evento"}</div>
                      <div className="text-meta text-ink-3">{l.motivo}</div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {erro && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{erro}</p>}
        </div>
      ) : (
        /* ---------------------------------------------------------- os filtros e a lista */
        <div className="space-y-4 p-5">
          <fieldset>
            <legend className="mb-1.5 text-meta font-medium text-ink">Equipas</legend>
            <div className="flex flex-wrap gap-1.5">
              <Chip
                on={equipas.every((t) => escolhidasEquipas.has(t.id))}
                onClick={mexe(() =>
                  setEscolhidasEquipas((s) =>
                    equipas.every((t) => s.has(t.id))
                      ? new Set([...s].filter((id) => id === ACADEMIA))
                      : new Set([...s, ...equipas.map((t) => t.id)]),
                  ),
                )}
              >
                Todas
              </Chip>
              {equipas.map((t) => (
                <Chip key={t.id} on={escolhidasEquipas.has(t.id)} onClick={mexe(() => setEscolhidasEquipas((s) => alternar(s, t.id)))}>
                  {t.name}
                </Chip>
              ))}
              {daAcademia && (
                <Chip on={escolhidasEquipas.has(ACADEMIA)} onClick={mexe(() => setEscolhidasEquipas((s) => alternar(s, ACADEMIA)))}>
                  Eventos da academia
                </Chip>
              )}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-meta font-medium text-ink">O quê</legend>
            <div className="flex flex-wrap gap-1.5">
              {TIPOS.map((k) => (
                <Chip key={k} on={tipos.has(k)} onClick={mexe(() => setTipos((s) => alternar(s, k)))}>
                  {TIPO_PLURAL[k]}
                </Chip>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <DialogField label="De">
              <input type="date" value={de} min={paraInput(hoje)} onChange={(e) => mexe(setDe)(e.target.value)} className={dialogInputClass} />
            </DialogField>
            <DialogField label="Até">
              <input type="date" value={ate} min={de} onChange={(e) => mexe(setAte)(e.target.value)} className={dialogInputClass} />
            </DialogField>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
            <fieldset>
              <legend className="mb-1.5 text-meta font-medium text-ink">Dias da semana</legend>
              <div className="flex flex-wrap gap-1.5">
                {DIAS.map((x) => (
                  <Chip key={x.d} on={dias.has(x.d)} onClick={mexe(() => setDias((s) => alternar(s, x.d)))}>
                    {x.l}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <DialogField label="Hora" hint="opcional">
              <input type="time" value={aHora} onChange={(e) => mexe(setAHora)(e.target.value)} className={dialogInputClass} />
            </DialogField>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-meta font-medium text-ink">O que fazer</legend>
            <Segmented<Acao>
              value={acao}
              onChange={mexe(setAcao)}
              label="O que fazer"
              options={[
                { value: "desmarcar", label: "Desmarcar" },
                { value: "apagar", label: "Apagar" },
              ]}
            />
            <p className="mt-1.5 text-meta leading-relaxed text-ink-3">
              {acao === "desmarcar"
                ? "Ficam riscados no calendário e na app, e reactivam-se um a um se for preciso."
                : "Desaparecem de vez. Só para enganos: o que já tem presenças, convocatória, plano ou avisos de falta fica de fora."}
            </p>
          </fieldset>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-meta font-medium text-ink">
                {apanhados.length === 0 ? "Nenhum evento apanhado" : `${apanhados.length} ${apanhados.length === 1 ? "evento apanhado" : "eventos apanhados"}`}
              </span>
              {tirados.size > 0 && (
                <button type="button" className="text-meta text-signal-ink hover:underline" onClick={mexe(() => setTirados(new Set()))}>
                  Voltar a escolher todos
                </button>
              )}
            </div>
            {apanhados.length === 0 ? (
              <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-3 text-meta text-ink-3">
                Só entram eventos que ainda não começaram. Ajusta as equipas, os tipos ou as datas.
              </p>
            ) : (
              <ul className="max-h-[280px] overflow-y-auto rounded-[var(--radius-control)] border border-line">
                {apanhados.map((e) => {
                  const on = !tirados.has(e.id);
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={mexe(() => setTirados((s) => alternar(s, e.id)))}
                        className="flex w-full items-center gap-2.5 border-b border-line px-3 py-2 text-left transition-colors duration-[120ms] last:border-b-0 hover:bg-sunken"
                      >
                        <span
                          className={cx(
                            "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                            on ? "border-signal-strong bg-signal-strong text-signal-on" : "border-line-strong",
                          )}
                        >
                          {on && <Check className="size-3" strokeWidth={3} />}
                        </span>
                        <span className={cx("min-w-0 flex-1 truncate text-body", on ? "text-ink" : "text-ink-4 line-through")}>{descrever(e)}</span>
                        {e.cancelled && <span className="shrink-0 text-meta text-ink-4">desmarcado</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {erro && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{erro}</p>}
        </div>
      )}
    </Dialog>
  );
}

function descrever(e: CalendarEvent): string {
  const tipo = e.kind === "match" ? e.title : (e.typeLabel ?? KIND_LABEL[e.kind]);
  return [`${diaCurto(e.start)} · ${hora(e.start)}`, e.teamName, tipo].filter(Boolean).join(" · ");
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "h-8 rounded-full border px-3 text-meta font-medium transition-colors duration-[120ms]",
        on ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink-2 hover:bg-sunken",
      )}
    >
      {children}
    </button>
  );
}
