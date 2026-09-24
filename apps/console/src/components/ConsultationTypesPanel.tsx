import { useEffect, useRef, useState, type FormEvent } from "react";
import { addItem, renameItem, setItemColor, toggleArchived, useCatalog } from "@/lib/catalogs";
import { kindOfConsultationType } from "@/lib/clinical";
import { Plus, X, Check } from "@/lib/icons";
import { corDaArea } from "./ConsultasMes";
import { Panel, PanelHead, Pill } from "./primitives";

/**
 * Os tipos de consulta do clube, nas Definições.
 *
 * Um painel próprio e sempre aberto, e não o acordeão dos catálogos: estes tipos
 * não são de uma modalidade, e a ordem deles decide uma coisa que se tem de ver
 * (o primeiro é o que vem escolhido ao agendar). Numa linha fechada ninguém
 * percebia nem uma coisa nem outra.
 *
 * Cada tipo leva a cor com que aparece no calendário das Consultas, e tocar
 * na cor abre o seletor.
 */
export function ConsultationTypesPanel({ mayWrite, focus }: { mayWrite: boolean; focus?: boolean }) {
  const items = useCatalog("consultationTypes");
  const active = items.filter((i) => !i.archived);
  const archived = items.filter((i) => i.archived);
  const [showArchived, setShowArchived] = useState(false);
  const [novo, setNovo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Quem chega de um "gerir" no diálogo de agendar veio por causa disto.
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);

  async function acrescentar(e: FormEvent) {
    e.preventDefault();
    if (!novo.trim()) return;
    setErro(null);
    try {
      await addItem("consultationTypes", novo);
      setNovo("");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível acrescentar.");
    }
  }

  return (
    <div ref={ref}>
      <Panel>
        <PanelHead title="Tipos de consulta" hint={`${active.length} activos`} />
        <p className="border-b border-line px-5 py-3 text-meta leading-relaxed text-ink-3">
          O que o departamento clínico pode agendar em Consultas. O primeiro da lista vem escolhido
          quando se agenda.
        </p>

        {active.length === 0 ? (
          <p className="px-5 py-4 text-meta text-ink-3">
            Sem tipos activos. Enquanto não houver pelo menos um, não se agendam consultas.
          </p>
        ) : (
          <ul>
            {active.map((item, i) => (
              <Linha
                key={item.id}
                id={item.id}
                label={item.label}
                color={item.color}
                primeiro={i === 0}
                mayWrite={mayWrite}
              />
            ))}
          </ul>
        )}

        {mayWrite && (
          <form onSubmit={acrescentar} className="flex items-center gap-2 border-t border-line px-5 py-3">
            <input
              value={novo}
              onChange={(e) => setNovo(e.target.value)}
              placeholder="Novo tipo: Psicologia, Podologia…"
              aria-label="Novo tipo de consulta"
              className="h-8 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body text-ink placeholder:text-ink-4 focus:border-line-strong focus:outline-none"
            />
            <button type="submit" className="ctl-outline" disabled={!novo.trim()}>
              <Plus className="size-3.5" strokeWidth={2} />
              Acrescentar
            </button>
          </form>
        )}
        {erro && <p className="px-5 pb-3 text-meta text-risk">{erro}</p>}

        {archived.length > 0 && (
          <div className="border-t border-line px-5 py-3">
            <button type="button" onClick={() => setShowArchived((v) => !v)} className="text-meta font-medium text-ink-3 hover:text-ink">
              {showArchived ? "Ocultar" : "Mostrar"} {archived.length} arquivado{archived.length > 1 ? "s" : ""}
            </button>
            {showArchived && (
              <ul className="mt-2 space-y-1">
                {archived.map((item) => (
                  <li key={item.id} className="flex items-center gap-2.5 py-1">
                    <span className="min-w-0 flex-1 truncate text-body text-ink-4 line-through">{item.label}</span>
                    {mayWrite && (
                      <button type="button" onClick={() => void toggleArchived("consultationTypes", item.id)} className="ctl-ghost h-7 text-meta">
                        Restaurar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Linha({
  id,
  label,
  color,
  primeiro,
  mayWrite,
}: {
  id: string;
  label: string;
  color?: string;
  primeiro: boolean;
  mayWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [nome, setNome] = useState(label);
  const [erro, setErro] = useState<string | null>(null);
  const kind = kindOfConsultationType(label);
  const actual = color ?? corDaArea(kind).base;
  /*
   * A cor enquanto se escolhe. O seletor dispara a cada movimento do rato; o
   * servidor só recebe a última, meio segundo depois de parar.
   */
  const [cor, setCor] = useState(actual);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => setCor(actual), [actual]);
  useEffect(() => {
    if (cor.toLowerCase() === actual.toLowerCase()) return;
    const t = setTimeout(() => {
      setErro(null);
      setItemColor(id, cor).catch((e) => {
        setErro(e instanceof Error ? e.message : "Não foi possível gravar a cor.");
        setCor(actual);
      });
    }, 500);
    return () => clearTimeout(t);
  }, [cor, actual, id]);

  const bolinha = (
    <span className="relative shrink-0">
      <button
        type="button"
        disabled={!mayWrite}
        onClick={() => picker.current?.click()}
        className="flex size-6 items-center justify-center rounded-full enabled:hover:bg-sunken"
        aria-label={`Mudar a cor de ${label}`}
        title={mayWrite ? "Mudar a cor" : undefined}
      >
        <span className="size-3.5 rounded-full ring-1 ring-black/10" style={{ background: cor }} aria-hidden />
      </button>
      {mayWrite && (
        <input
          ref={picker}
          type="color"
          value={cor}
          onChange={(e) => setCor(e.target.value)}
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute top-full left-0 size-0 opacity-0"
        />
      )}
    </span>
  );

  if (editing) {
    return (
      <li className="flex items-center gap-2 border-b border-line bg-sunken/40 px-5 py-2 last:border-0">
        {bolinha}
        <input
          autoFocus
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          aria-label="Nome do tipo"
          className="h-8 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body text-ink focus:border-line-strong focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            if (nome.trim()) void renameItem("consultationTypes", id, nome);
            setEditing(false);
          }}
          className="flex size-8 shrink-0 items-center justify-center rounded-[6px] text-ok hover:bg-ok-soft"
          aria-label="Guardar"
        >
          <Check className="size-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => {
            setNome(label);
            setEditing(false);
          }}
          className="flex size-8 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-sunken"
          aria-label="Cancelar"
        >
          <X className="size-4" strokeWidth={1.75} />
        </button>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 border-b border-line px-5 py-2.5 last:border-0">
      {bolinha}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-ink">{label}</span>
        {erro && <span className="block text-meta text-risk">{erro}</span>}
      </span>

      {primeiro && <Pill tone="signal">Vem escolhido</Pill>}

      {mayWrite && (
        <span className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={() => setEditing(true)} className="ctl-ghost h-7 text-meta">
            Editar
          </button>
          <button
            type="button"
            onClick={() => void toggleArchived("consultationTypes", id)}
            className="ctl-ghost h-7 text-meta text-ink-3 hover:text-ink"
          >
            Arquivar
          </button>
        </span>
      )}
    </li>
  );
}
