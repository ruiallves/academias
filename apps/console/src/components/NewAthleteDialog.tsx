import { useState, type FormEvent } from "react";
import { listTeams, sportById } from "@/lib/api";
import { apiPost } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import type { Session } from "@/lib/permissions";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { SelectField } from "./primitives";

/**
 * Criar atleta.
 *
 * O atleta é gravado na base de dados através de `POST /api/athletes` — o servidor
 * valida tudo e aplica o âmbito. A ficha nasce sem encarregado: um encarregado é
 * uma conta (para receber avisos e mensalidades na app), e liga-se pelo fluxo de
 * **Famílias**, com convite. Criá-lo aqui seria criar uma conta sem consentimento.
 *
 * A posição só aparece se a modalidade da equipa tiver posições — natação não tem,
 * e o formulário não finge que tem.
 */
export function NewAthleteDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const teams = listTeams(session);

  const [name, setName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [taxId, setTaxId] = useState("");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [position, setPosition] = useState("");
  const [squadNumber, setSquadNumber] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const team = teams.find((t) => t.id === teamId);
  const positions = team ? sportById(team.sportId)?.positions ?? [] : [];
  // O NIF é obrigatório: sem ele, nenhuma família consegue reclamar este atleta na
  // app, e a academia só dá por isso quando o pai telefona. Nove dígitos, e meio
  // escritos não servem — ficam na base e nunca batem certo com o que ele escreve.
  const nifOk = /^\d{9}$/.test(taxId.replace(/\s/g, ""));
  const valid = name.trim().length >= 2 && birthdate !== "" && teamId !== "" && nifOk;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/athletes", {
        name: name.trim(),
        birthdate,
        teamId,
        taxId: taxId.replace(/\s/g, ""),
        ...(position ? { position } : {}),
        ...(squadNumber ? { squadNumber: Number(squadNumber) } : {}),
      });
      await reloadAcademy();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível inscrever.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="novo-atleta"
      title="Novo atleta"
      subtitle={team?.name}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" form="form-novo-atleta" className="ctl-primary" disabled={!valid || busy || teams.length === 0}>
            {busy ? "A inscrever…" : "Inscrever"}
          </button>
        </>
      }
    >
      {teams.length === 0 ? (
        <p className="px-5 py-8 text-meta text-ink-3">
          Ainda não há equipas. Cria uma equipa primeiro — um atleta precisa de um escalão.
        </p>
      ) : (
        <form id="form-novo-atleta" onSubmit={submit} className="space-y-4 p-5">
          <DialogField label="Nome completo">
            <input value={name} onChange={(e) => setName(e.target.value)} className={dialogInputClass} required autoFocus />
          </DialogField>

          {/*
            A ficha médica saiu daqui.
            Inscrever um atleta e ter o exame dele são dois momentos diferentes,
            e o segundo vem quase sempre depois — o miúdo aparece ao treino, faz
            a inscrição, e o exame chega semanas mais tarde. Pedi-la aqui punha
            no ecrã de inscrição um campo que ninguém tem para preencher.
            Preenche-se na ficha do atleta, no separador Clínico, que é onde o
            departamento trabalha. Ver `AthleteEditPanel`.
          */}
          <DialogField label="Data de nascimento">
            <input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} className={dialogInputClass} required />
          </DialogField>

          {/*
            O NIF não é burocracia: é a chave com que a família se liga a este
            atleta ao instalar a app — NIF mais data de nascimento, os dois. Sem
            ele, este atleta existe mas nenhum pai o consegue reclamar.
          */}
          <DialogField label="NIF" hint="obrigatório — é o que liga a família à app">
            <input
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              inputMode="numeric"
              maxLength={11}
              placeholder="123456789"
              className={dialogInputClass}
              aria-invalid={!nifOk}
            />
            {!nifOk && <p className="mt-1 text-[11px] text-[#a82a20]">O NIF tem nove dígitos.</p>}
          </DialogField>

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <DialogField label="Equipa">
              <SelectField
                className="w-full"
                value={teamId}
                onChange={(v) => { setTeamId(v); setPosition(""); }}
                options={teams.map((t) => ({ value: t.id, label: t.name }))}
              />
            </DialogField>
            <DialogField label="Número" hint="opcional">
              <input
                type="number"
                min={0}
                max={999}
                value={squadNumber}
                onChange={(e) => setSquadNumber(e.target.value)}
                className={dialogInputClass}
                style={{ width: 90 }}
              />
            </DialogField>
          </div>

          {positions.length > 0 && (
            <DialogField label="Posição" hint="opcional">
              <SelectField
                className="w-full"
                value={position}
                onChange={setPosition}
                options={[{ value: "", label: "—" }, ...positions.map((p) => ({ value: p, label: p }))]}
              />
            </DialogField>
          )}

          <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta leading-relaxed text-ink-3">
            O encarregado de educação liga-se em <strong className="font-medium text-ink-2">Famílias</strong>, com
            convite para a app — é lá que recebe avisos e mensalidades.
          </p>

          {error && (
            <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{error}</p>
          )}
        </form>
      )}
    </Dialog>
  );
}
