import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Empty, Panel, PanelHead, Pill, cx, type Tone } from "@/components/primitives";
import { LegalDocumentDialog } from "@/components/LegalDocumentDialog";
import { Failed, Skeleton } from "./Overview";
import { useApi } from "@/lib/query";
import { shortDate } from "@/lib/format";
import {
  CONTEXT_LABEL,
  STATUS_LABEL,
  deleteDocument,
  nextVersion,
  publishDocument,
  retireDocument,
  type LegalAcceptanceRow,
  type LegalStats,
  type LegalStatus,
  type LegalTypeGroup,
  type LegalVersion,
} from "@/lib/legal";
import type { Me } from "@/lib/types";

/**
 * Os documentos legais — versões, publicação e quem já aceitou.
 *
 * ## O que esta página responde
 *
 *  1. **Que versão está em vigor de cada documento**, e que rascunhos há.
 *  2. **Quem falta aceitar** — para os documentos de clube, a lista dos clubes
 *     cujo responsável ainda não aceitou a versão em vigor. É o estado "por
 *     aceitar" de que fala a migração: derivado, não guardado.
 *  3. **O registo** das aceitações mais recentes, com IP e dispositivo.
 *
 * Não é um CMS jurídico. É o suficiente para publicar uma versão nova sem um
 * deploy e para responder a "o clube X aceitou a v2.0? quando? quem?".
 *
 * Publicar e retirar é só de `OWNER` — o servidor recusa o resto, e aqui o botão
 * não aparece a quem não é dono, para não abrir uma porta que só diz "não".
 */
const TONE: Record<LegalStatus, Tone> = { DRAFT: "neutral", PUBLISHED: "ok", RETIRED: "warn" };

export default function Legal({ me }: { me: Me }) {
  const groups = useApi<LegalTypeGroup[]>("/legal/documents");
  const stats = useApi<LegalStats>("/legal/stats");
  const recent = useApi<LegalAcceptanceRow[]>("/legal/acceptances?limit=40");
  const [open, setOpen] = useState<{ group: LegalTypeGroup; id: string | null; from: string | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const canWrite = me.role === "OWNER" || me.role === "ADMIN";
  const canPublish = me.role === "OWNER";

  const reloadAll = () => {
    groups.reload();
    stats.reload();
    recent.reload();
  };

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setErro(null);
    try {
      await fn();
      reloadAll();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setBusyId(null);
    }
  };

  if (groups.loading && !groups.data) return <Skeleton />;
  if (groups.error && !groups.data) return <Failed message={groups.error} onRetry={groups.reload} />;
  const data = groups.data ?? [];

  return (
    <>
      <PageHeader
        title="Documentos legais"
        subtitle="Termos, políticas e o acordo de tratamento de dados — por versão, com quem já aceitou."
      />

      {erro && <p className="mb-4 text-meta text-risk">{erro}</p>}

      <Acceptance stats={stats.data} />

      <div className="mt-6 space-y-5">
        {data.map((g) => {
          const current = g.versions.find((v) => v.isCurrent);
          const latest = g.versions[0];
          return (
            <Panel key={g.type}>
              <PanelHead title={g.label} hint={current ? `Em vigor: v${current.version} desde ${shortDate(current.effectiveAt)}` : "Sem versão em vigor"}>
                {canWrite && (
                  <button
                    type="button"
                    className="ctl-outline"
                    onClick={() =>
                      setOpen({ group: g, id: null, from: current?.id ?? latest?.id ?? null })
                    }
                  >
                    Nova versão
                  </button>
                )}
              </PanelHead>
              <p className="border-b border-line px-5 py-2.5 text-meta text-ink-3">{g.hint}</p>
              {g.versions.length === 0 ? (
                <Empty title="Ainda sem versões" detail="Cria a primeira como rascunho, revê, e publica quando estiver pronta." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-body">
                    <thead className="text-meta text-ink-3">
                      <tr className="border-b border-line">
                        <th className="px-5 py-2 text-left font-medium">Versão</th>
                        <th className="px-5 py-2 text-left font-medium">Estado</th>
                        <th className="px-5 py-2 text-left font-medium">Em vigor desde</th>
                        <th className="px-5 py-2 text-left font-medium">Aceitações</th>
                        <th className="px-5 py-2 text-left font-medium">Nota</th>
                        <th className="px-5 py-2 text-right font-medium">Acções</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.versions.map((v) => (
                        <VersionRow
                          key={v.id}
                          v={v}
                          slug={g.slug}
                          busy={busyId === v.id}
                          canWrite={canWrite}
                          canPublish={canPublish}
                          onOpen={() => setOpen({ group: g, id: v.id, from: null })}
                          onPublish={() => {
                            if (!window.confirm(`Publicar a v${v.version} de ${g.label}? Quem ainda não a aceitou vê o gate na próxima entrada.`)) return;
                            void act(v.id, () => publishDocument(v.id));
                          }}
                          onRetire={() => {
                            if (!window.confirm(`Retirar a v${v.version}? As aceitações ficam; a versão publicada anterior volta a valer.`)) return;
                            void act(v.id, () => retireDocument(v.id));
                          }}
                          onDelete={() => {
                            if (!window.confirm(`Apagar o rascunho v${v.version}?`)) return;
                            void act(v.id, () => deleteDocument(v.id));
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          );
        })}
      </div>

      <Recent rows={recent.data} />

      {open && (
        <LegalDocumentDialog
          group={open.group}
          id={open.id}
          from={open.from}
          suggestedVersion={nextVersion(open.group.versions[0]?.version)}
          canWrite={canWrite}
          onClose={() => setOpen(null)}
          onSaved={reloadAll}
        />
      )}
    </>
  );
}

function VersionRow({
  v,
  slug,
  busy,
  canWrite,
  canPublish,
  onOpen,
  onPublish,
  onRetire,
  onDelete,
}: {
  v: LegalVersion;
  slug: string;
  busy: boolean;
  canWrite: boolean;
  canPublish: boolean;
  onOpen: () => void;
  onPublish: () => void;
  onRetire: () => void;
  onDelete: () => void;
}) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-5 py-2.5">
        <button type="button" onClick={onOpen} className="font-medium text-ink underline-offset-2 hover:underline">
          v{v.version}
        </button>
        <span className="ml-2 text-meta text-ink-3">{v.title}</span>
      </td>
      <td className="px-5 py-2.5">
        <Pill tone={TONE[v.status]}>{v.isCurrent ? "Em vigor" : STATUS_LABEL[v.status]}</Pill>
      </td>
      <td className="px-5 py-2.5 tabular-nums text-ink-2">{v.status === "DRAFT" ? "—" : shortDate(v.effectiveAt)}</td>
      <td className="px-5 py-2.5 tabular-nums text-ink-2">{v.acceptances}</td>
      <td className="max-w-[260px] truncate px-5 py-2.5 text-meta text-ink-3">{v.changeNote ?? ""}</td>
      <td className="px-5 py-2.5">
        <div className="flex justify-end gap-1">
          {v.status !== "DRAFT" && (
            <a
              href={`${SITE}/legal/${slug}/${v.version}`}
              target="_blank"
              rel="noreferrer"
              className="ctl-ghost"
            >
              Ver no site
            </a>
          )}
          {v.status === "DRAFT" && canWrite && (
            <button type="button" className="ctl-ghost" onClick={onOpen} disabled={busy}>
              Editar
            </button>
          )}
          {v.status === "DRAFT" && canPublish && (
            <button type="button" className="ctl-primary" onClick={onPublish} disabled={busy}>
              Publicar
            </button>
          )}
          {v.status === "PUBLISHED" && canPublish && (
            <button type="button" className="ctl-ghost" onClick={onRetire} disabled={busy}>
              Retirar
            </button>
          )}
          {v.status === "DRAFT" && canWrite && (
            <button type="button" className="ctl-ghost text-risk" onClick={onDelete} disabled={busy}>
              Apagar
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/** Quem já aceitou o quê — e, para os documentos de clube, quem falta. */
function Acceptance({ stats }: { stats: LegalStats | undefined }) {
  const [aberto, setAberto] = useState<string | null>(null);
  if (!stats) return null;
  const docs = stats.documents;
  if (docs.length === 0) {
    return (
      <Panel>
        <Empty title="Nenhum documento em vigor" detail="Enquanto não houver uma versão publicada, ninguém é obrigado a aceitar nada." />
      </Panel>
    );
  }
  return (
    <Panel>
      <PanelHead title="Aceitação das versões em vigor" hint={`${stats.academies} academias activas`} />
      <ul className="divide-y divide-line">
        {docs.map((d) => {
          const doClube = d.scope === "CLUB";
          const pendentes = d.pendingAcademies.length;
          return (
            <li key={d.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-body font-medium text-ink">
                    {d.title} <span className="text-ink-3">v{d.version}</span>
                  </p>
                  <p className="text-meta text-ink-3">
                    {d.acceptanceKind === "NONE"
                      ? "Só se publica — sem aceitação."
                      : doClube
                        ? `${d.accepted} de ${d.total} clubes aceitaram · ${pendentes} por aceitar`
                        : `${d.accepted} pessoas aceitaram`}
                  </p>
                </div>
                {doClube && pendentes > 0 && (
                  <button type="button" className="ctl-ghost" onClick={() => setAberto(aberto === d.id ? null : d.id)}>
                    {aberto === d.id ? "Esconder" : "Ver quem falta"}
                  </button>
                )}
              </div>
              {aberto === d.id && (
                <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  {d.pendingAcademies.map((a) => (
                    <li key={a.id} className="text-meta">
                      <Link to={`/academias/${a.id}`} className="text-ink-2 underline-offset-2 hover:text-ink hover:underline">
                        {a.name}
                      </Link>
                      <span className="ml-1.5 text-ink-4">{a.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Recent({ rows }: { rows: LegalAcceptanceRow[] | undefined }) {
  if (!rows || rows.length === 0) return null;
  return (
    <Panel className="mt-6">
      <PanelHead title="Aceitações recentes" hint="as últimas 40, com dispositivo" />
      <div className="overflow-x-auto">
        <table className="w-full text-body">
          <thead className="text-meta text-ink-3">
            <tr className="border-b border-line">
              <th className="px-5 py-2 text-left font-medium">Quando</th>
              <th className="px-5 py-2 text-left font-medium">Quem</th>
              <th className="px-5 py-2 text-left font-medium">Clube</th>
              <th className="px-5 py-2 text-left font-medium">Documento</th>
              <th className="px-5 py-2 text-left font-medium">Contexto</th>
              <th className="px-5 py-2 text-left font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="whitespace-nowrap px-5 py-2 tabular-nums text-ink-2">{shortDate(r.acceptedAt)}</td>
                <td className="px-5 py-2">
                  <span className="text-ink">{r.user.name}</span>
                  <span className="ml-1.5 text-meta text-ink-3">{r.user.email}</span>
                </td>
                <td className="px-5 py-2 text-ink-2">{r.academy?.name ?? "—"}</td>
                <td className="px-5 py-2 text-ink-2">
                  {r.label} v{r.version}
                  {r.onBehalfOfClub && <span className={cx("ml-1.5 text-meta text-ink-3")}>· pelo clube</span>}
                </td>
                <td className="px-5 py-2 text-meta text-ink-3">{CONTEXT_LABEL[r.context]}</td>
                <td className="px-5 py-2 font-mono text-[11.5px] text-ink-3" title={r.userAgent ?? ""}>
                  {r.ip ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const SITE =
  (import.meta.env.VITE_SITE_URL as string | undefined) ?? (import.meta.env.DEV ? "http://localhost:5190" : "https://academias.pt");
