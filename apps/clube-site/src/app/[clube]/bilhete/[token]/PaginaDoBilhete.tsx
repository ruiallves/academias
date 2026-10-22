"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Loader2, Smartphone } from "lucide-react";
import { BotaoLink } from "@/componentes/Botao";
import { CHAVE_DEMO, dataDoJogo, euroDeCents, type Pedido, type PedidoDeDemonstracao } from "@/lib/bilheteira";

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
};

type Carga = { fase: "a-ler" } | { fase: "pronto"; pedido: Pedido } | { fase: "nao-existe" } | { fase: "falhou" };

const INTERVALO_MS = 4000;

export function PaginaDoBilhete({ slug, token, api, demonstracao, exemplo, clube }: Props) {
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
      <div className="container-site grid place-items-center py-24 text-ink-3" role="status">
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
  const jogo = p.jogo ? (
    <>
      {clube} vs {p.jogo.opponent} · {p.jogo.teamName}
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
      <div className="container-site mt-10 max-w-3xl">
        {p.estado === "a-pagar" && <APagar pedido={p} />}
        {p.estado === "pago" && <Pago pedido={p} />}
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
    <div className="border-b border-line bg-surface">
      <div className="container-site py-10 sm:py-14">
        <p className="eyebrow text-signal-ink">Bilheteira</p>
        <h1 className="display mt-2 text-4xl sm:text-5xl">{titulo}</h1>
        {linha && <p className="mt-4 max-w-2xl text-lg text-ink-2">{linha}</p>}
      </div>
    </div>
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

  return (
    <div className="space-y-6">
      <div className="rounded-card bg-night p-5 text-night-ink sm:p-7">
        <p className="text-sm font-semibold text-night-ink-2">Os lugares estão guardados durante 10 minutos.</p>
        <p className="display mt-2 text-6xl tabular sm:text-7xl" role="timer" aria-live="off">
          {String(min).padStart(2, "0")}:{String(seg).padStart(2, "0")}
        </p>
        {falta === 0 && <p className="mt-2 text-sm text-night-ink-2">O tempo acabou. A confirmar se o pagamento chegou.</p>}
      </div>

      {pag?.metodo === "MBWAY" ? (
        <div className="flex gap-4 rounded-card border border-line bg-surface p-5">
          <Smartphone size={28} className="mt-0.5 shrink-0 text-signal-ink" aria-hidden />
          <div>
            <p className="text-xl font-semibold text-ink">Aceita o pedido na app MB WAY nos próximos 5 minutos.</p>
            <p className="mt-1 text-ink-2">
              Foi enviado um pedido de {valor} para o teu telemóvel. Depois disso o pedido caduca e tens de comprar outra vez.
            </p>
          </div>
        </div>
      ) : pag ? (
        <div className="rounded-card border border-line bg-surface p-5">
          <p className="text-xl font-semibold text-ink">Paga por Multibanco</p>
          <p className="mt-1 text-ink-2">Em Pagamentos de serviços, no homebanking ou numa caixa.</p>
          <dl className="mt-5 divide-y divide-line border-y border-line">
            <Dado rotulo="Entidade" valor={pag.entidade ?? ""} copiar={pag.entidade ?? ""} />
            <Dado rotulo="Referência" valor={agrupar(pag.referencia ?? "")} copiar={pag.referencia ?? ""} />
            <Dado rotulo="Valor" valor={valor} copiar={(pag.valorCents / 100).toFixed(2).replace(".", ",")} />
          </dl>
          <p className="mt-4 text-sm font-semibold text-ink">
            Paga dentro dos 10 minutos, no homebanking ou numa caixa. Fora dos 10 minutos não há bilhetes e o valor é devolvido.
          </p>
        </div>
      ) : null}

      <p className="flex items-center gap-2 text-sm text-ink-3" role="status">
        <Loader2 size={16} className="animate-spin" aria-hidden />
        À espera do pagamento. Esta página muda sozinha quando ele chegar.
      </p>
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
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <dt className="text-sm text-ink-3">{rotulo}</dt>
        <dd className="display text-3xl tabular text-ink sm:text-4xl">{valor}</dd>
      </div>
      <button
        type="button"
        onClick={() => void copiarAgora()}
        aria-label={`Copiar ${rotulo.toLowerCase()}`}
        className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-control border border-line-strong px-3 text-sm font-semibold text-ink transition hover:border-ink"
      >
        {copiado ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
        <span aria-live="polite">{copiado ? "Copiado" : "Copiar"}</span>
      </button>
    </div>
  );
}

/** Os bilhetes de uma compra paga, um cartão por pessoa. */
function Pago({ pedido: p }: { pedido: Pedido }) {
  const n = p.bilhetes.length;
  return (
    <div>
      <p className="text-xl font-semibold text-ink">Mostra este código à entrada. Cada bilhete entra uma vez.</p>
      <p className="mt-2 text-ink-2">
        Sobe o brilho do ecrã quando chegares à porta. Os bilhetes também seguem por email{n > 1 ? "; cada pessoa pode entrar com o seu" : ""}.
      </p>
      <ul className="mt-8 grid gap-5 sm:grid-cols-2">
        {p.bilhetes.map((b, i) => (
          <li key={b.id}>
            <article className="overflow-hidden rounded-card border border-line bg-white">
              <div className="relative p-3">
                <CodigoQR texto={b.codigo} apagado={b.usado} rotulo={`Código do bilhete ${i + 1}`} />
                {b.usado && (
                  <p className="absolute inset-0 grid place-items-center">
                    <span className="rounded-sm bg-ink px-3 py-1.5 text-sm font-bold uppercase tracking-wider text-canvas">Já usado</span>
                  </p>
                )}
              </div>
              <div className="border-t border-line p-4">
                <p className="eyebrow text-ink-3">
                  Bilhete {i + 1} de {n}
                </p>
                <p className="mt-1 text-lg font-semibold text-ink">{b.tipo}</p>
                <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                  {b.bancada && (
                    <>
                      <dt className="text-ink-3">Bancada</dt>
                      <dd className="font-semibold text-ink">{b.bancada}</dd>
                    </>
                  )}
                  {b.porta && (
                    <>
                      <dt className="text-ink-3">Entrada</dt>
                      <dd className="font-semibold text-ink">{b.porta}</dd>
                    </>
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
