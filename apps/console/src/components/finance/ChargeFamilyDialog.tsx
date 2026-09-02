import { useMemo, useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { Monogram, SelectField, cx } from "@/components/primitives";
import { Check, Home, Search, Send, TriangleAlert, Wallet } from "@/lib/icons";
import { useActiveCatalog } from "@/lib/catalogs";
import { guardiansOf, listAthletes, teamById } from "@/lib/api";
import { apiPost } from "@/lib/http";
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
 * ## O atleta primeiro, e o encarregado a seguir — mostrado, não escolhido
 *
 * Escolhe-se **o atleta**, porque é assim que um clube pensa: cobra-se o
 * equipamento *do Tomás*, não se cobra *ao senhor Joaquim*. Quem paga sai daí —
 * é o encarregado pagador daquele atleta —, e o diálogo mostra-o mal o atleta
 * seja escolhido.
 *
 * **Mostrado e não escolhido** é deliberado. Pôr um segundo selector com os
 * encarregados era abrir a porta a cobrar ao pai errado por engano de clique, e
 * a resposta certa já está na ficha do atleta. Quando lá não está — ficha antiga
 * sem pagador marcado —, diz-se, em vez de se calar: o aviso vai para todos os
 * encarregados activos, e é melhor saber isso antes de carregar.
 *
 * ## Uma família sem app não recebe nada
 *
 * E também se diz. A cobrança fica registada na mesma e cobra-se ao balcão como
 * antes, mas prometer um aviso que não chega ao telemóvel de ninguém é a forma
 * mais rápida de a direcção deixar de confiar no produto.
 */
export function ChargeFamilyDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { session } = useSession();
  const atletas = useMemo(() => listAthletes(session).filter((a) => a.status === "active"), [session]);
  const categorias = useActiveCatalog("financeIncome");

  const [atleta, setAtleta] = useState<Athlete | null>(null);
  const [procura, setProcura] = useState("");
  const [titulo, setTitulo] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState(daquiA(14));
  const [categoria, setCategoria] = useState("");
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const cents = paraCentimos(valor);
  const valido = Boolean(atleta) && titulo.trim().length >= 2 && cents !== null && cents >= 100 && Boolean(vencimento);

  const encarregados = atleta ? guardiansOf(atleta.id).filter((g) => g.isActive) : [];

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (!valido || !atleta || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await apiPost("/api/charges/avulsa", {
        athleteId: atleta.id,
        title: titulo.trim(),
        amountCents: cents,
        dueDate: vencimento,
        categoryId: categoria || undefined,
        notes: nota.trim() || undefined,
      });
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
            {atleta && cents ? `${money(cents)} para ${primeiroNome(atleta.name)}` : "O encarregado é avisado na app."}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
              Cancelar
            </button>
            <button type="submit" form="form-cobranca" className="ctl-primary" disabled={!valido || busy}>
              <Send className="size-3.5" strokeWidth={1.75} />
              {busy ? "A enviar…" : "Cobrar e avisar"}
            </button>
          </div>
        </div>
      }
    >
      <form id="form-cobranca" onSubmit={submeter} className="space-y-4 p-5">
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

            <ListaDeAtletas atletas={atletas} procura={procura} onEscolher={setAtleta} />
          </fieldset>
        )}

        {/*
          O resto do formulário só depois de haver atleta. Não é para poupar
          espaço: é porque "quanto tem de pagar" sem saber quem é a pagar é uma
          pergunta sem sujeito, e um formulário inteiro cinzento à espera de uma
          escolha lá em cima ensina a ignorá-lo.
        */}
        {atleta && (
          <>
            <div className="grid grid-cols-[1fr_130px] gap-3">
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
                    valor && (cents === null || cents < 100) && "border-risk",
                  )}
                />
              </DialogField>
            </div>

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
function ListaDeAtletas({
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
 * Os três casos estão todos ditos, porque são três consequências diferentes de
 * carregar no botão: um pagador marcado (vai para ele), nenhum marcado (vai para
 * todos os encarregados), nenhum encarregado (não vai para lado nenhum).
 */
function Escolhido({
  atleta,
  encarregados,
  onTrocar,
}: {
  atleta: Athlete;
  encarregados: Guardian[];
  onTrocar: () => void;
}) {
  /*
   * Quem paga não vem marcado na lista que a consola tem em memória — `isPayer`
   * vive na ligação do lado do servidor, e é lá que se decide para quem vai o
   * aviso. Aqui mostra-se quem existe; quem recebe é dito pelo texto por baixo,
   * na linguagem da regra e não numa etiqueta que ninguém saberia ler.
   */
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
function paraCentimos(v: string): number | null {
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

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0];
