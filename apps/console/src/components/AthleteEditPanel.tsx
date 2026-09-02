import { useState, type FormEvent, type ReactNode } from "react";
import { apiPatch } from "@/lib/http";
import { listTeams, sportById } from "@/lib/api";
import { reloadAcademy } from "@/lib/store";
import type { Athlete } from "@/data/types";
import type { Session } from "@/lib/permissions";
import { dialogInputClass } from "./Dialog";
import { Panel, PanelHead, cx } from "./primitives";

/**
 * Editar a ficha de um atleta — na própria página, não numa janela.
 *
 * ## Porque é que isto não é um diálogo
 *
 * Porque uma ficha de atleta não cabe num. Um diálogo obriga a escolher meia dúzia
 * de campos e a deixar os outros de fora, e a pergunta seguinte é sempre "e a
 * altura, edita-se onde?". Ao ocupar a página, a lista de campos deixa de ser uma
 * negociação de espaço: é simplesmente **tudo o que a ficha mostra**.
 *
 * A página troca de modo em vez de abrir por cima: o cabeçalho do atleta fica no
 * sítio, os separadores dão lugar a Guardar e Cancelar, e ninguém perde a noção de
 * quem está a editar.
 *
 * ## O que continua de fora, e porquê
 *
 * O **clínico**. Lesões, diagnósticos e altas vivem em `ClinicalEntry`, com autor
 * registado e permissão própria (`clinical:write`). O que está aqui é a validade
 * do exame — administrativo: a data, não o que o exame diz.
 */
export function AthleteEditPanel({
  athlete,
  session,
  onDone,
  onCancel,
}: {
  athlete: Athlete;
  session: Session;
  onDone: () => void;
  onCancel: () => void;
}) {
  const teams = listTeams(session);

  const [name, setName] = useState(athlete.name);
  const [birthdate, setBirthdate] = useState(athlete.birthdate.slice(0, 10));
  const [taxId, setTaxId] = useState(athlete.taxId ?? "");
  const [teamId, setTeamId] = useState(athlete.teamId);
  const [position, setPosition] = useState(athlete.position ?? "");
  const [squadNumber, setSquadNumber] = useState(athlete.squadNumber?.toString() ?? "");
  const [heightCm, setHeightCm] = useState(athlete.heightCm?.toString() ?? "");
  const [weightKg, setWeightKg] = useState(athlete.weightKg?.toString() ?? "");
  const [dominantSide, setDominantSide] = useState(sideToApi(athlete.dominantSide));
  const [medicalValidUntil, setMedicalValidUntil] = useState(athlete.medicalValidUntil?.slice(0, 10) ?? "");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const team = teams.find((t) => t.id === teamId);
  const sport = team ? sportById(team.sportId) : undefined;
  const positions = sport?.positions ?? [];

  // O NIF é obrigatório desde que passou a ser a chave do registo da família. Numa
  // ficha antiga pode estar vazio — e é aqui que se corrige, por isso o formulário
  // exige-o para gravar.
  const nifOk = /^\d{9}$/.test(taxId.replace(/\s/g, ""));
  const heightOk = heightCm === "" || (Number(heightCm) >= 50 && Number(heightCm) <= 250);
  const weightOk = weightKg === "" || (Number(weightKg) >= 20 && Number(weightKg) <= 200);
  const valid = name.trim().length >= 2 && birthdate !== "" && teamId !== "" && nifOk && heightOk && weightOk;

  const movedTeam = teamId !== athlete.teamId;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      /*
       * Envia-se tudo o que o formulário mostra, e não só o que mudou.
       *
       * Um `PATCH` parcial calculado no cliente parece mais elegante e é uma fonte
       * de enganos silenciosos: um campo limpo no ecrã que não entra no corpo fica
       * como estava, e quem editou jura que o apagou. Aqui o que se vê é o que fica.
       */
      await apiPatch(`/api/athletes/${athlete.id}`, {
        name: name.trim(),
        birthdate,
        teamId,
        taxId: taxId.replace(/\s/g, ""),
        position: position.trim(),
        ...(squadNumber ? { squadNumber: Number(squadNumber) } : {}),
        ...(heightCm ? { heightCm: Number(heightCm) } : {}),
        // O servidor guarda décimas de kg, para casar com o `Decimal(4,1)`.
        ...(weightKg ? { weightDg: Math.round(Number(weightKg) * 10) } : {}),
        ...(dominantSide ? { dominantSide } : {}),
        ...(medicalValidUntil ? { medicalValidUntil } : {}),
      });
      await reloadAcademy();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {/* A barra de acções fica no topo e colada: numa página comprida, um
          "Guardar" só no fundo obriga a rolar para confirmar o que já se decidiu. */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-2.5">
        <span className="min-w-0 flex-1 text-body text-ink-2">
          A editar a ficha de <strong className="font-medium text-ink">{athlete.name}</strong>
        </span>
        {error && <span className="text-meta text-risk">{error}</span>}
        <button type="button" className="ctl-ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" className="ctl-primary" disabled={!valid || busy}>
          {busy ? "A guardar…" : "Guardar"}
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Identidade" />
          <div className="space-y-3 px-5 py-4">
            <Field label="Nome">
              <input value={name} onChange={(e) => setName(e.target.value)} className={dialogInputClass} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Data de nascimento">
                <input
                  type="date"
                  value={birthdate}
                  onChange={(e) => setBirthdate(e.target.value)}
                  className={dialogInputClass}
                />
              </Field>

              <Field label="NIF" hint="obrigatório">
                <input
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  inputMode="numeric"
                  placeholder="123456789"
                  className={cx(dialogInputClass, !nifOk && taxId !== "" && "border-risk")}
                />
              </Field>
            </div>

            {!nifOk && (
              <p className="text-meta leading-relaxed text-ink-3">
                São nove dígitos. É com o NIF e a data de nascimento que a família se liga a este atleta ao
                instalar a app — sem ele, o link que a academia manda não encontra ninguém.
              </p>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Inscrição" />
          <div className="space-y-3 px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Equipa">
                <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={dialogInputClass}>
                  {/*
                    Um atleta sem equipa — a dele foi apagada — abre aqui sem
                    nada escolhido. Sem esta opção, o browser mostrava a
                    primeira equipa da lista como se já fosse a dele, e o
                    Guardar ficava desactivado sem nada que o explicasse.
                  */}
                  {teamId === "" && <option value="">Sem equipa — escolhe uma</option>}
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Camisola" hint="opcional">
                <input
                  value={squadNumber}
                  onChange={(e) => setSquadNumber(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  inputMode="numeric"
                  className={dialogInputClass}
                />
              </Field>
            </div>

            {/* Sem posições na modalidade (natação), o campo não aparece — em vez
                de aparecer vazio a pedir uma coisa que não existe. */}
            {positions.length > 0 && (
              <Field label="Posição" hint="opcional">
                <select value={position} onChange={(e) => setPosition(e.target.value)} className={dialogInputClass}>
                  <option value="">—</option>
                  {positions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {movedTeam && (
              <p className="rounded-[var(--radius-control)] border border-line bg-sunken/50 px-3 py-2 text-meta leading-relaxed text-ink-2">
                Muda de escalão para <strong className="font-medium text-ink">{team?.name}</strong>. As
                presenças e os jogos já registados ficam como estão — é histórico, e reescrevê-lo seria
                mentir sobre onde este atleta jogou.
              </p>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Ficha física" hint="opcional" />
          <div className="space-y-3 px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Altura" hint="cm">
                <input
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  inputMode="numeric"
                  className={cx(dialogInputClass, !heightOk && "border-risk")}
                />
              </Field>

              <Field label="Peso" hint="kg">
                <input
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value.replace(/[^\d.,]/g, "").replace(",", ".").slice(0, 5))}
                  inputMode="decimal"
                  className={cx(dialogInputClass, !weightOk && "border-risk")}
                />
              </Field>
            </div>

            {/* O rótulo vem da modalidade: "Pé dominante" no futebol, "Mão
                dominante" no basquetebol, e nada na natação. */}
            {sport?.dominantSideLabel && (
              <Field label={sport.dominantSideLabel} hint="opcional">
                <select
                  value={dominantSide}
                  onChange={(e) => setDominantSide(e.target.value)}
                  className={dialogInputClass}
                >
                  <option value="">—</option>
                  <option value="RIGHT">Direito</option>
                  <option value="LEFT">Esquerdo</option>
                  <option value="BOTH">Ambidestro</option>
                </select>
              </Field>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Ficha médica" hint="só a validade do exame" />
          <div className="space-y-3 px-5 py-4">
            <Field label="Exame médico válido até" hint="opcional">
              <input
                type="date"
                value={medicalValidUntil}
                onChange={(e) => setMedicalValidUntil(e.target.value)}
                className={dialogInputClass}
              />
            </Field>

            <p className="text-meta leading-relaxed text-ink-3">
              Lesões, diagnósticos e altas não se editam aqui — vivem no separador <strong className="font-medium text-ink-2">Clínico</strong>,
              onde cada registo fica com o nome de quem o fez. É o que torna um diagnóstico rastreável.
            </p>
          </div>
        </Panel>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-1.5">
        <span className="text-meta font-medium text-ink">{label}</span>
        {hint && <span className="text-[11px] text-ink-4">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/**
 * O lado dominante chega em formas diferentes conforme o caminho que fez — o
 * enum do servidor (`RIGHT`), a versão em minúsculas do store, ou o português da
 * ficha. Normaliza-se aqui em vez de acreditar em qualquer uma delas.
 */
function sideToApi(value: string | undefined): string {
  const v = (value ?? "").toLowerCase();
  if (v.startsWith("r") || v.startsWith("dir")) return "RIGHT";
  if (v.startsWith("l") || v.startsWith("esq")) return "LEFT";
  if (v.startsWith("b") || v.startsWith("amb")) return "BOTH";
  return "";
}
