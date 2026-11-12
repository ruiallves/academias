import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Percent, Plus, Tags, Trash2 } from "@/lib/icons";
import { Empty, cx } from "@/components/primitives";
import { Segmented } from "@/components/filters";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Interruptor } from "@/components/definicoes/ui";
import { useStore } from "@/lib/store";
import { mostrarOk } from "@/lib/avisos";
import {
  apagarCategoria,
  apagarCodigo,
  guardarCategoria,
  guardarCodigo,
  moverCategoria,
  useSite,
  type CategoriaDaLoja,
  type CodigoDaLoja,
  type CodigoParaGravar,
} from "@/lib/website";

const euro = (v: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v);

/** O endereço de um nome, como a API o faz (`slugDoTexto`): só para mostrar enquanto se escreve. */
export function slugDe(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/* -------------------------------------------------------------------------- */
/* Categorias                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * As categorias da loja: a ordem é a do filtro do site (setas), o endereço é
 * o de `/loja?categoria=…`, e uma escondida sai do filtro sem tirar os
 * produtos de venda. Apagar deixa os produtos sem categoria.
 */
export function Categorias() {
  const site = useSite(useStore().academy.slug);
  const [aberta, setAberta] = useState<CategoriaDaLoja | "nova" | null>(null);
  const [apagar, setApagar] = useState<CategoriaDaLoja | null>(null);
  const semCategoria = site.produtos.filter((p) => !p.categoriaId).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-panel text-ink">Categorias</h3>
          <p className="mt-0.5 text-meta text-ink-3">A ordem aqui é a ordem do filtro na loja do site.</p>
        </div>
        <button type="button" className="ctl-primary" onClick={() => setAberta("nova")}>
          <Plus className="size-4" strokeWidth={2} />
          Nova categoria
        </button>
      </div>

      {site.categorias.length === 0 ? (
        <Empty icon={Tags} title="Ainda sem categorias" detail="As categorias aparecem no filtro da loja do site (Camisolas, Treino, Adeptos). Cada produto escolhe a sua." />
      ) : (
        <ul className="overflow-hidden rounded-[12px] border border-line bg-surface">
          {site.categorias.map((c, i) => (
            <li key={c.id} className={cx("flex items-center gap-2 border-b border-line px-3 py-2.5 last:border-b-0 sm:gap-3 sm:px-4", !c.visivel && "opacity-60")}>
              <div className="flex shrink-0 flex-col">
                <button type="button" aria-label={`Subir ${c.nome}`} disabled={i === 0} onClick={() => void moverCategoria(c.id, -1)} className="grid size-7 place-items-center rounded-[6px] text-ink-3 hover:bg-sunken hover:text-ink disabled:opacity-25">
                  <ArrowUp className="size-3.5" strokeWidth={2} />
                </button>
                <button type="button" aria-label={`Descer ${c.nome}`} disabled={i === site.categorias.length - 1} onClick={() => void moverCategoria(c.id, 1)} className="grid size-7 place-items-center rounded-[6px] text-ink-3 hover:bg-sunken hover:text-ink disabled:opacity-25">
                  <ArrowDown className="size-3.5" strokeWidth={2} />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-ink">{c.nome}</p>
                <p className="truncate text-meta text-ink-3">
                  <span className="font-mono text-[12px]">/loja?categoria={c.slug}</span>
                  {!c.visivel && " · escondida do filtro"}
                </p>
              </div>
              <span className="shrink-0 text-meta tabular-nums text-ink-3">{c.produtos === 1 ? "1 produto" : `${c.produtos} produtos`}</span>
              <Interruptor ligado={c.visivel} onChange={() => void guardarCategoria({ ...c, visivel: !c.visivel }).catch(() => undefined)} label={`Mostrar ${c.nome} no filtro do site`} />
              <button type="button" onClick={() => setAberta(c)} aria-label={`Editar ${c.nome}`} className="ctl-ghost size-9 shrink-0 justify-center px-0">
                <Pencil className="size-4" strokeWidth={1.75} />
              </button>
              <button type="button" onClick={() => setApagar(c)} aria-label={`Apagar ${c.nome}`} className="ctl-ghost size-9 shrink-0 justify-center px-0 text-risk">
                <Trash2 className="size-4" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {semCategoria > 0 && site.categorias.length > 0 && (
        <p className="mt-3 text-meta text-ink-3">{semCategoria === 1 ? "1 produto não tem categoria" : `${semCategoria} produtos não têm categoria`}: aparecem só em "Todas".</p>
      )}

      {aberta && <EditarCategoria inicial={aberta === "nova" ? null : aberta} onClose={() => setAberta(null)} />}
      {apagar && (
        <ConfirmDialog
          title="Apagar a categoria?"
          onClose={() => setApagar(null)}
          onConfirm={async () => {
            await apagarCategoria(apagar.id);
            mostrarOk("Categoria apagada.");
            setApagar(null);
          }}
        >
          «{apagar.nome}» sai do filtro da loja. {apagar.produtos > 0 ? `Os ${apagar.produtos} produtos dela continuam à venda, sem categoria.` : ""}
        </ConfirmDialog>
      )}
    </div>
  );
}

function EditarCategoria({ inicial, onClose }: { inicial: CategoriaDaLoja | null; onClose: () => void }) {
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [slug, setSlug] = useState(inicial?.slug ?? "");
  const [slugMexido, setSlugMexido] = useState(!!inicial);
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [visivel, setVisivel] = useState(inicial?.visivel ?? true);
  const [aGravar, setAGravar] = useState(false);
  const endereco = slugMexido ? slugDe(slug) : slugDe(nome);

  const guardar = async () => {
    setAGravar(true);
    try {
      await guardarCategoria({ id: inicial?.id ?? "", nome: nome.trim(), slug: endereco, descricao, visivel });
      mostrarOk("Categoria guardada.");
      onClose();
    } catch {
      // O erro aparece no cartão de erros; o diálogo fica aberto.
    } finally {
      setAGravar(false);
    }
  };

  return (
    <Dialog
      title={inicial ? "Editar categoria" : "Nova categoria"}
      icon={<Tags className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" disabled={!nome.trim() || !endereco || aGravar} onClick={() => void guardar()}>
            Guardar
          </button>
        </>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <DialogField label="Nome">
          <input className={dialogInputClass} maxLength={40} placeholder="Camisolas" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
        </DialogField>
        <DialogField label="Endereço" hint="o que aparece no link do filtro">
          <div className="flex items-center overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface focus-within:border-line-strong">
            <span className="shrink-0 border-r border-line bg-sunken px-2.5 py-2 font-mono text-[12px] text-ink-3">/loja?categoria=</span>
            <input
              className="h-9 min-w-0 flex-1 bg-transparent px-2.5 font-mono text-[13px] text-ink outline-none"
              maxLength={80}
              value={slugMexido ? slug : slugDe(nome)}
              onChange={(e) => {
                setSlugMexido(true);
                setSlug(e.target.value);
              }}
              onBlur={() => setSlug(slugDe(slug))}
            />
          </div>
        </DialogField>
        <DialogField label="Descrição" hint="opcional, aparece por baixo do título da categoria">
          <input className={dialogInputClass} maxLength={500} placeholder="Equipamentos oficiais de jogo, adulto e criança." value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </DialogField>
        <div className="flex items-center justify-between gap-3 rounded-[8px] border border-line px-3 py-2.5">
          <div>
            <span className="text-body text-ink">Mostrar no filtro do site</span>
            <p className="text-meta text-ink-3">Escondida, os produtos continuam à venda em "Todas".</p>
          </div>
          <Interruptor ligado={visivel} onChange={() => setVisivel(!visivel)} label="Mostrar no filtro do site" />
        </div>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Códigos promocionais                                                         */
/* -------------------------------------------------------------------------- */

const ESTADO: Record<CodigoDaLoja["estado"], { rotulo: string; classe: string }> = {
  ativo: { rotulo: "Ativo", classe: "bg-ok-soft text-ok" },
  agendado: { rotulo: "Agendado", classe: "bg-signal-soft text-signal-ink" },
  expirado: { rotulo: "Expirado", classe: "bg-sunken text-ink-3" },
  esgotado: { rotulo: "Usos esgotados", classe: "bg-warn-soft text-warn" },
  desligado: { rotulo: "Desligado", classe: "bg-sunken text-ink-3" },
};

/**
 * Os códigos promocionais: quem compra escreve-os no carrinho do site. Cada
 * um diz o que dá, até quando, quantas vezes já foi usado e quanto já
 * descontou. As regras estão na API (`avaliarCodigo`).
 */
export function Codigos() {
  const site = useSite(useStore().academy.slug);
  const [aberto, setAberto] = useState<CodigoDaLoja | "novo" | null>(null);
  const [apagar, setApagar] = useState<CodigoDaLoja | null>(null);
  const nomeDaCategoria = new Map(site.categorias.map((c) => [c.id, c.nome]));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-panel text-ink">Códigos promocionais</h3>
          <p className="mt-0.5 text-meta text-ink-3">Quem compra escreve o código no carrinho do site.</p>
        </div>
        <button type="button" className="ctl-primary" onClick={() => setAberto("novo")}>
          <Plus className="size-4" strokeWidth={2} />
          Novo código
        </button>
      </div>

      {site.codigos.length === 0 ? (
        <Empty icon={Percent} title="Ainda sem códigos" detail="Um código dá uma percentagem, um valor ou o envio grátis, com datas, mínimo de compra e limite de usos. Bom para campanhas e para os sócios." />
      ) : (
        <ul className="overflow-hidden rounded-[12px] border border-line bg-surface">
          {site.codigos.map((c) => {
            const e = ESTADO[c.estado];
            const categorias = c.categorias.map((id) => nomeDaCategoria.get(id)).filter(Boolean);
            return (
              <li key={c.id} className="flex items-center gap-3 border-b border-line px-3 py-3 last:border-b-0 sm:gap-4 sm:px-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono text-[14px] font-semibold tracking-wide text-ink">{c.codigo}</span>
                    <span className={cx("rounded-full px-1.5 py-px text-[11px] font-medium", e.classe)}>{e.rotulo}</span>
                  </p>
                  <p className="mt-0.5 truncate text-meta text-ink-2">
                    {c.resumo}
                    {categorias.length > 0 && ` · só ${categorias.join(", ")}`}
                    {c.semPromocoes && " · sem promoções"}
                    {c.umaVezPorPessoa && " · 1 por pessoa"}
                  </p>
                  {c.descricao && <p className="truncate text-meta text-ink-4">{c.descricao}</p>}
                </div>
                <div className="hidden shrink-0 text-right sm:block">
                  <p className="text-body font-medium tabular-nums text-ink">{c.maxUsos ? `${c.usos} de ${c.maxUsos}` : c.usos === 1 ? "1 uso" : `${c.usos} usos`}</p>
                  <p className="text-meta tabular-nums text-ink-3">{c.descontadoEuros > 0 ? `−${euro(c.descontadoEuros)}` : "nada descontado"}</p>
                </div>
                <Interruptor ligado={c.ativo} onChange={() => void guardarCodigo({ ...c, ativo: !c.ativo }).catch(() => undefined)} label={`Código ${c.codigo} ligado`} />
                <button type="button" onClick={() => setAberto(c)} aria-label={`Editar ${c.codigo}`} className="ctl-ghost size-9 shrink-0 justify-center px-0">
                  <Pencil className="size-4" strokeWidth={1.75} />
                </button>
                <button type="button" onClick={() => setApagar(c)} aria-label={`Apagar ${c.codigo}`} className="ctl-ghost size-9 shrink-0 justify-center px-0 text-risk">
                  <Trash2 className="size-4" strokeWidth={1.75} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {aberto && <EditarCodigo inicial={aberto === "novo" ? null : aberto} categorias={site.categorias} onClose={() => setAberto(null)} />}
      {apagar && (
        <ConfirmDialog
          title="Apagar o código?"
          onClose={() => setApagar(null)}
          onConfirm={async () => {
            await apagarCodigo(apagar.id);
            mostrarOk("Código apagado.");
            setApagar(null);
          }}
        >
          «{apagar.codigo}» deixa de funcionar no carrinho. As encomendas que já o usaram ficam como estão. Para o parar só por uns tempos, desliga-o.
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Data ISO → valor de um `<input type="date">` (dia de Lisboa). */
const paraDia = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date(iso)) : "");
/** Dia → ISO, ao início (00:00) ou ao fim (23:59) do dia em Lisboa. */
function deDia(dia: string, fim: boolean): string | null {
  if (!dia) return null;
  const [a, m, d] = dia.split("-").map(Number);
  // Meio-dia UTC desse dia, menos a diferença de Lisboa: chega para acertar o dia certo.
  const base = new Date(Date.UTC(a, m - 1, d, fim ? 23 : 0, fim ? 59 : 0, fim ? 59 : 0));
  const lisboa = new Date(base.toLocaleString("en-US", { timeZone: "Europe/Lisbon" }));
  const utc = new Date(base.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(base.getTime() - (lisboa.getTime() - utc.getTime())).toISOString();
}
const paraTexto = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));
const deTexto = (s: string): number | null => {
  const n = Number(s.replace(",", "."));
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
};

function EditarCodigo({ inicial, categorias, onClose }: { inicial: CodigoDaLoja | null; categorias: CategoriaDaLoja[]; onClose: () => void }) {
  const [c, setC] = useState<CodigoParaGravar>(
    inicial ?? {
      id: "",
      codigo: "",
      descricao: "",
      tipo: "PERCENTAGEM",
      valor: 10,
      envioGratis: false,
      minimo: null,
      inicio: null,
      fim: null,
      maxUsos: null,
      umaVezPorPessoa: false,
      categorias: [],
      semPromocoes: false,
      ativo: true,
    },
  );
  const [valor, setValor] = useState(paraTexto(inicial?.valor ?? 10));
  const [minimo, setMinimo] = useState(paraTexto(inicial?.minimo ?? null));
  const [usos, setUsos] = useState(inicial?.maxUsos ? String(inicial.maxUsos) : "");
  const [aGravar, setAGravar] = useState(false);
  const v = deTexto(valor) ?? 0;
  const valido = c.codigo.trim().length >= 3 && (v > 0 || c.envioGratis) && (c.tipo === "FIXO" || v <= 100);

  const guardar = async () => {
    setAGravar(true);
    try {
      await guardarCodigo({ ...c, valor: v, minimo: deTexto(minimo), maxUsos: usos ? Number(usos) : null });
      mostrarOk("Código guardado.");
      onClose();
    } catch {
      // O erro aparece no cartão de erros; o diálogo fica aberto.
    } finally {
      setAGravar(false);
    }
  };

  const alternarCategoria = (id: string) => setC({ ...c, categorias: c.categorias.includes(id) ? c.categorias.filter((x) => x !== id) : [...c.categorias, id] });

  return (
    <Dialog
      title={inicial ? `Editar ${inicial.codigo}` : "Novo código promocional"}
      icon={<Percent className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" disabled={!valido || aGravar} onClick={() => void guardar()}>
            Guardar
          </button>
        </>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <DialogField label="Código" hint="o que se escreve no carrinho">
            <input
              className={cx(dialogInputClass, "font-mono uppercase tracking-wide")}
              maxLength={30}
              placeholder="NATAL10"
              value={c.codigo}
              onChange={(e) => setC({ ...c, codigo: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })}
              autoFocus={!inicial}
            />
          </DialogField>
          <DialogField label="Nota interna" hint="não aparece no site">
            <input className={dialogInputClass} maxLength={200} placeholder="Campanha de Natal no Instagram" value={c.descricao} onChange={(e) => setC({ ...c, descricao: e.target.value })} />
          </DialogField>
        </div>

        <div>
          <p className="mb-1.5 text-meta font-medium text-ink-2">Desconto</p>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              value={c.tipo}
              onChange={(tipo) => setC({ ...c, tipo })}
              label="Tipo de desconto"
              options={[
                { value: "PERCENTAGEM" as const, label: "Percentagem" },
                { value: "FIXO" as const, label: "Valor fixo" },
              ]}
            />
            <div className="flex items-center gap-2">
              <input className={cx(dialogInputClass, "w-24 tabular-nums")} inputMode="decimal" aria-label="Valor do desconto" value={valor} onChange={(e) => setValor(e.target.value)} />
              <span className="text-body text-ink-3">{c.tipo === "PERCENTAGEM" ? "%" : "€"}</span>
            </div>
          </div>
          {c.tipo === "PERCENTAGEM" && v > 100 && <p className="mt-1.5 text-meta text-risk">A percentagem vai até 100.</p>}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-[8px] border border-line px-3 py-2.5">
          <div>
            <span className="text-body text-ink">Envio grátis</span>
            <p className="text-meta text-ink-3">Além do desconto. Com o desconto a 0, o código dá só o envio.</p>
          </div>
          <Interruptor ligado={c.envioGratis} onChange={() => setC({ ...c, envioGratis: !c.envioGratis })} label="Envio grátis" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <DialogField label="Compra mínima (€)" hint="vazio = sem mínimo">
            <input className={cx(dialogInputClass, "tabular-nums")} inputMode="decimal" placeholder="30" value={minimo} onChange={(e) => setMinimo(e.target.value)} />
          </DialogField>
          <DialogField label="Máximo de usos" hint="no total; vazio = sem limite">
            <input className={cx(dialogInputClass, "tabular-nums")} inputMode="numeric" placeholder="100" value={usos} onChange={(e) => setUsos(e.target.value.replace(/\D/g, "").slice(0, 7))} />
          </DialogField>
          <DialogField label="Vale a partir de" hint="vazio = já">
            <input type="date" className={dialogInputClass} value={paraDia(c.inicio)} onChange={(e) => setC({ ...c, inicio: deDia(e.target.value, false) })} />
          </DialogField>
          <DialogField label="Vale até" hint="inclusive; vazio = sem fim">
            <input type="date" className={dialogInputClass} value={paraDia(c.fim)} onChange={(e) => setC({ ...c, fim: deDia(e.target.value, true) })} />
          </DialogField>
        </div>

        {categorias.length > 0 && (
          <div>
            <p className="mb-1.5 text-meta font-medium text-ink-2">
              Só nestas categorias <span className="font-normal text-ink-4">· nenhuma escolhida = a loja toda</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {categorias.map((k) => {
                const ativa = c.categorias.includes(k.id);
                return (
                  <button
                    key={k.id}
                    type="button"
                    aria-pressed={ativa}
                    onClick={() => alternarCategoria(k.id)}
                    className={cx("h-9 rounded-full border px-3 text-meta font-medium transition", ativa ? "border-signal-line bg-signal-soft text-signal-ink" : "border-line text-ink-2 hover:border-line-strong")}
                  >
                    {k.nome}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="divide-y divide-line rounded-[8px] border border-line">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div>
              <span className="text-body text-ink">Uma vez por pessoa</span>
              <p className="text-meta text-ink-3">Conta pelo email de quem compra.</p>
            </div>
            <Interruptor ligado={c.umaVezPorPessoa} onChange={() => setC({ ...c, umaVezPorPessoa: !c.umaVezPorPessoa })} label="Uma vez por pessoa" />
          </div>
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div>
              <span className="text-body text-ink">Não junta com promoções</span>
              <p className="text-meta text-ink-3">Os produtos com preço riscado ficam de fora do desconto.</p>
            </div>
            <Interruptor ligado={c.semPromocoes} onChange={() => setC({ ...c, semPromocoes: !c.semPromocoes })} label="Não junta com promoções" />
          </div>
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div>
              <span className="text-body text-ink">Ligado</span>
              <p className="text-meta text-ink-3">Desligado, o carrinho recusa-o.</p>
            </div>
            <Interruptor ligado={c.ativo} onChange={() => setC({ ...c, ativo: !c.ativo })} label="Código ligado" />
          </div>
        </div>
      </div>
    </Dialog>
  );
}
