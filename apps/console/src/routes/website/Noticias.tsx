import { useState } from "react";
import { Newspaper, Pencil, Plus, Star, Trash2 } from "@/lib/icons";
import { Empty, cx } from "@/components/primitives";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useStore } from "@/lib/store";
import { gravarSite, novoId, useSite, type NoticiaDoSite } from "@/lib/website";
import { mostrarOk } from "@/lib/avisos";

const CATEGORIAS = ["Clube", "Seniores", "Formação", "Futsal", "Sócios", "Loja"];

const dataCurta = (iso: string) =>
  new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Lisbon" }).format(new Date(iso));

/**
 * As notícias do site: lista, escrever, publicar, destacar, apagar.
 *
 * Rascunhos primeiro e depois as publicadas, das mais novas para as mais
 * antigas: o que está por acabar é o que se procura ao abrir esta secção.
 */
export function Noticias() {
  const store = useStore();
  const slug = store.academy.slug;
  const site = useSite(slug);
  const [aberta, setAberta] = useState<NoticiaDoSite | "nova" | null>(null);
  const [apagar, setApagar] = useState<NoticiaDoSite | null>(null);

  const lista = [...site.noticias].sort((a, b) => {
    if (a.estado !== b.estado) return a.estado === "rascunho" ? -1 : 1;
    return (b.publicadaEm ?? "").localeCompare(a.publicadaEm ?? "");
  });
  const destaques = site.noticias.filter((n) => n.destaque && n.estado === "publicada").length;

  const alternarDestaque = (n: NoticiaDoSite) =>
    gravarSite(slug, (s) => ({ ...s, noticias: s.noticias.map((x) => (x.id === n.id ? { ...x, destaque: !x.destaque } : x)) }));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-meta text-ink-3">
          {site.noticias.length} {site.noticias.length === 1 ? "notícia" : "notícias"} · {destaques} em destaque
          {destaques > 3 && <span className="text-warn"> (só as três mais recentes abrem o site)</span>}
        </p>
        <button type="button" className="ctl-primary" onClick={() => setAberta("nova")}>
          <Plus className="size-4" strokeWidth={2} />
          Nova notícia
        </button>
      </div>

      {lista.length === 0 ? (
        <Empty icon={Newspaper} title="Ainda não há notícias" detail="A primeira notícia publicada aparece logo na página de início do site." />
      ) : (
        <ul className="overflow-hidden rounded-[12px] border border-line bg-surface">
          {lista.map((n) => (
            <li key={n.id} className="flex items-center gap-3 border-b border-line px-3 py-3 last:border-b-0 sm:gap-4 sm:px-4">
              <div className="size-14 shrink-0 overflow-hidden rounded-[8px] bg-sunken sm:h-14 sm:w-[88px]">
                {n.imagem && <img src={n.imagem} alt="" className="size-full object-cover" loading="lazy" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta">
                  <span className="font-medium text-signal-ink">{n.categoria}</span>
                  <span className={cx("rounded-full px-1.5 py-px text-[11px] font-medium", n.estado === "publicada" ? "bg-ok-soft text-ok" : "bg-sunken text-ink-3")}>
                    {n.estado === "publicada" ? "Publicada" : "Rascunho"}
                  </span>
                  {n.publicadaEm && <span className="text-ink-4">{dataCurta(n.publicadaEm)}</span>}
                </p>
                <p className="mt-0.5 truncate text-body font-medium text-ink">{n.titulo || "Sem título"}</p>
              </div>
              <button
                type="button"
                onClick={() => alternarDestaque(n)}
                aria-pressed={n.destaque}
                aria-label={n.destaque ? "Tirar do destaque" : "Pôr em destaque"}
                title={n.destaque ? "Em destaque" : "Pôr em destaque"}
                className="ctl-ghost size-9 shrink-0 justify-center px-0"
              >
                <Star className={cx("size-4", n.destaque ? "fill-warn text-warn" : "text-ink-4")} strokeWidth={1.75} />
              </button>
              <button type="button" onClick={() => setAberta(n)} aria-label="Editar" className="ctl-ghost size-9 shrink-0 justify-center px-0">
                <Pencil className="size-4" strokeWidth={1.75} />
              </button>
              <button type="button" onClick={() => setApagar(n)} aria-label="Apagar" className="ctl-ghost size-9 shrink-0 justify-center px-0 text-risk">
                <Trash2 className="size-4" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {aberta && (
        <EditarNoticia
          inicial={aberta === "nova" ? null : aberta}
          onClose={() => setAberta(null)}
          onGuardar={(n) => {
            gravarSite(slug, (s) => ({
              ...s,
              noticias: s.noticias.some((x) => x.id === n.id) ? s.noticias.map((x) => (x.id === n.id ? n : x)) : [n, ...s.noticias],
            }));
            mostrarOk(n.estado === "publicada" ? "Notícia publicada." : "Rascunho guardado.");
            setAberta(null);
          }}
        />
      )}

      {apagar && (
        <ConfirmDialog
          title="Apagar a notícia?"
          onClose={() => setApagar(null)}
          onConfirm={() => {
            gravarSite(slug, (s) => ({ ...s, noticias: s.noticias.filter((x) => x.id !== apagar.id) }));
            mostrarOk("Notícia apagada.");
            setApagar(null);
          }}
        >
          «{apagar.titulo || "Sem título"}» sai do site e não volta.
        </ConfirmDialog>
      )}
    </>
  );
}

function EditarNoticia({
  inicial,
  onClose,
  onGuardar,
}: {
  inicial: NoticiaDoSite | null;
  onClose: () => void;
  onGuardar: (n: NoticiaDoSite) => void;
}) {
  const [n, setN] = useState<NoticiaDoSite>(
    inicial ?? { id: novoId(), titulo: "", resumo: "", corpo: "", categoria: "Clube", imagem: "", destaque: false, estado: "rascunho", publicadaEm: null },
  );
  const pronta = n.titulo.trim() && n.resumo.trim() && n.corpo.trim();

  const guardar = (publicar: boolean) =>
    onGuardar({
      ...n,
      titulo: n.titulo.trim(),
      estado: publicar ? "publicada" : n.estado === "publicada" ? "publicada" : "rascunho",
      publicadaEm: publicar ? (n.publicadaEm ?? new Date().toISOString()) : n.publicadaEm,
    });

  return (
    <Dialog
      title={inicial ? "Editar notícia" : "Nova notícia"}
      icon={<Newspaper className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          {n.estado !== "publicada" && (
            <button type="button" className="ctl-outline" disabled={!n.titulo.trim()} onClick={() => guardar(false)}>
              Guardar rascunho
            </button>
          )}
          <button type="button" className="ctl-primary" disabled={!pronta} onClick={() => guardar(true)}>
            {n.estado === "publicada" ? "Guardar" : "Publicar"}
          </button>
        </>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <DialogField label="Título">
          <input className={dialogInputClass} value={n.titulo} onChange={(e) => setN({ ...n, titulo: e.target.value })} autoFocus />
        </DialogField>
        <DialogField label="Resumo" hint="Uma ou duas frases. Aparece por baixo do título nas listas e no WhatsApp.">
          <textarea className={cx(dialogInputClass, "h-20 py-2")} value={n.resumo} onChange={(e) => setN({ ...n, resumo: e.target.value })} />
        </DialogField>
        <DialogField label="Texto" hint="Parágrafos separados por uma linha em branco.">
          <textarea className={cx(dialogInputClass, "h-48 py-2")} value={n.corpo} onChange={(e) => setN({ ...n, corpo: e.target.value })} />
        </DialogField>
        <div className="grid gap-4 sm:grid-cols-2">
          <DialogField label="Categoria">
            <select className={dialogInputClass} value={n.categoria} onChange={(e) => setN({ ...n, categoria: e.target.value })}>
              {[...new Set([...CATEGORIAS, n.categoria])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </DialogField>
          <DialogField label="Foto (endereço)" hint="O carregamento de fotos chega com a API do site.">
            <input className={dialogInputClass} type="url" placeholder="https://…" value={n.imagem} onChange={(e) => setN({ ...n, imagem: e.target.value })} />
          </DialogField>
        </div>
        {n.imagem && <img src={n.imagem} alt="" className="aspect-[16/9] w-full rounded-[8px] border border-line object-cover" />}
      </div>
    </Dialog>
  );
}
