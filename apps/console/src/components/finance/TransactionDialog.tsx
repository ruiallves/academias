import { useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { SelectField, cx } from "@/components/primitives";
import { Repeat, Trash2, TrendingDown, TrendingUp, TriangleAlert } from "@/lib/icons";
import { useActiveCatalog } from "@/lib/catalogs";
import { listTeams } from "@/lib/api";
import { useSession } from "@/session";
import {
  METHOD_LABEL,
  createTransaction,
  deleteTransaction,
  updateTransaction,
  type FinanceKind,
  type TransactionRow,
} from "@/lib/finance";

/**
 * Registar um movimento — receita ou despesa, no mesmo diálogo.
 *
 * ## Um botão, não dois
 *
 * O formulário já era um só: receita e despesa são o mesmo gesto com o sinal
 * trocado, e o `kind` só mudava o título e uns quantos exemplos. O que estava a
 * dobrar era a **entrada** — dois botões no cabeçalho de cada página, a obrigar
 * a decidir o tipo antes de ver o formulário, quando quem chega ali muitas vezes
 * só tem um papel na mão e ainda vai a pensar no que ele é.
 *
 * Agora o tipo escolhe-se lá dentro, na primeira linha, e muda-se sem fechar
 * nada. A escolha errada deixou de custar um cancelar e um segundo clique.
 *
 * ## As duas perguntas do topo, por ordem
 *
 * **O quê** (receita ou despesa) decide o sinal; **quando** (já aconteceu ou
 * está previsto) decide se mexe no saldo ou nas previsões — e é essa que faz o
 * saldo dizer a verdade. Nenhuma das duas é um selector escondido no fim.
 *
 * O valor escreve-se em euros e guarda-se em cêntimos: ninguém pensa em
 * cêntimos, e nenhuma conta do produto aceita floats.
 *
 * ## Registar e corrigir são o mesmo formulário
 *
 * Com `transaction` preenchido, isto abre em modo de edição. É o mesmo diálogo
 * de propósito: os campos são os mesmos, e um segundo formulário só para
 * corrigir uma categoria mal escolhida seria a mesma coisa dita duas vezes, a
 * divergir na primeira alteração.
 *
 * O que muda em edição, e porquê:
 *
 * - **O tipo fica preso.** Uma despesa que vira receita não é uma correcção, é
 *   outro movimento — a API recusa-o, e mostrá-lo clicável era prometer o que
 *   não se cumpre.
 * - **A repetição desaparece.** Transformar um movimento solto numa série a
 *   meio de uma correcção criaria doze linhas que ninguém pediu; quem quer uma
 *   série regista-a.
 * - **Uma linha de série pergunta o alcance** — só este mês, ou também os
 *   seguintes. É a pergunta do "a renda subiu", e sem ela quem tem trinta e
 *   seis meses lançados corrigia trinta e seis à mão.
 * - **Aparece o apagar**, para o que nunca devia ter sido lançado. Cancelar
 *   continua na linha da lista: são coisas diferentes, e a regra 3 do serviço
 *   explica porquê.
 */
export function TransactionDialog({
  kind: kindInicial = "EXPENSE",
  transaction,
  eventLink,
  onClose,
  onDone,
}: {
  /**
   * Por onde o diálogo abre. É só o ponto de partida — quem o abre pode ter uma
   * pista (o botão de um evento, um atalho), e quem o usa muda à vontade.
   */
  kind?: FinanceKind;
  /** Preenchido = corrigir este movimento, em vez de registar um novo. */
  transaction?: TransactionRow;
  /** Quando se chega pelo calendário, o movimento já nasce ligado ao evento. */
  eventLink?: { matchId?: string; calendarEventId?: string; label: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const editar = transaction ?? null;
  const { session } = useSession();
  const [kind, setKind] = useState<FinanceKind>(editar?.kind ?? kindInicial);
  const receita = kind === "INCOME";
  const categorias = useActiveCatalog(receita ? "financeIncome" : "financeExpense");
  const equipas = listTeams(session);

  const [descricao, setDescricao] = useState(editar?.description ?? "");
  const [valor, setValor] = useState(editar ? paraEuros(editar.amountCents) : "");
  const [data, setData] = useState(editar ? diaDe(editar.occurredAt) : hoje());
  const [estado, setEstado] = useState<"COMPLETED" | "PLANNED">(
    editar ? (editar.status === "COMPLETED" ? "COMPLETED" : "PLANNED") : eventLink ? "PLANNED" : "COMPLETED",
  );
  const [fixa, setFixa] = useState(false);
  const [ate, setAte] = useState("");
  const [categoria, setCategoria] = useState(editar?.category?.id ?? "");
  const [metodo, setMetodo] = useState(editar?.method ?? "");
  const [contraparte, setContraparte] = useState(editar?.counterparty ?? "");
  const [equipa, setEquipa] = useState(editar?.team?.id ?? "");
  const [notas, setNotas] = useState(editar?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /**
   * A correcção de uma linha de série alcança só este mês ou também os
   * seguintes. Começa em "só este": dos dois enganos possíveis, corrigir de
   * menos desfaz-se com outra correcção, e corrigir trinta e seis meses sem
   * querer não.
   */
  const [alcance, setAlcance] = useState<"one" | "series">("one");
  /** O apagar confirma-se aqui dentro — um diálogo por cima de outro é pior. */
  const [aApagar, setAApagar] = useState(false);

  /*
   * Um movimento cancelado é história: a API recusa reactivá-lo, e por isso o
   * "quando" não se mostra. O resto continua editável — corrigir a categoria de
   * uma linha cancelada é arrumação legítima do extracto.
   */
  const cancelado = editar?.status === "CANCELLED";

  const cents = paraCentimos(valor);
  const meses = fixa && ate ? contarMeses(data, ate) : 0;
  const valido =
    descricao.trim().length >= 2 && cents !== null && cents > 0 && Boolean(data) && (!fixa || meses > 0);

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      if (editar) {
        await updateTransaction(editar.id, {
          ...(editar.seriesId ? { scope: alcance } : {}),
          description: descricao.trim(),
          amountCents: cents,
          occurredAt: data,
          // Vazio limpa, como manda a regra da casa dos DTOs — é assim que se
          // tira uma categoria mal escolhida sem ter de escolher outra.
          categoryId: categoria,
          method: metodo,
          counterparty: contraparte.trim(),
          teamId: equipa,
          notes: notas.trim(),
          /*
           * O estado só vai quando **mudou**.
           *
           * O selector tem dois valores e a base tem quatro: um movimento
           * `PENDING` aparece no botão "Prevista", e mandá-lo sempre convertia-o
           * em `PLANNED` a cada correcção de categoria — uma mudança de estado
           * que ninguém pediu, escondida dentro de outra coisa.
           */
          ...(cancelado || estado === editar.status ? {} : { status: estado }),
        });
        onDone();
        return;
      }

      await createTransaction({
        kind,
        // Uma série é sempre previsão: nenhum mês por vir já foi pago.
        status: fixa ? "PLANNED" : estado,
        ...(fixa ? { repeatMonthly: true, repeatUntil: ate } : {}),
        description: descricao.trim(),
        amountCents: cents,
        occurredAt: data,
        categoryId: categoria || undefined,
        method: metodo || undefined,
        counterparty: contraparte.trim() || undefined,
        teamId: equipa || undefined,
        notes: notas.trim() || undefined,
        ...(eventLink?.matchId ? { matchId: eventLink.matchId } : {}),
        ...(eventLink?.calendarEventId ? { calendarEventId: eventLink.calendarEventId } : {}),
      });
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível registar.");
    } finally {
      setBusy(false);
    }
  }

  /** Apagar o que nunca devia ter sido lançado. Ver a regra 3 no serviço. */
  async function apagar(scope: "one" | "series") {
    if (!editar || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await deleteTransaction(editar.id, scope);
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível apagar.");
      setBusy(false);
      setAApagar(false);
    }
  }

  return (
    <Dialog
      labelledBy="novo-movimento"
      title={editar ? "Editar movimento" : "Novo movimento"}
      subtitle={eventLink ? eventLink.label : editar?.seriesId ? "Um mês de um movimento fixo" : undefined}
      onClose={onClose}
      width={540}
      footer={
        aApagar ? (
          /*
           * A confirmação vive no rodapé, no lugar dos botões — e não num
           * segundo diálogo por cima deste, que rouba o foco e deixa duas
           * camadas de sombra em cima do formulário. Quem chegou aqui já vê o
           * que está prestes a apagar; o que falta é dizer o que desaparece.
           */
          <>
            <span className="mr-auto text-meta text-ink-2">
              {editar?.seriesId
                ? "Apagar este mês, ou também os seguintes?"
                : "Apagar de vez? Não fica no histórico."}
            </span>
            <button type="button" onClick={() => setAApagar(false)} className="ctl-ghost" disabled={busy}>
              Não apagar
            </button>
            {editar?.seriesId && (
              <button type="button" onClick={() => void apagar("series")} className="ctl-risk" disabled={busy}>
                Este e os seguintes
              </button>
            )}
            <button type="button" onClick={() => void apagar("one")} className="ctl-risk" disabled={busy}>
              {editar?.seriesId ? "Só este mês" : busy ? "A apagar…" : "Apagar"}
            </button>
          </>
        ) : (
          <>
            {/*
              O apagar fica longe do Guardar, encostado à esquerda e sem
              preenchimento: é a acção que não se desfaz, e não deve poder ser
              acertada por quem ia carregar no botão do lado.
            */}
            {editar && (
              <button
                type="button"
                onClick={() => setAApagar(true)}
                className="ctl-ghost mr-auto text-ink-3 hover:text-risk"
                disabled={busy}
                title="Apagar — para o que nunca devia ter sido lançado"
              >
                <Trash2 className="size-3.5" strokeWidth={1.75} />
                Apagar
              </button>
            )}
            <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
              Cancelar
            </button>
            <button type="submit" form="form-movimento" className="ctl-primary" disabled={!valido || busy}>
              {editar
                ? busy
                  ? "A guardar…"
                  : "Guardar"
                : busy
                  ? "A registar…"
                  : fixa && meses > 0
                    ? `Registar ${meses} meses`
                    : "Registar"}
            </button>
          </>
        )
      }
    >
      <form id="form-movimento" onSubmit={submeter} className="space-y-4 p-5">
        {/*
          Entra ou sai? É a primeira pergunta, e a que muda o resto do formulário
          — as categorias, os exemplos, o rótulo da contraparte. Duas metades do
          mesmo tamanho, e a escolhida pinta-se com o sinal do dinheiro: verde a
          entrar, vermelho a sair. É a única cor semântica do diálogo, e é a que
          impede alguém de registar uma despesa como receita sem dar por isso.
        */}
        <fieldset>
          <legend className="mb-1.5 text-meta font-medium text-ink">O quê</legend>
          <div className={cx("grid gap-2", editar ? "grid-cols-1" : "grid-cols-2")}>
            {(
              [
                ["EXPENSE", "Despesa", "sai do clube"],
                ["INCOME", "Receita", "entra no clube"],
              ] as const
            ).map(([v, label, hint]) => {
              const activo = kind === v;
              const Icon = v === "INCOME" ? TrendingUp : TrendingDown;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setKind(v);
                    // A categoria é de outro catálogo do outro lado: mantê-la
                    // guardava o id de uma categoria de despesa numa receita.
                    setCategoria("");
                  }}
                  /*
                    Em edição não se troca o tipo: a API recusa-o, e uma despesa
                    que vira receita não é uma correcção — é outro movimento.
                    Fica só o escolhido, sem o outro a convidar ao clique.
                  */
                  disabled={Boolean(editar)}
                  hidden={Boolean(editar) && !activo}
                  aria-pressed={activo}
                  className={cx(
                    "flex items-center gap-2.5 rounded-[var(--radius-control)] border px-3 py-2.5 text-left transition-colors duration-[120ms]",
                    activo
                      ? v === "INCOME"
                        ? "border-ok bg-ok-soft text-ok"
                        : "border-risk bg-risk-soft text-risk"
                      : "border-line text-ink-3 hover:bg-sunken hover:text-ink-2",
                  )}
                >
                  <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                  <span className="min-w-0">
                    <span className="block text-body font-semibold">{label}</span>
                    <span className="block text-meta opacity-80">{hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {/*
          Um cancelado não volta atrás — a API recusa reactivá-lo, e é a regra
          certa: o que se cancelou aconteceu assim. O resto do formulário fica
          aberto, porque arrumar a categoria de uma linha cancelada continua a
          ser arrumação legítima.
        */}
        {cancelado && (
          <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2 text-meta text-ink-3">
            Este movimento está cancelado e fica assim — para o repor, regista um novo. Aqui podes
            corrigir a descrição, a categoria e o resto.
          </p>
        )}

        {/* Já aconteceu, ou está previsto? É o que separa o saldo das previsões. */}
        {!cancelado && (
        <fieldset>
          <legend className="mb-1.5 text-meta font-medium text-ink">Quando</legend>
          <div className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-sunken p-1">
            {(
              [
                ["COMPLETED", receita ? "Já recebida" : "Já paga"],
                ["PLANNED", "Prevista"],
              ] as const
            ).map(([v, l]) => {
              // Numa série, "já paga" não faz sentido: os meses ainda não
              // chegaram. Fica dito em vez de ser um botão que engana.
              const activo = fixa ? v === "PLANNED" : estado === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setEstado(v)}
                  disabled={fixa}
                  aria-pressed={activo}
                  className={cx(
                    "h-8 rounded-[7px] px-3 text-meta font-semibold transition-colors duration-[120ms]",
                    activo ? "bg-ink text-surface" : "text-ink-3 hover:bg-surface/60 hover:text-ink-2",
                    fixa && !activo && "opacity-40",
                  )}
                >
                  {l}
                </button>
              );
            })}
          </div>
          {fixa && <p className="mt-1.5 text-meta text-ink-3">Uma série é sempre previsão — cada mês confirma-se quando acontecer.</p>}
        </fieldset>
        )}

        <div className="grid grid-cols-[1fr_130px] gap-3">
          <DialogField label="Descrição">
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder={receita ? "Patrocínio Café Central" : "Autocarro para o jogo em Braga"}
              className={dialogInputClass}
              autoFocus
            />
          </DialogField>
          <DialogField label="Valor (€)">
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              inputMode="decimal"
              placeholder="450,00"
              className={cx(dialogInputClass, "text-right tabular", valor && cents === null && "border-risk")}
            />
          </DialogField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <DialogField label={fixa ? "Primeiro mês" : estado === "PLANNED" ? "Data prevista" : "Data"}>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={dialogInputClass} />
          </DialogField>
          <DialogField label="Categoria">
            <SelectField
              className="w-full"
              value={categoria}
              onChange={setCategoria}
              options={[{ value: "", label: "Sem categoria" }, ...categorias.map((c) => ({ value: c.id, label: c.label }))]}
            />
          </DialogField>
        </div>

        {/*
          A despesa fixa — a renda do pavilhão, o seguro, o contrato do material.
          Fica ao pé da data porque é a data que ela repete, e não noutro passo:
          é a mesma despesa, dita uma vez em vez de doze.
        */}
        {!eventLink && !editar && (
          <div className="rounded-[var(--radius-control)] border border-line bg-sunken/40 p-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={fixa}
                onChange={(e) => {
                  setFixa(e.target.checked);
                  if (e.target.checked && !ate) setAte(maisUmAno(data));
                }}
                className="size-4 rounded-[4px] border-line accent-[var(--color-ink)]"
              />
              <span className="flex items-center gap-1.5 text-meta font-medium text-ink">
                <Repeat className="size-3.5 text-ink-3" strokeWidth={1.75} />
                {receita ? "Receita fixa mensal" : "Despesa fixa mensal"}
              </span>
            </label>

            {fixa && (
              <div className="mt-3 space-y-2">
                <DialogField label="Repete todos os meses até">
                  <input type="date" value={ate} min={data} onChange={(e) => setAte(e.target.value)} className={dialogInputClass} />
                </DialogField>
                <p className="text-meta text-ink-3">
                  {meses > 0
                    ? `Ficam ${meses} ${meses === 1 ? "mês previsto" : "meses previstos"}, um de cada vez — confirma cada um quando for ${receita ? "recebido" : "pago"}.`
                    : "O fim tem de ser depois do primeiro mês."}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Método" hint="opcional">
            <SelectField
              className="w-full"
              value={metodo}
              onChange={setMetodo}
              options={[
                { value: "", label: "—" },
                ...Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label })),
              ]}
            />
          </DialogField>
          <DialogField label={receita ? "De quem" : "Para quem"} hint="opcional">
            <input
              value={contraparte}
              onChange={(e) => setContraparte(e.target.value)}
              placeholder={receita ? "Câmara Municipal" : "Auto Viação Lda"}
              className={dialogInputClass}
            />
          </DialogField>
        </div>

        {!eventLink && (
          <DialogField label="Equipa" hint="opcional — para os custos por equipa">
            <SelectField
              className="w-full"
              value={equipa}
              onChange={setEquipa}
              options={[{ value: "", label: "Clube inteiro" }, ...equipas.map((t) => ({ value: t.id, label: t.name }))]}
            />
          </DialogField>
        )}

        {/*
          "E os meses seguintes."

          A renda subiu, o seguro mudou de valor — e quem tem trinta e seis
          meses lançados não vai lá corrigir trinta e seis. A data fica sempre
          de fora do alcance alargado (é o servidor que a exclui): mudar a data
          "e seguintes" punha todos os meses no mesmo dia, que nunca é o que se
          quer pedir.
        */}
        {editar?.seriesId && (
          <fieldset className="rounded-[var(--radius-control)] border border-line bg-sunken/40 p-3">
            <legend className="flex items-center gap-1.5 px-1 text-meta font-medium text-ink">
              <Repeat className="size-3.5 text-ink-3" strokeWidth={1.75} />
              Este movimento repete-se
            </legend>
            <div className="mt-1 inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-surface p-1">
              {(
                [
                  ["one", "Só este mês"],
                  ["series", "Este e os seguintes"],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAlcance(v)}
                  aria-pressed={alcance === v}
                  className={cx(
                    "h-8 rounded-[7px] px-3 text-meta font-semibold transition-colors duration-[120ms]",
                    alcance === v ? "bg-ink text-surface" : "text-ink-3 hover:bg-sunken hover:text-ink-2",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
            {alcance === "series" && (
              <p className="mt-2 text-meta text-ink-3">
                A correcção vale para este mês e para os que vêm depois — nunca para os que já
                passaram, e a data continua a ser só deste.
              </p>
            )}
          </fieldset>
        )}

        <DialogField label="Notas" hint="opcional">
          <input value={notas} onChange={(e) => setNotas(e.target.value)} className={dialogInputClass} />
        </DialogField>

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

/** Cêntimos → o que se escreve no campo. O par de `paraCentimos`, ao contrário. */
function paraEuros(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * O dia de uma data ISO, para um `<input type="date">`.
 *
 * Corta a cadeia em vez de passar por `Date`: `toISOString()` converte para UTC
 * e um movimento registado às 23h de Lisboa reabria no dia seguinte.
 */
function diaDe(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * "450", "450,50", "1 234,56" → cêntimos. Nulo quando não é um valor — e o
 * campo fica vermelho em vez de o formulário adivinhar.
 */
function paraCentimos(v: string): number | null {
  const limpo = v.trim().replace(/\s/g, "").replace("€", "").replace(",", ".");
  if (!limpo) return null;
  const n = Number(limpo);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** O fim que se sugere a quem liga a repetição: um ano de contrato. */
function maisUmAno(desde: string): string {
  const d = new Date(desde || hoje());
  if (Number.isNaN(d.getTime())) return "";
  return new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

/**
 * Quantos meses ficam entre as duas datas, inclusive — a mesma conta que o
 * servidor faz, para o formulário poder dizer "ficam 12 meses previstos" antes
 * de gravar. O dia 31 encosta ao fim do mês curto em vez de o saltar: uma renda
 * de dia 31 não deixa de existir em Fevereiro.
 */
function contarMeses(desde: string, ate: string): number {
  const inicio = new Date(desde);
  const fim = new Date(ate);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || fim < inicio) return 0;

  const dia = inicio.getUTCDate();
  let n = 0;
  for (let i = 0; n < 60; i++) {
    const mes = inicio.getUTCMonth() + i;
    const ultimo = new Date(Date.UTC(inicio.getUTCFullYear(), mes + 1, 0)).getUTCDate();
    if (new Date(Date.UTC(inicio.getUTCFullYear(), mes, Math.min(dia, ultimo))) > fim) break;
    n++;
  }
  return n;
}
