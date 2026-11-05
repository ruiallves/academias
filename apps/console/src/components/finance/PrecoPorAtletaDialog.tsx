import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Dialog } from "@/components/Dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Spinner } from "@/components/Busy";
import { cx, ListaDeEscolha, Monogram } from "@/components/primitives";
import { SearchInput, Select } from "@/components/filters";
import { ArrowLeft, CircleCheck, RotateCcw } from "@/lib/icons";
import { apiGet, apiPut } from "@/lib/http";
import {
  currentPeriod,
  listAthletes,
  listTeams,
  mesCobrado,
  proximoPeriodoCobrado,
  teamById,
} from "@/lib/api";
import { reloadAcademy } from "@/lib/store";
import { money, periodLabel } from "@/lib/format";
import type {
  AplicarEm,
  PrecoNaModalidade,
} from "@/components/finance/PrecoDoAtleta";
import type { useSession } from "@/session";

/** `GET /api/athletes/precos`: o preço de cada atleta, por modalidade. */
type PrecoDeUmAtleta = {
  athleteId: string;
  effectiveAmountCents: number | null;
  modalidades: PrecoNaModalidade[];
  valorUnicoCents: number | null;
};

/** `PUT /api/athletes/precos`. */
type Resultado = {
  guardados: number;
  atletas: number;
  criadas: number;
  reprecadas: { actualizadas: number; intocadas: number };
};

/** Um campo de preço: um atleta numa modalidade ("" = sem equipa, o valor único). */
type Linha = {
  chave: string;
  athleteId: string;
  nome: string;
  sportId: string | null;
  /** "Sub-14" — a equipa que conta para o preço desta modalidade. */
  equipa: string | null;
  teamAmountCents: number | null;
  /** O ajuste individual que existe hoje. Nulo = paga o da equipa. */
  originalCents: number | null;
};

/** Uma modalidade e os escolhidos que a praticam. */
type Grupo = { id: string; nome: string; linhas: Linha[] };

const SEM_EQUIPA = "__sem_equipa__";
const ALL = "all";

/**
 * Preço por atleta, para vários atletas de uma vez.
 *
 * ## Dois passos
 *
 * 1. **Escolher**: a lista do clube com caixas, pesquisa e filtro por equipa, e
 *    o preço de cada um ao lado. Escolhem-se os vinte a mudar.
 * 2. **Ajustar**: os escolhidos agrupados pela modalidade que praticam. Cada
 *    grupo tem um "mesmo valor para todos", e cada atleta o seu campo. O campo
 *    vazio quer dizer "paga o preço da equipa", que aparece lá dentro em cinza.
 *
 * Um atleta em duas modalidades aparece nos dois grupos (o preço é por
 * modalidade) e cada linha diz quanto ele fica a pagar no total.
 *
 * ## Grava de uma vez
 *
 * Só no fim, num pedido, e só o que mudou. Ou gravam todos ou nenhum: vinte
 * pedidos soltos deixavam, numa falha a meio, metade dos preços novos e a outra
 * metade não, sem se saber quais.
 */
export function PrecoPorAtletaDialog({
  session,
  onSaved,
  onClose,
  escolhaDoMes,
}: {
  session: ReturnType<typeof useSession>["session"];
  /** Gravou: a página lá fora relê as mensalidades. */
  onSaved: () => void;
  onClose: () => void;
  /** "A partir de quando se cobra", desenhado pela página (o mesmo dos preços por equipa). */
  escolhaDoMes: (valor: AplicarEm, mudar: (v: AplicarEm) => void) => ReactNode;
}) {
  const atletas = listAthletes(session);
  const equipas = listTeams(session);

  const [precos, setPrecos] = useState<Map<string, PrecoDeUmAtleta> | null>(
    null,
  );
  const [erroAoLer, setErroAoLer] = useState<string | null>(null);

  const [passo, setPasso] = useState<"escolher" | "ajustar" | "feito">(
    "escolher",
  );
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [equipa, setEquipa] = useState<string>(ALL);

  const [aplicarEm, setAplicarEm] = useState<AplicarEm>(
    mesCobrado(currentPeriod) ? "atual" : "proximo",
  );
  /** O que está escrito em cada campo, por `chave`. Ausente = nunca mexido. */
  const [valores, setValores] = useState<Map<string, string>>(new Map());
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [sairSemGravar, setSairSemGravar] = useState(false);

  useEffect(() => {
    let vivo = true;
    apiGet<{ atletas: PrecoDeUmAtleta[] }>("/api/athletes/precos")
      .then(
        (r) =>
          vivo && setPrecos(new Map(r.atletas.map((a) => [a.athleteId, a]))),
      )
      .catch(
        (e) =>
          vivo &&
          setErroAoLer(
            e instanceof Error ? e.message : "Não foi possível ler os preços.",
          ),
      );
    return () => {
      vivo = false;
    };
  }, []);

  /* ---------------------------------------------------------------- passo 1 */

  const q = query.trim().toLowerCase();
  const visiveis = atletas.filter(
    (a) =>
      (equipa === ALL || a.equipas.some((e) => e.teamId === equipa)) &&
      (!q || a.name.toLowerCase().includes(q)),
  );
  const todosVisiveisEscolhidos =
    visiveis.length > 0 && visiveis.every((a) => escolhidos.has(a.id));

  function alternar(id: string) {
    setEscolhidos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function alternarVisiveis() {
    setEscolhidos((s) => {
      const n = new Set(s);
      for (const a of visiveis) {
        if (todosVisiveisEscolhidos) n.delete(a.id);
        else n.add(a.id);
      }
      return n;
    });
  }

  /* ---------------------------------------------------------------- passo 2 */

  const grupos: Grupo[] = useMemo(() => {
    if (!precos) return [];
    const porModalidade = new Map<string, Grupo>();
    const juntar = (id: string, nome: string, linha: Linha) => {
      const g = porModalidade.get(id) ?? { id, nome, linhas: [] };
      g.linhas.push(linha);
      porModalidade.set(id, g);
    };
    for (const a of atletas) {
      if (!escolhidos.has(a.id)) continue;
      const p = precos.get(a.id);
      if (!p || p.modalidades.length === 0) {
        juntar(SEM_EQUIPA, "Sem equipa", {
          chave: `${a.id}|`,
          athleteId: a.id,
          nome: a.name,
          sportId: null,
          equipa: null,
          teamAmountCents: null,
          originalCents: p?.valorUnicoCents ?? null,
        });
        continue;
      }
      for (const m of p.modalidades) {
        juntar(m.sportId, m.sportName, {
          chave: `${a.id}|${m.sportId}`,
          athleteId: a.id,
          nome: a.name,
          sportId: m.sportId,
          equipa: m.teamName,
          teamAmountCents: m.teamAmountCents,
          originalCents: m.individualAmountCents,
        });
      }
    }
    const lista = [...porModalidade.values()];
    for (const g of lista)
      g.linhas.sort((x, y) => x.nome.localeCompare(y.nome, "pt"));
    // As modalidades por nome; "Sem equipa" no fim.
    return lista.sort((x, y) =>
      x.id === SEM_EQUIPA
        ? 1
        : y.id === SEM_EQUIPA
          ? -1
          : x.nome.localeCompare(y.nome, "pt"),
    );
  }, [precos, atletas, escolhidos]);

  const linhas = grupos.flatMap((g) => g.linhas);

  /** O que o campo diz agora, em cêntimos. `null` = vazio (paga o da equipa); `"invalido"` = não se percebe. */
  function lido(l: Linha): number | null | "invalido" {
    const escrito = valores.get(l.chave);
    if (escrito === undefined) return l.originalCents;
    return paraCentimos(escrito);
  }

  const alteracoes = linhas.filter((l) => {
    const v = lido(l);
    return v !== "invalido" && v !== l.originalCents;
  });
  const invalidas = linhas.filter((l) => lido(l) === "invalido");

  /** O que o atleta passa a pagar por mês, com o que está escrito agora. */
  function totalDoAtleta(athleteId: string): number | null {
    const p = precos?.get(athleteId);
    if (!p) return null;
    const minhas = linhas.filter((l) => l.athleteId === athleteId);
    let soma: number | null = null;
    for (const l of minhas) {
      const v = lido(l);
      const vale =
        v === "invalido"
          ? (l.originalCents ?? l.teamAmountCents)
          : (v ?? l.teamAmountCents);
      if (vale !== null) soma = (soma ?? 0) + vale;
    }
    return soma;
  }

  function escrever(chave: string, texto: string) {
    setValores((m) => new Map(m).set(chave, texto));
  }

  function aplicarATodos(g: Grupo, texto: string) {
    setValores((m) => {
      const n = new Map(m);
      for (const l of g.linhas) n.set(l.chave, texto);
      return n;
    });
  }

  async function guardar() {
    if (alteracoes.length === 0 || invalidas.length > 0) return;
    setAGravar(true);
    setErro(null);
    try {
      const r = await apiPut<Resultado>("/api/athletes/precos", {
        aplicarEm,
        itens: alteracoes.map((l) => {
          const v = lido(l) as number | null;
          return {
            athleteId: l.athleteId,
            ...(l.sportId ? { sportId: l.sportId } : {}),
            amountCents: v,
          };
        }),
      });
      setResultado(r);
      setPasso("feito");
      await reloadAcademy();
      onSaved();
    } catch (e) {
      setErro(
        e instanceof Error ? e.message : "Não foi possível guardar os preços.",
      );
    } finally {
      setAGravar(false);
    }
  }

  function fechar() {
    if (passo === "ajustar" && alteracoes.length > 0) setSairSemGravar(true);
    else onClose();
  }

  /* ---------------------------------------------------------------- desenho */

  const subtitulo =
    passo === "escolher"
      ? "Escolhe os atletas. A seguir defines o preço de cada um em cada modalidade."
      : passo === "ajustar"
        ? `${escolhidos.size} ${escolhidos.size === 1 ? "atleta" : "atletas"} · o campo vazio paga o preço da equipa`
        : "Preços guardados";

  const rodape =
    passo === "escolher" ? (
      <>
        <span className="mr-auto text-meta text-ink-3 tabular">
          {escolhidos.size === 0
            ? "Nenhum atleta escolhido"
            : `${escolhidos.size} ${escolhidos.size === 1 ? "atleta escolhido" : "atletas escolhidos"}`}
        </span>
        <button type="button" onClick={onClose} className="ctl-ghost">
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => setPasso("ajustar")}
          disabled={escolhidos.size === 0 || !precos}
          className="ctl-primary"
        >
          Continuar
        </button>
      </>
    ) : passo === "ajustar" ? (
      <>
        <button
          type="button"
          onClick={() => setPasso("escolher")}
          disabled={aGravar}
          className="ctl-ghost mr-auto"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.75} />
          Voltar
        </button>
        <span className="text-meta text-ink-3 tabular">
          {invalidas.length > 0
            ? `${invalidas.length} ${invalidas.length === 1 ? "valor por corrigir" : "valores por corrigir"}`
            : alteracoes.length === 0
              ? "Sem alterações"
              : `${alteracoes.length} ${alteracoes.length === 1 ? "alteração" : "alterações"}`}
        </span>
        <button
          type="button"
          onClick={() => void guardar()}
          disabled={aGravar || alteracoes.length === 0 || invalidas.length > 0}
          className="ctl-primary"
        >
          {aGravar ? "A guardar…" : "Guardar preços"}
        </button>
      </>
    ) : (
      <button type="button" onClick={onClose} className="ctl-primary">
        Concluído
      </button>
    );

  return (
    <>
      <Dialog
        labelledBy="preco-por-atleta"
        title="Preço por atleta"
        subtitle={subtitulo}
        onClose={fechar}
        width={passo === "ajustar" ? 640 : 520}
        footer={rodape}
      >
        {erroAoLer ? (
          <p className="m-5 rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">
            {erroAoLer}
          </p>
        ) : !precos ? (
          <Spinner className="py-10" />
        ) : passo === "escolher" ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder="Procurar atleta…"
              />
              {equipas.length > 1 && (
                <Select
                  label="Equipa"
                  value={equipa}
                  onChange={setEquipa}
                  options={[
                    { value: ALL, label: "Todas as equipas" },
                    ...equipas.map((t) => ({ value: t.id, label: t.name })),
                  ]}
                />
              )}
            </div>

            {visiveis.length > 0 && (
              <div className="flex items-center justify-between border-b border-line bg-sunken/40 px-5 py-2">
                <span className="text-meta text-ink-3 tabular">
                  {visiveis.length}{" "}
                  {visiveis.length === 1 ? "atleta" : "atletas"}
                  {equipa !== ALL &&
                    ` em ${teamById(equipa)?.name ?? "esta equipa"}`}
                </span>
                <button
                  type="button"
                  onClick={alternarVisiveis}
                  className="ctl-outline"
                >
                  {todosVisiveisEscolhidos ? "Tirar todos" : "Escolher todos"}
                </button>
              </div>
            )}

            <ListaDeEscolha className="max-h-[52vh] overflow-y-auto">
              {visiveis.length === 0 && (
                <li className="px-5 py-8 text-center text-meta text-ink-4">
                  Ninguém com esse nome.
                </li>
              )}
              {visiveis.map((a) => {
                const marcado = escolhidos.has(a.id);
                const p = precos.get(a.id);
                const nomesEquipas = a.equipas
                  .map((e) => teamById(e.teamId)?.name)
                  .filter(Boolean);
                return (
                  <li key={a.id} className="border-b border-line last:border-0">
                    <label
                      className={cx(
                        "flex cursor-pointer items-center gap-3 px-5 py-2.5 transition-colors duration-[120ms]",
                        marcado ? "bg-sunken" : "hover:bg-sunken/60",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => alternar(a.id)}
                        className="size-4 shrink-0 accent-[var(--color-ink)]"
                      />
                      <Monogram name={a.name} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body text-ink">
                          {a.name}
                        </span>
                        <span className="block truncate text-meta text-ink-3">
                          {nomesEquipas.length > 0
                            ? nomesEquipas.join(" · ")
                            : "Sem equipa"}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span
                          className={cx(
                            "block text-body tabular",
                            p?.effectiveAmountCents == null
                              ? "text-ink-4"
                              : "font-medium text-ink",
                          )}
                        >
                          {p?.effectiveAmountCents == null
                            ? "sem preço"
                            : money(p.effectiveAmountCents)}
                        </span>
                        {temAjuste(p) && (
                          <span className="block text-[11px] text-ink-3">
                            ajustado
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ListaDeEscolha>
          </>
        ) : passo === "ajustar" ? (
          <>
            {escolhaDoMes(aplicarEm, setAplicarEm)}

            {grupos.map((g) => (
              <GrupoDeModalidade
                key={g.id}
                grupo={g}
                semEquipa={g.id === SEM_EQUIPA}
                valores={valores}
                lido={lido}
                totalDoAtleta={totalDoAtleta}
                variasModalidades={(id) =>
                  linhas.filter((l) => l.athleteId === id).length > 1
                }
                onEscrever={escrever}
                onAplicarATodos={(texto) => aplicarATodos(g, texto)}
              />
            ))}

            {erro && (
              <p
                role="alert"
                className="mx-5 my-4 rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk"
              >
                {erro}
              </p>
            )}
          </>
        ) : (
          resultado && <Resumo resultado={resultado} aplicarEm={aplicarEm} />
        )}
      </Dialog>

      {sairSemGravar && (
        <ConfirmDialog
          title="Sair sem guardar?"
          confirmLabel="Sair sem guardar"
          onConfirm={onClose}
          onClose={() => setSairSemGravar(false)}
        >
          <p>
            Tens {alteracoes.length}{" "}
            {alteracoes.length === 1 ? "preço alterado" : "preços alterados"}{" "}
            por guardar. Se saíres agora, ficam como estavam.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

/**
 * Uma modalidade: o cabeçalho com "mesmo valor para todos" e uma linha por atleta.
 */
function GrupoDeModalidade({
  grupo,
  semEquipa,
  valores,
  lido,
  totalDoAtleta,
  variasModalidades,
  onEscrever,
  onAplicarATodos,
}: {
  grupo: Grupo;
  semEquipa: boolean;
  valores: Map<string, string>;
  lido: (l: Linha) => number | null | "invalido";
  totalDoAtleta: (athleteId: string) => number | null;
  variasModalidades: (athleteId: string) => boolean;
  onEscrever: (chave: string, texto: string) => void;
  onAplicarATodos: (texto: string) => void;
}) {
  const [todos, setTodos] = useState("");
  const todosCents = paraCentimos(todos);
  const podeAplicar = todos.trim() !== "" && todosCents !== "invalido";

  return (
    <section className="border-b border-line last:border-0">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 bg-sunken/40 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h3 className="text-body font-semibold text-ink">{grupo.nome}</h3>
          <p className="text-meta text-ink-3 tabular">
            {grupo.linhas.length}{" "}
            {grupo.linhas.length === 1 ? "atleta" : "atletas"}
            {semEquipa && " · sem preço de equipa, o valor é só deste atleta"}
          </p>
        </div>
        {/* Em todas as modalidades, mesmo com um atleta só: é o mesmo gesto em todo o lado. */}
        <div className="flex items-center gap-1.5">
          <span className="text-meta text-ink-3">Todos a</span>
          <CampoDeEuros
            value={todos}
            placeholder="0,00"
            invalido={todos.trim() !== "" && todosCents === "invalido"}
            onChange={setTodos}
            onEnter={() => podeAplicar && onAplicarATodos(todos)}
            ariaLabel={`Mesmo valor para todos em ${grupo.nome}`}
          />
          <button
            type="button"
            onClick={() => onAplicarATodos(todos)}
            disabled={!podeAplicar}
            className="ctl-outline"
          >
            Aplicar
          </button>
        </div>
      </header>

      <ul>
        {grupo.linhas.map((l) => {
          const v = lido(l);
          const escrito =
            valores.get(l.chave) ??
            (l.originalCents !== null ? emEuros(l.originalCents) : "");
          const mudou = v !== "invalido" && v !== l.originalCents;
          const individual = v !== null && v !== "invalido";
          const total = variasModalidades(l.athleteId)
            ? totalDoAtleta(l.athleteId)
            : null;
          return (
            <li
              key={l.chave}
              className="flex items-center gap-3 border-t border-line px-5 py-2.5 first:border-t-0"
            >
              <span
                aria-hidden
                className={cx(
                  "size-1.5 shrink-0 rounded-full",
                  mudou ? "bg-ink" : "bg-transparent",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-body text-ink">{l.nome}</div>
                <div className="truncate text-meta text-ink-3">
                  {semEquipa
                    ? "Sem equipa"
                    : l.teamAmountCents !== null
                      ? `${l.equipa} · equipa ${money(l.teamAmountCents)}`
                      : `${l.equipa} · a equipa não tem preço`}
                  {total !== null && (
                    <span className="text-ink-2">
                      {" "}
                      · paga {money(total)} no total
                    </span>
                  )}
                </div>
              </div>
              <CampoDeEuros
                value={escrito}
                placeholder={
                  l.teamAmountCents !== null
                    ? emEuros(l.teamAmountCents)
                    : "por definir"
                }
                invalido={v === "invalido"}
                destaque={individual && !semEquipa}
                onChange={(t) => onEscrever(l.chave, t)}
                ariaLabel={`Valor de ${l.nome} em ${grupo.nome}, por mês`}
              />
              <button
                type="button"
                onClick={() => onEscrever(l.chave, "")}
                disabled={escrito.trim() === ""}
                title={semEquipa ? "Tirar o valor" : "Usar o preço da equipa"}
                aria-label={
                  semEquipa
                    ? `Tirar o valor de ${l.nome}`
                    : `Usar o preço da equipa para ${l.nome}`
                }
                className="ctl-ghost size-8 shrink-0 justify-center px-0 disabled:invisible"
              >
                <RotateCcw className="size-3.5" strokeWidth={1.75} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Um campo de euros, com o € à esquerda. Selecciona tudo ao entrar: um preço troca-se, não se edita. */
function CampoDeEuros({
  value,
  placeholder,
  invalido,
  destaque,
  onChange,
  onEnter,
  ariaLabel,
}: {
  value: string;
  placeholder: string;
  invalido: boolean;
  destaque?: boolean;
  onChange: (v: string) => void;
  onEnter?: () => void;
  ariaLabel: string;
}) {
  return (
    <div className="relative shrink-0">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-meta text-ink-4">
        €
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        aria-label={ariaLabel}
        aria-invalid={invalido}
        className={cx(
          "h-8 w-[104px] rounded-[var(--radius-control)] border bg-surface pr-2.5 pl-6 text-right text-body tabular placeholder:text-ink-4 focus:outline-none",
          invalido
            ? "border-risk"
            : destaque
              ? "border-line-strong font-medium text-ink focus:border-ink-3"
              : "border-line text-ink focus:border-line-strong",
        )}
      />
    </div>
  );
}

/** O que aconteceu, dito como a direcção o pensa: preços, e mensalidades deste mês. */
function Resumo({
  resultado,
  aplicarEm,
}: {
  resultado: Resultado;
  aplicarEm: AplicarEm;
}) {
  const mes = periodLabel(currentPeriod);
  const { actualizadas, intocadas } = resultado.reprecadas;
  return (
    <div className="space-y-3 px-5 py-6">
      <div className="flex items-center gap-2.5">
        <CircleCheck className="size-5 shrink-0 text-ok" strokeWidth={1.75} />
        <p className="text-body font-medium text-ink">
          {resultado.guardados}{" "}
          {resultado.guardados === 1 ? "preço guardado" : "preços guardados"},
          de {resultado.atletas}{" "}
          {resultado.atletas === 1 ? "atleta" : "atletas"}.
        </p>
      </div>
      <ul className="space-y-1.5 pl-7 text-meta leading-relaxed text-ink-2">
        {aplicarEm === "proximo" ? (
          <li>
            Os valores novos contam a partir de{" "}
            {periodLabel(proximoPeriodoCobrado(currentPeriod))}.
          </li>
        ) : (
          <>
            {resultado.criadas > 0 && (
              <li>
                {resultado.criadas === 1
                  ? "Foi emitida 1 mensalidade"
                  : `Foram emitidas ${resultado.criadas} mensalidades`}{" "}
                de {mes}.
              </li>
            )}
            {actualizadas > 0 && (
              <li>
                {actualizadas === 1
                  ? `1 mensalidade de ${mes} já emitida passou ao preço novo.`
                  : `${actualizadas} mensalidades de ${mes} já emitidas passaram ao preço novo.`}
              </li>
            )}
            {resultado.criadas === 0 &&
              actualizadas === 0 &&
              intocadas === 0 && (
                <li>As mensalidades de {mes} já estavam com estes valores.</li>
              )}
          </>
        )}
        {intocadas > 0 && (
          <li>
            {intocadas === 1
              ? "1 mensalidade ficou com o valor antigo porque já tem um pagamento a caminho ou feito."
              : `${intocadas} mensalidades ficaram com o valor antigo porque já têm um pagamento a caminho ou feito.`}
          </li>
        )}
      </ul>
    </div>
  );
}

/** Tem algum ajuste individual (em alguma modalidade, ou o valor único)? */
function temAjuste(p: PrecoDeUmAtleta | undefined): boolean {
  return (
    !!p &&
    (p.valorUnicoCents !== null ||
      p.modalidades.some((m) => m.individualAmountCents !== null))
  );
}

/** 2000 → "20,00". */
function emEuros(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * O texto do campo em cêntimos. Vazio é `null` (paga o da equipa).
 * As mesmas regras do servidor: 0 € (isento) ou de 0,50 € a 1000 €.
 */
function paraCentimos(texto: string): number | null | "invalido" {
  const t = texto.trim().replace(/\s/g, "").replace("€", "").replace(",", ".");
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return "invalido";
  const cents = Math.round(Number(t) * 100);
  if (cents > 0 && cents < 50) return "invalido";
  if (cents > 100_000) return "invalido";
  return cents;
}
