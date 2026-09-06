import type { ReactNode } from "react";
import { cx } from "./primitives";

/**
 * A app do clube, reconstruída — a escolha de área e a área de sócio.
 *
 * Vive à parte de `shots.tsx` pela mesma razão que a área técnica vive em
 * `shots-treino.tsx`: são peças compridas, e um ficheiro de mil linhas com três
 * produtos lá dentro deixa de se navegar.
 *
 * O que está aqui desenhado existe (`apps/family`): a mesma instalação, a mesma
 * conta, e a área muda conforme a relação de quem entra. Como o resto dos
 * *shots*, usa os tokens do produto — neutros quentes, verde de campo — e cede
 * o lugar a capturas verdadeiras se elas aparecerem em `public/shots/`.
 */

/* -------------------------------------------------------------------------- */
/* A moldura                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A moldura do telemóvel.
 *
 * As medidas são as do `AppShot`, que as estreou: 288px de conteúdo dão a
 * proporção de um telemóvel a sério (perto de 1:2), e um aparelho com
 * proporções erradas lê-se como maqueta — exactamente o oposto do que estas
 * peças existem para fazer.
 *
 * ## Encolher é `zoom`, e não `width`
 *
 * Dois telemóveis lado a lado não cabem a 288px cada. Estreitar a moldura
 * estreitaria só a caixa: o texto lá dentro está em pixels fixos e ficaria
 * apertado contra as margens — um telemóvel a sério não muda de tipografia
 * quando é mais pequeno. O `zoom` encolhe o desenho inteiro **e** o espaço que
 * ele ocupa, que é precisamente o que um `transform: scale` não faz (deixaria
 * o buraco do tamanho original). Um navegador antigo que o ignore mostra a peça
 * em tamanho natural — maior do que o previsto, nunca partida.
 */
export function Telemovel({
  children,
  className,
  shot,
  scale,
}: {
  children: ReactNode;
  className?: string;
  shot?: string;
  scale?: number;
}) {
  return (
    <div
      className={cx(
        "shot relative w-[288px] shrink-0 overflow-hidden rounded-[38px] border-[7px] border-[#0c100f] bg-[#f6f5f2] shadow-[0_24px_60px_-28px_rgb(12_16_15/0.55)]",
        className,
      )}
      style={scale ? { zoom: scale } : undefined}
      aria-hidden
    >
      {/* A captura verdadeira, quando existir — cobre o interior e deixa a moldura. */}
      {shot && (
        <img
          src={shot}
          alt=""
          loading="lazy"
          className="absolute inset-0 z-10 h-full w-full object-cover"
          onError={(e) => e.currentTarget.remove()}
        />
      )}

      <div className="flex items-center justify-between px-4 pt-2.5 pb-1 text-[9px] font-semibold text-[#1a1917]">
        <span>9:41</span>
        <span className="h-[7px] w-[16px] rounded-[2px] border border-[#1a1917]" />
      </div>

      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Ícones                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Os glifos das áreas — traço de 1.75px, 24×24, a mesma linguagem do
 * `lucide-react` que a app usa a sério, redesenhados aqui em vez de trazer a
 * biblioteca inteira para o site por causa de três desenhos.
 */
function AreaIcon({ id, className }: { id: "staff" | "familia" | "socio"; className?: string }) {
  const s = {
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };
  const p = { viewBox: "0 0 24 24", "aria-hidden": true, className };

  if (id === "staff") {
    // Pasta: o trabalho no clube.
    return (
      <svg {...p}>
        <rect x="3" y="7.5" width="18" height="12.5" rx="2.2" {...s} />
        <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3 12.5h18" {...s} />
      </svg>
    );
  }
  if (id === "familia") {
    // Duas pessoas, uma à frente da outra.
    return (
      <svg {...p}>
        <circle cx="9" cy="8.5" r="3.2" {...s} />
        <path d="M2.5 19.5a6.5 6.5 0 0 1 13 0M16 5.6a3.2 3.2 0 0 1 0 5.8M18 19.5a6.4 6.4 0 0 0-2-4.6" {...s} />
      </svg>
    );
  }
  // Cartão com retrato — o cartão de sócio.
  return (
    <svg {...p}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.4" {...s} />
      <circle cx="8.5" cy="11" r="2.2" {...s} />
      <path d="M5 16.2a3.8 3.8 0 0 1 7 0M14.5 10h4M14.5 13.5h4" {...s} />
    </svg>
  );
}

/** Os separadores da área de sócio: Início, Cartão, Quotas, Clube. */
function SocioTabIcon({ id, className }: { id: string; className?: string }) {
  const s = {
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };
  const p = { viewBox: "0 0 24 24", "aria-hidden": true, className };

  switch (id) {
    case "inicio":
      return (
        <svg {...p}>
          <path d="M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-9.5Z" {...s} />
        </svg>
      );
    case "cartao":
      return <AreaIcon id="socio" className={className} />;
    case "quotas":
      return (
        <svg {...p}>
          <rect x="3" y="6" width="18" height="13" rx="2.4" {...s} />
          <path d="M3 10.5h18" {...s} />
          <circle cx="16.5" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "clube":
      return (
        <svg {...p}>
          <path d="M4 10v4a1 1 0 0 0 1 1h3l6 4V5l-6 4H5a1 1 0 0 0-1 1Z" {...s} />
          <path d="M17.5 9.5a3.5 3.5 0 0 1 0 5" {...s} />
        </svg>
      );
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* A escolha de área                                                           */
/* -------------------------------------------------------------------------- */

const AREAS = [
  {
    id: "staff" as const,
    label: "Staff",
    hint: "Equipa técnica — a consola do clube: atletas, equipas, calendário e o resto do teu trabalho.",
  },
  {
    id: "familia" as const,
    label: "Família",
    hint: "Acompanha os teus atletas: treinos, convocatórias, avaliações e pagamentos.",
  },
  { id: "socio" as const, label: "Sócio", hint: "O teu cartão, as quotas, os jogos e as novidades do clube." },
];

/**
 * "Como queres continuar?" — o ecrã que resume a app inteira.
 *
 * É a única imagem que prova a tese sem precisar de uma frase a segurá-la: uma
 * instalação, uma conta, três áreas conforme a relação de quem entra. Reproduz
 * o ecrã real (`apps/family/src/screens/socio/EscolherArea.tsx`), incluindo a
 * ordem — Staff primeiro, porque quem tem trabalho no clube abre a app para o
 * trabalho — e a nota do fim, que é o que tira o receio de escolher mal.
 *
 * Este ecrã só aparece a quem tem **mais do que uma** área: quem é só pai entra
 * direto na Família e nunca o vê. A peça não o diz — dizê-lo é trabalho do texto
 * ao lado, e uma legenda dentro de um telemóvel desenhado é uma legenda que
 * ninguém lê.
 */
export function EscolhaAreaShot({
  className,
  shot = "/shots/app-areas.png",
  scale,
}: {
  className?: string;
  shot?: string;
  scale?: number;
}) {
  return (
    <Telemovel className={className} shot={shot} scale={scale}>
      <div className="flex min-h-[556px] flex-col justify-center gap-6 px-5 py-8">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <span className="flex size-11 items-center justify-center rounded-[14px] bg-[#0f6b62] text-[12px] font-bold text-white shadow-[0_8px_18px_-10px_rgb(12_16_15/0.6)]">
            LC
          </span>
          <div>
            <div className="text-[17px] leading-tight font-semibold tracking-[-0.025em] text-[#1a1917]">
              Bem-vindo de volta, Sandra 👋
            </div>
            <div className="mt-1 text-[11px] text-[#8a867c]">Como queres continuar?</div>
          </div>
        </div>

        <div className="space-y-2.5">
          {AREAS.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 rounded-[18px] bg-white p-3.5 shadow-[0_1px_2px_rgb(20_18_15/0.04),0_10px_30px_-16px_rgb(20_18_15/0.14)]"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-[#e7f0ee] text-[#0a4c45]">
                <AreaIcon id={a.id} className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-[#1a1917]">{a.label}</span>
                <span className="mt-0.5 block text-[9.5px] leading-snug text-[#8a867c]">{a.hint}</span>
              </span>
            </div>
          ))}
        </div>

        <p className="text-center text-[9px] text-[#ada89d]">Podes trocar a qualquer momento, sem sair da conta.</p>
      </div>
    </Telemovel>
  );
}

/* -------------------------------------------------------------------------- */
/* A área de sócio                                                             */
/* -------------------------------------------------------------------------- */

/**
 * O código do cartão, desenhado.
 *
 * Um QR a sério codifica um segredo do sócio; este é um padrão fixo com os três
 * alvos nos cantos e as linhas de sincronismo — a forma, sem conteúdo nenhum.
 * Pôr um código legível numa página pública seria pôr lá um código que alguém
 * lê; e gerar o padrão ao acaso mudava o desenho a cada render, que é como uma
 * imagem de produto deixa de ser a mesma imagem.
 */
const QR =
  "111111101101001111111100000101101101000001101110101110101011101101110101000101011101101110100101101011101100000101101001000001111111101010101111111000000001011000000000110010100101101010000100010000100001101111101110110000111001111001111000000100001110111111111110011111001000000000111101100101111111100000111000110100000100000010111110101110100100011111000101110100001000001010101110100110011100100100000100101100001001111111101110111011001";

function QrDesenho({ size = 112 }: { size?: number }) {
  const n = 21;
  const cells = [];
  for (let i = 0; i < n * n; i++) {
    if (QR[i] !== "1") continue;
    cells.push(<rect key={i} x={i % n} y={Math.floor(i / n)} width="1" height="1" />);
  }
  return (
    <svg
      viewBox="-1 -1 23 23"
      width={size}
      height={size}
      aria-hidden
      shapeRendering="crispEdges"
      className="rounded-[8px] bg-white"
    >
      <g fill="#0b0e11">{cells}</g>
    </svg>
  );
}

/**
 * A área de sócio — o separador "Cartão".
 *
 * Escolhido entre os quatro (Início, Cartão, Quotas, Clube) porque é o que se
 * explica sozinho a quem nunca viu o produto: um cartão com a cor do clube e um
 * código para mostrar à porta. Reproduz o ecrã real
 * (`apps/family/src/screens/socio/SocioApp.tsx`) — o cabeçalho com o número de
 * sócio e o botão de trocar de área, o cartão com o brilho diagonal que o faz
 * parecer cartão e não rectângulo, e a mesma pílula de navegação da área da
 * família, porque quem troca de área não deve sentir que mudou de produto.
 */
export function SocioShot({
  className,
  shot = "/shots/app-socio.png",
  scale,
}: {
  className?: string;
  shot?: string;
  scale?: number;
}) {
  return (
    <Telemovel className={className} shot={shot} scale={scale}>
      {/* Cabeçalho — o clube, o número de sócio, e a porta para as outras áreas. */}
      <div className="flex items-center gap-2 px-4 pt-1.5 pb-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[#0f6b62] text-[10px] font-bold text-white">
          LC
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] leading-tight font-semibold text-[#1a1917]">Life Club</div>
          <div className="truncate text-[9.5px] text-[#8a867c]">Sócio #128</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1 rounded-full border border-[#e2ded6] px-2 py-1 text-[8.5px] font-semibold text-[#524f48]">
            Área
            <svg viewBox="0 0 24 24" aria-hidden className="size-[9px]">
              <path
                d="M6 9l6 6 6-6"
                stroke="currentColor"
                strokeWidth="2.4"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="flex size-7 items-center justify-center rounded-full bg-[#e7f0ee] text-[9px] font-bold text-[#0a4c45]">
            SB
          </span>
        </div>
      </div>

      <div className="px-4">
        <div className="text-[9px] font-semibold tracking-[0.1em] text-[#8a867c] uppercase">O meu cartão</div>

        {/* O cartão, pintado pela cor do clube. */}
        <div
          className="relative mt-2 overflow-hidden rounded-[18px] p-4 text-white"
          style={{
            background: "linear-gradient(135deg, #0a4c45 0%, #0f6b62 55%, #0b5750 100%)",
            boxShadow: "0 14px 34px -20px rgb(12 16 15 / 0.6)",
          }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -top-1/2 -right-1/4 aspect-square w-[120%] rounded-full"
            style={{ background: "radial-gradient(closest-side, rgba(255,255,255,0.16), transparent 70%)" }}
          />
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-[9px] bg-white/15 text-[9px] font-bold">
              LC
            </span>
            <span className="text-[11px] font-semibold [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">Life Club</span>
          </div>
          <div className="mt-5">
            <p className="text-[8px] font-semibold tracking-[0.1em] uppercase opacity-80">Cartão de sócio</p>
            <p className="mt-0.5 text-[17px] leading-tight font-semibold tracking-[-0.02em] [text-shadow:0_1px_3px_rgba(0,0,0,0.4)]">
              Sandra Bragança
            </p>
            <div className="mt-1 flex items-center gap-1.5 text-[10px]">
              <span className="font-semibold tabular">#128</span>
              <span aria-hidden className="opacity-60">
                ·
              </span>
              <span className="opacity-90">Sócio efetivo</span>
            </div>
          </div>
          <div className="mt-4 flex items-end justify-between gap-2">
            <span className="text-[8.5px] opacity-80">Sócio desde 2019</span>
            <span className="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[8px] font-semibold">
              <span aria-hidden className="size-1.5 rounded-full bg-white" />
              Sócio ativo
            </span>
          </div>
        </div>

        {/* O código — o que se mostra à porta. */}
        <div className="mt-2.5 flex flex-col items-center rounded-[18px] bg-white p-3.5 shadow-[0_1px_2px_rgb(20_18_15/0.04),0_10px_30px_-16px_rgb(20_18_15/0.14)]">
          <QrDesenho />
          <p className="mt-2 max-w-[28ch] text-center text-[9px] leading-snug text-[#8a867c]">
            Mostra este código na entrada ou na secretaria para te identificares como sócio.
          </p>
        </div>

        {/* Quotas em dia — a confirmação discreta de que está tudo bem. */}
        <div className="mt-2.5 flex items-center gap-2.5 rounded-[15px] bg-white p-3 shadow-[0_1px_2px_rgb(20_18_15/0.04)]">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#e2efe6] text-[#1f6b3f]">
            <svg viewBox="0 0 24 24" aria-hidden className="size-[13px]">
              <path
                d="M5 12.5l4.5 4.5L19 7.5"
                stroke="currentColor"
                strokeWidth="2.4"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11.5px] font-semibold text-[#1a1917]">Quotas em dia</span>
            <span className="block text-[9.5px] text-[#8a867c]">Anuidade 2026 · 60,00 €</span>
          </span>
        </div>
      </div>

      {/* A pílula — a mesma da família, com os separadores do sócio. */}
      <div className="flex justify-center px-5 pt-4 pb-4">
        <div className="flex items-center gap-1 rounded-full bg-[#1a1917] px-2 py-1.5">
          {[
            { id: "inicio", label: "Início" },
            { id: "cartao", label: "Cartão", on: true },
            { id: "quotas", label: "Quotas" },
            { id: "clube", label: "Clube" },
          ].map((it) => (
            <span
              key={it.id}
              aria-label={it.label}
              className={cx(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-semibold",
                it.on ? "bg-white text-[#1a1917]" : "text-white/60",
              )}
            >
              <SocioTabIcon id={it.id} className="size-[15px]" />
              {it.on && it.label}
            </span>
          ))}
        </div>
      </div>
    </Telemovel>
  );
}
