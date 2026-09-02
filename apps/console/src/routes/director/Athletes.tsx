import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { NewAthleteDialog } from "@/components/NewAthleteDialog";
import { ImportAthletesDialog } from "@/components/ImportAthletesDialog";
import { AvailabilityTag, cx, DataTable, Empty, Monogram, Panel, Pill, type Column } from "@/components/primitives";
import { BulkBar, BulkDeleteDialog } from "@/components/BulkDelete";
import { apiDelete } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import { ResultCount, SearchInput, Segmented, Select, Toolbar } from "@/components/filters";
import { Plus, Upload, Users } from "@/lib/icons";
import { academy, currentPeriod, guardiansOf, listAthletes, listFees, listTeams, semEquipa, today } from "@/lib/api";
import { age, shortDate, shortName } from "@/lib/format";
import type { Athlete } from "@/data/types";
import { availabilityOf, useClinicalRecords } from "@/lib/clinical";
import { medicalExpiry, medicalState } from "@/lib/medical";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";

export default function Athletes() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState("all");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  // Redesenha quando o departamento clínico mexe numa baixa.
  useClinicalRecords();

  /*
   * Dois filtros, e não um.
   *
   * Isto era um controlo só, com "Todos · Ficha médica · De baixa · Em pausa ·
   * Saíram" na mesma fila. Mistura duas perguntas que não se excluem: **quem é
   * que ainda está no clube** e **o que é que precisa de atenção**. Como
   * partilhavam o mesmo botão, escolher "Ficha médica" descartava o estado — e
   * não havia como fazer a pergunta que a direção faz de facto: *dos atletas
   * activos, quais têm a ficha médica por regularizar?* Um atleta que saiu em
   * Setembro aparecia na conta e mandava tratar de um exame de quem já não treina.
   *
   * Separadas, cruzam-se: o estado manda na lista, o sinal afina-a por cima.
   */
  const estado = params.get("filtro") ?? "activos";
  const sinal = params.get("sinal") ?? "todos";

  /*
   * "Activos" por omissão.
   *
   * Abrir na lista completa punha à frente pessoas que já não treinam — e num
   * clube com alguns anos essas são a maioria das linhas. Quem abre "Atletas"
   * quer o plantel de hoje; o resto continua a um clique e continua a ter
   * endereço próprio, porque é o estado por omissão que sai do URL, não o
   * escolhido.
   */
  const setParam = (chave: "filtro" | "sinal", v: string, omissao: string) => {
    const next = new URLSearchParams(params);
    if (v === omissao) next.delete(chave);
    else next.set(chave, v);
    setParams(next);
  };

  const athletes = listAthletes(session);
  const teams = listTeams(session);
  const fees = listFees(session, currentPeriod);
  const feeByAthlete = useMemo(() => new Map(fees.map((f) => [f.athleteId, f])), [fees]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return athletes
      .filter((a) => (team === "all" ? true : team === "none" ? semEquipa(a) : a.teamId === team))
      .filter((a) => {
        if (estado === "activos") return a.status === "active";
        if (estado === "pausa") return a.status === "paused";
        if (estado === "saiu") return a.status === "left";
        return true;
      })
      .filter((a) => {
        if (sinal === "medico") return medicalState(a) !== "ok";
        if (sinal === "baixa") return availabilityOf(a.id) !== "available";
        return true;
      })
      .filter((a) => (q ? a.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, "pt"));
  }, [athletes, team, estado, sinal, query]);

  /*
   * As contagens do estado respeitam o sinal escolhido, e não o contrário.
   *
   * Com "Ficha médica" ligado, "Activos 12" quer dizer doze activos com a ficha
   * por tratar — que é o número que interessa nesse momento. O contrário
   * — contar sempre tudo — punha na etiqueta um número que a lista por baixo não
   * mostrava.
   */
  const noSinal = useMemo(
    () =>
      athletes.filter((a) => {
        if (sinal === "medico") return medicalState(a) !== "ok";
        if (sinal === "baixa") return availabilityOf(a.id) !== "available";
        return true;
      }),
    [athletes, sinal],
  );

  // O mesmo ecrã serve o diretor e o treinador — o que muda é o âmbito dos dados
  // (aplicado em listAthletes) e as colunas que as permissões deixam ver.
  const showBilling = can(session, "billing:read");
  const podeApagar = can(session, "athlete:write");
  /*
   * A selecção múltipla.
   *
   * Vive na página e não na tabela: é a página que sabe o que fazer com as
   * linhas escolhidas. A tabela só sabe desenhar as caixas — ver `DataTable`.
   */
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [aApagar, setAApagar] = useState(false);

  const showGuardian = can(session, "family:read");

  const allColumns: Column<Athlete>[] = [
    {
      key: "name",
      header: "Atleta",
      render: (a) => {
        /*
         * Quem saiu não pode ler-se como quem ficou.
         *
         * A lista mistura os dois — "Todos" mostra tudo — e sem marca nenhuma um
         * atleta que já não treina aqui aparece igual aos outros, com a mesma
         * disponibilidade clínica ao lado. É a mesma correcção que a ficha levou:
         * o estado tem de ser visível onde o nome é visível.
         */
        const saiu = a.status === "left";
        return (
          <div className="flex items-center gap-2.5">
            <div className={saiu ? "opacity-55 grayscale" : undefined}>
              <Monogram name={a.name} photoUrl={a.photoUrl} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={cx("truncate font-medium", saiu ? "text-ink-3" : "text-ink")}>
                  {shortName(a.name)}
                </span>
                {saiu ? <Pill tone="risk">Saiu</Pill> : <AvailabilityTag availability={availabilityOf(a.id)} size="sm" />}
              </div>
              <div className="text-meta text-ink-3 tabular">{age(new Date(a.birthdate), today)} anos</div>
            </div>
          </div>
        );
      },
    },
    {
      key: "team",
      header: "Equipa",
      // Sem equipa diz-se, não se deixa em branco: uma célula vazia lê-se como
      // um erro de carregamento, e este atleta precisa mesmo que reparem nele.
      render: (a) =>
        semEquipa(a) ? (
          <Pill tone="warn">Sem equipa</Pill>
        ) : (
          <span className="text-ink-2">{teams.find((t) => t.id === a.teamId)?.name}</span>
        ),
    },
    {
      key: "position",
      header: "Posição",
      hideBelow: "lg",
      // Natação não tem posições. A célula fica com um travessão em vez de uma
      // coluna vazia — a UI adapta-se por ausência, não por `if (desporto === …)`.
      render: (a) => <span className="text-ink-3">{a.position ?? "—"}</span>,
    },
    {
      key: "guardian",
      header: "Encarregado",
      hideBelow: "md",
      render: (a) => {
        const g = guardiansOf(a.id)[0];
        if (!g) return <span className="text-ink-4">—</span>;
        return (
          <div className="min-w-0">
            <div className="truncate text-ink-2">{shortName(g.name)}</div>
            <div className="text-meta text-ink-4">{g.appInstalled ? "app instalada" : "sem app"}</div>
          </div>
        );
      },
    },
    {
      key: "medical",
      header: "Ficha médica",
      hideBelow: "sm",
      render: (a) => {
        const state = medicalState(a);
        // Sem exame é um estado, não um vazio: é o que separa "válido até
        // Março" de "nunca fez" na leitura de quem passa os olhos pela lista.
        if (state === "missing") return <Pill tone="neutral">Sem ficha</Pill>;

        const d = medicalExpiry(a)!;
        if (state === "expired") return <Pill tone="risk">Expirada</Pill>;
        if (state === "soon") return <Pill tone="warn">Até {shortDate(d)}</Pill>;
        return <span className="text-meta text-ink-3 tabular">Até {shortDate(d)}</span>;
      },
    },
    {
      key: "fee",
      header: "Agosto",
      align: "right",
      render: (a) => {
        const fee = feeByAthlete.get(a.id);
        if (!fee) return <span className="text-ink-4">—</span>;
        const tone = { paid: "ok", processing: "signal", pending: "warn", overdue: "risk", void: "neutral" } as const;
        const label = { paid: "Pago", processing: "A confirmar", pending: "Não pago", overdue: "Vencido", void: "Anulada" };
        return <Pill tone={tone[fee.status]}>{label[fee.status]}</Pill>;
      },
    },
  ];

  const columns = allColumns.filter((c) => {
    if (c.key === "fee") return showBilling;
    if (c.key === "guardian") return showGuardian;
    return true;
  });

  return (
    <>
      <PageHeader
        title="Atletas"
        subtitle={
          can(session, "athlete:write")
            ? `${athletes.length} inscritos em ${teams.length} equipas`
            : `${athletes.length} atletas nas tuas ${teams.length} equipas`
        }
      >
        {can(session, "athlete:write") && (
          <>
            <button type="button" onClick={() => setImporting(true)} className="ctl-outline">
              <Upload className="size-3.5" strokeWidth={1.75} />
              Importar Excel
            </button>
            <button type="button" onClick={() => setCreating(true)} className="ctl-primary">
              <Plus className="size-3.5" strokeWidth={2} />
              Novo atleta
            </button>
          </>
        )}
      </PageHeader>

      <Panel>
        <Toolbar>
          <Segmented
            value={estado}
            onChange={(v) => setParam("filtro", v, "activos")}
            options={[
              { value: "todos", label: "Todos", count: noSinal.length },
              { value: "activos", label: "Activos", count: noSinal.filter((a) => a.status === "active").length },
              { value: "pausa", label: "Em pausa", count: noSinal.filter((a) => a.status === "paused").length },
              { value: "saiu", label: "Saíram", count: noSinal.filter((a) => a.status === "left").length },
            ]}
          />

          {/*
            O sinal, separado do estado.

            Fica num `Select` e não numa segunda fila de botões porque não é a
            pergunta principal: quase sempre está em "Todos", e ocupar mais uma
            linha do cabeçalho com duas opções que raramente se tocam era pagar
            espaço permanente por um gesto ocasional.
          */}
          <Select
            label="Sinalizados"
            value={sinal}
            onChange={(v) => setParam("sinal", v, "todos")}
            options={[
              { value: "todos", label: "Sem filtro" },
              { value: "medico", label: "Ficha médica por tratar" },
              { value: "baixa", label: "De baixa" },
            ]}
          />

          <Select
            label="Equipa"
            value={team}
            onChange={setTeam}
            options={[
              { value: "all", label: "Todas as equipas" },
              ...academy.sports.flatMap((s) =>
                teams.filter((t) => t.sportId === s.id).map((t) => ({ value: t.id, label: t.name })),
              ),
              // Só aparece quando há algum — e quando há, é uma coisa por
              // resolver: alguém ficou sem escalão (a equipa dele foi apagada)
              // e não treina em lado nenhum até ser recolocado.
              ...(athletes.some(semEquipa) ? [{ value: "none", label: "Sem equipa" }] : []),
            ]}
          />

          <SearchInput value={query} onChange={setQuery} placeholder="Procurar atleta…" />
          <ResultCount n={rows.length} noun={["atleta", "atletas"]} />
        </Toolbar>

        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(a) => a.id}
          to={(a) => `/atletas/${a.id}`}
          selection={
            podeApagar ? { selected: escolhidos, onChange: setEscolhidos } : undefined
          }
          empty={
            <Empty
              icon={Users}
              title="Nenhum atleta corresponde"
              detail="Experimenta limpar os filtros ou procurar por outro nome."
            />
          }
        />
      </Panel>

      <BulkBar
        count={escolhidos.size}
        noun={["atleta", "atletas"]}
        onClear={() => setEscolhidos(new Set())}
        onDelete={() => setAApagar(true)}
      />

      {aApagar && (
        <BulkDeleteDialog
          noun={["atleta", "atletas"]}
          targets={rows.filter((a) => escolhidos.has(a.id)).map((a) => ({ id: a.id, name: a.name }))}
          remove={(id) => apiDelete(`/api/athletes/${id}`)}
          onClose={() => setAApagar(false)}
          onDone={async () => {
            setEscolhidos(new Set());
            await reloadAcademy();
          }}
        />
      )}

      {creating && <NewAthleteDialog session={session} onClose={() => setCreating(false)} />}
      {importing && <ImportAthletesDialog onClose={() => setImporting(false)} />}
    </>
  );
}

