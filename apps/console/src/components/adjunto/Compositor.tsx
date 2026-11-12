import { useEffect, useRef, useState } from "react";
import { ArrowUp, AudioLines, ClipboardCheck, FileSpreadsheet, HeartPulse, Megaphone, Mic, Paperclip, Search, Square } from "@/lib/icons";
import { cx } from "@/components/primitives";
import { mostrarErro, textoDoErro } from "@/lib/avisos";
import { definirRascunho, enviar, enviarFicheiro, ligarModoVoz, transcrever, useAdjunto, type Acao, type Contexto } from "@/lib/adjunto";
import { blobParaBase64, gravar, motivoDoMicrofone, ouvir, prepararAltifalante, RECONHECIMENTO_INDISPONIVEL, suportaGravacao, suportaReconhecimento, type Escuta, type Gravacao } from "@/lib/voz";
import { ModoVoz } from "./ModoVoz";

export type Sugestao = { texto: string; acao?: Acao };

/**
 * A caixa de falar com o Adjunto: escrever, ditar, anexar, enviar.
 *
 * ## A voz
 *
 * Carregar no microfone começa a gravar, e carregar outra vez pára. O áudio
 * vai à API transcrever e o texto entra na caixa; a pessoa vê o que ficou e
 * envia, ou corrige um nome antes. Sem a API, usa-se o reconhecimento do
 * browser, que escreve enquanto se fala.
 *
 * ## As sugestões
 *
 * Por cima da caixa, uma linha de frases prontas da página onde se está
 * ("Marcar as presenças do treino de hoje"). Carregar numa envia-a logo, já
 * com a ação decidida, sem passar pelo classificador.
 */
export function Compositor({
  contexto,
  sugestoes = [],
  compacto,
  autoFocus,
  centro,
}: {
  contexto?: Contexto;
  sugestoes?: Sugestao[];
  compacto?: boolean;
  autoFocus?: boolean;
  /** O ecrã vazio da página: as sugestões vão para o meio (`SugestoesEmCartoes`) e a caixa fica maior. */
  centro?: boolean;
}) {
  const { aResponder, rascunho, voz, modoVoz } = useAdjunto();
  const [texto, setTexto] = useState("");
  const [aOuvir, setAOuvir] = useState(false);
  const [aTranscrever, setATranscrever] = useState(false);
  /** Quando começou a gravação para a API (o contador da faixa "A gravar"). Nulo sem gravação. */
  const [inicioDaGravacao, setInicioDaGravacao] = useState<number | null>(null);
  const [, tique] = useState(0);
  useEffect(() => {
    if (!inicioDaGravacao) return;
    const t = setInterval(() => tique((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [inicioDaGravacao]);
  const escuta = useRef<Escuta | null>(null);
  const gravacao = useRef<Gravacao | null>(null);
  const textoAntesDaVoz = useRef("");
  const area = useRef<HTMLTextAreaElement>(null);
  const ficheiro = useRef<HTMLInputElement>(null);

  // Um rascunho vindo de fora (uma sugestão escolhida na página) entra na caixa.
  useEffect(() => {
    if (rascunho) {
      setTexto(rascunho);
      definirRascunho("");
      area.current?.focus();
    }
  }, [rascunho]);

  // A caixa cresce com o texto, até quatro linhas.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, compacto ? 96 : 140)}px`;
  }, [texto, compacto]);

  useEffect(() => () => {
    escuta.current?.cancelar();
    gravacao.current?.cancelar();
  }, []);

  const podeFalar = suportaReconhecimento() || (voz && suportaGravacao());

  const mandar = async (t: string, acao?: Acao) => {
    const limpo = t.trim();
    if (!limpo || aResponder || aTranscrever || inicioDaGravacao) return;
    setTexto("");
    pararVoz(true);
    await enviar({ texto: limpo, contexto, acao });
  };

  /*
   * ## O ditado: grava-se tudo, e a transcrição é a da API
   *
   * O reconhecimento do browser é rápido mas fraco em português de Portugal e
   * perdia frases. Quando a API transcreve (`voz`), a voz é **gravada inteira**
   * enquanto se fala (a caixa mostra "A gravar 0:07"), e ao carregar em "Parar"
   * vai a `gpt-transcribe`; o texto entra na caixa de uma vez. Enquanto
   * transcreve, Enter não envia, para não seguir uma frase a meio.
   *
   * Sem a API, é só o browser (que volta a ouvir sozinho depois de uma pausa,
   * até se carregar em "Parar").
   */
  const pararVoz = (semTranscrever = false) => {
    if (escuta.current) {
      if (semTranscrever) escuta.current.cancelar();
      else escuta.current.parar();
      escuta.current = null;
    }
    setInicioDaGravacao(null);
    if (gravacao.current) {
      const g = gravacao.current;
      gravacao.current = null;
      if (semTranscrever) g.cancelar();
      else {
        setATranscrever(true);
        const antes = textoAntesDaVoz.current;
        // Meio segundo a mais: quem carrega em "Parar" ainda está a acabar a última palavra.
        void new Promise((r) => setTimeout(r, 500))
          .then(() => g.parar())
          .then(async (blob) => {
            if (!blob) return;
            const t = await transcrever(await blobParaBase64(blob), blob.type);
            // A transcrição da API substitui a pré-visualização do browser.
            if (t) setTexto(`${antes} ${t}`.trim());
          })
          .catch((e) => mostrarErro(textoDoErro(e)))
          .finally(() => setATranscrever(false));
      }
    }
    setAOuvir(false);
  };

  const comecarVoz = async () => {
    if (aOuvir) {
      pararVoz();
      return;
    }
    textoAntesDaVoz.current = texto;
    const comApi = voz && suportaGravacao();

    /*
     * Com a API: só a gravação, sem o reconhecimento do browser ao lado. A
     * pré-visualização dele era o que a pessoa via enquanto falava, fraca e
     * cheia de falhas, e parecia que o ditado não apanhava tudo; e um resultado
     * dele a chegar tarde ainda apagava a transcrição boa. Agora a caixa mostra
     * que está a gravar, e o texto aparece uma vez, já certo, ao parar.
     */
    if (comApi) {
      try {
        gravacao.current = await gravar();
        setInicioDaGravacao(Date.now());
        setAOuvir(true);
      } catch (e) {
        mostrarErro(motivoDoMicrofone(e));
      }
      return;
    }

    // Sem API: o reconhecimento do browser faz o ditado todo.
    if (suportaReconhecimento()) {
      const e = ouvir({
        onParcial: (t) => setTexto(`${textoAntesDaVoz.current} ${t}`.trim()),
        onFim: (t) => {
          setTexto(`${textoAntesDaVoz.current} ${t}`.trim());
          escuta.current = null;
          setAOuvir(false);
        },
        onErro: (motivo) => {
          escuta.current = null;
          setAOuvir(false);
          mostrarErro(motivo === RECONHECIMENTO_INDISPONIVEL ? "Este browser não reconhece voz e a transcrição pela API não está disponível." : motivo);
        },
      });
      if (e) escuta.current = e;
    }

    if (escuta.current) setAOuvir(true);
    else mostrarErro("Este browser não reconhece voz e a transcrição pela API não está disponível.");
  };

  const anexar = async (f: File | undefined) => {
    if (!f) return;
    try {
      await enviarFicheiro(f, contexto);
    } catch (e) {
      mostrarErro(textoDoErro(e));
    } finally {
      if (ficheiro.current) ficheiro.current.value = "";
    }
  };

  // Em conversa por voz, a caixa dá lugar ao botão grande. Ver `ModoVoz`.
  if (modoVoz) return <ModoVoz contexto={contexto} compacto={compacto} />;

  return (
    <div className={cx("flex flex-col gap-2", compacto ? "px-3 pt-2 pb-3" : "mx-auto w-full max-w-[760px] px-4 pb-4 md:px-6")}>
      {sugestoes.length > 0 && !aResponder && !centro && (
        <div className="scroll-x-clean flex gap-1.5 overflow-x-auto pb-0.5">
          {sugestoes.map((s) => (
            <button
              key={s.texto}
              type="button"
              onClick={() => void mandar(s.texto, s.acao)}
              className="ctl-outline h-8 shrink-0 rounded-full px-3 text-meta font-medium whitespace-nowrap"
            >
              {s.texto}
            </button>
          ))}
        </div>
      )}

      <div
        className={cx(
          "flex flex-col gap-1 border bg-surface transition-colors",
          centro ? "rounded-[16px] px-4 pt-3.5 pb-2 shadow-[0_1px_2px_rgba(26,25,23,0.04),0_8px_24px_rgba(26,25,23,0.06)]" : "rounded-[12px] px-3 pt-2 pb-1.5",
          aOuvir ? "border-signal-strong" : "border-line-strong focus-within:border-ink-4",
        )}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void anexar(e.dataTransfer.files[0]);
        }}
      >
        <label className="block">
          <span className="sr-only">Mensagem para o Assistente IA</span>
          <textarea
            ref={area}
            value={texto}
            autoFocus={autoFocus}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void mandar(texto);
              }
            }}
            rows={centro ? 2 : 1}
            readOnly={aTranscrever || !!inicioDaGravacao}
            placeholder={inicioDaGravacao ? "Fala à vontade. Carrega em Parar quando acabares." : aOuvir ? "A ouvir…" : aTranscrever ? "A transcrever…" : compacto ? "Escreve, fala ou larga um ficheiro" : centro ? "Ex.: no treino de hoje faltaram o Pedro e o Rui" : "Escreve, fala ou larga aqui um ficheiro"}
            className={cx("w-full resize-none border-0 bg-transparent p-0 leading-[1.45] text-ink outline-none placeholder:text-ink-4", centro ? "min-h-[48px] text-[15px]" : "text-body")}
          />
        </label>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => ficheiro.current?.click()} aria-label="Anexar ficheiro" title="Anexar um Excel ou CSV" className="ctl-ghost size-9 justify-center px-0">
            <Paperclip className="size-[18px]" strokeWidth={1.75} />
          </button>
          <input ref={ficheiro} type="file" accept=".xlsx,.xls,.xlsm,.csv,.tsv,.ods,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="hidden" onChange={(e) => void anexar(e.target.files?.[0])} />
          <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-meta text-ink-3" aria-live="polite">
            {inicioDaGravacao ? (
              <>
                <span className="size-2 shrink-0 animate-pulse rounded-full bg-risk" aria-hidden />
                <span className="tabular-nums">A gravar {tempoDe(Date.now() - inicioDaGravacao)}</span>
              </>
            ) : aTranscrever ? (
              <span>A passar a texto…</span>
            ) : null}
          </div>
          {podeFalar && voz && (
            <button
              type="button"
              onClick={() => {
                // Dentro do toque, para o iOS deixar tocar a resposta depois.
                prepararAltifalante();
                pararVoz(true);
                ligarModoVoz(true);
              }}
              aria-label="Conversa por voz"
              title="Conversa por voz: falas, ele responde em voz alta"
              className="ctl-ghost size-9 justify-center px-0"
            >
              <AudioLines className="size-[18px]" strokeWidth={1.75} />
            </button>
          )}
          {podeFalar && (
            <button
              type="button"
              onClick={() => void comecarVoz()}
              disabled={aTranscrever}
              aria-label={aOuvir ? "Parar de ouvir" : "Falar"}
              aria-pressed={aOuvir}
              className={cx("inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-meta font-semibold transition-colors disabled:opacity-50", aOuvir ? "bg-risk text-white" : "bg-signal-soft text-signal-ink hover:brightness-95")}
            >
              {aOuvir ? <Square className="size-4" strokeWidth={2} fill="currentColor" /> : <Mic className="size-4" strokeWidth={1.9} />}
              {aOuvir ? "Parar" : "Falar"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void mandar(texto)}
            disabled={!texto.trim() || aResponder || aTranscrever || !!inicioDaGravacao}
            aria-label="Enviar"
            className="inline-flex size-9 items-center justify-center rounded-full bg-ink text-surface transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:bg-ink-4"
          >
            <ArrowUp className="size-[18px]" strokeWidth={2} />
          </button>
        </div>
      </div>
      {!compacto && (
        <div className={cx("text-[11px] text-ink-4", centro && "text-center")}>As respostas são geradas por IA. Nada é gravado sem confirmares.</div>
      )}
    </div>
  );
}

/**
 * As sugestões em cartões, para o meio do ecrã vazio da página. Carregar num
 * envia a frase logo, já com a ação decidida.
 */
export function SugestoesEmCartoes({ sugestoes, contexto }: { sugestoes: Sugestao[]; contexto?: Contexto }) {
  const { aResponder } = useAdjunto();
  if (sugestoes.length === 0) return null;
  return (
    <div className="grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
      {sugestoes.map((s) => {
        const Icone = iconeDa(s);
        return (
          <button
            key={s.texto}
            type="button"
            disabled={aResponder}
            onClick={() => void enviar({ texto: s.texto, contexto, acao: s.acao })}
            className="group flex items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3.5 text-left transition-colors duration-[120ms] hover:border-line-strong hover:bg-sunken/40 disabled:opacity-60"
          >
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-sunken text-ink-2 transition-colors group-hover:bg-signal-soft group-hover:text-signal-ink">
              <Icone className="size-4" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 text-body leading-[1.4] text-ink">{s.texto}</span>
          </button>
        );
      })}
    </div>
  );
}

/** "0:07", "1:23": o tempo da gravação. */
function tempoDe(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** O ícone de cada sugestão, pela ação que ela leva. */
function iconeDa(s: Sugestao) {
  if (!s.acao) return FileSpreadsheet;
  if (s.acao === "presencas") return ClipboardCheck;
  if (s.acao === "lesao") return HeartPulse;
  if (s.acao.startsWith("convocatoria")) return Megaphone;
  return Search;
}
