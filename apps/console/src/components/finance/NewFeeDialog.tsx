import { useMemo, useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { ChevronLeft, ChevronRight, Receipt, Search, Send, TriangleAlert } from "@/lib/icons";
import { feeHistory, guardiansOf, listAthletes } from "@/lib/api";
import { apiPost } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import { money, periodLabel } from "@/lib/format";
import { useSession } from "@/session";
import type { Athlete } from "@/data/types";
import { Escolhido, ListaDeAtletas, paraCentimos, primeiroNome } from "./ChargeFamilyDialog";
import { CustoDoPagamento } from "./CustoDoPagamento";

/**
 * Lançar mensalidades a um atleta, à mão.
 *
 * ## O que isto resolve
 *
 * A emissão do mês (`Gerar mensalidades`) trabalha sobre o plantel todo e tira
 * o valor do plano — da equipa, ou da inscrição individual. É o dia a dia, e
 * deixa três buracos que só se tapavam com ginástica:
 *
 * - o atleta **sem preço configurado**, que a emissão salta em silêncio e que
 *   obrigava a criar um plano para uma pessoa só;
 * - o **mês fora do calendário** de cobrança do clube, que a emissão ignora de
 *   propósito e que às vezes se cobra a um atleta em concreto;
 * - o **acerto de meses em atraso** de quem entrou a meio da época, que
 *   obrigava a emitir mês a mês para a academia inteira só para apanhar um.
 *
 * Aqui a pergunta é directa: *este atleta, este valor, estes meses*.
 *
 * ## Porquê vários meses de uma vez
 *
 * Porque o caso real nunca é um: é "faltam-lhe Setembro, Outubro e Novembro".
 * Um diálogo por mês seriam três voltas iguais com o mesmo valor escrito três
 * vezes — e é assim que se engana um dos meses.
 *
 * ## Os meses que já têm mensalidade
 *
 * Aparecem riscados e não se podem escolher. É a diferença entre um formulário
 * que recusa no fim e um que não deixa enganar-se: quem está a acertar quatro
 * meses vê logo qual é o que já lá está. O servidor volta a verificá-lo — e
 * salta-os em vez de recusar tudo, porque a intenção de quem escolheu seis
 * meses é ter os seis, não perder os cinco que faltavam.
 */
export function NewFeeDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { session } = useSession();
  const atletas = useMemo(() => listAthletes(session).filter((a) => a.status === "active"), [session]);

  const [atleta, setAtleta] = useState<Athlete | null>(null);
  const [procura, setProcura] = useState("");
  const [valor, setValor] = useState("");
  const [ano, setAno] = useState(new Date().getFullYear());
  const [meses, setMeses] = useState<Set<string>>(new Set());
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ criadas: number; jaExistiam: string[] } | null>(null);

  const cents = paraCentimos(valor);
  const valido = Boolean(atleta) && cents !== null && cents >= 100 && meses.size > 0;
  const encarregados = atleta ? guardiansOf(atleta.id).filter((g) => g.isActive) : [];

  /** Os meses que este atleta já tem — para não se poderem escolher duas vezes. */
  const jaTem = useMemo(() => new Set(atleta ? feeHistory(atleta.id).map((f) => f.period) : []), [atleta]);

  /**
   * Escolher o atleta traz o preço que ele já paga.
   *
   * A mensalidade de quem está a acertar meses em atraso é quase sempre a mesma
   * das outras — escrevê-la de novo é uma oportunidade de a escrever diferente,
   * e duas mensalidades do mesmo atleta com valores distintos no mesmo ano é
   * uma pergunta que a direcção vai ter de responder ao pai.
   */
  function escolher(a: Athlete) {
    setAtleta(a);
    const ultima = feeHistory(a.id)[0];
    if (ultima && !valor) setValor((ultima.amountCents / 100).toFixed(2).replace(".", ","));
  }

  function alternar(period: string) {
    if (jaTem.has(period)) return;
    setMeses((actuais) => {
      const proximos = new Set(actuais);
      if (proximos.has(period)) proximos.delete(period);
      else proximos.add(period);
      return proximos;
    });
  }

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (!valido || !atleta || busy) return;
    setBusy(true);
    setErro(null);
    try {
      const r = await apiPost<{ criadas: number; jaExistiam: string[] }>("/api/charges/mensalidade", {
        athleteId: atleta.id,
        amountCents: cents,
        periods: [...meses].sort(),
        notes: nota.trim() || undefined,
      });
      /*
       * Reler a academia antes de fechar — e **sempre**, não só no caminho feliz.
       *
       * Faltava, e era o bug: as mensalidades vivem no `store` (vêm no arranque,
       * em `/api/charges`), a tabela das Mensalidades lê-as de lá, e sem esta
       * linha o que se acabou de lançar só aparecia depois de um F5. Pior no
       * filtro "todos os períodos": o mês novo nem constava da lista de
       * períodos, porque essa também sai das mensalidades em memória.
       *
       * `await` e não `void`: fecha-se o diálogo com os dados já certos, em vez
       * de fechar para uma tabela que ainda não sabe o que aconteceu. É o que
       * `NewAthleteDialog` e `NewTeamDialog` já faziam — este nasceu sem.
       *
       * Também no caminho parcial: se o servidor criou três dos quatro meses,
       * esses três existem, e a tabela por baixo tem de os mostrar enquanto o
       * aviso explica o quarto.
       */
      await reloadAcademy();

      /*
       * Quando corre tudo bem, fecha-se. Quando o servidor saltou algum mês —
       * alguém lançou o mesmo noutro separador entretanto — mostra-se o que
       * aconteceu em vez de fechar como se nada fosse: o número de linhas
       * criadas não é o que a pessoa pediu, e ela tem de o saber.
       */
      if (r.jaExistiam.length === 0) {
        onDone();
        return;
      }
      setResultado(r);
      setMeses(new Set());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível lançar as mensalidades.");
    } finally {
      setBusy(false);
    }
  }

  const total = cents !== null ? cents * meses.size : null;

  return (
    <Dialog
      labelledBy="lancar-mensalidade"
      title="Lançar mensalidade"
      subtitle="Para um atleta, nos meses que escolheres."
      icon={<Receipt className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={560}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-meta text-ink-3">
            {atleta && total !== null && meses.size > 0
              ? `${money(total)} — ${meses.size} ${meses.size === 1 ? "mês" : "meses"} de ${primeiroNome(atleta.name)}`
              : "A família é avisada na app."}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
              {resultado ? "Fechar" : "Cancelar"}
            </button>
            <button type="submit" form="form-mensalidade" className="ctl-primary" disabled={!valido || busy}>
              <Send className="size-3.5" strokeWidth={1.75} />
              {busy ? "A lançar…" : meses.size > 1 ? `Lançar ${meses.size} meses` : "Lançar"}
            </button>
          </div>
        </div>
      }
    >
      <form id="form-mensalidade" onSubmit={submeter} className="space-y-4 p-5">
        {atleta ? <Escolhido atleta={atleta} encarregados={encarregados} onTrocar={() => setAtleta(null)} /> : null}

        {!atleta && (
          <fieldset>
            <legend className="mb-1.5 text-meta font-medium text-ink">A quem</legend>
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
              <input
                autoFocus
                value={procura}
                onChange={(e) => setProcura(e.target.value)}
                placeholder="Procurar atleta…"
                className={cx(dialogInputClass, "pl-8")}
              />
            </div>
            <ListaDeAtletas atletas={atletas} procura={procura} onEscolher={escolher} />
          </fieldset>
        )}

        {/* O resto só depois de haver atleta — ver a nota em `ChargeFamilyDialog`. */}
        {atleta && (
          <>
            {resultado && (
              <p className="rounded-[var(--radius-control)] bg-warn-soft px-3 py-2 text-meta text-warn">
                {resultado.criadas > 0 ? `Lançadas ${resultado.criadas}. ` : "Não foi lançada nenhuma. "}
                {resultado.jaExistiam.length === 1
                  ? `${periodLabel(resultado.jaExistiam[0])} já tinha mensalidade.`
                  : `${resultado.jaExistiam.map(periodLabel).join(", ")} já tinham mensalidade.`}
              </p>
            )}

            <DialogField label="Valor de cada mês (€)">
              <input
                autoFocus
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                inputMode="decimal"
                placeholder="35,00"
                className={cx(
                  dialogInputClass,
                  "text-right tabular",
                  valor && (cents === null || cents < 100) && "border-risk",
                )}
              />
              <CustoDoPagamento amountCents={cents} />
            </DialogField>

            <fieldset>
              <legend className="mb-1.5 flex w-full items-center justify-between gap-2 text-meta font-medium text-ink">
                <span>Meses</span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setAno((a) => a - 1)}
                    className="flex size-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-sunken hover:text-ink"
                    aria-label="Ano anterior"
                  >
                    <ChevronLeft className="size-3.5" strokeWidth={2} />
                  </button>
                  <span className="w-10 text-center tabular text-ink-2">{ano}</span>
                  <button
                    type="button"
                    onClick={() => setAno((a) => a + 1)}
                    className="flex size-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-sunken hover:text-ink"
                    aria-label="Ano seguinte"
                  >
                    <ChevronRight className="size-3.5" strokeWidth={2} />
                  </button>
                </span>
              </legend>

              {/*
                Uma época atravessa dois anos civis — as setas existem para isso,
                e não para navegar uma agenda: quem acerta Setembro a Junho passa
                de ano uma vez e escolhe os meses dos dois lados sem perder nada,
                porque a escolha vive fora da grelha.
              */}
              <div className="grid grid-cols-4 gap-1.5">
                {MESES.map((nome, i) => {
                  const period = `${ano}-${String(i + 1).padStart(2, "0")}`;
                  const tem = jaTem.has(period);
                  const on = meses.has(period);
                  return (
                    <button
                      key={period}
                      type="button"
                      onClick={() => alternar(period)}
                      disabled={tem}
                      aria-pressed={on}
                      title={tem ? "Este mês já tem mensalidade" : undefined}
                      className={cx(
                        "h-9 rounded-[var(--radius-control)] border text-meta font-semibold transition-colors duration-[120ms]",
                        tem
                          ? "cursor-not-allowed border-line bg-sunken text-ink-4 line-through"
                          : on
                            ? "border-ink bg-ink text-surface"
                            : "border-line text-ink-2 hover:border-line-strong hover:bg-sunken",
                      )}
                    >
                      {nome}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-meta text-ink-3">
                Riscado é mês que já tem mensalidade. O vencimento é o dia do clube, como nas
                automáticas — um mês em atraso nasce vencido, que é o que ele é.
              </p>
            </fieldset>

            <DialogField label="Nota para a família" hint="opcional — fica na mensalidade">
              <input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                maxLength={500}
                placeholder="Acerto dos meses em falta"
                className={dialogInputClass}
              />
            </DialogField>

            {erro && (
              <p className="flex items-start gap-1.5 text-meta text-risk">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
                {erro}
              </p>
            )}
          </>
        )}
      </form>
    </Dialog>
  );
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
