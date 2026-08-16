import { useState, type FormEvent } from "react";
import { listTeams, sportById } from "@/lib/api";
import { createAthlete } from "@/lib/roster";
import type { Guardian } from "@/data/types";
import type { Session } from "@/lib/permissions";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { SelectField } from "./primitives";

const RELATIONS: Guardian["relation"][] = ["Mãe", "Pai", "Encarregado"];

/**
 * Criar atleta.
 *
 * Um atleta nasce sempre com um encarregado — não existe ficha sem alguém a quem
 * a academia possa telefonar. Por agora o encarregado é sempre novo (não há ainda
 * um fluxo de "ligar a um encarregado já existente", p. ex. um segundo educando da
 * mesma família); é a peça que falta antes disto poder liderar com irmãos.
 *
 * A posição só aparece se a modalidade da equipa tiver posições — natação não tem,
 * e o formulário não finge que tem.
 */
export function NewAthleteDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const teams = listTeams(session);

  const [name, setName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [position, setPosition] = useState("");
  const [medicalValidUntil, setMedicalValidUntil] = useState("");

  const [guardianName, setGuardianName] = useState("");
  const [relation, setRelation] = useState<Guardian["relation"]>("Encarregado");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const team = teams.find((t) => t.id === teamId);
  const positions = team ? sportById(team.sportId)?.positions ?? [] : [];

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!teamId) return;

    createAthlete({
      name: name.trim(),
      birthdate,
      teamId,
      position: position || undefined,
      medicalValidUntil: medicalValidUntil || undefined,
      guardian: { name: guardianName.trim(), relation, email: email.trim(), phone: phone.trim() },
    });
    onClose();
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
          <button type="submit" form="form-novo-atleta" className="ctl-primary" disabled={teams.length === 0}>
            Inscrever
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
          <div className="grid grid-cols-2 gap-3">
            <DialogField label="Nome completo" className="col-span-2">
              <input value={name} onChange={(e) => setName(e.target.value)} className={dialogInputClass} required />
            </DialogField>

            <DialogField label="Data de nascimento">
              <input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} className={dialogInputClass} required />
            </DialogField>

            <DialogField label="Ficha médica válida até">
              <input
                type="date"
                value={medicalValidUntil}
                onChange={(e) => setMedicalValidUntil(e.target.value)}
                className={dialogInputClass}
                required
              />
            </DialogField>
          </div>

          <div className={positions.length > 0 ? "grid grid-cols-2 gap-3" : ""}>
            <DialogField label="Equipa">
              <SelectField
                className="w-full"
                value={teamId}
                onChange={(v) => { setTeamId(v); setPosition(""); }}
                options={teams.map((t) => ({ value: t.id, label: t.name }))}
              />
            </DialogField>

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
          </div>

          <div className="border-t border-line pt-4">
            <p className="mb-3 text-meta font-medium text-ink">Encarregado de educação</p>

            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <DialogField label="Nome">
                  <input value={guardianName} onChange={(e) => setGuardianName(e.target.value)} className={dialogInputClass} required />
                </DialogField>
                <DialogField label="Relação">
                  <SelectField
                    value={relation}
                    onChange={(v) => setRelation(v as Guardian["relation"])}
                    options={RELATIONS.map((r) => ({ value: r, label: r }))}
                  />
                </DialogField>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <DialogField label="Telemóvel">
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="9XX XXX XXX"
                    className={dialogInputClass}
                    required
                  />
                </DialogField>
                <DialogField label="E-mail">
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={dialogInputClass} required />
                </DialogField>
              </div>
            </div>
          </div>
        </form>
      )}
    </Dialog>
  );
}
