import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cx } from "@/components/primitives";
import { Check, ChevronLeft, Download, DragHandle, Plus, Trash2, X } from "@/lib/icons";
import { FORMAT_LABEL, type GameFormat } from "@/lib/training";
import { PitchBoard, type PecaNoCampo } from "./PitchBoard";
import { Camisola, Cartao, CartaoTopo } from "./ui";

/**
 * O desenho do Pré-jogo: o onze no campo, o banco ao lado, o plantel à direita
 * e, por baixo, os objetivos e o plano.
 *
 * Só desenho. Quem sabe do jogo, da sugestão e de gravar é `GamePlan`; aqui
 * chegam as listas já resolvidas e saem os gestos de quem está a montar a
 * equipa.
 */

export type JogadorNaLista = {
  id: string;
  nome: string;
  curto: string;
  numero: number | null;
  foto: string | null;
  posicao: string | null;
  /** Onde está: a sigla da posição se é titular, "banco" ou "fora". */
  onde: { tipo: "campo"; sigla: string } | { tipo: "banco" } | { tipo: "fora" };
  /** "de baixa", "condicionado", "não vai". Nulo quando está tudo bem. */
  aviso: string | null;
  /** Não pode ser escolhido: de baixa ou disse que não vai. */
  indisponivel: boolean;
  marca: "C" | "SC" | null;
  /** Com uma posição escolhida: os motivos da sugestão, ou nulo se não serve. */
  motivos?: string[] | null;
};

export type PreJogoProps = {
  podeEditar: boolean;
  formato: GameFormat;
  formatos: GameFormat[];
  sistema: string;
  sistemas: string[];
  modelos: { id: string; nome: string }[];
  modeloId: string | null;
  pecas: PecaNoCampo[];
  escolhida: string | null;
  /** A lista, já na ordem certa (por sugestão quando há posição escolhida). */
  jogadores: JogadorNaLista[];
  banco: JogadorNaLista[];
  objetivos: { id: string; text: string }[];
  notas: string;
  deConvocatoria: boolean;
  estadoDeGravar: { mexido: boolean; aGuardar: boolean; guardado: boolean; erro: string | null; autor: string | null; temPlano: boolean };
  aExportar: boolean;

  onFormato: (f: GameFormat) => void;
  onSistema: (s: string) => void;
  onModelo: (id: string) => void;
  onSugerir: () => void;
  onEscolher: (slotId: string | null) => void;
  onMover: (slotId: string, x: number, y: number) => void;
  onPor: (athleteId: string, slotId: string) => void;
  onTirar: (slotId: string) => void;
  onBanco: (athleteId: string) => void;
  onSubir: (athleteId: string) => void;
  /** Um jogador largado no banco (vindo do campo ou de fora da ficha). */
  onParaBanco: (athleteId: string) => void;
  /** Um jogador largado na lista: sai da ficha. */
  onParaFora: (athleteId: string) => void;
  onMarca: (athleteId: string, qual: "C" | "SC") => void;
  onObjetivoNovo: (texto: string) => void;
  onObjetivoApagar: (id: string) => void;
  onNotas: (texto: string) => void;
  onGuardar: () => void;
  onExportar: () => void;
};

const seletor =
  "h-9 min-w-0 max-w-[200px] rounded-[10px] border border-line bg-surface px-3 text-meta font-medium text-ink outline-none transition-colors hover:border-line-strong focus:border-ink-3 disabled:opacity-60 max-sm:max-w-none max-sm:flex-1 max-sm:basis-[42%]";

export function PreJogo(p: PreJogoProps) {
  const [objetivo, setObjetivo] = useState("");
  const titulares = p.pecas.filter((x) => x.jogador).length;
  const peca = p.pecas.find((x) => x.id === p.escolhida) ?? null;
  const fora = p.jogadores.filter((j) => j.onde.tipo === "fora").length;
  const g = p.estadoDeGravar;

  /*
   * Arrastar um jogador.
   *
   * Feito à mão, com o ponteiro, e não com o arrastar do browser: esse não
   * funciona no telemóvel, mostra uma cópia desfocada do elemento e não deixa
   * animar nada. Aqui o jogador vira uma ficha que segue o dedo, as posições do
   * campo pulsam a dizer que o recebem, e a que está por baixo cresce.
   *
   * Só começa depois de o ponteiro sair do sítio: um toque continua a ser um
   * toque. No telemóvel pega-se pela fotografia (ou pelo número), para o resto
   * da linha continuar a servir para rolar a lista.
   */
  const [arrasto, setArrasto] = useState<{ id: string; x: number; y: number; alvo: string | null } | null>(null);
  const pegado = useRef<{ id: string; x: number; y: number; ativo: boolean } | null>(null);
  const acabouDeArrastar = useRef(false);
  const porBaixo = (x: number, y: number) => document.elementFromPoint(x, y)?.closest("[data-drop]")?.getAttribute("data-drop") ?? null;

  function pegar(e: ReactPointerEvent, id: string) {
    if (!p.podeEditar || (e.pointerType === "mouse" && e.button !== 0)) return;
    pegado.current = { id, x: e.clientX, y: e.clientY, ativo: false };
    const mover = (ev: PointerEvent) => {
      const i = pegado.current;
      if (!i) return;
      if (!i.ativo && Math.hypot(ev.clientX - i.x, ev.clientY - i.y) < 7) return;
      i.ativo = true;
      ev.preventDefault();
      setArrasto({ id: i.id, x: ev.clientX, y: ev.clientY, alvo: porBaixo(ev.clientX, ev.clientY) });
    };
    const largar = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", largar);
      window.removeEventListener("pointercancel", largar);
      const i = pegado.current;
      pegado.current = null;
      setArrasto(null);
      if (!i?.ativo || ev.type === "pointercancel") return;
      // O clique que vem a seguir ao largar não é um clique.
      acabouDeArrastar.current = true;
      setTimeout(() => (acabouDeArrastar.current = false), 0);
      const alvo = porBaixo(ev.clientX, ev.clientY);
      if (alvo?.startsWith("slot:")) p.onPor(i.id, alvo.slice(5));
      else if (alvo === "banco") p.onParaBanco(i.id);
      else if (alvo === "fora") p.onParaFora(i.id);
    };
    window.addEventListener("pointermove", mover, { passive: false });
    window.addEventListener("pointerup", largar);
    window.addEventListener("pointercancel", largar);
  }

  // Enquanto se arrasta, nada se seleciona e o cursor é o de quem segura.
  useEffect(() => {
    if (!arrasto) return;
    const antes = { s: document.body.style.userSelect, c: document.body.style.cursor };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    return () => {
      document.body.style.userSelect = antes.s;
      document.body.style.cursor = antes.c;
    };
  }, [Boolean(arrasto)]);

  const noAr = arrasto ? (p.jogadores.find((j) => j.id === arrasto.id) ?? p.banco.find((j) => j.id === arrasto.id) ?? null) : null;
  const alvoSlot = arrasto?.alvo?.startsWith("slot:") ? arrasto.alvo.slice(5) : null;

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_372px]">
        {/* ------------------------------------------------------------ o onze */}
        <Cartao>
          <CartaoTopo
            titulo="Equipa inicial"
            apoio={
              <>
                <span className="font-medium text-ink tabular">
                  {titulares} de {p.pecas.length}
                </span>{" "}
                titulares · {p.banco.length} {p.banco.length === 1 ? "suplente" : "suplentes"}
              </>
            }
          >
            {p.formatos.length > 1 && (
              <select aria-label="Formato" className={seletor} value={p.formato} disabled={!p.podeEditar} onChange={(e) => p.onFormato(e.target.value as GameFormat)}>
                {p.formatos.map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABEL[f]}
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label="Sistema"
              className={seletor}
              value={p.sistemas.includes(p.sistema) ? p.sistema : "__livre"}
              disabled={!p.podeEditar}
              onChange={(e) => e.target.value !== "__livre" && p.onSistema(e.target.value)}
            >
              {!p.sistemas.includes(p.sistema) && <option value="__livre">{p.sistema || "Sistema"}</option>}
              {p.sistemas.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {p.podeEditar && p.modelos.length > 0 && (
              <select aria-label="Importar modelo de jogo" className={seletor} value={p.modeloId ?? ""} onChange={(e) => e.target.value && p.onModelo(e.target.value)}>
                <option value="">Modelo de jogo…</option>
                {p.modelos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            )}
            {p.podeEditar && (
              <button type="button" onClick={p.onSugerir} className="ctl-primary h-9 max-sm:w-full max-sm:justify-center">
                Sugerir equipa
              </button>
            )}
          </CartaoTopo>

          <div className="grid gap-x-5 gap-y-4 px-5 pb-5 md:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
            <div className="mx-auto w-full max-w-[430px]">
              <PitchBoard
                format={p.formato}
                pecas={p.pecas}
                escolhida={p.escolhida}
                onEscolher={p.podeEditar ? p.onEscolher : undefined}
                onMover={p.podeEditar ? p.onMover : undefined}
                aReceber={Boolean(arrasto)}
                alvo={alvoSlot}
                className="rounded-[18px]"
              />
              {p.podeEditar && <p className="mt-2.5 text-center text-[11.5px] text-ink-4">Arrasta um jogador para uma posição, ou toca na posição para escolher quem lá joga.</p>}
            </div>

            {/* O banco, por ordem. Também é onde se larga um jogador para o pôr a suplente. */}
            <div
              data-drop="banco"
              className={cx(
                "-m-2 min-w-0 rounded-[18px] p-2 transition-[background-color,box-shadow] duration-150",
                arrasto && "shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]",
                arrasto?.alvo === "banco" && "bg-signal-soft/70 shadow-[inset_0_0_0_2px_var(--color-signal-strong)]",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="text-meta font-semibold text-ink">Suplentes</h4>
                <span className="text-[11.5px] text-ink-4">pela ordem em que entram</span>
              </div>
              {p.banco.length === 0 ? (
                <p className="mt-2 rounded-[14px] border border-dashed border-line-strong px-3 py-5 text-center text-meta text-ink-3">
                  {arrasto ? "Larga aqui para o pôr no banco." : "Ainda ninguém no banco. Arrasta jogadores para aqui."}
                </p>
              ) : (
                <ol className="mt-2 space-y-1.5">
                  {p.banco.map((j, i) => (
                    <li
                      key={j.id}
                      onPointerDown={(e) => pegar(e, j.id)}
                      className={cx("mc-entra flex items-center gap-2.5 rounded-[14px] bg-sunken/60 py-1.5 pr-1.5 pl-2 select-none", p.podeEditar && "cursor-grab hover:bg-sunken", arrasto?.id === j.id && "opacity-35")}
                    >
                      <span className="w-4 text-center text-[11px] font-medium text-ink-4 tabular">{i + 1}</span>
                      <span className="touch-none">
                        <Camisola numero={j.numero} foto={j.foto} tom="tinta" tamanho={30} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-body font-medium text-ink">{j.curto}</span>
                          {j.marca && <Bracadeira marca={j.marca} />}
                        </span>
                        {j.posicao && <span className="block truncate text-[11px] text-ink-3">{j.posicao}</span>}
                      </span>
                      {p.podeEditar && (
                        <>
                          {i > 0 && (
                            <BotaoPequeno rotulo={`Subir ${j.nome} na ordem`} onClick={() => p.onSubir(j.id)}>
                              <ChevronLeft className="size-3.5 rotate-90" strokeWidth={1.75} />
                            </BotaoPequeno>
                          )}
                          <BotaoPequeno rotulo={`Tirar ${j.nome} do banco`} onClick={() => p.onBanco(j.id)}>
                            <X className="size-3.5" strokeWidth={1.75} />
                          </BotaoPequeno>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-3 text-[11.5px] text-ink-4">
                {fora === 0 ? "Todos os jogadores estão na ficha." : `${fora} ${fora === 1 ? "jogador fica" : "jogadores ficam"} fora da ficha.`}
              </p>
            </div>
          </div>
        </Cartao>

        {/* ------------------------------------------------------------ o plantel */}
        <Cartao className="xl:sticky xl:top-3">
          {peca ? (
            <header className="flex items-center gap-3 px-5 pt-4 pb-3">
              <span className="flex h-9 min-w-9 items-center justify-center rounded-[10px] bg-ink px-2 text-[12px] font-bold text-surface">{peca.label}</span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] leading-tight font-semibold tracking-[-0.01em] text-ink">Quem joga aqui?</h3>
                <p className="mt-0.5 text-meta text-ink-3">Ordenado pela sugestão</p>
              </div>
              {peca.jogador && (
                <button type="button" className="ctl-ghost h-8" onClick={() => p.onTirar(peca.id)}>
                  Tirar
                </button>
              )}
              <BotaoPequeno rotulo="Fechar" onClick={() => p.onEscolher(null)}>
                <X className="size-4" strokeWidth={1.75} />
              </BotaoPequeno>
            </header>
          ) : (
            <CartaoTopo titulo={p.deConvocatoria ? "Convocados" : "Plantel"} apoio={`${p.jogadores.length} jogadores`} />
          )}

          {p.jogadores.length === 0 ? (
            <p className="px-5 pb-8 text-center text-meta text-ink-3">Esta equipa ainda não tem atletas para pôr no campo.</p>
          ) : (
            <ul
              data-drop="fora"
              className={cx(
                "rounded-b-[20px] px-2 pb-2 transition-colors duration-150 xl:max-h-[640px] xl:overflow-y-auto",
                arrasto?.alvo === "fora" && noAr && noAr.onde.tipo !== "fora" && "bg-sunken/70",
              )}
            >
              {p.jogadores.map((j, i) => {
                const servir = !peca || (j.motivos !== null && j.motivos !== undefined);
                const sugerido = Boolean(peca) && i === 0 && servir && j.onde.tipo !== "campo";
                // Sem posição escolhida a lista vem por posição: cada grupo leva o seu título.
                const grupo = !peca && (i === 0 || p.jogadores[i - 1].posicao !== j.posicao) ? (j.posicao ?? "Sem posição") : null;
                return (
                  <Fragment key={j.id}>
                  {grupo && (
                    <li aria-hidden className={cx("flex items-baseline justify-between px-3 pb-1 text-[11.5px] font-semibold text-ink-3", i > 0 && "pt-3")}>
                      {grupo}
                      <span className="font-normal text-ink-4 tabular">{p.jogadores.filter((x) => x.posicao === j.posicao).length}</span>
                    </li>
                  )}
                  <li
                    onPointerDown={(e) => !j.indisponivel && pegar(e, j.id)}
                    className={cx(
                      "group/linha flex items-center gap-1 rounded-[14px] pr-1.5 select-none",
                      p.podeEditar && !j.indisponivel && "cursor-grab",
                      sugerido && "bg-signal-soft/60",
                      j.indisponivel && "opacity-50",
                      arrasto?.id === j.id && "opacity-35",
                    )}
                  >
                    <button
                      type="button"
                      aria-disabled={!p.podeEditar || !peca || !servir}
                      onClick={() => peca && servir && p.podeEditar && !acabouDeArrastar.current && p.onPor(j.id, peca.id)}
                      className={cx(
                        "flex min-w-0 flex-1 items-center gap-3 rounded-[14px] px-3 py-2 text-left transition-colors",
                        // A mão aberta diz que a linha se arrasta; com uma posição escolhida, a linha é um botão.
                        p.podeEditar && !j.indisponivel && (peca && servir ? "cursor-pointer hover:bg-sunken/70" : "cursor-grab hover:bg-sunken/50"),
                      )}
                    >
                      {/* No telemóvel pega-se por aqui: o resto da linha rola a lista. */}
                      <span className="touch-none">
                        <Camisola numero={j.numero} foto={j.foto} tom={j.onde.tipo === "campo" ? "clube" : j.onde.tipo === "banco" ? "tinta" : "neutro"} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-body font-medium text-ink">{j.nome}</span>
                          {j.marca && <Bracadeira marca={j.marca} />}
                        </span>
                        <span className="block truncate text-[11.5px] text-ink-3">
                          {peca
                            ? servir
                              ? (j.motivos ?? []).join(" · ") || j.posicao || "sem dados"
                              : (j.aviso ?? "não é para esta posição")
                            : [j.onde.tipo === "campo" ? `titular · ${j.onde.sigla}` : j.onde.tipo === "banco" ? "suplente" : "fora da ficha", j.aviso].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {sugerido && <span className="shrink-0 rounded-full bg-signal-strong px-2 py-0.5 text-[10.5px] font-semibold text-signal-on">Sugerido</span>}
                      {/* A pega: aparece ao passar o rato, a dizer que o jogador se arrasta. */}
                      {p.podeEditar && !peca && !j.indisponivel && (
                        <DragHandle aria-hidden className="size-4 shrink-0 text-ink-4 opacity-0 transition-opacity duration-150 group-hover/linha:opacity-100" strokeWidth={1.75} />
                      )}
                    </button>

                    {p.podeEditar && !peca && !j.indisponivel && (
                      <span className="flex shrink-0 items-center gap-1">
                        {j.onde.tipo !== "fora" && (
                          <>
                            <Alternar on={j.marca === "C"} onClick={() => p.onMarca(j.id, "C")} titulo="Capitão">
                              C
                            </Alternar>
                            <Alternar on={j.marca === "SC"} onClick={() => p.onMarca(j.id, "SC")} titulo="Sub-capitão">
                              SC
                            </Alternar>
                          </>
                        )}
                        {j.onde.tipo !== "campo" && (
                          <Alternar on={j.onde.tipo === "banco"} onClick={() => p.onBanco(j.id)} titulo={j.onde.tipo === "banco" ? "Tirar do banco" : "Pôr no banco"} largo>
                            Banco
                          </Alternar>
                        )}
                      </span>
                    )}
                  </li>
                  </Fragment>
                );
              })}
            </ul>
          )}
        </Cartao>
      </div>

      {/* ------------------------------------------------------------ o plano */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Cartao>
          <CartaoTopo titulo="Objetivos do jogo" apoio="Voltam na análise, para dizer se foram cumpridos." />
          <div className="px-5 pb-5">
            {p.objetivos.length > 0 && (
              <ol className="mb-3 space-y-1.5">
                {p.objetivos.map((o, i) => (
                  <li key={o.id} className="flex items-center gap-3 rounded-[14px] bg-sunken/60 py-2 pr-1.5 pl-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-[11px] font-semibold text-ink-2 tabular">{i + 1}</span>
                    <span className="min-w-0 flex-1 text-body text-ink">{o.text}</span>
                    {p.podeEditar && (
                      <BotaoPequeno rotulo={`Apagar o objetivo ${i + 1}`} onClick={() => p.onObjetivoApagar(o.id)}>
                        <Trash2 className="size-3.5" strokeWidth={1.75} />
                      </BotaoPequeno>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {p.podeEditar && p.objetivos.length < 10 ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!objetivo.trim()) return;
                  p.onObjetivoNovo(objetivo.trim());
                  setObjetivo("");
                }}
              >
                <input
                  value={objetivo}
                  onChange={(e) => setObjetivo(e.target.value)}
                  maxLength={200}
                  placeholder="Sair a jogar pelo corredor direito"
                  aria-label="Novo objetivo"
                  className="h-10 min-w-0 flex-1 rounded-[12px] border border-line bg-surface px-3 text-body text-ink outline-none placeholder:text-ink-4 focus:border-ink-3"
                />
                <button type="submit" className="ctl-outline h-10" disabled={!objetivo.trim()}>
                  <Plus className="size-3.5" strokeWidth={2} />
                  Juntar
                </button>
              </form>
            ) : (
              p.objetivos.length === 0 && <p className="text-meta text-ink-3">Sem objetivos definidos.</p>
            )}
          </div>
        </Cartao>

        <Cartao>
          <CartaoTopo titulo="Plano para este adversário" apoio="O que muda neste jogo: com bola, sem bola, bolas paradas." />
          <div className="px-5 pb-5">
            <textarea
              value={p.notas}
              onChange={(e) => p.onNotas(e.target.value)}
              readOnly={!p.podeEditar}
              maxLength={4000}
              rows={5}
              placeholder={"Com bola: sair curto, procurar o lateral esquerdo.\nSem bola: bloco médio, pressionar o 6 deles.\nBolas paradas: cantos ao primeiro poste."}
              aria-label="Plano para este adversário"
              className="w-full resize-y rounded-[12px] border border-line bg-surface px-3 py-2.5 text-body leading-relaxed text-ink outline-none placeholder:text-ink-4 focus:border-ink-3"
            />
          </div>
        </Cartao>
      </div>

      {/* O jogador no ar: uma ficha que segue o ponteiro. */}
      {arrasto && noAr && (
        <div className="pointer-events-none fixed z-[70]" style={{ left: arrasto.x, top: arrasto.y }}>
          <div className="mc-fantasma flex items-center gap-2 rounded-full bg-surface py-1.5 pr-3.5 pl-1.5 shadow-[0_18px_40px_-12px_rgb(26_25_23/0.5),0_2px_6px_rgb(26_25_23/0.12)] ring-1 ring-line">
            <Camisola numero={noAr.numero} foto={noAr.foto} tom="clube" tamanho={34} />
            <span className="text-body font-semibold whitespace-nowrap text-ink">{noAr.curto}</span>
            {arrasto.alvo && (
              <span className="rounded-full bg-ink px-2 py-0.5 text-[10.5px] font-semibold text-surface">
                {arrasto.alvo === "banco" ? "banco" : arrasto.alvo === "fora" ? "fora da ficha" : (p.pecas.find((x) => x.id === alvoSlot)?.label ?? "")}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ gravar */}
      <div className="sticky bottom-3 z-10 max-md:bottom-[calc(72px+env(safe-area-inset-bottom))] flex flex-wrap items-center gap-2 rounded-[16px] border border-line bg-surface/95 px-4 py-2.5 shadow-[0_10px_30px_-14px_rgb(26_25_23/0.35)] backdrop-blur">
        <Recado>
          {g.erro ? (
            <span className="text-risk" role="alert">
              {g.erro}
            </span>
          ) : g.guardado && !g.mexido ? (
            <span className="inline-flex items-center gap-1 text-ok">
              <Check className="size-3.5" strokeWidth={2} /> Plano guardado
            </span>
          ) : g.mexido ? (
            "Há alterações por guardar."
          ) : g.temPlano ? (
            `Guardado${g.autor ? ` por ${g.autor}` : ""}.`
          ) : (
            "Ainda sem plano guardado."
          )}
        </Recado>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={p.onExportar} disabled={p.aExportar || titulares === 0} title={titulares === 0 ? "Põe jogadores no campo para exportar a ficha" : undefined} className="ctl-outline h-9">
            <Download className="size-3.5" strokeWidth={1.75} />
            {p.aExportar ? "A preparar…" : "Exportar ficha de jogo"}
          </button>
          {p.podeEditar && (
            <button type="button" onClick={p.onGuardar} disabled={g.aGuardar || !g.mexido} className="ctl-primary h-9">
              {g.aGuardar ? "A guardar…" : "Guardar plano"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Recado({ children }: { children: ReactNode }) {
  return <span className="text-meta text-ink-3">{children}</span>;
}

function Bracadeira({ marca }: { marca: "C" | "SC" }) {
  return <span className="shrink-0 rounded-full bg-[#f4c542] px-1.5 text-[10px] leading-[16px] font-bold text-[#14130f]">{marca}</span>;
}

function BotaoPequeno({ rotulo, onClick, children }: { rotulo: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={rotulo} title={rotulo} onClick={onClick} className="flex size-8 shrink-0 items-center justify-center rounded-[10px] text-ink-4 transition-colors hover:bg-surface hover:text-ink">
      {children}
    </button>
  );
}

function Alternar({ on, onClick, titulo, largo, children }: { on: boolean; onClick: () => void; titulo: string; largo?: boolean; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={titulo}
      aria-label={titulo}
      className={cx(
        "flex h-7 items-center justify-center rounded-full border text-[10.5px] font-semibold transition-colors",
        largo ? "px-2.5" : "min-w-7 px-1.5",
        on ? "border-ink bg-ink text-surface" : "border-line text-ink-4 hover:border-line-strong hover:text-ink-2",
      )}
    >
      {children}
    </button>
  );
}
