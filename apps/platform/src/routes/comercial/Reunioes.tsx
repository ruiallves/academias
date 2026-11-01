import { useEffect, useMemo, useState } from "react";
import { MapPin, Phone, Video } from "lucide-react";
import { PageHeader } from "@/components/Shell";
import { Empty, Panel, Pill, cx, type Tone } from "@/components/primitives";
import { Segmented } from "@/components/comercial/ui";
import { ReuniaoDialog } from "@/components/comercial/ReuniaoDialog";
import { Failed, Skeleton } from "../Overview";
import { useApi } from "@/lib/query";
import { diaLegivel, hhmm } from "@/lib/comercial";
import { MEETING_MODE_LABEL, MEETING_STATUS_LABEL, type Me, type MeetingStatus, type SalesMeeting } from "@/lib/types";

type Aba = "proximas" | "fechar" | "historico";

const TOM: Record<MeetingStatus, Tone> = { MARCADA: "signal", REALIZADA: "ok", FALTARAM: "warn", CANCELADA: "neutral" };

/**
 * As reuniões marcadas pelo comercial, como uma agenda.
 *
 * Próximas: o que vem, por dia. Por fechar: as que já passaram e ainda não têm
 * resultado (é o que o dono tem de marcar). Histórico: as fechadas.
 */
export default function Reunioes({ me }: { me: Me }) {
  const { data, loading, error, reload } = useApi<SalesMeeting[]>("/comercial/reunioes");
  const [lista, setLista] = useState<SalesMeeting[] | null>(null);
  const [aberta, setAberta] = useState<SalesMeeting | null>(null);
  const [aba, setAba] = useState<Aba>("proximas");

  useEffect(() => {
    if (data) setLista(data);
  }, [data]);

  const grupos = useMemo(() => {
    const agora = Date.now();
    const todas = lista ?? [];
    const proximas = todas.filter((m) => m.status === "MARCADA" && new Date(m.scheduledAt).getTime() >= agora - 60 * 60_000);
    const fechar = todas.filter((m) => m.status === "MARCADA" && new Date(m.scheduledAt).getTime() < agora - 60 * 60_000);
    const historico = todas.filter((m) => m.status !== "MARCADA").reverse();
    return { proximas, fechar, historico };
  }, [lista]);

  if (loading && !lista) return <Skeleton />;
  if (error && !lista) return <Failed message={error} onRetry={reload} />;

  const linhas = grupos[aba];
  const porDia = new Map<string, SalesMeeting[]>();
  for (const m of linhas) {
    const k = new Date(m.scheduledAt).toDateString();
    porDia.set(k, [...(porDia.get(k) ?? []), m]);
  }

  const gere = me.role === "OWNER" || me.role === "ADMIN";

  return (
    <>
      <PageHeader
        title="Reuniões"
        subtitle={[
          `${grupos.proximas.length} ${grupos.proximas.length === 1 ? "marcada" : "marcadas"}`,
          grupos.fechar.length > 0 ? `${grupos.fechar.length} por fechar` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      <Panel>
        <div className="border-b border-line px-5">
          <Segmented<Aba>
            value={aba}
            onChange={setAba}
            options={[
              { id: "proximas", label: "Próximas", count: grupos.proximas.length },
              { id: "fechar", label: "Por fechar", count: grupos.fechar.length },
              { id: "historico", label: "Histórico", count: grupos.historico.length },
            ]}
          />
        </div>

        {linhas.length === 0 ? (
          <Empty
            title={aba === "proximas" ? "Nenhuma reunião marcada" : aba === "fechar" ? "Nada por fechar" : "Ainda sem histórico"}
            detail={
              aba === "proximas"
                ? "Quando uma chamada acabar em reunião, ela aparece aqui e no calendário."
                : aba === "fechar" && gere
                  ? "Todas as reuniões que já passaram têm resultado."
                  : undefined
            }
          />
        ) : (
          [...porDia.entries()].map(([dia, ms]) => (
            <section key={dia}>
              <h3 className="sticky top-0 z-[1] border-b border-line bg-canvas/95 px-5 py-2 text-meta font-medium text-ink-2 backdrop-blur">
                {diaLegivel(ms[0].scheduledAt)}
              </h3>
              <ul>
                {ms.map((m) => {
                  const Icone = m.mode === "PRESENCIAL" ? MapPin : m.mode === "VIDEOCHAMADA" ? Video : Phone;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setAberta(m)}
                        className="grid w-full cursor-pointer grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-4 border-b border-line px-5 py-3.5 text-left transition-colors duration-150 last:border-b-0 hover:bg-canvas"
                      >
                        <span className="font-mono text-body font-medium text-ink tabular">{hhmm(m.scheduledAt)}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-body font-medium text-ink">{m.contact?.name}</span>
                          <span className="flex items-center gap-1.5 truncate text-[11px] text-ink-3">
                            <Icone className="size-3 shrink-0" strokeWidth={1.75} />
                            {MEETING_MODE_LABEL[m.mode]} · {m.personName}
                            {m.personRole ? `, ${m.personRole.toLowerCase()}` : ""}
                            {m.athletes ? ` · ${m.athletes} atletas` : ""}
                            {gere && m.bookedByName ? ` · marcada por ${m.bookedByName}` : ""}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {m.suggestedPlan && <span className="hidden text-meta text-ink-3 sm:inline">{m.suggestedPlan}</span>}
                          {aba === "fechar" ? (
                            <Pill tone="warn">{gere ? "Marcar resultado" : "À espera do resultado"}</Pill>
                          ) : (
                            m.status !== "MARCADA" && <Pill tone={TOM[m.status]}>{MEETING_STATUS_LABEL[m.status]}</Pill>
                          )}
                          {!m.countsForCommission && m.status !== "CANCELADA" && (
                            <span className={cx("text-[11px] text-ink-4")}>não conta</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </Panel>

      {aberta && (
        <ReuniaoDialog
          reuniao={aberta}
          me={me}
          onClose={() => setAberta(null)}
          onSaved={(r) => setLista((l) => (l ?? []).map((x) => (x.id === r.id ? r : x)))}
        />
      )}
    </>
  );
}
