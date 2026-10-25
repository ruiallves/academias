/**
 * As regras das substituições do jogo ao vivo (`components/match/substituicoes.ts`).
 *
 * Prova o que o Rui pediu a 25/10/2026: com substituições ilimitadas, quem
 * saiu volta a entrar; sem elas não volta; e em qualquer caso para entrar um
 * sai outro, só sai quem está em campo, só entra quem não está, e um expulso
 * não volta.
 *
 * Uso: npm run test:substituicoes --workspace @academia/console
 */
import { motivoParaNaoEntrar, percorrer, problemaNosTitulares, substituicoesVolantes, vezesEmCampo, type Acontecimento } from "@/components/match/substituicoes";

let ok = 0;
let bad = 0;
const check = (l: string, c: boolean, d = "") => {
  if (c) {
    ok++;
    console.log("  OK    " + l);
  } else {
    bad++;
    console.log("  FALHA " + l + (d ? " — " + d : ""));
  }
};

const VOLANTES = { volantes: true, completaExpulsos: false };
const LIMITADAS = { volantes: false, completaExpulsos: false };
const FUTSAL = { volantes: true, completaExpulsos: true };
const onze = ["a", "b", "c"];
let n = 0;
const sub = (sai: string | undefined, entra: string): Acontecimento => ({ id: `e${++n}`, tipo: "sub", ...(sai ? { atleta: sai } : {}), entra });
const golo = (quem: string): Acontecimento => ({ id: `e${++n}`, tipo: "golo", atleta: quem });
const vermelho = (quem: string): Acontecimento => ({ id: `e${++n}`, tipo: "vermelho", atleta: quem });
const semProblemas = (s: { problemas: unknown[] }) => s.problemas.length === 0;
const campo = (s: { emCampo: Set<string> }) => [...s.emCampo].sort().join(",");

console.log("=== Substituições ilimitadas: quem saiu volta ===");
{
  const s = percorrer(onze, [sub("a", "d"), sub("d", "a"), sub("a", "d"), sub("b", "a")], VOLANTES);
  check("sai e volta a entrar três vezes, sem problemas", semProblemas(s), JSON.stringify(s.problemas));
  check("em campo fica quem a última troca deixou", campo(s) === "a,c,d", campo(s));
  check("o banco deixa voltar quem saiu", motivoParaNaoEntrar("b", s, VOLANTES) === null);
}

console.log("=== Sem substituições ilimitadas: quem sai não volta ===");
{
  const s = percorrer(onze, [sub("a", "d"), sub("d", "a")], LIMITADAS);
  check("voltar a entrar quem saiu é recusado", s.problemas.length === 1 && /não volta a entrar/.test(s.problemas[0].mensagem), JSON.stringify(s.problemas));
  const s2 = percorrer(onze, [sub("a", "d")], LIMITADAS);
  check("quem saiu fica fora da lista de entrar", motivoParaNaoEntrar("a", s2, LIMITADAS) !== null);
  check("quem nunca jogou pode entrar", motivoParaNaoEntrar("e", s2, LIMITADAS) === null);
  check("um titular que ainda está em campo não entra", motivoParaNaoEntrar("b", s2, LIMITADAS) !== null);
}

console.log("=== Para entrar um, sai outro ===");
{
  const s = percorrer(onze, [sub(undefined, "d")], VOLANTES);
  check("entrar sem sair ninguém é recusado", s.problemas.length === 1 && /tem de sair outro/.test(s.problemas[0].mensagem), JSON.stringify(s.problemas));
  const s2 = percorrer(onze, [sub("a", "a")], VOLANTES);
  check("sair e entrar o mesmo jogador é recusado", s2.problemas.some((p) => /mesma substituição/.test(p.mensagem)));
  const s3 = percorrer(onze, [{ id: "x", tipo: "sub", atleta: "a" }], VOLANTES);
  check("uma substituição sem quem entrou é recusada", s3.problemas.length === 1);
}

console.log("=== Só sai quem está em campo, só entra quem não está ===");
{
  const s = percorrer(onze, [sub("d", "e")], VOLANTES);
  check("sair quem está no banco é recusado", s.problemas.some((p) => /não estava em campo para sair/.test(p.mensagem)));
  const s2 = percorrer(onze, [sub("a", "b")], VOLANTES);
  check("entrar quem já está em campo é recusado", s2.problemas.some((p) => /já estava em campo/.test(p.mensagem)));
  const s3 = percorrer(onze, [sub("a", "d"), sub("a", "e")], VOLANTES);
  check("o mesmo jogador não sai duas vezes seguidas", s3.problemas.length === 1 && s3.problemas[0].id === s3.problemas[0].id && /não estava em campo/.test(s3.problemas[0].mensagem));
}

console.log("=== Apagar um acontecimento a meio estraga os seguintes ===");
{
  // a sai, d entra; depois d sai e e entra. Apaga-se a primeira: d nunca entrou.
  const s = percorrer(onze, [sub("d", "e")], LIMITADAS);
  check("a troca seguinte passa a estar errada", s.problemas.length === 1);
}

console.log("=== Expulsos ===");
{
  const s = percorrer(onze, [vermelho("a"), sub("b", "a")], VOLANTES);
  check("um expulso não volta a entrar, mesmo com ilimitadas", s.problemas.some((p) => /expulso e não pode voltar/.test(p.mensagem)));
  const s2 = percorrer(onze, [vermelho("a"), sub("a", "d")], VOLANTES);
  check("um expulso não sai numa substituição", s2.problemas.some((p) => /já tinha sido expulso/.test(p.mensagem)));
  const s3 = percorrer(onze, [vermelho("a"), vermelho("a")], VOLANTES);
  check("dois vermelhos ao mesmo jogador é recusado", s3.problemas.length === 1);
  const s4 = percorrer(onze, [vermelho("a")], VOLANTES);
  check("o expulso sai de campo", !s4.emCampo.has("a") && s4.vagasDeExpulsos === 1);
}

console.log("=== Futsal: a entrada no lugar do expulso ===");
{
  const s = percorrer(onze, [vermelho("a"), sub(undefined, "d")], FUTSAL);
  check("completa a equipa sem sair ninguém", semProblemas(s) && campo(s) === "b,c,d", JSON.stringify(s.problemas));
  const s2 = percorrer(onze, [vermelho("a"), sub(undefined, "d"), sub(undefined, "e")], FUTSAL);
  check("só uma entrada por expulso", s2.problemas.length === 1 && /nenhum expulso por completar/.test(s2.problemas[0].mensagem));
  const s3 = percorrer(onze, [sub(undefined, "d")], FUTSAL);
  check("sem expulso não há entrada sem saída", s3.problemas.length === 1);
}

console.log("=== Golos ===");
{
  const s = percorrer(onze, [sub("a", "d"), golo("a")], VOLANTES);
  check("quem está no banco não marca", s.problemas.some((p) => /não estava em campo quando marcou/.test(p.mensagem)));
  const s2 = percorrer(onze, [sub("a", "d"), sub("d", "a"), golo("a")], VOLANTES);
  check("quem voltou a entrar marca", semProblemas(s2));
}

console.log("=== O segundo amarelo é uma expulsão ===");
{
  const amarelo = (quem: string): Acontecimento => ({ id: `e${++n}`, tipo: "amarelo", atleta: quem });
  const s = percorrer(onze, [amarelo("a"), amarelo("a")], VOLANTES);
  check("dois amarelos tiram de campo", !s.emCampo.has("a") && s.expulsos.has("a") && semProblemas(s));
  const s2 = percorrer(onze, [amarelo("a"), amarelo("a"), sub("d", "a")], VOLANTES);
  check("expulso por dois amarelos não volta", s2.problemas.some((p) => /expulso/.test(p.mensagem)));
  const s3 = percorrer(onze, [amarelo("a"), amarelo("a"), golo("a")], VOLANTES);
  check("expulso por dois amarelos não marca", s3.problemas.some((p) => /não estava em campo/.test(p.mensagem)));
  const s4 = percorrer(onze, [amarelo("a"), amarelo("a"), amarelo("a")], VOLANTES);
  check("terceiro amarelo não existe", s4.problemas.some((p) => /já tinha sido expulso/.test(p.mensagem)));
  const s5 = percorrer(onze, [amarelo("a"), amarelo("a"), sub(undefined, "d")], FUTSAL);
  check("futsal: completa-se depois de dois amarelos", semProblemas(s5) && s5.emCampo.has("d"), JSON.stringify(s5.problemas));
  const v = vezesEmCampo(onze, [{ ...amarelo("b"), minuto: 5 }, { ...amarelo("b"), minuto: 22 }]);
  check("o segundo amarelo fecha a vez em campo", JSON.stringify(v.get("b")) === "[0,22]", JSON.stringify(v.get("b")));
}

console.log("=== Quantos começam ===");
check("onze no futebol 11: certo", problemaNosTitulares(11, "f11", "futebol 11") === null);
check("doze no futebol 11: erro", problemaNosTitulares(12, "f11", "futebol 11")?.erro === true);
check("seis no futebol 7: aviso, deixa começar", problemaNosTitulares(6, "f7", "futebol 7")?.erro === false);
check("ninguém: erro", problemaNosTitulares(0, "futsal", "futsal")?.erro === true);
check("seis no futsal: erro", problemaNosTitulares(6, "futsal", "futsal")?.erro === true);
{
  // Com cada entrada a ter uma saída, ficam sempre os mesmos em campo.
  const s = percorrer(["a", "b", "c", "d", "e"], [sub("a", "f"), sub("f", "a"), sub("b", "g"), vermelho("c")], VOLANTES);
  check("em campo fica o número de titulares menos os expulsos", s.emCampo.size === 4, String(s.emCampo.size));
}

console.log("=== Vezes em campo (para os minutos) ===");
{
  const em = (m: number, a: Acontecimento) => ({ ...a, minuto: m });
  const v = vezesEmCampo(onze, [em(8, sub("a", "d")), em(15, sub("d", "a")), em(30, sub("a", "d")), em(35, vermelho("b"))]);
  const txt = (id: string) => JSON.stringify(v.get(id) ?? []);
  check("titular que sai, volta e sai: [0,8,15,30]", txt("a") === "[0,8,15,30]", txt("a"));
  check("suplente que entra, sai e entra: [8,15,30]", txt("d") === "[8,15,30]", txt("d"));
  check("vermelho fecha a vez: [0,35]", txt("b") === "[0,35]", txt("b"));
  check("quem joga tudo fica aberto: [0]", txt("c") === "[0]", txt("c"));
  const atras = vezesEmCampo(onze, [em(10, sub("a", "d")), em(9, sub("d", "a"))]);
  check("minuto para trás conta como o anterior", JSON.stringify(atras.get("d")) === "[10,10]", JSON.stringify(atras.get("d")));
  const errada = vezesEmCampo(onze, [em(5, sub("d", "e"))]);
  check("sair quem não está em campo não mexe na lista", !errada.has("d") && JSON.stringify(errada.get("e")) === "[5]");
}

console.log("=== A regra por omissão ===");
check("a equipa manda, quando o servidor a diz", substituicoesVolantes(true, "football") && !substituicoesVolantes(false, "futsal"));
check("servidor antigo: futsal e basquetebol volantes", substituicoesVolantes(undefined, "futsal") && substituicoesVolantes(undefined, "basketball"));
check("servidor antigo: futebol limitado", !substituicoesVolantes(undefined, "football"));

console.log(`\n${ok} OK, ${bad} falhas`);
if (bad) process.exit(1);
