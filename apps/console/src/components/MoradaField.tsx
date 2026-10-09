import { DialogField, dialogInputClass } from "@/components/Dialog";
import { paises } from "@/lib/paises";

/**
 * A morada, o n.º do Cartão de Cidadão e o que o boletim da FPF pede ao
 * atleta (país de nascimento, nacionalidade, telefone). Todos opcionais.
 *
 * O mesmo bloco na inscrição ("Novo atleta") e na edição da ficha. Só aparece
 * a quem vê o NIF (`mayReadTaxId`): o servidor manda estes campos vazios a quem
 * não o vê, e um formulário com eles vazios convidava a apagar o que está gravado.
 */
export type Morada = {
  address: string;
  postalCode: string;
  city: string;
  citizenCardNumber: string;
  birthCountry: string;
  nationality: string;
  phone: string;
};

export const moradaVazia = (): Morada => ({
  address: "", postalCode: "", city: "", citizenCardNumber: "", birthCountry: "", nationality: "", phone: "",
});

export const moradaDoAtleta = (a: Partial<Morada>): Morada => ({
  address: a.address ?? "",
  postalCode: a.postalCode ?? "",
  city: a.city ?? "",
  citizenCardNumber: a.citizenCardNumber ?? "",
  birthCountry: a.birthCountry ?? "",
  nationality: a.nationality ?? "",
  phone: a.phone ?? "",
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
    birthCountry: m.birthCountry,
    nationality: m.nationality,
    phone: m.phone.trim(),
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
      {/* O que o boletim de inscrição da FPF pede e a ficha não tinha. */}
      <div className="grid grid-cols-2 gap-3">
        <DialogField label="País de nascimento" hint="opcional">
          {seletorDePais(value.birthCountry, set("birthCountry"))}
        </DialogField>
        <DialogField label="Nacionalidade" hint="opcional">
          {seletorDePais(value.nationality, set("nationality"))}
        </DialogField>
      </div>
      <DialogField label="Telefone do atleta" hint="opcional; sem ele, a inscrição usa o do encarregado">
        <input
          value={value.phone}
          onChange={set("phone")}
          type="tel"
          inputMode="tel"
          placeholder="912 345 678"
          maxLength={30}
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

/** Uma função e não um componente: o `DialogField` só liga o rótulo a um `<select>` que receba directamente. */
function seletorDePais(value: string, onChange: (e: { target: { value: string } }) => void) {
  return (
    <select value={value} onChange={onChange} className={dialogInputClass}>
      <option value="">—</option>
      {paises().map((p) => (
        <option key={p.codigo} value={p.codigo}>
          {p.nome}
        </option>
      ))}
    </select>
  );
}
