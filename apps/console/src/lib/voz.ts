/**
 * Falar para o Adjunto.
 *
 * ## Dois caminhos
 *
 * O primeiro é o reconhecimento de voz do próprio browser (Web Speech API):
 * não custa nada, mostra o texto enquanto a pessoa fala, e existe no Chrome,
 * no Edge e no Safari. O segundo é gravar o áudio e mandá-lo à API, que o
 * transcreve: serve quando o browser não tem o primeiro (Firefox, alguns
 * Android) ou quando o reconhecimento falha a meio.
 *
 * Nos dois, o texto vai para a caixa de escrever e a pessoa vê-o antes de
 * enviar. Um nome mal percebido corrige-se ali; e o servidor confronta cada
 * nome com o plantel, por isso "Tomas" encontra "Tomás".
 */

type Reconhecedor = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

function construtor(): (new () => Reconhecedor) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Reconhecedor; webkitSpeechRecognition?: new () => Reconhecedor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * O reconhecimento do browser deixou de servir nesta sessão.
 *
 * O Chrome anuncia o reconhecimento mas, em alguns computadores e redes,
 * responde `network` a cada tentativa: o serviço por trás não está
 * disponível, e insistir só dava o mesmo erro. À primeira falha dessas
 * desiste-se dele e passa-se a gravar e transcrever pela API, até fechar o
 * separador.
 */
let reconhecimentoIndisponivel = false;

/** Os erros em que o browser não vai reconhecer nada, faça-se o que se fizer. */
const ERROS_DE_SERVICO = new Set(["network", "service-not-allowed", "language-not-supported"]);

export const RECONHECIMENTO_INDISPONIVEL = "O reconhecimento de voz do browser não está disponível; a passar para a transcrição pela API.";

export function suportaReconhecimento(): boolean {
  return !reconhecimentoIndisponivel && construtor() !== null;
}

function desistirDoReconhecimento(): void {
  reconhecimentoIndisponivel = true;
}

export function suportaGravacao(): boolean {
  return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export type Escuta = {
  /** Pára e devolve o que ficou reconhecido até aqui. */
  parar(): void;
  /** Deita fora o que estava a ser reconhecido. */
  cancelar(): void;
};

/**
 * Ouvir pelo browser. `onParcial` recebe o texto todo até agora (o já fixo
 * mais o que ainda está a ser percebido); `onFim` o texto final quando a
 * escuta acaba, por `parar()` ou por silêncio.
 */
export function ouvir(opcoes: { onParcial: (texto: string) => void; onFim: (texto: string) => void; onErro: (motivo: string) => void }): Escuta | null {
  const Ctor = construtor();
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = "pt-PT";
  r.interimResults = true;
  r.continuous = true;
  r.maxAlternatives = 1;

  /*
   * O Chrome fecha a escuta sozinho ao fim de uns segundos de pausa, mesmo em
   * modo contínuo: quem parava para pensar a meio da frase perdia o resto.
   * Enquanto a pessoa não carregar em "Parar", a escuta volta a abrir-se, e o
   * que já estava percebido (`fixo`) fica. `daSessao` é o que esta abertura já
   * fixou, porque cada reabertura recomeça a lista de resultados do zero.
   */
  let fixo = "";
  let daSessao = "";
  let cancelado = false;
  let pararPedido = false;
  r.onresult = (e) => {
    let parcial = "";
    let fixoDaSessao = "";
    for (let i = 0; i < e.results.length; i++) {
      const res = e.results[i];
      const t = res[0]?.transcript ?? "";
      if (res.isFinal) fixoDaSessao = `${fixoDaSessao} ${t}`.trim();
      else parcial += t;
    }
    daSessao = fixoDaSessao;
    opcoes.onParcial(`${fixo} ${daSessao} ${parcial}`.replace(/\s+/g, " ").trim());
  };
  r.onerror = (e) => {
    if (cancelado) return;
    if (ERROS_DE_SERVICO.has(e.error)) {
      cancelado = true;
      desistirDoReconhecimento();
      opcoes.onErro(RECONHECIMENTO_INDISPONIVEL);
      return;
    }
    const motivos: Record<string, string> = {
      "not-allowed": "O browser não deixou usar o microfone. Dá permissão nas definições do site.",
      "audio-capture": "Não encontrei nenhum microfone.",
      "no-speech": "",
      aborted: "",
    };
    const texto = motivos[e.error];
    if (texto === undefined) opcoes.onErro("O reconhecimento de voz falhou.");
    else if (texto) opcoes.onErro(texto);
  };
  r.onend = () => {
    if (cancelado) return;
    fixo = `${fixo} ${daSessao}`.replace(/\s+/g, " ").trim();
    daSessao = "";
    if (!pararPedido) {
      // Fechou por pausa, não por "Parar": abre outra vez e continua a ouvir.
      try {
        r.start();
        return;
      } catch {
        /* não reabriu: acaba aqui com o que há */
      }
    }
    opcoes.onFim(fixo);
  };
  try {
    r.start();
  } catch {
    opcoes.onErro("Não consegui ligar o microfone.");
    return null;
  }
  return {
    parar: () => {
      pararPedido = true;
      r.stop();
    },
    cancelar: () => {
      cancelado = true;
      r.abort();
    },
  };
}

export type Gravacao = {
  parar(): Promise<Blob | null>;
  cancelar(): void;
  /** O microfone aberto, para quem quiser medir o som (ver `gravarAteSilencio`). */
  stream: MediaStream;
};

/** Gravar para mandar à API, quando o browser não reconhece voz sozinho. */
export async function gravar(): Promise<Gravacao> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  const gravador = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const pedacos: Blob[] = [];
  gravador.ondataavailable = (e) => {
    if (e.data.size > 0) pedacos.push(e.data);
  };
  gravador.start(250);

  const fecharMicrofone = () => stream.getTracks().forEach((t) => t.stop());
  return {
    stream,
    parar: () =>
      new Promise<Blob | null>((resolve) => {
        gravador.onstop = () => {
          fecharMicrofone();
          resolve(pedacos.length ? new Blob(pedacos, { type: gravador.mimeType || mime || "audio/webm" }) : null);
        };
        gravador.stop();
      }),
    cancelar: () => {
      gravador.onstop = null;
      try {
        gravador.stop();
      } catch {
        /* já parado */
      }
      fecharMicrofone();
    },
  };
}

export function motivoDoMicrofone(err: unknown): string {
  const nome = (err as { name?: string })?.name ?? "";
  if (nome === "NotAllowedError" || nome === "SecurityError") return "O browser não deixou usar o microfone. Dá permissão nas definições do site.";
  if (nome === "NotFoundError" || nome === "OverconstrainedError") return "Não encontrei nenhum microfone.";
  if (nome === "NotReadableError") return "O microfone está a ser usado por outra aplicação.";
  return "Não consegui ligar o microfone.";
}

export function blobParaBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Não consegui ler o áudio"));
    r.readAsDataURL(blob);
  });
}

/* -------------------------------------------------------------------------- */
/* Conversa por voz (mãos livres)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Ouvir uma frase: acaba sozinho quando a pessoa se cala.
 *
 * É o reconhecimento do browser sem `continuous`: a primeira pausa longa
 * fecha a escuta e `onFim` traz o texto. Sem browser com reconhecimento,
 * devolve `null` e o modo de voz grava até ao silêncio (`gravarAteSilencio`).
 */
export function ouvirUmaVez(opcoes: { onParcial: (texto: string) => void; onFim: (texto: string) => void; onErro: (motivo: string) => void }): Escuta | null {
  const Ctor = construtor();
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = "pt-PT";
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  let texto = "";
  let cancelado = false;
  r.onresult = (e) => {
    let parcial = "";
    let fixo = "";
    for (let i = 0; i < e.results.length; i++) {
      const res = e.results[i];
      const t = res[0]?.transcript ?? "";
      if (res.isFinal) fixo = `${fixo} ${t}`.trim();
      else parcial += t;
    }
    texto = `${fixo} ${parcial}`.trim();
    opcoes.onParcial(texto);
  };
  r.onerror = (e) => {
    if (cancelado) return;
    // Silêncio ou cancelamento não são erros: o ciclo volta a ouvir.
    if (e.error === "no-speech" || e.error === "aborted") return;
    if (ERROS_DE_SERVICO.has(e.error)) {
      cancelado = true;
      desistirDoReconhecimento();
      opcoes.onErro(RECONHECIMENTO_INDISPONIVEL);
      return;
    }
    const motivos: Record<string, string> = {
      "not-allowed": "O browser não deixou usar o microfone. Dá permissão nas definições do site.",
      "audio-capture": "Não encontrei nenhum microfone.",
    };
    opcoes.onErro(motivos[e.error] ?? "O reconhecimento de voz falhou.");
  };
  r.onend = () => {
    if (!cancelado) opcoes.onFim(texto.trim());
  };
  try {
    r.start();
  } catch {
    opcoes.onErro("Não consegui ligar o microfone.");
    return null;
  }
  return {
    parar: () => r.stop(),
    cancelar: () => {
      cancelado = true;
      r.abort();
    },
  };
}

/**
 * Gravar até ao silêncio, para quem não tem reconhecimento no browser.
 *
 * Mede o volume com um `AnalyserNode`: depois de ouvir fala, 1,4 s abaixo do
 * limiar fecham a gravação. Sem fala nenhuma em 8 s, devolve nulo e o ciclo
 * decide se volta a ouvir.
 */
export async function gravarAteSilencio(opcoes: { onNivel?: (nivel: number) => void }): Promise<{ parar(): Promise<Blob | null>; cancelar(): void; fim: Promise<Blob | null> }> {
  const gravacao = await gravar();
  // O mesmo microfone da gravação: um segundo pedido abria outro stream e outra pergunta de permissão.
  const ctx = new AudioContext();
  const fonte = ctx.createMediaStreamSource(gravacao.stream);
  const analisador = ctx.createAnalyser();
  analisador.fftSize = 1024;
  fonte.connect(analisador);
  const dados = new Uint8Array(analisador.frequencyBinCount);

  const LIMIAR = 0.035;
  const SILENCIO_MS = 1400;
  const SEM_FALA_MS = 8000;
  let falou = false;
  let ultimoSom = performance.now();
  const inicio = performance.now();
  let terminado = false;

  // Só o medidor: o microfone fecha-o a gravação, ao parar ou cancelar.
  const fecharMedidor = () => {
    void ctx.close().catch(() => undefined);
  };

  const fim = new Promise<Blob | null>((resolve) => {
    const tick = () => {
      if (terminado) return;
      analisador.getByteTimeDomainData(dados);
      let soma = 0;
      for (const v of dados) {
        const x = (v - 128) / 128;
        soma += x * x;
      }
      const nivel = Math.sqrt(soma / dados.length);
      opcoes.onNivel?.(nivel);
      const agora = performance.now();
      if (nivel > LIMIAR) {
        falou = true;
        ultimoSom = agora;
      }
      if (falou && agora - ultimoSom > SILENCIO_MS) {
        terminado = true;
        fecharMedidor();
        void gravacao.parar().then(resolve);
        return;
      }
      if (!falou && agora - inicio > SEM_FALA_MS) {
        terminado = true;
        fecharMedidor();
        gravacao.cancelar();
        resolve(null);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  return {
    fim,
    parar: () => {
      if (terminado) return fim;
      terminado = true;
      fecharMedidor();
      return gravacao.parar();
    },
    cancelar: () => {
      terminado = true;
      fecharMedidor();
      gravacao.cancelar();
    },
  };
}

/* ---- Dizer ----------------------------------------------------------------- */

let altifalante: HTMLAudioElement | null = null;

/**
 * Preparar o altifalante **dentro de um toque**.
 *
 * O iOS só deixa tocar som a seguir a um gesto da pessoa. A resposta do
 * Adjunto chega segundos depois, fora do gesto; se o elemento de áudio nascer
 * e tocar (em silêncio) no próprio toque que liga o modo de voz, fica
 * desbloqueado para o resto da conversa.
 */
export function prepararAltifalante(): void {
  if (altifalante) return;
  const a = new Audio();
  a.preload = "auto";
  // Um WAV de 44 bytes, vazio: só para o iOS registar que já tocámos.
  a.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
  void a.play().catch(() => undefined);
  altifalante = a;
}

/** Toca um áudio e resolve quando acaba. `parar` corta a meio. */
export function dizer(url: string): { fim: Promise<void>; parar(): void } {
  const a = altifalante ?? new Audio();
  altifalante = a;
  a.pause();
  a.src = url;
  let resolver: () => void = () => undefined;
  const fim = new Promise<void>((resolve) => {
    resolver = resolve;
    a.onended = () => resolve();
    a.onerror = () => resolve();
  });
  void a.play().catch(() => resolver());
  return {
    fim,
    parar: () => {
      a.pause();
      a.currentTime = 0;
      resolver();
    },
  };
}
