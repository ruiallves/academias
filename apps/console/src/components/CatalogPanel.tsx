import { useEffect, useRef, useState, type FormEvent } from "react";
// O menu do "Oficial / Não oficial" abre num portal, para a caixa da modalidade não o cortar.
import { createPortal } from "react-dom";
import {
  addItem,
  CATALOG_META,
  moveItem,
  renameItem,
  setItemOfficial,
  toggleArchived,
  useCatalog,
  type CatalogKey,
} from "@/lib/catalogs";
import { Check, ChevronDown, Plus, X } from "@/lib/icons";
import { cx, Pill } from "./primitives";
import { useStore } from "@/lib/store";

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
export function CatalogPanel({
  catalogKey,
  defaultOpen,
  /**
   * A modalidade a que este painel pertence.
   *
   * Quando vem preenchida, o painel deixa de ser "todos os locais do clube" e
   * passa a ser "os locais desta modalidade" — mostra os dela e os que servem
   * todas, e o que se cria aqui já nasce dela. É o que tira o menu *Catálogos*
   * do caminho: os escalões do futebol vivem dentro do futebol, que é onde
   * alguém os vai procurar.
   */
  sportId,
  /** Sem a moldura própria: o painel já está dentro de outro. */
  bare,
}: {
  catalogKey: CatalogKey;
  defaultOpen?: boolean;
  sportId?: string;
  bare?: boolean;
}) {
  const meta = CATALOG_META[catalogKey];
  const items = useCatalog(catalogKey);
  /*
   * Os globais entram sempre.
   *
   * Um item sem modalidade (`sportId: null`) serve o clube todo — o pavilhão é o
   * pavilhão, treine lá o futsal ou o andebol. Escondê-lo dentro de uma
   * modalidade fazia parecer que faltava, e levava alguém a criá-lo outra vez.
   */
  const doDesporto = sportId ? items.filter((i) => i.sportId === null || i.sportId === sportId) : items;
  const active = doDesporto.filter((i) => !i.archived);
  const archived = doDesporto.filter((i) => i.archived);

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
    <div ref={ref} className={cx(bare ? "border-b border-line last:border-0" : "border-b border-line last:border-0")}>
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
            <AddForm catalogKey={catalogKey} sportId={sportId} onDone={() => setAdding(false)} />
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

          {catalogKey === "competitions" && (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-4">
              As competições não oficiais permitem convocar atletas de qualquer escalão.
            </p>
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

      {/*
        Oficial ou não, só nas competições, sempre no fim da linha para ficar
        alinhado em todas (os botões de editar ocupam espaço mesmo escondidos).
        O "Amigável" é sempre não oficial e não se muda.
      */}
      {catalogKey === "competitions" && (
        <span className="flex w-[104px] shrink-0 justify-end">
          {item.system ? (
            <Pill>Não oficial</Pill>
          ) : (
            <OficialControl id={item.id} label={item.label} oficial={item.official !== false} />
          )}
        </span>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------- */

/** Altura aproximada do menu: duas opções fixas. */
const OFICIAL_MENU_HEIGHT = 92;

/**
 * Oficial ou não oficial, com o mesmo desenho do estado das mensalidades
 * (`FeeStatusControl`): a pastilha diz o estado e é o gatilho; um clique abre
 * as duas opções, com um visto na actual. O menu vive num portal para não ser
 * recortado pela caixa da modalidade.
 */
function OficialControl({ id, label, oficial }: { id: string; label: string; oficial: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const left = Math.max(8, r.right - 168);
      const espacoEmBaixo = window.innerHeight - r.bottom;
      setPos(
        espacoEmBaixo >= OFICIAL_MENU_HEIGHT + 8 || r.top < OFICIAL_MENU_HEIGHT + 8
          ? { top: r.bottom + 4, left }
          : { bottom: window.innerHeight - r.top + 4, left },
      );
    }
    setOpen((v) => !v);
  };

  async function escolher(valor: boolean) {
    setOpen(false);
    if (valor === oficial || busy) return;
    setBusy(true);
    try {
      await setItemOfficial(id, valor);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${oficial ? "oficial" : "não oficial"}. Alterar`}
        className={cx(
          "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-tight font-semibold transition-opacity duration-[120ms] hover:opacity-75 disabled:opacity-50",
          oficial ? "bg-signal-soft text-signal-ink" : "bg-sunken text-ink-2",
        )}
      >
        {oficial ? "Oficial" : "Não oficial"}
        <ChevronDown className="size-3" strokeWidth={2.5} />
      </button>

      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
            <div
              role="menu"
              style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}
              className="fixed z-50 w-[168px] rounded-[var(--radius-panel)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
            >
              {[
                { valor: true, texto: "Oficial" },
                { valor: false, texto: "Não oficial" },
              ].map((o) => (
                <button
                  key={o.texto}
                  type="button"
                  role="menuitem"
                  onClick={() => void escolher(o.valor)}
                  className={cx(
                    "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-body transition-colors duration-[120ms] hover:bg-sunken",
                    o.valor === oficial ? "text-ink" : "text-ink-2",
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center text-signal-ink">
                    {o.valor === oficial && <Check className="size-3.5" strokeWidth={2.5} />}
                  </span>
                  <span className="flex-1">{o.texto}</span>
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function AddForm({
  catalogKey,
  /** Herdada do painel: dentro de uma modalidade, não se volta a perguntar. */
  sportId: fixo,
  onDone,
}: {
  catalogKey: CatalogKey;
  sportId?: string;
  onDone: () => void;
}) {
  const meta = CATALOG_META[catalogKey];
  const { academy } = useStore();
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [sportId, setSportId] = useState("");

  /*
   * O selector de modalidade só aparece quando há mais do que uma.
   *
   * Um clube só de futebol nunca precisa de escolher — tudo o que cria serve o
   * futebol, e uma caixa com uma opção só é ruído. Com duas modalidades a
   * pergunta passa a ser real: o "Sub-13" do futebol não é o da natação, e a
   * piscina não é um campo.
   */
  const escolheDesporto = !fixo && academy.sports.length > 1;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    void addItem(catalogKey, label, note, fixo ?? (sportId || null));
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
      {escolheDesporto && (
        <select
          value={sportId}
          onChange={(e) => setSportId(e.target.value)}
          aria-label="Modalidade"
          className="h-7 shrink-0 rounded-[6px] border border-line bg-surface px-1.5 text-meta text-ink-2 focus:border-line-strong focus:outline-none"
        >
          <option value="">Todas</option>
          {academy.sports.map((sp) => (
            <option key={sp.id} value={sp.id}>
              {sp.name}
            </option>
          ))}
        </select>
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
