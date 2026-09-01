import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { DataTable, Empty, Loading, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { DeleteItemDialog } from "@/components/inventory/DeleteItemDialog";
import { EditItemDialog } from "@/components/inventory/EditItemDialog";
import { ItemPhotos } from "@/components/inventory/ItemPhotos";
import { ArrowLeft, Boxes, Pencil, Plus, Trash2, TriangleAlert } from "@/lib/icons";
import { shortDate, time } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import {
  MOVEMENT_LABEL,
  MOVEMENT_SIGN,
  STATUS_LABEL,
  STATUS_TONE,
  addVariant,
  getItem,
  moveStock,
  updateVariant,
  type ItemDetail as Data,
  type Variant,
} from "@/lib/inventory";

/**
 * A ficha de um artigo: os tamanhos, o stock de cada um e o histórico.
 *
 * ## O stock mexe-se aqui, tamanho a tamanho
 *
 * É onde a pessoa que arruma o armazém trabalha: chegaram cinquenta M, contaram-se
 * as L e afinal são 48. As duas coisas são operações diferentes — somar e fixar —
 * e o diálogo diz qual está a fazer, em vez de deixar alguém calcular a diferença
 * de cabeça.
 */
export default function ItemDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const podeEscrever = can(session, "inventory:write");

  const [data, setData] = useState<Data | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mexer, setMexer] = useState<Variant | null>(null);
  const [novoTamanho, setNovoTamanho] = useState(false);
  const [tirar, setTirar] = useState(false);
  const [editar, setEditar] = useState(false);
  const [renomear, setRenomear] = useState<Variant | null>(null);

  async function carregar() {
    setErro(null);
    try {
      setData(await getItem(id));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível abrir o artigo.");
    }
  }

  useEffect(() => {
    void carregar();
  }, [id]);

  if (erro) return <Empty title="Artigo" detail={erro} icon={TriangleAlert} />;
  if (!data) return <Loading />;

  return (
    <>
      <Link to="/inventario/artigos" className="mb-3 inline-flex items-center gap-1.5 text-meta font-medium text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" strokeWidth={1.75} />
        Artigos
      </Link>

      <PageHeader
        eyebrow={data.category?.label ?? "Inventário"}
        title={data.name}
        subtitle={[data.brand, data.sku].filter(Boolean).join(" · ") || undefined}
      >
        <Pill tone={STATUS_TONE[data.status]}>{STATUS_LABEL[data.status]}</Pill>
        {podeEscrever && (
          <button type="button" className="ctl-ghost" onClick={() => setEditar(true)}>
            <Pencil className="size-3.5" strokeWidth={1.75} />
            Editar
          </button>
        )}
        {/*
          Tirar do armazém fica no fim e discreto: é a única acção desta página
          sem volta, e ninguém deve tropeçar nela a caminho de ver o stock.
        */}
        {podeEscrever && (
          <button
            type="button"
            aria-label="Tirar do armazém"
            title="Arquivar ou apagar"
            className="ctl-ghost size-8 justify-center px-0 text-ink-4 hover:bg-risk-soft hover:text-risk"
            onClick={() => setTirar(true)}
          >
            <Trash2 className="size-4" strokeWidth={1.75} />
          </button>
        )}
      </PageHeader>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHead title="Stock por tamanho" hint={`${data.available} disponíveis de ${data.total}`}>
            {podeEscrever && (
              <button type="button" className="ctl-ghost" onClick={() => setNovoTamanho(true)}>
                <Plus className="size-3.5" strokeWidth={1.75} />
                Tamanho
              </button>
            )}
          </PanelHead>
          <DataTable
            rows={data.variants}
            keyOf={(v) => v.id}
            onRowClick={podeEscrever ? (v) => setMexer(v) : undefined}
            empty={<Empty title="Sem tamanhos" detail="Junta o primeiro." icon={Boxes} compact />}
            columns={[
              { key: "label", header: "Tamanho", render: (v) => <span className="font-medium text-ink">{v.label}</span> },
              { key: "total", header: "Total", align: "right", render: (v) => <span className="tabular">{v.total}</span> },
              {
                key: "disp",
                header: "Disponível",
                align: "right",
                render: (v) => <span className="tabular font-medium text-ink">{v.available}</span>,
              },
              { key: "atrib", header: "Atribuído", align: "right", render: (v) => <span className="tabular text-ink-2">{v.assigned}</span> },
              {
                key: "min",
                header: "Mínimo",
                align: "right",
                hideBelow: "sm",
                render: (v) => <span className="tabular text-ink-3">{v.minimumStock || "—"}</span>,
              },
              {
                key: "baixas",
                header: "Baixas",
                align: "right",
                hideBelow: "md",
                render: (v) =>
                  v.damaged + v.lost > 0 ? (
                    <span className="text-meta text-ink-3 tabular" title="Danificadas · perdidas">
                      {v.damaged} · {v.lost}
                    </span>
                  ) : (
                    <span className="text-ink-4">—</span>
                  ),
              },
              {
                key: "estado",
                header: "Estado",
                align: "right",
                render: (v) => <Pill tone={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</Pill>,
              },
              /*
                Editar o tamanho vive numa coluna própria, e não no diálogo do
                stock: mudar quantas há e mudar como se chama são coisas
                diferentes, e quem abre um "M" para dar entrada de cinquenta não
                deve encontrar o nome dele editável ao lado do número.
              */
              ...(podeEscrever
                ? [
                    {
                      key: "editar",
                      header: "",
                      align: "right" as const,
                      width: "44px",
                      render: (v: Variant) => (
                        <button
                          type="button"
                          aria-label={`Editar o tamanho ${v.label}`}
                          className="flex size-7 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-ink-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenomear(v);
                          }}
                        >
                          <Pencil className="size-3.5" strokeWidth={1.75} />
                        </button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          {podeEscrever && data.variants.length > 0 && (
            <p className="border-t border-line px-5 py-2.5 text-meta text-ink-3">
              Clica numa linha para dar entrada, dar saída ou corrigir a contagem.
            </p>
          )}
        </Panel>

        <div className="space-y-3">
          <ItemPhotos itemId={id} images={data.images} editable={podeEscrever} onChange={() => void carregar()} />

          {data.description && (
            <Panel>
              <PanelHead title="Descrição" />
              <p className="px-5 py-4 text-body leading-relaxed text-ink-2">{data.description}</p>
            </Panel>
          )}

          <Panel>
            <PanelHead title="Histórico" hint="nunca se apaga" />
            {data.movements.length === 0 ? (
              <Empty title="Sem movimentos" detail="O histórico começa na primeira entrada." icon={Boxes} compact />
            ) : (
              <ul className="max-h-[520px] divide-y divide-line overflow-y-auto">
                {data.movements.map((m) => (
                  <li key={m.id} className="flex items-start gap-3 px-5 py-2.5">
                    <span
                      className={cx(
                        "w-10 shrink-0 text-right text-body font-semibold tabular",
                        MOVEMENT_SIGN[m.type] === "+" ? "text-ok" : MOVEMENT_SIGN[m.type] === "−" ? "text-risk" : "text-ink-3",
                      )}
                    >
                      {MOVEMENT_SIGN[m.type]}
                      {m.quantity}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-ink">
                        {MOVEMENT_LABEL[m.type]} <span className="text-ink-3">· {m.variantLabel}</span>
                      </span>
                      <span className="block truncate text-meta text-ink-3">
                        {[m.athleteName, m.reason, m.by].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    <span className="shrink-0 text-meta text-ink-4 tabular">
                      {shortDate(new Date(m.at))} · {time(new Date(m.at))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {mexer && (
        <StockDialog
          variant={mexer}
          onClose={() => setMexer(null)}
          onDone={() => {
            setMexer(null);
            void carregar();
          }}
        />
      )}

      {editar && (
        <EditItemDialog
          item={data}
          onClose={() => setEditar(false)}
          onDone={() => {
            setEditar(false);
            void carregar();
          }}
        />
      )}

      {renomear && (
        <EditVariantDialog
          variant={renomear}
          onClose={() => setRenomear(null)}
          onDone={() => {
            setRenomear(null);
            void carregar();
          }}
        />
      )}

      {tirar && (
        <DeleteItemDialog
          item={data}
          onClose={() => setTirar(false)}
          onArchived={() => navigate("/inventario/artigos")}
          onDeleted={() => navigate("/inventario/artigos")}
        />
      )}

      {novoTamanho && (
        <NewVariantDialog
          itemId={id}
          onClose={() => setNovoTamanho(false)}
          onDone={() => {
            setNovoTamanho(false);
            void carregar();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Mexer no stock de um tamanho.
 *
 * Três operações com nomes de coisas que acontecem no armazém — "chegou",
 * "saiu", "contei" — e não os nomes técnicos do modelo. Quem arruma material
 * não pensa em `ADJUSTMENT`.
 */
function StockDialog({ variant, onClose, onDone }: { variant: Variant; onClose: () => void; onDone: () => void }) {
  const [tipo, setTipo] = useState<"ENTRY" | "EXIT" | "ADJUSTMENT">("ENTRY");
  const [quantidade, setQuantidade] = useState("1");
  const [razao, setRazao] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const n = Number(quantidade) || 0;
  const valido = tipo === "ADJUSTMENT" ? n >= 0 : n >= 1;

  // O que o total passa a ser — dito antes de confirmar, porque um ajuste que
  // fixa em vez de somar é a operação onde é mais fácil enganar-se.
  const futuro = tipo === "ENTRY" ? variant.total + n : tipo === "EXIT" ? variant.total - n : n;

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await moveStock(variant.id, { type: tipo, quantity: n, reason: razao.trim() || undefined });
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível gravar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="stock"
      title={`Stock · ${variant.label}`}
      subtitle={`${variant.available} disponíveis de ${variant.total} · ${variant.assigned} com atletas`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" form="form-stock" className="ctl-primary" disabled={!valido || busy}>
            {busy ? "A gravar…" : "Gravar"}
          </button>
        </>
      }
    >
      <form id="form-stock" onSubmit={submeter} className="space-y-4 p-5">
        <fieldset>
          <legend className="mb-1.5 text-meta font-medium text-ink">O que aconteceu</legend>
          <div className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-sunken p-1">
            {(
              [
                ["ENTRY", "Chegou"],
                ["EXIT", "Saiu"],
                ["ADJUSTMENT", "Contei"],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setTipo(v);
                  if (v === "ADJUSTMENT") setQuantidade(String(variant.total));
                }}
                aria-pressed={tipo === v}
                className={cx(
                  "h-8 rounded-[7px] px-3 text-meta font-semibold transition-colors duration-[120ms]",
                  tipo === v ? "bg-ink text-surface" : "text-ink-3 hover:bg-surface/60 hover:text-ink-2",
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </fieldset>

        <DialogField
          label={tipo === "ADJUSTMENT" ? "Quantas há, ao certo" : "Quantas unidades"}
          hint={`o total passa a ${Math.max(0, futuro)}`}
        >
          <input
            type="number"
            min={tipo === "ADJUSTMENT" ? 0 : 1}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            className={cx(dialogInputClass, "tabular")}
            autoFocus
          />
        </DialogField>

        <DialogField label="Motivo" hint="opcional, fica no histórico">
          <input
            value={razao}
            onChange={(e) => setRazao(e.target.value)}
            placeholder={tipo === "ENTRY" ? "Compra de época" : tipo === "EXIT" ? "Oferta ao clube visitante" : "Contagem de armazém"}
            className={dialogInputClass}
          />
        </DialogField>

        {futuro < variant.assigned && (
          <p className="flex items-start gap-1.5 text-meta text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            Há {variant.assigned} unidades com atletas — o total não pode ficar abaixo disso.
          </p>
        )}

        {erro && (
          <p className="flex items-start gap-1.5 text-meta text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function NewVariantDialog({ itemId, onClose, onDone }: { itemId: string; onClose: () => void; onDone: () => void }) {
  const [label, setLabel] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [minimo, setMinimo] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await addVariant(itemId, {
        label: label.trim(),
        quantity: Number(quantity) || 0,
        ...(minimo.trim() ? { minimumStock: Number(minimo) } : {}),
      });
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível juntar o tamanho.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="novo-tamanho"
      title="Novo tamanho"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" form="form-tamanho" className="ctl-primary" disabled={!label.trim() || busy}>
            {busy ? "A juntar…" : "Juntar"}
          </button>
        </>
      }
    >
      <form id="form-tamanho" onSubmit={submeter} className="space-y-4 p-5">
        <div className="grid grid-cols-3 gap-3">
          <DialogField label="Tamanho">
            <input value={label} onChange={(e) => setLabel(e.target.value)} className={dialogInputClass} autoFocus />
          </DialogField>
          <DialogField label="Quantas há">
            <input
              type="number"
              min={0}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={cx(dialogInputClass, "tabular")}
            />
          </DialogField>
          <DialogField label="Mínimo">
            <input
              type="number"
              min={0}
              value={minimo}
              onChange={(e) => setMinimo(e.target.value)}
              className={cx(dialogInputClass, "tabular")}
            />
          </DialogField>
        </div>

        {erro && (
          <p className="flex items-start gap-1.5 text-meta text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/**
 * Editar um tamanho: como se chama, o código e o mínimo dele.
 *
 * O mínimo em branco herda o do artigo — é o que quase todos os clubes querem,
 * e é por isso que a dica o diz em vez de o campo nascer preenchido com um
 * número que ninguém escolheu.
 *
 * As quantidades não estão aqui: são o outro diálogo, o que deixa movimento.
 */
function EditVariantDialog({ variant, onClose, onDone }: { variant: Variant; onClose: () => void; onDone: () => void }) {
  const [label, setLabel] = useState(variant.label);
  const [sku, setSku] = useState(variant.sku ?? "");
  const [minimo, setMinimo] = useState(variant.ownMinimum === null ? "" : String(variant.ownMinimum));
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await updateVariant(variant.id, {
        label: label.trim(),
        sku: sku.trim(),
        // Vazio volta a herdar o do artigo; um número fixa-o só neste tamanho.
        ...(minimo.trim() ? { minimumStock: Number(minimo) } : {}),
      });
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="editar-tamanho"
      title={`Editar ${variant.label}`}
      subtitle={`${variant.total} unidades · ${variant.assigned} com atletas`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form="form-editar-tamanho" className="ctl-primary" disabled={!label.trim() || busy}>
            {busy ? "A guardar…" : "Guardar"}
          </button>
        </>
      }
    >
      <form id="form-editar-tamanho" onSubmit={submeter} className="space-y-4 p-5">
        <div className="grid grid-cols-3 gap-3">
          <DialogField label="Tamanho">
            <input value={label} onChange={(e) => setLabel(e.target.value)} className={dialogInputClass} autoFocus />
          </DialogField>
          <DialogField label="Referência" hint="opcional">
            <input value={sku} onChange={(e) => setSku(e.target.value)} className={dialogInputClass} />
          </DialogField>
          <DialogField label="Mínimo" hint="vazio = o do artigo">
            <input
              type="number"
              min={0}
              value={minimo}
              onChange={(e) => setMinimo(e.target.value)}
              placeholder={String(variant.minimumStock)}
              className={cx(dialogInputClass, "tabular")}
            />
          </DialogField>
        </div>

        <p className="text-meta leading-relaxed text-ink-3">
          As quantidades mexem-se clicando na linha — cada entrada, saída ou contagem fica no histórico.
        </p>

        {erro && (
          <p className="flex items-start gap-1.5 text-meta text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </p>
        )}
      </form>
    </Dialog>
  );
}
