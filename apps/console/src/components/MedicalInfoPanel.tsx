import { useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { cx, Panel, PanelHead } from "./primitives";
import { HeartPulse, Pencil } from "@/lib/icons";
import { apiPut } from "@/lib/http";
import { useApi } from "@/lib/query";
import { longDate } from "@/lib/format";
import { can, type Session } from "@/lib/permissions";
import type { Athlete } from "@/data/types";

/**
 * A informação médica do atleta — o painel do topo do separador clínico.
 *
 * ## O que é, e o que não é
 *
 * Grupo sanguíneo, alergias, medicação e observações: o que não muda de semana
 * para semana e que alguém tem de saber **antes** de acontecer alguma coisa — o
 * treinador que leva a equipa a um torneio, o fisioterapeuta que o vê pela
 * primeira vez. Não é o boletim: o boletim é o que aconteceu (lesões,
 * consultas), com datas. Isto é o que o atleta é.
 *
 * ## Ao lado, e não em cima
 *
 * Começou por ser um painel à largura toda no topo do separador, com quatro
 * caixas grandes. Ficava a empurrar o boletim para baixo e parecia posto ali
 * sem ter que ver com o resto: quatro campos quase sempre curtos a ocupar o
 * sítio de maior destaque da página.
 *
 * É informação de **consulta**, e o lugar dela é a coluna do lado: um cartão
 * estreito que acompanha o boletim enquanto se percorre, como a ficha de um
 * doente ao lado do processo. Só mostra o que está preenchido; o que falta
 * resume-se numa linha. Um cartão por preencher é uma frase e um botão.
 *
 * ## Quem vê
 *
 * Quem tem `clinical:read` e o atleta ao seu alcance. Escreve quem tem
 * `clinical:write`. O servidor decide as duas coisas (`athlete-ficha.service`)
 * e diz em `editable` se há botão.
 */

type MedicalInfo = {
  bloodType: string | null;
  allergies: string | null;
  medication: string | null;
  notes: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
  editable: boolean;
};

const GRUPOS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export function MedicalInfoPanel({ athlete, session }: { athlete: Athlete; session: Session }) {
  const mayRead = can(session, "clinical:read");
  const { data, reload } = useApi<MedicalInfo>(mayRead ? `/api/athletes/${athlete.id}/info-medica` : null);
  const [editing, setEditing] = useState(false);

  if (!mayRead || !data) return null;

  const campos: [string, string | null][] = [
    ["Alergias", data.allergies],
    ["Medicação", data.medication],
    ["Observações", data.notes],
  ];
  const preenchidos = campos.filter(([, v]) => v);
  const emFalta = [
    ...(data.bloodType ? [] : ["grupo sanguíneo"]),
    ...campos.filter(([, v]) => !v).map(([k]) => k.toLowerCase()),
  ];
  const vazio = !data.bloodType && preenchidos.length === 0;

  return (
    <Panel>
      <PanelHead title="Informação médica">
        {data.editable && !vazio && (
          <button
            type="button"
            className="ctl-ghost size-8 justify-center px-0 text-ink-3 hover:text-ink"
            onClick={() => setEditing(true)}
            aria-label="Editar a informação médica"
            title="Editar"
          >
            <Pencil className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
      </PanelHead>

      {vazio ? (
        <div className="px-5 py-5">
          <p className="text-meta leading-relaxed text-ink-3">
            Grupo sanguíneo, alergias, medicação e observações. Ainda ninguém preencheu.
          </p>
          {data.editable && (
            <button type="button" className="ctl-outline mt-3" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" strokeWidth={1.75} />
              Preencher
            </button>
          )}
        </div>
      ) : (
        <div className="px-5 py-4">
          {/* O grupo sanguíneo é uma palavra: fica numa linha, com o valor à direita. */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-meta text-ink-3">Grupo sanguíneo</span>
            {data.bloodType ? (
              <span className="rounded-[6px] bg-risk-soft px-2 py-0.5 text-body font-semibold tabular text-risk">{data.bloodType}</span>
            ) : (
              <span className="text-meta text-ink-4">não se sabe</span>
            )}
          </div>

          {preenchidos.length > 0 && (
            <dl className="mt-3 space-y-3 border-t border-line pt-3">
              {preenchidos.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-meta text-ink-3">{k}</dt>
                  <dd className="mt-0.5 whitespace-pre-line break-words text-body leading-relaxed text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          )}

          {/*
            O que falta, numa linha. "Sem alergias conhecidas" escreve-se; um
            campo em branco é ninguém ter perguntado, e convém que se veja.
          */}
          {emFalta.length > 0 && preenchidos.length < campos.length && (
            <p className="mt-3 border-t border-line pt-3 text-meta text-ink-4">
              Por preencher: {campos.filter(([, v]) => !v).map(([k]) => k.toLowerCase()).join(", ")}.
            </p>
          )}

          {data.updatedAt && (
            <p className="mt-3 text-[11px] text-ink-4">
              Actualizada a {longDate(new Date(data.updatedAt))}
              {data.updatedByName && ` por ${data.updatedByName}`}
            </p>
          )}
        </div>
      )}

      {editing && (
        <MedicalInfoDialog
          athlete={athlete}
          info={data}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
    </Panel>
  );
}

function MedicalInfoDialog({
  athlete,
  info,
  onClose,
  onSaved,
}: {
  athlete: Athlete;
  info: MedicalInfo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [bloodType, setBloodType] = useState(info.bloodType ?? "");
  const [allergies, setAllergies] = useState(info.allergies ?? "");
  const [medication, setMedication] = useState(info.medication ?? "");
  const [notes, setNotes] = useState(info.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPut(`/api/athletes/${athlete.id}/info-medica`, {
        bloodType: bloodType || null,
        allergies: allergies.trim() || null,
        medication: medication.trim() || null,
        notes: notes.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gravar.");
      setBusy(false);
    }
  }

  const area = cx(dialogInputClass, "h-auto resize-y py-2 leading-relaxed");

  return (
    <Dialog
      labelledBy="info-medica"
      title="Informação médica"
      subtitle={athlete.name}
      icon={<HeartPulse className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={560}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form="form-info-medica" className="ctl-primary" disabled={busy}>
            {busy ? "A gravar…" : "Guardar"}
          </button>
        </div>
      }
    >
      <form id="form-info-medica" onSubmit={save} className="space-y-4 p-5">
        <DialogField label="Grupo sanguíneo">
          <select value={bloodType} onChange={(e) => setBloodType(e.target.value)} className={cx(dialogInputClass, "w-40")}>
            <option value="">Não se sabe</option>
            {GRUPOS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </DialogField>

        <DialogField label="Alergias" hint="alimentos, medicamentos, picadas — ou «sem alergias conhecidas»">
          <textarea value={allergies} onChange={(e) => setAllergies(e.target.value)} rows={3} maxLength={2000} className={area} />
        </DialogField>

        <DialogField label="Medicação" hint="o que toma, a dose e quando">
          <textarea value={medication} onChange={(e) => setMedication(e.target.value)} rows={3} maxLength={2000} className={area} />
        </DialogField>

        <DialogField label="Observações" hint="doenças crónicas, cirurgias, o que fazer numa crise">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={2000} className={area} />
        </DialogField>

        {error && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{error}</p>}
      </form>
    </Dialog>
  );
}
