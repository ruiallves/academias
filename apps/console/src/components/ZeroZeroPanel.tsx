import { useState, type FormEvent } from "react";
import { listTeams, today } from "@/lib/api";
import { relativeDays } from "@/lib/format";
import {
  importAndSync,
  isValidZeroZeroUrl,
  linkTeam,
  unlinkTeam,
  useZeroZeroLinks,
  type TeamLink,
} from "@/lib/zerozero";
import { ExternalLink, Link2, Loader2, RefreshCw, TriangleAlert, Trash2 } from "@/lib/icons";
import type { Session } from "@/lib/permissions";
import { cx, Panel, PanelHead } from "./primitives";

/**
 * Importação de jogos a partir do ZeroZero — um teste de produto, não uma
 * integração de produção.
 *
 * O diretor cola o link da equipa; a app "importa" os jogos (agendados e já
 * disputados, com resultado) para o calendário dessa equipa. O treinador nunca
 * mexe nisto — continua a mexer só na convocatória, no painel do jogo.
 *
 * A nota amarela abaixo do título não é decoração: sem ela, esta peça parece uma
 * ligação real ao ZeroZero, e não é. Ver `lib/zerozero.ts` para a investigação que
 * levou a esta decisão.
 */
export function ZeroZeroPanel({ session }: { session: Session }) {
  const teams = listTeams(session);
  const links = useZeroZeroLinks();

  return (
    <Panel>
      <PanelHead title="Importação de jogos" hint="por escalão, a partir de um link do ZeroZero" />

      <div className="flex items-start gap-2.5 border-b border-line bg-warn-soft px-5 py-3 text-meta text-warn">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
        <p className="max-w-[62ch]">
          <strong className="font-semibold">Simulação.</strong> Não existe ainda ligação real ao
          ZeroZero — não há API pública do lado deles, e antes de recolher os dados a sério é
          preciso resolver o licenciamento. Isto serve para validar o fluxo: colar o link, ver os
          jogos a aparecer, deixar a convocatória para o treinador.
        </p>
      </div>

      <ul>
        {teams.map((t) => (
          <TeamRow key={t.id} teamId={t.id} teamName={t.name} link={links[t.id]} />
        ))}
      </ul>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function TeamRow({ teamId, teamName, link }: { teamId: string; teamName: string; link?: TeamLink }) {
  const [editing, setEditing] = useState(!link);
  const [url, setUrl] = useState(link?.url ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runImport(id: string) {
    setBusy(true);
    setError(null);
    try {
      await importAndSync(id);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!isValidZeroZeroUrl(url)) {
      setError("Cola um link de equipa do ZeroZero, algo como zerozero.pt/equipa/nome/1234");
      return;
    }
    linkTeam(teamId, url);
    void runImport(teamId);
  }

  return (
    <li className="border-b border-line px-5 py-3 last:border-0">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">{teamName}</span>

        {!editing && link && (
          <span className="flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={() => void runImport(teamId)} disabled={busy} className="ctl-ghost h-7 text-meta">
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
              ) : (
                <RefreshCw className="size-3.5" strokeWidth={1.75} />
              )}
              Reimportar
            </button>
            <button type="button" onClick={() => setEditing(true)} className="ctl-ghost h-7 text-meta text-ink-3">
              Trocar link
            </button>
            <button
              type="button"
              onClick={() => unlinkTeam(teamId)}
              className="flex size-7 items-center justify-center rounded-[6px] text-ink-4 hover:bg-risk-soft hover:text-risk"
              aria-label={`Desligar ${teamName} do ZeroZero`}
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </button>
          </span>
        )}

        {!editing && !link && (
          <button type="button" onClick={() => setEditing(true)} className="ctl-outline h-7 shrink-0 text-meta">
            <Link2 className="size-3.5" strokeWidth={1.75} />
            Ligar ao ZeroZero
          </button>
        )}
      </div>

      {!editing && link && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-0 text-meta text-ink-3">
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 truncate text-ink-3 hover:text-ink hover:underline"
          >
            <ExternalLink className="size-3 shrink-0" strokeWidth={1.75} />
            <span className="max-w-[280px] truncate">{link.url}</span>
          </a>
          {link.lastImportedAt && (
            <span>
              {link.lastImportedCount} jogos · importado {relativeDays(link.lastImportedAt, today)}
            </span>
          )}
        </div>
      )}

      {editing && (
        <form onSubmit={submit} className="mt-2 flex items-center gap-1.5">
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.zerozero.pt/equipa/…"
            className="h-8 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 font-mono text-meta text-ink placeholder:font-sans placeholder:text-ink-4 focus:border-line-strong focus:outline-none"
          />
          <button type="submit" disabled={busy} className="ctl-primary h-8">
            {busy ? <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} /> : "Importar"}
          </button>
          {link && (
            <button
              type="button"
              onClick={() => {
                setUrl(link.url);
                setError(null);
                setEditing(false);
              }}
              className="ctl-ghost h-8"
            >
              Cancelar
            </button>
          )}
        </form>
      )}

      {error && <p className={cx("mt-1.5 text-meta text-risk")}>{error}</p>}
    </li>
  );
}
