import { useState } from "react";
import { PageHeader } from "@/components/Shell";
import { Bar, Empty, Metric, MetricRow, Monogram, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { NewAnnouncementDialog } from "@/components/NewAnnouncementDialog";
import { Megaphone, Pencil, Send, Trash2 } from "@/lib/icons";
import { coachById, listAnnouncements, listGuardians, today } from "@/lib/api";
import { apiDelete } from "@/lib/http";
import { reloadAcademy, useStore } from "@/lib/store";
import { percent, relativeDays } from "@/lib/format";
import type { Announcement } from "@/data/types";
import { useSession } from "@/session";

/**
 * Comunicação.
 *
 * A métrica que interessa não é "quantos avisos enviei" — é **quantos foram lidos**.
 * Um aviso com 60% de leitura ainda tem quarenta por cento de pais a perguntar no
 * WhatsApp, que é exactamente o que este produto existe para acabar.
 *
 * O mesmo ecrã serve a direção e o treinador: o que muda é o público que cada um
 * pode escolher ao escrever (`NewAnnouncementDialog`), e a lista já vem no âmbito de
 * quem entra. Não há duas cópias a divergirem.
 */
export default function Comms() {
  const { session } = useSession();
  // Subscrever o store faz a lista redesenhar-se assim que um aviso é publicado.
  useStore();
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);

  // Pode gerir quem escreveu o aviso, ou a direção (sem âmbito de equipa) — o
  // servidor impõe a mesma regra; aqui é só não mostrar botões que dariam 403.
  const canManage = (a: Announcement) =>
    a.authorId === session.staffId || session.scope?.teamIds === undefined;

  const announcements = listAnnouncements();
  const guardians = listGuardians();
  const withApp = guardians.filter((g) => g.appInstalled).length;

  const totalReach = announcements.reduce((n, a) => n + a.reach, 0);
  const totalRead = announcements.reduce((n, a) => n + a.read, 0);

  return (
    <>
      <PageHeader title="Comunicação" subtitle="Avisos enviados às famílias pela app, sem grupos de WhatsApp.">
        <button type="button" className="ctl-primary" onClick={() => setComposing(true)}>
          <Send className="size-3.5" strokeWidth={1.75} />
          Novo aviso
        </button>
      </PageHeader>

      <div className="space-y-3">
        <MetricRow>
          <Metric
            label="Taxa de leitura"
            value={totalReach ? percent(totalRead / totalReach) : "—"}
            icon={Megaphone}
            note={totalReach ? "média dos últimos avisos" : "ainda sem avisos"}
          />
          <Metric label="Avisos publicados" value={String(announcements.length)} note="visíveis para ti" />
          <Metric
            label="Alcance por app"
            value={guardians.length ? percent(withApp / guardians.length) : "—"}
            note={`${withApp} famílias notificáveis`}
          />
          <Metric label="Fora de alcance" value={String(guardians.length - withApp)} note="ainda sem a app" />
        </MetricRow>

        <Panel>
          <PanelHead title="Avisos publicados" hint={`${announcements.length}`} />

          {announcements.length === 0 ? (
            <div>
              <Empty
                icon={Megaphone}
                title="Ainda não há avisos"
                detail="Escreve o primeiro — as famílias recebem-no na app, em vez de num grupo de WhatsApp."
              />
            </div>
          ) : (
            <ul>
              {announcements.map((a) => {
                // O nome vem com o aviso; a lista de staff pode não conter quem
                // publicou (um treinador não tem `staff:read`).
                const authorName = a.authorName ?? coachById(a.authorId)?.name;
                const rate = a.reach ? a.read / a.reach : 0;

                return (
                  <li key={a.id} className="border-b border-line px-5 py-4 last:border-0">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <h3 className="text-panel text-ink">{a.title}</h3>
                      <Pill tone="signal">{a.audience}</Pill>
                      <span className="ml-auto flex items-center gap-1.5">
                        <span className="text-meta text-ink-3">{relativeDays(new Date(a.publishedAt), today)}</span>
                        {canManage(a) && <AnnouncementActions announcement={a} onEdit={() => setEditing(a)} />}
                      </span>
                    </div>

                    <p className="mb-3 max-w-[60ch] whitespace-pre-wrap text-body text-ink-2">{a.body}</p>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      {authorName && (
                        <span className="flex items-center gap-1.5">
                          <Monogram name={authorName} size="sm" />
                          <span className="text-meta text-ink-3">{authorName}</span>
                        </span>
                      )}

                      <span className="flex min-w-[180px] flex-1 items-center gap-2.5">
                        <Bar value={rate} tone={rate >= 0.85 ? "ok" : rate >= 0.6 ? "signal" : "warn"} />
                        <span className="shrink-0 text-meta text-ink-2 tabular">
                          {a.read} de {a.reach} leram
                        </span>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {(composing || editing) && (
        <NewAnnouncementDialog
          session={session}
          editing={editing ?? undefined}
          onClose={() => {
            setComposing(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Editar e eliminar um aviso.
 *
 * Eliminar pede confirmação ali mesmo, sem um diálogo do browser — apagar o que se
 * comunicou não deve ser um clique distraído. Ao eliminar, o servidor apaga também a
 * notificação na app de quem a recebeu (ver `AnnouncementsService.remove`).
 */
function AnnouncementActions({ announcement, onEdit }: { announcement: Announcement; onEdit: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await apiDelete(`/api/announcements/${announcement.id}`);
      await reloadAcademy();
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-1.5 text-meta">
        <span className="text-ink-3">Eliminar?</span>
        <button type="button" onClick={() => void remove()} disabled={busy} className="font-medium text-risk hover:underline">
          {busy ? "A eliminar…" : "Sim"}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="text-ink-3 hover:text-ink">
          Não
        </button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={onEdit}
        title="Editar aviso"
        aria-label="Editar aviso"
        className="flex size-7 items-center justify-center rounded-[6px] text-ink-4 transition-colors duration-[120ms] hover:bg-sunken hover:text-ink-2"
      >
        <Pencil className="size-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title="Eliminar aviso"
        aria-label="Eliminar aviso"
        className={cx(
          "flex size-7 items-center justify-center rounded-[6px] text-ink-4 transition-colors duration-[120ms] hover:bg-risk-soft hover:text-risk",
        )}
      >
        <Trash2 className="size-3.5" strokeWidth={1.75} />
      </button>
    </span>
  );
}
