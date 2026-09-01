import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { Check, Trash2, TriangleAlert, X } from "@/lib/icons";

/**
 * Apagar várias linhas de uma lista.
 *
 * ## Porque é que não é uma operação em bloco no servidor
 *
 * Porque cada apagar tem as suas regras, e elas já existem: um atleta com
 * mensalidades ou presenças não se apaga, um sócio com número também não, uma
 * conta de staff com trabalho em seu nome desactiva-se em vez de desaparecer.
 * Um `POST /bulk-delete` teria de reescrever essas três verificações — e a cópia
 * diverge da original ao primeiro ajuste.
 *
 * Aqui chama-se o apagar de sempre, um por linha, e recolhe-se o resultado de
 * cada um.
 *
 * ## Sucesso parcial é a resposta certa
 *
 * Escolhem-se cinco atletas e dois têm histórico: apagam-se três e diz-se quais
 * ficaram, e porquê. Tudo-ou-nada seria pior — não aconteceria nada, e a pessoa
 * teria de descobrir sozinha qual dos cinco travou a operação.
 */
export type BulkTarget = { id: string; name: string };

export type BulkResult = { name: string; error: string };

export function BulkBar({
  count,
  noun,
  onClear,
  onDelete,
}: {
  count: number;
  /** ["sócio", "sócios"] — o singular e o plural, como no resto da consola. */
  noun: [string, string];
  onClear: () => void;
  onDelete: () => void;
}) {
  if (count === 0) return null;

  return (
    /*
     * Encostada ao fundo do ecrã e não no topo da tabela.
     *
     * Quem escolhe linhas percorre a lista a descer; uma barra no topo fica para
     * trás e obriga a subir para agir. Flutuar sobre a página mantém a acção à
     * mão em qualquer ponto — e desaparece assim que se limpa a escolha.
     */
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-ink px-3 py-2 text-surface shadow-[var(--shadow-pop)]">
        <span className="pl-1.5 text-body font-medium tabular">
          {count} {count === 1 ? noun[0] : noun[1]}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1.5 rounded-full bg-risk px-3 py-1.5 text-meta font-semibold text-white"
        >
          <Trash2 className="size-3.5" strokeWidth={1.75} />
          Apagar
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label="Limpar selecção"
          className="flex size-7 items-center justify-center rounded-full text-surface/70 hover:bg-white/10 hover:text-surface"
        >
          <X className="size-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

/**
 * A confirmação, e o relatório do que aconteceu.
 *
 * Mostra os nomes antes de apagar — uma contagem ("apagar 5?") não deixa ninguém
 * verificar se a escolha é a que julga ter feito, e a escolha fez-se com cliques
 * numa lista onde é fácil enganar-se numa linha.
 */
export function BulkDeleteDialog({
  targets,
  noun,
  remove,
  onClose,
  onDone,
}: {
  targets: BulkTarget[];
  noun: [string, string];
  /** O apagar de sempre desta entidade. Lança quando o servidor recusa. */
  remove: (id: string) => Promise<unknown>;
  onClose: () => void;
  /** Chamado no fim, mesmo com falhas parciais: a lista tem de reler. */
  onDone: (apagados: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [falhas, setFalhas] = useState<BulkResult[] | null>(null);
  const [apagados, setApagados] = useState(0);

  async function apagar() {
    if (busy) return;
    setBusy(true);

    const erros: BulkResult[] = [];
    let feitos = 0;

    /*
     * Um de cada vez, e não em paralelo.
     *
     * Apagar dez linhas de uma vez são dez transacções no servidor a tocar nas
     * mesmas tabelas; em série é mais lento e é a diferença entre um relatório
     * legível e dez erros de concorrência. Ninguém apaga duzentos registos por
     * dia numa ferramenta destas.
     */
    for (const t of targets) {
      try {
        await remove(t.id);
        feitos++;
      } catch (e) {
        erros.push({ name: t.name, error: e instanceof Error ? e.message : "Não foi possível apagar." });
      }
    }

    setApagados(feitos);
    setFalhas(erros);
    setBusy(false);
    onDone(feitos);

    // Correu tudo bem: não há nada para ler, e um diálogo a dizer "3 apagados"
    // é mais um clique para fechar o que já se vê na lista.
    if (erros.length === 0) onClose();
  }

  const n = targets.length;

  return (
    <Dialog
      labelledBy="apagar-varios"
      title={falhas ? "Nem tudo foi apagado" : `Apagar ${n} ${n === 1 ? noun[0] : noun[1]}?`}
      icon={<Trash2 className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={520}
      footer={
        falhas ? (
          <button type="button" onClick={onClose} className="ctl-primary">
            Fechar
          </button>
        ) : (
          <>
            <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void apagar()}
              disabled={busy}
              className={cx("ctl-primary", "bg-risk hover:bg-risk")}
            >
              {busy ? `A apagar… (${apagados}/${n})` : "Apagar"}
            </button>
          </>
        )
      }
    >
      <div className="space-y-3 p-5">
        {falhas ? (
          <>
            {apagados > 0 && (
              <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-ok-soft px-3 py-2.5 text-meta text-ok">
                <Check className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
                {apagados} {apagados === 1 ? "apagado" : "apagados"}.
              </p>
            )}
            <p className="text-body font-medium text-ink">
              {falhas.length} {falhas.length === 1 ? "não foi possível" : "não foram possíveis"}:
            </p>
            <ul className="space-y-1.5">
              {falhas.map((f) => (
                <li key={f.name} className="rounded-[var(--radius-control)] border border-line px-3 py-2">
                  <span className="block text-body text-ink">{f.name}</span>
                  <span className="block text-meta leading-relaxed text-ink-3">{f.error}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-risk-soft px-3 py-2.5 text-meta leading-relaxed text-risk">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
              Esta operação não se pode desfazer. {n === 1 ? "O registo" : "Os registos"} serão apagados do sistema.
            </p>
            <ul className="max-h-[240px] space-y-1 overflow-y-auto">
              {targets.map((t) => (
                <li key={t.id} className="truncate rounded-[var(--radius-control)] bg-sunken px-3 py-1.5 text-body text-ink-2">
                  {t.name}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  );
}
