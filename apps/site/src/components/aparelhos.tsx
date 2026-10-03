import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useEstreito } from "@/lib/scroll";
import { cx } from "./marca";

/**
 * Os aparelhos: o ecrã da consola e o telemóvel da app.
 *
 * O que aparece lá dentro são **capturas reais** do produto, tiradas ao código
 * verdadeiro com um clube inventado (ver `scripts/capturas/GUIAO.md`). A
 * consola é capturada a 3840×2160 e a app a 1170×2532, para a câmara poder
 * aproximar-se de uma linha sem a imagem perder nitidez.
 *
 * Cada aparelho recebe a lista de capturas que a cena usa e qual está à vista.
 * Todas ficam montadas, empilhadas, e a troca é uma transição de opacidade:
 * assim nenhuma mudança de estado espera por um download.
 */

type Foco = [number, number, number, number];
type Entrada = { largura: number; altura: number; focos?: Record<string, Foco> };
type Manifesto = Record<string, Entrada>;

const pedidos = new Map<string, Promise<Manifesto>>();

/** Os manifestos dizem onde está cada coisa dentro de cada captura. */
function useManifesto(qual: "consola" | "app"): Manifesto {
  const [m, setM] = useState<Manifesto>({});
  useEffect(() => {
    let vivo = true;
    let p = pedidos.get(qual);
    if (!p) {
      p = fetch(`/shots/manifesto-${qual}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<Manifesto>) : {}))
        .catch(() => ({}));
      pedidos.set(qual, p);
    }
    p.then((x) => vivo && setM(x));
    return () => {
      vivo = false;
    };
  }, [qual]);
  return m;
}

function Captura({ id, on, larguras, tamanhos, urgente }: { id: string; on: boolean; larguras: [number, number]; tamanhos: string; urgente?: boolean }) {
  return (
    <img
      src={`/shots/${id}-m.webp`}
      srcSet={`/shots/${id}-m.webp ${larguras[0]}w, /shots/${id}.webp ${larguras[1]}w`}
      sizes={tamanhos}
      alt=""
      draggable={false}
      loading={urgente ? "eager" : "lazy"}
      decoding="async"
      className="captura"
      data-on={on ? "" : undefined}
      // Uma captura em falta não deixa o ícone de imagem partida dentro do aparelho.
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}

/**
 * Só a captura à vista e as duas vizinhas ficam montadas.
 *
 * Uma captura da consola tem 3840×2160: aberta, ocupa mais de 30 MB de memória
 * de imagem. Com as doze empilhadas ao mesmo tempo o scroll arrastava-se. As
 * vizinhas chegam para a troca entre passos seguidos continuar a ser suave.
 */
function perto(capturas: string[], atual: string): string[] {
  const i = capturas.indexOf(atual);
  return i < 0 ? [atual] : capturas.slice(Math.max(0, i - 1), i + 2);
}

/** O que o ecrã da consola mostra num dado passo. */
export type Plano = {
  captura: string;
  /** O nome de um foco do manifesto, para onde a câmara se aproxima. */
  foco?: string;
  /** Quanto se aproxima. Sem foco, não há aproximação. */
  zoom?: number;
  /** O nome de um foco a contornar a colete. */
  realce?: string;
  /**
   * Para onde a câmara aponta no telemóvel, quando não é o `foco` nem o `realce`.
   * No telemóvel só se vê parte da consola, e em páginas com uma janela aberta
   * por cima é a janela que tem de ficar à vista.
   */
  focoMovel?: string;
};

const entre = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));

/** No telemóvel, a altura do ecrã da consola em proporção da largura. Igual a `.monitor-ecra` no CSS. */
const ECRA_ALTO = 1.15;

/** Onde acaba o menu lateral da consola, em fração da largura da captura. */
const MENU_LATERAL = 0.124;

/**
 * O ecrã da consola.
 *
 * Só a captura, de cantos redondos, sem barra de endereço. A câmara é uma transformação: aproxima-se do foco pedido
 * sem nunca deixar ver para lá das margens da captura.
 */
export function Monitor({
  capturas,
  plano,
  className,
  style,
  urgente,
}: {
  capturas: string[];
  plano: Plano;
  className?: string;
  style?: CSSProperties;
  urgente?: boolean;
}) {
  const manifesto = useManifesto("consola");
  const estreito = useEstreito();
  const entrada = manifesto[plano.captura];
  const L = entrada?.largura ?? 1920;
  const A = entrada?.altura ?? 1080;

  const foco = plano.foco ? entrada?.focos?.[plano.foco] : undefined;

  /*
   * No telemóvel o ecrã fica alto (`--ecra-r` no CSS) e a captura enche-o de
   * cima a baixo: em vez da consola inteira, minúscula, vê-se a parte que
   * interessa, já legível. Sem foco, a câmara fica na área de trabalho, à
   * direita do menu lateral.
   */
  const R = estreito ? ECRA_ALTO / (A / L) : 1;
  let z: number, tx: number, ty: number;
  if (estreito) {
    // Mostra cerca de 40% da largura da consola, alinhado à esquerda do que
    // interessa: o texto lê-se a partir do início das linhas, sem cortes à esquerda.
    const nome = plano.focoMovel ?? plano.foco ?? plano.realce;
    const fm = nome ? entrada?.focos?.[nome] : undefined;
    z = R * 1.25 * (foco ? Math.min(plano.zoom ?? 1, 1.2) : 1);
    const vx = 1 / z;
    const vy = R / z;
    const [x0, y0] = fm
      ? [
          fm[2] / L > vx ? fm[0] / L - 0.008 : (fm[0] + fm[2] / 2) / L - vx / 2,
          fm[3] / A > vy ? fm[1] / A - 0.01 : (fm[1] + fm[3] / 2) / A - vy / 2,
        ]
      : [MENU_LATERAL, 0];
    tx = entre(-x0 * z, 1 - z, 0);
    ty = entre(-y0 * z, R - z, 0);
  } else {
    z = foco ? (plano.zoom ?? 1.8) : 1;
    tx = foco ? entre(0.5 - ((foco[0] + foco[2] / 2) / L) * z, 1 - z, 0) : 0;
    ty = foco ? entre(0.5 - ((foco[1] + foco[3] / 2) / A) * z, 1 - z, 0) : 0;
  }

  const realce = plano.realce ? entrada?.focos?.[plano.realce] : undefined;

  return (
    <div className={cx("monitor", className)} style={style} aria-hidden>
      <div className="monitor-ecra">
        <div className="monitor-camara" style={{ transform: `translate(${tx * 100}%, ${ty * 100}%) scale(${z})` }}>
          {perto(capturas, plano.captura).map((id) => (
            <Captura
              key={id}
              id={id}
              on={id === plano.captura}
              larguras={[1920, 3840]}
              tamanhos="(min-width: 861px) 70vw, 100vw"
              urgente={urgente}
            />
          ))}
          {realce && (
            <span
              className="realce"
              style={{
                left: `${(realce[0] / L) * 100}%`,
                top: `${(realce[1] / A) * 100}%`,
                width: `${(realce[2] / L) * 100}%`,
                height: `${(realce[3] / A) * 100}%`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * O telemóvel.
 *
 * Mexe pouco: a cena pode dar-lhe uma rotação de poucos graus e uma escala
 * próxima de 1. O que vai por cima do ecrã (um aviso do sistema a chegar, por
 * exemplo) entra como `children`.
 */
export function Telemovel({
  capturas,
  atual,
  rot = 0,
  escala = 1,
  className,
  style,
  children,
  urgente,
}: {
  capturas: string[];
  atual: string;
  rot?: number;
  escala?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  urgente?: boolean;
}) {
  return (
    <div
      className={cx("telemovel", className)}
      style={{ ...style, transform: `rotate(${rot}deg) scale(${escala})` }}
      aria-hidden
    >
      <div className="telemovel-ecra">
        {perto(capturas, atual).map((id) => (
          <Captura key={id} id={id} on={id === atual} larguras={[585, 1170]} tamanhos="(min-width: 861px) 420px, 300px" urgente={urgente} />
        ))}
        {children}
      </div>
    </div>
  );
}

/**
 * Um aviso do sistema a chegar ao telemóvel.
 *
 * É a única coisa desenhada dentro do telemóvel: um aviso push é do sistema
 * operativo e não da app, por isso não há ecrã do produto para capturar.
 */
export function AvisoPush({ on, titulo, texto, hora = "agora" }: { on: boolean; titulo: string; texto: string; hora?: string }) {
  return (
    <div className="aviso-push" data-on={on ? "" : undefined}>
      <img src="/clube/emblema.svg" alt="" />
      <div className="min-w-0">
        <p className="flex items-baseline justify-between gap-2">
          <b>{titulo}</b>
          <span>{hora}</span>
        </p>
        <p>{texto}</p>
      </div>
    </div>
  );
}
