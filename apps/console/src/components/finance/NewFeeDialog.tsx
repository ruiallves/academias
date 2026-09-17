import { useMemo, useRef, useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { Segmented } from "@/components/filters";
import { Monogram, cx } from "@/components/primitives";
import { Check, ChevronLeft, ChevronRight, Receipt, Search, Send, TriangleAlert, X } from "@/lib/icons";
import { feeHistory, listAthletes, listTeams, teamById } from "@/lib/api";
import { apiPost } from "@/lib/http";
import { reloadFees } from "@/lib/store";
import { money, periodLabel } from "@/lib/format";
import { mesCobrado } from "@/lib/api";
import { useSession } from "@/session";
import type { Athlete } from "@/data/types";
import { paraCentimos } from "./ChargeFamilyDialog";
import { CustoDoPagamento } from "./CustoDoPagamento";
import { EscolherMetodo, type MetodoManual } from "./MetodoDePagamento";

type Alvo = "atletas" | "equipas" | "todos";
type ModoValor = "preco" | "fixo";
type Estado = "OPEN" | "SETTLED";

type Resultado = {
  criadas: number;
  /** Já existiam por pagar e passaram a pagas. Só ao lançar como pagas. */
  marcadas: number;
  atletas: number;
  jaExistiam: string[];
  /** Meses em que alguém já tinha a mensalidade paga. */
  jaPagas: string[];
  /** Por pagar com um pagamento online a decorrer: não se mexeu. */
  emPagamento: number;
  semPreco: { id: string; name: string }[];
  avisados: number;
};

/**
 * Lançar mensalidades à mão: a atletas, a equipas, ou ao clube todo.
 *
 * ## O que isto resolve
 *
 * A emissão automática trata do mês corrente, ao plantel todo, e tira o valor
 * do plano. Não trata de:
 *
 * - um **mês que já passou** e que o clube decidiu cobrar depois (ligar Agosto
 *   a meio de Setembro não emite Agosto, e é de propósito: emitir meses
 *   passados é uma decisão, não um efeito de mexer no calendário);
 * - o atleta **sem preço configurado**;
 * - o acerto de **meses em atraso** de quem entrou a meio da época.
 *
 * ## A quem
 *
 * Era só um atleta de cada vez. Emitir Agosto a um clube de cento e cinquenta
 * atletas eram cento e cinquenta diálogos. Agora escolhe-se: atletas um a um,
 * equipas inteiras, ou todos. Por equipa e "todos" só entram os atletas
 * activos, como na emissão do mês.
 *
 * ## Quanto
 *
 * Por omissão, cada atleta paga o preço dele (a inscrição individual, ou o
 * preço da equipa). Um valor fixo serve o atleta sem preço, ou um acerto em que
 * o valor é outro. Quem não tiver preço fica de fora, e o fim diz quem foi.
 *
 * ## Os meses que já têm mensalidade
 *
 * Com um atleta só, aparecem riscados e não se escolhem. Com vários, o servidor
 * salta-os atleta a atleta e diz em que meses isso aconteceu: a intenção de
 * quem emite Agosto a uma equipa é que todos fiquem com Agosto, não recusar a
 * equipa inteira por causa de um que já o tinha.
 */
export function NewFeeDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { session } = useSession();
  const activos = useMemo(() => listAthletes(session).filter((a) => a.status === "active"), [session]);
  const equipas = useMemo(() => listTeams(session), [session]);

  const [alvo, setAlvo] = useState<Alvo>("atletas");
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [equipasEscolhidas, setEquipasEscolhidas] = useState<Set<string>>(new Set());
  const [procura, setProcura] = useState("");
  const [modo, setModo] = useState<ModoValor>("preco");
  const [estado, setEstado] = useState<Estado>("OPEN");
  const [metodo, setMetodo] = useState<MetodoManual | null>(null);
  const [valor, setValor] = useState("");
  const [ano, setAno] = useState(new Date().getFullYear());
  const [meses, setMeses] = useState<Set<string>>(new Set());
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  /* Os atletas que o pedido vai abranger, pelo que a consola já sabe. */
  const abrangidos: Athlete[] = useMemo(() => {
    if (alvo === "atletas") return activos.filter((a) => escolhidos.has(a.id));
    if (alvo === "equipas") return activos.filter((a) => equipasEscolhidas.has(a.teamId));
    return activos;
  }, [alvo, activos, escolhidos, equipasEscolhidas]);

  const umSo = alvo === "atletas" && abrangidos.length === 1 ? abrangidos[0] : null;
  const jaTem = useMemo(() => new Set(umSo ? feeHistory(umSo.id).map((f) => f.period) : []), [umSo]);

  const cents = modo === "fixo" ? paraCentimos(valor) : null;
  const valorValido = modo === "preco" || (cents !== null && cents >= 100);
  // Lançadas como pagas, tem de se dizer como: não há método por omissão.
  const valido = abrangidos.length > 0 && meses.size > 0 && valorValido && (estado === "OPEN" || metodo !== null);

  function mudarAlvo(novo: Alvo) {
    setAlvo(novo);
    setResultado(null);
    setErro(null);
  }

  function alternarAtleta(a: Athlete) {
    setEscolhidos((actuais) => {
      const proximos = new Set(actuais);
      if (proximos.has(a.id)) proximos.delete(a.id);
      else proximos.add(a.id);
      return proximos;
    });
  }

  function alternarEquipa(id: string) {
    setEquipasEscolhidas((actuais) => {
      const proximas = new Set(actuais);
      if (proximas.has(id)) proximas.delete(id);
      else proximas.add(id);
      return proximas;
    });
  }

  /**
   * Passar a valor fixo com um atleta só traz o preço que ele já paga.
   *
   * Quem acerta meses em atraso quase sempre cobra o mesmo das outras
   * mensalidades, e escrevê-lo de novo é uma oportunidade de o escrever mal.
   */
  function mudarModo(novo: ModoValor) {
    setModo(novo);
    if (novo === "fixo" && umSo && !valor) {
      const ultima = feeHistory(umSo.id)[0];
      if (ultima) setValor((ultima.amountCents / 100).toFixed(2).replace(".", ","));
    }
  }

  function alternarMes(period: string) {
    // Em "Pagas" um mês que já existe escolhe-se: é para o marcar como pago.
    if ((estado === "OPEN" && jaTem.has(period)) || !mesCobrado(period)) return;
    setMeses((actuais) => {
      const proximos = new Set(actuais);
      if (proximos.has(period)) proximos.delete(period);
      else proximos.add(period);
      return proximos;
    });
  }

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      const r = await apiPost<Resultado>("/api/charges/mensalidade", {
        alvo,
        ...(alvo === "atletas" ? { athleteIds: [...escolhidos] } : {}),
        ...(alvo === "equipas" ? { teamIds: [...equipasEscolhidas] } : {}),
        ...(modo === "fixo" && cents !== null ? { amountCents: cents } : {}),
        estado,
        ...(estado === "SETTLED" && metodo ? { metodo } : {}),
        periods: [...meses].sort(),
        notes: nota.trim() || undefined,
      });
      /*
       * Reler a academia antes de fechar, e **sempre**, não só no caminho feliz:
       * as mensalidades vivem no `store`, e sem isto o que se acabou de lançar
       * só aparecia na tabela depois de um F5.
       */
      await reloadFees();

      /* Correu tudo como pedido: fecha. Senão, diz-se o que ficou de fora. */
      const ficouAlgoDeFora =
        r.jaExistiam.length > 0 || r.jaPagas.length > 0 || r.emPagamento > 0 || r.semPreco.length > 0;
      if (!ficouAlgoDeFora && r.criadas + r.marcadas > 0) {
        onDone();
        return;
      }
      setResultado(r);
      setMeses(new Set());
      mostrarAvisoEmBaixo();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível lançar as mensalidades.");
      mostrarAvisoEmBaixo();
    } finally {
      setBusy(false);
    }
  }

  /*
   * O resultado e os erros vivem no fundo do formulário, ao pé do botão que se
   * carregou. Em cima ficavam fora de vista: o formulário é comprido, e quem
   * carrega em Lançar está a olhar para baixo. Depois de aparecerem, rola-se
   * até eles, para não depender de onde estava a barra.
   */
  const avisoRef = useRef<HTMLDivElement>(null);
  function mostrarAvisoEmBaixo() {
    requestAnimationFrame(() => avisoRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
  }

  const n = abrangidos.length;
  const m = meses.size;
  const resumo =
    n > 0 && m > 0
      ? `${n} ${n === 1 ? "atleta" : "atletas"}, ${m} ${m === 1 ? "mês" : "meses"}` +
        (cents !== null && modo === "fixo" ? `: ${money(cents * n * m)}` : "")
      : estado === "OPEN"
        ? "A família é avisada na app."
        : "Ficam registadas como pagas. A família não é avisada.";

  return (
    <Dialog
      labelledBy="lancar-mensalidade"
      title="Lançar mensalidade"
      subtitle="A atletas, equipas ou ao clube todo, nos meses que escolheres."
      icon={<Receipt className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={580}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-meta text-ink-3">{resumo}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
              {resultado ? "Fechar" : "Cancelar"}
            </button>
            <button type="submit" form="form-mensalidade" className="ctl-primary" disabled={!valido || busy}>
              <Send className="size-3.5" strokeWidth={1.75} />
              {busy ? "A lançar…" : "Lançar"}
            </button>
          </div>
        </div>
      }
    >
      <form id="form-mensalidade" onSubmit={submeter} className="space-y-4 p-5">

        <fieldset>
          <legend className="mb-1.5 text-meta font-medium text-ink">A quem</legend>
          <Segmented<Alvo>
            value={alvo}
            onChange={mudarAlvo}
            label="A quem"
            options={[
              { value: "atletas", label: "Atletas" },
              { value: "equipas", label: "Equipas" },
              { value: "todos", label: "Todos", count: activos.length },
            ]}
          />

          <div className="mt-2.5">
            {alvo === "atletas" && (
              <EscolherAtletas
                atletas={activos}
                escolhidos={escolhidos}
                procura={procura}
                onProcura={setProcura}
                onAlternar={alternarAtleta}
                onLimpar={() => setEscolhidos(new Set())}
              />
            )}
            {alvo === "equipas" && (
              <ul className="max-h-[220px] overflow-y-auto rounded-[var(--radius-control)] border border-line">
                {equipas.length === 0 && <li className="px-3 py-2.5 text-meta text-ink-3">Não há equipas.</li>}
                {equipas.map((t) => {
                  const on = equipasEscolhidas.has(t.id);
                  const quantos = activos.filter((a) => a.teamId === t.id).length;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => alternarEquipa(t.id)}
                        aria-pressed={on}
                        className="flex w-full items-center gap-2.5 border-b border-line px-3 py-2 text-left transition-colors duration-[120ms] last:border-b-0 hover:bg-sunken"
                      >
                        <Caixa on={on} />
                        <span className="min-w-0 flex-1 truncate text-body text-ink">{t.name}</span>
                        <span className="text-meta text-ink-3 tabular">
                          {quantos} {quantos === 1 ? "atleta" : "atletas"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {alvo === "todos" && (
              <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta text-ink-2">
                Todos os atletas activos do clube ({activos.length}).
              </p>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-meta font-medium text-ink">Valor</legend>
          <Segmented<ModoValor>
            value={modo}
            onChange={mudarModo}
            label="Valor"
            options={[
              { value: "preco", label: "Preço de cada atleta" },
              { value: "fixo", label: "Valor fixo" },
            ]}
          />
          {modo === "preco" ? (
            <p className="mt-1.5 text-meta leading-relaxed text-ink-3">
              Cada atleta paga o preço que tem definido, individual ou da equipa. Quem não tiver preço fica de fora.
            </p>
          ) : (
            <DialogField label="Valor de cada mês (€)" className="mt-2.5">
              <input
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                inputMode="decimal"
                placeholder="35,00"
                className={cx(dialogInputClass, "text-right tabular", valor && !valorValido && "border-risk")}
              />
              {estado === "OPEN" && <CustoDoPagamento amountCents={cents} />}
            </DialogField>
          )}
        </fieldset>

        {/*
          Pagas é para registar o que já foi pago por fora da plataforma: em
          dinheiro, por transferência, antes de o clube usar a app. Nascem com o
          mesmo registo de "Marcar como paga", e a família não recebe aviso,
          porque não há nada que lhe pedir.
        */}
        <fieldset>
          <legend className="mb-1.5 text-meta font-medium text-ink">Estado</legend>
          <Segmented<Estado>
            value={estado}
            onChange={(novo) => {
              setEstado(novo);
              // De volta a "Por pagar", os meses que o atleta já tem deixam de se poder escolher.
              if (novo === "OPEN") setMeses((actuais) => new Set([...actuais].filter((p) => !jaTem.has(p))));
            }}
            label="Estado"
            options={[
              { value: "OPEN", label: "Por pagar" },
              { value: "SETTLED", label: "Pagas" },
            ]}
          />
          <p className="mt-1.5 text-meta leading-relaxed text-ink-3">
            {estado === "OPEN"
              ? "A família é avisada na app e pode pagar por lá."
              : "Ficam registadas como pagas, com a data de hoje. A família não recebe aviso."}
          </p>
          {estado === "SETTLED" && (
            <div className="mt-2.5">
              <p className="mb-1.5 text-meta font-medium text-ink">Como foram pagas</p>
              <EscolherMetodo value={metodo} onChange={setMetodo} />
            </div>
          )}
        </fieldset>

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
            Uma época atravessa dois anos civis. A escolha vive fora da grelha,
            por isso passar de ano não perde os meses já escolhidos.
          */}
          <div className="grid grid-cols-4 gap-1.5">
            {MESES.map((nome, i) => {
              const period = `${ano}-${String(i + 1).padStart(2, "0")}`;
              const tem = estado === "OPEN" && jaTem.has(period);
              const fechado = !mesCobrado(period);
              const on = meses.has(period);
              return (
                <button
                  key={period}
                  type="button"
                  onClick={() => alternarMes(period)}
                  disabled={tem || fechado}
                  aria-pressed={on}
                  title={
                    fechado
                      ? "O clube não cobra neste mês. Liga-o no Período de cobrança"
                      : tem
                        ? "Este mês já tem mensalidade"
                        : undefined
                  }
                  className={cx(
                    "h-9 rounded-[var(--radius-control)] border text-meta font-semibold transition-colors duration-[120ms]",
                    fechado
                      ? "cursor-not-allowed border-dashed border-line bg-transparent text-ink-4"
                      : tem
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
          <p className="mt-1.5 text-meta leading-relaxed text-ink-3">
            {estado === "SETTLED"
              ? "Um mês que já tenha mensalidade por pagar fica marcado como pago. A tracejado é mês em que o clube não cobra."
              : umSo
                ? "Riscado é mês que este atleta já tem. A tracejado é mês em que o clube não cobra."
                : "Quem já tiver mensalidade num mês fica de fora nesse mês. A tracejado é mês em que o clube não cobra."}{" "}
            {estado === "OPEN" && "Vence no dia de cobrança do clube, e um mês que já passou nasce vencido."}
          </p>
        </fieldset>

        <DialogField label="Nota para a família" hint="opcional, fica na mensalidade">
          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={500}
            placeholder="Mensalidade de Agosto"
            className={dialogInputClass}
          />
        </DialogField>

        <div ref={avisoRef} className="space-y-2">
          {resultado && <ResultadoDoLancamento r={resultado} />}
          {erro && (
            <p className="flex items-start gap-1.5 rounded-[var(--radius-control)] bg-risk-soft px-3 py-2.5 text-meta text-risk">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
              {erro}
            </p>
          )}
        </div>
      </form>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

/** Atletas escolhidos um a um: os escolhidos ficam à vista, e a lista procura os outros. */
function EscolherAtletas({
  atletas,
  escolhidos,
  procura,
  onProcura,
  onAlternar,
  onLimpar,
}: {
  atletas: Athlete[];
  escolhidos: Set<string>;
  procura: string;
  onProcura: (v: string) => void;
  onAlternar: (a: Athlete) => void;
  onLimpar: () => void;
}) {
  const q = procura.trim().toLocaleLowerCase("pt");
  const encontrados = q ? atletas.filter((a) => a.name.toLocaleLowerCase("pt").includes(q)) : atletas.slice(0, 8);
  const escolhidosLista = atletas.filter((a) => escolhidos.has(a.id));

  return (
    <div className="space-y-2">
      {escolhidosLista.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {escolhidosLista.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onAlternar(a)}
              className="inline-flex items-center gap-1 rounded-full bg-sunken py-0.5 pr-1.5 pl-2.5 text-meta text-ink-2 hover:bg-line"
              title="Tirar"
            >
              {a.name}
              <X className="size-3" strokeWidth={2} />
            </button>
          ))}
          {escolhidosLista.length > 1 && (
            <button type="button" onClick={onLimpar} className="text-meta text-ink-3 underline underline-offset-2">
              Limpar
            </button>
          )}
        </div>
      )}

      <div className="relative">
        <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
        <input
          value={procura}
          onChange={(e) => onProcura(e.target.value)}
          placeholder="Procurar atleta…"
          className={cx(dialogInputClass, "pl-8")}
        />
      </div>

      {encontrados.length === 0 ? (
        <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta text-ink-3">
          Nenhum atleta com esse nome.
        </p>
      ) : (
        <ul className="max-h-[220px] overflow-y-auto rounded-[var(--radius-control)] border border-line">
          {encontrados.map((a) => {
            const on = escolhidos.has(a.id);
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onAlternar(a)}
                  aria-pressed={on}
                  className="flex w-full items-center gap-2.5 border-b border-line px-3 py-2 text-left transition-colors duration-[120ms] last:border-b-0 hover:bg-sunken"
                >
                  <Caixa on={on} />
                  <Monogram name={a.name} photoUrl={a.photoUrl} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-ink">{a.name}</span>
                    <span className="block truncate text-meta text-ink-3">{teamById(a.teamId)?.name ?? "Sem equipa"}</span>
                  </span>
                </button>
              </li>
            );
          })}
          {!q && atletas.length > encontrados.length && (
            <li className="border-t border-line px-3 py-2 text-meta text-ink-4">
              Escreve para encontrar os outros {atletas.length - encontrados.length}.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** A caixa de escolha, desenhada: a nativa não segue a cor do clube nem o tamanho da linha. */
function Caixa({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
        on ? "border-ink bg-ink text-surface" : "border-line-strong bg-surface",
      )}
    >
      {on && <Check className="size-3" strokeWidth={2.5} />}
    </span>
  );
}

/** O que foi lançado, e o que ficou de fora e porquê. */
function ResultadoDoLancamento({ r }: { r: Resultado }) {
  const nomes = r.semPreco.slice(0, 5).map((a) => a.name);
  const resto = r.semPreco.length - nomes.length;
  const feito: string[] = [];
  if (r.criadas > 0) feito.push(`Lançadas ${r.criadas} ${r.criadas === 1 ? "mensalidade" : "mensalidades"}.`);
  if (r.marcadas > 0) {
    feito.push(`${r.marcadas} que já existiam ${r.marcadas === 1 ? "ficou marcada como paga" : "ficaram marcadas como pagas"}.`);
  }
  /*
   * Amarelo só quando há alguma coisa a resolver: não se lançou nada, ou ficou
   * gente de fora por não ter preço. Quem já tinha a mensalidade (ou já a tinha
   * paga) ou tem um pagamento a decorrer ficou bem como está: é informação, e
   * o lançamento correu bem — verde.
   */
  const aResolver = feito.length === 0 || r.semPreco.length > 0;
  return (
    <div
      className={cx(
        "space-y-1 rounded-[var(--radius-control)] px-3 py-2.5 text-meta leading-relaxed",
        aResolver ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok",
      )}
    >
      <p className="font-medium">{feito.length ? feito.join(" ") : "Não foi lançada nem marcada nenhuma mensalidade."}</p>
      {r.jaExistiam.length > 0 && (
        <p>Quem já tinha mensalidade em {r.jaExistiam.map(periodLabel).join(", ")} ficou de fora nesse mês.</p>
      )}
      {r.jaPagas.length > 0 && (
        <p>Em {r.jaPagas.map(periodLabel).join(", ")}, quem já tinha a mensalidade paga ficou como estava.</p>
      )}
      {r.emPagamento > 0 && (
        <p>
          {r.emPagamento === 1
            ? "Uma tem um pagamento online a decorrer e não foi mexida."
            : `${r.emPagamento} têm um pagamento online a decorrer e não foram mexidas.`}
        </p>
      )}
      {r.semPreco.length > 0 && (
        <p>
          Sem preço definido, ficaram de fora: {nomes.join(", ")}
          {resto > 0 ? ` e mais ${resto}` : ""}. Para estes, usa um valor fixo.
        </p>
      )}
    </div>
  );
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
