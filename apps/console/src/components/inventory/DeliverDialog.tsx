import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { cx, ListaDeEscolha, Monogram } from "@/components/primitives";
import { Boxes, Check, Minus, PackageOpen, Plus, Search, TriangleAlert, X } from "@/lib/icons";
import { listAthletes, teamById } from "@/lib/api";
import { can, semEquipasAtribuidas } from "@/lib/permissions";
import { reloadFees } from "@/lib/store";
import {
  PAGAMENTO_VAZIO,
  PagamentoDaEntregaField,
  pagamentoSemValorValido,
  type ValorDoPagamento,
} from "./PagamentoDaEntrega";
import { useSession } from "@/session";
import { assignLote, listItems, type Item, type PagamentoPedido } from "@/lib/inventory";

/**
 * Entregar equipamento.
 *
 * ## Feito para o balcão, não para a secretária
 *
 * Isto usa-se de pé, com o atleta à frente e uma fila atrás — muitas vezes no
 * telemóvel. Por isso não é um formulário: é uma sequência de escolhas, cada
 * uma a abrir a seguinte, e a quantidade já vem a 1 porque é o que se entrega
 * em nove de cada dez vezes.
 *
 * O atleta procura-se por nome, com o campo já focado ao abrir — quem chega aqui
 * sabe quem é a pessoa, e o primeiro gesto é sempre escrever o nome dela.
 *
 * ## Um cartão por artigo
 *
 * Ao balcão entrega-se o kit — a t-shirt, os calções, as meias — e era um
 * artigo por confirmação (pedido do Rui, 19/10/2026). Cada artigo é um cartão
 * com tudo o que é dele lá dentro: o nome, o tamanho, a quantidade e o valor.
 * Por baixo dos cartões, um botão discreto "+ Adicionar artigo" abre outro. A
 * primeira versão tinha uma lista em cima e um "Adicionar" ao lado da
 * quantidade, e o Rui achou que não fazia sentido: o tamanho e a quantidade
 * pertencem ao artigo, e é dentro dele que se escolhem.
 *
 * Cada cartão é uma entrega, com o seu valor, para se devolver ou editar uma
 * peça sem mexer nas outras. O stock sai tudo ou nada (`assignLote` na API):
 * se faltar um tamanho, não sai nenhuma peça.
 *
 * ## O artigo procura-se escrevendo
 *
 * Como o atleta: escreve-se o nome ("camisola", "fato") e os artigos com stock
 * aparecem por baixo. Uma lista suspensa com trinta artigos obrigava a ler
 * todos para encontrar um. O stock que se mostra num cartão já desconta o que
 * os outros cartões levam do mesmo tamanho.
 *
 * ## O pagamento, no mesmo gesto
 *
 * Quem pode cobrar (`billing:write`) escolhe o pagamento uma vez para a
 * entrega toda: sem pagamento, por pagar (só no Equipamento da app, ou também
 * nos Pagamentos, com notificação) ou pago (com o método, e cai nas Contas). O
 * **valor** escreve-se em cada artigo, porque cada um é uma cobrança. Depois
 * muda-se em "Editar", na ficha do atleta ou nas Entregas.
 *
 * ## Os tamanhos sem stock aparecem, mas não se escolhem
 *
 * Escondê-los faria parecer que o clube nunca teve aquele tamanho. Mostrá-los
 * riscados e sem stock diz a verdade — *há, mas está todo entregue* — que é
 * precisamente a informação que faz alguém ir buscar outro tamanho em vez de
 * procurar mais.
 */

/** Um cartão: o artigo, o tamanho, quantas e o valor. Vazio até se escolher o artigo. */
type Linha = {
  key: string;
  itemId: string;
  variantId: string;
  quantity: number;
  /** Em euros, como se escreve ("12,50"). Só conta quando há pagamento. */
  valor: string;
  /** O que se escreveu para procurar o artigo, enquanto não há artigo. */
  procura: string;
};

const centsDoValor = (v: string) => Math.round(Number(v.replace(/\s/g, "").replace(",", ".")) * 100);
const euros = (c: number) => (c / 100).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });

let seq = 0;
const linhaVazia = (): Linha => ({ key: `l${++seq}`, itemId: "", variantId: "", quantity: 1, valor: "", procura: "" });

export function DeliverDialog({
  athleteId: atletaFixo,
  onClose,
  onDone,
}: {
  /** Quando se entrega a partir da ficha de um atleta, ele já está escolhido. */
  athleteId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { session } = useSession();
  const atletas = listAthletes(session).filter((a) => a.status === "active");

  const [procura, setProcura] = useState("");
  const [athleteId, setAthleteId] = useState(atletaFixo ?? "");
  const [itens, setItens] = useState<Item[] | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>(() => [linhaVazia()]);
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** As entregas ficaram, algum pagamento não. À parte do aviso verde, para não se perder nele. */
  const [falhaPagamento, setFalhaPagamento] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  /** O pagamento desta entrega. Ver o cabeçalho. */
  const podeCobrar = can(session, "billing:write");
  const [pagamento, setPagamento] = useState<ValorDoPagamento>(PAGAMENTO_VAZIO);
  const cobrar = podeCobrar && pagamento.modo !== "nenhum";

  const campoProcura = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listItems()
      .then(setItens)
      .catch(() => setItens([]));
  }, []);

  useEffect(() => {
    if (!atletaFixo) campoProcura.current?.focus();
  }, [atletaFixo]);

  const atleta = atletas.find((a) => a.id === athleteId);

  /*
   * A lista filtra-se sem acentos e sem maiúsculas: quem escreve à pressa não
   * escreve "Gonçalo", escreve "goncalo".
   */
  const encontrados = useMemo(() => {
    const t = fold(procura);
    if (!t) return atletas.slice(0, 6);
    return atletas.filter((a) => fold(a.name).includes(t)).slice(0, 6);
  }, [procura, atletas]);

  // Só artigos com alguma coisa para dar: um armazém cheio de esgotados só
  // atrapalha quem está a entregar.
  const comStock = (itens ?? []).filter((i) => i.available > 0);

  /** O que os **outros** cartões levam de um tamanho: sai do stock que este cartão mostra. */
  const levadoPorOutros = (key: string, variantId: string) =>
    linhas.reduce((n, l) => (l.key !== key && l.variantId === variantId ? n + l.quantity : n), 0);

  const mudar = (key: string, parcial: Partial<Linha>) =>
    setLinhas((ls) => ls.map((l) => (l.key === key ? { ...l, ...parcial } : l)));

  /* Os cartões com artigo escolhido. Um cartão vazio (o último, por abrir) não conta. */
  const escolhidas = linhas.filter((l) => l.itemId);
  const linhaPronta = (l: Linha) => {
    const v = itens?.find((i) => i.id === l.itemId)?.variants.find((x) => x.id === l.variantId);
    if (!v) return false;
    const livre = v.available - levadoPorOutros(l.key, l.variantId);
    return l.quantity >= 1 && l.quantity <= livre && (!cobrar || centsDoValor(l.valor) > 0);
  };
  const totalCents = cobrar ? escolhidas.reduce((n, l) => n + (centsDoValor(l.valor) || 0), 0) : 0;

  const valido =
    Boolean(athleteId) &&
    escolhidas.length > 0 &&
    escolhidas.every(linhaPronta) &&
    (!cobrar || pagamentoSemValorValido(pagamento));

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    setFalhaPagamento(null);
    try {
      const pedido = (l: Linha): PagamentoPedido | undefined =>
        cobrar
          ? {
              modo: pagamento.modo,
              priceCents: centsDoValor(l.valor),
              ...(pagamento.modo === "pago" && pagamento.metodo ? { method: pagamento.metodo } : {}),
            }
          : undefined;
      const r = await assignLote({
        athleteId,
        notes: notas.trim() || undefined,
        linhas: escolhidas.map((l) => {
          const p = pedido(l);
          return { variantId: l.variantId, quantity: l.quantity, ...(p ? { pagamento: p } : {}) };
        }),
      });

      const falhas = r.entregas.filter((x) => x.erroDoPagamento);
      setFalhaPagamento(
        falhas.length > 0
          ? `O pagamento de ${falhas.map((x) => `${x.itemName} · ${x.variantLabel}`).join(", ")} não ficou registado (${falhas[0].erroDoPagamento!.replace(/\.$/, "")}). Acerta-o em Editar.`
          : null,
      );
      const cobranca =
        !cobrar || falhas.length === r.entregas.length
          ? ""
          : pagamento.modo === "pago"
            ? " Registado como pago."
            : pagamento.modo === "app"
              ? " Foi para os Pagamentos da app, com notificação."
              : " Fica por pagar no Equipamento da app.";
      if (r.entregas.some((x) => x.pagamento)) void reloadFees();
      const nomes = r.entregas.map((x) => `${x.itemName} · ${x.variantLabel}${x.quantity > 1 ? ` (${x.quantity})` : ""}`);
      setFeito(`${nomes.join(", ")} ${nomes.length === 1 ? "entregue" : "entregues"} a ${r.athleteName}.${cobranca}`);
      /*
       * Fica aberto depois de entregar, com o atleta escolhido: às vezes
       * lembra-se de mais uma peça já depois de confirmar.
       */
      setLinhas([linhaVazia()]);
      setNotas("");
      setPagamento(PAGAMENTO_VAZIO);
      const frescos = await listItems();
      setItens(frescos);
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível entregar.");
    } finally {
      setBusy(false);
    }
  }

  const n = escolhidas.length;
  const rotuloDoBotao = busy
    ? "A entregar…"
    : cobrar && totalCents > 0
      ? `Entregar ${n > 1 ? `${n} artigos ` : ""}· ${euros(totalCents)} ${pagamento.modo === "pago" ? "pago" : "por pagar"}`
      : n > 1
        ? `Entregar ${n} artigos`
        : "Confirmar entrega";

  /* Só se abre outro cartão quando todos os que existem têm artigo. */
  const podeAdicionar = linhas.every((l) => l.itemId) && comStock.length > 0;

  return (
    <Dialog
      labelledBy="entregar-equipamento"
      title="Entregar equipamento"
      subtitle={atleta ? atleta.name : "Procura o atleta e escolhe o que levar"}
      icon={<PackageOpen className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Fechar
          </button>
          <button type="submit" form="form-entregar" className="ctl-primary" disabled={!valido || busy}>
            {rotuloDoBotao}
          </button>
        </>
      }
    >
      <form id="form-entregar" onSubmit={submeter} className="space-y-4 p-5">
        {feito && (
          <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-ok-soft px-3 py-2.5 text-meta text-ok">
            <Check className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
            {feito} Podes entregar mais a esta pessoa.
          </p>
        )}
        {falhaPagamento && (
          <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-warn-soft px-3 py-2.5 text-meta text-warn">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            {falhaPagamento}
          </p>
        )}

        {/* 1. Quem */}
        {atletaFixo ? null : (
          <DialogField label="Atleta">
            {atleta ? (
              <button
                type="button"
                onClick={() => {
                  setAthleteId("");
                  setProcura("");
                }}
                className="flex w-full items-center gap-2.5 rounded-[var(--radius-control)] border border-line px-3 py-2 text-left"
              >
                <Monogram name={atleta.name} photoUrl={atleta.photoUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-ink">{atleta.name}</span>
                  <span className="block truncate text-meta text-ink-3">
                    {teamById(atleta.teamId)?.name ?? "Sem equipa"}
                  </span>
                </span>
                <span className="shrink-0 text-meta text-ink-3">Trocar</span>
              </button>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
                  <input
                    ref={campoProcura}
                    value={procura}
                    onChange={(e) => setProcura(e.target.value)}
                    placeholder="Procurar atleta…"
                    className={cx(dialogInputClass, "pl-8")}
                  />
                </div>
                {encontrados.length > 0 && (
                  <ListaDeEscolha className="mt-1.5 overflow-hidden rounded-[var(--radius-control)] border border-line">
                    {encontrados.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => setAthleteId(a.id)}
                          className="flex w-full items-center gap-2.5 border-b border-line px-3 py-2 text-left last:border-0 hover:bg-sunken/60"
                        >
                          <Monogram name={a.name} photoUrl={a.photoUrl} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body text-ink">{a.name}</span>
                            <span className="block truncate text-meta text-ink-3">
                              {teamById(a.teamId)?.name ?? "Sem equipa"}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ListaDeEscolha>
                )}
                {procura.trim() && encontrados.length === 0 && atletas.length > 0 && (
                  <p className="mt-1.5 text-meta text-ink-3">Nenhum atleta com esse nome.</p>
                )}
                {/*
                  Sem ninguém para escolher, a razão tem de estar escrita.
                  Foi assim que isto apareceu: uma pessoa com permissão de
                  inventário abria o diálogo e não conseguia escolher o atleta,
                  sem nada no ecrã a dizer porquê. Um atleta vê-se pela equipa.
                */}
                {atletas.length === 0 && (
                  <p className="mt-1.5 text-meta leading-relaxed text-ink-3">
                    {semEquipasAtribuidas(session)
                      ? "Ainda não és responsável por nenhuma equipa, e os atletas aparecem por equipa. Quem gere o clube atribui-te as tuas no separador Staff."
                      : "Este clube ainda não tem atletas activos."}
                  </p>
                )}
              </>
            )}
          </DialogField>
        )}

        {/* 2. O quê: um cartão por artigo, e o botão para mais um. */}
        <DialogField label={linhas.length > 1 ? `Artigos · ${n}` : "Artigo"}>
          {itens === null ? (
            <p className="text-meta text-ink-3">A carregar o armazém…</p>
          ) : comStock.length === 0 ? (
            <p className="rounded-[var(--radius-control)] border border-dashed border-line bg-sunken/50 px-2.5 py-2 text-meta text-ink-3">
              Não há stock disponível em nenhum artigo. Dá entrada de material primeiro.
            </p>
          ) : (
            <div className="space-y-2.5">
              {linhas.map((l) => (
                <CartaoDoArtigo
                  key={l.key}
                  linha={l}
                  itens={itens}
                  cobrar={cobrar}
                  levadoPorOutros={(variantId) => levadoPorOutros(l.key, variantId)}
                  onChange={(parcial) => mudar(l.key, parcial)}
                  /* O único cartão não se tira: esvazia-se escolhendo outro artigo. */
                  onRemove={linhas.length > 1 ? () => setLinhas((ls) => ls.filter((x) => x.key !== l.key)) : undefined}
                />
              ))}

              {podeAdicionar && (
                <button
                  type="button"
                  onClick={() => setLinhas((ls) => [...ls, linhaVazia()])}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 py-1 text-meta font-medium text-ink-3 transition-colors hover:text-ink"
                >
                  <Plus className="size-3.5" strokeWidth={2} />
                  Adicionar artigo
                </button>
              )}
            </div>
          )}
        </DialogField>

        {/* 3. O que vale para a entrega toda: as observações e o pagamento. */}
        {n > 0 && (
          <DialogField label="Observações" hint="opcional">
            <input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Equipamento de treino época 26/27"
              className={dialogInputClass}
            />
          </DialogField>
        )}

        {n > 0 && podeCobrar && (
          <>
            <PagamentoDaEntregaField
              value={pagamento}
              onChange={setPagamento}
              primeiroNome={atleta?.name.split(" ")[0]}
              athleteId={atleta?.id}
              semValor
            />
            {cobrar && (
              <p className="-mt-2 text-meta text-ink-3">
                O valor escreve-se em cada artigo: cada um fica com o seu pagamento.
                {totalCents > 0 && <span className="font-medium text-ink-2"> Total: {euros(totalCents)}.</span>}
              </p>
            )}
          </>
        )}

        {erro && (
          <p className="flex items-start gap-1.5 text-meta text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/**
 * Um artigo da entrega, com tudo o que é dele: sem artigo, a procura; com
 * artigo, o nome em cima, os tamanhos, a quantidade e o valor por baixo.
 */
function CartaoDoArtigo({
  linha,
  itens,
  cobrar,
  levadoPorOutros,
  onChange,
  onRemove,
}: {
  linha: Linha;
  itens: Item[];
  cobrar: boolean;
  /** Quanto os outros cartões levam deste tamanho. */
  levadoPorOutros: (variantId: string) => number;
  onChange: (parcial: Partial<Linha>) => void;
  onRemove?: () => void;
}) {
  const item = itens.find((i) => i.id === linha.itemId);
  const variante = item?.variants.find((v) => v.id === linha.variantId);
  const livre = (v: { id: string; available: number }) => v.available - levadoPorOutros(v.id);
  const livreDoArtigo = (i: Item) => i.variants.reduce((n, v) => n + Math.max(0, livre(v)), 0);

  /* Os artigos com stock livre, filtrados pelo que se escreve. Sem nada escrito, os primeiros. */
  const t = fold(linha.procura);
  const comLivre = itens.filter((i) => livreDoArtigo(i) > 0);
  const encontrados = (t ? comLivre.filter((i) => fold(`${i.name} ${i.category?.label ?? ""} ${i.brand ?? ""}`).includes(t)) : comLivre).slice(0, 8);

  function escolher(id: string) {
    const escolhido = itens.find((i) => i.id === id);
    // O primeiro tamanho com stock: é o que se entrega na maior parte das vezes, e muda-se com um toque.
    const primeiro = escolhido?.variants.find((x) => livre(x) > 0);
    onChange({ itemId: id, variantId: primeiro?.id ?? "", quantity: 1, procura: "" });
  }

  const tirar = onRemove && (
    <button
      type="button"
      onClick={onRemove}
      aria-label={item ? `Tirar ${item.name} da entrega` : "Tirar este artigo"}
      className="shrink-0 rounded p-1 text-ink-4 hover:text-risk"
    >
      <X className="size-3.5" strokeWidth={2} />
    </button>
  );

  if (!item) {
    return (
      <div className="rounded-[12px] border border-line p-2.5">
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
            <input
              value={linha.procura}
              onChange={(e) => onChange({ procura: e.target.value })}
              placeholder="Escreve o nome do artigo…"
              className={cx(dialogInputClass, "pl-8")}
            />
          </div>
          {tirar}
        </div>
        {encontrados.length > 0 ? (
          <ListaDeEscolha className="mt-1.5 max-h-[260px] overflow-y-auto rounded-[var(--radius-control)] border border-line">
            {encontrados.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => escolher(i.id)}
                  className="flex w-full items-center gap-2.5 border-b border-line px-3 py-2 text-left last:border-0 hover:bg-sunken/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-ink">{i.name}</span>
                    {i.category && <span className="block truncate text-meta text-ink-3">{i.category.label}</span>}
                  </span>
                  <span className="shrink-0 text-meta text-ink-3 tabular">{livreDoArtigo(i)} disp.</span>
                </button>
              </li>
            ))}
          </ListaDeEscolha>
        ) : (
          <p className="mt-1.5 px-0.5 text-meta text-ink-3">Nenhum artigo com stock com esse nome.</p>
        )}
      </div>
    );
  }

  const disponiveis = variante ? livre(variante) : 0;
  const aMais = Boolean(variante && linha.quantity > disponiveis);
  /*
   * Os tamanhos só aparecem quando há por onde escolher. Um artigo de tamanho
   * único (uma bola, um cone) mostrava uma pastilha "Único" que ninguém tinha
   * de tocar.
   */
  const variosTamanhos = item.variants.length > 1;
  const mudarQuantidade = (q: number) => onChange({ quantity: Math.min(Math.max(1, q), Math.max(1, disponiveis)) });

  return (
    <div
      className={cx(
        "rounded-[12px] border bg-surface px-3 py-2.5 transition-colors",
        aMais ? "border-risk/40" : "border-line",
      )}
    >
      {/*
        Uma linha: a imagem, o nome e o que há, e à direita o que se decide
        (quantas, e o valor quando há pagamento). A disponibilidade diz-se uma
        vez só, e é a do tamanho escolhido.
      */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {item.thumbnail ? (
            <img src={item.thumbnail} alt="" className="size-10 shrink-0 rounded-[8px] border border-line object-cover" />
          ) : (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[8px] bg-sunken text-ink-4">
              <Boxes className="size-[18px]" strokeWidth={1.5} />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-medium text-ink">{item.name}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-meta text-ink-3">
              <span className="truncate">
                {variosTamanhos && variante ? `${variante.label} · ` : ""}
                <span className={cx("tabular", aMais && "text-risk")}>{Math.max(0, disponiveis)}</span>{" "}
                {disponiveis === 1 ? "disponível" : "disponíveis"}
              </span>
              <span aria-hidden className="text-ink-4">·</span>
              <button
                type="button"
                onClick={() => onChange({ itemId: "", variantId: "", quantity: 1 })}
                className="shrink-0 font-medium text-ink-3 underline-offset-2 hover:text-ink hover:underline"
              >
                Trocar
              </button>
            </span>
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {cobrar && (
            <span className="relative w-[92px]">
              <input
                inputMode="decimal"
                value={linha.valor}
                onChange={(e) => onChange({ valor: e.target.value.replace(/[^\d.,]/g, "") })}
                placeholder="0,00"
                aria-label={`Valor de ${item.name}`}
                className={cx(dialogInputClass, "h-8 pr-6 text-right tabular")}
              />
              <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-meta text-ink-3">€</span>
            </span>
          )}

          {/* Quantas: − 1 +. Escrever um número para entregar uma peça era um gesto a mais. */}
          <div className="flex h-8 items-center rounded-[var(--radius-control)] border border-line">
            <button
              type="button"
              onClick={() => mudarQuantidade(linha.quantity - 1)}
              disabled={linha.quantity <= 1}
              aria-label={`Menos uma unidade de ${item.name}`}
              className="flex h-full w-7 items-center justify-center text-ink-3 hover:text-ink disabled:opacity-35"
            >
              <Minus className="size-3.5" strokeWidth={2} />
            </button>
            <input
              type="number"
              min={1}
              max={Math.max(1, disponiveis)}
              value={linha.quantity}
              onChange={(e) => onChange({ quantity: Math.max(1, Number(e.target.value) || 1) })}
              aria-label={`Quantidade de ${item.name}`}
              className="h-full w-9 [appearance:textfield] bg-transparent text-center text-body font-medium text-ink tabular outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <button
              type="button"
              onClick={() => mudarQuantidade(linha.quantity + 1)}
              disabled={linha.quantity >= disponiveis}
              aria-label={`Mais uma unidade de ${item.name}`}
              className="flex h-full w-7 items-center justify-center text-ink-3 hover:text-ink disabled:opacity-35"
            >
              <Plus className="size-3.5" strokeWidth={2} />
            </button>
          </div>

          {tirar}
        </div>
      </div>

      {/* O tamanho: pastilhas, alinhadas com o nome. Só quando há mais do que um. */}
      {variosTamanhos && (
        <div className="mt-2.5 flex flex-wrap gap-1.5 pl-[52px]">
          {item.variants.map((v) => {
            const vazio = livre(v) <= 0;
            const escolhido = v.id === linha.variantId;
            return (
              <button
                key={v.id}
                type="button"
                disabled={vazio}
                onClick={() => onChange({ variantId: v.id })}
                aria-pressed={escolhido}
                className={cx(
                  "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12px] font-medium transition-colors",
                  escolhido
                    ? "border-signal-ink/30 bg-signal-soft text-signal-ink"
                    : vazio
                      ? "cursor-not-allowed border-transparent bg-sunken/60 text-ink-4 line-through"
                      : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
                )}
              >
                {v.label}
                <span className="tabular text-[11px] opacity-60">{Math.max(0, livre(v))}</span>
              </button>
            );
          })}
        </div>
      )}

      {aMais && (
        <p className="mt-2 flex items-start gap-1.5 pl-[52px] text-meta text-risk">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
          Só há {Math.max(0, disponiveis)} {disponiveis === 1 ? "unidade" : "unidades"}
          {variosTamanhos ? " deste tamanho" : ""}
          {levadoPorOutros(linha.variantId) > 0 ? " além das que já vão noutro artigo" : ""}.
        </p>
      )}
    </div>
  );
}

/** Sem acentos e sem maiúsculas — como uma pessoa procura à pressa. */
function fold(v: string): string {
  return v.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
}
