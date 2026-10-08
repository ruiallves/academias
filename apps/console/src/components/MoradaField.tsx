import { DialogField, dialogInputClass } from "@/components/Dialog";

/**
 * A morada e o n.º do Cartão de Cidadão do atleta. Todos opcionais.
 *
 * O mesmo bloco na inscrição ("Novo atleta") e na edição da ficha. Só aparece
 * a quem vê o NIF (`mayReadTaxId`): o servidor manda estes campos vazios a quem
 * não o vê, e um formulário com eles vazios convidava a apagar o que está gravado.
 */
export type Morada = { address: string; postalCode: string; city: string; citizenCardNumber: string };

export const moradaVazia = (): Morada => ({ address: "", postalCode: "", city: "", citizenCardNumber: "" });

export const moradaDoAtleta = (a: Partial<Morada>): Morada => ({
  address: a.address ?? "",
  postalCode: a.postalCode ?? "",
  city: a.city ?? "",
  citizenCardNumber: a.citizenCardNumber ?? "",
});

/**
 * O que vai no corpo. Na edição vai tudo, e vazio apaga (o que se vê é o que
 * fica); na inscrição só vai o que foi preenchido.
 */
export function moradaParaApi(m: Morada, modo: "criar" | "editar"): Partial<Morada> {
  const limpo = {
    address: m.address.trim(),
    postalCode: m.postalCode.trim(),
    city: m.city.trim(),
    citizenCardNumber: m.citizenCardNumber.trim().toUpperCase(),
  };
  if (modo === "editar") return limpo;
  return Object.fromEntries(Object.entries(limpo).filter(([, v]) => v !== "")) as Partial<Morada>;
}

export function MoradaField({ value, onChange }: { value: Morada; onChange: (m: Morada) => void }) {
  const set = (k: keyof Morada) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="space-y-3">
      <DialogField label="N.º do Cartão de Cidadão" hint="opcional, para atletas portugueses">
        <input
          value={value.citizenCardNumber}
          onChange={set("citizenCardNumber")}
          placeholder="12345678 9ZZ1"
          maxLength={20}
          autoComplete="off"
          className={dialogInputClass}
        />
      </DialogField>
      <DialogField label="Morada" hint="opcional">
        <input value={value.address} onChange={set("address")} maxLength={200} autoComplete="street-address" className={dialogInputClass} />
      </DialogField>
      <div className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-3">
        <DialogField label="Código postal">
          <input value={value.postalCode} onChange={set("postalCode")} placeholder="4700-000" maxLength={20} autoComplete="postal-code" className={dialogInputClass} />
        </DialogField>
        <DialogField label="Localidade">
          <input value={value.city} onChange={set("city")} maxLength={80} autoComplete="address-level2" className={dialogInputClass} />
        </DialogField>
      </div>
    </div>
  );
}
