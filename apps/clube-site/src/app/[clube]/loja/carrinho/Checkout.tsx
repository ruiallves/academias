"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, Minus, Package, Plus, ShoppingBag, Trash2, Truck } from "lucide-react";
import type { LojaDoClube } from "@/dados/tipos";
import { Botao, BotaoLink } from "@/componentes/Botao";
import { Foto } from "@/componentes/Foto";
import { CHAVE_TURNSTILE, Turnstile, type TurnstileHandle } from "@/componentes/Turnstile";
import { euro } from "@/lib/formatar";
import {
  CHAVE_DEMO,
  MAXIMO_POR_LINHA,
  esvaziarCarrinho,
  euroDeCents,
  mudarQuantidade,
  tirarDoCarrinho,
  type CarrinhoVerificado,
  type Encomenda,
  type EncomendaDeDemonstracao,
  type Entrega,
  type LinhaDoCarrinho,
  type Metodo,
  type RespostaDaEncomenda,
} from "@/lib/loja";
import { useCarrinho } from "@/lib/carrinho";

/**
 * O carrinho e o pagamento, do princípio ao fim.
 *
 * ## O carrinho
 *
 * O que está no carrinho vive no browser; ao abrir, pede-se à API o que ele
 * vale hoje (`POST /api/clubes/:slug/loja/carrinho`): o preço de cada
 * artigo, quanto há, e como o clube entrega. Um artigo que saiu ou esgotou
 * fica marcado e tira-se; uma quantidade a mais baixa-se com um toque.
 *
 * ## Pagar
 *
 * Levantamento ou envio (com a morada), os dados de quem compra e o método.
 * A encomenda leva a ficha pedida ao abrir e o campo-armadilha, como os
 * bilhetes. Com sucesso, o carrinho esvazia-se e segue-se para a página da
 * encomenda (`/encomenda/<token>`), onde se vê a referência ou o pedido MB WAY.
 *
 * Em demonstração não se pede nada à API: os preços são os do carrinho, e a
 * encomenda é fingida (ver `PaginaDaEncomenda`).
 */

type Props = { slug: string; api: string; demonstracao: boolean; loja: LojaDoClube | null; clube: string };

type Verificacao = { fase: "a-verificar" } | { fase: "pronto"; v: CarrinhoVerificado } | { fase: "falhou" };
type Envio = { fase: "pronto" } | { fase: "a-enviar" } | { fase: "erro"; mensagem: string };

const campo = "mt-1.5 block h-12 w-full rounded-control border border-line-strong bg-surface px-3.5 text-[1rem] text-ink placeholder:text-ink-4 focus:border-ink";

function mensagemDe(corpo: unknown, omissao: string): string {
  const m = (corpo as { message?: string | string[] } | null)?.message;
  return (Array.isArray(m) ? m[0] : m) || omissao;
}

const so = (v: string) => v.replace(/\D/g, "");

export function Checkout({ slug, api, demonstracao, loja, clube }: Props) {
  const router = useRouter();
  const carrinho = useCarrinho(slug);
  const base = `${api}/api/clubes/${encodeURIComponent(slug)}/loja`;
  const [hidratado, setHidratado] = useState(false);
  const [verif, setVerif] = useState<Verificacao>({ fase: "a-verificar" });
  const [passo, setPasso] = useState<"carrinho" | "pagar">("carrinho");
  const [envio, setEnvio] = useState<Envio>({ fase: "pronto" });
  const [entrega, setEntrega] = useState<Entrega | null>(null);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [morada, setMorada] = useState({ linha1: "", linha2: "", codigoPostal: "", localidade: "" });
  const [nota, setNota] = useState("");
  const [metodo, setMetodo] = useState<Metodo>("MBWAY");
  const topo = useRef<HTMLDivElement | null>(null);
  const ficha = useRef("");
  const desafio = useRef<TurnstileHandle | null>(null);

  useEffect(() => setHidratado(true), []);

  /* ------------------------------------------------------------ a API */

  const pedirFicha = useCallback(async () => {
    if (demonstracao) return;
    try {
      const r = await fetch(`${base}/ficha`, { cache: "no-store" });
      const b = (await r.json().catch(() => ({}))) as { ficha?: string };
      ficha.current = r.ok && typeof b.ficha === "string" ? b.ficha : "";
    } catch {
      ficha.current = "";
    }
  }, [base, demonstracao]);

  /** O carrinho como a API o vê hoje. Em demonstração monta-se aqui, com o que o carrinho guardou. */
  const verificar = useCallback(
    async (linhas: LinhaDoCarrinho[]): Promise<Verificacao> => {
      if (linhas.length === 0) return { fase: "pronto", v: vazio(loja) };
      if (demonstracao) return { fase: "pronto", v: verificacaoDeDemonstracao(linhas, loja) };
      try {
        const r = await fetch(`${base}/carrinho`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ linhas: linhas.map((l) => ({ productId: l.productId, tamanho: l.tamanho || undefined, quantidade: l.quantidade })) }),
        });
        if (!r.ok) return { fase: "falhou" };
        return { fase: "pronto", v: (await r.json()) as CarrinhoVerificado };
      } catch {
        return { fase: "falhou" };
      }
    },
    [base, demonstracao, loja],
  );

  // Cada vez que o carrinho muda, volta a perguntar (a API junta e conta; o site só desenha).
  const assinatura = carrinho.linhas.map((l) => `${l.productId}:${l.tamanho}:${l.quantidade}`).join("|");
  useEffect(() => {
    if (!hidratado) return;
    let vivo = true;
    void verificar(carrinho.linhas).then((r) => vivo && setVerif(r));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidratado, assinatura, verificar]);

  useEffect(() => {
    void pedirFicha();
  }, [pedirFicha]);

  // A forma de entrega por omissão: a única que o clube tem, ou o levantamento.
  useEffect(() => {
    if (verif.fase !== "pronto" || entrega) return;
    const e = verif.v.entrega;
    setEntrega(e.levantamento.ativo ? "PICKUP" : e.envio.ativo ? "SHIPPING" : null);
  }, [verif, entrega]);

  /* ------------------------------------------------------------ o que se vê */

  if (!hidratado || (verif.fase === "a-verificar" && carrinho.linhas.length > 0)) {
    return (
      <>
        <Cabecalho titulo="Carrinho" />
        <div className="container-site grid place-items-center py-24 text-ink-3" role="status">
          <Loader2 size={28} className="animate-spin" aria-hidden />
          <span className="sr-only">A abrir o carrinho</span>
        </div>
      </>
    );
  }

  if (carrinho.linhas.length === 0) {
    return (
      <>
        <Cabecalho titulo="O carrinho está vazio" />
        <div className="container-site mt-10 max-w-3xl">
          <p className="text-lg text-ink-2">Escolhe o que quiseres na loja e volta aqui para pagar.</p>
          <BotaoLink href="/loja" className="mt-8">
            <ShoppingBag size={18} aria-hidden />
            Ir para a loja
          </BotaoLink>
        </div>
      </>
    );
  }

  if (verif.fase === "falhou") {
    return (
      <>
        <Cabecalho titulo="Carrinho" />
        <div className="container-site mt-10 max-w-3xl">
          <p className="font-semibold text-ink">Não foi possível confirmar os artigos.</p>
          <p className="mt-1 text-ink-2">Verifica a internet e tenta outra vez.</p>
          <Botao variante="contorno" className="mt-6" onClick={() => void verificar(carrinho.linhas).then(setVerif)}>
            Tentar outra vez
          </Botao>
        </div>
      </>
    );
  }

  const v = (verif as { fase: "pronto"; v: CarrinhoVerificado }).v;
  const porChave = new Map(v.linhas.map((l) => [`${l.productId}\u0000${l.tamanho}`, l]));
  const linhas = carrinho.linhas.map((l) => ({ local: l, api: porChave.get(`${l.productId}\u0000${l.tamanho}`) }));
  const problemas = linhas.filter(({ api: a }) => !a || !a.aVenda || (a.disponivel !== null && a.disponivel < (a.quantidade ?? 0)));
  const itemsCents = v.itemsCents ?? linhas.reduce((n, { local, api: a }) => n + local.quantidade * (a?.precoCents ?? Math.round(local.preco * 100)), 0);
  const envioCents = entrega === "SHIPPING" ? (v.envio ?? 0) : 0;
  const totalCents = itemsCents + envioCents;
  const n = carrinho.linhas.reduce((s, l) => s + l.quantidade, 0);
  const podePagar = v.vende && v.ok && problemas.length === 0 && !!entrega;

  const irPara = (p: "carrinho" | "pagar") => {
    setPasso(p);
    setEnvio((e) => (e.fase === "erro" ? { fase: "pronto" } : e));
    requestAnimationFrame(() => topo.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  /* ------------------------------------------------------------ pagar */

  const pagar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (envio.fase === "a-enviar" || !entrega) return;
    const notaExtra = String(new FormData(e.currentTarget).get("notaExtra") ?? "");
    const gratis = totalCents === 0;
    const metodoFinal: Metodo = gratis ? "MULTIBANCO" : metodo;
    if (metodoFinal === "MBWAY" && so(telefone).length < 9) {
      setEnvio({ fase: "erro", mensagem: "Para pagar por MB WAY, escreve o número de telemóvel." });
      return;
    }
    if (entrega === "SHIPPING" && (!morada.linha1.trim() || !morada.codigoPostal.trim() || !morada.localidade.trim())) {
      setEnvio({ fase: "erro", mensagem: "Para o envio, escreve a morada completa: rua, código postal e localidade." });
      return;
    }
    if (!demonstracao && CHAVE_TURNSTILE && !desafio.current?.token()) {
      setEnvio({ fase: "erro", mensagem: "Ainda estamos a confirmar que és uma pessoa. Espera um segundo e carrega outra vez." });
      return;
    }
    setEnvio({ fase: "a-enviar" });

    if (demonstracao) {
      await new Promise((ok) => setTimeout(ok, 700));
      const token = `demo-${Math.random().toString(36).slice(2, 12)}`;
      guardarDemonstracao(token, { linhas: carrinho.linhas, nome, email, entrega, morada, envioCents, metodo: metodoFinal, loja });
      esvaziarCarrinho(slug);
      router.push(`/encomenda/${token}`);
      return;
    }

    try {
      const r = await fetch(`${base}/encomendas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linhas: carrinho.linhas.map((l) => ({ productId: l.productId, tamanho: l.tamanho || undefined, quantidade: l.quantidade })),
          nome: nome.trim(),
          email: email.trim(),
          telefone: telefone.trim() || undefined,
          entrega,
          morada: entrega === "SHIPPING" ? { nome: nome.trim(), ...morada } : undefined,
          nota: nota.trim() || undefined,
          metodo: metodoFinal,
          notaExtra,
          ficha: ficha.current,
          turnstile: desafio.current?.token() || undefined,
        }),
      });
      const b = (await r.json().catch(() => ({}))) as unknown;
      if (!r.ok) {
        const mensagem = mensagemDe(b, "Não foi possível guardar a encomenda. Tenta outra vez.");
        void pedirFicha();
        desafio.current?.renovar();
        // O stock mudou entretanto: volta ao carrinho com os números de agora.
        if (/esgot|Só há|já não|tira-o/i.test(mensagem)) {
          void verificar(carrinho.linhas).then(setVerif);
          irPara("carrinho");
        }
        setEnvio({ fase: "erro", mensagem });
        return;
      }
      esvaziarCarrinho(slug);
      router.push(`/encomenda/${(b as RespostaDaEncomenda).token}`);
    } catch {
      void pedirFicha();
      desafio.current?.renovar();
      setEnvio({ fase: "erro", mensagem: "Falhou a ligação. Verifica a internet e tenta outra vez." });
    }
  };

  /* ------------------------------------------------------------ desenho */

  const resumo = (
    <div className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <ul className="space-y-2">
        {linhas.map(({ local, api: a }) => (
          <li key={`${local.productId}:${local.tamanho}`} className="flex items-baseline justify-between gap-4">
            <span className="min-w-0 text-ink">
              <span className="font-semibold tabular">{local.quantidade} ×</span> {a?.nome ?? local.nome}
              {local.tamanho && <span className="text-ink-3"> · {local.tamanho}</span>}
            </span>
            <span className="shrink-0 tabular text-ink-2">{euroDeCents(local.quantidade * (a?.precoCents ?? Math.round(local.preco * 100)))}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-4 space-y-1 border-t border-line pt-4">
        {entrega === "SHIPPING" && (
          <div className="flex items-baseline justify-between gap-4 text-ink-2">
            <dt>Envio</dt>
            <dd className="tabular">{envioCents === 0 ? "Grátis" : euroDeCents(envioCents)}</dd>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-semibold text-ink">Total</dt>
          <dd className="display text-2xl tabular text-ink">{euroDeCents(totalCents)}</dd>
        </div>
      </dl>
      {totalCents > 0 && <p className="mt-2 text-xs text-ink-3">Se o clube cobrar a taxa do pagamento, ela soma-se a este total.</p>}
    </div>
  );

  if (passo === "pagar" && podePagar) {
    const aEnviar = envio.fase === "a-enviar";
    const gratis = totalCents === 0;
    return (
      <>
        <Cabecalho titulo="Pagar" linha={`${n} ${n === 1 ? "artigo" : "artigos"} · ${euroDeCents(totalCents)}`} />
        <div ref={topo} className="container-site mt-10 max-w-3xl scroll-mt-24">
          <button type="button" onClick={() => irPara("carrinho")} className="inline-flex h-11 items-center gap-1.5 text-sm font-semibold text-ink hover:text-signal-ink">
            <ArrowLeft size={16} aria-hidden />
            Mudar o carrinho
          </button>
          <div className="mt-3">{resumo}</div>

          <form onSubmit={pagar} className="mt-8 space-y-6">
            <fieldset>
              <legend className="display text-2xl">Como queres receber</legend>
              <div role="radiogroup" aria-label="Forma de entrega" className="mt-4 grid gap-3 sm:grid-cols-2">
                {v.entrega.levantamento.ativo && (
                  <Opcao ativo={entrega === "PICKUP"} onClick={() => setEntrega("PICKUP")} titulo="Levantar no clube" icone={<Package size={18} aria-hidden />}>
                    {v.entrega.levantamento.local || "Na sede do clube"}. Sem custos. Avisamos por email quando estiver pronta.
                  </Opcao>
                )}
                {v.entrega.envio.ativo && (
                  <Opcao ativo={entrega === "SHIPPING"} onClick={() => setEntrega("SHIPPING")} titulo="Receber em casa" icone={<Truck size={18} aria-hidden />}>
                    {v.envio === 0 ? "Envio grátis" : `Envio por ${euroDeCents(v.envio ?? 0)}`}
                    {v.entrega.envio.gratisAPartirDe !== null && (v.envio ?? 0) > 0 ? `, grátis a partir de ${euro(v.entrega.envio.gratisAPartirDe)}` : ""}.
                    {v.entrega.envio.nota ? ` ${v.entrega.envio.nota}` : ""}
                  </Opcao>
                )}
              </div>
              {entrega === "PICKUP" && v.entrega.levantamento.nota && <p className="mt-2 text-sm text-ink-3">{v.entrega.levantamento.nota}</p>}
            </fieldset>

            <div className="space-y-5">
              <h2 className="display text-2xl">Os teus dados</h2>
              <label className="block text-sm font-semibold text-ink">
                Nome
                <input name="nome" required minLength={2} maxLength={120} autoComplete="name" className={campo} value={nome} onChange={(e) => setNome(e.target.value)} />
              </label>
              <label className="block text-sm font-semibold text-ink">
                Email <span className="font-normal text-ink-3">(a confirmação segue para aqui)</span>
                <input name="email" type="email" required maxLength={254} inputMode="email" autoComplete="email" className={campo} value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="block text-sm font-semibold text-ink">
                Telemóvel <span className="font-normal text-ink-3">{!gratis && metodo === "MBWAY" ? "(o pedido de pagamento chega a este número)" : "(opcional)"}</span>
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

              {entrega === "SHIPPING" && (
                <fieldset className="space-y-4">
                  <legend className="text-sm font-semibold text-ink">Morada de envio</legend>
                  <label className="block text-sm font-semibold text-ink">
                    Rua e número
                    <input required maxLength={160} autoComplete="address-line1" className={campo} value={morada.linha1} onChange={(e) => setMorada({ ...morada, linha1: e.target.value })} />
                  </label>
                  <label className="block text-sm font-semibold text-ink">
                    Andar, lote, outra indicação <span className="font-normal text-ink-3">(opcional)</span>
                    <input maxLength={160} autoComplete="address-line2" className={campo} value={morada.linha2} onChange={(e) => setMorada({ ...morada, linha2: e.target.value })} />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                    <label className="block text-sm font-semibold text-ink">
                      Código postal
                      <input required maxLength={20} inputMode="numeric" autoComplete="postal-code" placeholder="4800-000" className={`${campo} tabular`} value={morada.codigoPostal} onChange={(e) => setMorada({ ...morada, codigoPostal: e.target.value })} />
                    </label>
                    <label className="block text-sm font-semibold text-ink">
                      Localidade
                      <input required maxLength={80} autoComplete="address-level2" className={campo} value={morada.localidade} onChange={(e) => setMorada({ ...morada, localidade: e.target.value })} />
                    </label>
                  </div>
                </fieldset>
              )}

              <label className="block text-sm font-semibold text-ink">
                Nota para o clube <span className="font-normal text-ink-3">(opcional)</span>
                <textarea name="nota" maxLength={500} rows={2} placeholder="Entregar ao treinador dos sub-12." className={`${campo} h-auto py-3`} value={nota} onChange={(e) => setNota(e.target.value)} />
              </label>
            </div>

            {!gratis && (
              <fieldset>
                <legend className="text-sm font-semibold text-ink">Pagamento</legend>
                <div role="radiogroup" aria-label="Método de pagamento" className="mt-1.5 grid gap-3 sm:grid-cols-2">
                  <Opcao ativo={metodo === "MBWAY"} onClick={() => setMetodo("MBWAY")} titulo="MB WAY">
                    Aceitas o pedido na app MB WAY nos 5 minutos seguintes.
                  </Opcao>
                  <Opcao ativo={metodo === "MULTIBANCO"} onClick={() => setMetodo("MULTIBANCO")} titulo="Multibanco">
                    Referência para pagar dentro de 10 minutos, no homebanking ou numa caixa.
                  </Opcao>
                </div>
              </fieldset>
            )}

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
              {aEnviar ? "A guardar a encomenda" : gratis ? "Confirmar a encomenda" : `Pagar ${euroDeCents(totalCents)}`}
            </Botao>
            <p className="text-xs text-ink-3">
              Os artigos ficam guardados durante 10 minutos, enquanto pagas; o pedido MB WAY vale 5. Os dados que escreves aqui são tratados pelo clube.{" "}
              <Link href="/privacidade" className="font-semibold text-ink hover:underline">
                Ver a política de privacidade
              </Link>
              .
            </p>
            {demonstracao && <p className="text-xs text-ink-3">Isto é uma demonstração: não se paga nada e a encomenda é de exemplo.</p>}
          </form>
        </div>
      </>
    );
  }

  return (
    <>
      <Cabecalho titulo="Carrinho" linha={`${n} ${n === 1 ? "artigo" : "artigos"}`} />
      <div ref={topo} className="container-site mt-10 grid gap-10 scroll-mt-24 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0">
          {!v.vende && (
            <p className="mb-6 rounded-card bg-sunken p-4 text-ink-2">
              <span className="font-semibold text-ink">A compra online ainda não está aberta neste clube.</span> Encomenda{" "}
              <Link href="/contactos?assunto=Loja%20e%20encomendas" className="font-semibold text-signal-ink hover:underline">
                pelos contactos
              </Link>
              .
            </p>
          )}
          {problemas.length > 0 && (
            <p role="alert" className="mb-6 rounded-card bg-warn/10 p-4 text-sm font-semibold text-warn">
              {problemas.length === 1 ? "Um artigo do carrinho mudou: vê a linha marcada." : "Alguns artigos do carrinho mudaram: vê as linhas marcadas."}
            </p>
          )}
          {v.erro && problemas.length === 0 && (
            <p role="alert" className="mb-6 rounded-card bg-warn/10 p-4 text-sm font-semibold text-warn">
              {v.erro}
            </p>
          )}

          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {linhas.map(({ local, api: a }) => {
              const foraDeVenda = !a || !a.aVenda;
              const disponivel = a?.disponivel ?? null;
              const aMais = !foraDeVenda && disponivel !== null && disponivel < local.quantidade;
              const maximo = Math.min(MAXIMO_POR_LINHA, disponivel === null ? MAXIMO_POR_LINHA : disponivel);
              const preco = a?.precoCents ?? Math.round(local.preco * 100);
              return (
                <li key={`${local.productId}:${local.tamanho}`} className={`flex gap-4 p-4 ${foraDeVenda ? "bg-sunken/50" : ""}`}>
                  <Link href={`/loja/${local.productId}`} className="relative block aspect-[9/11] w-20 shrink-0 overflow-hidden rounded-control bg-sunken">
                    <Foto src={a?.imageUrl ?? local.image} alt="" sizes="80px" className={foraDeVenda ? "opacity-50" : ""} />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/loja/${local.productId}`} className="font-semibold text-ink hover:text-signal-ink">
                          {a?.nome ?? local.nome}
                        </Link>
                        {local.tamanho && <p className="text-sm text-ink-3">Tamanho {local.tamanho}</p>}
                      </div>
                      <p className="shrink-0 tabular font-semibold text-ink">{euroDeCents(preco * local.quantidade)}</p>
                    </div>
                    {foraDeVenda && <p className="mt-1 text-sm font-semibold text-risk">{disponivel === 0 && a?.aVenda === false && a?.nome ? "Esgotou" : "Já não está à venda"}. Tira-o do carrinho.</p>}
                    {aMais && (
                      <p className="mt-1 text-sm font-semibold text-warn">
                        {disponivel === 0 ? "Esgotou." : disponivel === 1 ? "Só há uma unidade." : `Só há ${disponivel} unidades.`}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      {!foraDeVenda && (
                        <div className="flex items-center rounded-control border border-line-strong" role="group" aria-label={`Quantidade de ${a?.nome ?? local.nome}`}>
                          <button type="button" onClick={() => mudarQuantidade(slug, local.productId, local.tamanho, local.quantidade - 1)} disabled={local.quantidade <= 1} aria-label="Menos um" className="grid size-11 place-items-center text-ink transition hover:bg-sunken disabled:opacity-30">
                            <Minus size={16} />
                          </button>
                          <output className="w-8 text-center font-semibold tabular text-ink" aria-live="polite">
                            {local.quantidade}
                          </output>
                          <button type="button" onClick={() => mudarQuantidade(slug, local.productId, local.tamanho, local.quantidade + 1)} disabled={local.quantidade >= maximo} aria-label="Mais um" className="grid size-11 place-items-center text-ink transition hover:bg-sunken disabled:opacity-30">
                            <Plus size={16} />
                          </button>
                        </div>
                      )}
                      {aMais && disponivel! > 0 && (
                        <button type="button" onClick={() => mudarQuantidade(slug, local.productId, local.tamanho, disponivel!)} className="inline-flex h-11 items-center text-sm font-semibold text-ink hover:text-signal-ink">
                          Ficar com {disponivel}
                        </button>
                      )}
                      <button type="button" onClick={() => tirarDoCarrinho(slug, local.productId, local.tamanho)} className="inline-flex h-11 items-center gap-1 text-sm font-semibold text-ink-3 hover:text-risk">
                        <Trash2 size={16} aria-hidden />
                        Tirar
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <Link href="/loja" className="mt-6 inline-flex h-11 items-center gap-1.5 text-sm font-semibold text-ink hover:text-signal-ink">
            <ArrowLeft size={16} aria-hidden />
            Continuar a ver a loja
          </Link>
        </section>

        <aside className="space-y-4">
          {resumo}
          {v.vende && (
            <>
              <Botao onClick={() => irPara("pagar")} disabled={!podePagar} className="w-full">
                Continuar para pagar
              </Botao>
              <p className="text-xs text-ink-3">
                {v.entrega.levantamento.ativo && v.entrega.envio.ativo
                  ? "Levantamento no clube ou envio pelo correio: escolhes a seguir."
                  : v.entrega.envio.ativo
                    ? "Envio pelo correio. A morada pede-se a seguir."
                    : `Levantamento${v.entrega.levantamento.local ? ` em ${v.entrega.levantamento.local}` : " no clube"}, sem custos.`}
              </p>
            </>
          )}
          <p className="text-xs text-ink-3">{clube} recebe o pagamento diretamente. A plataforma não guarda dados de pagamento.</p>
        </aside>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* As partes                                                                    */
/* -------------------------------------------------------------------------- */

function Cabecalho({ titulo, linha }: { titulo: string; linha?: string }) {
  return (
    <div className="border-b border-line bg-surface">
      <div className="container-site py-10 sm:py-14">
        <p className="eyebrow text-signal-ink">Loja</p>
        <h1 className="display mt-2 text-4xl sm:text-5xl">{titulo}</h1>
        {linha && <p className="mt-4 max-w-2xl text-lg text-ink-2">{linha}</p>}
      </div>
    </div>
  );
}

/** Uma opção de um grupo (entrega, método): um cartão com o botão de rádio desenhado. */
function Opcao({ ativo, onClick, titulo, icone, children }: { ativo: boolean; onClick: () => void; titulo: string; icone?: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativo}
      onClick={onClick}
      className={`rounded-card border p-4 text-left transition ${ativo ? "border-signal-line bg-signal-soft" : "border-line-strong bg-surface hover:border-ink-3"}`}
    >
      <span className="flex items-center gap-2 font-semibold text-ink">
        <span className={`grid size-5 place-items-center rounded-full border-2 ${ativo ? "border-signal-strong" : "border-line-strong"}`} aria-hidden>
          {ativo && <span className="size-2.5 rounded-full bg-signal-strong" />}
        </span>
        {icone}
        {titulo}
      </span>
      <span className="mt-1 block text-sm text-ink-2">{children}</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Demonstração                                                                 */
/* -------------------------------------------------------------------------- */

function entregaDe(loja: LojaDoClube | null): CarrinhoVerificado["entrega"] {
  return {
    levantamento: { ativo: !!loja?.levantamento, local: loja?.levantamento?.local ?? "", nota: loja?.levantamento?.nota ?? "" },
    envio: { ativo: !!loja?.envio, preco: loja?.envio?.preco ?? 0, gratisAPartirDe: loja?.envio?.gratisAPartirDe ?? null, nota: loja?.envio?.nota ?? "" },
    aviso: loja?.aviso ?? "",
  };
}

function vazio(loja: LojaDoClube | null): CarrinhoVerificado {
  return { vende: loja?.compraOnline ?? false, entrega: entregaDe(loja), ok: false, erro: null, itemsCents: 0, envio: null, linhas: [] };
}

/** O carrinho "verificado" sem API: o que o carrinho guardou, sem contagens. */
function verificacaoDeDemonstracao(linhas: LinhaDoCarrinho[], loja: LojaDoClube | null): CarrinhoVerificado {
  const itemsCents = linhas.reduce((n, l) => n + l.quantidade * Math.round(l.preco * 100), 0);
  const e = entregaDe(loja);
  const envio = e.envio.ativo ? (e.envio.gratisAPartirDe !== null && itemsCents >= e.envio.gratisAPartirDe * 100 ? 0 : Math.round(e.envio.preco * 100)) : null;
  return {
    vende: loja?.compraOnline ?? true,
    entrega: e,
    ok: true,
    erro: null,
    itemsCents,
    envio,
    linhas: linhas.map((l) => ({ productId: l.productId, tamanho: l.tamanho, quantidade: l.quantidade, nome: l.nome, precoCents: Math.round(l.preco * 100), imageUrl: l.image ?? null, disponivel: null, aVenda: true })),
  };
}

/**
 * A encomenda fingida da demonstração: "a pagar" que passa a "paga" ao fim
 * de alguns segundos, no `sessionStorage`, para a página da encomenda a ler.
 */
function guardarDemonstracao(
  token: string,
  c: { linhas: LinhaDoCarrinho[]; nome: string; email: string; entrega: Entrega; morada: { linha1: string; linha2: string; codigoPostal: string; localidade: string }; envioCents: number; metodo: Metodo; loja: LojaDoClube | null },
) {
  const itemsCents = c.linhas.reduce((n, l) => n + l.quantidade * Math.round(l.preco * 100), 0);
  const totalCents = itemsCents + c.envioCents;
  const encomenda: Encomenda = {
    numero: 42,
    estado: totalCents === 0 ? "paga" : "a-pagar",
    comprador: c.nome.trim() || "Comprador de exemplo",
    email: c.email,
    reservadoAte: new Date(Date.now() + 10 * 60_000).toISOString(),
    itemsCents,
    envioCents: c.envioCents,
    totalCents,
    pagamento:
      totalCents === 0
        ? null
        : { metodo: c.metodo, entidade: c.metodo === "MULTIBANCO" ? "12345" : null, referencia: c.metodo === "MULTIBANCO" ? "123456789" : null, valorCents: totalCents, estado: "PENDING" },
    reembolso: null,
    entrega:
      c.entrega === "SHIPPING"
        ? { tipo: "SHIPPING", morada: [c.nome, c.morada.linha1, c.morada.linha2, `${c.morada.codigoPostal} ${c.morada.localidade}`].filter(Boolean), nota: c.loja?.envio?.nota ?? "", rastreio: null }
        : { tipo: "PICKUP", local: c.loja?.levantamento?.local ?? "", nota: c.loja?.levantamento?.nota ?? "" },
    nota: null,
    linhas: c.linhas.map((l) => ({ nome: l.nome, tamanho: l.tamanho, quantidade: l.quantidade, unitPriceCents: Math.round(l.preco * 100), imageUrl: l.image ?? null })),
    datas: { paga: null, pronta: null, enviada: null, entregue: null },
  };
  const guardado: EncomendaDeDemonstracao = { encomenda, pagaEm: Date.now() + 12_000 };
  try {
    sessionStorage.setItem(CHAVE_DEMO(token), JSON.stringify(guardado));
  } catch {
    // Sem sessionStorage, a página da encomenda mostra o seu exemplo.
  }
}
