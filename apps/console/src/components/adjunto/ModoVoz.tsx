import { useEffect, useRef, useState } from "react";
import { AudioLines, Mic, X } from "@/lib/icons";
import { cx } from "@/components/primitives";
import { mostrarErro, textoDoErro } from "@/lib/avisos";
import { enviar, ligarModoVoz, NOME_DO_ADJUNTO, transcrever, useAdjunto, vozDaMensagem, type Contexto } from "@/lib/adjunto";
import { blobParaBase64, dizer, gravarAteSilencio, motivoDoMicrofone, ouvirUmaVez, RECONHECIMENTO_INDISPONIVEL, suportaReconhecimento, type Escuta } from "@/lib/voz";

/**
 * A conversa por voz, mãos livres.
 *
 * ## O ciclo
 *
 *   ouvir → (a pessoa cala-se) → enviar → pensar → dizer a resposta → ouvir
 *
 * A pessoa fala; quando pára, a frase segue sozinha. O Adjunto responde por
 * escrito (a conversa fica igual à de sempre, com os cartões) e a resposta é
 * dita em voz alta; quando acaba, volta a ouvir. Tocar no botão grande a meio
 * de uma resposta corta-a e passa logo a ouvir. "Terminar" sai do modo.
 *
 * ## O que não muda
 *
 * Confirmar continua a ser um toque no cartão. Dizer "confirma" não grava
 * nada: a resposta explica que está pronto para confirmar no ecrã.
 *
 * ## Dois caminhos para ouvir
 *
 * O reconhecimento do browser quando existe (acaba sozinho ao silêncio); senão
 * grava-se até ao silêncio e a API transcreve. Ver `lib/voz.ts`.
 */

type Fase = "ouvir" | "pensar" | "dizer" | "pausa";

const MAX_SILENCIOS_SEGUIDOS = 2;

export function ModoVoz({ contexto, compacto }: { contexto?: Contexto; compacto?: boolean }) {
  const { aResponder, passo, voz } = useAdjunto();
  const [fase, setFase] = useState<Fase>("ouvir");
  const [parcial, setParcial] = useState("");
  const [ultimaResposta, setUltimaResposta] = useState("");
  const [nivel, setNivel] = useState(0);
  const vivo = useRef(true);
  const escuta = useRef<Escuta | null>(null);
  const gravacao = useRef<{ parar(): Promise<Blob | null>; cancelar(): void; fim: Promise<Blob | null> } | null>(null);
  const altifalante = useRef<{ parar(): void } | null>(null);
  const silencios = useRef(0);
  const volta = useRef(0);

  const terminar = () => {
    vivo.current = false;
    escuta.current?.cancelar();
    gravacao.current?.cancelar();
    altifalante.current?.parar();
    ligarModoVoz(false);
  };

  // Uma volta do ciclo. `volta` evita que uma escuta antiga, a acabar tarde, continue o ciclo duas vezes.
  const ouvir = async () => {
    if (!vivo.current) return;
    const esta = ++volta.current;
    setFase("ouvir");
    setParcial("");

    const seguir = (texto: string) => {
      if (!vivo.current || esta !== volta.current) return;
      if (!texto.trim()) {
        silencios.current++;
        if (silencios.current >= MAX_SILENCIOS_SEGUIDOS) {
          setFase("pausa");
          return;
        }
        void ouvir();
        return;
      }
      silencios.current = 0;
      void responder(texto.trim());
    };

    /*
     * Com a API a transcrever, grava-se até ao silêncio e transcreve-se lá: é
     * muito mais certo em português de Portugal do que o reconhecimento do
     * browser, que perdia frases. O do browser fica para quando não há API.
     */
    if (!voz && suportaReconhecimento()) {
      escuta.current = ouvirUmaVez({
        onParcial: (t) => esta === volta.current && setParcial(t),
        onFim: (t) => {
          escuta.current = null;
          seguir(t);
        },
        onErro: (motivo) => {
          escuta.current = null;
          // O browser desistiu do reconhecimento: a volta seguinte já grava e transcreve pela API.
          if (motivo === RECONHECIMENTO_INDISPONIVEL) {
            void ouvir();
            return;
          }
          mostrarErro(motivo);
          setFase("pausa");
        },
      });
      if (!escuta.current) setFase("pausa");
      return;
    }

    try {
      const g = await gravarAteSilencio({ onNivel: (n) => esta === volta.current && setNivel(n) });
      gravacao.current = g;
      const blob = await g.fim;
      gravacao.current = null;
      if (!vivo.current || esta !== volta.current) return;
      if (!blob) {
        seguir("");
        return;
      }
      setFase("pensar");
      const texto = await transcrever(await blobParaBase64(blob), blob.type);
      setParcial(texto);
      seguir(texto);
    } catch (e) {
      mostrarErro(motivoDoMicrofone(e));
      setFase("pausa");
    }
  };

  const responder = async (texto: string) => {
    setFase("pensar");
    // `voz`: o servidor sabe que a resposta vai ser dita, e pergunta um campo de cada vez.
    const { messageId, texto: resposta } = await enviar({ texto, contexto: { ...contexto, voz: true } });
    if (!vivo.current) return;
    setUltimaResposta(resposta);
    if (!messageId) {
      void ouvir();
      return;
    }
    try {
      setFase("dizer");
      const url = await vozDaMensagem(messageId);
      if (!vivo.current) return;
      const som = dizer(url);
      altifalante.current = som;
      await som.fim;
      URL.revokeObjectURL(url);
      altifalante.current = null;
    } catch (e) {
      // Sem voz, a resposta está escrita na conversa: o ciclo segue na mesma.
      mostrarErro(textoDoErro(e));
    }
    if (vivo.current) void ouvir();
  };

  useEffect(() => {
    vivo.current = true;
    void ouvir();
    return () => {
      vivo.current = false;
      escuta.current?.cancelar();
      gravacao.current?.cancelar();
      altifalante.current?.parar();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tocar no botão grande: a dizer corta e ouve; em pausa volta a ouvir; a ouvir manda já o que há.
  const tocar = () => {
    if (fase === "dizer") {
      altifalante.current?.parar();
      return;
    }
    if (fase === "pausa") {
      silencios.current = 0;
      void ouvir();
      return;
    }
    if (fase === "ouvir") {
      if (escuta.current) escuta.current.parar();
      else if (gravacao.current) void gravacao.current.parar();
    }
  };

  const estado =
    fase === "ouvir" ? "A ouvir" : fase === "pensar" ? (aResponder && passo ? `${NOME_DO_ADJUNTO} está ${passo}` : "A pensar") : fase === "dizer" ? "A falar" : "Em pausa. Toca para continuar.";

  return (
    <div className={cx("flex flex-col items-center gap-3", compacto ? "px-4 pt-3 pb-4" : "mx-auto w-full max-w-[760px] px-4 pt-3 pb-5 md:px-6")}>
      <div className={cx("min-h-[1.25rem] text-center text-ink-2", compacto ? "text-meta" : "text-body")}>
        {parcial && fase !== "dizer" ? <span className="text-ink">{parcial}</span> : fase === "dizer" && ultimaResposta ? <span className="line-clamp-2 text-ink-3">{ultimaResposta}</span> : null}
      </div>

      <button
        type="button"
        onClick={tocar}
        aria-label={fase === "dizer" ? "Interromper e falar" : fase === "pausa" ? "Continuar a ouvir" : "Enviar o que disse"}
        className={cx(
          "relative inline-flex items-center justify-center rounded-full transition-colors duration-[120ms]",
          compacto ? "size-16" : "size-20",
          fase === "ouvir" && "bg-signal-strong text-signal-on",
          fase === "pensar" && "bg-sunken text-ink-3",
          fase === "dizer" && "bg-ink text-surface",
          fase === "pausa" && "bg-surface text-ink-2 ring-1 ring-line-strong",
        )}
        style={fase === "ouvir" ? { boxShadow: `0 0 0 ${6 + Math.min(18, nivel * 160)}px color-mix(in srgb, var(--color-signal) 18%, transparent)` } : undefined}
      >
        {fase === "ouvir" && <span className="adjunto-anel absolute inset-0 rounded-full ring-2 ring-signal" aria-hidden />}
        {fase === "dizer" ? <AudioLines className={compacto ? "size-7" : "size-8"} strokeWidth={1.8} /> : <Mic className={compacto ? "size-7" : "size-8"} strokeWidth={1.8} />}
      </button>

      <div className={cx("text-center text-ink-3", compacto ? "text-[11px]" : "text-meta")}>{estado}</div>

      <button type="button" onClick={terminar} className="ctl-ghost h-8">
        <X className="size-4" strokeWidth={1.75} /> Terminar
      </button>
    </div>
  );
}
