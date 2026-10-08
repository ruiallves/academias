import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelHead, cx } from "@/components/primitives";
import { Loader2, Pause, Play } from "@/lib/icons";
import {
  chooseKit,
  lerPosicoes,
  liveSegments,
  setCalibration,
  videoTime,
  videoUrl,
  type AnalysisDetail as Detail,
  type LiveSegment,
} from "@/lib/ai";
import {
  erroMaximo,
  geometriaPlausivel,
  homografia,
  inverter,
  linhasDoCampo,
  paraCampo,
  pontosDoCampo,
  quaseEmLinha,
  type Landmark,
} from "@/lib/homografia";

/**
 * O jogo com a IA por cima — o analista ao vivo.
 *
 * ## O que isto é
 *
 * O vídeo a correr, com as caixas do tracking desenhadas em cima e um painel ao
 * lado a dizer o que a IA vê **por equipa**: quem é nosso e quem é deles (pela
 * cor do equipamento, com o treinador a dizer qual é a nossa), a bola, a posse
 * com a cobertura de quando a bola foi vista, e onde cada equipa jogou.
 * Enquanto a detecção corre, a consola vai buscar os troços já processados de
 * três em três segundos.
 *
 * ## Duas fontes, e a honestidade de cada uma
 *
 * **Ao vivo** (`AILiveSegment`), cada número é uma pessoa que a IA está a
 * seguir — estável enquanto não a perder de vista; quem sai do enquadramento
 * volta com número novo. **No fim**, o ficheiro de posições traz a numeração
 * final e os nomes vêm dos tracks e das identidades. Em ambas, "nossa" e
 * "deles" só existem depois de o treinador escolher a cor.
 *
 * ## Sem vídeo
 *
 * O ficheiro apaga-se depois de processado — ficam os dados. Sem vídeo, o
 * mesmo palco desenha as posições sobre um fundo escuro, com o seu relógio.
 */

/** `mx`/`my`: onde está no campo, em metros (pelos pés) — só com o campo calibrado. */
type Box = { id: number; x1: number; y1: number; x2: number; y2: number; g: number; mx?: number | null; my?: number | null };
type Frame = { ts: number; boxes: Box[]; ball: [number, number] | null; ballM?: [number, number] | null; detected?: number };
type Side = "ours" | "theirs" | "other" | "unknown";
type Palette = Partial<Record<"A" | "B", [number, number, number]>>;

/** Quanto um frame pode estar longe do relógio e ainda contar. 5 FPS = 200 ms entre frames. */
const FRAME_TOLERANCE_MS = 320;
/** A sondagem dos troços enquanto a detecção corre. */
const POLL_MS = 3000;
/** Quanto antes da fronteira da IA é que o vídeo pára à espera dela. */
const FOLLOW_MARGIN_MS = 1200;
/**
 * Seguir a IA é acompanhá-la, não só não a ultrapassar.
 *
 * A detecção corre acima do tempo real; um vídeo a 1× fica para trás e, ao
 * fim de dez minutos, estava três minutos atrás da fronteira. A partir de
 * `CATCHUP_MS` de atraso o vídeo acelera (até `CATCHUP_RATE`); a partir de
 * `JUMP_MS` salta para perto da fronteira — ninguém quer ver a 2× durante
 * meia hora para apanhar o que já foi.
 */
const CATCHUP_MS = 6000;
const CATCHUP_RATE = 1.75;
const JUMP_MS = 90_000;
/** Onde o vídeo se põe quando salta para a IA: um pouco atrás da fronteira. */
const BEHIND_FRONTIER_MS = 6000;
/** Pontos mínimos para calibrar: com 4 a homografia encaixa sempre e o erro não mede nada. */
const MIN_PONTOS = 5;
/** A posse: a bola é de quem a tem a menos de tantas alturas de corpo; sem bola vista, a última posse vale tantos ms. */
const POSSESSION_REACH = 1.6;
const POSSESSION_MEMORY_MS = 2000;

const COLOR: Record<Side | "A" | "B", string> = {
  ours: "#22c55e",
  theirs: "#f8fafc",
  other: "#facc15",
  unknown: "#94a3b8",
  A: "#38bdf8",
  B: "#fb923c",
};

export default function LiveViewer({ detail, onChanged }: { detail: Detail; onChanged: () => void }) {
  const video = detail.videos[0];
  const detectJobs = detail.jobs.filter((j) => j.kind === "detect_track");
  const detectando = detectJobs.some((j) => ["PENDING", "CLAIMED", "RUNNING"].includes(j.status));
  const detectou = detectJobs.some((j) => j.status === "DONE") && detail.tracks.length > 0;

  /* ---- os dados ---------------------------------------------------------- */

  const [frames, setFrames] = useState<Frame[]>([]);
  const [fonte, setFonte] = useState<"live" | "final" | null>(null);
  const [processing, setProcessing] = useState(detectando);
  const [frontierMs, setFrontierMs] = useState(0);
  const [stats, setStats] = useState<NonNullable<LiveSegment["data"]["stats"]>>({});
  const [videoSize, setVideoSize] = useState<[number, number]>([video?.width ?? 0, video?.height ?? 0]);
  const [palette, setPalette] = useState<Palette>({});
  const lastIndex = useRef(-1);

  // Ao vivo: os troços, aos poucos, enquanto a detecção corre.
  useEffect(() => {
    if (detectou || fonte === "final") return;
    let parado = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const puxar = async () => {
      // Várias voltas seguidas quando há muito por trás (a página acabou de abrir).
      for (let volta = 0; volta < 12 && !parado; volta++) {
        let res: Awaited<ReturnType<typeof liveSegments>>;
        try {
          res = await liveSegments(detail.id, lastIndex.current);
        } catch {
          break;
        }
        if (parado) return;
        if (res.segments.length > 0) {
          const novos: Frame[] = [];
          let w = 0, h = 0;
          for (const s of res.segments) {
            lastIndex.current = Math.max(lastIndex.current, s.index);
            if (s.data.video?.[0] && s.data.video?.[1]) [w, h] = s.data.video;
            for (const [ts, caixas, bola, detectadas] of s.data.frames) {
              novos.push({
                ts,
                boxes: caixas.map((c) => ({
                  id: c[0] ?? 0, x1: c[1] ?? 0, y1: c[2] ?? 0, x2: c[3] ?? 0, y2: c[4] ?? 0, g: c[6] ?? 0,
                  mx: c[7] ?? null, my: c[8] ?? null,
                })),
                ball: bola && bola.length >= 2 && bola[0] != null && bola[1] != null ? [bola[0], bola[1]] : null,
                ballM: bola && bola[3] != null && bola[4] != null ? [bola[3], bola[4]] : null,
                detected: detectadas,
              });
            }
          }
          const ultimo = res.segments[res.segments.length - 1];
          setFrames((prev) => prev.concat(novos).sort((a, b) => a.ts - b.ts));
          setFrontierMs((f) => Math.max(f, ultimo.toMs));
          if (ultimo.data.stats) setStats(ultimo.data.stats);
          if (ultimo.data.teams && Object.keys(ultimo.data.teams).length) setPalette(ultimo.data.teams as Palette);
          if (w && h) setVideoSize((v) => (v[0] === w && v[1] === h ? v : [w, h]));
          setFonte("live");
        }
        setProcessing(res.processing);
        if (!res.more) break;
      }
      if (!parado) timer = setTimeout(puxar, POLL_MS);
    };
    void puxar();

    return () => {
      parado = true;
      if (timer) clearTimeout(timer);
    };
    // `detectando` entra para a sondagem recomeçar quando um job novo aparece.
  }, [detail.id, detectou, fonte, detectando]);

  // No fim: o ficheiro de posições, uma vez, com a numeração final.
  useEffect(() => {
    if (!detectou || fonte === "final") return;
    let parado = false;
    lerPosicoes(detail.id)
      .then((pos) => {
        if (parado || !pos) return;
        const porTs = new Map<number, Frame>();
        const frameDe = (ts: number) => {
          let f = porTs.get(ts);
          if (!f) porTs.set(ts, (f = { ts, boxes: [], ball: null }));
          return f;
        };
        const grupos = pos.kitGroups ?? {};
        for (const [numero, pontos] of Object.entries(pos.tracks)) {
          const id = Number(numero);
          const g = { A: 1, B: 2, other: 3 }[grupos[numero] ?? ""] ?? 0;
          const metros = new Map((pos.metres?.[numero] ?? []).map(([ts, X, Y]) => [ts, [X, Y] as [number, number]]));
          for (const [ts, cx, cy, w, h] of pontos) {
            const m = metros.get(ts);
            frameDe(ts).boxes.push({ id, x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, g, mx: m?.[0] ?? null, my: m?.[1] ?? null });
          }
        }
        for (const [ts, x, y, , X, Y] of pos.ball ?? []) {
          if (ts == null || x == null || y == null) continue;
          const f = frameDe(ts);
          f.ball = [x, y];
          f.ballM = X != null && Y != null ? [X, Y] : null;
        }
        const todos = [...porTs.values()].sort((a, b) => a.ts - b.ts);
        setFrames(todos);
        setFrontierMs(todos.length ? todos[todos.length - 1].ts : 0);
        if (pos.videoSize?.[0]) setVideoSize(pos.videoSize);
        if (pos.teams && Object.keys(pos.teams).length) setPalette(pos.teams as Palette);
        setProcessing(false);
        setFonte("final");
      })
      .catch(() => {
        /* sem ficheiro: fica o que havia ao vivo */
      });
    return () => {
      parado = true;
    };
  }, [detail.id, detectou, fonte]);

  /* ---- o vídeo ----------------------------------------------------------- */

  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!video || video.status !== "READY") {
      setSrc(null);
      return;
    }
    let parado = false;
    videoUrl(video.id)
      .then((r) => !parado && setSrc(r.url))
      .catch(() => !parado && setSrc(null));
    return () => {
      parado = true;
    };
  }, [video?.id, video?.status]);

  /* ---- equipas, nomes e cores -------------------------------------------- */

  // Qual das duas letras é a nossa: a de cor mais perto da que o treinador escolheu.
  const nossa = useMemo<"A" | "B" | null>(() => {
    const hex = detail.oursKitColor;
    if (!hex) return null;
    const alvo = hexToRgb(hex);
    let melhor: "A" | "B" | null = null, dist = Infinity;
    for (const letra of ["A", "B"] as const) {
      const c = palette[letra];
      if (!c) continue;
      const d = Math.hypot(c[0] - alvo[0], c[1] - alvo[1], c[2] - alvo[2]);
      if (d < dist) {
        dist = d;
        melhor = letra;
      }
    }
    return melhor;
  }, [detail.oursKitColor, palette]);

  const sideOf = useCallback(
    (g: number): Side => {
      if (g === 3) return "other";
      if (g === 0) return "unknown";
      if (!nossa) return "unknown";
      return (g === 1 ? "A" : "B") === nossa ? "ours" : "theirs";
    },
    [nossa],
  );

  const rotulo = useMemo(() => {
    const porNumero = new Map<number, string>();
    if (fonte !== "final") return porNumero;
    const identidades = new Map(detail.identities.map((i) => [i.id, i]));
    for (const t of detail.tracks) {
      const ident = t.identityId ? identidades.get(t.identityId) : null;
      porNumero.set(t.trackNumber, t.athleteName ?? ident?.athleteName ?? (ident ? `Jogador ${ident.label}` : `#${t.trackNumber}`));
    }
    return porNumero;
  }, [fonte, detail.tracks, detail.identities]);

  const nomeDe = useCallback((id: number) => rotulo.get(id) ?? String(id), [rotulo]);
  const corDe = useCallback(
    (b: Box) => {
      const side = sideOf(b.g);
      if (side !== "unknown") return COLOR[side];
      if (b.g === 1) return COLOR.A;
      if (b.g === 2) return COLOR.B;
      return COLOR.unknown;
    },
    [sideOf],
  );

  /* ---- o relógio e o palco ----------------------------------------------- */

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const tsRef = useRef<number[]>([]);
  useEffect(() => {
    tsRef.current = frames.map((f) => f.ts);
  }, [frames]);

  const [seguir, setSeguir] = useState(true);
  const seguirRef = useRef(seguir);
  seguirRef.current = seguir;
  const processingRef = useRef(processing);
  processingRef.current = processing;
  const frontierRef = useRef(frontierMs);
  frontierRef.current = frontierMs;
  const aEspera = useRef(false);
  // A calibrar? Lido pelo desenho a cada frame: enquanto sim, o vídeo não anda sozinho.
  const calibrandoRef = useRef(false);

  // O relógio do palco sem vídeo: anda sozinho quando se carrega em "Ver".
  const semVideo = src === null;
  const [playing, setPlaying] = useState(false);
  const clock = useRef({ tMs: 0, last: 0 });
  const [selected, setSelected] = useState<number | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // O que o painel mostra do instante — a 4 Hz, não a 60.
  const [agora, setAgora] = useState<{ tMs: number; boxes: Box[]; detected?: number }>({ tMs: 0, boxes: [] });
  // As marcas da calibração em curso, lidas pelo desenho a cada frame.
  const marcasRef = useRef<{ img: [number, number]; label: string }[]>([]);
  // Fora das linhas, com as medidas do campo — lido pelo desenho.
  const foraRef = useRef<(mx: number, my: number) => boolean>(() => false);
  const ultimoPainel = useRef(0);

  useEffect(() => {
    let raf = 0;
    const desenhar = (t: number) => {
      raf = requestAnimationFrame(desenhar);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const v = videoRef.current;

      let tMs: number;
      if (v && !semVideo) {
        tMs = v.currentTime * 1000;
        if (calibrandoRef.current) {
          // A calibrar: o vídeo não anda por conta própria.
          if (!v.paused) v.pause();
          if (v.playbackRate !== 1) v.playbackRate = 1;
        } else if (seguirRef.current && processingRef.current) {
          const atraso = frontierRef.current - tMs;
          if (!v.paused && atraso < FOLLOW_MARGIN_MS) {
            // Chegou à fronteira: pára e espera que ela avance.
            v.pause();
            aEspera.current = true;
          } else if (atraso > JUMP_MS && v.readyState >= 1) {
            // Ficou demasiado para trás (a página esteve fechada, o vídeo em
            // pausa): salta para perto de onde a IA vai.
            v.currentTime = Math.max(0, (frontierRef.current - BEHIND_FRONTIER_MS) / 1000);
          } else {
            // Um pouco atrás: acelera até apanhar; perto: velocidade normal.
            const alvo = atraso > CATCHUP_MS ? CATCHUP_RATE : 1;
            if (v.playbackRate !== alvo) v.playbackRate = alvo;
          }
        } else if (v.playbackRate !== 1) {
          v.playbackRate = 1;
        }
      } else {
        const c = clock.current;
        if (playing) {
          c.tMs = Math.min(frontierRef.current, c.tMs + (c.last ? t - c.last : 0));
          if (c.tMs >= frontierRef.current) setPlaying(false);
        }
        c.last = t;
        tMs = c.tMs;
      }

      const frame = frameAt(framesRef.current, tsRef.current, tMs);
      pintar(canvas, frame, videoSize, semVideo, nomeDe, corDe, selectedRef.current, fonte === "final", marcasRef.current, linhasRef.current, foraRef.current);

      if (t - ultimoPainel.current > 250) {
        ultimoPainel.current = t;
        setAgora({ tMs, boxes: frame ? frame.boxes : [], detected: frame?.detected });
      }
    };
    raf = requestAnimationFrame(desenhar);
    return () => cancelAnimationFrame(raf);
  }, [videoSize, semVideo, playing, nomeDe, corDe, fonte]);

  // A fronteira avançou: quem estava à espera dela continua.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !aEspera.current || !seguirRef.current || calibrandoRef.current) return;
    if (v.currentTime * 1000 < frontierMs - FOLLOW_MARGIN_MS) {
      aEspera.current = false;
      void v.play().catch(() => undefined);
    }
  }, [frontierMs]);

  /*
   * A primeira vez que há vídeo e fronteira: começa-se perto de onde a IA vai,
   * e a andar. Sem som, porque é a única forma de um browser deixar um vídeo
   * arrancar sozinho — e quem quer ouvir a bancada tem o botão. O `currentTime`
   * só pega depois dos metadados: antes disso o browser ignora-o.
   */
  const posicionado = useRef(false);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || posicionado.current || !frontierMs || !src || !processing) return;
    const arrancar = () => {
      if (posicionado.current) return;
      posicionado.current = true;
      v.currentTime = Math.max(0, (frontierMs - BEHIND_FRONTIER_MS) / 1000);
      v.muted = true;
      void v.play().catch(() => undefined);
    };
    if (v.readyState >= 1) arrancar();
    else v.addEventListener("loadedmetadata", arrancar, { once: true });
    return () => v.removeEventListener("loadedmetadata", arrancar);
  }, [frontierMs, src, processing]);

  /* ---- o campo ----------------------------------------------------------- */

  const calibration = detail.calibration;
  const campo = useMemo(
    () => ({
      length: calibration?.pitch.length ?? stats.pitch?.length ?? 105,
      width: calibration?.pitch.width ?? stats.pitch?.width ?? 68,
    }),
    [calibration, stats.pitch?.length, stats.pitch?.width],
  );
  const calibrado = !!calibration && (fonte === "final" || !!stats.pitch?.calibrated);
  const calibracaoPerdida = !!calibration && !!stats.pitch?.lost && fonte !== "final";
  // Dentro das linhas: só se sabe com metros; sem eles, não se corta o que não se sabe.
  const dentro = useCallback(
    (b: Box) => b.mx == null || b.my == null || (b.mx >= -1 && b.mx <= campo.length + 1 && b.my >= -1 && b.my <= campo.width + 1),
    [campo],
  );
  foraRef.current = (mx, my) => mx < -1 || my < -1 || mx > campo.length + 1 || my > campo.width + 1;

  // O ecrã de calibrar: pares (ponto do campo ↔ clique na imagem).
  const [calibrando, setCalibrando] = useState(false);
  const [pares, setPares] = useState<{ key: string; img: [number, number] }[]>([]);
  const [pendente, setPendente] = useState<string | null>(null);
  const [medidas, setMedidas] = useState(campo);
  const [aGuardar, setAGuardar] = useState<string | null>(null);
  const landmarks = useMemo(() => pontosDoCampo(medidas.length, medidas.width), [medidas]);
  const paresRef = useRef(pares);
  paresRef.current = pares;

  calibrandoRef.current = calibrando;

  const abrirCalibracao = () => {
    // Enquanto se calibra o vídeo fica parado: nem o "Seguir a IA" o retoma,
    // nem acelera — um frame que se mexe debaixo dos cliques não se calibra.
    aEspera.current = false;
    videoRef.current?.pause();
    setMedidas(campo);
    setPares([]);
    setPendente(null);
    setAGuardar(null);
    setCalibrando(true);
  };

  const cliqueNoPalco = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!calibrando || !pendente) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const [vw, vh] = videoSize[0] && videoSize[1] ? videoSize : [1920, 1080];
    const x = ((e.clientX - rect.left) / rect.width) * vw;
    const y = ((e.clientY - rect.top) / rect.height) * vh;
    setPares((p) => [...p.filter((q) => q.key !== pendente), { key: pendente, img: [Math.round(x), Math.round(y)] }]);
    setPendente(null);
  };

  const ajuste = useMemo(() => {
    const pts = pares
      .map((p) => {
        const l = landmarks.find((k) => k.key === p.key);
        return l ? { img: p.img, pitch: [l.x, l.y] as [number, number] } : null;
      })
      .filter((p): p is { img: [number, number]; pitch: [number, number] } => !!p);
    if (pts.length < 4) return null;
    if (quaseEmLinha(pts.map((p) => p.pitch))) return { H: null, erro: Infinity, pts, emLinha: true, plausivel: false };
    const H = homografia(pts);
    if (!H) return null;
    // O horizonte tem de ficar acima do relvado: os pontos clicados e o fundo da imagem.
    const [fw, fh] = videoSize[0] && videoSize[1] ? videoSize : [1920, 1080];
    const plausivel = geometriaPlausivel(H, [...pts.map((p) => p.img), [0, fh], [fw, fh], [fw / 2, fh]]);
    return { H, erro: erroMaximo(H, pts), pts, emLinha: false, plausivel };
  }, [pares, landmarks, videoSize]);

  /*
   * As linhas do campo projectadas no vídeo, a partir do 4.º ponto.
   *
   * É o que torna a calibração verificável a olho: com quatro pontos o erro dá
   * sempre zero (a conta encaixa em quaisquer quatro cliques), e só se vê que
   * um está mal quando as linhas desenhadas não caem em cima das linhas reais.
   */
  const linhasRef = useRef<[number, number][][]>([]);
  linhasRef.current = useMemo(() => {
    if (!calibrando || !ajuste?.H || !ajuste.plausivel) return [];
    const inv = inverter(ajuste.H);
    if (!inv) return [];
    return linhasDoCampo(medidas.length, medidas.width).map((linha) => {
      // Densificar: uma recta no campo é uma recta na imagem, mas o círculo não.
      const pontos: [number, number][] = [];
      for (let i = 0; i < linha.length - 1; i++) {
        const [ax, ay] = linha[i], [bx, by] = linha[i + 1];
        for (let k = 0; k < 12; k++) {
          const t = k / 12;
          const q = paraCampo(inv, ax + (bx - ax) * t, ay + (by - ay) * t);
          if (q) pontos.push(q);
        }
      }
      const fim = paraCampo(inv, linha[linha.length - 1][0], linha[linha.length - 1][1]);
      if (fim) pontos.push(fim);
      return pontos;
    });
  }, [calibrando, ajuste, medidas]);

  const podeGuardar = !!ajuste?.H && ajuste.plausivel && ajuste.erro <= 3 && pares.length >= MIN_PONTOS;
  const guardarCalibracao = async () => {
    if (!ajuste || !ajuste.H || !podeGuardar) return;
    setAGuardar("a guardar");
    try {
      const atMs = videoRef.current && !semVideo ? Math.round(videoRef.current.currentTime * 1000) : Math.round(agora.tMs);
      await setCalibration(detail.id, {
        pitch: medidas,
        atMs,
        frame: videoSize[0] && videoSize[1] ? videoSize : [1920, 1080],
        points: pares.map((p) => {
          const l = landmarks.find((k) => k.key === p.key)!;
          return { key: p.key, img: p.img, pitch: [l.x, l.y] };
        }),
        H: ajuste.H,
      });
      setCalibrando(false);
      onChanged();
    } catch (e) {
      setAGuardar(e instanceof Error ? e.message : "Não foi possível guardar");
      return;
    }
    setAGuardar(null);
  };

  /* ---- os números do painel ---------------------------------------------- */

  const resumo = useMemo(() => calcularPosse(frames, sideOf, dentro), [frames, sideOf, dentro]);

  const velocidade =
    stats.elapsedSec && stats.processedMs ? stats.processedMs / 1000 / stats.elapsedSec : null;

  const [mapa, setMapa] = useState<"todos" | "ours" | "theirs">("todos");
  const filtroMapa = useCallback(
    (b: Box) => dentro(b) && (selected != null ? b.id === selected : mapa === "todos" ? sideOf(b.g) !== "other" : sideOf(b.g) === mapa),
    [selected, mapa, sideOf, dentro],
  );

  const [aEscolher, setAEscolher] = useState(false);
  const escolher = async (letra: "A" | "B") => {
    const rgb = palette[letra];
    if (!rgb) return;
    setAEscolher(true);
    try {
      await chooseKit(detail.id, rgbToHex(rgb));
      onChanged();
    } finally {
      setAEscolher(false);
    }
  };

  if (!video) return null;
  if (fonte === null && !processing && !detectando) return null;

  const [vw, vh] = videoSize[0] && videoSize[1] ? videoSize : [16, 9];
  const emCampo = contar(agora.boxes.filter(dentro), sideOf);
  const temEquipas = !!palette.A && !!palette.B;
  const marcas = calibrando ? pares.map((p) => ({ img: p.img, label: landmarks.find((k) => k.key === p.key)?.label ?? p.key })) : [];
  marcasRef.current = marcas;

  return (
    <Panel className="mb-4">
      <PanelHead
        title="O jogo com a IA por cima"
        hint={
          processing
            ? `a IA vai no ${videoTime(frontierMs)}${velocidade ? ` · ${velocidade.toFixed(1)}× o tempo real` : ""}`
            : fonte === "final"
              ? "detecção concluída · numeração final"
              : fonte === "live"
                ? "detecção concluída · à espera do ficheiro final"
                : "à espera dos primeiros segundos"
        }
      >
        {processing && (
          <label className="flex cursor-pointer items-center gap-1.5 text-meta text-ink-2 select-none">
            <input
              type="checkbox"
              className="size-3.5 accent-[var(--color-signal)]"
              checked={seguir}
              onChange={(e) => setSeguir(e.target.checked)}
            />
            Seguir a IA
          </label>
        )}
      </PanelHead>

      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* O palco */}
        <div className="relative bg-black" style={{ aspectRatio: `${vw} / ${vh}` }}>
          {src ? (
            <video ref={videoRef} src={src} controls playsInline preload="metadata" className="absolute inset-0 h-full w-full" />
          ) : src === undefined ? (
            <div className="absolute inset-0 flex items-center justify-center text-meta text-white/60">
              <Loader2 className="mr-2 size-4 animate-spin" strokeWidth={2} />
              A pedir o vídeo…
            </div>
          ) : null}
          <canvas
            ref={canvasRef}
            onClick={cliqueNoPalco}
            className={cx("absolute inset-0 h-full w-full", calibrando ? (pendente ? "cursor-crosshair" : "cursor-default") : "pointer-events-none")}
          />

          {/* A calibrar: o vídeo pára, e cada clique no palco é um ponto do campo. */}
          {calibrando && (
            <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-medium text-white">
              {pendente
                ? `Clica no vídeo: ${landmarks.find((k) => k.key === pendente)?.label ?? pendente}`
                : "Escolhe um ponto no desenho do campo, à direita"}
            </div>
          )}

          {/* Sem vídeo: o relógio do palco. */}
          {semVideo && frames.length > 0 && (
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/60 px-3 py-2">
              <button
                type="button"
                className="inline-flex size-7 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
                onClick={() => {
                  if (!playing && clock.current.tMs >= frontierMs) clock.current.tMs = 0;
                  clock.current.last = 0;
                  setPlaying((p) => !p);
                }}
                aria-label={playing ? "Parar" : "Ver"}
              >
                {playing ? <Pause className="size-3.5" strokeWidth={2} /> : <Play className="size-3.5" strokeWidth={2} />}
              </button>
              <input
                type="range"
                aria-label="Momento do jogo"
                className="min-w-0 flex-1 accent-white"
                min={0}
                max={Math.max(1, frontierMs)}
                value={Math.min(agora.tMs, frontierMs)}
                onChange={(e) => {
                  clock.current.tMs = Number(e.target.value);
                }}
              />
              <span className="font-mono text-[11px] tabular text-white/80">
                {videoTime(agora.tMs)} / {videoTime(frontierMs)}
              </span>
            </div>
          )}

          {/* À espera da IA: o vídeo chegou à fronteira. */}
          {!semVideo && processing && seguir && agora.tMs > frontierMs - FOLLOW_MARGIN_MS && frontierMs > 0 && (
            <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-medium text-white">
              <Loader2 className="size-3 animate-spin" strokeWidth={2} />
              À espera da IA — vai no {videoTime(frontierMs)}
            </div>
          )}
        </div>

        {/* O painel */}
        <aside className="border-t border-line xl:border-l xl:border-t-0">
          {/* O campo: calibrar, e o estado da calibração. */}
          {calibrando ? (
            <div className="border-b border-line px-4 py-3">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-meta font-medium text-ink">Calibrar o campo</span>
                <span className="text-[11px] text-ink-4">{pares.length} de {MIN_PONTOS} a 8 pontos</span>
              </div>
              <div className="mb-2 flex items-center gap-2 text-[11px] text-ink-3">
                <label className="flex items-center gap-1">
                  comprimento
                  <input type="number" min={20} max={130} step={0.5} value={medidas.length} onChange={(e) => setMedidas((m) => ({ ...m, length: Number(e.target.value) || m.length }))} className="w-14 rounded border border-line bg-surface px-1 py-0.5 text-right tabular text-ink" />
                  m
                </label>
                <label className="flex items-center gap-1">
                  largura
                  <input type="number" min={15} max={90} step={0.5} value={medidas.width} onChange={(e) => setMedidas((m) => ({ ...m, width: Number(e.target.value) || m.width }))} className="w-14 rounded border border-line bg-surface px-1 py-0.5 text-right tabular text-ink" />
                  m
                </label>
              </div>
              <PitchDiagram length={medidas.length} width={medidas.width} landmarks={landmarks} feitos={new Set(pares.map((p) => p.key))} pendente={pendente} onPick={setPendente} />
              <p className="mt-1.5 text-[11px] leading-snug text-ink-4">
                Clica um ponto no desenho e depois no sítio certo do vídeo. Escolhe pontos espalhados, nunca todos na
                mesma linha: postes, cantos da grande área, lados do círculo. 4 chegam, 6 é melhor. A câmara pode
                mexer-se depois; a IA acompanha-a.
              </p>
              {ajuste?.emLinha && (
                <p className="mt-1.5 text-[11px] text-warn">
                  Os pontos estão quase em linha (a linha de meio-campo não chega). Junta um fora dela: um lado do
                  círculo, um poste, um canto da grande área.
                </p>
              )}
              {ajuste && !ajuste.emLinha && !ajuste.plausivel && (
                <p className="mt-1.5 text-[11px] leading-snug text-warn">
                  Esta calibração põe o horizonte no meio do relvado: um dos pontos não está onde diz. Confirma qual
                  pelas linhas, ou recomeça.
                </p>
              )}
              {ajuste && !ajuste.emLinha && ajuste.plausivel && (
                <p className="mt-1.5 text-[11px] leading-snug text-ink-3">
                  As linhas cor-de-rosa são o campo como a calibração o vê. Têm de cair em cima das linhas reais; se uma
                  não cai, o clique dela está mal.
                </p>
              )}
              {ajuste && !ajuste.emLinha && ajuste.plausivel && pares.length < MIN_PONTOS && (
                <p className="mt-1 text-[11px] text-ink-4">
                  Falta {MIN_PONTOS - pares.length} ponto: com 4 a conta encaixa sempre, e o erro não diz nada.
                </p>
              )}
              {ajuste && !ajuste.emLinha && ajuste.plausivel && pares.length >= MIN_PONTOS && (
                <p className={cx("mt-1 text-[11px] leading-snug", ajuste.erro <= 3 ? "text-ok" : "text-warn")}>
                  Erro máximo {ajuste.erro.toFixed(1)} m
                  {ajuste.erro > 3 &&
                    " — os cliques e as medidas do campo discordam. Se as linhas caem bem, são as medidas (poucos campos têm 105 × 68)."}
                </p>
              )}
              {aGuardar && aGuardar !== "a guardar" && <p className="mt-1.5 text-[11px] text-risk">{aGuardar}</p>}
              <div className="mt-2.5 flex gap-2">
                <button type="button" className="ctl-primary" disabled={!podeGuardar || aGuardar === "a guardar"} onClick={guardarCalibracao}>
                  Guardar
                </button>
                <button type="button" className="ctl-ghost" onClick={() => setCalibrando(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <span className="min-w-0 flex-1 text-meta text-ink-2">
                {calibracaoPerdida
                  ? "A câmara cortou e a calibração perdeu-se. Volta a calibrar."
                  : calibrado
                    ? `Campo calibrado · ${campo.length} × ${campo.width} m`
                    : calibration
                      ? "Calibração guardada; a IA aplica-a nos próximos segundos."
                      : "Sem calibração: as pessoas e as bolas fora do campo contam."}
              </span>
              {fonte !== "final" && (
                <button type="button" className={calibracaoPerdida || !calibration ? "ctl-primary shrink-0" : "ctl-outline shrink-0"} onClick={abrirCalibracao}>
                  {calibration ? "Recalibrar" : "Calibrar o campo"}
                </button>
              )}
            </div>
          )}

          {/* As equipas: quem é quem, e qual é a nossa. */}
          <div className="border-b border-line px-4 py-3">
            {!temEquipas ? (
              <p className="text-meta text-ink-4">A IA ainda está a separar as equipas pela cor do equipamento.</p>
            ) : !nossa ? (
              <>
                <p className="mb-2 text-meta font-medium text-ink">Qual é a nossa equipa?</p>
                <div className="flex gap-2">
                  {(["A", "B"] as const).map((letra) => (
                    <button
                      key={letra}
                      type="button"
                      disabled={aEscolher}
                      onClick={() => escolher(letra)}
                      className="flex flex-1 items-center gap-2 rounded-[var(--radius-control)] border border-line px-2.5 py-2 text-meta text-ink-2 hover:border-line-strong hover:text-ink"
                    >
                      <Swatch rgb={palette[letra]!} />
                      Equipa {letra}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-snug text-ink-4">
                  Até escolheres, a IA só sabe que há duas equipas. Os árbitros e os guarda-redes ficam em "outros".
                </p>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
                <span className="flex items-center gap-1.5 text-ink">
                  <Swatch rgb={palette[nossa]!} ring={COLOR.ours} /> Nós
                </span>
                <span className="flex items-center gap-1.5 text-ink-2">
                  <Swatch rgb={palette[nossa === "A" ? "B" : "A"]!} ring={COLOR.theirs} /> Eles
                </span>
                <span className="flex items-center gap-1.5 text-ink-3">
                  <span className="size-2.5 rounded-full" style={{ background: COLOR.other }} /> Outros
                </span>
                <button type="button" className="ml-auto text-[11px] text-ink-4 hover:text-ink" onClick={() => escolher(nossa === "A" ? "B" : "A")} disabled={aEscolher}>
                  trocar
                </button>
              </div>
            )}
          </div>

          {/* A posse e quem está em campo. */}
          <div className="border-b border-line px-4 py-3">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-meta font-medium text-ink-2">Posse de bola</span>
              <span className="text-[11px] text-ink-4">
                {resumo.coverage > 0 ? `bola vista ${Math.round(resumo.coverage * 100)} % do tempo` : "bola ainda não vista"}
              </span>
            </div>
            {nossa && resumo.oursMs + resumo.theirsMs > 0 ? (
              <>
                <div className="flex h-2 overflow-hidden rounded-full bg-sunken">
                  <div style={{ width: `${resumo.oursPct}%`, background: COLOR.ours }} />
                  <div style={{ width: `${100 - resumo.oursPct}%`, background: "#cbd5e1" }} />
                </div>
                <div className="mt-1 flex justify-between text-meta tabular text-ink">
                  <span>Nós {resumo.oursPct} %</span>
                  <span>Eles {100 - resumo.oursPct} %</span>
                </div>
              </>
            ) : (
              <p className="text-meta text-ink-4">{nossa ? "Ainda sem bola perto de ninguém." : "Escolhe a nossa equipa para ver a posse."}</p>
            )}
            <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
              <Stat label="Nós em campo" value={nossa ? emCampo.ours : "–"} />
              <Stat label="Eles em campo" value={nossa ? emCampo.theirs : "–"} />
              <Stat label="Outros" value={emCampo.other} />
            </div>
          </div>

          {/* Onde se jogou. */}
          <div className="border-b border-line px-4 py-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-meta font-medium text-ink-2">Onde se jogou</span>
              {selected != null ? (
                <button type="button" className="text-[11px] text-ink-3 hover:text-ink" onClick={() => setSelected(null)}>
                  todos
                </button>
              ) : (
                <div className="flex gap-1">
                  {(["todos", "ours", "theirs"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      disabled={m !== "todos" && !nossa}
                      onClick={() => setMapa(m)}
                      className={cx(
                        "rounded-full px-2 py-0.5 text-[11px]",
                        mapa === m ? "bg-ink text-surface" : "text-ink-3 hover:text-ink disabled:text-ink-4",
                      )}
                    >
                      {m === "todos" ? "todos" : m === "ours" ? "nós" : "eles"}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {calibrado ? (
              <>
                <PitchHeatmap frames={frames} length={campo.length} width={campo.width} filtro={filtroMapa} />
                <p className="mt-1.5 text-[11px] leading-snug text-ink-4">Sobre o campo, em metros. A câmara arrasta a calibração; se cortar, pede-se outra.</p>
              </>
            ) : (
              <>
                <Heatmap frames={frames} size={[vw, vh]} filtro={filtroMapa} />
                <p className="mt-1.5 text-[11px] leading-snug text-ink-4">
                  Em coordenadas do vídeo. Calibra o campo para o ver em metros e cortar o que está fora das linhas.
                </p>
              </>
            )}
          </div>

          {/* Quem está no frame. */}
          <div className="px-4 py-3">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-meta font-medium text-ink-2">{fonte === "final" ? "Quem está em campo" : "Pessoas em campo"}</span>
              <span className="text-[11px] text-ink-4">{resumo.numeros} números dados</span>
            </div>
            {/* O detector viu mais do que o tracker devolveu: é aqui que se perdem jogadores, e diz-se. */}
            {agora.detected != null && agora.detected > agora.boxes.length + 1 && (
              <p className="mb-1.5 text-[11px] text-warn">
                O detetor viu {agora.detected} pessoas neste frame; o seguimento só devolveu {agora.boxes.length}
                {stats.cameraLost ? ` · câmara sem medição ${stats.cameraLost}×` : ""}
              </p>
            )}
            {agora.boxes.length === 0 ? (
              <p className="text-meta text-ink-4">
                {frames.length === 0 ? "A IA ainda não devolveu nada deste momento." : "Ninguém neste frame."}
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1">
                {[...agora.boxes].filter(dentro).sort((a, b) => a.id - b.id).map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => setSelected((s) => (s === b.id ? null : b.id))}
                      className={cx(
                        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 font-mono text-[11px] transition-colors",
                        selected === b.id ? "border-ink bg-ink text-surface" : "border-line text-ink-2 hover:border-line-strong",
                      )}
                    >
                      <span className="size-2 rounded-full" style={{ background: corDe(b) }} aria-hidden />
                      {nomeDe(b.id)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {fonte !== "final" && (
              <p className="mt-2.5 text-[11px] leading-snug text-ink-4">
                Ao vivo a IA vê pessoas, não nomes: cada número é uma pessoa que está a seguir, e mantém-se enquanto
                não a perder de vista. Quem sai do enquadramento por mais de uns segundos volta com número novo; os
                nomes chegam com a identificação, no fim.
              </p>
            )}
          </div>
        </aside>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-[6px] bg-sunken px-2 py-1.5">
      <div className="text-[10px] text-ink-4">{label}</div>
      <div className="text-[16px] font-semibold tabular text-ink">{value}</div>
    </div>
  );
}

function Swatch({ rgb, ring }: { rgb: [number, number, number]; ring?: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-3.5 rounded-full border border-black/15"
      style={{ background: `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`, boxShadow: ring ? `0 0 0 2px ${ring}` : undefined }}
    />
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")}`;
}

function contar(boxes: Box[], sideOf: (g: number) => Side) {
  const c = { ours: 0, theirs: 0, other: 0, unknown: 0 };
  for (const b of boxes) c[sideOf(b.g)] += 1;
  return c;
}

/**
 * A posse — e a cobertura que a acompanha.
 *
 * A bola é de quem a tem mais perto (pelos pés) a menos de `POSSESSION_REACH`
 * alturas de corpo; quando ninguém a tem, não é de ninguém. Quando não se vê,
 * a última posse vale `POSSESSION_MEMORY_MS` e depois acaba. O número que sai
 * é sempre dito com o tempo em que a bola foi mesmo vista: uma posse de 60 %
 * com a bola vista 30 % do tempo é uma estimativa, e o ecrã di-lo.
 */
function calcularPosse(frames: Frame[], sideOf: (g: number) => Side, dentro: (b: Box) => boolean) {
  let oursMs = 0, theirsMs = 0, comBola = 0;
  let ultima: Side | null = null, ultimaTs = -Infinity;
  const presenca = new Map<number, number>();
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const dt = i + 1 < frames.length ? Math.min(1000, frames[i + 1].ts - f.ts) : 200;
    for (const b of f.boxes) presenca.set(b.id, (presenca.get(b.id) ?? 0) + 1);
    let dona: Side | null = null;
    if (f.ball) {
      comBola += 1;
      const [bx, by] = f.ball;
      let melhor = Infinity;
      for (const b of f.boxes) {
        if (!dentro(b)) continue;
        const h = b.y2 - b.y1;
        const d = Math.hypot((b.x1 + b.x2) / 2 - bx, b.y2 - by);
        if (d <= POSSESSION_REACH * h && d < melhor) {
          melhor = d;
          dona = sideOf(b.g);
        }
      }
      if (dona) {
        ultima = dona;
        ultimaTs = f.ts;
      }
    } else if (ultima && f.ts - ultimaTs <= POSSESSION_MEMORY_MS) {
      dona = ultima;
    }
    if (dona === "ours") oursMs += dt;
    else if (dona === "theirs") theirsMs += dt;
  }
  const total = oursMs + theirsMs;
  return {
    oursMs,
    theirsMs,
    oursPct: total ? Math.round((oursMs / total) * 100) : 0,
    coverage: frames.length ? comBola / frames.length : 0,
    // Quantos números a IA deu até agora, descontando os que não duraram dois segundos.
    numeros: [...presenca.values()].filter((n) => n >= 10).length,
  };
}

/**
 * As caixas no instante `tMs`.
 *
 * A IA vê cinco frames por segundo; o ecrã pinta sessenta. Entre dois frames
 * processados, cada caixa (e a bola) interpola-se no tempo — senão a caixa
 * fica 200 ms parada enquanto o jogador e a câmara continuam a andar, e
 * aparece ao lado dele. Quem só existe num dos dois frames desenha-se onde
 * estava, desde que esse frame esteja perto.
 */
function frameAt(frames: Frame[], ts: number[], tMs: number): Frame | null {
  if (ts.length === 0) return null;
  let lo = 0, hi = ts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ts[mid] <= tMs) lo = mid;
    else hi = mid - 1;
  }
  const antes = ts[lo] <= tMs ? lo : -1;
  const depois = antes + 1 < ts.length ? antes + 1 : -1;
  const dA = antes >= 0 ? tMs - ts[antes] : Infinity;
  const dD = depois >= 0 ? ts[depois] - tMs : Infinity;

  if (dA <= FRAME_TOLERANCE_MS && dD <= FRAME_TOLERANCE_MS && dA + dD > 0) {
    const a = frames[antes], d = frames[depois];
    const f = dA / (dA + dD);
    const porId = new Map(d.boxes.map((b) => [b.id, b]));
    const boxes: Box[] = [];
    for (const b of a.boxes) {
      const n = porId.get(b.id);
      if (n) {
        porId.delete(b.id);
        const perto = f < 0.5 ? b : n;
        boxes.push({
          id: b.id,
          g: perto.g,
          mx: perto.mx,
          my: perto.my,
          x1: b.x1 + (n.x1 - b.x1) * f,
          y1: b.y1 + (n.y1 - b.y1) * f,
          x2: b.x2 + (n.x2 - b.x2) * f,
          y2: b.y2 + (n.y2 - b.y2) * f,
        });
      } else if (f < 0.5) {
        boxes.push(b);
      }
    }
    if (f >= 0.5) for (const n of porId.values()) boxes.push(n);
    const ball: [number, number] | null =
      a.ball && d.ball
        ? [a.ball[0] + (d.ball[0] - a.ball[0]) * f, a.ball[1] + (d.ball[1] - a.ball[1]) * f]
        : f < 0.5
          ? a.ball
          : d.ball;
    return { ts: tMs, boxes, ball, detected: f < 0.5 ? a.detected : d.detected };
  }
  if (dA <= FRAME_TOLERANCE_MS) return frames[antes];
  if (dD <= FRAME_TOLERANCE_MS) return frames[depois];
  return null;
}

/** As caixas em cima do vídeo (ou os pontos no palco escuro), e a bola. */
function pintar(
  canvas: HTMLCanvasElement,
  frame: Frame | null,
  videoSize: [number, number],
  semVideo: boolean,
  nomeDe: (id: number) => string,
  corDe: (b: Box) => string,
  selected: number | null,
  final: boolean,
  marcas: { img: [number, number]; label: string }[] = [],
  linhas: [number, number][][] = [],
  foraDoCampo: (mx: number, my: number) => boolean = () => false,
) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(rect.width * dpr), H = Math.round(rect.height * dpr);
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);

  const [vw, vh] = videoSize[0] && videoSize[1] ? videoSize : [1920, 1080];
  const sx = W / vw, sy = H / vh;

  if (semVideo) {
    ctx.fillStyle = "#0f1a14";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1 * dpr;
    for (let i = 1; i < 6; i++) {
      ctx.beginPath(); ctx.moveTo((W * i) / 6, 0); ctx.lineTo((W * i) / 6, H); ctx.stroke();
    }
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(0, (H * i) / 4); ctx.lineTo(W, (H * i) / 4); ctx.stroke();
    }
  }
  ctx.font = `${Math.max(10, Math.round(11 * dpr))}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  // O campo como a calibração o vê, por cima do vídeo: tem de cair nas linhas reais.
  if (linhas.length) {
    ctx.strokeStyle = "rgba(244, 114, 182, 0.9)";
    ctx.lineWidth = 2 * dpr;
    for (const linha of linhas) {
      ctx.beginPath();
      linha.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x * sx, y * sy) : ctx.lineTo(x * sx, y * sy)));
      ctx.stroke();
    }
  }

  // As marcas da calibração: uma cruz e o nome do ponto.
  for (const m of marcas) {
    const x = m.img[0] * sx, y = m.img[1] * sy;
    ctx.strokeStyle = "#f472b6";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(x - 8 * dpr, y); ctx.lineTo(x + 8 * dpr, y);
    ctx.moveTo(x, y - 8 * dpr); ctx.lineTo(x, y + 8 * dpr);
    ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    const tw = ctx.measureText(m.label).width + 8 * dpr;
    ctx.fillRect(x + 10 * dpr, y - 8 * dpr, tw, 16 * dpr);
    ctx.fillStyle = "#fff";
    ctx.fillText(m.label, x + 14 * dpr, y);
  }
  if (!frame) return;

  for (const b of frame.boxes) {
    const cor = corDe(b);
    const destaque = selected === b.id;
    // Fora das linhas (com o campo calibrado): desenha-se apagado, para se ver que a IA o viu e o pôs de lado.
    const fora = b.mx != null && b.my != null && foraDoCampo(b.mx, b.my);
    const apagado = (selected != null && !destaque) || fora;
    ctx.globalAlpha = apagado ? 0.25 : 1;
    const x = b.x1 * sx, y = b.y1 * sy, w = (b.x2 - b.x1) * sx, h = (b.y2 - b.y1) * sy;

    if (semVideo) {
      // Sem imagem, o jogador é um ponto nos pés — onde está, não o que ocupa.
      const px = x + w / 2, py = y + h;
      ctx.fillStyle = cor;
      ctx.beginPath();
      ctx.arc(px, py, (destaque ? 6 : 4) * dpr, 0, Math.PI * 2);
      ctx.fill();
      if (final || destaque) {
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillText(nomeDe(b.id), px + 7 * dpr, py);
      }
      continue;
    }

    ctx.strokeStyle = cor;
    ctx.lineWidth = (destaque ? 3 : 1.5) * dpr;
    ctx.strokeRect(x, y, w, h);

    const texto = nomeDe(b.id);
    const pad = 4 * dpr;
    const tw = ctx.measureText(texto).width + pad * 2;
    const th = 14 * dpr;
    const ly = Math.max(0, y - th - 2 * dpr);
    ctx.fillStyle = cor;
    ctx.fillRect(x, ly, tw, th);
    ctx.fillStyle = "#0b0f0c";
    ctx.fillText(texto, x + pad, ly + th / 2);
  }
  ctx.globalAlpha = 1;

  // A bola: um ponto claro com anel escuro, para se ver em cima da relva e da camisola.
  // Fora das linhas não se desenha: com o campo calibrado, é de reserva.
  if (frame.ball && !(frame.ballM && foraDoCampo(frame.ballM[0], frame.ballM[1]))) {
    const bx = frame.ball[0] * sx, by = frame.ball[1] * sy;
    ctx.beginPath();
    ctx.arc(bx, by, 5 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = "#111827";
    ctx.stroke();
  }
}

/** O desenho do campo, com os pontos conhecidos clicáveis — o lado do desenho da calibração. */
function PitchDiagram({
  length: L,
  width: W,
  landmarks,
  feitos,
  pendente,
  onPick,
}: {
  length: number;
  width: number;
  landmarks: Landmark[];
  feitos: Set<string>;
  pendente: string | null;
  onPick: (key: string) => void;
}) {
  const m = W / 2;
  const pad = 4;
  return (
    <svg viewBox={`${-pad} ${-pad} ${L + pad * 2} ${W + pad * 2}`} className="block w-full rounded-[6px] bg-[#0f1a14]" role="img" aria-label="Desenho do campo">
      <g fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={0.4}>
        <rect x={0} y={0} width={L} height={W} />
        <line x1={L / 2} y1={0} x2={L / 2} y2={W} />
        <circle cx={L / 2} cy={m} r={9.15} />
        <rect x={0} y={m - 20.16} width={16.5} height={40.32} />
        <rect x={L - 16.5} y={m - 20.16} width={16.5} height={40.32} />
        <rect x={0} y={m - 9.16} width={5.5} height={18.32} />
        <rect x={L - 5.5} y={m - 9.16} width={5.5} height={18.32} />
      </g>
      {landmarks.map((k) => {
        const feito = feitos.has(k.key);
        const activo = pendente === k.key;
        return (
          <circle
            key={k.key}
            cx={k.x}
            cy={k.y}
            r={activo ? 2.6 : 2}
            fill={feito ? "#22c55e" : activo ? "#f472b6" : "rgba(255,255,255,0.85)"}
            stroke={activo ? "#fff" : "none"}
            strokeWidth={0.5}
            className="cursor-pointer"
            onClick={() => onPick(k.key)}
          >
            <title>{k.label}</title>
          </circle>
        );
      })}
    </svg>
  );
}

/** Onde se jogou, sobre o campo em metros: os pés de cada caixa com posição, numa grelha de 2 m. */
function PitchHeatmap({ frames, length: L, width: W, filtro }: { frames: Frame[]; length: number; width: number; filtro: (b: Box) => boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const COLS = Math.ceil(L / 2), ROWS = Math.ceil(W / 2);
    const grelha = new Float32Array(COLS * ROWS);
    let max = 0;
    for (const f of frames) {
      for (const b of f.boxes) {
        if (b.mx == null || b.my == null || !filtro(b)) continue;
        if (b.mx < 0 || b.my < 0 || b.mx >= L || b.my >= W) continue;
        const i = Math.min(ROWS - 1, (b.my / 2) | 0) * COLS + Math.min(COLS - 1, (b.mx / 2) | 0);
        grelha[i] += 1;
        if (grelha[i] > max) max = grelha[i];
      }
    }
    const dpr = window.devicePixelRatio || 1;
    const Wpx = Math.round(canvas.clientWidth * dpr), Hpx = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== Wpx || canvas.height !== Hpx) {
      canvas.width = Wpx;
      canvas.height = Hpx;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#0f1a14";
    ctx.fillRect(0, 0, Wpx, Hpx);
    const sx = Wpx / L, sy = Hpx / W;
    if (max > 0) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const v = grelha[r * COLS + c];
          if (!v) continue;
          ctx.fillStyle = `rgba(74, 222, 128, ${(0.12 + 0.88 * Math.sqrt(v / max)).toFixed(3)})`;
          ctx.fillRect(c * 2 * sx, r * 2 * sy, 2 * sx + 0.5, 2 * sy + 0.5);
        }
      }
    }
    // As linhas por cima, para o mapa se ler como um campo.
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1 * dpr;
    const m = W / 2;
    ctx.strokeRect(0.5, 0.5, Wpx - 1, Hpx - 1);
    ctx.beginPath(); ctx.moveTo((L / 2) * sx, 0); ctx.lineTo((L / 2) * sx, Hpx); ctx.stroke();
    ctx.beginPath(); ctx.ellipse((L / 2) * sx, m * sy, 9.15 * sx, 9.15 * sy, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeRect(0, (m - 20.16) * sy, 16.5 * sx, 40.32 * sy);
    ctx.strokeRect(Wpx - 16.5 * sx, (m - 20.16) * sy, 16.5 * sx, 40.32 * sy);
  }, [frames, filtro, L, W]);
  return <canvas ref={ref} className="block w-full rounded-[6px]" style={{ aspectRatio: `${L} / ${W}` }} />;
}

/** Onde se jogou: os pés de cada caixa que passa o filtro, somados numa grelha. */
function Heatmap({ frames, size, filtro }: { frames: Frame[]; size: [number, number]; filtro: (b: Box) => boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [vw, vh] = size;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const COLS = 48, ROWS = 27;
    const grelha = new Float32Array(COLS * ROWS);
    let max = 0;
    for (const f of frames) {
      for (const b of f.boxes) {
        if (!filtro(b)) continue;
        const cx = ((b.x1 + b.x2) / 2 / vw) * COLS;
        const cy = (b.y2 / vh) * ROWS;
        const i = Math.min(ROWS - 1, Math.max(0, cy | 0)) * COLS + Math.min(COLS - 1, Math.max(0, cx | 0));
        grelha[i] += 1;
        if (grelha[i] > max) max = grelha[i];
      }
    }
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#0f1a14";
    ctx.fillRect(0, 0, W, H);
    if (max === 0) return;
    const cw = W / COLS, ch = H / ROWS;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = grelha[r * COLS + c];
        if (!v) continue;
        // Raiz, não linear: o canto onde o jogo esteve 2 % do tempo tem de se ver.
        const a = Math.sqrt(v / max);
        ctx.fillStyle = `rgba(74, 222, 128, ${(0.12 + 0.88 * a).toFixed(3)})`;
        ctx.fillRect(c * cw, r * ch, cw + 0.5, ch + 0.5);
      }
    }
  }, [frames, filtro, vw, vh]);

  return <canvas ref={ref} className="block w-full rounded-[6px]" style={{ aspectRatio: "16 / 9" }} />;
}
