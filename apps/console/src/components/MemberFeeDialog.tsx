import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { Receipt, Send, TriangleAlert, X } from "@/lib/icons";
import { money } from "@/lib/format";
import { MESES, createMemberFees, memberFeePeriods, type MemberFeePeriods } from "@/lib/members";

/**
 * Lançar quotas a um sócio, à mão.
 *
 * ## O que isto resolve
 *
 * "Gerar quotas", na lista, trabalha sobre o livro todo e tira o valor da
 * categoria. É o dia a dia, e deixa três buracos que só se tapavam com
 * ginástica:
 *
 * - o sócio **sem categoria com preço**, que a geração salta em silêncio;
 * - o **acerto de atrasos** de quem entrou a meio do ano e deve três meses,
 *   que obrigava a gerar para a academia inteira só para apanhar um;
 * - o **valor diferente do da categoria** — a quota reduzida acordada com
 *   aquele sócio —, que não tinha onde ser escrito.
 *
 * A pergunta aqui é directa: *este sócio, este valor, estes meses*.
 *
 * ## De X a Y, e não mês a mês
 *
 * O acerto real é um intervalo — *"deve de Setembro a Março"* — e não uma
 * colecção de escolhas soltas. Duas versões deste ecrã falharam nisto: a
 * primeira oferecia "os doze meses mais recentes" (um tecto disfarçado: em
 * Setembro de 2026 não se chegava a 2024); a segunda pedia um clique por mês
 * numa grelha de um ano de cada vez, o que são sete cliques e duas mudanças
 * de ano para o caso mais banal.
 *
 * Agora escolhe-se **de** e **até**, e o intervalo produz-se sozinho. As
 * pastilhas por baixo mostram o resultado, e uma delas pode sair — o intervalo
 * é o gesto rápido, não uma camisa-de-forças.
 *
 * ## A unidade é o mês
 *
 * As quotas são mensais e só mensais (ver `member-fees.service.ts` e a
 * migração `quotas_mensais`). Já houve categorias anuais e trimestrais, e o
 * selector mudava de unidade com elas — para cinco das sete categorias do
 * Life Club "só deixava escolher o ano". O período é `AAAA-MM`, ponto.
 *
 * ## Os que já têm quota
 *
 * Ficam de fora do intervalo, com nota a dizer quantos foram saltados — é a
 * diferença entre um formulário que recusa no fim e um que não deixa
 * enganar-se. O servidor volta a verificá-lo, e salta-os pela mesma razão.
 */
export function MemberFeeDialog({
  memberId,
  memberName,
  onClose,
  onDone,
}: {
  memberId: string;
  memberName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const hoje = new Date();
  const [dados, setDados] = useState<MemberFeePeriods | null>(null);
  const [valor, setValor] = useState("");
  /* O intervalo. Começa no mês corrente dos dois lados — um só mês é o caso
     mais frequente, e alargar dali é um gesto, não um preenchimento. */
  const [de, setDe] = useState({ mes: hoje.getMonth() + 1, ano: hoje.getFullYear() });
  const [ate, setAte] = useState({ mes: hoje.getMonth() + 1, ano: hoje.getFullYear() });
  /* Os que o utilizador tirou do intervalo à mão. */
  const [retirados, setRetirados] = useState<Set<string>>(new Set());
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    memberFeePeriods(memberId)
      .then((d) => {
        setDados(d);
        // O valor da categoria entra escrito, para o caso comum ser confirmar.
        if (d.defaultAmountCents != null) setValor((d.defaultAmountCents / 100).toFixed(2).replace(".", ","));
      })
      .catch((e: Error) => setErro(e.message));
  }, [memberId]);

  const jaTem = useMemo(() => new Set(dados?.taken ?? []), [dados]);

  /* O intervalo inteiro, antes de tirar seja o que for. */
  const intervalo = useMemo(() => mesesNoIntervalo(de, ate), [de, ate]);
  const invertido = intervalo === null;
  const doIntervalo = intervalo ?? [];
  /* O que sobra: sem os que já têm quota, sem os que se tiraram. */
  const escolhidos = useMemo(
    () => doIntervalo.filter((p) => !jaTem.has(p) && !retirados.has(p)),
    [doIntervalo, jaTem, retirados],
  );
  const saltados = doIntervalo.filter((p) => jaTem.has(p)).length;

  const cents = paraCentimos(valor);
  const total = cents == null ? 0 : cents * escolhidos.length;
  const demais = escolhidos.length > 36;
  const podeGravar = cents != null && escolhidos.length > 0 && !demais && !busy;

  const retirar = (period: string) =>
    setRetirados((antes) => {
      const novo = new Set(antes);
      novo.add(period);
      return novo;
    });

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (!podeGravar || cents == null) return;
    setBusy(true);
    setErro(null);
    try {
      await createMemberFees(memberId, {
        periods: escolhidos,
        amountCents: cents,
        ...(nota.trim() ? { notes: nota.trim() } : {}),
      });
      onDone();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível lançar.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="lancar-quota"
      title="Lançar quotas"
      subtitle={memberName}
      icon={<Receipt className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={560}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-meta text-ink-3">
            {escolhidos.length > 0 && cents != null ? (
              <span className="tabular">
                {money(total)} — {escolhidos.length} {escolhidos.length === 1 ? "mês" : "meses"}
              </span>
            ) : (
              "Ficam por pagar."
            )}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
              Cancelar
            </button>
            <button type="submit" form="form-quota" className="ctl-primary" disabled={!podeGravar}>
              <Send className="size-3.5" strokeWidth={1.75} />
              {busy ? "A lançar…" : escolhidos.length > 1 ? `Lançar ${escolhidos.length}` : "Lançar"}
            </button>
          </div>
        </div>
      }
    >
      {/* `p-5`: o `Dialog` não dá folga nenhuma ao conteúdo — é de cada corpo,
          como no diálogo das mensalidades. Sem isto os campos encostam-se às
          paredes e uns aos outros. */}
      <form id="form-quota" onSubmit={submeter} className="space-y-4 p-5">
        {erro && (
          <p className="flex items-start gap-1.5 text-meta leading-relaxed text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </p>
        )}

        {dados === null ? (
          <p className="text-meta text-ink-3">A carregar…</p>
        ) : (
          <>
            <DialogField
              label="Valor de cada mês (€)"
              hint={
                dados.defaultAmountCents != null
                  ? "vem da categoria"
                  : "a categoria não tem preço — escreve o valor"
              }
            >
              <input
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="0,00"
                className={cx(dialogInputClass, "tabular", cents == null && valor.trim() !== "" && "border-risk")}
              />
            </DialogField>

            <fieldset>
              <legend className="mb-1.5 text-meta font-medium text-ink">
                Meses
                <span className="ml-2 font-normal text-ink-4">de … até, inclusive</span>
              </legend>

              <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                <ExtremoDoIntervalo
                  rotulo="De"
                  valor={de}
                  onChange={(v) => {
                    setDe(v);
                    setRetirados(new Set());
                  }}
                />
                <ExtremoDoIntervalo
                  rotulo="Até"
                  valor={ate}
                  onChange={(v) => {
                    setAte(v);
                    setRetirados(new Set());
                  }}
                />
              </div>

              {invertido ? (
                <p className="mt-1.5 text-meta text-risk">O fim do intervalo é anterior ao início.</p>
              ) : (
                <p className="mt-1.5 text-meta leading-relaxed text-ink-3">
                  {saltados > 0
                    ? `${saltados} ${saltados === 1 ? "mês do intervalo já tem quota e fica de fora" : "meses do intervalo já têm quota e ficam de fora"}.`
                    : "Todo o intervalo está por lançar."}
                </p>
              )}
            </fieldset>

            {/*
              O resultado, pastilha a pastilha.

              O intervalo é o gesto rápido; isto é o que ele produziu, e cada
              pastilha pode sair. Sem esta lista, "de Setembro a Março" seria um
              salto de fé — e quem lança dinheiro não salta.
            */}
            {escolhidos.length > 0 && (
              <div>
                <p className="mb-1.5 text-meta font-medium text-ink">
                  A lançar
                  <span className="ml-2 font-normal text-ink-4">
                    {escolhidos.length} {escolhidos.length === 1 ? "quota" : "quotas"} · carrega numa para a tirar
                  </span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {escolhidos.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => retirar(p)}
                      title="Tirar do lançamento"
                      className="group flex items-center gap-1 rounded-[var(--radius-control)] border border-ink bg-ink px-2 py-1 text-meta font-semibold text-surface"
                    >
                      {etiqueta(p)}
                      <X className="size-3 opacity-50 group-hover:opacity-100" strokeWidth={2.5} />
                    </button>
                  ))}
                </div>
                {demais && (
                  <p className="mt-1.5 text-meta text-risk">
                    São {escolhidos.length} — o máximo de cada vez são 36. Encurta o intervalo.
                  </p>
                )}
              </div>
            )}

            <DialogField label="Nota" hint="opcional — fica na quota">
              <input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                maxLength={500}
                placeholder="Acerto de entrada a meio do ano"
                className={dialogInputClass}
              />
            </DialogField>

            {/*
              Uma quota lançada não é uma quota paga.

              Quem acaba de acertar três meses em atraso está a criar dívida, não
              a recebê-la — e o gesto seguinte (marcar como paga) é outro, na
              lista. Dizê-lo aqui evita a leitura contrária.
            */}
            <p className="text-meta leading-relaxed text-ink-3">
              Ficam <strong className="text-ink-2">por pagar</strong>. Marcar como recebida é o passo seguinte,
              na lista de quotas.
            </p>
          </>
        )}
      </form>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** Um extremo do intervalo. `mes` é 1–12. */
type Extremo = { mes: number; ano: number };

/**
 * Um extremo do intervalo — "De" ou "Até": mês e ano.
 *
 * Os anos vão de daqui a um ano até dez atrás. Dez chega para qualquer acerto
 * que um clube faça na prática, e uma lista maior torna a escolha do ano certo
 * mais lenta do que o problema que resolve.
 */
function ExtremoDoIntervalo({
  rotulo,
  valor,
  onChange,
}: {
  rotulo: string;
  valor: Extremo;
  onChange: (v: Extremo) => void;
}) {
  const atual = new Date().getFullYear();
  const anos = Array.from({ length: 12 }, (_, i) => atual + 1 - i);
  const selectClass = cx(dialogInputClass, "w-auto pr-1.5");

  return (
    <label className="flex items-end gap-1.5">
      <span className="pb-2 text-meta text-ink-3">{rotulo}</span>
      <select
        aria-label={`${rotulo} — mês`}
        value={valor.mes}
        onChange={(e) => onChange({ ...valor, mes: Number(e.target.value) })}
        className={selectClass}
      >
        {MESES.map((nome, i) => (
          <option key={nome} value={i + 1}>
            {nome}
          </option>
        ))}
      </select>
      <select
        aria-label={`${rotulo} — ano`}
        value={valor.ano}
        onChange={(e) => onChange({ ...valor, ano: Number(e.target.value) })}
        className={cx(selectClass, "tabular")}
      >
        {anos.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Os meses entre dois extremos, inclusive — `AAAA-MM`, o formato que o
 * servidor escreve e que o unique `(memberId, period)` protege.
 *
 * `null` quando o fim é anterior ao início: é um engano de quem escolheu, e
 * devolver a lista vazia deixava o ecrã calado sobre a razão de não haver nada.
 */
function mesesNoIntervalo(de: Extremo, ate: Extremo): string[] | null {
  const inicio = de.ano * 12 + (de.mes - 1);
  const fim = ate.ano * 12 + (ate.mes - 1);
  if (fim < inicio) return null;

  const meses: string[] = [];
  for (let n = inicio; n <= fim; n++) {
    meses.push(`${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`);
  }
  return meses;
}

/** "Set 25" — curto, para caber numa pastilha. */
function etiqueta(period: string): string {
  const [ano, mes] = period.split("-");
  return `${MESES_CURTOS[Number(mes) - 1] ?? mes} ${ano.slice(2)}`;
}

/**
 * "12,50" ou "12.50" → 1250. `null` quando não é um valor legível.
 *
 * Gémeo do `paraCentimos` das mensalidades (`ChargeFamilyDialog`), e não uma
 * importação dele: aquele vive no módulo financeiro dos atletas, e arrastar
 * meia dúzia de dependências de lá para os sócios por causa de quatro linhas
 * era juntar duas áreas que não se conhecem.
 */
function paraCentimos(texto: string): number | null {
  const limpo = texto.trim().replace(",", ".");
  if (limpo === "") return null;
  const n = Number(limpo);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
