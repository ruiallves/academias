import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { cx } from "./primitives";
import { ArrowUpRight, Download } from "@/lib/icons";
import { useStore } from "@/lib/store";
import { useActiveCatalog } from "@/lib/catalogs";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { exportarCalendario } from "@/lib/calendar-import";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Exportar o calendário — com uma pergunta antes, e não um download às cegas.
 *
 * O calendário de um clube é grande, e quem carrega em "Exportar" quer quase
 * sempre uma parte dele: os treinos do Sub-13 e do Sub-15, os jogos de todo o
 * futebol, os torneios da época. Por isso escolhem-se **várias** equipas e
 * **vários** tipos de evento, e não "uma equipa ou todas" — que era a escolha
 * que obrigava a exportar tudo e apagar metade na folha.
 *
 * Tudo vem escolhido por omissão: abrir e descarregar dá a época inteira, e
 * restringir é tirar o que não se quer.
 *
 * ## A periodização não é daqui
 *
 * Os ciclos — macro, meso e micro — são do Planeamento, de uma equipa de cada
 * vez, e têm lá a sua exportação. A nota no fim diz isso e leva lá.
 */
export function ExportCalendarDialog({ onClose }: { onClose: () => void }) {
  const { teams, season, seasonRanges } = useStore();
  const { session } = useSession();
  const navigate = useNavigate();
  const tiposDoClube = useActiveCatalog("eventTypes");

  /* A época atual, quando se sabe; senão, daqui a um ano. */
  const epoca = seasonRanges[season];
  const hoje = new Date();
  const [de, setDe] = useState(epoca?.startsOn ?? iso(hoje));
  const [ate, setAte] = useState(
    epoca?.endsOn ?? iso(new Date(hoje.getFullYear() + 1, hoje.getMonth(), hoje.getDate())),
  );

  const equipasOrdenadas = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name, "pt")), [teams]);
  const [equipas, setEquipas] = useState<Set<string>>(() => new Set(teams.map((t) => t.id)));
  const [daAcademia, setDaAcademia] = useState(true);
  const [tipos, setTipos] = useState<Set<string>>(() => new Set(tiposDoClube.map((t) => t.label)));
  const [cancelados, setCancelados] = useState(false);

  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<number | null>(null);

  const todasAsEquipas = equipas.size === teams.length;
  const todosOsTipos = tipos.size === tiposDoClube.length;
  const periodoOk = de !== "" && ate !== "" && de <= ate;
  const temEquipa = equipas.size > 0 || daAcademia;
  const valido = periodoOk && temEquipa && tipos.size > 0;
  const podeVerPlaneamento = can(session, "training:read");

  const alternar = (atual: Set<string>, v: string) => {
    const novo = new Set(atual);
    if (novo.has(v)) novo.delete(v);
    else novo.add(v);
    return novo;
  };

  async function descarregar() {
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      const r = await exportarCalendario({
        from: de,
        to: ate,
        /* Todas escolhidas é "sem filtro", e aí os eventos da academia vêm sempre. */
        ...(todasAsEquipas ? {} : { teamIds: [...equipas], incluirDaAcademia: daAcademia }),
        ...(todosOsTipos ? {} : { tipos: [...tipos] }),
        incluirCancelados: cancelados,
      });
      setFeito(r.total);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível exportar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="exportar-calendario"
      title="Exportar calendário"
      subtitle="Para Excel"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            {feito === null ? "Cancelar" : "Fechar"}
          </button>
          <button type="button" onClick={() => void descarregar()} className="ctl-primary" disabled={!valido || busy}>
            <Download className="size-3.5" strokeWidth={2} />
            {busy ? "A preparar…" : "Descarregar Excel"}
          </button>
        </>
      }
    >
      <div className="space-y-4 p-5">
        <p className="text-meta leading-relaxed text-ink-3">
          Uma folha para os treinos, outra para os jogos e outra para o resto, com as mesmas colunas da importação:
          podes corrigir o ficheiro e voltar a importá-lo.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <DialogField label="De">
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={dialogInputClass} />
          </DialogField>
          <DialogField label="Até">
            <input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} className={dialogInputClass} />
          </DialogField>
        </div>
        {!periodoOk && de && ate && <p className="-mt-2 text-[11px] text-risk">O fim tem de ser depois do início.</p>}

        {/* --- Os tipos de evento ------------------------------------------ */}
        <Escolha
          titulo="Eventos"
          resumo={todosOsTipos ? "todos" : `${tipos.size} de ${tiposDoClube.length}`}
          onTodos={() => setTipos(new Set(tiposDoClube.map((t) => t.label)))}
          onNenhum={() => setTipos(new Set())}
        >
          {tiposDoClube.map((t) => (
            <Opcao key={t.id} label={t.label} checked={tipos.has(t.label)} onChange={() => setTipos(alternar(tipos, t.label))} />
          ))}
        </Escolha>
        {tipos.size === 0 && <p className="-mt-2 text-[11px] text-risk">Escolhe pelo menos um tipo de evento.</p>}

        {/* --- As equipas ---------------------------------------------------- */}
        <Escolha
          titulo="Equipas"
          resumo={todasAsEquipas ? "todas" : `${equipas.size} de ${teams.length}`}
          onTodos={() => setEquipas(new Set(teams.map((t) => t.id)))}
          onNenhum={() => setEquipas(new Set())}
        >
          {equipasOrdenadas.map((t) => (
            <Opcao key={t.id} label={t.name} checked={equipas.has(t.id)} onChange={() => setEquipas(alternar(equipas, t.id))} />
          ))}
        </Escolha>
        {!todasAsEquipas && (
          <label className="-mt-1 flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={daAcademia}
              onChange={(e) => setDaAcademia(e.target.checked)}
              className="size-3.5 accent-[var(--color-signal)]"
            />
            <span className="text-body text-ink">Eventos de toda a academia</span>
            <span className="text-meta text-ink-3">os que não são de nenhuma equipa</span>
          </label>
        )}
        {!temEquipa && <p className="-mt-2 text-[11px] text-risk">Escolhe pelo menos uma equipa.</p>}

        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={cancelados}
            onChange={(e) => setCancelados(e.target.checked)}
            className="size-3.5 accent-[var(--color-signal)]"
          />
          <span className="text-body text-ink">Incluir os cancelados</span>
          <span className="text-meta text-ink-3">com uma coluna Estado</span>
        </label>

        {/* A nota da periodização, com um botão pequeno fora do texto. */}
        <div className="rounded-[var(--radius-control)] border border-line bg-sunken/40 p-3">
          <p className="text-meta leading-relaxed text-ink-3">
            Queres os <strong className="font-medium text-ink-2">macrociclos, mesociclos e microciclos</strong>? Esses
            exportam-se no Planeamento: escolhe lá a equipa e usa o botão de exportar.
          </p>
          {podeVerPlaneamento && (
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate("/treinos");
              }}
              className="ctl-ghost mt-1.5 h-7 px-2 text-meta"
            >
              Ir para o Planeamento
              <ArrowUpRight className="size-3" strokeWidth={2} />
            </button>
          )}
        </div>

        {feito !== null && (
          <p className="rounded-[var(--radius-control)] bg-ok-soft px-3.5 py-2.5 text-meta text-ok">
            {feito === 0
              ? "Não há eventos com estas escolhas. O ficheiro saiu só com os cabeçalhos."
              : `Ficheiro descarregado com ${feito} ${feito === 1 ? "evento" : "eventos"}.`}
          </p>
        )}
        {erro && (
          <p className="rounded-[var(--radius-control)] bg-risk-soft px-3.5 py-2.5 text-meta text-risk">{erro}</p>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Uma lista de escolha múltipla, com "Todas" e "Nenhuma" à mão.
 *
 * Os dois atalhos ficam fora dos rótulos das caixas (um botão dentro de um
 * `<label>` não recebe o toque no telemóvel — ver `check:toque`).
 */
function Escolha({
  titulo,
  resumo,
  onTodos,
  onNenhum,
  children,
}: {
  titulo: string;
  resumo: string;
  onTodos: () => void;
  onNenhum: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-meta font-medium text-ink">
          {titulo} <span className="font-normal text-ink-4">· {resumo}</span>
        </span>
        <span className="flex gap-2 text-[11px]">
          <button type="button" onClick={onTodos} className="text-ink-3 hover:text-ink">
            Todos
          </button>
          <button type="button" onClick={onNenhum} className="text-ink-3 hover:text-ink">
            Nenhum
          </button>
        </span>
      </div>
      <div className="grid max-h-40 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto rounded-[var(--radius-control)] border border-line p-2.5">
        {children}
      </div>
    </div>
  );
}

function Opcao({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex min-w-0 cursor-pointer items-center gap-2 py-0.5">
      <input type="checkbox" checked={checked} onChange={onChange} className="size-3.5 shrink-0 accent-[var(--color-signal)]" />
      <span className={cx("truncate text-body", checked ? "text-ink" : "text-ink-3")}>{label}</span>
    </label>
  );
}
