import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { cx, ListaDeEscolha, Monogram } from "@/components/primitives";
import { Check, PackageOpen, Search, TriangleAlert } from "@/lib/icons";
import { listAthletes, teamById } from "@/lib/api";
import { can, semEquipasAtribuidas } from "@/lib/permissions";
import { reloadFees } from "@/lib/store";
import {
  PAGAMENTO_VAZIO,
  PagamentoDaEntregaField,
  pagamentoValido,
  pedidoDe,
  centsDe,
  type ValorDoPagamento,
} from "./PagamentoDaEntrega";
import { useSession } from "@/session";
import { assign, listItems, type Item } from "@/lib/inventory";

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
 * ## O artigo procura-se escrevendo
 *
 * Como o atleta: escreve-se o nome ("camisola", "fato") e os artigos com stock
 * aparecem por baixo. Uma lista suspensa com trinta artigos obrigava a ler
 * todos para encontrar um.
 *
 * ## O pagamento, no mesmo gesto
 *
 * Quem pode cobrar (`billing:write`) escolhe o pagamento da entrega: sem
 * pagamento, por pagar (só no Equipamento da app, ou também nos Pagamentos,
 * com notificação) ou pago (com o método, e cai nas Contas). Vai com a entrega
 * e o servidor trata das cobranças (`definirPagamento`); depois muda-se em
 * "Editar", na ficha do atleta ou nas Entregas. Ver `PagamentoDaEntregaField`.
 *
 * ## Os tamanhos sem stock aparecem, mas não se escolhem
 *
 * Escondê-los faria parecer que o clube nunca teve aquele tamanho. Mostrá-los
 * riscados e sem stock diz a verdade — *há, mas está todo entregue* — que é
 * precisamente a informação que faz alguém ir buscar outro tamanho em vez de
 * procurar mais.
 */
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
  const [itemId, setItemId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [quantidade, setQuantidade] = useState(1);
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** A entrega ficou, o pagamento não. À parte do aviso verde, para não se perder nele. */
  const [falhaPagamento, setFalhaPagamento] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [procuraArtigo, setProcuraArtigo] = useState("");
  /** O pagamento desta entrega. Ver o cabeçalho. */
  const podeCobrar = can(session, "billing:write");
  const [pagamento, setPagamento] = useState<ValorDoPagamento>(PAGAMENTO_VAZIO);

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
  const item = itens?.find((i) => i.id === itemId);
  const variante = item?.variants.find((v) => v.id === variantId);

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

  const valorCents = centsDe(pagamento);
  const pagamentoOk = pagamentoValido(pagamento);
  const valido = Boolean(athleteId && variantId && quantidade >= 1 && (variante?.available ?? 0) >= quantidade && pagamentoOk);

  /* Os artigos com stock, filtrados pelo que se escreve. Sem nada escrito, os primeiros. */
  const artigosEncontrados = useMemo(() => {
    const t = fold(procuraArtigo);
    const lista = (itens ?? []).filter((i) => i.available > 0);
    return (t ? lista.filter((i) => fold(`${i.name} ${i.category?.label ?? ""} ${i.brand ?? ""}`).includes(t)) : lista).slice(0, 8);
  }, [procuraArtigo, itens]);

  function escolherArtigo(id: string) {
    setItemId(id);
    // O tamanho anterior não existe no artigo novo: limpar evita entregar de um artigo com o id de outro.
    const escolhido = (itens ?? []).find((i) => i.id === id);
    const primeiro = escolhido?.variants.find((x) => x.available > 0);
    setVariantId(primeiro?.id ?? "");
  }

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    setFalhaPagamento(null);
    try {
      const r = await assign({
        athleteId,
        variantId,
        quantity: quantidade,
        notes: notas.trim() || undefined,
        ...(podeCobrar && pagamento.modo !== "nenhum" ? { pagamento: pedidoDe(pagamento) } : {}),
      });
      setFalhaPagamento(r.erroDoPagamento ? `O pagamento não ficou registado (${r.erroDoPagamento.replace(/\.$/, "")}). Acerta-o em Editar.` : null);
      const cobranca = r.erroDoPagamento
        ? ""
        : pagamento.modo === "pago"
          ? " Registado como pago."
          : pagamento.modo === "app"
            ? " Foi para os Pagamentos da app, com notificação."
            : pagamento.modo === "porPagar"
              ? " Fica por pagar no Equipamento da app."
              : "";
      if (r.pagamento) void reloadFees();
      setFeito(`${r.itemName} · ${r.variantLabel} entregue a ${r.athleteName}.${cobranca}`);
      /*
       * Fica aberto depois de entregar.
       *
       * Quem está ao balcão entrega três coisas ao mesmo atleta — a t-shirt, os
       * calções, as meias — e fechar obrigava a reabrir e a procurar a pessoa
       * outra vez. O artigo limpa-se, o atleta fica.
       */
      setItemId("");
      setVariantId("");
      setQuantidade(1);
      setNotas("");
      setProcuraArtigo("");
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
            {busy
              ? "A entregar…"
              : (pagamento.modo === "porPagar" || pagamento.modo === "app") && valorCents > 0
                ? `Entregar · ${(valorCents / 100).toLocaleString("pt-PT", { style: "currency", currency: "EUR" })} por pagar`
                : pagamento.modo === "pago" && valorCents > 0
                  ? `Entregar · ${(valorCents / 100).toLocaleString("pt-PT", { style: "currency", currency: "EUR" })} pago`
                  : "Confirmar entrega"}
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

        {/* 2. O quê */}
        <DialogField label="Artigo">
          {itens === null ? (
            <p className="text-meta text-ink-3">A carregar o armazém…</p>
          ) : comStock.length === 0 ? (
            <p className="rounded-[var(--radius-control)] border border-dashed border-line bg-sunken/50 px-2.5 py-2 text-meta text-ink-3">
              Não há stock disponível em nenhum artigo. Dá entrada de material primeiro.
            </p>
          ) : (
            item ? (
              <button
                type="button"
                onClick={() => {
                  setItemId("");
                  setVariantId("");
                  setProcuraArtigo("");
                }}
                className="flex w-full items-center gap-2.5 rounded-[var(--radius-control)] border border-line px-3 py-2 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-ink">{item.name}</span>
                  <span className="block truncate text-meta text-ink-3">
                    {[item.category?.label, `${item.available} disponíveis`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-meta text-ink-3">Trocar</span>
              </button>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
                  <input
                    value={procuraArtigo}
                    onChange={(e) => setProcuraArtigo(e.target.value)}
                    placeholder="Escreve o nome do artigo…"
                    className={cx(dialogInputClass, "pl-8")}
                  />
                </div>
                {artigosEncontrados.length > 0 ? (
                  <ListaDeEscolha className="mt-1.5 max-h-[260px] overflow-y-auto rounded-[var(--radius-control)] border border-line">
                    {artigosEncontrados.map((i) => (
                      <li key={i.id}>
                        <button
                          type="button"
                          onClick={() => escolherArtigo(i.id)}
                          className="flex w-full items-center gap-2.5 border-b border-line px-3 py-2 text-left last:border-0 hover:bg-sunken/60"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body text-ink">{i.name}</span>
                            {i.category && <span className="block truncate text-meta text-ink-3">{i.category.label}</span>}
                          </span>
                          <span className="shrink-0 text-meta text-ink-3 tabular">{i.available} disp.</span>
                        </button>
                      </li>
                    ))}
                  </ListaDeEscolha>
                ) : (
                  <p className="mt-1.5 text-meta text-ink-3">Nenhum artigo com stock com esse nome.</p>
                )}
              </>
            )
          )}
        </DialogField>

        {/* 3. Que tamanho — pastilhas, não uma lista: são poucos e escolhem-se ao toque. */}
        {item && (
          <DialogField label="Tamanho" hint={variante ? `${variante.available} disponíveis` : undefined}>
            <div className="flex flex-wrap gap-1.5">
              {item.variants.map((v) => {
                const vazio = v.available <= 0;
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={vazio}
                    onClick={() => setVariantId(v.id)}
                    className={cx(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-meta font-medium transition-colors",
                      v.id === variantId
                        ? "bg-signal-soft text-signal-ink"
                        : vazio
                          ? "cursor-not-allowed bg-sunken/60 text-ink-4 line-through"
                          : "bg-sunken text-ink-2 hover:text-ink",
                    )}
                  >
                    {v.label}
                    <span className="tabular opacity-70">{v.available}</span>
                  </button>
                );
              })}
            </div>
          </DialogField>
        )}

        {/* 4. Quantas */}
        {variante && (
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
            <DialogField label="Quantidade">
              <input
                type="number"
                min={1}
                max={variante.available}
                value={quantidade}
                onChange={(e) => setQuantidade(Math.max(1, Number(e.target.value) || 1))}
                className={cx(dialogInputClass, "tabular")}
              />
            </DialogField>
            <DialogField label="Observações" hint="opcional">
              <input
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Equipamento de treino época 26/27"
                className={dialogInputClass}
              />
            </DialogField>
          </div>
        )}

        {/* 5. O pagamento, para quem pode cobrar. Ver o cabeçalho. */}
        {variante && podeCobrar && (
          <PagamentoDaEntregaField value={pagamento} onChange={setPagamento} primeiroNome={atleta?.name.split(" ")[0]} athleteId={atleta?.id} />
        )}

        {variante && quantidade > variante.available && (
          <p className="flex items-start gap-1.5 text-meta text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            Só há {variante.available} {variante.available === 1 ? "unidade" : "unidades"} deste tamanho.
          </p>
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

/** Sem acentos e sem maiúsculas — como uma pessoa procura à pressa. */
function fold(v: string): string {
  return v.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
}
