/**
 * A câmara do leitor, e quem lê o QR nela.
 *
 * ## Dois leitores
 *
 * O `BarcodeDetector` do browser primeiro: no Android é o leitor do sistema,
 * rápido e sem peso nenhum no pacote. O Safari do iPhone não o tem, e aí entra
 * o `jsqr`, carregado só nesse caso (um `import()` à parte, para os outros não
 * o descarregarem).
 */

type Detector = (video: HTMLVideoElement) => Promise<string | null>;

/* O `BarcodeDetector` ainda não está nos tipos do TypeScript. */
type BarcodeDetectorLike = { detect(fonte: CanvasImageSource): Promise<{ rawValue: string }[]> };
type BarcodeDetectorCtor = {
  new (opcoes: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

async function detectorNativo(): Promise<Detector | null> {
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formatos = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
    if (!formatos.includes("qr_code")) return null;
    const d = new Ctor({ formats: ["qr_code"] });
    return async (video) => {
      const r = await d.detect(video);
      return r[0]?.rawValue ?? null;
    };
  } catch {
    return null;
  }
}

/**
 * O `jsqr` lê uma imagem reduzida.
 *
 * Um fotograma de 1920 px no telemóvel de um segurança demora o suficiente a
 * analisar para a leitura parecer presa. Um bilhete mostrado à câmara ocupa
 * boa parte da imagem, e 640 px chegam para o ler.
 */
const LARGURA_JSQR = 640;

async function detectorJsqr(): Promise<Detector> {
  const { default: jsQR } = await import("jsqr");
  const tela = document.createElement("canvas");
  const ctx = tela.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    if (!ctx || !video.videoWidth) return null;
    const escala = Math.min(1, LARGURA_JSQR / video.videoWidth);
    const w = Math.round(video.videoWidth * escala);
    const h = Math.round(video.videoHeight * escala);
    if (tela.width !== w) tela.width = w;
    if (tela.height !== h) tela.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    return jsQR(img.data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
  };
}

let detector: Promise<Detector> | null = null;

/** O leitor, escolhido uma vez por página. */
export function obterDetector(): Promise<Detector> {
  detector ??= detectorNativo().then((d) => d ?? detectorJsqr());
  return detector;
}

/**
 * Abre uma câmara: a escolhida, ou a de trás.
 *
 * `ideal` e não `exact` no `facingMode`: num portátil só há a da frente, e
 * `exact` recusava-a em vez de a usar.
 */
export function abrirCamara(deviceId: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
}

/**
 * As câmaras do telemóvel.
 *
 * Só depois de haver autorização é que os nomes e os ids vêm preenchidos; antes
 * disso a lista vem com entradas vazias. Por isso pergunta-se depois de abrir.
 */
export async function listarCamaras(): Promise<MediaDeviceInfo[]> {
  try {
    const todas = await navigator.mediaDevices.enumerateDevices();
    return todas.filter((d) => d.kind === "videoinput" && d.deviceId);
  } catch {
    return [];
  }
}

/** Uma frase para quando a câmara não abre, pelo motivo que o browser deu. */
export function motivoDaCamara(erro: unknown): string {
  const nome = (erro as { name?: string } | null)?.name;
  if (nome === "NotAllowedError" || nome === "SecurityError") {
    return "Sem autorização para usar a câmara. Autoriza nas definições do browser, ou escreve o código à mão.";
  }
  if (nome === "NotFoundError" || nome === "OverconstrainedError") return "Não foi encontrada nenhuma câmara. Escreve o código à mão.";
  if (nome === "NotReadableError") return "A câmara está a ser usada por outra aplicação. Fecha-a e tenta outra vez.";
  return "Não foi possível abrir a câmara. Escreve o código à mão.";
}

/* -------------------------------------------------------------------------- */
/* Som e vibração                                                               */
/* -------------------------------------------------------------------------- */

let audio: AudioContext | null = null;

/**
 * O som só toca se o contexto nascer de um toque.
 *
 * O iPhone recusa áudio que não comece num gesto da pessoa. Chama-se isto no
 * botão de entrar com o PIN (e em qualquer toque no leitor), e a partir daí o
 * contexto fica aberto para os bips de cada leitura.
 */
export function prepararSom(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audio ??= new Ctor();
    if (audio.state === "suspended") void audio.resume().catch(() => undefined);
  } catch {
    audio = null;
  }
}

function tom(freq: number, inicio: number, duracao: number, forma: OscillatorType): void {
  if (!audio) return;
  const t = audio.currentTime + inicio;
  const osc = audio.createOscillator();
  const vol = audio.createGain();
  osc.type = forma;
  osc.frequency.value = freq;
  vol.gain.setValueAtTime(0.0001, t);
  vol.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
  vol.gain.exponentialRampToValueAtTime(0.0001, t + duracao);
  osc.connect(vol).connect(audio.destination);
  osc.start(t);
  osc.stop(t + duracao + 0.02);
}

/** Aceite: dois bips curtos a subir. Recusado: um zumbido grave, mais comprido. */
export function avisar(aceite: boolean): void {
  try {
    if (aceite) {
      tom(880, 0, 0.12, "sine");
      tom(1320, 0.13, 0.16, "sine");
    } else {
      tom(196, 0, 0.45, "square");
    }
  } catch {
    /* sem som, fica a cor e a vibração */
  }
  try {
    navigator.vibrate?.(aceite ? 80 : [180, 90, 180]);
  } catch {
    /* o iPhone não vibra pelo browser */
  }
}
