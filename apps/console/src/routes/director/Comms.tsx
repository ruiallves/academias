import { PageHeader } from "@/components/Shell";
import { Bar, Metric, MetricRow, Monogram, Panel, PanelHead, Pill } from "@/components/primitives";
import { Megaphone, Send } from "@/lib/icons";
import { coachById, listAnnouncements, listGuardians, today } from "@/lib/api";
import { percent, relativeDays } from "@/lib/format";

/**
 * Comunicação.
 *
 * A métrica que interessa não é "quantos avisos enviei" — é **quantos foram lidos**.
 * Um aviso com 60% de leitura ainda tem quarenta por cento de pais a perguntar no
 * WhatsApp, que é exactamente o que este produto existe para acabar.
 */
export default function Comms() {
  const announcements = listAnnouncements();
  const guardians = listGuardians();
  const withApp = guardians.filter((g) => g.appInstalled).length;

  const totalReach = announcements.reduce((n, a) => n + a.reach, 0);
  const totalRead = announcements.reduce((n, a) => n + a.read, 0);

  return (
    <>
      <PageHeader title="Comunicação" subtitle="Avisos enviados às famílias pela app, sem grupos de WhatsApp.">
        <button type="button" className="ctl-primary">
          <Send className="size-3.5" strokeWidth={1.75} />
          Novo aviso
        </button>
      </PageHeader>

      <div className="space-y-3">
        <MetricRow>
          <Metric label="Taxa de leitura" value={percent(totalRead / totalReach)} icon={Megaphone} note="média dos últimos avisos" />
          <Metric label="Avisos este mês" value={String(announcements.length)} note="publicados" />
          <Metric label="Alcance por app" value={percent(withApp / guardians.length)} note={`${withApp} famílias notificáveis`} />
          <Metric label="Fora de alcance" value={String(guardians.length - withApp)} note="ainda sem a app" />
        </MetricRow>

        <Panel>
          <PanelHead title="Avisos publicados" hint={`${announcements.length}`} />

          <ul>
            {announcements.map((a) => {
              const author = coachById(a.authorId);
              const rate = a.read / a.reach;

              return (
                <li key={a.id} className="border-b border-line px-5 py-4 last:border-0">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <h3 className="text-panel text-ink">{a.title}</h3>
                    <Pill tone="signal">{a.audience}</Pill>
                    <span className="ml-auto text-meta text-ink-3">{relativeDays(new Date(a.publishedAt), today)}</span>
                  </div>

                  <p className="mb-3 max-w-[60ch] text-body text-ink-2">{a.body}</p>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {author && (
                      <span className="flex items-center gap-1.5">
                        <Monogram name={author.name} size="sm" />
                        <span className="text-meta text-ink-3">{author.name}</span>
                      </span>
                    )}

                    <span className="flex min-w-[180px] flex-1 items-center gap-2.5">
                      <Bar value={rate} tone={rate >= 0.85 ? "ok" : rate >= 0.6 ? "signal" : "warn"} />
                      <span className="shrink-0 text-meta text-ink-2 tabular">
                        {a.read} de {a.reach} leram
                      </span>
                    </span>

                    {rate < 0.85 && (
                      <button type="button" className="ctl-outline">
                        Relembrar {a.reach - a.read}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </>
  );
}
