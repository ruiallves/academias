import { useState } from "react";
import { Dialog, dialogInputClass } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { Download } from "@/lib/icons";
import { listSessions } from "@/lib/api";
import { ensureCalendarRange, matches } from "@/lib/store";
import { getPlan, listPlans, type PlanBlock, type PlanSummary } from "@/lib/training";
import { keyToDate, mesoOf, microLabel, rangeLabel, type Cycle } from "@/lib/cycles";
import { exportarPeriodizacao, type Nivel } from "@/lib/periodization-pdf";
import type { Session } from "@/lib/permissions";
import type { Team } from "@/data/types";

type Tipo = "EPOCA" | "FASE" | "MICRO";

/**
 * Exportar a periodização em PDF: o macrociclo, um mesociclo ou um microciclo.
 *
 * O mesociclo e o microciclo propostos são os que estão abertos no ecrã, que é quase
 * sempre a que se quer imprimir. O que vai para o papel é lido na altura: os
 * treinos do intervalo, os planos deles e, para a semana, os blocos de cada
 * treino. Ver `lib/periodization-pdf.ts`.
 */
export function ExportDialog({
  session,
  team,
  epoca,
  cycles,
  microAberto,
  onClose,
}: {
  session: Session;
  team: Team;
  epoca: { from: string; to: string };
  cycles: Cycle[];
  microAberto: Cycle | null;
  onClose: () => void;
}) {
  const mesos = cycles.filter((c) => c.level === "MESO").sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const micros = cycles.filter((c) => c.level === "MICRO").sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const faseAberta = microAberto ? mesoOf(cycles, microAberto) : undefined;

  const [tipo, setTipo] = useState<Tipo>(microAberto ? "MICRO" : "EPOCA");
  const [mesoId, setMesoId] = useState(faseAberta?.id ?? mesos[0]?.id ?? "");
  const [microId, setMicroId] = useState(microAberto?.id ?? micros[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function exportar() {
    setBusy(true);
    setErro(null);
    try {
      let nivel: Nivel;
      let from = epoca.from;
      let to = epoca.to;
      if (tipo === "FASE") {
        const meso = mesos.find((m) => m.id === mesoId);
        if (!meso) throw new Error("Escolhe um mesociclo.");
        // As semanas do mesociclo podem começar antes dele (a da quinta-feira).
        const dela = micros.filter((m) => mesoOf(cycles, m)?.id === meso.id);
        from = [meso.startsOn, ...dela.map((m) => m.startsOn)].sort()[0];
        to = [meso.endsOn, ...dela.map((m) => m.endsOn)].sort().reverse()[0];
        nivel = { tipo: "FASE", meso };
      } else if (tipo === "MICRO") {
        const micro = micros.find((m) => m.id === microId);
        if (!micro) throw new Error("Escolhe um microciclo.");
        from = micro.startsOn;
        to = micro.endsOn;
        nivel = { tipo: "MICRO", micro };
      } else {
        nivel = { tipo: "EPOCA" };
      }

      // A época inteira tem de estar carregada: a barra desenha os jogos todos.
      const de = keyToDate(epoca.from < from ? epoca.from : from);
      const ate = new Date(keyToDate(epoca.to > to ? epoca.to : to).getTime() + 86_400_000 - 1);
      await ensureCalendarRange(de, ate);

      const fimDoIntervalo = new Date(keyToDate(to).getTime() + 86_400_000 - 1);
      const treinos = listSessions(session, keyToDate(from), fimDoIntervalo)
        .filter((s) => s.teamId === team.id && s.status !== "cancelled")
        .map((s) => ({ id: s.id, start: s.start, end: s.end, venue: s.venue }));
      const jogos = matches
        .filter((m) => m.teamId === team.id && m.status !== "CANCELLED")
        .map((m) => ({ id: m.id, startsAt: m.startsAt, opponent: m.opponent, isHome: m.isHome }));
      const planos = new Map<string, PlanSummary>(
        ((await listPlans(keyToDate(from).toISOString(), fimDoIntervalo.toISOString())) ?? []).map((p) => [p.sessionId, p]),
      );

      /*
       * Os blocos de cada treino, um pedido por treino.
       *
       * Na semana e no mesociclo: as duas folhas mostram o que se vai treinar
       * em cada dia, e isso não vem no resumo do plano. Na época não, que são
       * dezenas de treinos e a folha é uma tabela de semanas.
       */
      let blocos: Map<string, PlanBlock[]> | undefined;
      if (tipo === "MICRO" || tipo === "FASE") {
        blocos = new Map();
        for (const t of treinos) {
          if (!planos.has(t.id)) continue;
          try {
            blocos.set(t.id, (await getPlan(t.id)).blocks);
          } catch {
            /* sem os blocos, o treino sai com o resumo do plano */
          }
        }
      }

      await exportarPeriodizacao(
        { teamName: team.name, season: team.season, epoca, cycles, treinos, jogos, planos, blocos },
        nivel,
      );
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível exportar.");
      setBusy(false);
    }
  }

  const opcoes: { v: Tipo; t: string; d: string; off?: boolean }[] = [
    { v: "EPOCA", t: "O macrociclo (a época)", d: "A barra da época, os mesociclos e todos os microciclos numa tabela." },
    { v: "FASE", t: "Um mesociclo", d: "O objetivo, os números do mesociclo, cada microciclo e cada treino com data, objetivo, blocos e carga.", off: mesos.length === 0 },
    { v: "MICRO", t: "Um microciclo", d: "Os sete dias lado a lado, com os treinos e os blocos de cada um.", off: micros.length === 0 },
  ];

  return (
    <Dialog
      title="Exportar a periodização"
      subtitle={`${team.name} · Época ${team.season}`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="button" onClick={() => void exportar()} disabled={busy} className="ctl-primary">
            <Download className="size-3.5" strokeWidth={1.75} />
            Exportar PDF
          </button>
        </>
      }
    >
      <div className="space-y-2 px-5 py-4" role="radiogroup" aria-label="O que exportar">
        {opcoes.map((o) => (
          <div
            key={o.v}
            className={cx(
              "rounded-[var(--radius-control)] border transition-colors",
              tipo === o.v ? "border-ink bg-sunken/60" : "border-line",
              o.off && "opacity-50",
            )}
          >
            <button
              type="button"
              role="radio"
              aria-checked={tipo === o.v}
              disabled={o.off}
              onClick={() => setTipo(o.v)}
              className="flex w-full items-start gap-3 px-3.5 py-3 text-left disabled:cursor-not-allowed"
            >
              <span className={cx("mt-0.5 size-4 shrink-0 rounded-full border", tipo === o.v ? "border-[5px] border-ink" : "border-line-strong")} />
              <span>
                <span className="block text-body font-medium text-ink">{o.t}</span>
                <span className="block text-meta text-ink-3">{o.off ? (o.v === "FASE" ? "Ainda não há mesociclos." : "Ainda não há microciclos.") : o.d}</span>
              </span>
            </button>
            {tipo === "FASE" && o.v === "FASE" && (
              <div className="px-3.5 pb-3 pl-10">
                <select className={dialogInputClass} value={mesoId} onChange={(e) => setMesoId(e.target.value)} aria-label="Mesociclo">
                  {mesos.map((m) => (
                    <option key={m.id} value={m.id}>
                      {(m.name ?? m.phase ?? "Fase") + " · " + rangeLabel(m.startsOn, m.endsOn)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {tipo === "MICRO" && o.v === "MICRO" && (
              <div className="px-3.5 pb-3 pl-10">
                <select className={dialogInputClass} value={microId} onChange={(e) => setMicroId(e.target.value)} aria-label="Microciclo">
                  {micros.map((m) => (
                    <option key={m.id} value={m.id}>
                      {`${microLabel(cycles, m)} · ${rangeLabel(m.startsOn, m.endsOn)}${mesoOf(cycles, m)?.name ? ` · ${mesoOf(cycles, m)!.name}` : ""}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ))}

        {erro && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{erro}</p>}
      </div>
    </Dialog>
  );
}
