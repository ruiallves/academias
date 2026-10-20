import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { type Column, cx, DataTable, Empty, Panel, Pill } from "@/components/primitives";
import { ResultCount, Segmented, Toolbar } from "@/components/filters";
import { EyeOff, ShieldAlert } from "@/lib/icons";
import { useApi } from "@/lib/query";
import { relativeDays, shortDate } from "@/lib/format";
import { ESTADOS, tomDoEstado, type Denuncia, type EstadoDaDenuncia } from "@/lib/conduta";

/**
 * As denúncias: o que as famílias enviaram pelo canal de denúncia da app.
 *
 * ## Quem chega aqui
 *
 * Só quem tem `conduct:read`: por omissão a presidência e a direção. Não há
 * âmbito de equipa de propósito: um caso pode ser sobre um treinador, e o
 * treinador não o pode ver. A direção dá o acesso a mais alguém no painel de
 * Acesso, de propósito.
 *
 * ## O que a lista diz
 *
 * O número do caso, o tipo, quem (ou "anónima"), o educando quando foi
 * indicado, quem está a tratar e há quanto tempo chegou. O ponto à esquerda é
 * o que ainda não foi aberto ou tem mensagem nova da família: é o que diz
 * "olha para este".
 */

const FILTROS: { value: EstadoDaDenuncia | "abertas" | "todas"; label: string }[] = [
  { value: "abertas", label: "Abertas" },
  { value: "NEW", label: "Novas" },
  { value: "IN_REVIEW", label: "Em análise" },
  { value: "RESOLVED", label: "Resolvidas" },
  { value: "ARCHIVED", label: "Arquivadas" },
  { value: "todas", label: "Todas" },
];

export default function Denuncias() {
  const { data, loading, error } = useApi<Denuncia[]>("/api/denuncias");
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]["value"]>("abertas");
  const todas = data ?? [];

  const contagem = (f: (typeof FILTROS)[number]["value"]) =>
    todas.filter((d) => (f === "todas" ? true : f === "abertas" ? d.status === "NEW" || d.status === "IN_REVIEW" : d.status === f)).length;

  const visiveis = useMemo(() => {
    const lista = todas.filter((d) =>
      filtro === "todas" ? true : filtro === "abertas" ? d.status === "NEW" || d.status === "IN_REVIEW" : d.status === filtro,
    );
    // As por ler primeiro, depois as novas, e dentro de cada grupo as mais recentes.
    const peso = (d: Denuncia) => (d.unread ? 0 : d.status === "NEW" ? 1 : d.status === "IN_REVIEW" ? 2 : 3);
    return lista.sort((a, b) => peso(a) - peso(b) || b.createdAt.localeCompare(a.createdAt));
  }, [todas, filtro]);

  const columns: Column<Denuncia>[] = [
    {
      key: "caso",
      header: "Caso",
      render: (d) => (
        <div className="flex items-center gap-3">
          {/* O ponto do "por ler": a única coisa que grita nesta lista. */}
          <span aria-label={d.unread ? "Por ler" : undefined} className={cx("size-2 shrink-0 rounded-full", d.unread ? "bg-signal" : "bg-transparent")} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-meta tabular text-ink-4">#{d.number}</span>
              <span className={cx("truncate text-body text-ink", d.unread && "font-semibold")}>{d.categoryLabel}</span>
            </div>
            <div className="truncate text-meta text-ink-3">{resumo(d.description)}</div>
          </div>
        </div>
      ),
    },
    {
      key: "quem",
      header: "Quem",
      hideBelow: "sm",
      render: (d) =>
        d.anonymous ? (
          <span className="inline-flex items-center gap-1.5 text-meta text-ink-3">
            <EyeOff className="size-3.5" strokeWidth={1.75} />
            Anónima
          </span>
        ) : (
          <div className="leading-tight">
            <div className="text-body text-ink-2">{d.reporter?.name ?? "Conta removida"}</div>
            {d.athlete && <div className="text-meta text-ink-3">sobre {d.athlete.name}</div>}
          </div>
        ),
    },
    {
      key: "responsavel",
      header: "A tratar",
      hideBelow: "lg",
      render: (d) => (d.assignee ? <span className="text-ink-2">{d.assignee.name}</span> : <span className="text-ink-4">—</span>),
    },
    {
      key: "estado",
      header: "Estado",
      render: (d) => <Pill tone={tomDoEstado(d.status)}>{d.statusLabel}</Pill>,
    },
    {
      key: "quando",
      header: "Chegou",
      align: "right",
      hideBelow: "sm",
      render: (d) => (
        <span className="text-ink-3" title={shortDate(new Date(d.createdAt))}>
          {relativeDays(new Date(d.createdAt), new Date())}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Canal de denúncia"
        title="Denúncias"
        subtitle="O que as famílias e os atletas reportam pela app. Só quem tem acesso às denúncias vê esta página."
      >
        <Link to="/definicoes?secao=conduta" className="ctl-outline">
          Documentos de conduta
        </Link>
      </PageHeader>

      <Panel>
        <Toolbar>
          <Segmented
            value={filtro}
            onChange={setFiltro}
            label="Estado das denúncias"
            options={FILTROS.map((f) => ({ value: f.value, label: f.label, count: contagem(f.value) }))}
          />
          <ResultCount n={visiveis.length} noun={["denúncia", "denúncias"]} />
        </Toolbar>

        {error ? (
          <p className="px-5 py-8 text-center text-meta text-ink-3">{error}</p>
        ) : loading && !data ? null : (
          <DataTable
            columns={columns}
            rows={visiveis}
            keyOf={(d) => d.id}
            to={(d) => `/denuncias/${d.id}`}
            empty={
              todas.length === 0 ? (
                <Empty
                  icon={ShieldAlert}
                  title="Ainda sem denúncias"
                  detail="As famílias e os atletas encontram o canal de denúncia no perfil da app do clube. O que enviarem aparece aqui, e só a quem tem acesso às denúncias."
                />
              ) : (
                <Empty icon={ShieldAlert} tone="ok" title="Nada neste estado" compact />
              )
            }
          />
        )}
      </Panel>

      <p className="mt-4 max-w-[70ch] text-meta leading-relaxed text-ink-4">
        {ESTADOS.map((e) => `${e.label}: ${e.hint}`).join(" · ")}.
      </p>
    </>
  );
}

function resumo(texto: string): string {
  const linha = texto.replace(/\s+/g, " ").trim();
  return linha.length > 90 ? `${linha.slice(0, 87)}…` : linha;
}
