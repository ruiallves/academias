"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, BadgeCheck, Loader2, Minus, Plus, X } from "lucide-react";
import { MapaDoRecinto } from "@academia/ui/estadio";
import { Botao } from "@/componentes/Botao";
import { CHAVE_TURNSTILE, Turnstile, type TurnstileHandle } from "@/componentes/Turnstile";
import { euro } from "@/lib/formatar";
import {
  CHAVE_DEMO,
  MAXIMO_POR_COMPRA,
  POUCOS_LUGARES,
  quando,
  type Compra as RespostaDaCompra,
  type Identificacao,
  type Metodo,
  type Pedido,
  type PedidoDeDemonstracao,
  type TipoDaVenda,
  type Venda,
} from "@/lib/bilheteira";

/**
 * A compra de bilhetes de um jogo, do princípio ao pagamento.
 *
 * ## A venda
 *
 * Ao abrir, pede a venda à API (`GET /api/clubes/:slug/bilhetes/:matchId`,
 * sem cache): os preços, os lugares que restam por bancada e as fases. O mapa
 * vem primeiro, como antes; a lista mostra os tipos agrupados por bancada,
 * com o que resta em cada uma.
 *
 * ## O sócio
 *
 * "Sou sócio" pede o número e a data de nascimento
 * (`POST .../bilhetes/:matchId/socio`). A resposta traz uma credencial, que
 * fica só em memória e vai com a compra, e a venda como esse sócio a vê: os
 * preços do público e os dele. Antes disso, os preços de sócio não aparecem.
 *
 * ## Pagar
 *
 * Escolhidos os bilhetes (até 10), os dados de quem compra e o método. A
 * compra leva a ficha pedida ao abrir e o campo-armadilha, como os contactos.
 * Com sucesso, segue para a página do bilhete (`/bilhete/<token>`), onde se
 * vê a referência ou o pedido MB WAY e, pago, os códigos.
 *
 * Em demonstração não se pede nada à API: a venda vem montada da página, o
 * sócio é qualquer número, e a compra é fingida (ver `PaginaDoBilhete`).
 */

type Props = {
  slug: string;
  matchId: string;
  api: string;
  demonstracao: boolean;
  /** Só em demonstração: a venda ao público e a de um sócio identificado. */
  demo: { venda: Venda; vendaDeSocio: Venda } | null;
};

type Carga = { fase: "a-abrir" } | { fase: "aberta"; venda: Venda } | { fase: "sem-venda" } | { fase: "falhou" };
type Socio = { numero: string; credencial: string; jaTem: boolean };
type Envio = { fase: "pronto" } | { fase: "a-enviar" } | { fase: "erro"; mensagem: string };

const campo =
  "mt-1.5 block h-12 w-full rounded-control border border-line-strong bg-surface px-3.5 text-[1rem] text-ink placeholder:text-ink-4 focus:border-ink";

function mensagemDe(corpo: unknown, omissao: string): string {
  const m = (corpo as { message?: string | string[] } | null)?.message;
  return (Array.isArray(m) ? m[0] : m) || omissao;
}

const so = (v: string) => v.replace(/\D/g, "");

export function Compra({ slug, matchId, api, demonstracao, demo }: Props) {
  const router = useRouter();
  const base = `${api}/api/clubes/${encodeURIComponent(slug)}/bilhetes`;
  const demoRef = useRef(demo);

  const [carga, setCarga] = useState<Carga>(demo ? { fase: "aberta", venda: demo.venda } : { fase: "a-abrir" });
  const [socio, setSocio] = useState<Socio | null>(null);
  const [painelSocio, setPainelSocio] = useState(false);
  const [avisoSocio, setAvisoSocio] = useState<string | null>(null);
  const [qtd, setQtd] = useState<Record<string, number>>({});
  const [bancada, setBancada] = useState<string | null>(null);
  const [passo, setPasso] = useState<"escolher" | "pagar">("escolher");
  const [envio, setEnvio] = useState<Envio>({ fase: "pronto" });
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [metodo, setMetodo] = useState<Metodo>("MBWAY");
  const topo = useRef<HTMLDivElement | null>(null);
  const ficha = useRef("");
  /** O desafio da Cloudflare do passo de pagar. Ver `componentes/Turnstile`. */
  const desafio = useRef<TurnstileHandle | null>(null);

  /* ------------------------------------------------------------ a API */

  const pedirFicha = useCallback(async () => {
    if (demonstracao) return;
    try {
      const r = await fetch(`${base}/ficha`, { cache: "no-store" });
      const b = (await r.json().catch(() => ({}))) as { ficha?: string };
      ficha.current = r.ok && typeof b.ficha === "string" ? b.ficha : "";
    } catch {
      // Sem ficha, a compra falha e a resposta diz para recarregar: pede-se outra nessa altura.
      ficha.current = "";
    }
  }, [base, demonstracao]);

  /**
   * Cada ficha serve uma vez: identificar o sócio gasta a que está, e pede-se
   * logo outra para a compra (que só vale ao fim de 3 segundos, e até lá a
   * pessoa ainda está a escolher).
   */
  const gastarFicha = useCallback(() => {
    const agora = ficha.current;
    ficha.current = "";
    void pedirFicha();
    return agora;
  }, [pedirFicha]);

  /** A venda como o público a vê. */
  const lerVenda = useCallback(async (): Promise<Carga> => {
    if (demoRef.current) return { fase: "aberta", venda: demoRef.current.venda };
    try {
      const r = await fetch(`${base}/${encodeURIComponent(matchId)}`, { cache: "no-store" });
      if (r.status === 404) return { fase: "sem-venda" };
      if (!r.ok) return { fase: "falhou" };
      return { fase: "aberta", venda: (await r.json()) as Venda };
    } catch {
      return { fase: "falhou" };
    }
  }, [base, matchId]);

  useEffect(() => {
    if (demonstracao) return;
    let vivo = true;
    void lerVenda().then((c) => vivo && setCarga(c));
    void pedirFicha();
    return () => {
      vivo = false;
    };
  }, [demonstracao, lerVenda, pedirFicha]);

  /**
   * Depois de uma recusa por lotação ou por fase: os lugares e as fases de
   * agora, sem trocar os tipos (um sócio identificado continua a ver os dele).
   */
  const atualizarLugares = useCallback(async () => {
    const c = await lerVenda();
    if (c.fase !== "aberta") return;
    setCarga((antes) =>
      antes.fase === "aberta" ? { fase: "aberta", venda: { ...antes.venda, estado: c.venda.estado, livres: c.venda.livres, livresNoJogo: c.venda.livresNoJogo } } : c,
    );
  }, [lerVenda]);

  const tentarOutraVez = async () => {
    setCarga({ fase: "a-abrir" });
    setCarga(await lerVenda());
  };

  /* ------------------------------------------------------------ o sócio */

  const identificado = (r: Identificacao, numero: string) => {
    setSocio({ numero, credencial: r.credencial, jaTem: r.jaTemBilheteDeSocio });
    setCarga({ fase: "aberta", venda: r.venda });
    // O que já estava escolhido fica, se ainda estiver na lista.
    const ids = new Set(r.venda.tipos.map((t) => t.id));
    setQtd((q) => Object.fromEntries(Object.entries(q).filter(([id]) => ids.has(id))));
    setPainelSocio(false);
    setAvisoSocio(null);
  };

  const sairDeSocio = async (aviso?: string) => {
    setSocio(null);
    setAvisoSocio(aviso ?? null);
    if (aviso) setPainelSocio(true);
    const c = await lerVenda();
    setCarga(c);
    if (c.fase === "aberta") {
      const publicos = new Set(c.venda.tipos.filter((t) => t.para === "publico").map((t) => t.id));
      setQtd((q) => Object.fromEntries(Object.entries(q).filter(([id]) => publicos.has(id))));
    }
  };

  /* ------------------------------------------------------------ carregar */

  if (carga.fase === "a-abrir") {
    return (
      <div className="mt-10 grid place-items-center py-10 text-ink-3" role="status">
        <Loader2 size={28} className="animate-spin" aria-hidden />
        <span className="sr-only">A abrir a venda</span>
      </div>
    );
  }
  if (carga.fase === "sem-venda") {
    return (
      <div className="mt-6 rounded-card bg-sunken p-5 text-ink-2">
        <p className="font-semibold text-ink">A venda de bilhetes para este jogo fechou.</p>
        <Link href="/bilheteira" className="mt-2 inline-block text-sm font-semibold text-signal-ink hover:underline">
          Ver os outros jogos
        </Link>
      </div>
    );
  }
  if (carga.fase === "falhou") {
    return (
      <div className="mt-6 rounded-card bg-sunken p-5 text-ink-2">
        <p className="font-semibold text-ink">Não foi possível abrir a venda.</p>
        <p className="mt-1 text-sm">Verifica a internet e tenta outra vez.</p>
        <Botao variante="contorno" className="mt-4" onClick={() => void tentarOutraVez()}>
          Tentar outra vez
        </Botao>
      </div>
    );
  }

  /* ------------------------------------------------------------ a venda */

  const venda = carga.venda;
  const recinto = venda.recinto;
  // Antes de o sócio se identificar, só os preços do público. Depois, a venda que a API devolveu ao sócio.
  const visiveis = socio ? venda.tipos : venda.tipos.filter((t) => t.para === "publico");
  const haPrecosDeSocio = venda.tipos.some((t) => t.para === "socios");
  const q = (t: TipoDaVenda) => qtd[t.id] ?? 0;
  const escolhidos = visiveis.filter((t) => q(t) > 0);
  const n = escolhidos.reduce((s, t) => s + q(t), 0);
  const total = escolhidos.reduce((s, t) => s + q(t) * t.preco, 0);
  const deSocio = escolhidos.filter((t) => t.para === "socios").reduce((s, t) => s + q(t), 0);
  const naBancada = (id: string | null) => visiveis.filter((t) => t.bancadaId === id).reduce((s, t) => s + q(t), 0);
  const livre = (id: string | null) => (id ? venda.livres[id] : undefined);

  /** Porque é que este bilhete não se compra agora, ou nulo se se compra. */
  const motivo = (t: TipoDaVenda): string | null => {
    if (venda.estado.fechada) return "Venda fechada";
    if (livre(t.bancadaId) === 0 || venda.livresNoJogo === 0) return "Esgotado";
    if (t.para === "socios") {
      if (socio?.jaTem) return "Já tens o teu bilhete de sócio";
      if (!venda.estado.socios) return venda.estado.abreSociosEm ? `Abre aos sócios a ${quando(venda.estado.abreSociosEm)}` : "Ainda não abriu";
      return null;
    }
    if (!venda.estado.publico) return venda.estado.abrePublicoEm ? `Abre ao público a ${quando(venda.estado.abrePublicoEm)}` : "Só para sócios";
    return null;
  };

  const podeMais = (t: TipoDaVenda) => {
    if (motivo(t)) return false;
    if (n >= MAXIMO_POR_COMPRA) return false;
    if (t.para === "socios" && deSocio >= 1) return false;
    const l = livre(t.bancadaId);
    if (typeof l === "number" && naBancada(t.bancadaId) >= l) return false;
    if (typeof venda.livresNoJogo === "number" && n >= venda.livresNoJogo) return false;
    return true;
  };

  const mudar = (t: TipoDaVenda, delta: number) => {
    if (delta > 0 && !podeMais(t)) return;
    setQtd((antes) => ({ ...antes, [t.id]: Math.max(0, (antes[t.id] ?? 0) + delta) }));
  };

  const comMapa = !!recinto && visiveis.some((t) => t.bancadaId && recinto.bancadas.some((b) => b.id === t.bancadaId));
  const nomeDaBancada = (id: string | null) => recinto?.bancadas.find((b) => b.id === id)?.nome;
  const desde = (id: string) => {
    const ps = visiveis.filter((t) => t.bancadaId === id && !motivo(t)).map((t) => t.preco);
    return ps.length ? Math.min(...ps) : null;
  };

  // A lista: só a bancada escolhida, ou todas agrupadas pela ordem do mapa.
  const grupos: { id: string | null; nome: string | null; tipos: TipoDaVenda[] }[] = [];
  if (comMapa && !bancada) {
    for (const b of recinto!.bancadas) {
      const ts = visiveis.filter((t) => t.bancadaId === b.id);
      if (ts.length) grupos.push({ id: b.id, nome: b.nome, tipos: ts });
    }
    const soltos = visiveis.filter((t) => !t.bancadaId || !recinto!.bancadas.some((b) => b.id === t.bancadaId));
    if (soltos.length) grupos.push({ id: null, nome: "Outros lugares", tipos: soltos });
  } else if (bancada) {
    grupos.push({ id: bancada, nome: nomeDaBancada(bancada) ?? null, tipos: visiveis.filter((t) => t.bancadaId === bancada) });
  } else {
    // Sem mapa: agrupadas pelo nome da bancada que a API manda.
    const porBancada = new Map<string, TipoDaVenda[]>();
    for (const t of visiveis) {
      const k = t.bancadaId ?? "";
      porBancada.set(k, [...(porBancada.get(k) ?? []), t]);
    }
    for (const [k, ts] of porBancada) grupos.push({ id: k || null, nome: ts[0].bancada ?? (porBancada.size > 1 ? "Outros lugares" : null), tipos: ts });
  }

  const irPara = (p: "escolher" | "pagar") => {
    setPasso(p);
    setEnvio((e) => (e.fase === "erro" ? { fase: "pronto" } : e));
    requestAnimationFrame(() => topo.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  /* ------------------------------------------------------------ pagar */

  const gratis = total === 0;

  const pagar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (envio.fase === "a-enviar") return;
    const notaExtra = String(new FormData(e.currentTarget).get("notaExtra") ?? "");
    const metodoFinal: Metodo = gratis ? "MULTIBANCO" : metodo;
    if (metodoFinal === "MBWAY" && so(telefone).length < 9) {
      setEnvio({ fase: "erro", mensagem: "Para pagar por MB WAY, escreve o número de telemóvel." });
      return;
    }
    const linhas = escolhidos.map((t) => ({ typeId: t.id, quantidade: q(t) }));
    if (!demonstracao && CHAVE_TURNSTILE && !desafio.current?.token()) {
      setEnvio({ fase: "erro", mensagem: "Ainda estamos a confirmar que és uma pessoa. Espera um segundo e carrega outra vez." });
      return;
    }
    setEnvio({ fase: "a-enviar" });

    if (demonstracao) {
      await new Promise((ok) => setTimeout(ok, 700));
      const token = `demo-${Math.random().toString(36).slice(2, 12)}`;
      guardarDemonstracao(token, { venda, escolhidos: escolhidos.map((t) => ({ tipo: t, quantidade: q(t) })), nome, metodo: metodoFinal });
      router.push(`/bilhete/${token}`);
      return;
    }

    try {
      const r = await fetch(`${base}/${encodeURIComponent(matchId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linhas,
          nome: nome.trim(),
          email: email.trim(),
          telefone: telefone.trim() || undefined,
          metodo: metodoFinal,
          credencial: socio?.credencial,
          notaExtra,
          ficha: ficha.current,
          turnstile: desafio.current?.token() || undefined,
        }),
      });
      const b = (await r.json().catch(() => ({}))) as unknown;
      if (!r.ok) {
        const mensagem = mensagemDe(b, "Não foi possível guardar a compra. Tenta outra vez.");
        // Cada ficha (e cada token da Cloudflare) serve uma vez: a próxima tentativa leva outros.
        void pedirFicha();
        desafio.current?.renovar();
        if (/identifica-te outra vez/i.test(mensagem)) {
          irPara("escolher");
          void sairDeSocio(mensagem);
          return;
        }
        if (/esgot|só há|já não está|fechad|não abriu|só para sócios/i.test(mensagem)) void atualizarLugares();
        setEnvio({ fase: "erro", mensagem });
        return;
      }
      router.push(`/bilhete/${(b as RespostaDaCompra).token}`);
    } catch {
      void pedirFicha();
      desafio.current?.renovar();
      setEnvio({ fase: "erro", mensagem: "Falhou a ligação. Verifica a internet e tenta outra vez." });
    }
  };

  /* ------------------------------------------------------------ desenho */

  if (passo === "pagar" && n > 0) {
    const aEnviar = envio.fase === "a-enviar";
    return (
      <div ref={topo} className="mt-6 scroll-mt-24">
        <button type="button" onClick={() => irPara("escolher")} className="inline-flex h-11 items-center gap-1.5 text-sm font-semibold text-ink hover:text-signal-ink">
          <ArrowLeft size={16} aria-hidden />
          Mudar os bilhetes
        </button>

        <div className="mt-3 rounded-card border border-line bg-surface p-4 sm:p-5">
          <ul className="space-y-2">
            {escolhidos.map((t) => (
              <li key={t.id} className="flex items-baseline justify-between gap-4">
                <span className="min-w-0 text-ink">
                  <span className="font-semibold tabular">{q(t)} ×</span> {t.nome}
                  {t.bancada && !t.nome.includes(t.bancada) && <span className="text-ink-3"> · {t.bancada}</span>}
                </span>
                <span className="shrink-0 tabular text-ink-2">{euro(q(t) * t.preco)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-line pt-4">
            <span className="font-semibold text-ink">Total</span>
            <span className="display text-2xl tabular text-ink">{euro(total)}</span>
          </div>
          {!gratis && <p className="mt-2 text-xs text-ink-3">Se o clube cobrar a taxa do pagamento, ela soma-se a este total.</p>}
        </div>

        <form onSubmit={pagar} className="mt-8 space-y-5">
          <h2 className="display text-2xl">Os teus dados</h2>
          <label className="block text-sm font-semibold text-ink">
            Nome
            <input name="nome" required minLength={2} maxLength={120} autoComplete="name" className={campo} value={nome} onChange={(e) => setNome(e.target.value)} />
          </label>
          <label className="block text-sm font-semibold text-ink">
            Email <span className="font-normal text-ink-3">(os bilhetes seguem para aqui)</span>
            <input name="email" type="email" required maxLength={254} inputMode="email" autoComplete="email" className={campo} value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>

          {!gratis && (
            <fieldset>
              <legend className="text-sm font-semibold text-ink">Pagamento</legend>
              <div role="radiogroup" aria-label="Método de pagamento" className="mt-1.5 grid gap-3 sm:grid-cols-2">
                {(
                  [
                    { v: "MBWAY", t: "MB WAY", d: "Aceitas o pedido na app MB WAY nos 5 minutos seguintes." },
                    { v: "MULTIBANCO", t: "Multibanco", d: "Referência para pagar dentro de 10 minutos, no homebanking ou numa caixa." },
                  ] as const
                ).map((m) => {
                  const ativo = metodo === m.v;
                  return (
                    <button
                      key={m.v}
                      type="button"
                      role="radio"
                      aria-checked={ativo}
                      onClick={() => setMetodo(m.v)}
                      className={`rounded-card border p-4 text-left transition ${ativo ? "border-signal-line bg-signal-soft" : "border-line-strong bg-surface hover:border-ink-3"}`}
                    >
                      <span className="flex items-center gap-2 font-semibold text-ink">
                        <span className={`grid size-5 place-items-center rounded-full border-2 ${ativo ? "border-signal-strong" : "border-line-strong"}`} aria-hidden>
                          {ativo && <span className="size-2.5 rounded-full bg-signal-strong" />}
                        </span>
                        {m.t}
                      </span>
                      <span className="mt-1 block text-sm text-ink-2">{m.d}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          <label className="block text-sm font-semibold text-ink">
            Telemóvel{" "}
            <span className="font-normal text-ink-3">{!gratis && metodo === "MBWAY" ? "(o pedido de pagamento chega a este número)" : "(opcional)"}</span>
            <input
              name="telefone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              maxLength={30}
              placeholder="912 345 678"
              required={!gratis && metodo === "MBWAY"}
              className={`${campo} tabular`}
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
            />
          </label>

          {/* O campo-armadilha: fora do ecrã e fora do teclado. Uma pessoa nunca o vê nem o preenche. */}
          <div aria-hidden className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
            <label>
              Nota extra
              <input name="notaExtra" tabIndex={-1} autoComplete="off" />
            </label>
          </div>

          {envio.fase === "erro" && (
            <p role="alert" className="rounded-card bg-risk/10 p-4 text-sm font-semibold text-risk">
              {envio.mensagem}
            </p>
          )}

          {!demonstracao && <Turnstile ref={desafio} />}
          <Botao type="submit" disabled={aEnviar} className="w-full sm:w-auto">
            {aEnviar && <Loader2 size={18} className="animate-spin" aria-hidden />}
            {aEnviar ? "A guardar os lugares" : gratis ? "Confirmar os bilhetes" : `Pagar ${euro(total)}`}
          </Botao>
          <p className="text-xs text-ink-3">
            Os lugares ficam guardados durante 10 minutos, enquanto pagas; o pedido MB WAY vale 5. Os dados que escreves aqui são tratados pelo clube.{" "}
            <Link href="/privacidade" className="font-semibold text-ink hover:underline">
              Ver a política de privacidade
            </Link>
            .
          </p>
          {demonstracao && <p className="text-xs text-ink-3">Isto é uma demonstração: não se paga nada e os bilhetes são de exemplo.</p>}
        </form>
      </div>
    );
  }

  const naoHaPublico = !socio && visiveis.length === 0;
  const noJogo = venda.livresNoJogo;

  return (
    <div ref={topo} className="mt-6 scroll-mt-24">
      {venda.estado.fechada && <p className="mb-6 rounded-card bg-sunken p-4 font-semibold text-ink">A venda de bilhetes para este jogo fechou.</p>}
      {!venda.estado.fechada && noJogo === 0 && <p className="mb-6 rounded-card bg-risk/10 p-4 font-semibold text-risk">Os bilhetes para este jogo esgotaram.</p>}
      {!venda.estado.fechada && typeof noJogo === "number" && noJogo > 0 && noJogo < POUCOS_LUGARES && (
        <p className="mb-6 rounded-card bg-warn/10 p-4 font-semibold text-warn">{noJogo === 1 ? "Resta um lugar para este jogo." : `Restam ${noJogo} lugares para este jogo.`}</p>
      )}

      {/* O sócio: o convite, a identificação, ou quem está identificado. */}
      {socio ? (
        <div className="mb-6 flex items-start gap-3 rounded-card bg-signal-soft p-4 text-sm text-signal-ink">
          <BadgeCheck size={20} className="mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Sócio n.º {socio.numero}</p>
            <p className="mt-0.5">
              {socio.jaTem
                ? "Já tens um bilhete de sócio para este jogo. Os outros bilhetes são ao preço do público."
                : venda.tipos.some((t) => t.para === "socios")
                  ? "Os preços de sócio já estão na lista. Um bilhete de sócio por sócio; os acompanhantes compram ao preço do público."
                  : "Não há preço de sócio para a tua categoria neste jogo. Podes comprar ao preço do público."}
            </p>
          </div>
          <button type="button" onClick={() => void sairDeSocio()} className="-my-2 inline-flex h-11 shrink-0 items-center font-semibold hover:underline">
            Sair
          </button>
        </div>
      ) : (
        (haPrecosDeSocio || venda.estado.soSocios) &&
        !venda.estado.fechada && (
          <div className="mb-6 rounded-card border border-line bg-surface p-4 sm:p-5">
            {painelSocio ? (
              <IdentificarSocio
                base={base}
                matchId={matchId}
                demonstracao={demonstracao}
                demoVenda={demoRef.current?.vendaDeSocio ?? null}
                aviso={avisoSocio}
                gastarFicha={gastarFicha}
                onIdentificado={identificado}
                onFechar={() => {
                  setPainelSocio(false);
                  setAvisoSocio(null);
                }}
              />
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-ink">{venda.estado.soSocios ? "Este jogo é só para sócios." : "És sócio?"}</p>
                  <p className="mt-0.5 text-sm text-ink-2">Com o número de sócio e a data de nascimento vês os preços de sócio.</p>
                </div>
                <Botao variante="contorno" onClick={() => setPainelSocio(true)} className="shrink-0">
                  <BadgeCheck size={18} aria-hidden />
                  Sou sócio
                </Botao>
              </div>
            )}
          </div>
        )
      )}

      {naoHaPublico ? (
        <p className="text-ink-3">Os bilhetes deste jogo são só para sócios. Identifica-te para os veres.</p>
      ) : (
        <>
          {comMapa && (
            <div className="mb-6">
              <div className="rounded-card border border-line bg-surface p-2 sm:p-4">
                <MapaDoRecinto
                  recinto={recinto!}
                  className="mx-auto w-full max-w-2xl"
                  titulo={`Mapa de ${recinto!.nome}: escolhe a bancada`}
                  selecionada={bancada}
                  onEscolher={(id) => setBancada(id === bancada ? null : id)}
                  estado={(b) => (visiveis.some((t) => t.bancadaId === b.id) && livre(b.id) !== 0 ? "ativa" : "inativa")}
                  rotulo={(b) => {
                    const ja = naBancada(b.id);
                    if (ja) return `${ja} ${ja === 1 ? "bilhete" : "bilhetes"}`;
                    if (livre(b.id) === 0) return "esgotada";
                    const d = desde(b.id);
                    return d != null ? `desde ${euro(d)}` : undefined;
                  }}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <p className="text-ink-3" aria-live="polite">
                  {bancada ? (
                    <>
                      A ver <strong className="font-semibold text-ink">{nomeDaBancada(bancada)}</strong>
                    </>
                  ) : (
                    "Toca numa bancada para ver os bilhetes dela."
                  )}
                </p>
                {bancada && (
                  <button type="button" onClick={() => setBancada(null)} className="inline-flex h-11 items-center gap-1 font-semibold text-ink hover:text-signal-ink">
                    <X size={16} aria-hidden />
                    Ver todas as bancadas
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="space-y-5">
            {grupos.map((g) => (
              <Grupo key={g.id ?? "todos"} nome={g.nome} livre={livre(g.id)} onEscolher={comMapa && g.id && !bancada ? () => setBancada(g.id) : undefined}>
                {g.tipos.map((t) => (
                  <LinhaDoTipo key={t.id} tipo={t} quantidade={q(t)} motivo={motivo(t)} podeMais={podeMais(t)} onMudar={(d) => mudar(t, d)} />
                ))}
              </Grupo>
            ))}
          </div>
        </>
      )}

      <div className="sticky bottom-0 -mx-4 mt-6 flex flex-col gap-3 border-t border-line bg-canvas/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
        <div aria-live="polite">
          <p className="text-ink-2">
            {n === 0 ? (
              "Escolhe os bilhetes."
            ) : (
              <>
                {n} {n === 1 ? "bilhete" : "bilhetes"} · <span className="display text-2xl tabular text-ink">{euro(total)}</span>
              </>
            )}
          </p>
          {n >= MAXIMO_POR_COMPRA && <p className="text-sm text-ink-3">No máximo {MAXIMO_POR_COMPRA} bilhetes por compra.</p>}
        </div>
        <Botao onClick={() => irPara("pagar")} disabled={n === 0 || venda.estado.fechada}>
          Continuar
        </Botao>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* A lista                                                                      */
/* -------------------------------------------------------------------------- */

/** Uma bancada da lista: o nome, o que resta, e os bilhetes dela. */
function Grupo({ nome, livre, onEscolher, children }: { nome: string | null; livre: number | null | undefined; onEscolher?: () => void; children: React.ReactNode }) {
  const resta =
    livre === 0 ? (
      <span className="text-risk">Esgotado</span>
    ) : typeof livre === "number" && livre < POUCOS_LUGARES ? (
      <span className="text-warn">{livre === 1 ? "Último lugar" : `Últimos ${livre} lugares`}</span>
    ) : null;
  return (
    <div>
      {(nome || resta) && (
        <div className="mb-2 flex min-h-9 flex-wrap items-center justify-between gap-x-3">
          {nome && (
            <button
              type="button"
              onClick={onEscolher}
              disabled={!onEscolher}
              className="flex h-9 items-center gap-2 text-sm font-bold uppercase tracking-wider text-ink disabled:cursor-default"
            >
              <span className="size-2.5 rounded-full bg-signal" aria-hidden />
              {nome}
            </button>
          )}
          {resta && <p className="text-sm font-semibold">{resta}</p>}
        </div>
      )}
      <ul className="divide-y divide-line rounded-card border border-line bg-surface">{children}</ul>
    </div>
  );
}

function LinhaDoTipo({
  tipo: t,
  quantidade: v,
  motivo,
  podeMais,
  onMudar,
}: {
  tipo: TipoDaVenda;
  quantidade: number;
  motivo: string | null;
  podeMais: boolean;
  onMudar: (delta: number) => void;
}) {
  return (
    <li className={`flex flex-wrap items-center gap-x-4 gap-y-2 p-4 ${motivo && v === 0 ? "bg-sunken/50" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className={`font-semibold ${motivo && v === 0 ? "text-ink-3" : "text-ink"}`}>{t.nome}</p>
        {t.para === "socios" && (
          <p className="text-sm text-signal-ink">
            Preço de sócio{t.tierNome ? ` · ${t.tierNome}` : ""}
          </p>
        )}
        {motivo && <p className="text-sm text-ink-3">{motivo}</p>}
      </div>
      <p className={`display w-16 text-right text-xl tabular ${motivo && v === 0 ? "text-ink-3" : "text-ink"}`}>{t.preco === 0 ? "Grátis" : euro(t.preco)}</p>
      {motivo && v === 0 ? (
        // Sem os botões: um "+" sempre desligado não diz porquê, e o motivo já está escrito.
        <span className="w-[6.75rem]" aria-hidden />
      ) : (
        <div className="flex items-center rounded-control border border-line-strong" role="group" aria-label={`Quantidade de ${t.nome}`}>
          <button
            type="button"
            onClick={() => onMudar(-1)}
            disabled={v === 0}
            aria-label={`Menos um ${t.nome}`}
            className="grid size-11 place-items-center text-ink transition hover:bg-sunken disabled:opacity-30"
          >
            <Minus size={16} />
          </button>
          <output className="w-8 text-center font-semibold tabular text-ink" aria-live="polite">
            {v}
          </output>
          <button
            type="button"
            onClick={() => onMudar(1)}
            disabled={!podeMais}
            aria-label={`Mais um ${t.nome}`}
            className="grid size-11 place-items-center text-ink transition hover:bg-sunken disabled:opacity-30"
          >
            <Plus size={16} />
          </button>
        </div>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* O sócio                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Número de sócio e data de nascimento. A API responde igual a um número que
 * não existe e a uma data errada, e bloqueia ao fim de algumas tentativas: a
 * mensagem dela mostra-se tal como vem.
 */
function IdentificarSocio({
  base,
  matchId,
  demonstracao,
  demoVenda,
  aviso,
  gastarFicha,
  onIdentificado,
  onFechar,
}: {
  base: string;
  matchId: string;
  demonstracao: boolean;
  demoVenda: Venda | null;
  aviso: string | null;
  /** A ficha anti-robô: a identificação gasta uma, como a compra. */
  gastarFicha: () => string;
  onIdentificado: (r: Identificacao, numero: string) => void;
  onFechar: () => void;
}) {
  const id = useId();
  const [numero, setNumero] = useState("");
  const [dia, setDia] = useState("");
  const [mes, setMes] = useState("");
  const [ano, setAno] = useState("");
  const [estado, setEstado] = useState<Envio>(aviso ? { fase: "erro", mensagem: aviso } : { fase: "pronto" });
  const refMes = useRef<HTMLInputElement | null>(null);
  const refAno = useRef<HTMLInputElement | null>(null);
  const refNumero = useRef<HTMLInputElement | null>(null);
  /** Um desafio da Cloudflare por tentativa: cada palpite de número e data passa por ele. */
  const desafio = useRef<TurnstileHandle | null>(null);

  useEffect(() => {
    refNumero.current?.focus();
  }, []);

  const nascimento = () => {
    if (dia.length < 1 || mes.length < 1 || ano.length !== 4) return null;
    const d = dia.padStart(2, "0");
    const m = mes.padStart(2, "0");
    const dt = new Date(Date.UTC(+ano, +m - 1, +d));
    if (dt.getUTCFullYear() !== +ano || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d) return null;
    if (dt.getTime() > Date.now() || +ano < new Date().getFullYear() - 120) return null;
    return `${ano}-${m}-${d}`;
  };

  const enviar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (estado.fase === "a-enviar") return;
    const num = Number(so(numero));
    if (!num) return setEstado({ fase: "erro", mensagem: "Escreve o número de sócio." });
    const data = nascimento();
    if (!data) return setEstado({ fase: "erro", mensagem: "Essa data não existe. Escreve dia, mês e ano." });
    setEstado({ fase: "a-enviar" });

    if (demonstracao) {
      await new Promise((ok) => setTimeout(ok, 600));
      if (demoVenda) onIdentificado({ credencial: "demonstracao", venda: demoVenda, jaTemBilheteDeSocio: false }, String(num));
      return;
    }
    const token = desafio.current?.token() ?? "";
    if (CHAVE_TURNSTILE && !token) return setEstado({ fase: "erro", mensagem: "Ainda estamos a confirmar que és uma pessoa. Espera um segundo e carrega outra vez." });
    try {
      const r = await fetch(`${base}/${encodeURIComponent(matchId)}/socio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero: num, nascimento: data, ficha: gastarFicha(), turnstile: token || undefined }),
      });
      const b = (await r.json().catch(() => ({}))) as unknown;
      if (!r.ok) {
        desafio.current?.renovar();
        setEstado({ fase: "erro", mensagem: mensagemDe(b, "Não foi possível confirmar o sócio. Tenta outra vez.") });
        return;
      }
      onIdentificado(b as Identificacao, String(num));
    } catch {
      desafio.current?.renovar();
      setEstado({ fase: "erro", mensagem: "Falhou a ligação. Verifica a internet e tenta outra vez." });
    }
  };

  const aEnviar = estado.fase === "a-enviar";

  return (
    <form onSubmit={enviar}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">Comprar como sócio</p>
          <p className="mt-1 text-sm text-ink-2">
            Cada sócio leva um bilhete de sócio por jogo, com as quotas pagas até ao mês do jogo. Os acompanhantes compram ao preço do público.
          </p>
        </div>
        <button type="button" onClick={onFechar} aria-label="Fechar" className="-mr-2 -mt-2 grid size-11 shrink-0 place-items-center text-ink-3 hover:text-ink">
          <X size={18} aria-hidden />
        </button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>
          <label htmlFor={`${id}-n`} className="block text-sm font-semibold text-ink">
            Número de sócio
          </label>
          <input
            ref={refNumero}
            id={`${id}-n`}
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            className={`${campo} tabular`}
            value={numero}
            onChange={(e) => setNumero(so(e.target.value).slice(0, 8))}
          />
        </div>
        <fieldset>
          <legend className="block text-sm font-semibold text-ink">Data de nascimento</legend>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1.5fr)] items-center gap-2">
            <input
              aria-label="Dia"
              inputMode="numeric"
              autoComplete="bday-day"
              maxLength={2}
              placeholder="DD"
              className={`${campo} text-center tabular`}
              value={dia}
              onChange={(e) => {
                const v = so(e.target.value).slice(0, 2);
                setDia(v);
                if (v.length === 2) refMes.current?.focus();
              }}
            />
            <span className="mt-1.5 text-ink-4" aria-hidden>
              /
            </span>
            <input
              ref={refMes}
              aria-label="Mês"
              inputMode="numeric"
              autoComplete="bday-month"
              maxLength={2}
              placeholder="MM"
              className={`${campo} text-center tabular`}
              value={mes}
              onChange={(e) => {
                const v = so(e.target.value).slice(0, 2);
                setMes(v);
                if (v.length === 2) refAno.current?.focus();
              }}
            />
            <span className="mt-1.5 text-ink-4" aria-hidden>
              /
            </span>
            <input
              ref={refAno}
              aria-label="Ano"
              inputMode="numeric"
              autoComplete="bday-year"
              maxLength={4}
              placeholder="AAAA"
              className={`${campo} text-center tabular`}
              value={ano}
              onChange={(e) => setAno(so(e.target.value).slice(0, 4))}
            />
          </div>
        </fieldset>
      </div>

      {estado.fase === "erro" && (
        <p role="alert" className="mt-4 rounded-card bg-risk/10 p-3 text-sm font-semibold text-risk">
          {estado.mensagem}
        </p>
      )}

      {!demonstracao && <Turnstile ref={desafio} className="mt-4" />}
      <Botao type="submit" disabled={aEnviar} className="mt-4 w-full sm:w-auto">
        {aEnviar && <Loader2 size={18} className="animate-spin" aria-hidden />}
        {aEnviar ? "A confirmar" : "Ver os preços de sócio"}
      </Botao>
      {demonstracao && <p className="mt-2 text-xs text-ink-3">Demonstração: qualquer número e qualquer data servem.</p>}
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Demonstração                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A compra fingida da demonstração: um pedido "a pagar" que passa a "pago"
 * ao fim de alguns segundos, guardado no `sessionStorage` para a página do
 * bilhete o ler. Sem `sessionStorage`, essa página mostra um exemplo seu.
 */
function guardarDemonstracao(
  token: string,
  c: { venda: Venda; escolhidos: { tipo: TipoDaVenda; quantidade: number }[]; nome: string; metodo: Metodo },
) {
  const totalCents = Math.round(c.escolhidos.reduce((s, e) => s + e.quantidade * e.tipo.preco, 0) * 100);
  const portas = c.venda.recinto?.bancadas.map((b) => b.id) ?? [];
  const bilhetes: Pedido["bilhetes"] = c.escolhidos.flatMap((e) =>
    Array.from({ length: e.quantidade }, (_, i) => {
      const p = portas.indexOf(e.tipo.bancadaId ?? "");
      return {
        id: `${e.tipo.id}-${i}`,
        tipo: e.tipo.nome,
        bancada: e.tipo.bancada,
        porta: p >= 0 ? `Porta ${p + 1}` : null,
        usado: false,
        codigo: `T.demonstracao-${e.tipo.id}-${i}.exemplo`,
      };
    }),
  );
  const pedido: Pedido = {
    estado: totalCents === 0 ? "pago" : "a-pagar",
    comprador: c.nome.trim() || "Comprador de exemplo",
    reservadoAte: new Date(Date.now() + c.venda.reservaMinutos * 60_000).toISOString(),
    totalCents,
    pagamento:
      totalCents === 0
        ? null
        : {
            metodo: c.metodo,
            entidade: c.metodo === "MULTIBANCO" ? "12345" : null,
            referencia: c.metodo === "MULTIBANCO" ? "123456789" : null,
            valorCents: totalCents,
            estado: "PENDING",
          },
    reembolso: null,
    jogo: { startsAt: c.venda.jogo.startsAt, opponent: c.venda.jogo.opponent, teamName: c.venda.jogo.teamName, local: c.venda.recinto?.nome ?? "" },
    bilhetes,
  };
  const guardado: PedidoDeDemonstracao = { pedido, pagoEm: Date.now() + 12_000 };
  try {
    sessionStorage.setItem(CHAVE_DEMO(token), JSON.stringify(guardado));
  } catch {
    // Sem sessionStorage, a página do bilhete mostra o seu exemplo.
  }
}
