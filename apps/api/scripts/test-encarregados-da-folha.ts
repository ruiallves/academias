/**
 * Os encarregados da folha de atletas: o plano, sem base de dados.
 * `npm run test:encarregados-da-folha`. Ver `src/academy/encarregados-da-folha.ts`.
 */
import { digitosDoTelefone, emailsDaFolha, planearEncarregados, type ContaDoClube } from "../src/academy/encarregados-da-folha";

let ok = 0;
let falhas = 0;
function check(nome: string, cond: boolean, detalhe = "") {
  if (cond) { ok++; console.log(`  OK    ${nome}`); }
  else { falhas++; console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`); }
}
const vazio = () => ({ porLigar: [] as never[], telefones: [] as never[], deFora: [] as never[] }) as Parameters<typeof planearEncarregados>[3];

console.log("=== Telemóveis ===");
check("o indicativo não conta", digitosDoTelefone("+351 912 345 678") === "912345678");
check("00351 também não", digitosDoTelefone("00351912345678") === "912345678");
check("espaços e pontos não contam", digitosDoTelefone("912.345.678") === digitosDoTelefone("912345678"));
check("vazio é vazio", digitosDoTelefone(null) === "");

console.log("=== Emails da folha ===");
const emails = emailsDaFolha([
  { encarregados: [{ email: " Paula@Mail.pt " }, { email: "mal-escrito" }] },
  { encarregados: [{ email: "paula@mail.pt" }] },
  {},
]);
check("em minúsculas, sem repetidos, só os válidos", emails.join("|") === "paula@mail.pt", emails.join("|"));

const contas = new Map<string, ContaDoClube>([
  ["paula@mail.pt", { userId: "u1", nome: "Paula Azevedo", telefone: "912345678", familia: { id: "m1", ativa: true } }],
  ["joao@mail.pt", { userId: "u2", nome: "João Pereira", telefone: null, familia: null }],
  ["socio@mail.pt", { userId: "u3", nome: "Rita Sócia", telefone: undefined, familia: null }],
  ["espera@mail.pt", { userId: "u4", nome: "Em Espera", telefone: "910000000", familia: { id: "m4", ativa: false } }],
]);
const linha = (encarregados: { nome?: string; email?: string; telefone?: string }[]) => ({ line: 2, athleteId: "a1", atleta: "Afonso", encarregados });

console.log("=== Plano ===");
let out = vazio();
planearEncarregados(linha([{ email: "paula@mail.pt", telefone: "+351 912 345 678" }]), contas, true, out);
check("mesmo número escrito de outra forma: liga sem perguntar nem mudar", out.porLigar.length === 1 && out.porLigar[0]!.telefoneNovo === null && out.telefones.length === 0);

out = vazio();
planearEncarregados(linha([{ email: "PAULA@mail.pt", telefone: "913000000" }]), contas, true, out);
check("número diferente: pergunta, com o de antes e o novo", out.telefones.length === 1 && out.telefones[0]!.de === "912345678" && out.telefones[0]!.para === "913000000");
check("e fica para escrever depois da pergunta", out.porLigar[0]?.telefoneNovo === "913000000");

out = vazio();
planearEncarregados(linha([{ email: "joao@mail.pt", telefone: "914000000" }]), contas, true, out);
check("conta sem telemóvel: preenche sem perguntar", out.telefones.length === 0 && out.porLigar[0]?.telefoneNovo === "914000000");

out = vazio();
planearEncarregados(linha([{ email: "socio@mail.pt", telefone: "915000000" }]), contas, true, out);
check("sócio sem vínculo (não se sabe o número): pergunta", out.telefones.length === 1 && out.telefones[0]!.de === null);

out = vazio();
planearEncarregados(linha([{ email: "joao@mail.pt" }]), contas, true, out);
check("sem telemóvel na folha: liga e não mexe no número", out.porLigar.length === 1 && out.porLigar[0]!.telefoneNovo === null);

out = vazio();
planearEncarregados(
  linha([
    { nome: "Sem Conta", email: "novo@mail.pt", telefone: "916000000" },
    { nome: "Sem Email", telefone: "917000000" },
    { email: "espera@mail.pt" },
    { email: "mal" },
    {},
  ]),
  contas,
  true,
  out,
);
check("ninguém se cria: quem não tem conta fica de fora", out.porLigar.length === 0);
check("e cada um com o seu motivo", out.deFora.map((d) => d.motivo).join("|") === "ainda não tem conta no clube|sem email, não dá para o reconhecer|à espera de aprovação ou desligado em Famílias|email inválido", out.deFora.map((d) => d.motivo).join("|"));

out = vazio();
planearEncarregados(linha([{ email: "paula@mail.pt", telefone: "913000000" }]), contas, false, out);
check("sem family:write não se liga ninguém", out.porLigar.length === 0 && out.deFora[0]?.motivo === "sem permissão para gerir famílias");

out = vazio();
planearEncarregados({ ...linha([{ email: "paula@mail.pt", telefone: "913000000" }]), line: 2 }, contas, true, out);
planearEncarregados({ ...linha([{ email: "paula@mail.pt", telefone: "913 000 000" }]), line: 3, athleteId: "a2", atleta: "Irmão" }, contas, true, out);
check("dois filhos, o mesmo número novo: pergunta uma vez e liga aos dois", out.telefones.length === 1 && out.porLigar.length === 2);

console.log(falhas === 0 ? `\nTUDO OK — ${ok} ok, 0 falhas` : `\n${falhas} FALHAS (${ok} ok)`);
process.exit(falhas === 0 ? 0 : 1);
