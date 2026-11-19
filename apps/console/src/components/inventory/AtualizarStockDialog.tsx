import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { ClipboardCheck, PackageCheck, PackageOpen, Pencil, TriangleAlert } from "@/lib/icons";
import { hojeISO, moveStock, type Variant } from "@/lib/inventory";
import { mostrarOk } from "@/lib/avisos";

export type ModoDeStock = "ENTRY" | "EXIT" | "ADJUSTMENT";

/**
 * Atualizar o stock de um artigo: todos os tamanhos numa janela.
 *
 * ## Porque é que isto existe
 *
 * Um clube perguntou como se fazia a recontagem do inventário. A resposta era
 * "toca no tamanho", e nada na ficha o dizia: o quadrado de cada tamanho não
 * parece um botão, e o "Editar" do cabeçalho é para o artigo (nome, marca,
 * preço), não para as quantidades. Agora há um botão com nome — "Atualizar
 * stock" — e a janela diz logo em cima as três coisas que se podem fazer.
 *
 * ## As três coisas, com nomes do armazém
 *
 * - **Chegou material**: soma ao que há (uma compra, uma oferta).
 * - **Saiu material**: tira do que há (vendido fora, oferecido, estragado).
 * - **Contagem**: escreve-se quantas se contaram **no clube**, e o sistema
 *   acerta. É a que mais se engana: o servidor guarda o total, que inclui o que
 *   está em casa dos atletas, e isso ninguém consegue contar na arrecadação. Por
 *   isso a pergunta é o que está no clube (prontas a entregar mais as guardadas
 *   para atletas), e o total que vai para o servidor é essa contagem mais o que
 *   está com eles.
 *
 * ## Vários tamanhos de uma vez
 *
 * Uma encomenda chega com seis tamanhos; uma contagem faz-se ao armazém todo.
 * Por isso a janela tem uma linha por tamanho, e só os que levam um número
 * mudam. Cada linha diz ao lado como fica, antes de gravar. O Enter salta para
 * o tamanho seguinte, como numa folha de cálculo.
 *
 * ## O dia
 *
 * Por omissão é hoje, e muda-se: a encomenda que chegou na sexta e só se
 * registou na segunda fica no histórico na sexta (Rui, 19/11/2026). O stock
 * muda na mesma no momento em que se grava; o dia é o do histórico.
 */
export function AtualizarStockDialog({
  itemName,
  variants,
  modoInicial = "ENTRY",
  focoInicial,
  onEditarTamanho,
  onClose,
  onDone,
}: {
  itemName: string;
  variants: Variant[];
  modoInicial?: ModoDeStock;
  /** O tamanho onde o cursor começa (quando se abre a partir do quadrado dele). */
  focoInicial?: string;
  /** Abre a edição do tamanho (nome, referência, mínimo). */
  onEditarTamanho?: (v: Variant) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [modo, setModo] = useState<ModoDeStock>(modoInicial);
  /** O que se escreveu em cada tamanho, por id. Vazio = esse tamanho não muda. */
  const [valores, setValores] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState("");
  const [dia, setDia] = useState(hojeISO());
  const diaOk = /^\d{4}-\d{2}-\d{2}$/.test(dia) && dia <= hojeISO();
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campos = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const i = Math.max(0, variants.findIndex((v) => v.id === focoInicial));
    campos.current[i]?.focus();
    // Só ao abrir: depois o foco é de quem escreve.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Trocar de modo limpa os números: "5" em Chegou não é "5" numa contagem. */
  function mudarModo(m: ModoDeStock) {
    if (m === modo) return;
    setModo(m);
    setValores({});
    setErro(null);
  }

  /** Como fica cada tamanho com o que se escreveu. */
  const linhas = useMemo(
    () =>
      variants.map((v) => {
        const reservadas = v.reserved ?? 0;
        const comAtletas = v.assigned - reservadas;
        const noClube = v.available + reservadas;
        const texto = (valores[v.id] ?? "").trim();
        const n = texto === "" ? null : Number(texto);
        const valido = n === null || (Number.isInteger(n) && n >= 0);

        let novoTotal = v.total;
        let problema: string | null = null;
        if (n !== null && valido) {
          if (modo === "ENTRY") novoTotal = v.total + n;
          else if (modo === "EXIT") {
            novoTotal = v.total - n;
            if (n > v.available) problema = `Só há ${v.available} prontas a sair`;
          } else {
            // A contagem é do que está no clube; o que está com atletas soma-se.
            novoTotal = n + comAtletas;
            if (n < reservadas) problema = `Há ${reservadas} guardadas para atletas, conta-as também`;
          }
        }
        if (!valido) problema = "Escreve um número inteiro";

        const prontas = novoTotal - v.assigned;
        const diferenca = novoTotal - v.total;
        const muda = n !== null && valido && !problema && (modo === "ADJUSTMENT" ? diferenca !== 0 : n > 0);
        return { v, reservadas, comAtletas, noClube, n, novoTotal, prontas, diferenca, problema, muda };
      }),
    [variants, valores, modo],
  );

  const aMudar = linhas.filter((l) => l.muda);
  const comProblema = linhas.some((l) => l.problema);
  const somaDiferencas = aMudar.reduce((s, l) => s + l.diferenca, 0);
  const sujo = Object.values(valores).some((t) => t.trim() !== "");

  async function gravar() {
    if (busy || aMudar.length === 0 || comProblema || !diaOk) return;
    setBusy(true);
    setErro(null);
    const feitos: string[] = [];
    try {
      for (const l of aMudar) {
        await moveStock(l.v.id, {
          type: modo,
          // Na contagem o servidor fixa o total; nas outras soma ou tira a quantidade.
          quantity: modo === "ADJUSTMENT" ? l.novoTotal : l.n!,
          reason: motivo.trim() || undefined,
          // Hoje não se manda: o servidor grava a hora certa. Outro dia vai escrito.
          ...(dia !== hojeISO() ? { on: dia } : {}),
        });
        feitos.push(l.v.label);
      }
      mostrarOk(
        aMudar.length === 1
          ? `Tamanho ${aMudar[0].v.label} atualizado.`
          : `${aMudar.length} tamanhos atualizados.`,
      );
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Não foi possível gravar.";
      const falhou = aMudar[feitos.length]?.v.label;
      setErro(feitos.length ? `Gravados: ${feitos.join(", ")}. No ${falhou}: ${msg}` : msg);
      // Os que ficaram gravados saem da folha, para não se gravarem duas vezes.
      setValores((vs) => {
        const novo = { ...vs };
        for (const l of aMudar.slice(0, feitos.length)) delete novo[l.v.id];
        return novo;
      });
      if (feitos.length) onDone();
    } finally {
      setBusy(false);
    }
  }

  const MODOS: { k: ModoDeStock; titulo: string; detalhe: string; icon: typeof PackageCheck }[] = [
    { k: "ENTRY", titulo: "Chegou material", detalhe: "Soma ao que já há. Uma compra, uma oferta.", icon: PackageCheck },
    { k: "EXIT", titulo: "Saiu material", detalhe: "Tira do que há. Vendido fora, oferecido, estragado.", icon: PackageOpen },
    { k: "ADJUSTMENT", titulo: "Contagem", detalhe: "Escreve quantas contaste no clube. O stock fica certo.", icon: ClipboardCheck },
  ];

  const rotuloDoCampo = modo === "ENTRY" ? "Chegaram" : modo === "EXIT" ? "Saíram" : "Contei";

  return (
    <Dialog
      labelledBy="atualizar-stock"
      title="Atualizar stock"
      subtitle={itemName}
      onClose={onClose}
      width={620}
      footer={
        <>
          <span className="mr-auto text-meta text-ink-3 tabular" aria-live="polite">
            {aMudar.length === 0
              ? "Escreve um número nos tamanhos que mudam."
              : `${aMudar.length} ${aMudar.length === 1 ? "tamanho muda" : "tamanhos mudam"} · ${somaDiferencas >= 0 ? "+" : "−"}${Math.abs(somaDiferencas)} ${Math.abs(somaDiferencas) === 1 ? "unidade" : "unidades"}`}
          </span>
          <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
            Cancelar
          </button>
          <button type="button" onClick={() => void gravar()} className="ctl-primary" disabled={busy || aMudar.length === 0 || comProblema || !diaOk}>
            {busy ? "A gravar…" : aMudar.length > 1 ? `Gravar ${aMudar.length} tamanhos` : "Gravar"}
          </button>
        </>
      }
    >
      <div className="space-y-4 p-5 max-sm:p-4">
        {/* O que aconteceu: três escolhas com o que cada uma faz dito por baixo. */}
        <fieldset>
          <legend className="mb-2 text-meta font-medium text-ink">O que aconteceu</legend>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="O que aconteceu">
            {MODOS.map(({ k, titulo, detalhe, icon: Icon }) => {
              const ativo = modo === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  onClick={() => mudarModo(k)}
                  className={cx(
                    "flex items-start gap-2.5 rounded-[var(--radius-control)] border px-3 py-2.5 text-left transition-colors duration-[120ms]",
                    ativo ? "border-ink bg-sunken" : "border-line hover:border-line-strong hover:bg-sunken/50",
                  )}
                >
                  <Icon className={cx("mt-0.5 size-4 shrink-0", ativo ? "text-ink" : "text-ink-4")} strokeWidth={1.75} />
                  <span className="min-w-0">
                    <span className={cx("block text-body font-semibold", ativo ? "text-ink" : "text-ink-2")}>{titulo}</span>
                    <span className="block text-meta leading-snug text-ink-3">{detalhe}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Os tamanhos: o que há agora, o número, e como fica. */}
        <div className="overflow-hidden rounded-[var(--radius-control)] border border-line">
          <div className="grid grid-cols-[minmax(0,1fr)_88px_minmax(0,108px)_28px] items-center gap-3 border-b border-line bg-sunken/60 px-3 py-2 text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
            <span>Tamanho</span>
            <span className="text-right">{rotuloDoCampo}</span>
            <span className="text-right">Fica</span>
            <span />
          </div>
          <ul className="max-h-[46vh] divide-y divide-line overflow-y-auto">
            {linhas.map((l, i) => (
              <li key={l.v.id} className={cx("px-3 py-2", l.problema && "bg-risk-soft/40")}>
                <div className="grid grid-cols-[minmax(0,1fr)_88px_minmax(0,108px)_28px] items-center gap-3">
                  <label htmlFor={`stock-${l.v.id}`} className="min-w-0">
                    <span className="block truncate text-body font-semibold text-ink">{l.v.label}</span>
                    <span className="block truncate text-meta text-ink-3 tabular">
                      {modo === "ADJUSTMENT"
                        ? `${l.noClube} no clube${l.comAtletas > 0 ? ` · ${l.comAtletas} com atletas` : ""}`
                        : `${l.v.available} prontas${l.v.minimumStock > 0 ? ` · mín. ${l.v.minimumStock}` : ""}`}
                    </span>
                  </label>
                  <input
                    id={`stock-${l.v.id}`}
                    ref={(el) => {
                      campos.current[i] = el;
                    }}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={valores[l.v.id] ?? ""}
                    placeholder={modo === "ADJUSTMENT" ? String(l.noClube) : "0"}
                    onChange={(e) => setValores((vs) => ({ ...vs, [l.v.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      const seguinte = campos.current[i + 1];
                      if (seguinte) seguinte.focus();
                      else void gravar();
                    }}
                    className={cx(dialogInputClass, "h-9 text-right text-[15px] font-semibold tabular", l.problema && "border-risk")}
                  />
                  <span className="text-right">
                    {l.muda ? (
                      <>
                        <span className="block text-body font-semibold text-ink tabular">{l.prontas} prontas</span>
                        <span className={cx("block text-meta font-medium tabular", l.diferenca >= 0 ? "text-ok" : "text-warn")}>
                          {l.diferenca >= 0 ? "+" : "−"}
                          {Math.abs(l.diferenca)}
                        </span>
                      </>
                    ) : (
                      <span className="text-meta text-ink-4">igual</span>
                    )}
                  </span>
                  {onEditarTamanho ? (
                    <button
                      type="button"
                      onClick={() => onEditarTamanho(l.v)}
                      disabled={sujo}
                      title={sujo ? "Grava ou cancela primeiro" : `Editar o tamanho ${l.v.label} (nome, referência, mínimo)`}
                      aria-label={`Editar o tamanho ${l.v.label}`}
                      className="flex size-7 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-ink-2 disabled:opacity-30"
                    >
                      <Pencil className="size-3.5" strokeWidth={1.75} />
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
                {l.problema && (
                  <p className="mt-1 flex items-center gap-1.5 text-meta text-risk">
                    <TriangleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
                    {l.problema}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>

        {modo === "ADJUSTMENT" && (
          <p className="text-meta leading-relaxed text-ink-3">
            Conta o que está fisicamente no clube, incluindo o que está guardado para entregar a atletas. O que já está com os atletas não se
            conta: o sistema junta-o sozinho. Um tamanho em branco fica como está.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-[170px_minmax(0,1fr)]">
          <DialogField
            label={modo === "ENTRY" ? "Chegou a" : modo === "EXIT" ? "Saiu a" : "Contado a"}
            hint={dia === hojeISO() ? "hoje" : diaOk ? undefined : "não pode ser depois de hoje"}
          >
            <input
              type="date"
              value={dia}
              max={hojeISO()}
              onChange={(e) => setDia(e.target.value)}
              aria-invalid={!diaOk}
              className={cx(dialogInputClass, "tabular", !diaOk && "border-risk")}
            />
          </DialogField>
          <DialogField label="Motivo" hint="opcional, fica no histórico de cada tamanho">
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={modo === "ENTRY" ? "Encomenda de início de época" : modo === "EXIT" ? "Oferta ao clube visitante" : "Contagem de fim de época"}
              className={dialogInputClass}
            />
          </DialogField>
        </div>

        {erro && (
          <p className="flex items-start gap-1.5 text-meta text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </p>
        )}
      </div>
    </Dialog>
  );
}
