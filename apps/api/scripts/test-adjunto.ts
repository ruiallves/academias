/**
 * O Adjunto, na parte que não precisa de modelo nenhum.
 *
 * O que aqui se protege é o que decide se a IA é segura de usar com dados de
 * crianças: os nomes resolvem-se no servidor e não no modelo; uma ambiguidade
 * vira pergunta e não adivinha; a tabela de rotas manda o trabalho simples
 * para o modelo pequeno; a transformação de um Excel é determinística; e os
 * valores que vão para o modelo nas amostras vão mascarados.
 *
 * Corre o código verdadeiro, sem servidor, sem base, sem OpenAI.
 *
 * Uso: npm run test:adjunto --workspace @academia/api
 */
import * as XLSX from "xlsx";
import { normalizar, resolverNome, resolverNomes, rotuloDe } from "../src/adjunto/nomes";
import { lerAcao, rotaDe, ROTA_GERAL, ROTA_REFORCO, ROTAS, subir } from "../src/adjunto/rotas";
import { FERRAMENTAS, ferramentasDe, foiDito } from "../src/adjunto/ferramentas";
import { ACOES, aplicaSe, descricaoDasAcoes, lerDiasDaSemana, lerValor, podeFazer, respondido, somarMinutos } from "../src/adjunto/acoes";
import { amostraMascarada, extrairFolhas, mascarar } from "../src/adjunto/importacao/extrair";
import { sanearMapeamento, type Mapeamento } from "../src/adjunto/importacao/mapear";
import { idadeDoNome, lerData, transformarAtletas } from "../src/adjunto/importacao/transformar";
import { ESQUEMA_DO_PLANO, lerDesenho, lerExercicioNovo, lerPlanoGerado, pedidoDoPlaneador, rotacaoDaBaliza, terrenoDaEquipa } from "../src/adjunto/planos";

let ok = 0;
let falhas = 0;
function check(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) {
    ok++;
    console.log(`  ✓ ${nome}`);
  } else {
    falhas++;
    console.log(`  ✗ ${nome}`, detalhe ?? "");
  }
}

/* ---- Nomes --------------------------------------------------------------- */

console.log("\nNomes");
const plantel = [
  { id: "a", name: "Pedro Sousa", squadNumber: 7, position: "Médio" },
  { id: "b", name: "Pedro Almeida", squadNumber: 15, position: "Defesa" },
  { id: "c", name: "Rui Costa", squadNumber: 10 },
  { id: "d", name: "Tiago Mendes", squadNumber: 14 },
  { id: "e", name: "Tomás da Silva", squadNumber: 3 },
  { id: "f", name: "José Pedro Martins", squadNumber: 9 },
  { id: "g", name: "Gonçalo Neves", squadNumber: 1 },
];

check("normalizar tira acentos e maiúsculas", normalizar("Tomás da Sílva!") === "tomas da silva");
check("nome inteiro resolve", resolverNome("Rui Costa", plantel).tipo === "unico");
check("primeiro nome único resolve", (resolverNome("Rui", plantel) as { pessoa: { id: string } }).pessoa.id === "c");
check("sem acento encontra com acento", (resolverNome("tomas", plantel) as { pessoa: { id: string } }).pessoa.id === "e");
check("dois Pedro é ambíguo, com os dois", (() => { const r = resolverNome("Pedro", plantel); return r.tipo === "ambiguo" && r.opcoes.length === 2; })());
check("Pedro Sousa desambigua", (resolverNome("Pedro Sousa", plantel) as { pessoa: { id: string } }).pessoa.id === "a");
check("apelido só também desambigua", (resolverNome("Almeida", plantel) as { pessoa: { id: string } }).pessoa.id === "b");
check("Zé Pedro é José Pedro (alcunha)", (resolverNome("Zé Pedro", plantel) as { pessoa: { id: string } }).pessoa.id === "f");
check("Gonç começa Gonçalo", (resolverNome("Gonç", plantel) as { pessoa: { id: string } }).pessoa.id === "g");
check("quem não existe dá nenhum", resolverNome("Afonso", plantel).tipo === "nenhum");
check("vazio dá nenhum", resolverNome("   ", plantel).tipo === "nenhum");

const lote = resolverNomes(["Pedro", "Pedro Almeida", "Rui", "Afonso"], plantel);
check("na mesma frase, Pedro Almeida liberta o outro Pedro", lote.resolvidos.length === 3 && lote.resolvidos.some((r) => r.dito === "Pedro" && r.pessoa.id === "a"), lote);
check("o desconhecido fica à parte", lote.desconhecidos.length === 1 && lote.desconhecidos[0] === "Afonso");
check("sem ambíguos neste lote", lote.ambiguos.length === 0);
const lote2 = resolverNomes(["Pedro"], plantel);
check("Pedro sozinho continua ambíguo", lote2.ambiguos.length === 1 && lote2.ambiguos[0].opcoes.length === 2);
check("rótulo com número e posição", rotuloDe(plantel[0]) === "Pedro Sousa (n.º 7, Médio)");

/* ---- Rotas --------------------------------------------------------------- */

console.log("\nRotas");
check("presenças vão ao modelo leve", ROTAS.presencas.nivel === "leve");
check("lesão vai ao modelo leve", ROTAS.lesao.nivel === "leve");
check("convocatória com critérios vai ao médio", ROTAS.convocatoria_criterios.nivel === "medio");
check("várias ações vão ao médio", ROTAS.varias_acoes.nivel === "medio");
check("importação vai ao forte", ROTAS.importacao.nivel === "forte");
check("a rota de hoje é o leve com todas as ferramentas", ROTA_GERAL.nivel === "leve" && ROTA_GERAL.ferramentas === "todas");
check("o reforço é o médio, e o forte não entra no chat", ROTA_REFORCO.nivel === "medio");
check("o forte fica para a importação", ROTAS.importacao.nivel === "forte");
check("subir: leve → medio → forte → forte", subir("leve") === "medio" && subir("medio") === "forte" && subir("forte") === "forte");
check("uma recusa sobe a rota um nível", rotaDe("presencas", { escalada: true }).nivel === "medio");
check("sem recusa fica como na tabela", rotaDe("presencas").nivel === "leve");
check("lerAcao aceita o JSON do classificador", lerAcao('{"acao":"lesao"}') === "lesao");
check("lerAcao recusa uma ação inventada", lerAcao('{"acao":"apagar_tudo"}') === "conversa");
check("lerAcao nunca devolve importação", lerAcao('{"acao":"importacao"}') === "conversa");
check("lerAcao aguenta lixo", lerAcao("não é json") === "conversa");

const nomesDasFerramentas = FERRAMENTAS.map((f) => (f.type === "function" ? f.name : "")).filter(Boolean);
check("a rota das presenças só vê propor_presencas como escrita", (() => {
  const nomes = ferramentasDe(ROTAS.presencas.ferramentas).map((f) => (f.type === "function" ? f.name : ""));
  return nomes.includes("propor_presencas") && !nomes.includes("propor_lesao") && !nomes.includes("propor_convocatoria");
})());
check("'todas' abre o conjunto inteiro", ferramentasDe("todas").length === FERRAMENTAS.length);
check("todas as ferramentas das rotas existem", Object.values(ROTAS).every((r) => r.ferramentas === "todas" || r.ferramentas.every((n) => nomesDasFerramentas.includes(n))));
check("todas as ferramentas são estritas", FERRAMENTAS.every((f) => f.type === "function" && f.strict === true));

/* ---- Ações da consola ---------------------------------------------------- */

console.log("\nAções");
const campo = (nome: string) => ACOES.marcar_jogo.campos.find((c) => c.nome === nome)!;
check("todas as ações têm permissão e tipo de proposta", Object.values(ACOES).every((a) => a.permissao && a.kind && a.campos.length > 0));
check("marcar jogo exige equipa, dia, hora, adversário, casa/fora, local e prova (nada se assume)", ACOES.marcar_jogo.campos.filter((c) => c.obrigatorio).map((c) => c.nome).join(",") === "equipa,dia,inicio,adversario,casa,local,prova");
check("marcar jogo pergunta pelos balneários", ACOES.marcar_jogo.campos.some((c) => c.nome === "balnearios"));
check("'-' é uma resposta (recusado), vazio não é", respondido("-") && !respondido("") && !respondido(null));
check("'-' lê-se como vazio", (lerValor(campo("local"), "-") as { valor: unknown }).valor === undefined);
check("inscrever atleta exige nome, nascimento e equipa", ACOES.inscrever_atleta.campos.filter((c) => c.obrigatorio).map((c) => c.nome).join(",") === "nome,data_nascimento,equipa");
check("a descrição das ações lista os obrigatórios com *", /marcar_jogo:.*adversario\*/.test(descricaoDasAcoes()));
check("hora 15h vira 15:00", (lerValor(campo("inicio"), "15h") as { valor: string }).valor === "15:00");
check("hora 9.30 vira 09:30", (lerValor(campo("inicio"), "9.30") as { valor: string }).valor === "09:30");
check("hora inválida é erro", lerValor(campo("inicio"), "25:70").ok === false);
check("data dd/mm/aaaa vira ISO", (lerValor(campo("dia"), "14/11/2026") as { valor: string }).valor === "2026-11-14");
check("data ISO fica", (lerValor(campo("dia"), "2026-11-14") as { valor: string }).valor === "2026-11-14");
check("data 'sábado' não se lê (é o modelo que converte)", lerValor(campo("dia"), "sábado").ok === false);
check("'fora' é casa=false", (lerValor(campo("casa"), "fora") as { valor: boolean }).valor === false);
check("vazio é ausente, não erro", lerValor(campo("adversario"), "").ok && (lerValor(campo("adversario"), "") as { valor: unknown }).valor === undefined);
const nif = ACOES.inscrever_atleta.campos.find((c) => c.nome === "nif")!;
check("NIF com espaços fica com 9 algarismos", (lerValor(nif, "123 456 789") as { valor: string }).valor === "123456789");
check("NIF curto é erro", lerValor(nif, "12345").ok === false);
const publico = ACOES.publicar_comunicado.campos.find((c) => c.nome === "publico")!;
check("escolha pelo rótulo", (lerValor(publico, "Famílias") as { valor: string }).valor === "guardians");
check("escolha fora da lista é erro", lerValor(publico, "vizinhos").ok === false);
check("dias da semana por nome", JSON.stringify(lerDiasDaSemana("ter, qui")) === "[2,4]");
check("dias da semana por número", JSON.stringify(lerDiasDaSemana("2,4,6")) === "[2,4,6]");
check("somar 90 minutos às 18:30 dá 20:00", somarMinutos("18:30", 90) === "20:00");

console.log("\nO que a pessoa disse");
const falado = "Marca um jogo dos sub-11 para o próximo sábado às 16 contra os amigos de Quinchães";
const jogo = (n: string) => ACOES.marcar_jogo.campos.find((c) => c.nome === n)!;
check("prova inventada (ZE Distrital) não fica", !foiDito(jogo("prova"), "ZE Distrital", falado));
check("balneário inventado (Balneário 1) não fica", !foiDito(jogo("balnearios"), "Balneário 1", falado));
check("hora de fim inventada (18:54) não fica", !foiDito(jogo("fim"), "18:54", falado));
check("casa/fora não dito não fica", !foiDito(jogo("casa"), true, falado));
check("casa/fora dito fica", foiDito(jogo("casa"), false, `${falado}, é fora`));
check("prova dita fica", foiDito(jogo("prova"), "ZE Distrital", `${falado} para o distrital`));
check("hora de fim dita fica", foiDito(jogo("fim"), "18:00", `${falado} até às 18h`));
check("os balneários só se aplicam em casa", aplicaSe(jogo("balnearios"), { casa: true }) && !aplicaSe(jogo("balnearios"), { casa: false }));
check("treino pergunta quem dá e quem avisa", ACOES.marcar_treino.campos.some((c) => c.nome === "treinador") && ACOES.marcar_treino.campos.some((c) => c.nome === "quem_avisa" && c.obrigatorio));

/* ---- Datas --------------------------------------------------------------- */

console.log("\nDatas");
const data = (valor: string | number, transformacao: "nenhuma" | "data_dmy" | "data_mdy" | "data_ymd" | "ano_de_nascimento" = "nenhuma") =>
  lerData({ valor, transformacao });
check("ISO passa", data("2014-04-03") === "2014-04-03");
check("dd/mm/aaaa por omissão", data("03/04/2014", "data_dmy") === "2014-04-03");
check("mm/dd/aaaa quando mandado", data("03/04/2014", "data_mdy") === "2014-03-04");
check("sem transformação, dia/mês é o normal", data("03/04/2014") === "2014-04-03");
check("25/09 só pode ser dia/mês", data("25/09/2014", "data_mdy") === "2014-09-25");
check("ano de dois dígitos", data("3-4-14", "data_dmy") === "2014-04-03");
check("número de série do Excel", data(41732) === "2014-04-03");
check("só o ano", data("2014", "ano_de_nascimento") === "2014-01-01");
check("31 de fevereiro não existe", data("31/02/2014", "data_dmy") === null);
check("lixo dá nulo", data("ontem") === null);
check("Sub-11 é 11", idadeDoNome("Sub-11") === 11 && idadeDoNome("sub 13 B") === 13 && idadeDoNome("Seniores") === null);

/* ---- Máscaras ------------------------------------------------------------ */

console.log("\nMáscaras");
check("NIF fica em cardinais", mascarar("123456789") === "#########");
check("NIF numérico fica em cardinais", mascarar(123456789) === "#########");
check("email fica genérico", mascarar("ana.braganca@mail.pt") === "x@x.pt");
check("telemóvel fica em cardinais", mascarar("912 345 678") === "### ### ###");
check("data fica", mascarar("03/04/2014") === "03/04/2014");
check("nome fica só com o primeiro e a inicial", mascarar("Martim Bragança Lopes") === "Martim L.");
check("texto curto fica", mascarar("Médio") === "Médio");
check("número pequeno fica", mascarar(7) === 7);

/* ---- Um Excel inteiro ---------------------------------------------------- */

console.log("\nFolha de Excel");
const livro = XLSX.utils.book_new();
const matriz = [
  ["CD Vila Nova", null, null],
  ["Inscritos 2025/26"],
  [],
  ["Nome Completo", "DN", "Escalão", "Contribuinte", "Tlm Mãe", "Mãe", "Obs", "Camisola"],
  ["Martim Bragança", "14/03/2015", "Infantis B", "123456789", "912345678", "Ana Bragança", "pagou em mão", "7"],
  ["Tomás Silva", "25/09/2014", "Infantis B", "987654321", "", "", "", "9"],
  ["Beatriz Couto", "01/02/2016", "Petizes", "111222333", "913333333", "Rita Couto", "", ""],
  ["Sem Data", "", "Petizes", "444555666", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
];
XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet(matriz), "Inscritos");
XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet([["Treinador", "Equipa"], ["João Mister", "Infantis B"]]), "Treinadores");
const bytes = XLSX.write(livro, { type: "buffer", bookType: "xlsx" }) as Buffer;

const folhas = extrairFolhas(bytes, "inscritos.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
check("duas folhas", folhas.length === 2, folhas.map((f) => f.name));
const inscritos = folhas[0];
check("o cabeçalho salta o título do clube", inscritos.headers[0] === "Nome Completo" && inscritos.headers[2] === "Escalão", inscritos.headers);
check("as linhas vazias ficam de fora", inscritos.rows.length === 4, inscritos.rows.length);
const amostra = amostraMascarada(inscritos, 2);
check("a amostra vai mascarada", amostra[0][3] === "#########" && amostra[0][0] === "Martim B." && String(amostra[0][4]).startsWith("###"), amostra[0]);

check("ficheiro desconhecido recusa", (() => { try { extrairFolhas(Buffer.from("x"), "a.bin", "application/octet-stream"); return false; } catch { return true; } })());
check("fotografia ainda não entra", (() => { try { extrairFolhas(Buffer.from("x"), "ficha.jpg", "image/jpeg"); return false; } catch (e) { return String((e as Error).message).includes("Fotografias"); } })());

const mapeamentoBruto: Mapeamento = {
  folhas: [
    {
      nome: "Inscritos",
      entidade: "atletas",
      confianca: "alta",
      colunas: [
        { origem: "Nome Completo", destino: "name", transformacao: "nenhuma", nota: "" },
        { origem: "DN", destino: "birthdate", transformacao: "data_dmy", nota: "" },
        { origem: "Escalão", destino: "team", transformacao: "nenhuma", nota: "" },
        { origem: "Contribuinte", destino: "taxId", transformacao: "nenhuma", nota: "" },
        { origem: "Tlm Mãe", destino: "guardian1Phone", transformacao: "nenhuma", nota: "" },
        { origem: "Mãe", destino: "guardian1Name", transformacao: "nenhuma", nota: "" },
        { origem: "Camisola", destino: "squadNumber", transformacao: "numero", nota: "" },
        { origem: "Coluna que não existe", destino: "email", transformacao: "nenhuma", nota: "" },
      ],
      equipas: [{ origem: "Infantis B", destino: "Sub-12" }, { origem: "Petizes", destino: "nova" }],
      duvidas: [{ coluna: "DN", texto: "Dia/mês ou mês/dia?", opcoes: [{ label: "Dia/mês/ano", transformacao: "data_dmy" }, { label: "Mês/dia/ano", transformacao: "data_mdy" }] }],
    },
    { nome: "Treinadores", entidade: "staff", confianca: "media", colunas: [], equipas: [], duvidas: [] },
  ],
  resumo: "Li duas folhas.",
};
const mapeamento = sanearMapeamento(mapeamentoBruto, folhas);
const mapaInscritos = mapeamento.folhas[0];
check("uma coluna inventada pelo modelo cai", !mapaInscritos.colunas.some((c) => c.origem === "Coluna que não existe"));
check("uma coluna esquecida pelo modelo entra como ignorada", mapaInscritos.colunas.some((c) => c.origem === "Obs" && c.destino === "ignorar"));
check("a dúvida fica", mapaInscritos.duvidas.length === 1);

const clube = {
  equipas: [{ id: "t12", name: "Sub-12", sportId: "fut", sportName: "Futebol" }],
  modalidades: [{ id: "fut", name: "Futebol" }, { id: "fs", name: "Futsal" }],
};
const t = transformarAtletas(inscritos, mapaInscritos, clube);
check("três linhas boas e uma com erro", t.rows.length === 3 && t.errors.length === 1, { rows: t.rows.length, errors: t.errors });
check("o erro diz a linha do ficheiro", t.errors[0].line === 8 && /nascimento/.test(t.errors[0].error), t.errors[0]);
const martim = t.rows.find((r) => r.name === "Martim Bragança")!;
check("a data saiu em ISO", martim.birthdate === "2015-03-14");
check("Infantis B ficou no Sub-12 existente", martim.teamId === "t12" && martim.teamName === "Sub-12");
check("o NIF e o número entram", martim.taxId === "123456789" && martim.squadNumber === 7);
check("o encarregado entra com nome e telemóvel", martim.encarregados?.[0]?.nome === "Ana Bragança" && martim.encarregados?.[0]?.telefone === "912345678", martim.encarregados);
check("Tomás sem encarregado não leva lista vazia", t.rows.find((r) => r.name === "Tomás Silva")?.encarregados === undefined);
check("Petizes é equipa nova, sem teamId, com a modalidade do clube", t.equipasNovas.length === 1 && t.equipasNovas[0].name === "Petizes" && t.equipasNovas[0].sportId === "fut" && t.rows.find((r) => r.name === "Beatriz Couto")?.teamId === undefined, t.equipasNovas);
check("a idade da equipa nova vem dos nascimentos", t.equipasNovas[0].maxAge === new Date().getFullYear() - 2016, t.equipasNovas[0].maxAge);
check("a transformação é determinística", JSON.stringify(transformarAtletas(inscritos, mapaInscritos, clube)) === JSON.stringify(t));

/* ---- Segurança ----------------------------------------------------------- */

console.log("\nSegurança");
// O tipo `Permission` já obriga a que cada permissão exista (o TypeScript recusa uma inventada); aqui só se garante que nenhuma ação fica sem ela.
check(
  "todas as ações exigem uma permissão de escrita",
  Object.values(ACOES).every((a) => /^[a-z]+:(write|request)$/.test(a.permissao) && (a.permissoesAlternativas ?? []).every((p) => /:write$/.test(p))),
  Object.values(ACOES).filter((a) => !/:write$/.test(a.permissao)).map((a) => `${a.nome}: ${a.permissao}`),
);
check("sem a permissão não se faz", !podeFazer(ACOES.criar_produto_na_loja, () => false) && podeFazer(ACOES.criar_produto_na_loja, (p) => p === "website:write"));
check("a permissão alternativa serve (patrocinadores da Gestão ou do Website)", podeFazer(ACOES.adicionar_patrocinador, (p) => p === "website:write") && podeFazer(ACOES.adicionar_patrocinador, (p) => p === "sponsor:write") && !podeFazer(ACOES.adicionar_patrocinador, (p) => p === "athlete:write"));
check("as ações do site exigem o site no plano", ["mostrar_seccao_do_site", "criar_produto_na_loja", "abrir_bilheteira", "por_site_no_ar"].every((n) => ACOES[n].precisaDoSite === true) && !ACOES.adicionar_patrocinador.precisaDoSite);
const parametros = FERRAMENTAS.flatMap((f) => (f.type === "function" ? Object.keys(((f.parameters as { properties?: Record<string, unknown> }).properties ?? {})) : []));
check("nenhuma ferramenta aceita o clube, a conta ou a pessoa por parâmetro", !parametros.some((p) => /academy|clube|slug|membership|userId|role/i.test(p)), parametros);
check("nenhum campo de ação aceita o clube ou a conta", !Object.values(ACOES).some((a) => a.campos.some((c) => /academy|clube|slug|membership|userId/i.test(c.nome))));
check("um campo de escolha do site lê-se como texto (o servidor resolve pelo id ou pelo nome)", lerValor({ nome: "produto", rotulo: "Produto", tipo: "produto", obrigatorio: true }, "Cachecol") .ok);

/* ---- Exercício sozinho vs plano ------------------------------------------ */

console.log("\nExercício sozinho");
check("criar um exercício não pede treino nem dia", !ACOES.criar_exercicio.campos.some((c) => c.tipo === "treino" || c.nome === "dia"));
check("criar um exercício não mexe em planos (tipo próprio)", ACOES.criar_exercicio.kind === "EXERCISE" && ACOES.planear_treino.kind === "TRAINING_PLAN");
check("só a equipa e o que trabalhar são obrigatórios", ACOES.criar_exercicio.campos.filter((c) => c.obrigatorio).map((c) => c.nome).join(",") === "equipa,foco");
check("as duas descrições dizem qual é qual", ACOES.criar_exercicio.descricao.includes("sem o pôr em treino nenhum") && ACOES.planear_treino.descricao.includes("um exercício sozinho é criar_exercicio"));
const exLido = lerExercicioNovo({ nome: "Rondo 4v2", descricao: "Num quadrado.", meioCampo: false, minutos: null, frames: [{ nota: null, itens: [{ tipo: "player", x: 40, y: 40, w: null, h: null, rot: null, etiqueta: "1", cor: null }], setas: [] }] }, "f7", 12);
check("o exercício lê-se com o desenho e a duração por omissão", exLido?.name === "Rondo 4v2" && exLido?.durationMin === 12 && exLido?.diagram?.field === "f7");
check("sem nome não há exercício", lerExercicioNovo({ descricao: "x" }, "f7", null) === null);

/* ---- Valores por omissão ------------------------------------------------- */

console.log("\nValores por omissão");
check("a notícia não pergunta o destaque", ACOES.publicar_noticia.campos.find((c) => c.nome === "destaque")?.omissao === "não");
check(
  "nenhum campo que custa caro tem omissão (local, prova, balneário, tipo de evento, hora de fim, casa ou fora)",
  !Object.values(ACOES).some((a) => a.campos.some((c) => c.omissao !== undefined && (["local", "prova", "balneario", "tipoEvento"].includes(c.tipo) || ["fim", "casa"].includes(c.nome)))),
);
check("nenhum obrigatório tem omissão (esses perguntam-se)", !Object.values(ACOES).some((a) => a.campos.some((c) => c.obrigatorio && c.omissao !== undefined)));
check("a descrição diz ao modelo que não pergunte o que tem omissão", descricaoDasAcoes().includes("se não for dito: não, não perguntes"));
check("o valor por omissão lê-se como o tipo manda", (lerValor(ACOES.publicar_noticia.campos.find((c) => c.nome === "destaque")!, "não") as { valor: unknown }).valor === false);

/* ---- Planos de treino ---------------------------------------------------- */

console.log("\nPlanos de treino");
check("sub-11 de futebol joga a 7", terrenoDaEquipa({ sportName: "Futebol", maxAge: 11 }) === "f7");
check("sub-7 joga a 5, sub-13 a 9, sub-15 a 11", terrenoDaEquipa({ sportName: "Futebol", maxAge: 7 }) === "f5" && terrenoDaEquipa({ sportName: "Futebol", maxAge: 13 }) === "f9" && terrenoDaEquipa({ sportName: "Futebol", maxAge: 15 }) === "f11");
check("a disciplina manda: basquetebol e futsal", terrenoDaEquipa({ sportCode: "basketball", sportName: "Basquetebol", maxAge: 11 }) === "basket" && terrenoDaEquipa({ sportName: "Futsal", maxAge: 17 }) === "futsal");
check("o número no nome da modalidade manda", terrenoDaEquipa({ sportName: "Futebol 7", maxAge: 17 }) === "f7");
check("baliza à esquerda vira 270, à direita 90", rotacaoDaBaliza(0, 34, 105, 68) === 270 && rotacaoDaBaliza(105, 34, 105, 68) === 90);
check("baliza em cima 0, em baixo 180", rotacaoDaBaliza(50, 0, 105, 68) === 0 && rotacaoDaBaliza(50, 68, 105, 68) === 180);

let n = 0;
const idFixo = () => `id${++n}`;
const desenho = lerDesenho(
  [
    {
      nota: "Montagem",
      itens: [
        { tipo: "player", x: 50, y: 50, w: null, h: null, rot: null, etiqueta: "7", cor: "azul" },
        { tipo: "player", x: 150, y: -5, w: null, h: null, rot: null, etiqueta: null, cor: "vermelho" },
        { tipo: "gk", x: 98, y: 50, w: null, h: null, rot: null, etiqueta: null, cor: null },
        { tipo: "goal", x: 100, y: 50, w: null, h: null, rot: null, etiqueta: null, cor: null },
        { tipo: "zone", x: 60, y: 30, w: 20, h: 40, rot: null, etiqueta: "Área", cor: null },
        { tipo: "nave", x: 10, y: 10, w: null, h: null, rot: null, etiqueta: null, cor: null },
      ],
      setas: [
        { tipo: "pass", x1: 50, y1: 50, x2: 80, y2: 50 },
        { tipo: "pass", x1: 50, y1: 50, x2: 50, y2: 50 },
        { tipo: "voo", x1: 0, y1: 0, x2: 10, y2: 10 },
      ],
    },
  ],
  "f7",
  true,
  idFixo,
);
check("o desenho sai em metros do futebol de 7 (55×37)", desenho?.frames[0].items[0].x === 27.5 && desenho?.frames[0].items[0].y === 18.5, desenho?.frames[0].items[0]);
check("meio campo fica no terreno", desenho?.field === "f7-half");
check("uma peça fora do campo é posta dentro", desenho?.frames[0].items[1].x === 55 && desenho?.frames[0].items[1].y === 0);
check("o azul do jogador não se grava; o vermelho sim", desenho?.frames[0].items[0].color === undefined && desenho?.frames[0].items[1].color === "#b3261e");
check("a baliza à direita vira para o campo", desenho?.frames[0].items[3].kind === "goal" && desenho?.frames[0].items[3].rot === 90);
check("a zona leva largura e altura em metros", desenho?.frames[0].items[4].w === 11 && desenho?.frames[0].items[4].h === 14.8);
check("uma peça desconhecida sai", desenho?.frames[0].items.length === 5);
check("uma seta sem comprimento e uma de tipo desconhecido saem", desenho?.frames[0].arrows.length === 1);
check("sem peças não há desenho", lerDesenho([{ nota: null, itens: [], setas: [] }], "f11", false, idFixo) === null);
const peca = (id: string | null, tipo: string, x: number, y: number) => ({ id, tipo, x, y, w: null, h: null, rot: null, etiqueta: null, cor: null });
const animado = lerDesenho(
  [
    { nota: "Montagem", itens: [peca("j1", "playerBall", 40, 40), peca("j2", "player", 60, 40), peca("c1", "cone", 30, 30)], setas: [{ tipo: "pass", x1: 40, y1: 40, x2: 60, y2: 40 }] },
    { nota: "Passe", itens: [peca("j1", "player", 45, 45), peca("j2", "playerBall", 60, 40), peca("c1", "cone", 30, 30)], setas: [] },
  ],
  "f7",
  false,
  idFixo,
);
const [m1, m2] = animado?.frames ?? [];
check("o desenho guarda os momentos todos", animado?.frames.length === 2);
check("a mesma peça tem o mesmo id nos dois momentos (é o que anima)", m1?.items[1].id === m2?.items[1].id && m1?.items[2].id === m2?.items[2].id, { m1: m1?.items.map((i) => i.id), m2: m2?.items.map((i) => i.id) });
check("o jogador que recebe a bola continua a ser o mesmo (jogador ↔ jogador com bola)", m1?.items[0].id === m2?.items[0].id && m2?.items[1].kind === "playerBall");
check("peças diferentes têm ids diferentes", new Set(m1?.items.map((i) => i.id)).size === 3);
const repetido = lerDesenho([{ nota: null, itens: [peca("j1", "player", 10, 10), peca("j1", "player", 20, 20), peca(null, "cone", 30, 30)], setas: [] }], "f7", false, idFixo);
check("um id repetido no mesmo momento e uma peça sem id ficam com ids próprios", new Set(repetido?.frames[0].items.map((i) => i.id)).size === 3);

const plano = lerPlanoGerado(
  {
    objetivo: "Condição física por jogo",
    objetivos: ["Velocidade", "Agilidade"],
    tipo: "Aquisitivo",
    intensidade: 7,
    material: "Cones, bolas, coletes",
    notas: null,
    blocos: [
      { nome: "Ativação com bola", minutos: 12, categoria: "Físico", objetivo: null, intensidade: 4, jogadores: null, espaco: null, material: null, notas: null, exercicioId: "ex1", novo: null },
      { nome: "Estafetas", minutos: 15, categoria: "Físico", objetivo: "Velocidade", intensidade: 8, jogadores: "3 grupos", espaco: null, material: null, notas: null, exercicioId: "ex-que-nao-existe", novo: null },
      {
        nome: "Jogo 4v4",
        minutos: 20,
        categoria: "Transições",
        objetivo: null,
        intensidade: 8,
        jogadores: "4v4",
        espaco: "30×20 m",
        material: null,
        notas: null,
        exercicioId: null,
        novo: { nome: "Jogo 4v4 com mini-balizas", descricao: "Dois campos.", tipo: "Jogo reduzido", categoria: "Transições", jogadores: "4v4", espaco: "30×20 m", material: "4 mini-balizas", regras: null, pontosDeTreino: "Reação à perda", errosComuns: null, progressoes: null, regressoes: null, intensidade: 8, minutos: 20, idadeMin: 9, idadeMax: 12, complexidade: 2, meioCampo: false, frames: [{ nota: null, itens: [{ tipo: "player", x: 20, y: 50, w: null, h: null, rot: null, etiqueta: "1", cor: null }], setas: [] }] },
      },
      { nome: "", minutos: 5, categoria: null, objetivo: null, intensidade: null, jogadores: null, espaco: null, material: null, notas: null, exercicioId: null, novo: null },
    ],
  },
  "f7",
  new Set(["ex1"]),
  idFixo,
);
check("o plano lê-se", plano.ok, plano);
if (plano.ok) {
  check("a sessão leva objetivo, tipo e intensidade", plano.plano.sessao.objective === "Condição física por jogo" && plano.plano.sessao.sessionType === "Aquisitivo" && plano.plano.sessao.intensity === 7);
  check("um bloco sem nome sai", plano.plano.blocos.length === 3);
  check("um exercício da biblioteca fica pelo id", plano.plano.blocos[0].exerciseId === "ex1" && plano.plano.blocos[0].novo === null);
  check("um id que não é da biblioteca cai, com aviso", plano.plano.blocos[1].exerciseId === null && plano.avisos.length === 1, plano.avisos);
  check("o exercício novo leva a ficha e o desenho", plano.plano.blocos[2].novo?.name === "Jogo 4v4 com mini-balizas" && plano.plano.blocos[2].novo?.diagram?.field === "f7" && plano.plano.blocos[2].novo?.coachingPoints === "Reação à perda");
}
check("sem blocos é um erro, não um plano vazio", !lerPlanoGerado({ objetivo: "x", blocos: [] }, "f11", new Set()).ok);
check("o esquema é estrito em todos os níveis", JSON.stringify(ESQUEMA_DO_PLANO).split('"type":"object"').length - 1 === JSON.stringify(ESQUEMA_DO_PLANO).split('"additionalProperties":false').length - 1);
const pedido = pedidoDoPlaneador({ clube: "AD Fafe", equipa: "Sub-11", idade: 11, modalidade: "Futebol", terreno: "f7", quando: "quinta-feira, 13 de novembro, 18:00", duracaoMin: 75, foco: "físico, puxado", usarBiblioteca: null, biblioteca: [{ id: "ex1", nome: "Rondo 4v2", categoria: "Técnico", tipo: "Posse", minutos: 10, jogadores: "4v2", intensidade: 5, idadeMin: 9, idadeMax: 12, descricao: null, comDesenho: true }], pesquisar: true });
check("o pedido leva a equipa, o terreno, a biblioteca e a pesquisa", pedido.includes("sub-11") && pedido.includes("55×37") && pedido.includes("ex1: Rondo 4v2") && pedido.includes("Procura na internet"));

console.log(`\n${ok} ok, ${falhas} ${falhas === 1 ? "falha" : "falhas"}`);
if (falhas > 0) process.exit(1);
