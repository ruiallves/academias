import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  addItem,
  CATALOG_META,
  moveItem,
  renameItem,
  toggleArchived,
  useCatalog,
  type CatalogKey,
} from "@/lib/catalogs";
import { Check, ChevronDown, Plus, X } from "@/lib/icons";
import { cx, Pill } from "./primitives";

/**
 * Um catálogo, editável.
 *
 * O mesmo componente serve Locais, Escalões, Cargos e Tipos de evento — só muda a
 * chave. É a prova de que estas quatro coisas são a mesma ideia (uma lista da
 * academia que aparece em menus suspensos), não quatro ecrãs a manter em paralelo.
 *
 * Itens de sistema (os quatro tipos de evento base) não têm botão de apagar nem
 * de renomear: o domínio depende deles a existir com aquele nome.
 */
export function CatalogPanel({ catalogKey, defaultOpen }: { catalogKey: CatalogKey; defaultOpen?: boolean }) {
  const meta = CATALOG_META[catalogKey];
  const items = useCatalog(catalogKey);
  const active = items.filter((i) => !i.archived);
  const archived = items.filter((i) => i.archived);

  const [open, setOpen] = useState(!!defaultOpen);
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Chegar aqui de um deep-link ("gerir locais") só vale a pena se o painel
  // certo ficar visível sem o utilizador ter de procurar entre os quatro.
  useEffect(() => {
    if (defaultOpen) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [defaultOpen]);

  return (
    <div ref={ref} className="border-b border-line last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left"
        aria-expanded={open}
      >
        <ChevronDown
          className={cx("size-4 shrink-0 text-ink-3 transition-transform duration-[120ms]", !open && "-rotate-90")}
          strokeWidth={1.75}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-body font-medium text-ink">{meta.title}</span>
          <span className="block text-meta text-ink-3">{meta.hint}</span>
        </span>
        <span className="shrink-0 text-meta text-ink-3 tabular">{active.length}</span>
      </button>

      {open && (
        <div className="px-5 pb-4">
          <ul className="mb-2 space-y-1">
            {active.map((item, i) => (
              <CatalogRow
                key={item.id}
                catalogKey={catalogKey}
                item={item}
                position={i}
                count={active.length}
                noteLabel={meta.noteLabel}
              />
            ))}
          </ul>

          {adding ? (
            <AddForm catalogKey={catalogKey} onDone={() => setAdding(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="ctl-ghost h-8 w-full justify-start gap-1.5 border border-dashed border-line text-ink-3 hover:border-line-strong hover:text-ink"
            >
              <Plus className="size-3.5" strokeWidth={2} />
              Adicionar a {meta.title.toLowerCase()}
            </button>
          )}

          {archived.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="text-meta font-medium text-ink-3 hover:text-ink"
              >
                {showArchived ? "Ocultar" : "Mostrar"} {archived.length} arquivado{archived.length > 1 ? "s" : ""}
              </button>

              {showArchived && (
                <ul className="mt-2 space-y-1">
                  {archived.map((item) => (
                    <li key={item.id} className="flex items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-body text-ink-4 line-through">{item.label}</span>
                      <button
                        type="button"
                        onClick={() => toggleArchived(catalogKey, item.id)}
                        className="ctl-ghost h-7 shrink-0 text-meta"
                      >
                        Restaurar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function CatalogRow({
  catalogKey,
  item,
  position,
  count,
  noteLabel,
}: {
  catalogKey: CatalogKey;
  item: ReturnType<typeof useCatalog>[number];
  position: number;
  count: number;
  noteLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(item.label);
  const [note, setNote] = useState(item.note ?? "");

  if (editing) {
    return (
      <li className="flex items-center gap-1.5 rounded-[var(--radius-control)] bg-sunken/60 p-1.5">
        <div className="flex min-w-0 flex-1 gap-1.5">
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="h-7 min-w-0 flex-1 rounded-[6px] border border-line bg-surface px-2 text-meta text-ink focus:border-line-strong focus:outline-none"
          />
          {noteLabel !== undefined && (
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={noteLabel}
              className="h-7 min-w-0 flex-1 rounded-[6px] border border-line bg-surface px-2 text-meta text-ink-2 placeholder:text-ink-4 focus:border-line-strong focus:outline-none"
            />
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            renameItem(catalogKey, item.id, label, note);
            setEditing(false);
          }}
          className="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-ok hover:bg-ok-soft"
          aria-label="Guardar"
        >
          <Check className="size-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-sunken"
          aria-label="Cancelar"
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 py-1 hover:bg-sunken/60">
      {/* A ordem é dados — Sub-9 antes de Sub-11 não é ordenação alfabética. */}
      <div className="flex shrink-0 flex-col opacity-0 group-hover:opacity-100">
        <button
          type="button"
          disabled={position === 0}
          onClick={() => moveItem(catalogKey, item.id, -1)}
          className="flex h-3 w-4 items-center justify-center text-ink-3 hover:text-ink disabled:opacity-0"
          aria-label="Mover para cima"
        >
          <ChevronDown className="size-3 rotate-180" strokeWidth={2} />
        </button>
        <button
          type="button"
          disabled={position === count - 1}
          onClick={() => moveItem(catalogKey, item.id, 1)}
          className="flex h-3 w-4 items-center justify-center text-ink-3 hover:text-ink disabled:opacity-0"
          aria-label="Mover para baixo"
        >
          <ChevronDown className="size-3" strokeWidth={2} />
        </button>
      </div>

      <span className="min-w-0 flex-1 truncate text-body text-ink">
        {item.label}
        {item.note && <span className="ml-2 text-meta text-ink-3">{item.note}</span>}
      </span>

      {item.system ? (
        <Pill>base</Pill>
      ) : (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ctl-ghost h-7 text-meta"
          >
            Editar
          </button>
          <button
            type="button"
            onClick={() => toggleArchived(catalogKey, item.id)}
            className="ctl-ghost h-7 text-meta text-ink-3 hover:text-ink"
          >
            Arquivar
          </button>
        </span>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------- */

function AddForm({ catalogKey, onDone }: { catalogKey: CatalogKey; onDone: () => void }) {
  const meta = CATALOG_META[catalogKey];
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    addItem(catalogKey, label, note);
    onDone();
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-1.5 rounded-[var(--radius-control)] bg-sunken/60 p-1.5">
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={meta.placeholder}
        className="h-7 min-w-0 flex-1 rounded-[6px] border border-line bg-surface px-2 text-meta text-ink placeholder:text-ink-4 focus:border-line-strong focus:outline-none"
      />
      {meta.noteLabel && (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={meta.noteLabel}
          className="h-7 min-w-0 flex-1 rounded-[6px] border border-line bg-surface px-2 text-meta text-ink-2 placeholder:text-ink-4 focus:border-line-strong focus:outline-none"
        />
      )}
      <button type="submit" className="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-ok hover:bg-ok-soft" aria-label="Adicionar">
        <Check className="size-3.5" strokeWidth={2} />
      </button>
      <button type="button" onClick={onDone} className="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-sunken" aria-label="Cancelar">
        <X className="size-3.5" strokeWidth={1.75} />
      </button>
    </form>
  );
}
