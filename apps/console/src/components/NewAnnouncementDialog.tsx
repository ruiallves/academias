import { useMemo, useState, type FormEvent } from "react";
import { apiPatch, apiPost } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import { listAthletes, listGuardians, listTeams } from "@/lib/api";
import { guessMaxAge, teamAgeLabel } from "@/lib/team-age";
import type { Session } from "@/lib/permissions";
import type { Announcement } from "@/data/types";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { cx } from "./primitives";

/**
 * Novo aviso.
 *
 * ## Quem escolhe o público
 *
 * A direção decide para quem vai: **Geral**, **Pais** ou **Treinadores**. O
 * treinador não escolhe — fala só com os pais das suas equipas, e por isso o
 * selector nem lhe aparece. A condição é a mesma do servidor (`teamScopeFilter`):
 * quem não tem `scope.teamIds` vê a academia toda; quem tem, vê só o seu âmbito.
 * A interface não é a fronteira — o servidor recusa qualquer público a mais —, mas
 * também não oferece o que depois vai ser negado.
 *
 * ## O escalão
 *
 * "Pais" abre a escolha dos escalões. Sem escolha nenhuma vai a todos — que é o
 * que "Geral" já era para as famílias; com escolha, só aos pais dessas equipas.
 * O treinador tem a mesma escolha, sobre as equipas dele: quem treina três
 * escalões não quer avisar os três porque um deles muda de campo.
 *
 * A escolha vive **dentro** do público e não como um quarto botão ao lado de
 * "Geral": o público diz *que tipo de gente*, o escalão diz *quais*. Misturá-los
 * numa lista só dava um selector onde "Treinadores" e "Sub-19" pareciam a mesma
 * pergunta.
 */

type Audience = "all" | "guardians" | "coaches";

const AUDIENCE_META: { value: Audience; label: string; hint: string }[] = [
  { value: "all", label: "Geral", hint: "toda a academia" },
  { value: "guardians", label: "Pais", hint: "encarregados de educação" },
  { value: "coaches", label: "Treinadores", hint: "equipa técnica" },
];

export function NewAnnouncementDialog({
  session,
  editing,
  onClose,
}: {
  session: Session;
  /** Presente = a editar um aviso já publicado; ausente = a escrever um novo. */
  editing?: Announcement;
  onClose: () => void;
}) {
  const isEditing = editing !== undefined;

  // Sem âmbito de equipa = vê a academia toda e escolhe o público. Com âmbito
  // (treinador) = só os pais das suas equipas, sem escolha. Ao editar, o público
  // não muda — quem recebeu, recebeu —, por isso o selector nem aparece.
  const mayChooseAudience = !isEditing && session.scope?.teamIds === undefined;

  const [audience, setAudience] = useState<Audience>(mayChooseAudience ? "all" : "guardians");
  /** Vazio = todos os escalões de quem envia. Ver o cabeçalho. */
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teams = listTeams(session);
  const mayPickTeams = !isEditing && audience === "guardians" && teams.length > 0;

  /*
   * Quantas famílias isto vai acordar.
   *
   * Escrever "só para o Sub-19" e não saber se são oito famílias ou oitenta é
   * escrever às escuras. A conta é a mesma do servidor — os encarregados dos
   * atletas destes escalões —, feita sobre o plantel que já está carregado.
   */
  const guardians = listGuardians();
  const athletes = listAthletes(session);
  const reach = useMemo(() => {
    const recorte = teamIds.length > 0 ? new Set(teamIds) : null;
    const alvo = new Set(athletes.filter((a) => !recorte || recorte.has(a.teamId)).map((a) => a.id));
    return guardians.filter((g) => g.athleteIds.some((id) => alvo.has(id))).length;
  }, [athletes, guardians, teamIds]);

  const valid = title.trim().length >= 2 && body.trim().length >= 1;

  function toggleTeam(id: string) {
    setTeamIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (isEditing) {
        await apiPatch(`/api/announcements/${editing.id}`, { title: title.trim(), body: body.trim() });
      } else {
        await apiPost("/api/announcements", {
          title: title.trim(),
          body: body.trim(),
          audience,
          // Só quando há recorte, e só quando o recorte se aplica: mandar
          // `teamIds` com "Treinadores" é um pedido que o servidor recusa.
          ...(audience === "guardians" && teamIds.length > 0 ? { teamIds } : {}),
        });
      }
      await reloadAcademy();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar o aviso.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="novo-aviso"
      title={isEditing ? "Editar aviso" : "Novo aviso"}
      subtitle={
        isEditing
          ? "Corrige a mensagem — muda na app de quem a recebeu. A notificação já enviada ao telemóvel não se altera."
          : "As famílias são avisadas na app, sem grupos de WhatsApp."
      }
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" form="form-novo-aviso" className="ctl-primary" disabled={!valid || busy}>
            {busy ? "A guardar…" : isEditing ? "Guardar alterações" : "Publicar e avisar"}
          </button>
        </>
      }
    >
      <form id="form-novo-aviso" onSubmit={submit} className="space-y-4 p-5">
        <DialogField label="Para quem">
          {isEditing ? (
            <p className="rounded-[var(--radius-control)] border border-dashed border-line bg-sunken/50 px-3 py-2.5 text-meta text-ink-3">
              Foi enviado para <strong className="font-medium text-ink">{editing.audience}</strong> — o público
              não muda ao editar.
            </p>
          ) : mayChooseAudience ? (
            <div className="grid grid-cols-3 gap-1.5">
              {AUDIENCE_META.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => setAudience(a.value)}
                  aria-pressed={audience === a.value}
                  className={cx(
                    "flex flex-col items-start rounded-[var(--radius-control)] border px-3 py-2 text-left transition-colors duration-[120ms]",
                    audience === a.value
                      ? "border-signal bg-signal-soft"
                      : "border-line hover:border-line-strong hover:bg-sunken",
                  )}
                >
                  <span className={cx("text-body font-medium", audience === a.value ? "text-signal-ink" : "text-ink")}>
                    {a.label}
                  </span>
                  <span className="text-[11px] text-ink-3">{a.hint}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-[var(--radius-control)] border border-dashed border-line bg-sunken/50 px-3 py-2.5 text-meta text-ink-3">
              Vai para os <strong className="font-medium text-ink">pais dos teus atletas</strong> — os
              encarregados das tuas equipas.
            </p>
          )}
        </DialogField>

        {/*
          O recorte por escalão. Só aparece com "Pais": um escalão não estreita um
          aviso à equipa técnica, e o servidor recusa a combinação.
        */}
        {mayPickTeams && (
          <DialogField label="Escalões">
            <div className="flex flex-wrap gap-1.5">
              <TeamChip label="Todos" selected={teamIds.length === 0} onClick={() => setTeamIds([])} />
              {teams.map((t) => (
                <TeamChip
                  key={t.id}
                  // O nome da equipa já costuma trazer o escalão ("Sub-19
                  // Futebol"); repeti-lo ao lado dava "Sub-19 Futebol Sub-19".
                  // Só as equipas que não o dizem ganham a etiqueta.
                  label={t.name}
                  hint={guessMaxAge(t.name) === null ? teamAgeLabel(t.maxAge) : undefined}
                  selected={teamIds.includes(t.id)}
                  onClick={() => toggleTeam(t.id)}
                />
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              {teamIds.length === 0
                ? `Vai para os pais de todos os escalões — ${reach} ${reach === 1 ? "família" : "famílias"}.`
                : `Só os pais ${teamIds.length === 1 ? "deste escalão" : "destes escalões"} — ${reach} ${reach === 1 ? "família" : "famílias"}.`}
            </p>
          </DialogField>
        )}

        <DialogField label="Título">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="ex.: Treino de sábado muda de hora"
            maxLength={120}
            className={dialogInputClass}
            required
            autoFocus
          />
        </DialogField>

        <DialogField label="Mensagem">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Escreve o aviso. As famílias recebem-no na app."
            maxLength={2000}
            rows={5}
            className={cx(dialogInputClass, "resize-none py-2 leading-relaxed")}
            required
          />
        </DialogField>

        {error && (
          <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{error}</p>
        )}
      </form>
    </Dialog>
  );
}

/**
 * Um escalão, ligado ou desligado.
 *
 * Botões e não caixas de selecção: são poucos, cabem numa linha ou duas, e
 * escolher "só o Sub-19" tem de custar um toque. A lista com scroll do convite
 * existe porque lá se atribuem equipas uma a uma; aqui recorta-se um envio.
 */
function TeamChip({
  label,
  hint,
  selected,
  onClick,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        "flex items-baseline gap-1.5 rounded-full border px-3 py-1.5 text-meta transition-colors duration-[120ms]",
        selected
          ? "border-signal bg-signal-soft text-signal-ink"
          : "border-line text-ink-2 hover:border-line-strong hover:bg-sunken",
      )}
    >
      <span className="font-medium">{label}</span>
      {hint && <span className={cx("text-[11px]", selected ? "text-signal-ink/70" : "text-ink-4")}>{hint}</span>}
    </button>
  );
}
