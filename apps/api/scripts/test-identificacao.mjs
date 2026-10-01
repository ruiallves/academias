#!/usr/bin/env node
/**
 * A identificação de um atleta: o NIF ou outro documento — um, e só um.
 *
 * Corre as funções verdadeiras (`src/academy/identificacao.ts`), sem servidor
 * nem base de dados. São elas que decidem nos quatro caminhos que escrevem
 * atletas: inscrição, edição, importação e recrutamento do scouting.
 *
 * O caso que trouxe isto: uma folha importada com as colunas NIF **e** N.º do
 * documento preenchidas na mesma linha entrava sem erro, e a ficha ficava com
 * duas identificações quando o formulário só mostra uma.
 *
 * Uso: node --experimental-strip-types scripts/test-identificacao.mjs
 */
import { identificacaoEditada, identificacaoNova, SO_UM_DOS_DOIS } from "../src/academy/identificacao.ts";

let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
  if (ok) {
    passed++;
    console.log(`  OK   ${label}`);
  } else {
    failed++;
    console.log(`  FALHA ${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const erro = (r) => ("error" in r ? r.error : null);

console.log("\nUm atleta novo (inscrição, importação, scouting)");
{
  const soNif = identificacaoNova({ taxId: "245 001 107" });
  check("só o NIF entra", !erro(soNif) && soNif.taxId === "245001107" && soNif.idDocNumber === null);

  const soDoc = identificacaoNova({ idDocLabel: " Passaporte ", idDocNumber: "ab 123.456-c" });
  check("só o documento entra", !erro(soDoc) && soDoc.idDocNumber === "AB123456C" && soDoc.idDocLabel === "Passaporte" && soDoc.taxId === null);

  const osDois = identificacaoNova({ taxId: "245001107", idDocLabel: "NIC", idDocNumber: "12345678" });
  check("o NIF e outro documento juntos são recusados", erro(osDois) === SO_UM_DOS_DOIS, JSON.stringify(osDois));

  check("um NIF com o nome do documento mas sem número entra: o nome sozinho não é identificação",
    !erro(identificacaoNova({ taxId: "245001107", idDocLabel: "Passaporte", idDocNumber: "  " })));
  check("sem nenhum continua a ser recusado", erro(identificacaoNova({})) !== null && erro(identificacaoNova({})) !== SO_UM_DOS_DOIS);
  check("um NIF mal escrito diz que é o NIF, mesmo com documento ao lado",
    erro(identificacaoNova({ taxId: "123", idDocNumber: "AB123" })) === "O NIF tem nove dígitos");
}

console.log("\nEditar uma ficha");
{
  const comNif = { taxId: "245001107", idDocLabel: null, idDocNumber: null };
  const comDoc = { taxId: null, idDocLabel: "Passaporte", idDocNumber: "AB123456" };
  const comOsDois = { taxId: "245001107", idDocLabel: "NIC", idDocNumber: "12345678" };

  check("juntar um documento a quem tem NIF é recusado", erro(identificacaoEditada(comNif, { idDocNumber: "AB123456" })) === SO_UM_DOS_DOIS);
  check("juntar um NIF a quem tem documento é recusado", erro(identificacaoEditada(comDoc, { taxId: "245001107" })) === SO_UM_DOS_DOIS);
  check("mandar os dois de uma vez é recusado", erro(identificacaoEditada(comNif, { taxId: "245001107", idDocNumber: "AB123456" })) === SO_UM_DOS_DOIS);

  const troca = identificacaoEditada(comNif, { taxId: "", idDocLabel: "Passaporte", idDocNumber: "AB123456" });
  check("trocar o NIF por um documento passa: um vazio, o outro preenchido", !erro(troca) && troca.taxId === null && troca.idDocNumber === "AB123456");
  const destroca = identificacaoEditada(comDoc, { taxId: "245001107", idDocNumber: "" });
  check("e o contrário também, e o nome do documento sai com ele", !erro(destroca) && destroca.taxId === "245001107" && destroca.idDocNumber === null && destroca.idDocLabel === null);

  const corrige = identificacaoEditada(comNif, { taxId: "245001115" });
  check("corrigir o NIF de quem só tem NIF passa", !erro(corrige) && corrige.taxId === "245001115");

  /* As fichas que já têm os dois (importadas antes desta regra). */
  const gralha = identificacaoEditada(comOsDois, { taxId: "245001115" });
  check("uma ficha antiga com os dois pode corrigir o NIF sem ser obrigada a escolher já", !erro(gralha) && gralha.taxId === "245001115" && gralha.idDocNumber === "12345678");
  const escolhe = identificacaoEditada(comOsDois, { taxId: "245001107", idDocNumber: "" });
  check("e ao escolher o NIF no formulário, o documento sai", !erro(escolhe) && escolhe.idDocNumber === null && escolhe.idDocLabel === null);
  check("mas mandar-lhe os dois outra vez é recusado", erro(identificacaoEditada(comOsDois, { taxId: "245001107", idDocNumber: "99999999" })) === SO_UM_DOS_DOIS);
  check("ficar sem nenhum continua a ser recusado", erro(identificacaoEditada(comNif, { taxId: "" })) !== null);
}

console.log(`\n${failed === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${passed} ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);
