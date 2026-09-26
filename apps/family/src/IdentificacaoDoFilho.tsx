import { cx } from "@/ui";

/**
 * Com que é que a família identifica o filho: o NIF, ou outro documento.
 *
 * Há atletas estrangeiros sem NIF português; o clube guarda-lhes outro
 * documento. A família escolhe "Outro documento" e escreve **só o número**: o
 * nome do documento é do clube, e perguntá-lo aqui era mais uma forma de errar
 * sem ganhar nada. A prova continua a ser o número com a data de nascimento.
 *
 * Serve o registo pelo link do clube e o "juntar educando" do perfil, que têm
 * de pedir exactamente a mesma coisa.
 */
export type Prova = { tipo: "nif" | "doc"; valor: string };

export const provaVazia = (): Prova => ({ tipo: "nif", valor: "" });

const nif = (v: string) => v.replace(/[\s.]/g, "");
const doc = (v: string) => v.toUpperCase().replace(/[\s.\-/]/g, "");

export function provaValida(p: Prova): boolean {
  return p.tipo === "nif" ? /^\d{9}$/.test(nif(p.valor)) : /^[A-Z0-9]{3,30}$/.test(doc(p.valor));
}

/** O que segue para o servidor: `taxId`, ou `docNumber`. */
export function provaParaApi(p: Prova): { taxId: string } | { docNumber: string } {
  return p.tipo === "nif" ? { taxId: nif(p.valor) } : { docNumber: doc(p.valor) };
}

/** Os dois botões: NIF, ou outro documento. Trocar limpa o que estava escrito. */
export function TipoDeDocumento({ value, onChange }: { value: Prova; onChange: (p: Prova) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-[var(--radius-sm)] bg-sunken p-1">
      {(
        [
          ["nif", "NIF"],
          ["doc", "Outro documento"],
        ] as const
      ).map(([t, label]) => (
        <button
          key={t}
          type="button"
          onClick={() => value.tipo !== t && onChange({ tipo: t, valor: "" })}
          aria-pressed={value.tipo === t}
          className={cx(
            "h-9 rounded-[calc(var(--radius-sm)-2px)] text-[14px] font-semibold transition-colors",
            value.tipo === t ? "bg-surface text-ink shadow-[var(--shadow-soft)]" : "text-ink-3",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Os atributos do campo do número, conforme o tipo. */
export function campoDaProva(p: Prova) {
  return p.tipo === "nif"
    ? { inputMode: "numeric" as const, maxLength: 11, placeholder: "123456789", autoCapitalize: "off" }
    : { inputMode: "text" as const, maxLength: 40, placeholder: "Número do documento", autoCapitalize: "characters" };
}
