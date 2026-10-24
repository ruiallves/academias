"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, DoorOpen, Landmark, Loader2, MapPin, Smartphone, Sun } from "lucide-react";
import { BotaoLink } from "@/componentes/Botao";
import { FundoDaBilheteira } from "@/componentes/bilheteira/Fundo";
import { Picotado } from "@/componentes/bilheteira/Picotado";
import { CHAVE_DEMO, confronto, dataDoJogo, euroDeCents, type Pedido, type PedidoDeDemonstracao } from "@/lib/bilheteira";

/**
 * O que quem comprou vê depois de carregar em "Pagar", e o endereço que vai
 * no email: `/bilhete/<token>`.
 *
 * - **a pagar**: a contagem até ao fim dos 10 minutos, e o que fazer (aceitar
 *   na app MB WAY, ou a entidade e a referência Multibanco). Volta a
 *   perguntar à API de 4 em 4 segundos até o estado mudar.
 * - **pago**: um cartão por bilhete, com o código QR grande, em fundo branco e
 *   com margem, para o leitor da porta o apanhar mesmo ao sol.
 * - **expirado**, **fora do prazo** e **anulado**: o que aconteceu, o que é
 *   devolvido, e o caminho de volta à bilheteira.
 *
 * Em demonstração não há API: lê a compra fingida que a página da compra
 * guardou neste separador (paga ao fim de alguns segundos), ou mostra o
 * exemplo que a página do servidor montou.
 */

type Props = {
  slug: string;
  token: string;
  api: string;
  demonstracao: boolean;
  /** Só em demonstração: a compra paga a mostrar quando não há compra fingida guardada. */
  exemplo: Pedido | null;
  /** O nome curto do clube, para "AD Monte Verde vs SC Vianense". */
  clube: string;
  /** O emblema do clube, para a cabeça de cada bilhete. */
  logoUrl?: string;
};

type Carga = { fase: "a-ler" } | { fase: "pronto"; pedido: Pedido } | { fase: "nao-existe" } | { fase: "falhou" };

const INTERVALO_MS = 4000;

export function PaginaDoBilhete({ slug, token, api, demonstracao, exemplo, clube, logoUrl }: Props) {
  const [carga, setCarga] = useState<Carga>({ fase: "a-ler" });

  const obter = useCallback(async (): Promise<Carga> => {
    if (demonstracao) return { fase: "pronto", pedido: lerDemonstracao(token) ?? exemplo! };
    try {
      const r = await fetch(`${api}/api/clubes/${encodeURIComponent(slug)}/bilhetes/pedido/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (r.status === 404) return { fase: "nao-existe" };
      if (!r.ok) return { fase: "falhou" };
      return { fase: "pronto", pedido: (await r.json()) as Pedido };
    } catch {
      return { fase: "falhou" };
    }
  }, [api, slug, token, demonstracao, exemplo]);

  // Pergunta já, e outra vez de 4 em 4 segundos enquanto falta pagar. Uma falha
  // de rede a meio não apaga o que já se via: tenta-se outra vez.
  useEffect(() => {
    let vivo = true;
    let espera: number | undefined;
    let jaViu = false;
    const ler = async () => {
      const r = await obter();
      if (!vivo) return;
      if (r.fase === "pronto") {
        jaViu = true;
        setCarga(r);
      } else if (r.fase === "nao-existe" || !jaViu) {
        setCarga(r);
      }
      if (r.fase === "falhou" || (r.fase === "pronto" && r.pedido.estado === "a-pagar")) {
        espera = window.setTimeout(ler, INTERVALO_MS);
      }
    };
    void ler();
    return () => {
      vivo = false;
      window.clearTimeout(espera);
    };
  }, [obter]);

  if (carga.fase === "a-ler") {
    return (
      <div className="container-site grid min-h-[50vh] place-items-center py-24 text-ink-3" role="status">
        <Loader2 size={28} className="animate-spin" aria-hidden />
        <span className="sr-only">A abrir a compra</span>
      </div>
    );
  }

  if (carga.fase === "nao-existe" || carga.fase === "falhou") {
    return (
      <>
        <Cabecalho titulo={carga.fase === "nao-existe" ? "Não encontrámos esta compra" : "Não foi possível abrir a compra"} />
        <div className="container-site mt-10 max-w-3xl">
          <p className="text-ink-2">
            {carga.fase === "nao-existe"
              ? "Confirma o endereço no email que recebeste depois de comprar."
              : "Verifica a internet. A página tenta outra vez sozinha."}
          </p>
          <VoltarABilheteira />
        </div>
      </>
    );
  }

  const p = carga.pedido;
  const nomeDoJogo = p.jogo ? confronto(clube, p.jogo.opponent, p.jogo.isHome !== false) : null;
  const jogo = p.jogo ? (
    <>
      <span className="font-semibold text-night-ink">{nomeDoJogo}</span> · {p.jogo.teamName}
      <br />
      {dataDoJogo(p.jogo.startsAt)}
      {p.jogo.local ? ` · ${p.jogo.local}` : ""}
    </>
  ) : null;

  const titulos: Record<Pedido["estado"], string> = {
    "a-pagar": "Falta pagar",
    pago: p.bilhetes.length === 1 ? "O teu bilhete" : "Os teus bilhetes",
    expirado: "O prazo para pagar acabou",
    "fora-do-prazo": "O pagamento chegou fora do prazo",
    anulado: "Esta compra foi anulada",
  };

  return (
    <>
      <Cabecalho titulo={titulos[p.estado]} linha={jogo} />
      <div className={`container-site mt-10 ${p.estado === "pago" ? "max-w-5xl" : "max-w-3xl"}`}>
        {p.estado === "a-pagar" && <APagar pedido={p} />}
        {p.estado === "pago" && <Pago pedido={p} clube={clube} logoUrl={logoUrl} nomeDoJogo={nomeDoJogo} />}
        {p.estado === "expirado" && (
          <Explicacao>
            <p>Os 10 minutos para pagar acabaram e os lugares voltaram à venda.</p>
            {p.pagamento?.metodo !== "MBWAY" && <p>Não pagues a referência desta compra.</p>}
            <p>Se ainda quiseres ir ao jogo, faz uma compra nova.</p>
          </Explicacao>
        )}
        {p.estado === "fora-do-prazo" && (
          <Explicacao>
            <p>O pagamento chegou depois dos 10 minutos, quando os lugares já tinham voltado à venda. Por isso esta compra não tem bilhetes.</p>
            <Reembolso reembolso={p.reembolso} />
          </Explicacao>
        )}
        {p.estado === "anulado" && (
          <Explicacao>
            <p>O clube anulou esta compra e os bilhetes deixaram de valer.</p>
            <Reembolso reembolso={p.reembolso} />
          </Explicacao>
        )}
        {demonstracao && <p className="mt-8 text-xs text-ink-3">Isto é uma demonstração: não se pagou nada e os códigos não abrem porta nenhuma.</p>}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* As partes                                                                    */
/* -------------------------------------------------------------------------- */

function Cabecalho({ titulo, linha }: { titulo: string; linha?: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden bg-night text-night-ink">
      <FundoDaBilheteira />
      <div className="container-site relative py-12 sm:py-16">
        <p className="eyebrow text-night-ink-2">Bilheteira</p>
        <h1 className="display mt-3 text-4xl text-night-ink sm:text-6xl">{titulo}</h1>
        {linha && <p className="mt-5 max-w-2xl text-lg leading-relaxed text-night-ink-2">{linha}</p>}
      </div>
    </section>
  );
}

function VoltarABilheteira() {
  return (
    <BotaoLink href="/bilheteira" variante="contorno" className="mt-8">
      Voltar à bilheteira
    </BotaoLink>
  );
}

function Explicacao({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="space-y-3 text-lg text-ink-2">{children}</div>
      <VoltarABilheteira />
    </div>
  );
}

function Reembolso({ reembolso }: { reembolso: Pedido["reembolso"] }) {
  if (!reembolso) return null;
  const valor = euroDeCents(reembolso.valorCents);
  return reembolso.feito ? (
    <p className="font-semibold text-ink">O clube já te devolveu {valor}.</p>
  ) : (
    <p>
      <span className="font-semibold text-ink">O clube vai devolver-te {valor}.</span> Se tiveres dúvidas,{" "}
      <Link href="/contactos?assunto=Bilhetes" className="font-semibold text-signal-ink hover:underline">
        fala com o clube
      </Link>
      .
    </p>
  );
}

/** A contagem e o que fazer para pagar. */
function APagar({ pedido: p }: { pedido: Pedido }) {
  const falta = useFalta(p.reservadoAte);
  const pag = p.pagamento;
  const valor = euroDeCents(pag?.valorCents ?? p.totalCents);
  const min = Math.floor(falta / 60);
  const seg = falta % 60;
  // A barra encolhe ao longo dos 10 minutos; no último minuto fica da cor de alerta.
  const fracao = Math.min(1, falta / 600);
  const pouco = falta <= 60;

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        <div className="flex flex-wrap items-end justify-between gap-4 p-5 sm:p-7">
          <div>
            <p className="text-sm font-semibold text-ink-3">Lugares guardados durante</p>
            <p className={`display mt-1 text-6xl tabular sm:text-7xl ${pouco ? "text-warn" : "text-ink"}`} role="timer" aria-live="off">
              {String(min).padStart(2, "0")}:{String(seg).padStart(2, "0")}
            </p>
          </div>
          <p className="flex items-center gap-2 pb-2 text-sm text-ink-2" role="status">
            <Loader2 size={16} className="animate-spin text-signal-ink" aria-hidden />
            À espera do pagamento
          </p>
        </div>
        <div className="h-1.5 bg-sunken" aria-hidden>
          <div className={`h-full origin-left transition-transform duration-1000 ease-linear ${pouco ? "bg-warn" : "bg-signal"}`} style={{ transform: `scaleX(${fracao})` }} />
        </div>
        {falta === 0 && <p className="px-5 py-3 text-sm text-ink-2 sm:px-7">O tempo acabou. A confirmar se o pagamento chegou.</p>}
      </div>

      {pag?.metodo === "MBWAY" ? (
        <div className="flex gap-5 rounded-card bg-surface p-5 shadow-card sm:p-7">
          <span className="relative grid size-14 shrink-0 place-items-center rounded-full bg-signal-strong text-signal-on">
            <span className="absolute inset-0 animate-ping rounded-full bg-signal opacity-25 motion-reduce:hidden" aria-hidden />
            <Smartphone size={26} aria-hidden />
          </span>
          <div>
            <p className="display text-2xl text-ink">Abre a app MB WAY</p>
            <p className="mt-1.5 text-ink-2">
              Enviámos um pedido de <strong className="font-semibold text-ink">{valor}</strong> para o teu telemóvel. Aceita-o nos próximos 5 minutos; depois disso caduca e tens de comprar outra vez.
            </p>
          </div>
        </div>
      ) : pag ? (
        <div className="overflow-hidden rounded-card bg-surface shadow-card">
          <div className="flex items-center gap-4 border-b border-line p-5 sm:px-7">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-signal-soft text-signal-ink">
              <Landmark size={20} aria-hidden />
            </span>
            <div>
              <p className="display text-2xl text-ink">Paga por Multibanco</p>
              <p className="text-sm text-ink-2">Em Pagamentos de serviços, no homebanking ou numa caixa.</p>
            </div>
          </div>
          <dl className="divide-y divide-line px-5 sm:px-7">
            <Dado rotulo="Entidade" valor={pag.entidade ?? ""} copiar={pag.entidade ?? ""} />
            <Dado rotulo="Referência" valor={agrupar(pag.referencia ?? "")} copiar={pag.referencia ?? ""} />
            <Dado rotulo="Valor" valor={valor} copiar={(pag.valorCents / 100).toFixed(2).replace(".", ",")} />
          </dl>
          <p className="bg-warn/10 px-5 py-3.5 text-sm font-semibold text-warn sm:px-7">
            Paga dentro dos 10 minutos. Fora deles não há bilhetes e o valor é devolvido.
          </p>
        </div>
      ) : null}

      <p className="text-sm text-ink-3">Esta página muda sozinha quando o pagamento chegar. Podes deixá-la aberta.</p>
    </div>
  );
}

/** Uma linha da referência Multibanco: o rótulo, o número em grande e o botão de copiar. */
function Dado({ rotulo, valor, copiar }: { rotulo: string; valor: string; copiar: string }) {
  const [copiado, setCopiado] = useState(false);
  const copiarAgora = async () => {
    try {
      await navigator.clipboard.writeText(copiar);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem acesso à área de transferência (browser antigo, página sem HTTPS): o número está à vista.
    }
  };
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0">
        <dt className="eyebrow text-ink-3">{rotulo}</dt>
        <dd className="display mt-1.5 text-3xl tabular text-ink sm:text-4xl">{valor}</dd>
      </div>
      <button
        type="button"
        onClick={() => void copiarAgora()}
        aria-label={`Copiar ${rotulo.toLowerCase()}`}
        className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition ${
          copiado ? "border-ok/40 bg-ok/10 text-ok" : "border-line-strong text-ink hover:border-ink"
        }`}
      >
        {copiado ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
        <span aria-live="polite">{copiado ? "Copiado" : "Copiar"}</span>
      </button>
    </div>
  );
}

/**
 * Os bilhetes de uma compra paga, um bilhete por pessoa: a cabeça na cor do
 * clube com o jogo, o picotado, e o código QR grande em fundo branco, com a
 * bancada e a porta por baixo.
 */
function Pago({ pedido: p, clube, logoUrl, nomeDoJogo }: { pedido: Pedido; clube: string; logoUrl?: string; nomeDoJogo: string | null }) {
  const n = p.bilhetes.length;
  return (
    <div>
      <div className="flex flex-wrap items-start gap-4 rounded-card bg-surface p-5 shadow-card sm:items-center sm:p-6">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-ok/10 text-ok">
          <Check size={22} strokeWidth={3} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold text-ink">{n === 1 ? "Está pago. Mostra este código à entrada." : `Está pago. Tens ${n} bilhetes, cada um entra uma vez.`}</p>
          <p className="mt-0.5 text-ink-2">Os bilhetes também seguiram por email{n > 1 ? ", e cada pessoa pode entrar com o seu" : ""}.</p>
        </div>
        <p className="flex items-center gap-2 text-sm text-ink-3">
          <Sun size={16} aria-hidden />
          Sobe o brilho à porta
        </p>
      </div>

      <ul className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {p.bilhetes.map((b, i) => (
          <li key={b.id}>
            <article className={`overflow-hidden rounded-card bg-surface shadow-card ${b.usado ? "opacity-70" : ""}`}>
              {/* A cabeça: o clube e o jogo. */}
              <div className="relative overflow-hidden bg-signal-strong px-5 pb-6 pt-5 text-signal-on">
                <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-white/10" />
                <div className="relative flex items-start gap-3">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="" className="size-10 shrink-0 rounded-full bg-white/95 object-contain p-1" />
                  ) : (
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/15 text-sm font-bold">{clube.slice(0, 2).toUpperCase()}</span>
                  )}
                  <div className="min-w-0">
                    <p className="eyebrow opacity-80">
                      Bilhete {i + 1} de {n}
                    </p>
                    <p className="mt-1 line-clamp-2 font-bold leading-snug">{nomeDoJogo ?? clube}</p>
                  </div>
                </div>
                {p.jogo && <p className="relative mt-3 text-sm opacity-90">{dataDoJogo(p.jogo.startsAt)}</p>}
              </div>

              <Picotado orientacao="deitado" fundo="bg-canvas" />

              <div className="relative bg-white p-4">
                <CodigoQR texto={b.codigo} apagado={b.usado} rotulo={`Código do bilhete ${i + 1}`} />
                {b.usado && (
                  <p className="absolute inset-0 grid place-items-center">
                    <span className="rounded-sm bg-ink px-3 py-1.5 text-sm font-bold uppercase tracking-wider text-canvas">Já usado</span>
                  </p>
                )}
              </div>

              <div className="border-t border-dashed border-line px-5 pb-5 pt-4">
                <p className="display text-xl text-ink">{b.tipo}</p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  {b.bancada && (
                    <div className="rounded-control bg-sunken px-3 py-2">
                      <dt className="flex items-center gap-1 text-xs text-ink-3">
                        <MapPin size={12} aria-hidden />
                        Bancada
                      </dt>
                      <dd className="mt-0.5 font-bold text-ink">{b.bancada}</dd>
                    </div>
                  )}
                  {b.porta && (
                    <div className="rounded-control bg-sunken px-3 py-2">
                      <dt className="flex items-center gap-1 text-xs text-ink-3">
                        <DoorOpen size={12} aria-hidden />
                        Entrada
                      </dt>
                      <dd className="mt-0.5 font-bold text-ink">{b.porta}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </article>
          </li>
        ))}
      </ul>
      <VoltarABilheteira />
    </div>
  );
}

/**
 * O código QR em SVG: nítido a qualquer tamanho, preto sobre branco, com a
 * margem de quatro módulos que os leitores pedem. Correção "M", a mesma do
 * email.
 */
function CodigoQR({ texto, apagado, rotulo }: { texto: string; apagado: boolean; rotulo: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    QRCode.toString(texto, { type: "svg", margin: 4, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((s) => vivo && setSvg(s))
      .catch(() => vivo && setSvg(null));
    return () => {
      vivo = false;
    };
  }, [texto]);

  return (
    <div
      role="img"
      aria-label={rotulo}
      className={`mx-auto aspect-square w-full max-w-[20rem] bg-white [&>svg]:block [&>svg]:h-full [&>svg]:w-full ${apagado ? "opacity-25" : ""}`}
      // O SVG é desenhado pela biblioteca a partir do código do bilhete: só caminhos, sem texto de ninguém.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                   */
/* -------------------------------------------------------------------------- */

/** Os segundos que faltam até `ate`, contados de segundo a segundo. */
function useFalta(ate: string): number {
  const calcular = useCallback(() => Math.max(0, Math.ceil((new Date(ate).getTime() - Date.now()) / 1000)), [ate]);
  const [falta, setFalta] = useState(calcular);
  useEffect(() => {
    setFalta(calcular());
    const id = window.setInterval(() => setFalta(calcular()), 1000);
    return () => window.clearInterval(id);
  }, [calcular]);
  return falta;
}

/** "123456789" → "123 456 789", como no talão do multibanco. */
function agrupar(ref: string): string {
  return ref.replace(/\s/g, "").replace(/(\d{3})(?=\d)/g, "$1 ");
}

/** A compra fingida da demonstração, se estiver neste separador. Paga ao fim de alguns segundos. */
function lerDemonstracao(token: string): Pedido | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE_DEMO(token));
    if (!bruto) return null;
    const { pedido, pagoEm } = JSON.parse(bruto) as PedidoDeDemonstracao;
    if (pedido.estado === "a-pagar") {
      if (Date.now() >= pagoEm) return { ...pedido, estado: "pago", pagamento: null };
      return { ...pedido, bilhetes: [] };
    }
    return pedido;
  } catch {
    return null;
  }
}
