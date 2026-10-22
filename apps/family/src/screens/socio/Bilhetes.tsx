import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import {
  Check,
  Clock,
  Copy,
  CreditCard,
  MapPin,
  Minus,
  Plus,
  QrCode,
  Smartphone,
  Sun,
  Ticket,
  TriangleAlert,
  X,
} from "lucide-react";
import { Chip, Label, cx, money, time } from "@/ui";
import { PAGAMENTOS_DESATIVADOS, doMetodo, useCotacao } from "@/lib/cotacao";
import { useSocio, type SocioMatch } from "@/lib/socio";
import { quandoDoJogo } from "@/lib/jogos-por-dia";
import {
  MAXIMO_POR_COMPRA,
  carregarPedidos,
  comprarBilhetes,
  useBilhetes,
  vendaDoJogo,
  type Compra,
  type LugarAnual,
  type Metodo,
  type Pedido,
  type TipoDeBilhete,
  type VendaDoSocio,
} from "@/lib/bilhetes";

/**
 * A bilheteira na área de sócio.
 *
 * Três coisas, cada uma no sítio onde se procura:
 *
 *  - **comprar**, a partir do jogo (separador Jogos e o próximo jogo do Início):
 *    o botão "Bilhetes" só aparece com a venda aberta;
 *  - **os bilhetes comprados**, no Início, por cima do cartão: é o Início que se
 *    abre à porta do estádio, e no dia do jogo é o bilhete que se mostra;
 *  - **o lugar anual**, no Início, logo a seguir ao cartão: é do sócio a época
 *    inteira, como o cartão.
 *
 * As regras são do servidor (`docs/09-bilheteira.md`). Aqui só se desenha o que
 * a venda diz e se impede o que de certeza seria recusado: o servidor volta a
 * contar tudo, com a venda bloqueada, e a frase dele é a que se mostra.
 */

/* -------------------------------------------------------------------------- */
/* Peças comuns                                                                 */
/* -------------------------------------------------------------------------- */

/** "hoje às 15:00", "amanhã às 15:00", "domingo, 19 out, às 15:00". */
function quando(iso: string): string {
  const d = new Date(iso);
  const dia = quandoDoJogo(d, new Date());
  if (dia === "Hoje" || dia === "Amanhã") return `${dia.toLowerCase()} às ${time(d)}`;
  return `${dia[0].toLowerCase()}${dia.slice(1)}, às ${time(d)}`;
}

const nBilhetes = (n: number) => (n === 1 ? "1 bilhete" : `${n} bilhetes`);
const centimos = (t: TipoDeBilhete) => Math.round(t.preco * 100);
const formatarRef = (r: string) => r.replace(/(\d{3})(?=\d)/g, "$1 ").trim();

/** Um relógio que bate de segundo a segundo, para as contagens. */
function useAgora(ms = 1000): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return agora;
}

/**
 * O ecrã não se apaga enquanto o código está aberto.
 *
 * À porta, com fila, o telemóvel a escurecer a meio da leitura é o leitor a
 * falhar. O browser solta o pedido quando a app vai para segundo plano, e por
 * isso pede-se outra vez ao voltar. Sem suporte, não faz nada.
 */
function useEcraLigado() {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let vivo = true;
    let tranca: WakeLockSentinel | null = null;
    const pedir = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock
        .request("screen")
        .then((t) => {
          if (vivo) tranca = t;
          else void t.release().catch(() => undefined);
        })
        .catch(() => undefined);
    };
    pedir();
    document.addEventListener("visibilitychange", pedir);
    return () => {
      vivo = false;
      document.removeEventListener("visibilitychange", pedir);
      void tranca?.release().catch(() => undefined);
    };
  }, []);
}

/** O QR desenhado no telemóvel, preto sobre branco, com margem para o leitor o achar. */
function Qr({ texto, rotulo, apagado }: { texto: string; rotulo: string; apagado?: boolean }) {
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    QRCode.toDataURL(texto, { margin: 2, width: 640, errorCorrectionLevel: "M", color: { dark: "#0b0e11", light: "#ffffff" } })
      .then((u) => vivo && setImg(u))
      .catch(() => vivo && setImg(null));
    return () => {
      vivo = false;
    };
  }, [texto]);

  return (
    <div className={cx("mx-auto aspect-square w-full max-w-[300px] rounded-[16px] bg-white", apagado && "opacity-25")}>
      {img && <img src={img} alt={rotulo} className="size-full rounded-[16px]" />}
    </div>
  );
}

/**
 * A folha de baixo, por cima de tudo.
 *
 * Vai para o `body` por um portal: os cartões do separador Jogos entram com uma
 * animação de lado, e um antepassado com `transform` prende um `fixed` dentro
 * dele. O `role="dialog"` é também o que o deslizar de dia do separador Jogos
 * ignora, para quem arrasta o dedo dentro da folha não mudar de dia por baixo.
 */
function Folha({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden />
      <div
        className="relative max-h-[92dvh] w-full max-w-[480px] overflow-y-auto overscroll-contain rounded-t-[24px] bg-canvas p-5 pb-[calc(20px+env(safe-area-inset-bottom))]"
        style={{ animation: "rise 320ms var(--ease-out) both" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink/15" aria-hidden />
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * O ecrã do código: branco, de ponta a ponta, para o leitor da porta.
 *
 * Branco mesmo com a app em modo escuro: um QR lê-se melhor com fundo claro e
 * o ecrã aceso. A frase do brilho fica no topo, onde se lê antes de chegar à
 * porta.
 */
function EcraDoCodigo({ titulo, subtitulo, onClose, children }: { titulo: string; subtitulo?: string; onClose: () => void; children: ReactNode }) {
  useEcraLigado();
  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-white text-[#0b0e11]"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
    >
      <div className="mx-auto max-w-[480px] px-4 pt-[calc(12px+env(safe-area-inset-top))] pb-[calc(28px+env(safe-area-inset-bottom))]">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 pt-1.5">
            <p className="text-[19px] leading-tight font-semibold tracking-[-0.02em]">{titulo}</p>
            {subtitulo && <p className="mt-0.5 text-[14px] text-[#5b6168]">{subtitulo}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#eef0f2] active:scale-95"
            aria-label="Fechar"
          >
            <X className="size-5" strokeWidth={2.2} />
          </button>
        </div>
        <p className="mt-3 flex items-center gap-2 rounded-[14px] bg-[#fff6d6] px-3.5 py-2.5 text-[14px] font-semibold text-[#6b4d00]">
          <Sun className="size-[18px] shrink-0" strokeWidth={2} />
          Aumenta o brilho do ecrã
        </p>
        <div className="mt-4 space-y-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Uma linha copiável da referência Multibanco: entidade ou referência. */
function LinhaCopiavel({ k, v, copiar }: { k: string; v: string; copiar?: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold tracking-[0.04em] text-ink-3 uppercase">{k}</span>
        <span className="num block text-[17px] font-semibold text-ink">{v}</span>
      </span>
      {copiar && (
        <button
          type="button"
          aria-label={`Copiar ${k.toLowerCase()}`}
          onClick={() => {
            void navigator.clipboard?.writeText(copiar);
            setCopiado(true);
            window.setTimeout(() => setCopiado(false), 1600);
          }}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-2 active:scale-95"
        >
          {copiado ? <Check className="size-4 text-ok" strokeWidth={2.5} /> : <Copy className="size-4" strokeWidth={1.9} />}
        </button>
      )}
    </div>
  );
}

/** O atalho para as quotas, ou a frase certa para quem não as paga aqui. */
function AtalhoQuotas({ onIr }: { onIr: () => void }) {
  const { data } = useSocio();
  const navigate = useNavigate();
  if (data?.member.quotasPelaFamilia) {
    return <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">As tuas quotas pagam-nas os teus encarregados, na área da família.</p>;
  }
  return (
    <button
      type="button"
      onClick={() => {
        onIr();
        navigate("/socio/quotas");
      }}
      className="mt-2.5 inline-flex h-9 items-center gap-1.5 rounded-full bg-risk px-4 text-[13px] font-semibold text-white active:scale-95"
    >
      <CreditCard className="size-4" strokeWidth={2} />
      Pagar as quotas
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Comprar                                                                      */
/* -------------------------------------------------------------------------- */

/** O botão "Bilhetes" de um jogo com a venda aberta. Sem venda, não há botão. */
export function BotaoBilhetes({ jogo, destaque = false }: { jogo: SocioMatch; destaque?: boolean }) {
  const [aberta, setAberta] = useState(false);
  if (!jogo.bilheteira) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        className={cx(
          "mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[14px] text-[14px] font-semibold active:scale-[0.98]",
          destaque ? "bg-ink text-surface" : "bg-signal-soft text-signal-ink",
        )}
      >
        <Ticket className="size-[18px]" strokeWidth={1.9} />
        Bilhetes
      </button>
      {aberta && <CompraDeBilhetes jogo={jogo} onClose={() => setAberta(false)} />}
    </>
  );
}

/**
 * A compra: os bilhetes por bancada, a forma de pagar, e depois o estado da
 * compra até ficar paga.
 */
function CompraDeBilhetes({ jogo, onClose }: { jogo: SocioMatch; onClose: () => void }) {
  const { data } = useSocio();
  const [venda, setVenda] = useState<VendaDoSocio | null>(null);
  const [erroVenda, setErroVenda] = useState<string | null>(null);
  const [qtd, setQtd] = useState<Record<string, number>>({});
  const [metodo, setMetodo] = useState<Metodo | null>(null);
  const [telefone, setTelefone] = useState(() => (data?.member.phone ?? "").replace(/^\+\d+\s*/, ""));
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [compra, setCompra] = useState<Compra | null>(null);

  useEffect(() => {
    let vivo = true;
    vendaDoJogo(jogo.id)
      .then((v) => vivo && setVenda(v))
      .catch((e: unknown) => vivo && setErroVenda(e instanceof Error ? e.message : "Não foi possível abrir a venda."));
    return () => {
      vivo = false;
    };
  }, [jogo.id]);

  const total = Object.values(qtd).reduce((n, q) => n + q, 0);
  const subtotal = venda ? venda.tipos.reduce((n, t) => n + centimos(t) * (qtd[t.id] ?? 0), 0) : 0;
  const comTaxa = data?.academy.feesOnPayer === true;
  const cotacao = useCotacao("/api/socio/cotacao", comTaxa && subtotal > 0 ? [subtotal] : []);
  const linhaDe = (m: Metodo) => (comTaxa && subtotal > 0 ? doMetodo(cotacao, m) : undefined);
  const escolhida = metodo ? linhaDe(metodo) : undefined;

  if (compra) {
    return (
      <Folha onClose={onClose}>
        <EstadoDaCompra
          inicial={{ token: compra.token, estado: compra.estado, reservadoAte: compra.reservadoAte, totalCents: compra.totalCents, pagamento: compra.pagamento }}
          onClose={onClose}
        />
      </Folha>
    );
  }

  const cabecalho = (
    <div className="px-1">
      <p className="text-[12px] font-semibold tracking-[0.05em] text-signal-ink uppercase">{jogo.teamName}</p>
      <p className="mt-0.5 text-[19px] leading-snug font-semibold text-ink">
        {data?.academy.shortName} <span className="font-medium text-ink-4">vs</span> {jogo.opponent}
      </p>
      <p className="mt-0.5 text-[13px] text-ink-3">
        {quandoDoJogo(new Date(jogo.startsAt), new Date())} · {time(new Date(jogo.startsAt))}
        {venda?.recinto && ` · ${venda.recinto.nome}`}
      </p>
    </div>
  );

  if (!venda) {
    return (
      <Folha onClose={onClose}>
        <div className="space-y-4">
          {cabecalho}
          {erroVenda ? (
            <p className="rounded-[16px] bg-sunken p-3.5 text-[13px] leading-relaxed text-ink-2">{erroVenda}</p>
          ) : (
            <div className="h-32 animate-pulse rounded-[20px] bg-surface" aria-hidden />
          )}
        </div>
      </Folha>
    );
  }

  const v = venda;
  const { estado } = v;

  /* Quantos lugares ainda há para um tipo: o da bancada e o do jogo, o que for menor. */
  const livreDe = (bancadaId: string | null): number | null => {
    const b = bancadaId ? (v.livres[bancadaId] ?? null) : null;
    const j = v.livresNoJogo;
    if (b === null) return j;
    if (j === null) return b;
    return Math.min(b, j);
  };
  const naBancada = (bancadaId: string | null) =>
    v.tipos.filter((t) => t.bancadaId === bancadaId).reduce((n, t) => n + (qtd[t.id] ?? 0), 0);
  const deSocio = v.tipos.filter((t) => t.para === "socios").reduce((n, t) => n + (qtd[t.id] ?? 0), 0);

  /** Porque é que um tipo não se pode escolher agora. Nulo = pode. */
  const motivo = (t: TipoDeBilhete): string | null => {
    if (estado.fechada) return "Venda fechada";
    if (!t.bancadaId) return "Sem bancada";
    if (livreDe(t.bancadaId) === 0) return "Esgotado";
    if (t.para === "socios") {
      if (v.jaTemBilheteDeSocio) return "Já tens o teu bilhete de sócio";
      if (!estado.socios) return estado.abreSociosEm ? `Abre ${quando(estado.abreSociosEm)}` : "Ainda não abriu";
      return null;
    }
    if (!estado.publico) return estado.abrePublicoEm ? `Abre ${quando(estado.abrePublicoEm)}` : "Só para sócios";
    return null;
  };

  const podeMais = (t: TipoDeBilhete): boolean => {
    if (motivo(t)) return false;
    if (total >= MAXIMO_POR_COMPRA) return false;
    if (t.para === "socios" && deSocio >= 1) return false;
    const livre = livreDe(t.bancadaId);
    if (livre !== null && naBancada(t.bancadaId) >= livre) return false;
    if (v.livresNoJogo !== null && total >= v.livresNoJogo) return false;
    return true;
  };

  const mudar = (t: TipoDeBilhete, passo: 1 | -1) => {
    if (passo === 1 && !podeMais(t)) return;
    setErro(null);
    setQtd((q) => ({ ...q, [t.id]: Math.max(0, (q[t.id] ?? 0) + passo) }));
  };

  /* As bancadas pela ordem do recinto; os tipos de sócio primeiro em cada uma. */
  const ordem = v.recinto?.bancadas.map((b) => b.id) ?? [];
  const grupos = new Map<string, { nome: string; tipos: TipoDeBilhete[] }>();
  for (const t of [...v.tipos].sort((a, b) => Number(a.para === "publico") - Number(b.para === "publico"))) {
    const chave = t.bancadaId ?? "";
    const g = grupos.get(chave) ?? { nome: t.bancada ?? "Sem bancada", tipos: [] };
    g.tipos.push(t);
    grupos.set(chave, g);
  }
  const bancadas = [...grupos.entries()].sort(
    ([a], [b]) => (ordem.indexOf(a) === -1 ? 999 : ordem.indexOf(a)) - (ordem.indexOf(b) === -1 ? 999 : ordem.indexOf(b)),
  );

  const desativados = data?.academy.paymentsDisabled === true;
  const podePagar = data?.academy.onlinePayments !== false && !desativados;
  const gratis = total > 0 && subtotal === 0;
  const podeComprar = !estado.fechada && total > 0 && (gratis || (podePagar && metodo !== null));

  async function comprar() {
    if (busy || !podeComprar) return;
    const m: Metodo = gratis ? "MULTIBANCO" : (metodo as Metodo);
    if (!gratis && m === "MBWAY" && telefone.replace(/\D/g, "").length < 9) {
      setErro("Escreve o número de telemóvel do MB Way");
      return;
    }
    setBusy(true);
    setErro(null);
    try {
      const linhas = Object.entries(qtd)
        .filter(([, q]) => q > 0)
        .map(([typeId, quantidade]) => ({ typeId, quantidade }));
      const c = await comprarBilhetes(v.jogo.id, linhas, m, !gratis && m === "MBWAY" ? telefone : undefined);
      setCompra(c);
      void carregarPedidos().catch(() => undefined);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar a compra.");
      // A lotação pode ter mudado entretanto: a venda volta a ler-se.
      void vendaDoJogo(v.jogo.id).then(setVenda).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Folha onClose={onClose}>
      <div className="space-y-4">
        {cabecalho}

        {v.nota && <p className="rounded-[16px] bg-sunken p-3.5 text-[13px] leading-relaxed whitespace-pre-line text-ink-2">{v.nota}</p>}

        {/* As fases da venda, numa frase. */}
        {estado.fechada ? (
          <p className="rounded-[16px] bg-sunken p-3.5 text-[13px] leading-relaxed text-ink-2">A venda de bilhetes para este jogo está fechada.</p>
        ) : (
          (estado.soSocios || (!estado.socios && estado.abreSociosEm) || (!estado.publico && estado.abrePublicoEm)) && (
            <p className="flex gap-2 rounded-[16px] bg-sunken p-3.5 text-[13px] leading-relaxed text-ink-2">
              <Clock className="mt-0.5 size-4 shrink-0 text-ink-3" strokeWidth={2} />
              <span>
                {estado.soSocios && "Este jogo é só para sócios. "}
                {!estado.socios && estado.abreSociosEm && `A venda aos sócios abre ${quando(estado.abreSociosEm)}. `}
                {!estado.publico && estado.abrePublicoEm && `Os bilhetes ao preço do público abrem ${quando(estado.abrePublicoEm)}.`}
              </span>
            </p>
          )
        )}

        {/* Quota que não cobre o jogo: sem preço de sócio, com o caminho para o resolver. */}
        {!v.quotaEmDia && (
          <div className="rounded-[16px] bg-risk-soft p-3.5">
            <p className="flex gap-2 text-[13px] leading-relaxed font-medium text-ink">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-risk" strokeWidth={2.2} />
              <span>
                As tuas quotas não cobrem o mês deste jogo, por isso não tens preço de sócio.
                {estado.publico && " Podes comprar ao preço do público."}
              </span>
            </p>
            <div className="pl-6">
              <AtalhoQuotas onIr={onClose} />
            </div>
          </div>
        )}

        {v.quotaEmDia && !estado.fechada && v.tipos.some((t) => t.para === "socios") && (
          <p className="px-1 text-[13px] leading-relaxed text-ink-3">
            {v.jaTemBilheteDeSocio
              ? "Já tens o teu bilhete de sócio para este jogo. Quem for contigo paga o preço do público."
              : "Tens um bilhete ao preço de sócio. Quem for contigo paga o preço do público."}{" "}
            Até {MAXIMO_POR_COMPRA} bilhetes por compra.
          </p>
        )}

        {/* Os tipos, por bancada. */}
        {bancadas.length === 0 ? (
          <p className="rounded-[16px] bg-sunken p-3.5 text-[13px] leading-relaxed text-ink-2">Não há bilhetes que possas comprar neste jogo.</p>
        ) : (
          bancadas.map(([bancadaId, g]) => {
            const livre = livreDe(bancadaId || null);
            return (
              <section key={bancadaId || "sem"} className="overflow-hidden rounded-[20px] bg-surface shadow-[var(--shadow-soft)]">
                <div className="flex items-center gap-2 border-b border-ink/5 px-4 py-3">
                  <MapPin className="size-4 shrink-0 text-ink-4" strokeWidth={1.9} />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{g.nome}</span>
                  {livre === 0 ? (
                    <Chip tone="risk">Esgotado</Chip>
                  ) : livre !== null && livre <= 20 ? (
                    <Chip tone="warn">{livre === 1 ? "Último lugar" : `Últimos ${livre} lugares`}</Chip>
                  ) : null}
                </div>
                {g.tipos.map((t) => {
                  const q = qtd[t.id] ?? 0;
                  const porque = motivo(t);
                  return (
                    <div key={t.id} className="flex items-center gap-3 border-b border-ink/5 px-4 py-3 last:border-0">
                      <span className={cx("min-w-0 flex-1", porque && q === 0 && "opacity-55")}>
                        <span className="block text-[15px] font-medium text-ink">{t.nome}</span>
                        <span className="block text-[12px] text-ink-3">
                          {t.para === "socios" ? (t.tierNome ? `Sócios ${t.tierNome}` : "Sócios") : "Público"}
                          {porque && ` · ${porque}`}
                        </span>
                      </span>
                      <span className="num shrink-0 text-[15px] font-semibold text-ink">{money(centimos(t))}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => mudar(t, -1)}
                          disabled={q === 0}
                          className="flex size-9 items-center justify-center rounded-full bg-sunken text-ink-2 active:scale-95 disabled:opacity-35"
                          aria-label={`Menos um ${t.nome}`}
                        >
                          <Minus className="size-4" strokeWidth={2.2} />
                        </button>
                        <span className="num w-6 text-center text-[15px] font-semibold text-ink" aria-live="polite">
                          {q}
                        </span>
                        <button
                          type="button"
                          onClick={() => mudar(t, 1)}
                          disabled={!podeMais(t)}
                          className="flex size-9 items-center justify-center rounded-full bg-ink text-surface active:scale-95 disabled:opacity-25"
                          aria-label={`Mais um ${t.nome}`}
                        >
                          <Plus className="size-4" strokeWidth={2.2} />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </section>
            );
          })
        )}

        {/* Pagar: só depois de escolher, e só quando há o que pagar. */}
        {total > 0 && !gratis && !podePagar && (
          <p className="rounded-[16px] bg-sunken p-3.5 text-[13px] leading-relaxed text-ink-2">
            {desativados ? PAGAMENTOS_DESATIVADOS : "Este clube ainda não recebe pagamentos pela app. Fala com o clube para comprar bilhetes."}
          </p>
        )}

        {total > 0 && !gratis && podePagar && (
          <div className="space-y-2">
            <p className="px-1 text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">Pagar com</p>
            <button
              type="button"
              onClick={() => setMetodo("MBWAY")}
              className={cx(
                "flex w-full items-center gap-3 rounded-[16px] bg-surface p-4 text-left shadow-[var(--shadow-soft)]",
                metodo === "MBWAY" && "ring-2 ring-[var(--color-signal)]",
              )}
            >
              <Smartphone className="size-5 text-ink-2" strokeWidth={1.9} />
              <span className="flex-1 text-[15px] font-medium text-ink">MB Way</span>
              <TaxaDoMetodo linha={linhaDe("MBWAY")} />
            </button>
            {metodo === "MBWAY" && (
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="Número de telemóvel"
                aria-label="Número de telemóvel do MB Way"
                className="w-full rounded-[14px] bg-surface px-4 py-3 text-[15px] text-ink shadow-[var(--shadow-soft)] outline-none placeholder:text-ink-4"
              />
            )}
            {/* O Multibanco da euPago só aceita a partir de 1 €. */}
            <button
              type="button"
              disabled={subtotal < 100}
              onClick={() => setMetodo("MULTIBANCO")}
              className={cx(
                "flex w-full items-center gap-3 rounded-[16px] bg-surface p-4 text-left shadow-[var(--shadow-soft)] disabled:opacity-45",
                metodo === "MULTIBANCO" && "ring-2 ring-[var(--color-signal)]",
              )}
            >
              <CreditCard className="size-5 text-ink-2" strokeWidth={1.9} />
              <span className="flex-1 text-[15px] font-medium text-ink">
                Referência Multibanco
                {subtotal < 100 && <span className="block text-[12px] font-medium text-ink-3">Só a partir de 1,00 €</span>}
              </span>
              {subtotal >= 100 && <TaxaDoMetodo linha={linhaDe("MULTIBANCO")} />}
            </button>
          </div>
        )}

        {total > 0 && (
          <dl className="space-y-1.5 rounded-[16px] bg-surface p-4 text-[13px] shadow-[var(--shadow-soft)]">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-3">{nBilhetes(total)}</dt>
              <dd className="num font-medium text-ink-2">{money(subtotal)}</dd>
            </div>
            {escolhida && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-3">Taxa de pagamento</dt>
                <dd className="num font-medium text-ink-2">+ {money(escolhida.surchargeCents)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3 border-t border-line pt-1.5">
              <dt className="font-semibold text-ink">Total</dt>
              <dd className="num font-semibold text-ink">{money(escolhida?.totalCents ?? subtotal)}</dd>
            </div>
            {comTaxa && !escolhida && !gratis && <p className="pt-0.5 text-[12px] text-ink-3">Mais a taxa de pagamento, igual em todos os métodos.</p>}
          </dl>
        )}

        {total > 0 && (
          <p className="px-1 text-[12px] leading-relaxed text-ink-3">
            Os lugares ficam guardados {v.reservaMinutos} minutos. Pago depois disso, não há bilhetes e o valor é devolvido.
          </p>
        )}

        {erro && <p className="px-1 text-[13px] font-medium text-risk">{erro}</p>}

        <button type="button" disabled={!podeComprar || busy} onClick={() => void comprar()} className="cta w-full disabled:opacity-40">
          {busy
            ? "A guardar os lugares…"
            : total === 0
              ? "Escolhe os bilhetes"
              : gratis
                ? `Confirmar ${nBilhetes(total)}`
                : `Comprar ${nBilhetes(total)} · ${money(escolhida?.totalCents ?? subtotal)}`}
        </button>
      </div>
    </Folha>
  );
}

/** O total de um método e quanto disso é taxa, como na folha das quotas. */
function TaxaDoMetodo({ linha }: { linha: { surchargeCents: number; totalCents: number } | undefined }) {
  if (!linha) return null;
  return (
    <span className="shrink-0 text-right">
      <span className="num block text-[15px] font-semibold text-ink">{money(linha.totalCents)}</span>
      <span className="num block text-[12px] font-medium text-ink-3">+ {money(linha.surchargeCents)} de taxa</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* O estado de uma compra                                                       */
/* -------------------------------------------------------------------------- */

type EstadoInicial = Pick<Pedido, "token" | "reservadoAte" | "totalCents"> & {
  estado: Pedido["estado"];
  pagamento: { metodo: string; entidade: string | null; referencia: string | null; valorCents: number } | null;
};

/** Quanto tempo se continua a perguntar depois do prazo: o aviso da euPago pode chegar atrasado. */
const POS_PRAZO_MS = 3 * 60_000;

/**
 * Do "a pagar" ao "pago".
 *
 * Pergunta a `GET /api/socio/bilhetes` de 4 em 4 segundos e procura esta
 * compra pelo `token`. Uma compra que expira deixa de vir na lista: passado o
 * prazo e sem ela na lista, está expirada. Pára quando chega a um estado final,
 * ou três minutos depois do prazo.
 */
function EstadoDaCompra({ inicial, onClose }: { inicial: EstadoInicial; onClose: () => void }) {
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [sumiu, setSumiu] = useState(false);
  const [aVer, setAVer] = useState(false);
  const agora = useAgora();

  const prazo = new Date(inicial.reservadoAte).getTime();
  const estado: Pedido["estado"] = pedido?.estado ?? (sumiu ? "expirado" : inicial.estado);
  const final = estado === "pago" || estado === "fora-do-prazo" || estado === "anulado";
  const pagamento = pedido?.pagamento ?? inicial.pagamento;
  const valor = pagamento?.valorCents ?? pedido?.totalCents ?? inicial.totalCents;
  /* Uma compra de 0 € nasce paga, mas os bilhetes (e os códigos) vêm da lista: pergunta-se uma vez. */
  const semBilhetes = estado === "pago" && !pedido;
  const aPerguntar = (!final || semBilhetes) && agora < prazo + POS_PRAZO_MS;

  useEffect(() => {
    if (!aPerguntar) return;
    let vivo = true;
    const perguntar = () =>
      carregarPedidos()
        .then((lista) => {
          if (!vivo) return;
          const p = lista.find((x) => x.token === inicial.token);
          if (p) {
            setPedido(p);
            setSumiu(false);
          } else if (Date.now() > prazo) {
            setPedido(null);
            setSumiu(true);
          }
        })
        .catch(() => undefined);
    void perguntar();
    const id = window.setInterval(() => void perguntar(), 4000);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, [aPerguntar, inicial.token, prazo]);

  const restam = Math.max(0, prazo - agora);
  const mm = String(Math.floor(restam / 60_000)).padStart(2, "0");
  const ss = String(Math.floor((restam % 60_000) / 1000)).padStart(2, "0");

  if (estado === "pago") {
    const bilhetes = pedido?.bilhetes ?? [];
    return (
      <div className="space-y-4 text-center">
        <span className="pop mx-auto flex size-14 items-center justify-center rounded-full bg-ok-soft text-ok">
          <Check className="size-7" strokeWidth={2.5} />
        </span>
        <div>
          <p className="text-[19px] font-semibold text-ink">Bilhetes prontos</p>
          <p className="mx-auto mt-1 max-w-[32ch] text-[13px] leading-relaxed text-ink-3">
            Ficam no Início, em "Os teus bilhetes". À porta, mostra o código de cada bilhete.
          </p>
        </div>
        <button type="button" disabled={bilhetes.length === 0} onClick={() => setAVer(true)} className="cta w-full">
          <QrCode className="size-[18px]" strokeWidth={1.9} />
          {bilhetes.length === 0 ? "A preparar os bilhetes…" : `Ver ${bilhetes.length === 1 ? "o bilhete" : `os ${bilhetes.length} bilhetes`}`}
        </button>
        <button type="button" onClick={onClose} className="block w-full py-1 text-[14px] font-medium text-ink-3">
          Fechar
        </button>
        {aVer && pedido && <CodigosDaCompra pedido={pedido} onClose={() => setAVer(false)} />}
      </div>
    );
  }

  if (estado === "fora-do-prazo" || estado === "anulado") {
    const r = pedido?.reembolso;
    return (
      <div className="space-y-4 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-risk-soft text-risk">
          <TriangleAlert className="size-7" strokeWidth={2} />
        </span>
        <div>
          <p className="text-[19px] font-semibold text-ink">{estado === "anulado" ? "Compra anulada" : "Pago fora do prazo"}</p>
          <p className="mx-auto mt-1 max-w-[34ch] text-[13px] leading-relaxed text-ink-3">
            {estado === "anulado"
              ? "O clube anulou esta compra e os bilhetes deixaram de valer."
              : "O pagamento chegou depois dos 10 minutos e os lugares já não estavam guardados, por isso não há bilhetes."}
            {r && (r.feito ? ` O clube já te devolveu ${money(r.valorCents)}.` : ` O clube devolve-te ${money(r.valorCents)}.`)}
          </p>
        </div>
        <button type="button" onClick={onClose} className="cta w-full">
          Entendido
        </button>
      </div>
    );
  }

  if (estado === "expirado") {
    return (
      <div className="space-y-4 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-sunken text-ink-3">
          <Clock className="size-7" strokeWidth={1.9} />
        </span>
        <div>
          <p className="text-[19px] font-semibold text-ink">O prazo passou</p>
          <p className="mx-auto mt-1 max-w-[34ch] text-[13px] leading-relaxed text-ink-3">
            Os lugares deixaram de estar guardados. Se ainda pagares, o valor é devolvido. Podes fazer uma compra nova no jogo.
          </p>
        </div>
        <button type="button" onClick={onClose} className="cta w-full">
          Entendido
        </button>
      </div>
    );
  }

  /* À espera do pagamento. */
  const mbway = pagamento?.metodo === "MBWAY";
  const passou = restam === 0;
  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">{passou ? "O prazo acabou" : "Lugares guardados"}</p>
        <p className={cx("num mt-1 text-[44px] leading-none font-semibold tracking-[-0.02em]", passou ? "text-risk" : "text-ink")}>
          {mm}:{ss}
        </p>
        <p className="mt-1.5 text-[13px] text-ink-3">{passou ? "A confirmar se o pagamento chegou a tempo…" : "para pagar"}</p>
      </div>

      {mbway ? (
        <div className="flex items-start gap-3 rounded-[16px] bg-surface p-4 shadow-[var(--shadow-soft)]">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-signal-soft text-signal-ink">
            <Smartphone className="size-5" strokeWidth={1.9} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink">Confirma no MB Way</span>
            <span className="block text-[13px] leading-relaxed text-ink-3">
              Enviámos o pedido de {money(valor)} para o teu telemóvel. Aceita-o na app MB Way.
            </span>
          </span>
        </div>
      ) : pagamento?.referencia ? (
        <div className="space-y-3 rounded-[16px] bg-surface p-4 shadow-[var(--shadow-soft)]">
          <LinhaCopiavel k="Entidade" v={pagamento.entidade ?? "—"} copiar={pagamento.entidade ?? undefined} />
          <LinhaCopiavel k="Referência" v={formatarRef(pagamento.referencia)} copiar={pagamento.referencia} />
          <LinhaCopiavel k="Valor" v={money(valor)} />
        </div>
      ) : null}

      <p className="px-1 text-[13px] leading-relaxed text-ink-2">
        {mbway
          ? "Aceita o pedido na app MB WAY nos próximos 5 minutos. Depois disso o pedido caduca e tens de comprar outra vez."
          : "Paga dentro dos 10 minutos, no homebanking ou numa caixa. Fora dos 10 minutos não há bilhetes e o valor é devolvido."}
      </p>

      <p className="flex items-center justify-center gap-2 text-[13px] text-ink-3">
        <span className="size-2 animate-pulse rounded-full bg-signal" aria-hidden />A confirmar o pagamento
      </p>

      <button type="button" onClick={onClose} className="cta-quiet w-full">
        Fechar e continuar depois
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Os teus bilhetes                                                             */
/* -------------------------------------------------------------------------- */

const ETIQUETA: Record<Pedido["estado"], { texto: string; tom: "ok" | "warn" | "risk" | "neutral" }> = {
  pago: { texto: "Pago", tom: "ok" },
  "a-pagar": { texto: "À espera de pagamento", tom: "warn" },
  "fora-do-prazo": { texto: "Fora do prazo", tom: "risk" },
  anulado: { texto: "Anulado", tom: "neutral" },
  expirado: { texto: "Expirado", tom: "neutral" },
};

/**
 * "Os teus bilhetes", no Início: uma linha por compra, do jogo mais próximo
 * para o mais longe. Só aparece quando há compras.
 */
export function OsTeusBilhetes() {
  const { pedidos } = useBilhetes();
  const { data } = useSocio();
  const [aberto, setAberto] = useState<string | null>(null);
  const lista = useMemo(
    () =>
      pedidos
        .filter((p) => p.estado !== "expirado")
        .sort((a, b) => new Date(a.jogo?.startsAt ?? 0).getTime() - new Date(b.jogo?.startsAt ?? 0).getTime()),
    [pedidos],
  );
  if (lista.length === 0) return null;
  const escolhido = lista.find((p) => p.token === aberto) ?? null;

  return (
    <section>
      <Label>Os teus bilhetes</Label>
      <div className="overflow-hidden rounded-[20px] bg-surface shadow-[var(--shadow-soft)]">
        {lista.map((p) => {
          const inicio = p.jogo ? new Date(p.jogo.startsAt) : null;
          const e = ETIQUETA[p.estado];
          return (
            <button
              key={p.token}
              type="button"
              onClick={() => setAberto(p.token)}
              className="flex w-full items-center gap-3 border-b border-ink/5 px-4 py-3.5 text-left last:border-0 active:bg-sunken"
            >
              <span
                className={cx(
                  "flex size-10 shrink-0 items-center justify-center rounded-[12px]",
                  p.estado === "pago" ? "bg-signal-soft text-signal-ink" : "bg-sunken text-ink-3",
                )}
              >
                <Ticket className="size-5" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                {p.jogo && <span className="block truncate text-[11px] font-semibold tracking-[0.05em] text-signal-ink uppercase">{p.jogo.teamName}</span>}
                <span className="block truncate text-[15px] font-semibold text-ink">
                  {p.jogo ? `${data?.academy.shortName ?? ""} vs ${p.jogo.opponent}` : "Jogo"}
                </span>
                <span className="block truncate text-[13px] text-ink-3">
                  {inicio ? `${quandoDoJogo(inicio, new Date())} · ${time(inicio)}` : ""}
                  {p.estado === "pago" && ` · ${nBilhetes(p.bilhetes.length)}`}
                </span>
              </span>
              <Chip tone={e.tom} className="shrink-0 py-0.5 text-[11px]">
                {e.texto}
              </Chip>
            </button>
          );
        })}
      </div>

      {escolhido &&
        (escolhido.estado === "pago" ? (
          <CodigosDaCompra pedido={escolhido} onClose={() => setAberto(null)} />
        ) : (
          <Folha onClose={() => setAberto(null)}>
            <EstadoDaCompra inicial={escolhido} onClose={() => setAberto(null)} />
          </Folha>
        ))}
    </section>
  );
}

/** Os bilhetes de uma compra paga, um QR grande por bilhete. */
function CodigosDaCompra({ pedido, onClose }: { pedido: Pedido; onClose: () => void }) {
  const { data } = useSocio();
  const inicio = pedido.jogo ? new Date(pedido.jogo.startsAt) : null;
  const n = pedido.bilhetes.length;
  return (
    <EcraDoCodigo
      titulo={pedido.jogo ? `${data?.academy.shortName ?? ""} vs ${pedido.jogo.opponent}` : "Bilhetes"}
      subtitulo={[inicio && `${quandoDoJogo(inicio, new Date())} · ${time(inicio)}`, pedido.jogo?.local].filter(Boolean).join(" · ")}
      onClose={onClose}
    >
      {pedido.bilhetes.map((b, i) => (
        <div key={b.id} className="rounded-[24px] border border-[#e3e6e9] p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[12px] font-semibold tracking-[0.06em] text-[#5b6168] uppercase">
              Bilhete {i + 1} de {n}
            </p>
            {b.usado && <span className="rounded-full bg-[#eef0f2] px-2.5 py-0.5 text-[12px] font-semibold text-[#5b6168]">Já entrou</span>}
          </div>
          <div className="mt-3">
            <Qr texto={b.codigo} rotulo={`Código do bilhete ${i + 1}`} apagado={b.usado} />
          </div>
          <p className="mt-3 text-center text-[18px] font-semibold">{b.tipo}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-center">
            <Dado k="Bancada" v={b.bancada} />
            <Dado k="Porta" v={b.porta} />
          </div>
        </div>
      ))}
    </EcraDoCodigo>
  );
}

function Dado({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="rounded-[14px] bg-[#f4f5f6] px-3 py-2">
      <p className="text-[11px] font-semibold tracking-[0.06em] text-[#5b6168] uppercase">{k}</p>
      <p className="mt-0.5 truncate text-[16px] font-semibold">{v ?? "—"}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* O lugar anual                                                                */
/* -------------------------------------------------------------------------- */

/**
 * O lugar anual do sócio, logo a seguir ao cartão.
 *
 * O código é o mesmo a época inteira e entra uma vez por jogo. Com a quota em
 * atraso, o leitor recusa-o: o aviso diz isso antes de o sócio chegar à porta.
 */
export function LugarAnualDoSocio() {
  const { lugares } = useBilhetes();
  const [aberto, setAberto] = useState<string | null>(null);
  if (lugares.length === 0) return null;
  const escolhido = lugares.find((l) => l.id === aberto) ?? null;

  return (
    <section>
      <Label>Lugar anual</Label>
      <div className="space-y-3">
        {lugares.map((l) => (
          <div key={l.id} className="rounded-[20px] bg-surface p-4 shadow-[var(--shadow-soft)]">
            <p className="text-[12px] font-semibold tracking-[0.05em] text-signal-ink uppercase">Época {l.epoca}</p>
            {l.recinto && <p className="mt-0.5 text-[16px] font-semibold text-ink">{l.recinto}</p>}
            <dl className="mt-3 grid grid-cols-3 gap-2">
              <DadoDoLugar k="Bancada" v={l.bancada} />
              <DadoDoLugar k="Porta" v={l.porta} />
              <DadoDoLugar k="Lugar" v={l.lugar} />
            </dl>
            {!l.quotaEmDia && <AvisoQuota />}
            <button type="button" onClick={() => setAberto(l.id)} className="cta mt-3 w-full">
              <QrCode className="size-[18px]" strokeWidth={1.9} />
              Mostrar código de entrada
            </button>
          </div>
        ))}
      </div>

      {escolhido && <CodigoDoLugar lugar={escolhido} onClose={() => setAberto(null)} />}
    </section>
  );
}

function DadoDoLugar({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="min-w-0 rounded-[14px] bg-sunken px-3 py-2">
      <dt className="text-[11px] font-semibold tracking-[0.05em] text-ink-3 uppercase">{k}</dt>
      <dd className="mt-0.5 truncate text-[15px] font-semibold text-ink">{v ?? "—"}</dd>
    </div>
  );
}

function AvisoQuota() {
  return (
    <div className="mt-3 rounded-[16px] bg-risk-soft p-3.5">
      <p className="flex gap-2 text-[13px] leading-relaxed font-semibold text-risk">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={2.2} />
        <span>Quota em atraso: o código não entra no estádio até pores as quotas em dia</span>
      </p>
      <div className="pl-6">
        <AtalhoQuotas onIr={() => undefined} />
      </div>
    </div>
  );
}

function CodigoDoLugar({ lugar, onClose }: { lugar: LugarAnual; onClose: () => void }) {
  return (
    <EcraDoCodigo titulo="Lugar anual" subtitulo={[`Época ${lugar.epoca}`, lugar.recinto].filter(Boolean).join(" · ")} onClose={onClose}>
      {!lugar.quotaEmDia && (
        <p className="flex gap-2 rounded-[16px] bg-[#fde8e8] p-3.5 text-[14px] leading-relaxed font-semibold text-[#b42318]">
          <TriangleAlert className="mt-0.5 size-[18px] shrink-0" strokeWidth={2.2} />
          <span>Quota em atraso: o código não entra no estádio até pores as quotas em dia</span>
        </p>
      )}
      <div className="rounded-[24px] border border-[#e3e6e9] p-4">
        <Qr texto={lugar.codigo} rotulo="Código de entrada do lugar anual" />
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Dado k="Bancada" v={lugar.bancada} />
          <Dado k="Porta" v={lugar.porta} />
          <Dado k="Lugar" v={lugar.lugar} />
        </div>
      </div>
    </EcraDoCodigo>
  );
}
