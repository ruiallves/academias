import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { DataTable, Empty, Loading, Panel, Pill, SelectField } from "@/components/primitives";
import { TransactionDialog } from "@/components/finance/TransactionDialog";
import { Dialog } from "@/components/Dialog";
import { ArrowLeft, Check, Download, Minus, Plus, Repeat, Search, TriangleAlert, Wallet, X } from "@/lib/icons";
import { shortDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { useActiveCatalog } from "@/lib/catalogs";
import {
  METHOD_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
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
            <button type="button" className="ctl-outline" onClick={() => setRegistar("EXPENSE")}>
              <Minus className="size-3.5" strokeWidth={2} />
              Despesa
            </button>
            <button type="button" className="ctl-primary" onClick={() => setRegistar("INCOME")}>
              <Plus className="size-3.5" strokeWidth={2} />
              Receita
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
            {
              key: "accoes",
              header: "",
              align: "right",
              render: (t) =>
                podeEscrever && t.source === "manual" && (t.status === "PLANNED" || t.status === "PENDING") ? (
                  <span className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      className="ctl-ghost h-7 text-meta text-ok"
                      disabled={aMexer === t.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void mudarEstado(t, "COMPLETED");
                      }}
                      title={t.kind === "INCOME" ? "Marcar como recebida" : "Marcar como paga"}
                    >
                      <Check className="size-3.5" strokeWidth={2} />
                      Confirmar
                    </button>
                    <button
                      type="button"
                      className="flex size-7 items-center justify-center rounded-[6px] text-ink-4 hover:bg-risk-soft hover:text-risk"
                      disabled={aMexer === t.id}
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
                  </span>
                ) : null,
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
