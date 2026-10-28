import { useMemo, useRef, useState, type FormEvent } from "react";
import { apiPatch, apiPost } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import { listAthletes, listGuardians, listTeams } from "@/lib/api";
import { guessMaxAge, teamAgeLabel } from "@/lib/team-age";
import { can, type Session } from "@/lib/permissions";
import { FileText, Upload, X } from "@/lib/icons";
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

type Audience = "all" | "guardians" | "athletes" | "coaches" | "members";

const AUDIENCE_META: { value: Audience; label: string; hint: string }[] = [
  { value: "all", label: "Geral", hint: "toda a academia" },
  { value: "guardians", label: "Pais", hint: "encarregados de educação" },
  { value: "athletes", label: "Atletas", hint: "os atletas com conta na app" },
  { value: "coaches", label: "Treinadores", hint: "equipa técnica" },
  { value: "members", label: "Sócios", hint: "quem tem a app recebe aviso" },
];

/**
 * Falar aos sócios exige **ver** os sócios.
 *
 * `comms:write` diz que a pessoa comunica em nome do clube; não diz que a massa
 * associativa lhe diz respeito. Um director desportivo escreve às famílias e à
 * equipa técnica todos os dias e pode não ter nada que ver com os sócios — e um
 * aviso aos sócios é uma comunicação institucional.
 *
 * O servidor recusa na mesma (ver `AnnouncementsService.create`); isto é só não
 * oferecer o botão que ia dar 403.
 */
const publicosDe = (session: Session) =>
  AUDIENCE_META.filter((a) => a.value !== "members" || can(session, "member:read"));

/** O que o servidor aceita (`DOC_TIPOS`). O `accept` é uma ajuda; quem decide é ele. */
const ACEITA =
  "image/jpeg,image/png,image/webp,application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_ANEXOS = 10;

type Anexo = { key: string; name: string };

/**
 * Carrega um anexo: o servidor autoriza a chave, o ficheiro vai direto do browser
 * para o armazenamento, e o aviso só aponta para ele ao publicar.
 */
async function carregarAnexo(file: File): Promise<Anexo> {
  const a = await apiPost<{ url: string; headers?: Record<string, string>; key: string; maxBytes: number }>(
    "/api/announcements/anexos/upload",
    { contentType: file.type },
  );
  if (file.size > a.maxBytes) throw new Error(`«${file.name}» tem mais de ${Math.round(a.maxBytes / 1024 / 1024)} MB`);
  const r = await fetch(a.url, { method: "PUT", headers: { "Content-Type": file.type, ...(a.headers ?? {}) }, body: file });
  if (!r.ok) throw new Error(`Não foi possível carregar «${file.name}»`);
  return { key: a.key, name: file.name };
}

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
  /** Os anexos já carregados. Ao editar, começa com os que o aviso tem. */
  const [anexos, setAnexos] = useState<Anexo[]>(() => (editing?.files ?? []).map((f) => ({ key: f.key, name: f.name })));
  /** Os nomes dos que estão a subir agora. */
  const [aCarregar, setACarregar] = useState<string[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const totalAnexos = anexos.length + aCarregar.length;

  async function escolherAnexos(lista: File[]) {
    const files = lista.slice(0, Math.max(0, MAX_ANEXOS - totalAnexos));
    if (files.length === 0) return;
    setError(null);
    setACarregar((xs) => [...xs, ...files.map((f) => f.name)]);
    for (const file of files) {
      try {
        const a = await carregarAnexo(file);
        setAnexos((xs) => [...xs, a]);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Não foi possível carregar «${file.name}»`);
      } finally {
        setACarregar((xs) => {
          const i = xs.indexOf(file.name);
          return i < 0 ? xs : [...xs.slice(0, i), ...xs.slice(i + 1)];
        });
      }
    }
  }

  /*
   * O treinador escolhe entre os pais e os atletas das suas equipas — os dois
   * públicos que vivem numa equipa. O resto é da direcção.
   */
  const porEscalao = audience === "guardians" || audience === "athletes";
  const publicos = mayChooseAudience
    ? publicosDe(session)
    : AUDIENCE_META.filter((a) => a.value === "guardians" || a.value === "athletes");
  const teams = listTeams(session);
  const mayPickTeams = !isEditing && porEscalao && teams.length > 0;

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
    const visados = athletes.filter((a) => !recorte || a.equipas.some((e) => recorte.has(e.teamId)));
    // Aos atletas só chega quem tem conta na app — é o que o servidor conta também.
    if (audience === "athletes") return visados.filter((a) => a.app === "account").length;
    const alvo = new Set(visados.map((a) => a.id));
    return guardians.filter((g) => g.athleteIds.some((id) => alvo.has(id))).length;
  }, [athletes, guardians, teamIds, audience]);

  const valid = title.trim().length >= 2 && body.trim().length >= 1 && aCarregar.length === 0;

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
        // A lista inteira: o que se tirou daqui sai do aviso.
        await apiPatch(`/api/announcements/${editing.id}`, { title: title.trim(), body: body.trim(), files: anexos });
      } else {
        await apiPost("/api/announcements", {
          title: title.trim(),
          body: body.trim(),
          audience,
          ...(anexos.length > 0 ? { files: anexos } : {}),
          // Só quando há recorte, e só quando o recorte se aplica: mandar
          // `teamIds` com "Treinadores" é um pedido que o servidor recusa.
          ...(porEscalao && teamIds.length > 0 ? { teamIds } : {}),
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
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {publicos.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => setAudience(a.value)}
                  aria-pressed={audience === a.value}
                  className={cx(
                    "flex flex-col items-start rounded-[var(--radius-control)] border px-3 py-2 text-left transition-colors duration-[120ms]",
                    audience === a.value
                      ? "border-signal-line bg-signal-soft"
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
              {audience === "athletes"
                ? teamIds.length === 0
                  ? `Vai para os atletas de todos os escalões — ${reach} ${reach === 1 ? "com conta na app" : "com conta na app"}.`
                  : `Só os atletas ${teamIds.length === 1 ? "deste escalão" : "destes escalões"} — ${reach} ${reach === 1 ? "com conta na app" : "com conta na app"}.`
                : teamIds.length === 0
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

        {/*
          Os anexos. Não vão num `DialogField`: o rótulo dele é um <label>, e
          nada que se carrega pode viver dentro de um.
        */}
        <div>
          <p className="mb-1.5 text-meta font-medium text-ink-2">Anexos</p>
          {totalAnexos > 0 && (
            <ul className="mb-2 overflow-hidden rounded-[var(--radius-control)] border border-line">
              {anexos.map((f) => (
                <li key={f.key} className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-0">
                  <FileText className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate text-meta text-ink">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => setAnexos((xs) => xs.filter((x) => x.key !== f.key))}
                    disabled={busy}
                    aria-label={`Tirar ${f.name}`}
                    className="shrink-0 rounded p-1 text-ink-4 hover:bg-sunken hover:text-ink disabled:opacity-50"
                  >
                    <X className="size-3.5" strokeWidth={2} />
                  </button>
                </li>
              ))}
              {aCarregar.map((nome, i) => (
                <li key={`${nome}-${i}`} className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-0">
                  <FileText className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate text-meta text-ink-3">{nome}</span>
                  <span className="shrink-0 text-[11px] text-ink-4">a carregar…</span>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={picker}
            type="file"
            multiple
            accept={ACEITA}
            className="hidden"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              // Copiar antes de limpar: a `FileList` fica vazia com `value = ""`.
              const escolhidos = Array.from(e.target.files ?? []);
              e.target.value = "";
              void escolherAnexos(escolhidos);
            }}
          />
          <button
            type="button"
            onClick={() => picker.current?.click()}
            disabled={busy || totalAnexos >= MAX_ANEXOS}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-dashed border-line-strong text-meta font-medium text-ink-3 transition-colors duration-[120ms] hover:border-ink-3 hover:text-ink disabled:opacity-50"
          >
            <Upload className="size-4" strokeWidth={1.75} />
            Juntar PDF, fotografias ou documentos
          </button>
          <p className="mt-1.5 text-[11px] text-ink-4">
            Imagens (JPEG, PNG, WebP), PDF ou Word, até 50 MB cada e {MAX_ANEXOS} por aviso. Quem recebe o aviso abre-os na app.
          </p>
        </div>

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
          ? "border-signal-line bg-signal-soft text-signal-ink"
          : "border-line text-ink-2 hover:border-line-strong hover:bg-sunken",
      )}
    >
      <span className="font-medium">{label}</span>
      {hint && <span className={cx("text-[11px]", selected ? "text-signal-ink/70" : "text-ink-4")}>{hint}</span>}
    </button>
  );
}
