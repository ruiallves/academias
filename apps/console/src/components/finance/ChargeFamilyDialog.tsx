import { useMemo, useState, type FormEvent } from "react";
import { CustoDoPagamento } from "./CustoDoPagamento";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { Monogram, SelectField, cx } from "@/components/primitives";
import { Check, Home, Search, Send, TriangleAlert, Wallet } from "@/lib/icons";
import { mesCobrado } from "@/lib/api";
import { useActiveCatalog } from "@/lib/catalogs";
import { guardiansOf, listAthletes, listTeams, teamById } from "@/lib/api";
import { apiPost } from "@/lib/http";
import { reloadFees } from "@/lib/store";
import { money } from "@/lib/format";
import { useSession } from "@/session";
import type { Athlete, Guardian } from "@/data/types";

/**
 * Cobrar uma coisa avulsa a uma família.
 *
 * ## O que isto substitui
 *
 * O envelope. O equipamento de treino, a inscrição no torneio, a viagem do
 * autocarro — hoje combina-se no grupo de WhatsApp e recebe-se em dinheiro à
 * beira do campo, e é aí que o clube perde dinheiro: ninguém sabe quem já pagou,
 * e quem não pagou também não sabe que devia.
 *
 * Pelo mesmo caminho da mensalidade, isto resolve-se sozinho. A cobrança nasce
 * como `Charge` (ver `ChargeKind` no `schema.prisma`), aparece na app do pai no
 * sítio onde ele já paga, e paga-se por MB Way ou Multibanco como o resto. O
 * clube deixa de perguntar quem pagou: a lista responde.
 *
 * ## Um atleta, uma equipa, ou todos
 *
 * O equipamento é do Tomás; o kit de treino é do Sub-15 inteiro; a rifa da
 * angariação é do clube todo. As três coisas são a mesma cobrança repetida, e
 * repeti-la à mão sessenta vezes é o que fazia o clube desistir e voltar ao
 * envelope. Escolhe-se o alvo, e o resto do formulário é igual.
 *
 * **Quem está na equipa é o servidor que resolve**, não esta lista: entre abrir
 * o diálogo e carregar no botão pode entrar um atleta, e o âmbito de quem cobra
 * tem de valer na mesma. Daqui vai só o id da equipa, ou "todos". A contagem
 * que se mostra é uma estimativa do que está no ecrã, e é dita como tal.
 *
 * ## O atleta primeiro, e o encarregado a seguir — mostrado, não escolhido
 *
 * Escolhe-se **o atleta**, porque é assim que um clube pensa: cobra-se o
 * equipamento *do Tomás*, não se cobra *ao senhor Joaquim*. Quem recebe o aviso
 * sai daí — os encarregados daquele atleta —, e o diálogo mostra-os mal o atleta
 * seja escolhido.
 *
 * **Mostrados e não escolhidos** é deliberado. Pôr um segundo selector era abrir
 * a porta a avisar o pai errado por engano de clique, e não há decisão nenhuma a
 * tomar: o aviso vai para **todos** os encarregados activos. Quando o atleta não
 * tem nenhum, diz-se em vez de se calar — é melhor saber isso antes de carregar.
 *
 * ## Uma família sem app não recebe nada
 *
 * E também se diz. A cobrança fica registada na mesma e cobra-se ao balcão como
 * antes, mas prometer um aviso que não chega ao telemóvel de ninguém é a forma
 * mais rápida de a direcção deixar de confiar no produto.
 */
/** A quem se cobra: um atleta, uma equipa inteira, ou todos os atletas activos. */
type Alvo = "ATLETA" | "EQUIPA" | "TODOS";

export function ChargeFamilyDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { session } = useSession();
  const atletas = useMemo(() => listAthletes(session).filter((a) => a.status === "active"), [session]);
  const categorias = useActiveCatalog("financeIncome");

  const equipas = useMemo(
    () => listTeams(session).slice().sort((a, b) => a.name.localeCompare(b.name, "pt")),
    [session],
  );

  const [alvo, setAlvo] = useState<Alvo>("ATLETA");
  const [atleta, setAtleta] = useState<Athlete | null>(null);
  const [equipaId, setEquipaId] = useState("");
  const [procura, setProcura] = useState("");
  const [titulo, setTitulo] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState(daquiA(14));
  const [categoria, setCategoria] = useState("");
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const cents = paraCentimos(valor);
  /*
   * O mês do vencimento tem de ser um mês cobrado.
   *
   * Uma avulsa vive no mês do vencimento, e num mês que o clube desligou seria
   * dinheiro a pedir num mês que não existe. O servidor recusa
   * (`assertMesesCobrados`); aqui diz-se antes de carregar, e o botão espera.
   */
  const mesFechado = Boolean(vencimento) && !mesCobrado(vencimento);

  /* Quantos atletas vai isto apanhar, pelo que a consola tem em mãos. */
  const quantos =
    alvo === "ATLETA" ? (atleta ? 1 : 0) : alvo === "EQUIPA" ? atletas.filter((a) => a.teamId === equipaId).length : atletas.length;
  const alvoEscolhido = alvo === "ATLETA" ? Boolean(atleta) : alvo === "EQUIPA" ? Boolean(equipaId) : true;

  const valido =
    alvoEscolhido &&
    quantos > 0 &&
    titulo.trim().length >= 2 &&
    cents !== null &&
    cents >= 50 &&
    Boolean(vencimento) &&
    !mesFechado;

  const encarregados = atleta ? guardiansOf(atleta.id).filter((g) => g.isActive) : [];

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await apiPost("/api/charges/avulsa", {
        ...(alvo === "ATLETA" ? { athleteId: atleta!.id } : alvo === "EQUIPA" ? { teamId: equipaId } : { todos: true }),
        title: titulo.trim(),
        amountCents: cents,
        dueDate: vencimento,
        categoryId: categoria || undefined,
        notes: nota.trim() || undefined,
      });

      /*
       * Uma cobrança avulsa é uma `Charge` como as mensalidades, e o `store`
       * guarda-as todas. Sem esta linha ela nascia invisível para o resto da
       * consola — nomeadamente para a tabela das Mensalidades, que é onde a
       * direcção vai ver quem deve o quê. Mesma razão de `NewFeeDialog`.
       */
      await reloadFees();
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível criar a cobrança.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="cobrar-familia"
      title="Cobrar a uma família"
      subtitle="Fora da mensalidade — equipamento, torneio, viagem."
      icon={<Wallet className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={560}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-meta text-ink-3">
            {cents && quantos > 0
              ? alvo === "ATLETA"
                ? `${money(cents)} para ${primeiroNome(atleta!.name)}`
                : `${quantos} × ${money(cents)} · ${money(cents * quantos)} no total`
              : "Os encarregados são avisados na app."}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
              Cancelar
            </button>
            <button type="submit" form="form-cobranca" className="ctl-primary" disabled={!valido || busy}>
              <Send className="size-3.5" strokeWidth={1.75} />
              {busy ? "A enviar…" : alvo === "ATLETA" || quantos === 0 ? "Cobrar e avisar" : `Cobrar a ${quantos} e avisar`}
            </button>
          </div>
        </div>
      }
    >
      <form id="form-cobranca" onSubmit={submeter} className="space-y-4 p-5">
        <fieldset>
          <legend className="mb-1.5 text-meta font-medium text-ink">A quem</legend>
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ["ATLETA", "Um atleta"],
                ["EQUIPA", "Uma equipa"],
                ["TODOS", `Todos (${atletas.length})`],
              ] as [Alvo, string][]
            ).map(([chave, rotulo]) => (
              <button
                key={chave}
                type="button"
                onClick={() => {
                  setAlvo(chave);
                  setAtleta(null);
                }}
                className={cx(
                  "h-8 rounded-full px-3 text-meta font-medium transition-colors",
                  alvo === chave ? "bg-ink text-surface" : "bg-sunken text-ink-2 hover:text-ink",
                )}
              >
                {rotulo}
              </button>
            ))}
          </div>

          {alvo === "ATLETA" &&
            (atleta ? (
              <div className="mt-2.5">
                <Escolhido atleta={atleta} encarregados={encarregados} onTrocar={() => setAtleta(null)} />
              </div>
            ) : (
              <div className="mt-2.5">
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
                <ListaDeAtletas atletas={atletas} procura={procura} onEscolher={setAtleta} />
              </div>
            ))}

          {alvo === "EQUIPA" && (
            <div className="mt-2.5">
              <SelectField
                className="w-full"
                value={equipaId}
                onChange={setEquipaId}
                options={[
                  { value: "", label: "Escolhe a equipa" },
                  ...equipas.map((e) => ({ value: e.id, label: e.name })),
                ]}
              />
            </div>
          )}

          {/*
            Quantos, e a quem chega. A contagem é do que a consola tem em mãos;
            quem entrar na equipa entretanto entra na cobrança à mesma, porque
            é o servidor que resolve a lista no momento de cobrar.
          */}
          {alvo !== "ATLETA" && alvoEscolhido && (
            <p className="mt-2 flex items-start gap-1.5 rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta leading-relaxed text-ink-2">
              <Home className="mt-0.5 size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
              <span>
                {quantos === 0
                  ? "Esta equipa não tem atletas activos."
                  : `Uma cobrança para cada um dos ${quantos} atletas ${alvo === "EQUIPA" ? "desta equipa" : "activos"}, e os encarregados de cada um são avisados na app.`}
              </span>
            </p>
          )}
        </fieldset>

        {/*
          O resto do formulário só depois de haver atleta. Não é para poupar
          espaço: é porque "quanto tem de pagar" sem saber quem é a pagar é uma
          pergunta sem sujeito, e um formulário inteiro cinzento à espera de uma
          escolha lá em cima ensina a ignorá-lo.
        */}
        {alvoEscolhido && (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-3">
              <DialogField label="O que vai pagar">
                <input
                  autoFocus
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Equipamento de treino"
                  maxLength={80}
                  className={dialogInputClass}
                />
              </DialogField>
              <DialogField label="Valor (€)">
                <input
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  inputMode="decimal"
                  placeholder="35,00"
                  className={cx(
                    dialogInputClass,
                    "text-right tabular",
                    valor && (cents === null || cents < 50) && "border-risk",
                  )}
                />
              </DialogField>
            </div>

            {/*
              Fora da coluna do valor, e à largura toda.
              Estava dentro do `DialogField` de "Valor (€)", que tem 130px: a
              tabela por método ficava espremida e "Débito directo" partia-se em
              duas linhas. O sítio de uma nota sobre o preço é por baixo da
              linha do preço, não dentro do campo.
            */}
            <CustoDoPagamento amountCents={cents} className="-mt-1" />

            <div className="grid grid-cols-2 gap-3">
              <DialogField label="Categoria" hint="receita">
                <SelectField
                  className="w-full"
                  value={categoria}
                  onChange={setCategoria}
                  options={[
                    { value: "", label: "Sem categoria" },
                    ...categorias.map((c) => ({ value: c.id, label: c.label })),
                  ]}
                />
              </DialogField>
              {/*
                Duas semanas por omissão, e não hoje: uma cobrança que vence no
                dia em que é criada nasce vencida no ecrã do pai, e o vermelho
                deixa de querer dizer alguma coisa.
              */}
              <DialogField label="Pagar até">
                <input
                  type="date"
                  value={vencimento}
                  onChange={(e) => setVencimento(e.target.value)}
                  className={dialogInputClass}
                />
                              {mesFechado && (
                  <p className="mt-1 text-meta leading-relaxed text-warn">
                    O clube não cobra em {MES_DO_VENCIMENTO(vencimento)}. Escolhe uma data noutro mês, ou liga
                    esse mês nas Definições.
                  </p>
                )}
</DialogField>
            </div>

            <DialogField label="Nota para a família" hint="opcional — vai na notificação">
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={2}
                maxLength={400}
                placeholder="O equipamento é entregue no treino de quinta."
                className={cx(dialogInputClass, "h-auto resize-y py-2 leading-relaxed")}
              />
            </DialogField>
          </>
        )}

        {erro && (
          <p role="alert" className="flex items-start gap-1.5 text-meta text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

/** A lista de onde se escolhe. Sem procura, os primeiros; com procura, o que bate. */
export function ListaDeAtletas({
  atletas,
  procura,
  onEscolher,
}: {
  atletas: Athlete[];
  procura: string;
  onEscolher: (a: Athlete) => void;
}) {
  const q = procura.trim().toLocaleLowerCase("pt");
  const encontrados = q
    ? atletas.filter((a) => a.name.toLocaleLowerCase("pt").includes(q))
    : atletas.slice(0, 8);

  if (encontrados.length === 0) {
    return (
      <p className="mt-2 rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta text-ink-3">
        Nenhum atleta com esse nome.
      </p>
    );
  }

  return (
    <ul className="mt-2 max-h-[240px] overflow-y-auto rounded-[var(--radius-control)] border border-line">
      {encontrados.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            onClick={() => onEscolher(a)}
            className="flex w-full items-center gap-2.5 border-b border-line px-3 py-2 text-left transition-colors duration-[120ms] last:border-b-0 hover:bg-sunken"
          >
            <Monogram name={a.name} photoUrl={a.photoUrl} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium text-ink">{a.name}</span>
              <span className="block truncate text-meta text-ink-3">{teamById(a.teamId)?.name ?? "Sem equipa"}</span>
            </span>
          </button>
        </li>
      ))}
      {!q && atletas.length > encontrados.length && (
        <li className="border-t border-line px-3 py-2 text-meta text-ink-4">
          Escreve para encontrar os outros {atletas.length - encontrados.length}.
        </li>
      )}
    </ul>
  );
}

/**
 * O atleta escolhido, e quem vai receber a conta.
 *
 * A conta vai para **todos** os encarregados activos. Houve um tempo em que ia
 * só para um "pagador" marcado — o primeiro a registar-se na app —, e isso
 * partia-se no caso mais banal que há: pais separados, em que qualquer um paga.
 * Restam duas consequências de carregar no botão, e dizem-se as duas: há
 * encarregados (vai para eles), ou não há nenhum (não vai para lado nenhum).
 */
export function Escolhido({
  atleta,
  encarregados,
  onTrocar,
}: {
  atleta: Athlete;
  encarregados: Guardian[];
  onTrocar: () => void;
}) {
  const semNinguem = encarregados.length === 0;
  const semApp = encarregados.length > 0 && encarregados.every((g) => !g.appInstalled);

  return (
    <div className="rounded-[var(--radius-control)] border border-line">
      <div className="flex items-center gap-2.5 border-b border-line px-3 py-2.5">
        <Monogram name={atleta.name} photoUrl={atleta.photoUrl} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-ink">{atleta.name}</span>
          <span className="block truncate text-meta text-ink-3">{teamById(atleta.teamId)?.name ?? "Sem equipa"}</span>
        </span>
        <button type="button" onClick={onTrocar} className="ctl-ghost shrink-0">
          Trocar
        </button>
      </div>

      <div className="px-3 py-2.5">
        {semNinguem ? (
          <p className="flex items-start gap-1.5 text-meta leading-relaxed text-warn">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            Este atleta não tem encarregado activo. A cobrança fica registada, mas não avisa ninguém.
          </p>
        ) : (
          <>
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
              <Home className="size-3.5" strokeWidth={1.75} />
              Quem recebe
            </p>
            <ul className="space-y-1">
              {encarregados.map((g) => (
                <li key={g.id} className="flex items-center gap-2 text-body text-ink-2">
                  <span className="min-w-0 flex-1 truncate">
                    {g.name} <span className="text-ink-3">· {g.relation}</span>
                  </span>
                  <span
                    className={cx(
                      "flex shrink-0 items-center gap-1 text-meta",
                      g.appInstalled ? "text-ok" : "text-ink-4",
                    )}
                  >
                    {g.appInstalled ? <Check className="size-3.5" strokeWidth={2.5} /> : null}
                    {g.appInstalled ? "com a app" : "sem a app"}
                  </span>
                </li>
              ))}
            </ul>
            {semApp && (
              <p className="mt-2 flex items-start gap-1.5 text-meta leading-relaxed text-warn">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
                Ninguém desta família tem a app instalada — a cobrança fica registada, mas o aviso não chega ao
                telemóvel.
              </p>
            )}
            <p className="mt-2 text-meta leading-relaxed text-ink-3">
              O aviso vai para o encarregado que paga. Se a ficha não tiver nenhum marcado, vai para todos.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** "35", "35,50" → cêntimos. Nulo quando não é um valor — e o campo fica vermelho. */
export function paraCentimos(v: string): number | null {
  const limpo = v.trim().replace(/\s/g, "").replace("€", "").replace(",", ".");
  if (!limpo) return null;
  const n = Number(limpo);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function daquiA(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0];

/** "2026-08-20" → "Agosto" — o nome do mês, para a frase se ler. */
function MES_DO_VENCIMENTO(iso: string): string {
  const nomes = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  return nomes[Number(iso.slice(5, 7)) - 1] ?? iso;
}
