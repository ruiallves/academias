import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Megaphone,
  Newspaper,
  Plus,
  Shield,
  ShoppingBag,
  Ticket,
  Trash2,
  Users,
  X,
} from "@/lib/icons";
import { cx } from "@/components/primitives";
import { Campo, campoClass } from "@/components/definicoes/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useStore } from "@/lib/store";
import {
  BANNERS_MAX,
  BANNER_VAZIO,
  SECCOES_INICIO,
  enderecoDoSite,
  guardarConfig,
  useSite,
  type Banner,
  type Layout,
  type SeccaoInicio,
  type SeccaoInicioKey,
} from "@/lib/website";
import { mostrarOk } from "@/lib/avisos";
import { CampoDeImagem } from "./CampoDeImagem";

/**
 * A página de início do site, montada à mão.
 *
 * ## Porque é que é um desenho e não uma tabela
 *
 * Uma lista com setas dizia a ordem mas não mostrava a página: ninguém olha
 * para "jogo, notícias, equipas" e vê o site. Aqui a página está desenhada em
 * ponta pequena, de alto a baixo, **com o tema que o clube escolheu** (a
 * Tribuna com o cabeçalho em dois andares, o Holofote com a barra lateral e o
 * carrossel), e cada secção com a forma que tem lá. Mexe-se nela como se mexe
 * numa página: pega-se numa secção e arrasta-se, o caixote tira-a da página,
 * e entre duas secções há um "+" que põe ali um banner novo ou uma secção que
 * esteja fora (o que está na lista é o que está na página; uma fixa tirada
 * volta sem perder nada, porque o conteúdo dela vive noutro sítio). O que
 * está escolhido edita-se à direita.
 *
 * ## A cor do clube, pouca
 *
 * As miniaturas são a cinzento e a preto, como um esboço: a cor do clube
 * entra só onde o site a põe (a etiqueta de uma notícia, um botão, um traço).
 * Com a cor em blocos grandes, um clube amarelo tinha uma página de início a
 * gritar, e não se via a forma.
 *
 * ## O que se grava quando
 *
 * A ordem, o mostrar/esconder e acrescentar ou tirar um banner gravam-se ao
 * gesto (`guardarConfig` junta os gestos de meio segundo num pedido só). O
 * texto de um banner é um rascunho com Guardar, como a Identidade: escreve-se
 * com calma e o site não fica a meio de uma frase.
 *
 * ## Arrastar
 *
 * Sem biblioteca: três eventos de ponteiro, que servem o rato e o dedo. Com o
 * rato pega-se em qualquer ponto da secção (fora dos botões); com o dedo só
 * pela pega, para a página continuar a rolar com o dedo em cima das secções.
 * Só começa depois de 6 px (um toque não é um arrasto), a secção levantada
 * segue o ponteiro, as outras abrem-lhe espaço, e largar é o que reordena.
 * Pelo teclado, a pega aceita as setas, e o que aconteceu é anunciado a quem
 * usa leitor de ecrã.
 */

const LIMIAR_PX = 6;

export function Inicio({ onIr }: { onIr: (secao: string) => void }) {
  const store = useStore();
  const slug = store.academy.slug;
  const site = useSite(slug);
  const seccoes = site.inicio.seccoes;

  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState("");
  const [tirar, setTirar] = useState<SeccaoInicio | null>(null);
  const sel = seccoes.find((s) => s.id === selecionada) ?? null;

  const gravar = (novas: SeccaoInicio[], opts?: { imediato?: boolean }) =>
    guardarConfig({ inicio: { ...site.inicio, seccoes: novas } }, opts);

  const mover = (de: number, para: number) => {
    if (para < 0 || para >= seccoes.length || de === para) return;
    const novas = [...seccoes];
    const [s] = novas.splice(de, 1);
    novas.splice(para, 0, s);
    void gravar(novas);
    setAnuncio(`${rotuloDe(s)} passou para a posição ${para + 1} de ${novas.length}.`);
  };

  const banners = seccoes.filter((s) => s.key === "banner").length;
  /** As fixas que não estão na página: é o que o "+" oferece, além do banner. */
  const emFalta = SECCOES_INICIO.map((x) => x.key).filter((k) => k !== "banner" && !seccoes.some((s) => s.key === k));

  /**
   * Tirar uma secção da página. Uma fixa volta pelo "+" sem perder nada (o
   * conteúdo dela vive noutro sítio); um banner com texto pergunta primeiro.
   */
  const tirarDaPagina = (id: string) => {
    const s = seccoes.find((x) => x.id === id);
    if (!s) return;
    const b = s.banner;
    if (s.key === "banner" && b && (b.titulo.trim() || b.texto.trim() || b.imagem)) {
      setTirar(s);
      return;
    }
    void gravar(seccoes.filter((x) => x.id !== id), { imediato: true });
    if (selecionada === id) setSelecionada(null);
    setAnuncio(`${rotuloDe(s)} saiu da página.`);
  };

  /** Uma fixa que faltava entra na posição `em`. */
  const acrescentar = (key: SeccaoInicioKey, em: number) => {
    if (seccoes.some((s) => s.key === key)) return;
    const novas = [...seccoes];
    novas.splice(em, 0, { id: key, key, visivel: true });
    void gravar(novas, { imediato: true });
    setSelecionada(key);
  };

  /** Um banner novo na posição `em`, já escolhido para se escrever. */
  const inserirBanner = (em: number) => {
    if (banners >= BANNERS_MAX) return;
    const id = `banner-${Date.now().toString(36)}`;
    const novas = [...seccoes];
    novas.splice(em, 0, { id, key: "banner", visivel: true, banner: { ...BANNER_VAZIO } });
    void gravar(novas, { imediato: true });
    setSelecionada(id);
  };

  const removerBanner = async (s: SeccaoInicio) => {
    await gravar(seccoes.filter((x) => x.id !== s.id), { imediato: true });
    if (selecionada === s.id) setSelecionada(null);
    mostrarOk("Banner tirado da página.");
  };

  const guardarBanner = async (id: string, banner: Banner) => {
    await gravar(seccoes.map((x) => (x.id === id ? { ...x, banner } : x)), { imediato: true });
    mostrarOk("Banner guardado.");
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Pagina
        tema={site.layout}
        seccoes={seccoes}
        endereco={enderecoDoSite(slug, site.dominio).replace(/^https:\/\//, "")}
        selecionada={selecionada}
        podeInserirBanner={banners < BANNERS_MAX}
        onSelecionar={setSelecionada}
        onMover={mover}
        onInserirBanner={inserirBanner}
        emFalta={emFalta}
        onAcrescentar={acrescentar}
        onTirar={tirarDaPagina}
        onIrAoTema={() => onIr("aspeto")}
      />

      <aside className="lg:sticky lg:top-4 lg:self-start">
        {sel ? (
          sel.key === "banner" ? (
            <EditorDeBanner
              key={sel.id}
              seccao={sel}
              onGuardar={(b) => guardarBanner(sel.id, b)}
              onTirar={() => tirarDaPagina(sel.id)}
              onFechar={() => setSelecionada(null)}
            />
          ) : (
            <FichaDaSeccao seccao={sel} onTirar={() => tirarDaPagina(sel.id)} onIr={onIr} onFechar={() => setSelecionada(null)} />
          )
        ) : (
          <Dica />
        )}
      </aside>

      {/* O que mudou, para quem não vê o desenho a mexer. */}
      <p className="sr-only" aria-live="polite">
        {anuncio}
      </p>

      {tirar && (
        <ConfirmDialog
          title="Tirar este banner?"
          onClose={() => setTirar(null)}
          onConfirm={async () => {
            await removerBanner(tirar);
            setTirar(null);
          }}
        >
          «{tirar.banner?.titulo.trim() || "Banner"}» sai da página de início e o que estava escrito perde-se.
        </ConfirmDialog>
      )}
    </div>
  );
}

function rotuloDe(s: SeccaoInicio): string {
  if (s.key === "banner") return s.banner?.titulo.trim() ? `Banner «${s.banner.titulo.trim()}»` : "Banner";
  return SECCOES_INICIO.find((x) => x.key === s.key)?.rotulo ?? s.key;
}

const NOME_DO_TEMA: Record<Layout, string> = { tribuna: "Tribuna", holofote: "Holofote" };

/* -------------------------------------------------------------------------- */
/* A página desenhada                                                           */
/* -------------------------------------------------------------------------- */

type Arrasto = { id: string; de: number; y0: number; dy: number; altura: number; alvo: number; ativo: boolean };

function Pagina({
  tema,
  seccoes,
  endereco,
  selecionada,
  podeInserirBanner,
  onSelecionar,
  onMover,
  onInserirBanner,
  emFalta,
  onAcrescentar,
  onTirar,
  onIrAoTema,
}: {
  tema: Layout;
  seccoes: SeccaoInicio[];
  endereco: string;
  selecionada: string | null;
  podeInserirBanner: boolean;
  onSelecionar: (id: string) => void;
  onMover: (de: number, para: number) => void;
  onInserirBanner: (em: number) => void;
  /** As fixas que não estão na página. */
  emFalta: SeccaoInicioKey[];
  onAcrescentar: (key: SeccaoInicioKey, em: number) => void;
  onTirar: (id: string) => void;
  onIrAoTema: () => void;
}) {
  const lista = useRef<HTMLDivElement | null>(null);
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  const [menuEm, setMenuEm] = useState<number | null>(null);
  const escuro = tema === "holofote";

  /** Os blocos arrastáveis, pela ordem do ecrã, com o meio de cada um. */
  const meios = () =>
    [...(lista.current?.querySelectorAll<HTMLElement>("[data-bloco]") ?? [])].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.bloco!, meio: r.top + r.height / 2, altura: r.height };
    });

  /** Começa um arrasto a partir do elemento que recebeu o toque (a pega, ou a secção inteira com o rato). */
  const comecar = (e: ReactPointerEvent<HTMLElement>, id: string, de: number) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const altura = meios().find((m) => m.id === id)?.altura ?? 0;
    setArrasto({ id, de, y0: e.clientY, dy: 0, altura: altura + 8, alvo: de, ativo: false });
  };

  /** Com o rato, qualquer ponto da secção serve de pega; os botões ficam de fora. */
  const comecarNaSeccao = (e: ReactPointerEvent<HTMLDivElement>, id: string, de: number) => {
    if (e.pointerType !== "mouse") return;
    if ((e.target as HTMLElement).closest("button,a,input,textarea,select")) return;
    comecar(e, id, de);
  };

  const mexer = (e: ReactPointerEvent<HTMLElement>) => {
    if (!arrasto) return;
    const dy = e.clientY - arrasto.y0;
    if (!arrasto.ativo && Math.abs(dy) < LIMIAR_PX) return;
    // O alvo é quantos blocos (sem o levantado) têm o meio acima do ponteiro.
    const outros = meios().filter((m) => m.id !== arrasto.id);
    const alvo = outros.filter((m) => m.meio < e.clientY).length;
    setArrasto({ ...arrasto, dy, alvo, ativo: true });
  };

  const largar = () => {
    if (!arrasto) return;
    if (arrasto.ativo && arrasto.alvo !== arrasto.de) onMover(arrasto.de, arrasto.alvo);
    else if (!arrasto.ativo) onSelecionar(arrasto.id);
    setArrasto(null);
  };

  const teclas = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      onMover(i, i - 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onMover(i, i + 1);
    }
  };

  /** Quanto cada bloco se desvia para abrir espaço ao que anda a ser arrastado. */
  const desvio = (i: number): number => {
    if (!arrasto?.ativo) return 0;
    const { de, alvo, altura } = arrasto;
    if (i === de) return arrasto.dy;
    if (de < alvo && i > de && i <= alvo) return -altura;
    if (de > alvo && i >= alvo && i < de) return altura;
    return 0;
  };

  const insercao = (indice: number) => (
    <Insercao
      indice={indice}
      aberto={menuEm === indice}
      onAbrir={() => setMenuEm(menuEm === indice ? null : indice)}
      onFechar={() => setMenuEm(null)}
      podeBanner={podeInserirBanner}
      emFalta={emFalta}
      onBanner={onInserirBanner}
      onAcrescentar={onAcrescentar}
    />
  );

  return (
    <div className="rounded-[14px] border border-line bg-sunken/50 p-3 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-meta text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <GripVertical className="size-3.5" strokeWidth={1.75} />
          Pega numa secção e arrasta-a. O + entre duas põe um banner.
        </span>
        <button type="button" className="inline-flex items-center gap-1 font-medium text-signal-ink hover:underline" onClick={onIrAoTema}>
          Tema {NOME_DO_TEMA[tema]}
          <ArrowRight className="size-3" strokeWidth={1.75} />
        </button>
      </div>

      <div className="mx-auto max-w-[600px] overflow-hidden rounded-[12px] border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        {/* A barra do browser: diz "isto é a página", sem precisar de legenda. */}
        <div className="flex items-center gap-2 border-b border-line bg-sunken/60 px-3 py-2">
          <span className="flex gap-1" aria-hidden>
            <i className="size-2 rounded-full bg-line-strong" />
            <i className="size-2 rounded-full bg-line-strong" />
            <i className="size-2 rounded-full bg-line-strong" />
          </span>
          <span className="mx-auto truncate rounded-full bg-surface px-3 py-0.5 text-[11px] text-ink-3">{endereco}</span>
        </div>

        {/* A casca do tema: a Tribuna tem o cabeçalho em cima, o Holofote a barra à esquerda. */}
        <div className={cx("flex", escuro ? "flex-row" : "flex-col")}>
          {escuro ? <BarraHolofote /> : <CabecalhoTribuna />}

          <div ref={lista} className={cx("min-w-0 flex-1", escuro ? "p-2.5" : "p-3")}>
            <Heroi tema={tema} />
            {insercao(0)}
            {seccoes.map((s, i) => {
              const aArrastar = arrasto?.ativo && arrasto.id === s.id;
              const d = desvio(i);
              return (
                <div key={s.id}>
                  <div
                    data-bloco={s.id}
                    style={{ transform: d ? `translateY(${d}px)` : undefined }}
                    onPointerDown={(e) => comecarNaSeccao(e, s.id, i)}
                    onPointerMove={mexer}
                    onPointerUp={largar}
                    onPointerCancel={() => setArrasto(null)}
                    className={cx(
                      "group/bloco relative rounded-[10px] border bg-surface",
                      aArrastar
                        ? "z-10 scale-[1.02] cursor-grabbing border-signal/50 shadow-[0_16px_40px_-10px_rgba(0,0,0,0.35)]"
                        : "cursor-grab transition-[transform,box-shadow,border-color] duration-200 ease-out hover:shadow-[0_6px_18px_-8px_rgba(0,0,0,0.25)] motion-reduce:transition-none",
                      selecionada === s.id && !aArrastar ? "border-signal/50 ring-2 ring-signal/20" : "border-line hover:border-line-strong",
                    )}
                  >
                    <div className="flex items-center gap-1 pl-1 pr-1.5 pt-1">
                      {/* A pega: a única forma de arrastar com o dedo, e um aviso claro de que se arrasta com o rato. */}
                      <button
                        type="button"
                        aria-label={`Arrastar ${rotuloDe(s)}. Setas para cima e para baixo mudam a posição.`}
                        title="Arrastar para mudar a ordem"
                        className={cx(
                          "flex h-9 shrink-0 touch-none items-center gap-1 rounded-[8px] px-1.5 text-ink-4 transition-colors duration-150 group-hover/bloco:bg-sunken group-hover/bloco:text-ink motion-reduce:transition-none",
                          aArrastar ? "cursor-grabbing bg-signal-soft text-signal-ink" : "cursor-grab",
                        )}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          comecar(e, s.id, i);
                        }}
                        onKeyDown={(e) => teclas(e, i)}
                      >
                        <GripVertical className="size-4" strokeWidth={1.75} />
                        <span className="hidden text-[11px] font-medium sm:inline">Arrastar</span>
                      </button>
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate py-1.5 text-left text-meta font-medium text-ink"
                        onClick={() => onSelecionar(s.id)}
                      >
                        {rotuloDe(s)}
                      </button>
                      {/* As setas servem o teclado e quem não quer arrastar. */}
                      <span className="hidden items-center sm:flex">
                        <button type="button" className="ctl-ghost size-8 justify-center px-0" disabled={i === 0} aria-label={`Subir ${rotuloDe(s)}`} onClick={() => onMover(i, i - 1)}>
                          <ChevronUp className="size-3.5" strokeWidth={1.75} />
                        </button>
                        <button
                          type="button"
                          className="ctl-ghost size-8 justify-center px-0"
                          disabled={i === seccoes.length - 1}
                          aria-label={`Descer ${rotuloDe(s)}`}
                          onClick={() => onMover(i, i + 1)}
                        >
                          <ChevronDown className="size-3.5" strokeWidth={1.75} />
                        </button>
                      </span>
                      {/* Tirar da página. Uma fixa volta pelo "+", sem perder nada. */}
                      <button
                        type="button"
                        className="ctl-ghost size-8 justify-center px-0 text-ink-4 hover:text-risk"
                        aria-label={`Tirar ${rotuloDe(s)} da página`}
                        title="Tirar da página"
                        onClick={() => onTirar(s.id)}
                      >
                        <Trash2 className="size-4" strokeWidth={1.75} />
                      </button>
                    </div>
                    <div className="px-2.5 pb-2.5 pt-1">
                      <Miniatura seccao={s} tema={tema} />
                    </div>
                  </div>
                  {insercao(i + 1)}
                </div>
              );
            })}
            <Rodape tema={tema} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A linha entre duas secções, com o "+". A linha só se vê ao passar por cima
 * ou com o foco; o botão tem sempre uma área de toque de 44 px, mesmo que o
 * que se vê seja uma bola pequena. O menu oferece o que não está na página:
 * um banner novo (enquanto couber) e as fixas que o clube tirou.
 */
function Insercao({
  indice,
  aberto,
  onAbrir,
  onFechar,
  podeBanner,
  emFalta,
  onBanner,
  onAcrescentar,
}: {
  indice: number;
  aberto: boolean;
  onAbrir: () => void;
  onFechar: () => void;
  podeBanner: boolean;
  emFalta: SeccaoInicioKey[];
  onBanner: (em: number) => void;
  onAcrescentar: (key: SeccaoInicioKey, em: number) => void;
}) {
  const caixa = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (!caixa.current?.contains(e.target as Node)) onFechar();
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto, onFechar]);

  const nada = !podeBanner && emFalta.length === 0;

  return (
    <div ref={caixa} className="group/ins relative flex h-6 items-center justify-center">
      <span
        aria-hidden
        className={cx(
          "absolute inset-x-6 top-1/2 h-px -translate-y-1/2 bg-signal-line transition-opacity duration-150 motion-reduce:transition-none",
          aberto ? "opacity-100" : "opacity-0 group-hover/ins:opacity-100 group-focus-within/ins:opacity-100",
        )}
      />
      <button
        type="button"
        aria-label={`Acrescentar aqui (posição ${indice + 1})`}
        aria-expanded={aberto}
        disabled={nada}
        onClick={onAbrir}
        className={cx(
          "relative grid size-11 place-items-center rounded-full outline-none disabled:opacity-0",
          "[&>span]:transition-[transform,opacity,background-color] [&>span]:duration-150 motion-reduce:[&>span]:transition-none",
        )}
      >
        <span
          className={cx(
            "grid size-6 place-items-center rounded-full border text-signal-ink",
            aberto
              ? "scale-110 border-signal/50 bg-signal-soft opacity-100"
              : "border-line-strong bg-surface opacity-70 group-hover/ins:border-signal/50 group-hover/ins:bg-signal-soft group-hover/ins:opacity-100 group-focus-within/ins:opacity-100",
          )}
        >
          <Plus className={cx("size-3.5 transition-transform duration-150 motion-reduce:transition-none", aberto && "rotate-45")} strokeWidth={2} />
        </span>
      </button>

      {aberto && (
        <div
          role="menu"
          className="absolute left-1/2 top-full z-20 mt-1 w-64 -translate-x-1/2 overflow-hidden rounded-[10px] border border-line bg-surface p-1 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.25)]"
        >
          {podeBanner && (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-body text-ink hover:bg-sunken"
              onClick={() => {
                onFechar();
                onBanner(indice);
              }}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-signal-soft text-signal-ink">
                <Megaphone className="size-3.5" strokeWidth={1.75} />
              </span>
              <span>
                <span className="block font-medium">Banner novo</span>
                <span className="block text-meta text-ink-3">Uma campanha, um torneio, um apoio.</span>
              </span>
            </button>
          )}
          {!podeBanner && <p className="px-2.5 py-2 text-meta text-ink-3">Já tens {BANNERS_MAX} banners, que é o máximo.</p>}
          {emFalta.length > 0 && (
            <>
              <p className="mt-1 px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-4">Fora da página</p>
              {emFalta.map((key) => {
                const info = SECCOES_INICIO.find((x) => x.key === key)!;
                return (
                  <button
                    key={key}
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-body text-ink hover:bg-sunken"
                    onClick={() => {
                      onFechar();
                      onAcrescentar(key, indice);
                    }}
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-sunken text-ink-3">
                      <Plus className="size-3.5" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{info.rotulo}</span>
                      <span className="block truncate text-meta text-ink-3">{info.descricao}</span>
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* A casca de cada tema                                                         */
/* -------------------------------------------------------------------------- */

/** Peças do esboço: uma linha de texto, uma "fotografia", um botão. A cor do clube só no que o site pinta. */
const Linha = ({ w = "w-full", tom = "bg-line" }: { w?: string; tom?: string }) => <i className={cx("block h-1 rounded", w, tom)} />;
const Foto = ({ className = "" }: { className?: string }) => (
  <i className={cx("block rounded-[5px] bg-[linear-gradient(135deg,var(--color-line)_0%,var(--color-line-strong)_100%)]", className)} />
);
const Botao = ({ claro = false }: { claro?: boolean }) => <i className={cx("block h-2.5 w-9 rounded-full", claro ? "bg-white" : "bg-signal-strong")} />;

/** A Tribuna: a faixa escura com o emblema e a faixa clara com o menu. */
function CabecalhoTribuna() {
  return (
    <div aria-hidden>
      <div className="flex items-center gap-2 bg-ink px-3 py-1.5">
        <i className="size-3.5 rounded-full bg-white/80" />
        <i className="h-1 w-12 rounded bg-white/70" />
        <span className="ml-auto flex gap-2">
          <i className="h-1 w-6 rounded bg-white/35" />
          <i className="h-1 w-6 rounded bg-white/35" />
        </span>
      </div>
      <div className="flex items-center gap-3 border-b border-line px-3 py-2">
        {[CalendarDays, Newspaper, Users, Shield].map((Icone, i) => (
          <span key={i} className="flex items-center gap-1 text-ink-3">
            <Icone className="size-2.5" strokeWidth={1.75} />
            <i className="block h-1 w-5 rounded bg-line-strong" />
          </span>
        ))}
        <span className="ml-auto flex gap-1.5">
          <Ticket className="size-2.5 text-ink-3" strokeWidth={1.75} />
          <ShoppingBag className="size-2.5 text-ink-3" strokeWidth={1.75} />
        </span>
      </div>
    </div>
  );
}

/** O Holofote: a barra lateral fixa, com o emblema em cima e os ícones por baixo. */
function BarraHolofote() {
  return (
    <div aria-hidden className="flex w-9 shrink-0 flex-col items-center gap-3 border-r border-line bg-sunken/60 py-3">
      <i className="size-4 rounded-full bg-ink/80" />
      {[Newspaper, Users, CalendarDays, Shield, Ticket, ShoppingBag].map((Icone, i) => (
        <Icone key={i} className="size-3 text-ink-3" strokeWidth={1.75} />
      ))}
    </div>
  );
}

/** O herói: as três notícias em destaque na Tribuna, o carrossel a toda a largura no Holofote. Não se mexe. */
function Heroi({ tema }: { tema: Layout }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface">
      <p className="flex items-center justify-between px-3 pt-2 text-meta font-medium text-ink-3">
        Notícias em destaque
        <span className="text-[11px] font-normal text-ink-4">fica sempre no topo</span>
      </p>
      {tema === "holofote" ? (
        <div className="p-2.5">
          <div className="relative h-[84px] overflow-hidden rounded-[6px] bg-ink/85">
            <span className="absolute inset-x-3 bottom-3 space-y-1.5">
              <i className="block h-1.5 w-8 rounded bg-signal-strong" />
              <i className="block h-2 w-3/4 rounded bg-white/90" />
              <i className="block h-1 w-1/2 rounded bg-white/50" />
            </span>
            <span className="absolute bottom-3 right-3 flex gap-1">
              <i className="size-1.5 rounded-full bg-white" />
              <i className="size-1.5 rounded-full bg-white/40" />
              <i className="size-1.5 rounded-full bg-white/40" />
            </span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 grid-rows-2 gap-1.5 p-2.5">
          <span className="relative col-span-2 row-span-2 h-[76px] overflow-hidden rounded-[6px] bg-ink/85">
            <i className="absolute left-2 top-2 block h-1.5 w-7 rounded bg-signal-strong" />
            <span className="absolute inset-x-2 bottom-2 space-y-1">
              <i className="block h-1.5 w-4/5 rounded bg-white/90" />
              <i className="block h-1 w-1/2 rounded bg-white/50" />
            </span>
          </span>
          <span className="relative overflow-hidden rounded-[6px] bg-ink/70">
            <i className="absolute inset-x-1.5 bottom-1.5 block h-1 w-3/4 rounded bg-white/80" />
          </span>
          <span className="relative overflow-hidden rounded-[6px] bg-ink/70">
            <i className="absolute inset-x-1.5 bottom-1.5 block h-1 w-2/3 rounded bg-white/80" />
          </span>
        </div>
      )}
    </div>
  );
}

function Rodape({ tema }: { tema: Layout }) {
  const escuro = tema === "tribuna";
  const traco = escuro ? "bg-white/30" : "bg-line-strong";
  return (
    <div className={cx("mt-1 rounded-[10px] px-3 py-3", escuro ? "bg-ink/85" : "border border-line bg-sunken/60")} aria-hidden>
      <div className="grid grid-cols-3 gap-3">
        <span className="space-y-1">
          <i className={cx("block h-1.5 w-12 rounded", escuro ? "bg-white/70" : "bg-ink/60")} />
          <Linha w="w-16" tom={traco} />
          <Linha w="w-10" tom={traco} />
        </span>
        <span className="space-y-1">
          <Linha w="w-10" tom={traco} />
          <Linha w="w-12" tom={traco} />
          <Linha w="w-8" tom={traco} />
        </span>
        <span className="space-y-1">
          <Linha w="w-9" tom={traco} />
          <Linha w="w-11" tom={traco} />
        </span>
      </div>
      <p className={cx("mt-2 text-[10px]", escuro ? "text-white/50" : "text-ink-4")}>Rodapé</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* As miniaturas: cada secção com a forma que tem no tema                       */
/* -------------------------------------------------------------------------- */

function Miniatura({ seccao: s, tema }: { seccao: SeccaoInicio; tema: Layout }) {
  const key: SeccaoInicioKey = s.key;
  const quadrado = tema === "holofote";
  const canto = quadrado ? "rounded-none" : "rounded-[5px]";

  if (key === "jogo") {
    if (quadrado) {
      // A faixa de três colunas: o próximo jogo, os últimos resultados, o cartão do sócio.
      return (
        <div className="grid grid-cols-3 border border-line">
          <div className="space-y-1.5 border-r border-line p-2">
            <i className="block h-1 w-8 rounded bg-signal-line" />
            <span className="flex items-center justify-between">
              <i className="size-4 rounded-full bg-line-strong" />
              <span className="font-mono text-[10px] font-semibold text-ink">15:00</span>
              <i className="size-4 rounded-full bg-line" />
            </span>
          </div>
          <div className="space-y-1.5 border-r border-line p-2">
            <i className="block h-1 w-10 rounded bg-signal-line" />
            <span className="block text-center font-mono text-[11px] font-semibold text-ink-2">2 : 1</span>
            <Linha w="w-3/4" />
          </div>
          <div className="relative bg-ink/85 p-2">
            <span className="absolute inset-x-2 bottom-2 space-y-1">
              <i className="block h-1 w-8 rounded bg-white/50" />
              <i className="block h-1.5 w-12 rounded bg-white/90" />
            </span>
          </div>
        </div>
      );
    }
    return (
      <div className="grid grid-cols-[1.2fr_1fr] gap-1.5">
        <div className="flex items-center gap-2 rounded-[6px] border border-line p-2">
          <i className="size-5 rounded-full bg-line-strong" />
          <span className="flex-1 space-y-1">
            <Linha w="w-10" tom="bg-ink/70" />
            <Linha w="w-16" />
          </span>
          <i className="size-5 rounded-full bg-line" />
          <Botao />
        </div>
        <div className="flex items-center justify-center gap-2 rounded-[6px] bg-sunken p-2">
          <span className="font-mono text-[11px] font-semibold text-ink-2">2 : 1</span>
          <Linha w="w-8" />
        </div>
      </div>
    );
  }

  if (key === "noticias") {
    if (quadrado) {
      // A lista com a foto à esquerda, e o cartaz do jogo ao lado.
      return (
        <div className="grid grid-cols-[1fr_52px] gap-2">
          <div className="divide-y divide-line">
            {[0, 1, 2].map((i) => (
              <span key={i} className="flex gap-2 py-1.5 first:pt-0 last:pb-0">
                <Foto className="h-6 w-10 rounded-none" />
                <span className="flex-1 space-y-1 pt-0.5">
                  <i className="block h-1 w-6 rounded bg-signal-line" />
                  <Linha w="w-5/6" tom="bg-ink/70" />
                  <Linha w="w-1/2" />
                </span>
              </span>
            ))}
          </div>
          <span className="relative bg-ink/85">
            <i className="absolute inset-x-2 top-2 block h-1 w-6 rounded bg-white/60" />
            <i className="absolute inset-x-2 bottom-2 block h-1.5 rounded bg-white/90" />
          </span>
        </div>
      );
    }
    return (
      <div className="grid grid-cols-4 gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="space-y-1">
            <Foto className="h-8" />
            <Linha tom="bg-ink/60" />
            <Linha w="w-2/3" />
          </span>
        ))}
      </div>
    );
  }

  if (key === "equipas") {
    if (quadrado) {
      // O mosaico: uma grande e três pequenas.
      return (
        <div className="grid grid-cols-3 gap-1">
          <span className="relative col-span-3 h-9 bg-ink/80">
            <i className="absolute bottom-1.5 left-2 block h-1.5 w-14 rounded bg-white/90" />
          </span>
          {[0, 1, 2].map((i) => (
            <span key={i} className="relative h-7 bg-ink/70">
              <i className="absolute bottom-1 left-1.5 block h-1 w-8 rounded bg-white/80" />
            </span>
          ))}
        </div>
      );
    }
    return (
      <div className="grid grid-cols-6 gap-1.5">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={cx("relative block h-12 overflow-hidden", canto, i % 3 === 1 ? "bg-ink/80" : "bg-ink/65")}>
            <i className="absolute bottom-1.5 left-1.5 block h-1 w-5 rounded bg-white/80" />
          </span>
        ))}
      </div>
    );
  }

  if (key === "socios") {
    if (quadrado) {
      // No Holofote é uma faixa simples a toda a largura: a frase e o botão.
      return (
        <div className="flex items-center justify-between border border-line bg-sunken/60 px-3 py-2.5">
          <span className="space-y-1">
            <i className="block h-1 w-8 rounded bg-signal-line" />
            <i className="block h-2 w-24 rounded bg-ink/80" />
          </span>
          <Botao />
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 overflow-hidden rounded-[6px] border border-line">
        <span className="space-y-1.5 bg-sunken/60 p-2.5">
          <i className="block h-1 w-8 rounded bg-signal-line" />
          <i className="block h-2 w-20 rounded bg-ink/80" />
          <Linha w="w-24" />
          <span className="block pt-0.5">
            <Botao />
          </span>
        </span>
        <Foto className="rounded-none" />
      </div>
    );
  }

  if (key === "loja") {
    return (
      <div className="grid grid-cols-4 gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="space-y-1">
            <Foto className={cx("h-9", canto)} />
            <Linha w="w-3/4" tom="bg-ink/60" />
            <Linha w="w-6" tom="bg-ink/40" />
          </span>
        ))}
      </div>
    );
  }

  if (key === "patrocinadores") {
    return (
      <div className="grid grid-cols-6 gap-1.5">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <i key={i} className={cx("grid h-6 place-items-center border border-line", canto)}>
            <i className="block h-2 w-5 rounded-sm bg-line-strong" />
          </i>
        ))}
      </div>
    );
  }

  // O banner mostra o que lá está: a imagem, o título, o botão. Vazio, diz-o.
  const b = s.banner ?? BANNER_VAZIO;
  const vazio = !b.titulo.trim() && !b.imagem && !b.texto.trim();
  return (
    <div className={cx("relative h-16 overflow-hidden", canto, vazio ? "border border-dashed border-line-strong bg-sunken/60" : "bg-ink/85")}>
      {b.imagem && <img src={b.imagem} alt="" className="absolute inset-0 size-full object-cover" />}
      {b.imagem && <span className="absolute inset-0 bg-gradient-to-t from-black/75 to-black/10" aria-hidden />}
      <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2">
        {vazio ? (
          <span className="flex items-center gap-1.5 text-meta text-ink-3">
            <Megaphone className="size-3.5" strokeWidth={1.75} />
            Banner por escrever
          </span>
        ) : (
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-semibold text-white">{b.titulo.trim() || "Sem título"}</span>
            {b.texto.trim() && <span className="block truncate text-[10px] text-white/70">{b.texto.trim()}</span>}
          </span>
        )}
        {!vazio && b.botao.trim() && <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-ink">{b.botao.trim()}</span>}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* O lado direito: o que está escolhido                                         */
/* -------------------------------------------------------------------------- */

function Dica() {
  return (
    <div className="rounded-[12px] border border-dashed border-line-strong p-5 text-body leading-relaxed text-ink-3">
      <p className="font-medium text-ink-2">A página, de alto a baixo, no tema que escolheste.</p>
      <ul className="mt-3 space-y-2">
        <li>Pega numa secção (com o rato, em qualquer ponto; com o dedo, pela pega) e arrasta-a para onde a queres.</li>
        <li>O caixote tira-a da página. Uma secção tirada volta pelo +, sem perder nada.</li>
        <li>O + entre duas secções põe ali um banner novo ou uma secção que esteja fora da página.</li>
        <li>Toca numa secção para a ver aqui e editar o que é dela.</li>
      </ul>
    </div>
  );
}

/** Para onde se vai mexer no conteúdo de cada secção fixa. */
const GERIR: Partial<Record<SeccaoInicioKey, { secao: string; rotulo: string }>> = {
  noticias: { secao: "noticias", rotulo: "Gerir as notícias" },
  equipas: { secao: "equipas", rotulo: "Escolher as equipas no site" },
  socios: { secao: "identidade", rotulo: "Mudar a fotografia do clube" },
  loja: { secao: "loja", rotulo: "Gerir a loja" },
  patrocinadores: { secao: "patrocinadores", rotulo: "Gerir os patrocinadores" },
  jogo: { secao: "bilheteira", rotulo: "Bilhetes dos jogos em casa" },
};

function Cabeca({ titulo, onFechar }: { titulo: string; onFechar: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
      <h3 className="truncate text-panel text-ink">{titulo}</h3>
      <button type="button" className="ctl-ghost size-8 justify-center px-0" aria-label="Fechar" onClick={onFechar}>
        <X className="size-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}

function FichaDaSeccao({ seccao, onTirar, onIr, onFechar }: { seccao: SeccaoInicio; onTirar: () => void; onIr: (secao: string) => void; onFechar: () => void }) {
  const info = SECCOES_INICIO.find((x) => x.key === seccao.key);
  const gerir = GERIR[seccao.key];
  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <Cabeca titulo={info?.rotulo ?? seccao.key} onFechar={onFechar} />
      <div className="space-y-4 px-4 py-4">
        <p className="text-body leading-relaxed text-ink-2">{info?.descricao}</p>
        {gerir && (
          <button type="button" className="ctl-outline w-full justify-between" onClick={() => onIr(gerir.secao)}>
            {gerir.rotulo}
            <ArrowRight className="size-4" strokeWidth={1.75} />
          </button>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <span className="text-meta text-ink-3">Volta pelo + entre duas secções, sem perder nada.</span>
          <button type="button" className="ctl-ghost shrink-0 text-risk" onClick={onTirar}>
            <Trash2 className="size-3.5" strokeWidth={1.75} />
            Tirar da página
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * O banner escolhido. O endereço do botão pode ser um caminho do próprio site
 * (`/loja`, `/socios`) ou um `https://...` para fora. Outra coisa qualquer, o
 * servidor deita fora em silêncio: diz-se aqui antes.
 */
function EditorDeBanner({
  seccao,
  onGuardar,
  onTirar,
  onFechar,
}: {
  seccao: SeccaoInicio;
  onGuardar: (b: Banner) => Promise<void>;
  onTirar: () => void;
  onFechar: () => void;
}) {
  const inicial = seccao.banner ?? BANNER_VAZIO;
  const [d, setD] = useState<Banner>(inicial);
  const mudou = JSON.stringify(d) !== JSON.stringify(inicial);
  const [aGravar, setAGravar] = useState(false);

  const campo = (k: Exclude<keyof Banner, "imagem">) => ({
    value: d[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value }),
  });

  const url = d.url.trim();
  const urlValida = url === "" || /^https?:\/\/\S+$/i.test(url) || /^\/[a-z0-9\-/?=&]*$/i.test(url);
  const aparece = d.titulo.trim() !== "" && (d.imagem !== "" || d.texto.trim() !== "");

  const guardar = async () => {
    setAGravar(true);
    try {
      await onGuardar({ ...d, titulo: d.titulo.trim(), texto: d.texto.trim(), botao: d.botao.trim(), url });
    } finally {
      setAGravar(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <Cabeca titulo="Banner" onFechar={onFechar} />
      <div className="space-y-4 px-4 py-4">
        <Campo label="Título">
          <input className={campoClass} placeholder="Torna-te sócio" {...campo("titulo")} />
        </Campo>
        <Campo label="Texto" ajuda="Uma ou duas frases.">
          <textarea className={cx(campoClass, "h-20 py-2.5")} placeholder="Quotas a partir de 5 € por mês." {...campo("texto")} />
        </Campo>
        <CampoDeImagem rotulo="Imagem" valor={d.imagem} onMudar={(imagem) => setD({ ...d, imagem })} max={1600} proporcao="aspect-[21/9]" />
        <Campo label="Texto do botão">
          <input className={campoClass} placeholder="Ser sócio" {...campo("botao")} />
        </Campo>
        <Campo label="Endereço do botão" ajuda="Uma página do site (/socios, /loja) ou um endereço com https://.">
          <input className={cx(campoClass, !urlValida && "border-risk")} placeholder="/socios" {...campo("url")} />
        </Campo>
        {!urlValida && <p className="text-meta text-risk">O endereço tem de começar por / ou por https://.</p>}
        <p className="text-meta text-ink-3">{aparece ? "Com isto o banner aparece no site." : "Sem título e uma imagem ou um texto, o banner não aparece no site."}</p>
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <button type="button" className="ctl-ghost" disabled={!mudou || aGravar} onClick={() => setD(inicial)}>
            Desfazer
          </button>
          <button type="button" className="ctl-primary" disabled={!mudou || !urlValida || aGravar} onClick={() => void guardar()}>
            Guardar
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <span className="text-meta text-ink-3">Tirar apaga o que está escrito.</span>
          <button type="button" className="ctl-ghost shrink-0 text-risk" onClick={onTirar}>
            <Trash2 className="size-3.5" strokeWidth={1.75} />
            Tirar da página
          </button>
        </div>
      </div>
    </div>
  );
}
