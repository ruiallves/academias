import { useMemo, useState } from "react";
import { PageHeader } from "@/components/Shell";
import { DataTable, Empty, Metric, MetricRow, Monogram, Panel, Pill, type Column } from "@/components/primitives";
import { ResultCount, SearchInput, Segmented, Toolbar } from "@/components/filters";
import { HeartPulse, Plus, Shield, Users, Whistle } from "@/lib/icons";
import { listStaff, teamById, unrecordedSessions } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { ROLE_LABEL, useSession } from "@/session";
import { DEPARTMENT_LABEL, type StaffDepartment, type StaffMember } from "@/data/types";

type Filter = "todos" | StaffDepartment;

/**
 * Staff — toda a gente que trabalha na academia.
 *
 * Substituiu "Treinadores", que era uma página que só sabia contar quem dá treino.
 * Uma academia tem direção, coordenação, equipa técnica, departamento clínico e
 * secretaria, e todos precisam de conta, contacto e histórico.
 *
 * A tabela mostra as duas coisas lado a lado de propósito: o **cargo** (o que a
 * pessoa faz) e o **acesso** (o que pode fazer no produto). São coisas diferentes
 * — quatro pessoas do departamento clínico partilham o mesmo acesso e têm cargos
 * distintos — e vê-las juntas é o que permite a um diretor perceber, num relance,
 * quem consegue ver o quê.
 */
export default function Staff() {
  const { session } = useSession();
  const [filter, setFilter] = useState<Filter>("todos");
  const [query, setQuery] = useState("");

  const all = listStaff();

  // Registos de presenças em atraso, por pessoa. É a única métrica de staff que
  // interessa a um diretor — e é sobre processo, não sobre desempenho.
  const pending = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of unrecordedSessions(session)) {
      if (!s.coachId) continue;
      map.set(s.coachId, (map.get(s.coachId) ?? 0) + 1);
    }
    return map;
  }, [session]);

  const counts = useMemo(() => {
    const byDept = (d: StaffDepartment) => all.filter((m) => m.department === d).length;
    return {
      todos: all.length,
      direction: byDept("direction"),
      technical: byDept("technical"),
      clinical: byDept("clinical"),
      operations: byDept("operations"),
    };
  }, [all]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const order: StaffDepartment[] = ["direction", "technical", "clinical", "operations"];
    return all
      .filter((m) => (filter === "todos" ? true : m.department === filter))
      .filter((m) => (q ? m.name.toLowerCase().includes(q) || m.title.toLowerCase().includes(q) : true))
      .sort(
        (a, b) => order.indexOf(a.department) - order.indexOf(b.department) || a.name.localeCompare(b.name, "pt"),
      );
  }, [all, filter, query]);

  const columns: Column<StaffMember>[] = [
    {
      key: "name",
      header: "Nome",
      render: (m) => (
        <div className="flex items-center gap-2.5">
          <Monogram name={m.name} />
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{m.name}</div>
            <div className="truncate text-meta text-ink-3">{m.title}</div>
          </div>
        </div>
      ),
    },
    {
      key: "department",
      header: "Departamento",
      hideBelow: "sm",
      render: (m) => <Pill tone={m.department === "clinical" ? "signal" : "neutral"}>{DEPARTMENT_LABEL[m.department]}</Pill>,
    },
    {
      key: "access",
      header: "Acesso",
      hideBelow: "md",
      // O papel de permissões, não o cargo. É o que responde a "quem consegue ver
      // as mensalidades?" sem ter de abrir a matriz em Definições.
      render: (m) => <span className="text-ink-2">{ROLE_LABEL[m.role]}</span>,
    },
    {
      key: "teams",
      header: "Equipas",
      hideBelow: "lg",
      render: (m) =>
        m.teamIds.length === 0 ? (
          <span className="text-meta text-ink-4">toda a academia</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {m.teamIds.map((id) => (
              <Pill key={id}>{teamById(id)?.name}</Pill>
            ))}
          </div>
        ),
    },
    {
      key: "contact",
      header: "Contacto",
      hideBelow: "lg",
      render: (m) => (
        <div className="min-w-0">
          <div className="truncate text-ink-2 tabular">{m.phone}</div>
          <div className="truncate text-meta text-ink-4">{m.email}</div>
        </div>
      ),
    },
    {
      key: "since",
      header: "Desde",
      hideBelow: "md",
      render: (m) => {
        const d = new Date(m.since);
        return (
          <span className="text-ink-3 tabular">
            {shortDate(d)} {d.getFullYear()}
          </span>
        );
      },
    },
    {
      key: "pending",
      header: "Por registar",
      align: "right",
      render: (m) => {
        const n = pending.get(m.id) ?? 0;
        return n > 0 ? <Pill tone="warn">{n}</Pill> : <span className="text-meta text-ink-4">—</span>;
      },
    },
  ];

  return (
    <>
      <PageHeader title="Staff" subtitle={`${all.length} pessoas · época 2026/27`}>
        {can(session, "staff:write") && (
          <button type="button" className="ctl-primary">
            <Plus className="size-3.5" strokeWidth={2} />
            Convidar
          </button>
        )}
      </PageHeader>

      <div className="space-y-3">
        <MetricRow>
          <Metric label="Direção" value={String(counts.direction)} icon={Shield} note="e coordenação" />
          <Metric label="Equipa técnica" value={String(counts.technical)} icon={Whistle} note="treinadores e apoio" />
          <Metric label="Departamento clínico" value={String(counts.clinical)} icon={HeartPulse} note="médico, físio, nutrição" />
          <Metric label="Operações" value={String(counts.operations)} icon={Users} note="secretaria e logística" />
        </MetricRow>

        <Panel>
          <Toolbar>
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: "todos", label: "Todos", count: counts.todos },
                { value: "direction", label: "Direção", count: counts.direction },
                { value: "technical", label: "Técnica", count: counts.technical },
                { value: "clinical", label: "Clínico", count: counts.clinical },
                { value: "operations", label: "Operações", count: counts.operations },
              ]}
            />
            <SearchInput value={query} onChange={setQuery} placeholder="Procurar nome ou cargo…" />
            <ResultCount n={rows.length} noun={["pessoa", "pessoas"]} />
          </Toolbar>

          <DataTable
            columns={columns}
            rows={rows}
            keyOf={(m) => m.id}
            empty={<Empty icon={Users} title="Ninguém neste filtro" />}
          />
        </Panel>
      </div>
    </>
  );
}
