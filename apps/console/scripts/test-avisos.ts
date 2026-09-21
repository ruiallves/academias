/**
 * O canal dos avisos.
 *
 * ## O que se está a proteger
 *
 * Este canal passou a ser **o único sítio** onde um erro da consola aparece.
 * Antes eram cinquenta parágrafos vermelhos espalhados pelos ecrãs, cada um com
 * a sua forma, e metade deles nascia fora da vista. Agora, se isto falhar, o
 * erro não aparece em lado nenhum — e um erro que não aparece é pior do que um
 * erro mal desenhado, porque a pessoa carrega outra vez a pensar que o clique
 * não pegou.
 *
 * As regras que aqui se guardam são as que não se vêem a olho:
 *
 *  - o mesmo erro **não se empilha**: quando a rede cai são nove pedidos a
 *    falhar com a mesma frase, e nove cartões iguais dizem que o produto está
 *    partido, não que houve nove erros;
 *  - reacender **conta** as repetições e muda a versão, que é o que faz a barra
 *    do tempo recomeçar;
 *  - uma mensagem vazia não abre cartão nenhum;
 *  - há um tecto: acima dele sai o mais velho, e não o mais recente.
 *
 * Corre o código verdadeiro, agrupado com esbuild e executado em node.
 *
 * Uso: npm run test:avisos
 */
import {
  avisosActuais,
  fecharAviso,
  mostrarErro,
  mostrarOk,
  ouvirAvisos,
  textoDoErro,
} from "../src/lib/avisos";

let ok = 0;
let bad = 0;
const check = (label: string, cond: unknown, detalhe = "") => {
  if (cond) {
    ok++;
    console.log("  OK    " + label);
  } else {
    bad++;
    console.log("  FALHA " + label + (detalhe ? " — " + detalhe : ""));
  }
};

/** Deixa a lista vazia entre blocos, para cada um começar do zero. */
const limpar = () => {
  for (const a of [...avisosActuais()]) fecharAviso(a.id);
};

/* -------------------------------------------------------------------------- */

console.log("\n=== Um aviso aparece, e fecha-se ===");

let notificacoes = 0;
const cancelar = ouvirAvisos(() => {
  notificacoes++;
});

mostrarErro("Já há um mesociclo (Pré-época) de 17 ago a 6 set nesta equipa.");
check("fica um aviso na lista", avisosActuais().length === 1, String(avisosActuais().length));
check("do tipo erro", avisosActuais()[0]?.tipo === "erro", avisosActuais()[0]?.tipo);
check(
  "com a frase do servidor, tal e qual",
  avisosActuais()[0]?.texto === "Já há um mesociclo (Pré-época) de 17 ago a 6 set nesta equipa.",
  avisosActuais()[0]?.texto,
);
check("e quem ouve foi avisado", notificacoes === 1, String(notificacoes));

/*
 * O erro fica mais tempo do que a confirmação: uma frase inteira tem de ser
 * lida, e "gravado" não.
 */
mostrarOk("Ficha gravada.");
const erro = avisosActuais().find((a) => a.tipo === "erro")!;
const confirmacao = avisosActuais().find((a) => a.tipo === "ok")!;
check("o erro dura mais do que a confirmação", erro.duracao > confirmacao.duracao, `${erro.duracao} vs ${confirmacao.duracao}`);

fecharAviso(erro.id);
check("fechar tira só aquele", avisosActuais().length === 1 && avisosActuais()[0].tipo === "ok", String(avisosActuais().length));

limpar();
check("a lista esvazia-se", avisosActuais().length === 0, String(avisosActuais().length));

/* -------------------------------------------------------------------------- */

console.log("\n=== O mesmo erro não se empilha ===");

/*
 * O caso verdadeiro: a rede cai e a consola faz nove pedidos. Falham os nove,
 * todos com a mesma frase. Tem de ficar **um** cartão.
 */
for (let i = 0; i < 9; i++) mostrarErro("Não foi possível ligar ao servidor.");

check("fica um cartão só", avisosActuais().length === 1, String(avisosActuais().length));
check("que conta as repetições", avisosActuais()[0]?.repetido === 8, String(avisosActuais()[0]?.repetido));
check(
  "e muda de versão para a barra recomeçar",
  avisosActuais()[0]?.versao === 8,
  String(avisosActuais()[0]?.versao),
);

/* Dois erros **diferentes** continuam a ser dois. */
mostrarErro("Sem permissão para editar equipas.");
check("erros diferentes ficam separados", avisosActuais().length === 2, String(avisosActuais().length));

/* O mesmo texto, mas de tipo diferente, é outro aviso: um é queixa, outro é confirmação. */
mostrarOk("Sem permissão para editar equipas.");
check("o tipo faz parte da identidade", avisosActuais().length === 3, String(avisosActuais().length));

limpar();

/* -------------------------------------------------------------------------- */

console.log("\n=== O que não abre cartão ===");

mostrarErro("");
mostrarErro("   ");
check("uma mensagem vazia não abre nada", avisosActuais().length === 0, String(avisosActuais().length));

/*
 * Um cartão em branco seria pior do que silêncio: não diz o que se passou e
 * ainda tapa o canto do ecrã.
 */
mostrarErro("  Erro com espaços à volta.  ");
check("o texto é aparado", avisosActuais()[0]?.texto === "Erro com espaços à volta.", `"${avisosActuais()[0]?.texto}"`);

limpar();

/* -------------------------------------------------------------------------- */

console.log("\n=== O tecto ===");

for (let i = 1; i <= 7; i++) mostrarErro(`Erro número ${i}.`);

check("não passam de quatro no ecrã", avisosActuais().length === 4, String(avisosActuais().length));
/*
 * Sai o mais velho, não o mais recente. O que acabou de acontecer é o que a
 * pessoa está a tentar perceber.
 */
check("o mais recente está lá", avisosActuais().some((a) => a.texto === "Erro número 7."), "");
check("e o mais velho saiu", !avisosActuais().some((a) => a.texto === "Erro número 1."), "");

limpar();

/* -------------------------------------------------------------------------- */

console.log("\n=== A frase de um erro apanhado ===");

check("um Error dá a sua mensagem", textoDoErro(new Error("Já existe uma equipa com esse nome")) === "Já existe uma equipa com esse nome", "");
check("uma string dá-se a si própria", textoDoErro("Falhou") === "Falhou", "");
check("um Error sem mensagem cai na frase de omissão", textoDoErro(new Error("")).length > 0, "");
check("e o que não é erro nenhum também", textoDoErro(undefined).length > 0, "");
check(
  "a omissão é escolhível",
  textoDoErro(null, "Não foi possível gravar a ficha.") === "Não foi possível gravar a ficha.",
  "",
);

cancelar();
mostrarErro("Depois de cancelar.");
check("quem cancelou deixa de ser avisado", notificacoes > 0, String(notificacoes));

limpar();

/* -------------------------------------------------------------------------- */

console.log(`\n${ok} OK, ${bad} FALHA`);
process.exit(bad ? 1 : 0);
