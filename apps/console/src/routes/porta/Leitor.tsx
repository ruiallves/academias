import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { Camera, Check, TriangleAlert, X } from "@/lib/icons";
import { longDate, time } from "@/lib/format";
import {
  entrarNaPorta,
  esquecer,
  estadoDaPorta,
  guardar,
  lerBilhete,
  lerGuardada,
  PortaErro,
  SemLigacao,
  type Leitura,
  type PortaEntrada,
  type PortaEstado,
} from "@/lib/porta";
import { abrirCamara, avisar, listarCamaras, motivoDaCamara, obterDetector, prepararSom } from "./camara";

/**
 * O leitor de bilhetes dos seguranças, em `/consola/porta/<token>`.
 *
 * Não pede conta: o link vem da consola (Bilheteira, portas do jogo) e o PIN
 * de seis algarismos dá uma sessão que só lê bilhetes daquele jogo naquela
 * porta. Vive fora dos portões da consola, em `main.tsx`.
 *
 * ## Feito para a porta de um estádio
 *
 * Um telemóvel na mão, ao sol, com uma fila à frente. Por isso o ecrã inteiro,
 * letra grande e contraste alto; o resultado de cada leitura ocupa o ecrã todo
 * numa cor que se lê de relance (verde entra, vermelho não entra, âmbar é a
 * porta errada), com um som e uma vibração diferentes para o aceite e para o
 * recusado, e volta sozinho à câmara ao fim de dois segundos.
 */
export default function Leitor() {
  const { token = "" } = useParams();
  const [entrada, setEntrada] = useState<PortaEntrada | null>(() => lerGuardada(token));
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const antes = document.title;
    document.title = "Leitor de bilhetes";
    return () => {
      document.title = antes;
    };
  }, []);

  const sair = useCallback((mensagem: string) => {
    esquecer();
    setEntrada(null);
    setErro(mensagem);
  }, []);

  if (!entrada) {
    return (
      <PassoPin
        token={token}
        erro={erro}
        onEntrar={(e) => {
          guardar(token, e);
          setErro(null);
          setEntrada(e);
        }}
      />
    );
  }

  return (
    <PassoLeitor
      entrada={entrada}
      onEstado={(estado) => {
        const nova = { ...entrada, ...estado };
        guardar(token, nova);
        setEntrada(nova);
      }}
      onSair={sair}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Passo 1: o PIN                                                               */
/* -------------------------------------------------------------------------- */

function PassoPin({ token, erro, onEntrar }: { token: string; erro: string | null; onEntrar: (e: PortaEntrada) => void }) {
  const [pin, setPin] = useState("");
  const [aEntrar, setAEntrar] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(erro);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => setMensagem(erro), [erro]);

  const entrar = async (valor: string) => {
    if (aEntrar || !/^\d{6}$/.test(valor)) return;
    // O toque em "Entrar" é o gesto que deixa o telemóvel tocar os bips depois.
    prepararSom();
    setAEntrar(true);
    setMensagem(null);
    try {
      onEntrar(await entrarNaPorta(token, valor));
    } catch (e) {
      setMensagem(e instanceof PortaErro || e instanceof SemLigacao ? e.message : "Não foi possível. Tenta outra vez.");
      setPin("");
      setAEntrar(false);
      campo.current?.focus();
    }
  };

  const submeter = (e: FormEvent) => {
    e.preventDefault();
    void entrar(pin);
  };

  return (
    <div className="fixed inset-0 overflow-y-auto bg-white text-black">
      <form
        onSubmit={submeter}
        className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 pt-[max(24px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))]"
      >
        <p className="text-[15px] font-semibold tracking-wide text-neutral-600 uppercase">Leitor de bilhetes</p>
        <h1 className="mt-2 text-[30px] leading-tight font-bold">Escreve o PIN</h1>
        <p className="mt-2 text-[18px] text-neutral-700">Seis algarismos, que o clube te deu com este link.</p>

        <label htmlFor="porta-pin" className="sr-only">
          PIN
        </label>
        <input
          id="porta-pin"
          ref={campo}
          value={pin}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 6);
            setPin(v);
            if (v.length === 6) void entrar(v);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          autoFocus
          disabled={aEntrar}
          aria-invalid={mensagem ? true : undefined}
          aria-describedby={mensagem ? "porta-pin-erro" : undefined}
          className="mt-8 h-20 w-full rounded-xl border-[3px] border-black bg-white text-center font-mono text-[44px] tracking-[0.35em] text-black outline-none focus:border-[#0f6b62] disabled:opacity-60"
        />

        {mensagem && (
          <p id="porta-pin-erro" role="alert" className="mt-4 rounded-xl bg-[#a82a20] px-4 py-3 text-[18px] font-semibold text-white">
            {mensagem}
          </p>
        )}

        <button
          type="submit"
          disabled={aEntrar || pin.length !== 6}
          className="mt-6 flex h-16 w-full items-center justify-center gap-3 rounded-xl bg-black text-[22px] font-bold text-white disabled:bg-neutral-400"
        >
          {aEntrar ? <Disco /> : "Entrar"}
        </button>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Passo 2: o leitor                                                            */
/* -------------------------------------------------------------------------- */

type Ecra =
  | { cor: "ok" | "recusa" | "porta"; titulo: string; mensagem: string; bilhete: Leitura["bilhete"] }
  | { cor: "aviso"; titulo: string; mensagem: string | null; bilhete: null };

/** Quanto tempo fica o resultado no ecrã antes de voltar a ler. */
const RESULTADO_MS = 2000;
/** O mesmo código visto outra vez dentro disto não se manda: é o mesmo bilhete ainda à frente da câmara. */
const REPETIDO_MS = 3000;
/** O contador de entradas, de quanto em quanto tempo. */
const ESTADO_MS = 20_000;
/** Entre duas tentativas de ler a imagem. */
const INTERVALO_LEITURA_MS = 150;

function ecraDe(r: Leitura): Ecra {
  if (r.ok) return { cor: "ok", titulo: "Pode entrar", mensagem: r.mensagem, bilhete: r.bilhete };
  if (r.resultado === "WRONG_GATE") return { cor: "porta", titulo: "Porta errada", mensagem: r.mensagem, bilhete: r.bilhete };
  return { cor: "recusa", titulo: "Não pode entrar", mensagem: r.mensagem, bilhete: r.bilhete };
}

function PassoLeitor({
  entrada,
  onEstado,
  onSair,
}: {
  entrada: PortaEntrada;
  onEstado: (e: PortaEstado) => void;
  onSair: (mensagem: string) => void;
}) {
  const { sessao } = entrada;
  const video = useRef<HTMLVideoElement>(null);
  const [ecra, setEcra] = useState<Ecra | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  const [camaras, setCamaras] = useState<MediaDeviceInfo[]>([]);
  const [camaraId, setCamaraId] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [erroCamara, setErroCamara] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [codigo, setCodigo] = useState("");

  /* Ocupado = há um pedido a caminho ou um resultado no ecrã. A câmara não lê. */
  const ocupado = useRef(false);
  const ultimo = useRef<{ codigo: string; em: number } | null>(null);
  const temporizador = useRef<number | null>(null);

  // As funções de fora mudam a cada render; os efeitos querem sempre a última.
  const fora = useRef({ onEstado, onSair, entrada });
  fora.current = { onEstado, onSair, entrada };

  const fecharEcra = useCallback(() => {
    if (temporizador.current !== null) window.clearTimeout(temporizador.current);
    temporizador.current = null;
    setEcra(null);
    ocupado.current = false;
  }, []);

  const mostrar = useCallback(
    (e: Ecra) => {
      setEcra(e);
      avisar(e.cor === "ok");
      if (temporizador.current !== null) window.clearTimeout(temporizador.current);
      temporizador.current = window.setTimeout(fecharEcra, RESULTADO_MS);
    },
    [fecharEcra],
  );

  useEffect(
    () => () => {
      if (temporizador.current !== null) window.clearTimeout(temporizador.current);
    },
    [],
  );

  /* ---- Uma leitura ---- */

  const ler = useCallback(
    async (bruto: string, escrito: boolean) => {
      const c = bruto.trim();
      if (!c || ocupado.current) return;
      const agora = Date.now();
      const anterior = ultimo.current;
      if (!escrito && anterior && anterior.codigo === c && agora - anterior.em < REPETIDO_MS) {
        // Ainda é o mesmo bilhete à frente da câmara: conta a partir de agora.
        anterior.em = agora;
        return;
      }
      ultimo.current = { codigo: c, em: agora };
      ocupado.current = true;
      setAEnviar(true);
      try {
        const r = await lerBilhete(sessao, c);
        if (r.ok) {
          const { entrada: atual } = fora.current;
          fora.current.onEstado({ jogo: atual.jogo, porta: atual.porta, entradas: atual.entradas + 1 });
        }
        mostrar(ecraDe(r));
        if (escrito) setCodigo("");
      } catch (e) {
        if (e instanceof PortaErro && e.status === 401) {
          ocupado.current = false;
          fora.current.onSair(e.message);
          return;
        }
        // Não se marcou nada: o mesmo código pode voltar a ser lido logo a seguir.
        ultimo.current = null;
        if (e instanceof SemLigacao) mostrar({ cor: "aviso", titulo: "Sem ligação, tenta outra vez", mensagem: null, bilhete: null });
        else mostrar({ cor: "aviso", titulo: "Não ficou registado", mensagem: e instanceof Error ? e.message : null, bilhete: null });
      } finally {
        setAEnviar(false);
      }
    },
    [sessao, mostrar],
  );

  const lerRef = useRef(ler);
  lerRef.current = ler;

  /* ---- A câmara, a ler sem parar ---- */

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setErroCamara("Este browser não deixa usar a câmara. Escreve o código à mão.");
      setManual(true);
      return;
    }
    let vivo = true;
    let fluxo: MediaStream | null = null;

    const reabrirSeParou = () => {
      if (document.visibilityState === "visible" && fluxo && fluxo.getVideoTracks().every((t) => t.readyState === "ended")) {
        setTentativa((n) => n + 1);
      }
    };

    (async () => {
      try {
        fluxo = await abrirCamara(camaraId);
      } catch (e) {
        if (!vivo) return;
        setErroCamara(motivoDaCamara(e));
        setManual(true);
        return;
      }
      if (!vivo) {
        fluxo.getTracks().forEach((t) => t.stop());
        return;
      }
      setErroCamara(null);
      const v = video.current;
      if (v) {
        v.srcObject = fluxo;
        await v.play().catch(() => undefined);
      }
      const lista = await listarCamaras();
      if (vivo) setCamaras(lista);

      const detectar = await obterDetector();
      while (vivo) {
        const el = video.current;
        if (!ocupado.current && el && el.readyState >= 2) {
          try {
            const lido = await detectar(el);
            if (lido && vivo) void lerRef.current(lido, false);
          } catch {
            /* um fotograma que não se leu; vem outro já a seguir */
          }
        }
        await new Promise((r) => window.setTimeout(r, INTERVALO_LEITURA_MS));
      }
    })();

    document.addEventListener("visibilitychange", reabrirSeParou);
    return () => {
      vivo = false;
      document.removeEventListener("visibilitychange", reabrirSeParou);
      fluxo?.getTracks().forEach((t) => t.stop());
    };
  }, [camaraId, tentativa]);

  const trocarCamara = () => {
    prepararSom();
    if (camaras.length < 2) return;
    const fluxo = video.current?.srcObject as MediaStream | null;
    const atual = camaraId ?? fluxo?.getVideoTracks()[0]?.getSettings().deviceId ?? null;
    const i = camaras.findIndex((c) => c.deviceId === atual);
    setCamaraId(camaras[(i + 1) % camaras.length].deviceId);
  };

  /* ---- O contador de entradas ---- */

  useEffect(() => {
    let vivo = true;
    const atualizar = async () => {
      try {
        const e = await estadoDaPorta(sessao);
        if (vivo) fora.current.onEstado(e);
      } catch (e) {
        if (vivo && e instanceof PortaErro && e.status === 401) fora.current.onSair(e.message);
        /* O resto (rede, servidor) tenta-se outra vez daqui a 20 segundos. */
      }
    };
    void atualizar();
    const id = window.setInterval(() => void atualizar(), ESTADO_MS);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, [sessao]);

  /* ---- O ecrã fica aceso ---- */

  useEffect(() => {
    type Trinco = { release: () => Promise<void> };
    const wl = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<Trinco> } }).wakeLock;
    if (!wl) return;
    let trinco: Trinco | null = null;
    let vivo = true;
    const pedir = () => {
      if (document.visibilityState !== "visible") return;
      wl.request("screen")
        .then((t) => {
          if (vivo) trinco = t;
          else void t.release().catch(() => undefined);
        })
        .catch(() => undefined);
    };
    pedir();
    // O browser larga o trinco sempre que a página sai da frente.
    document.addEventListener("visibilitychange", pedir);
    return () => {
      vivo = false;
      document.removeEventListener("visibilitychange", pedir);
      void trinco?.release().catch(() => undefined);
    };
  }, []);

  const submeterManual = (e: FormEvent) => {
    e.preventDefault();
    prepararSom();
    void ler(codigo, true);
  };

  const { jogo, porta, entradas } = entrada;
  const quando = jogo ? new Date(jogo.startsAt) : null;

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-white" onPointerDown={prepararSom}>
      {/* Cabeçalho: o jogo, a porta e as entradas. */}
      <header className="flex items-start gap-4 bg-white px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3 text-black">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[20px] leading-tight font-bold">{jogo?.nome ?? "Jogo"}</p>
          {quando && !Number.isNaN(quando.getTime()) && (
            <p className="text-[16px] text-neutral-700">
              {longDate(quando)}, {time(quando)}
            </p>
          )}
          <p className="mt-1 truncate text-[18px] font-semibold">{porta.nome}</p>
          {porta.bancadas.length > 0 && <p className="text-[15px] leading-snug text-neutral-700">{porta.bancadas.join(" · ")}</p>}
        </div>
        <div className="shrink-0 text-right" aria-live="polite">
          <p className="font-mono text-[40px] leading-none font-bold tabular-nums">{entradas}</p>
          <p className="mt-1 text-[14px] font-semibold text-neutral-700">{entradas === 1 ? "entrada" : "entradas"}</p>
        </div>
      </header>

      {/* A câmara. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video ref={video} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
        {erroCamara ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <Camera className="h-12 w-12" strokeWidth={1.5} aria-hidden />
            <p className="text-[20px] leading-snug font-semibold">{erroCamara}</p>
            <button
              type="button"
              onClick={() => {
                setErroCamara(null);
                setTentativa((n) => n + 1);
              }}
              className="h-14 rounded-xl border-2 border-white px-6 text-[18px] font-bold"
            >
              Tentar outra vez
            </button>
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex aspect-square w-[68%] max-w-[340px] items-center justify-center rounded-3xl border-4 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
              {aEnviar && <Disco />}
            </div>
          </div>
        )}
      </div>

      {/* À mão, e a troca de câmara. */}
      <div className="bg-black px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        {manual && (
          <form onSubmit={submeterManual} className="mb-3 flex gap-2">
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              aria-label="Código do bilhete"
              placeholder="Código do bilhete"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              className="h-14 min-w-0 flex-1 rounded-xl border-2 border-white bg-black px-4 font-mono text-[18px] text-white outline-none placeholder:text-neutral-400 focus:border-[#f5b301]"
            />
            <button
              type="submit"
              disabled={!codigo.trim() || aEnviar}
              className="h-14 shrink-0 rounded-xl bg-white px-5 text-[18px] font-bold text-black disabled:bg-neutral-500"
            >
              Validar
            </button>
          </form>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setManual((m) => !m)}
            className="h-14 flex-1 rounded-xl border-2 border-white text-[18px] font-bold"
          >
            {manual ? "Fechar" : "Escrever código"}
          </button>
          {camaras.length > 1 && (
            <button
              type="button"
              onClick={trocarCamara}
              className="flex h-14 flex-1 items-center justify-center gap-2 rounded-xl border-2 border-white text-[18px] font-bold"
            >
              <Camera className="h-6 w-6" strokeWidth={1.5} aria-hidden />
              Trocar câmara
            </button>
          )}
        </div>
      </div>

      {ecra && <Resultado ecra={ecra} onFechar={fecharEcra} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* O resultado, no ecrã todo                                                    */
/* -------------------------------------------------------------------------- */

const CORES: Record<Ecra["cor"], string> = {
  ok: "bg-[#1f7a45] text-white",
  recusa: "bg-[#a82a20] text-white",
  porta: "bg-[#f5b301] text-black",
  aviso: "bg-neutral-900 text-white",
};

function Resultado({ ecra, onFechar }: { ecra: Ecra; onFechar: () => void }) {
  const Icone = ecra.cor === "ok" ? Check : ecra.cor === "recusa" ? X : TriangleAlert;
  const b = ecra.bilhete;
  return (
    /* Um toque em qualquer sítio volta já à câmara, sem esperar os dois segundos. */
    <div
      onClick={onFechar}
      role="alert"
      className={`fixed inset-0 z-[90] flex flex-col items-center justify-center gap-4 px-6 text-center ${CORES[ecra.cor]}`}
    >
      <Icone className="h-28 w-28" strokeWidth={2.5} aria-hidden />
      <span className="text-[44px] leading-tight font-extrabold">{ecra.titulo}</span>
      {ecra.cor !== "ok" && ecra.mensagem && <span className="max-w-md text-[26px] leading-snug font-bold">{ecra.mensagem}</span>}
      {b && (
        <span className="flex flex-col gap-1 text-[24px] leading-snug font-semibold">
          <span>{b.tipo}</span>
          {b.bancada && <span>{b.bancada}</span>}
          {b.lugar && <span>Lugar {b.lugar}</span>}
        </span>
      )}
    </div>
  );
}

/** O disco de espera, sem texto. */
function Disco() {
  return (
    <span
      aria-label="Um momento"
      role="status"
      className="inline-block h-9 w-9 animate-spin rounded-full border-4 border-white/30 border-t-white"
    />
  );
}
