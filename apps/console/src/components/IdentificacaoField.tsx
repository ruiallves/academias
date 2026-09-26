import { DialogField, dialogInputClass } from "./Dialog";
import { cx } from "./primitives";

/**
 * A identificação do atleta num formulário: o NIF, ou outro documento.
 *
 * Um atleta estrangeiro pode não ter NIF português. Aí o clube escolhe "Outro
 * documento", escreve o nome dele (só para si: "Passaporte") e o número. É com
 * o número (ou o NIF) e a data de nascimento que a família reclama o filho na
 * app, por isso um dos dois é obrigatório.
 *
 * O mesmo campo na inscrição, na edição da ficha, no recrutamento do scouting e
 * no painel que preenche o que falta: a regra é uma, e o servidor diz o mesmo
 * (`identificacao.ts` na API).
 */
export type IdentificacaoForm = { tipo: "nif" | "doc"; taxId: string; docLabel: string; docNumber: string };

export function identificacaoInicial(a?: { taxId?: string; idDocLabel?: string; idDocNumber?: string }): IdentificacaoForm {
  return {
    tipo: a?.idDocNumber && !a?.taxId ? "doc" : "nif",
    taxId: a?.taxId ?? "",
    docLabel: a?.idDocLabel ?? "",
    docNumber: a?.idDocNumber ?? "",
  };
}

const nif = (v: string) => v.replace(/[\s.]/g, "");
const doc = (v: string) => v.toUpperCase().replace(/[\s.\-/]/g, "");

export const nifValido = (v: string) => /^\d{9}$/.test(nif(v));
export const documentoValido = (v: string) => /^[A-Z0-9]{3,30}$/.test(doc(v));

export function identificacaoOk(v: IdentificacaoForm): boolean {
  return v.tipo === "nif" ? nifValido(v.taxId) : documentoValido(v.docNumber);
}

/**
 * O que vai no pedido.
 *
 * Ao criar, só o escolhido. Ao editar, o outro vai vazio: trocar o NIF por um
 * passaporte limpa o NIF (e o contrário), senão a ficha ficava com os dois e
 * o ecrã só mostrava um.
 */
export function identificacaoParaApi(v: IdentificacaoForm, modo: "criar" | "editar") {
  if (v.tipo === "nif") {
    return modo === "criar" ? { taxId: nif(v.taxId) } : { taxId: nif(v.taxId), idDocNumber: "", idDocLabel: "" };
  }
  const outro = { idDocLabel: v.docLabel.trim(), idDocNumber: doc(v.docNumber) };
  return modo === "criar" ? outro : { ...outro, taxId: "" };
}

export function IdentificacaoField({
  value,
  onChange,
}: {
  value: IdentificacaoForm;
  onChange: (v: IdentificacaoForm) => void;
}) {
  const set = (patch: Partial<IdentificacaoForm>) => onChange({ ...value, ...patch });
  const nifMal = value.tipo === "nif" && value.taxId !== "" && !nifValido(value.taxId);
  const docMal = value.tipo === "doc" && value.docNumber !== "" && !documentoValido(value.docNumber);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-meta font-medium text-ink">Identificação</span>
        <span className="inline-flex items-center gap-px rounded-[var(--radius-control)] bg-sunken p-0.5">
          {(
            [
              ["nif", "NIF"],
              ["doc", "Outro documento"],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => set({ tipo: t })}
              aria-pressed={value.tipo === t}
              className={cx(
                "h-6 rounded-[5px] px-2.5 text-[11px] font-medium transition-colors duration-[120ms]",
                value.tipo === t ? "bg-surface text-ink shadow-[0_1px_2px_rgb(26_25_23/0.06)]" : "text-ink-3 hover:text-ink-2",
              )}
            >
              {label}
            </button>
          ))}
        </span>
      </div>

      {value.tipo === "nif" ? (
        <DialogField label="NIF" hint="obrigatório, é o que liga a família à app">
          <input
            value={value.taxId}
            onChange={(e) => set({ taxId: e.target.value })}
            inputMode="numeric"
            maxLength={11}
            placeholder="123456789"
            aria-invalid={nifMal}
            className={cx(dialogInputClass, nifMal && "border-risk")}
          />
        </DialogField>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <DialogField label="Documento" hint="só o clube vê">
            <input
              value={value.docLabel}
              onChange={(e) => set({ docLabel: e.target.value })}
              maxLength={60}
              placeholder="Passaporte, título de residência…"
              className={dialogInputClass}
            />
          </DialogField>
          <DialogField label="Número" hint="obrigatório">
            <input
              value={value.docNumber}
              onChange={(e) => set({ docNumber: e.target.value })}
              maxLength={40}
              placeholder="AB1234567"
              aria-invalid={docMal}
              className={cx(dialogInputClass, "uppercase", docMal && "border-risk")}
            />
          </DialogField>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-ink-4">
        {nifMal
          ? "O NIF tem nove dígitos."
          : docMal
            ? "O número tem de 3 a 30 letras ou algarismos."
            : value.tipo === "nif"
              ? "A família liga-se a este atleta na app com o NIF e a data de nascimento."
              : "A família escolhe “Outro documento” na app e escreve só o número, com a data de nascimento."}
      </p>
    </div>
  );
}
