import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { DataTable, Empty, Loading, Panel, Pill, SelectField } from "@/components/primitives";
import { TransactionDialog } from "@/components/finance/TransactionDialog";
import { Dialog } from "@/components/Dialog";
import { ArrowLeft, Check, Download, Pencil, Plus, Repeat, Search, Trash2, TriangleAlert, Wallet, X } from "@/lib/icons";
import { shortDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { useActiveCatalog } from "@/lib/catalogs";
import {
  METHOD_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  deleteTransaction,
  euros,
  listTransactions,
  updateTransaction,
  type FinanceKind,
  type TransactionRow,
} from "@/lib/finance";

/**
 * Movimentos — o extracto do clube.
 *
 * As linhas registadas à mão e as mensalidades pagas, fundidas por data. As
 * automáticas trazem a etiqueta "Mensalidades" e não se tocam aqui: a verdade
 * delas vive nas Mensalidades, e um estorno acontece lá.
 *
 * Um previsto confirma-se na própria linha — "o autocarro foi pago" é um
 * clique, não um formulário.
 */
export default function Movements() {
  const { session } = useSession();
  const podeEscrever = can(session, "finance:write");
  const categoriasReceita = useActiveCatalog("financeIncome");
  const categoriasDespesa = useActiveCatalog("financeExpense");

  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<TransactionRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [registar, setRegistar] = useState<FinanceKind | null>(null);
  const [aMexer, setAMexer] = useState<string | null>(null);
  /** Cancelar um mês de uma série obriga a perguntar: só este, ou os seguintes? */
  const [cancelar, setCancelar] = useState<TransactionRow | null>(null);
  /**
   * A linha que se está a corrigir.
   *
   * Abre-se pelo lápis no fim da linha — ou clicando na linha, que continua a
   * funcionar para quem já lá carregava. O clique sozinho não chegava: era um
   * gesto que não se anuncia, e quem via uma categoria errada não tinha como
   * adivinhar que a podia corrigir. A única saída conhecida era cancelar o
   * movimento e registá-lo outra vez de raiz.
   */
  const [editar, setEditar] = useState<TransactionRow | null>(null);
  /**
   * A linha que se está a apagar.
   *
   * Apagar e cancelar são coisas diferentes e ambas ficam à mão: cancelar conta
   * uma história — o autocarro afinal não se pagou — e a linha fica no
   * histórico, riscada; apagar admite um engano, e o engano não é histórico
   * nenhum. Ver `deleteTransaction` no serviço, que já dizia isto e não tinha
   * quem lho pedisse.
   */
  const [apagar, setApagar] = useState<TransactionRow | null>(null);

  /**
   * Apagar de vez — uma linha, ou este mês e os seguintes de uma série.
   *
   * O `scope` só se pergunta quando há série; sem ela a pergunta não tem duas
   * respostas e o diálogo apaga logo. É a mesma regra do cancelar em série,
   * pelo mesmo motivo: adivinhar erra nos dois sentidos.
   */
  async function apagarMovimento(t: TransactionRow, scope?: "one" | "series") {
    setAMexer(t.id);
    setErro(null);
    try {
      await deleteTransaction(t.id, scope);
      setApagar(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível apagar o movimento.");
    } finally {
      setAMexer(null);
    }
  }

  const tipo = params.get("tipo") ?? "";
  const estado = params.get("estado") ?? "";
  const categoria = params.get("categoria") ?? "";

  async function carregar() {
    setErro(null);
    try {
      setRows(
        await listTransactions({
          kind: tipo || undefined,
          status: estado || undefined,
          categoryId: categoria || undefined,
        }),
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar os movimentos.");
    }
  }

  useEffect(() => {
    void carregar();
  }, [tipo, estado, categoria]);

  const filtrados = useMemo(() => {
    const termo = q.trim().toLowerCase();
    if (!termo) return rows ?? [];
    return (rows ?? []).filter((t) => `${t.description} ${t.counterparty ?? ""}`.toLowerCase().includes(termo));
  }, [rows, q]);

  const mexer = (chave: string, valor: string) => {
    const p = new URLSearchParams(params);
    if (valor) p.set(chave, valor);
    else p.delete(chave);
    setParams(p, { replace: true });
  };

  async function mudarEstado(t: TransactionRow, status: string, scope: "one" | "series" = "one") {
    if (aMexer) return;
    setAMexer(t.id);
    try {
      await updateTransaction(t.id, { status, scope });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível alterar.");
    } finally {
      setAMexer(null);
      setCancelar(null);
    }
  }

  /** O extracto em Excel — os movimentos filtrados, tal como se veem. */
  async function exportar() {
    const XLSX = await import("xlsx");
    const linhas = filtrados.map((t) => ({
      Data: shortDate(new Date(t.occurredAt)),
      Tipo: t.kind === "INCOME" ? "Receita" : "Despesa",
      Descrição: t.description,
      Categoria: t.category?.label ?? "",
      "Valor (€)": ((t.kind === "INCOME" ? 1 : -1) * t.amountCents) / 100,
      Estado: STATUS_LABEL[t.status],
      Método: t.method ? (METHOD_LABEL[t.method] ?? t.method) : "",
      "Origem/destino": t.counterparty ?? "",
      Equipa: t.team?.name ?? t.match?.teamName ?? "",
      Evento: t.match?.label ?? t.calendarEvent?.title ?? "",
      "Registado por": t.createdBy ?? (t.source === "fees" ? "Automático (mensalidades)" : ""),
    }));
    const sheet = XLSX.utils.json_to_sheet(linhas);
    sheet["!cols"] = Object.keys(linhas[0] ?? { a: 1 }).map((k) => ({ wch: Math.max(12, k.length + 4) }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Movimentos");
    XLSX.writeFile(book, "movimentos.xlsx");
  }

  if (erro && !rows) return <Empty title="Movimentos" detail={erro} icon={TriangleAlert} />;
  if (!rows) return <Loading />;

  return (
    <>
      <Link to="/contas" className="mb-3 inline-flex items-center gap-1.5 text-meta font-medium text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" strokeWidth={1.75} />
        Contas
      </Link>

      <PageHeader eyebrow="Contas" title="Movimentos" subtitle="Tudo o que entrou e saiu — e o que está previsto.">
        {filtrados.length > 0 && (
          <button type="button" className="ctl-ghost" onClick={() => void exportar()}>
            <Download className="size-3.5" strokeWidth={1.75} />
            Exportar
          </button>
        )}
        {podeEscrever && (
          <>
            {/*
              Um botão só. Receita e despesa são o mesmo gesto com o sinal
              trocado, e escolher o sinal antes de ver o formulário obrigava a
              decidir cedo de mais — a escolha passou para dentro do diálogo,
              onde se muda sem fechar nada.
            */}
            <button type="button" className="ctl-primary" onClick={() => setRegistar("EXPENSE")}>
              <Plus className="size-3.5" strokeWidth={2} />
              Novo movimento
            </button>
          </>
        )}
      </PageHeader>

      <Panel className="mb-3">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Procurar descrição ou origem…"
              className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface pl-8 text-body text-ink placeholder:text-ink-4"
            />
          </div>
          <SelectField
            value={tipo}
            onChange={(v) => mexer("tipo", v)}
            options={[
              { value: "", label: "Receitas e despesas" },
              { value: "INCOME", label: "Receitas" },
              { value: "EXPENSE", label: "Despesas" },
            ]}
          />
          <SelectField
            value={estado}
            onChange={(v) => mexer("estado", v)}
            options={[
              { value: "", label: "Todos os estados" },
              { value: "PLANNED", label: "Previstos" },
              { value: "PENDING", label: "Pendentes" },
              { value: "COMPLETED", label: "Concluídos" },
              { value: "CANCELLED", label: "Cancelados" },
            ]}
          />
          <SelectField
            value={categoria}
            onChange={(v) => mexer("categoria", v)}
            options={[
              { value: "", label: "Todas as categorias" },
              ...[...categoriasReceita, ...categoriasDespesa].map((c) => ({ value: c.id, label: c.label })),
            ]}
          />
        </div>
      </Panel>

      {erro && <p className="mb-2 text-meta text-risk">{erro}</p>}

      <Panel>
        <DataTable
          rows={filtrados}
          keyOf={(t) => t.id}
          /*
            As mensalidades não se editam aqui: a verdade delas vive nas
            Mensalidades (a euPago confirma lá, o estorno acontece lá), e esta
            lista só as mostra. Abrir-lhes um formulário seria prometer uma
            correcção que este módulo não tem como fazer.
          */
          onRowClick={podeEscrever ? (t) => t.source === "manual" && setEditar(t) : undefined}
          empty={
            <Empty
              title="Sem movimentos"
              detail="Regista a primeira receita ou despesa — as mensalidades pagas entram sozinhas."
              icon={Wallet}
            />
          }
          columns={[
            {
              key: "data",
              header: "Data",
              width: "90px",
              render: (t) => <span className="text-ink-2 tabular">{shortDate(new Date(t.occurredAt))}</span>,
            },
            {
              key: "descricao",
              header: "Descrição",
              render: (t) => (
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    {/* Uma linha de série diz que é de série: senão, quem a
                        cancela não percebe porque é que voltam mais onze. */}
                    {t.seriesId && (
                      <Repeat className="size-3 shrink-0 text-ink-4" strokeWidth={2} aria-label="Movimento fixo mensal" />
                    )}
                    <span className="truncate font-medium text-ink">{t.description}</span>
                  </span>
                  <span className="block truncate text-meta text-ink-3">
                    {[
                      t.category?.label,
                      t.counterparty,
                      t.match?.label ?? t.calendarEvent?.title,
                      t.team?.name ?? t.match?.teamName,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                </span>
              ),
            },
            {
              key: "metodo",
              header: "Método",
              hideBelow: "lg",
              render: (t) => <span className="text-ink-3">{t.method ? (METHOD_LABEL[t.method] ?? t.method) : "—"}</span>,
            },
            {
              key: "valor",
              header: "Valor",
              align: "right",
              render: (t) => (
                <span
                  className={
                    t.status === "CANCELLED"
                      ? "text-ink-4 line-through tabular"
                      : t.kind === "INCOME"
                        ? "font-semibold text-ok tabular"
                        : "font-semibold text-ink tabular"
                  }
                >
                  {t.kind === "INCOME" ? "+" : "−"}
                  {euros(t.amountCents)}
                </span>
              ),
            },
            {
              key: "estado",
              header: "Estado",
              align: "right",
              render: (t) =>
                t.source === "fees" ? (
                  <Pill tone="ok">Mensalidade</Pill>
                ) : (
                  <Pill tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Pill>
                ),
            },
            /*
              O que se pode fazer à linha, no fim da linha.

              Estava tudo escondido: editar era um clique na linha que nada
              anunciava, e apagar não existia de todo na interface — o servidor
              já o sabia fazer e ninguém lho pedia. Agora as acções estão onde
              se procuram, com o mesmo peso visual da informação que
              acompanham: cinzentas em repouso, e só a que destrói ganha
              vermelho ao passar por cima.

              Quatro no máximo, e só num previsto. Um movimento já concluído
              mostra dois — corrigir e apagar —, que são os únicos que ainda
              fazem sentido. As mensalidades não mostram nenhum: a verdade
              delas vive noutro ecrã, e prometer aqui uma correcção que este
              módulo não faz seria mentir com um ícone.
            */
            {
              key: "accoes",
              header: "",
              align: "right",
              width: "168px",
              render: (t) => {
                if (!podeEscrever || t.source !== "manual") return null;
                const porConfirmar = t.status === "PLANNED" || t.status === "PENDING";
                const ocupado = aMexer === t.id;

                return (
                  <span className="flex items-center justify-end gap-1">
                    {porConfirmar && (
                      <button
                        type="button"
                        className="ctl-ghost h-7 text-meta text-ok"
                        disabled={ocupado}
                        onClick={(e) => {
                          e.stopPropagation();
                          void mudarEstado(t, "COMPLETED");
                        }}
                        title={t.kind === "INCOME" ? "Marcar como recebida" : "Marcar como paga"}
                      >
                        <Check className="size-3.5" strokeWidth={2} />
                        Confirmar
                      </button>
                    )}

                    <button
                      type="button"
                      className="flex size-7 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-ink"
                      disabled={ocupado}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditar(t);
                      }}
                      aria-label="Editar movimento"
                      title="Editar"
                    >
                      <Pencil className="size-3.5" strokeWidth={1.75} />
                    </button>

                    {/* Cancelar só faz sentido no que ainda não aconteceu: um
                        movimento concluído não se desmarca, corrige-se ou
                        apaga-se. */}
                    {porConfirmar && (
                      <button
                        type="button"
                        className="flex size-7 items-center justify-center rounded-[6px] text-ink-4 hover:bg-warn-soft hover:text-warn"
                        disabled={ocupado}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (t.seriesId) setCancelar(t);
                          else void mudarEstado(t, "CANCELLED");
                        }}
                        aria-label="Cancelar movimento"
                        title="Cancelar — fica no histórico, riscado"
                      >
                        <X className="size-3.5" strokeWidth={1.75} />
                      </button>
                    )}

                    <button
                      type="button"
                      className="flex size-7 items-center justify-center rounded-[6px] text-ink-4 hover:bg-risk-soft hover:text-risk"
                      disabled={ocupado}
                      onClick={(e) => {
                        e.stopPropagation();
                        setApagar(t);
                      }}
                      aria-label="Apagar movimento"
                      title="Apagar — para o que nunca devia ter sido lançado"
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </button>
                  </span>
                );
              },
            },
          ]}
        />
      </Panel>

      {registar && (
        <TransactionDialog
          kind={registar}
          onClose={() => setRegistar(null)}
          onDone={() => {
            setRegistar(null);
            void carregar();
          }}
        />
      )}

      {editar && (
        <TransactionDialog
          transaction={editar}
          onClose={() => setEditar(null)}
          onDone={() => {
            setEditar(null);
            void carregar();
          }}
        />
      )}

      {/*
        Apagar é irreversível, e por isso pergunta-se — mas pergunta-se uma vez
        só e com a saída mais branda à vista. Quem chegou aqui por engano quase
        sempre queria cancelar: dizê-lo no próprio diálogo evita a viagem de
        volta à linha para encontrar o outro ícone.
      */}
      {apagar && (
        <Dialog
          labelledBy="apagar-movimento"
          title="Apagar movimento"
          subtitle={`${apagar.description} · ${apagar.kind === "INCOME" ? "+" : "−"}${euros(apagar.amountCents)}`}
          onClose={() => setApagar(null)}
          width={460}
          footer={
            <button type="button" className="ctl-ghost" onClick={() => setApagar(null)} disabled={Boolean(aMexer)}>
              Voltar
            </button>
          }
        >
          <div className="space-y-2 p-5">
            {/*
              A saída mais branda, e só onde ela existe.

              Num movimento por confirmar, quem chegou aqui quase sempre queria
              cancelar — dizê-lo no próprio diálogo evita a viagem de volta à
              linha para procurar o outro ícone. Num já concluído a sugestão
              não se faz: o dinheiro mexeu-se, e a linha do fim da tabela também
              não oferece cancelar. Uma porta que só existe em metade dos casos
              não pode aparecer nos dois.
            */}
            {apagar.status === "PLANNED" || apagar.status === "PENDING" ? (
              <p className="mb-3 text-body leading-relaxed text-ink-2">
                Apagar não deixa rasto — é para o que nunca devia ter sido lançado. Se o movimento chegou a existir e
                apenas não se concretizou,{" "}
                <button
                  type="button"
                  className="font-medium text-ink underline underline-offset-2"
                  disabled={Boolean(aMexer)}
                  onClick={() => {
                    const alvo = apagar;
                    setApagar(null);
                    if (alvo.seriesId) setCancelar(alvo);
                    else void mudarEstado(alvo, "CANCELLED");
                  }}
                >
                  cancela-o
                </button>{" "}
                — fica no histórico, riscado.
              </p>
            ) : (
              <p className="mb-3 text-body leading-relaxed text-ink-2">
                Apagar não deixa rasto — o movimento sai das contas como se nunca tivesse sido lançado, e o saldo
                acerta-se sozinho. É para o engano, não para o que correu mal.
              </p>
            )}

            {apagar.seriesId ? (
              <>
                <button
                  type="button"
                  className="ctl-outline w-full justify-center text-risk"
                  disabled={Boolean(aMexer)}
                  onClick={() => void apagarMovimento(apagar, "one")}
                >
                  Apagar só {shortDate(new Date(apagar.occurredAt))}
                </button>
                <button
                  type="button"
                  className="ctl-outline w-full justify-center text-risk"
                  disabled={Boolean(aMexer)}
                  onClick={() => void apagarMovimento(apagar, "series")}
                >
                  Apagar este mês e os seguintes
                </button>
              </>
            ) : (
              <button
                type="button"
                className="ctl-outline w-full justify-center text-risk"
                disabled={Boolean(aMexer)}
                onClick={() => void apagarMovimento(apagar)}
              >
                Apagar de vez
              </button>
            )}
          </div>
        </Dialog>
      )}

      {/*
        Cancelar um mês de uma despesa fixa é ambíguo, e adivinhar era mau nos
        dois sentidos: cancelar só um mês quando o contrato acabou deixa onze
        por lá; cancelar tudo quando só este mês não se paga apaga o resto do
        ano. Pergunta-se — são dois cliques, uma vez.
      */}
      {cancelar && (
        <Dialog
          labelledBy="cancelar-serie"
          title="Cancelar movimento fixo"
          subtitle={cancelar.description}
          onClose={() => setCancelar(null)}
          width={460}
          footer={
            <button type="button" className="ctl-ghost" onClick={() => setCancelar(null)} disabled={Boolean(aMexer)}>
              Voltar
            </button>
          }
        >
          <div className="space-y-2 p-5">
            <p className="mb-3 text-body text-ink-2">
              Este movimento repete-se todos os meses. O que já foi pago ou recebido fica como está — cancelar nunca
              apaga o passado.
            </p>
            <button
              type="button"
              className="ctl-outline w-full justify-center"
              disabled={Boolean(aMexer)}
              onClick={() => void mudarEstado(cancelar, "CANCELLED", "one")}
            >
              Cancelar só {shortDate(new Date(cancelar.occurredAt))}
            </button>
            <button
              type="button"
              className="ctl-outline w-full justify-center text-risk"
              disabled={Boolean(aMexer)}
              onClick={() => void mudarEstado(cancelar, "CANCELLED", "series")}
            >
              Cancelar este mês e os seguintes
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
