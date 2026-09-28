import { createHash } from "node:crypto";
import { jsPDF } from "jspdf";
import { formatarNoFuso } from "../common/fuso";
import { periodoMinimoPorExtenso } from "./condicoes";

/**
 * A declaração de aceitação das condições de subscrição.
 *
 * ## Porque é que existe
 *
 * Assinar as condições era um clique. Ficava registado quem, quando e de onde —
 * mas não **em nome de que instituição** nem com que identificação de quem a
 * representa. Um contrato com um clube tem de dizer as duas coisas: a pessoa
 * colectiva que se vincula (nome e NIF) e a pessoa singular que a representa
 * (nome, NIF e data de nascimento).
 *
 * Com isso gera-se uma declaração em PDF no momento da assinatura, que fica
 * anexada à ordem e se descarrega na consola e na plataforma. É gerada uma vez e
 * guardada tal como saiu, com a impressão digital SHA-256: uma declaração que
 * se voltasse a gerar a cada download podia mudar de texto com o código.
 */

/* -------------------------------------------------------------------------- */
/* Validação                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Um NIF português com o dígito de controlo certo.
 *
 * Só a regra do módulo 11, sem olhar ao primeiro algarismo: os prefixos
 * (1–3 pessoas singulares, 5 pessoas colectivas, 6 organismos públicos…) têm
 * excepções que mudam com o tempo, e recusar um NIF verdadeiro num contrato é
 * pior do que aceitar um prefixo raro.
 */
export function nifValido(nif: string): boolean {
  if (!/^\d{9}$/.test(nif)) return false;
  const d = nif.split("").map(Number);
  const soma = d.slice(0, 8).reduce((s, x, i) => s + x * (9 - i), 0);
  const resto = soma % 11;
  const controlo = resto < 2 ? 0 : 11 - resto;
  return d[8] === controlo;
}

export type DadosDaDeclaracao = {
  institutionName: string;
  institutionTaxId: string;
  signerName: string;
  signerTaxId: string;
  /** `AAAA-MM-DD`. */
  signerBirthdate: string;
  accepted: boolean;
};

const limpo = (v: string) => v.replace(/[\s.]/g, "");

/**
 * O que veio do formulário, arrumado — ou o que está mal, dito a quem o escreveu.
 *
 * Devolve texto e não uma excepção para o serviço decidir o código HTTP, e para
 * os testes poderem perguntar pela mensagem.
 */
export function validarDeclaracao(
  d: DadosDaDeclaracao,
  hoje: Date,
): { ok: true; dados: DadosDaDeclaracao & { nascimento: Date } } | { ok: false; erro: string } {
  const institutionName = d.institutionName.trim().replace(/\s+/g, " ");
  const signerName = d.signerName.trim().replace(/\s+/g, " ");
  const institutionTaxId = limpo(d.institutionTaxId);
  const signerTaxId = limpo(d.signerTaxId);

  if (!d.accepted) return { ok: false, erro: "Falta aceitar as condições e os Termos de Serviço." };
  if (institutionName.length < 3) return { ok: false, erro: "Escreve o nome da instituição." };
  if (!nifValido(institutionTaxId)) return { ok: false, erro: "O NIF da instituição não é válido." };
  if (signerName.split(" ").length < 2) return { ok: false, erro: "Escreve o nome completo do representante." };
  if (!nifValido(signerTaxId)) return { ok: false, erro: "O NIF do representante não é válido." };
  if (signerTaxId === institutionTaxId) {
    return { ok: false, erro: "O NIF do representante tem de ser o dele, e não o da instituição." };
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.signerBirthdate);
  if (!m) return { ok: false, erro: "Escreve a data de nascimento do representante." };
  const nascimento = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (nascimento.getUTCDate() !== Number(m[3])) return { ok: false, erro: "A data de nascimento não existe." };
  /*
   * Maior de idade, no dia da assinatura. Quem representa uma instituição num
   * contrato tem de o poder fazer — e uma data no futuro é sempre engano.
   */
  const dezoito = new Date(Date.UTC(nascimento.getUTCFullYear() + 18, nascimento.getUTCMonth(), nascimento.getUTCDate()));
  if (dezoito > hoje) return { ok: false, erro: "O representante tem de ser maior de idade." };
  if (nascimento.getUTCFullYear() < 1900) return { ok: false, erro: "A data de nascimento não parece certa." };

  return {
    ok: true,
    dados: { institutionName, institutionTaxId, signerName, signerTaxId, signerBirthdate: d.signerBirthdate, accepted: true, nascimento },
  };
}

/* -------------------------------------------------------------------------- */
/* O PDF                                                                       */
/* -------------------------------------------------------------------------- */

export type ConteudoDaDeclaracao = {
  institutionName: string;
  institutionTaxId: string;
  signerName: string;
  signerTaxId: string;
  signerBirthdate: Date;
  signerEmail: string | null;
  signerTitle: string | null;
  signedAt: Date;
  signerIp: string | null;
  orderId: string;
  planName: string;
  annual: boolean;
  amountCents: number;
  listMonthlyCents: number;
  discountPct: number;
  startsOn: Date;
  minimumMonths: number;
  renewalNote: string | null;
  notes: string | null;
  termsVersion: string | null;
  termsHash: string | null;
};

/*
 * O Intl põe um espaço inquebrável entre o número e o símbolo. As fontes base
 * do PDF sabem desenhar o normal (U+00A0) mas não o estreito (U+202F), que
 * sairia como um quadrado. Trocam-se os dois por um espaço simples.
 */
const euros = (cents: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" })
    .format(cents / 100)
    .replace(/[  ]/g, " ");

/** Uma data de calendário (coluna DATE), sem fuso: 3 de outubro de 2026. */
function diaDeCalendario(d: Date): string {
  const meses = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  return `${d.getUTCDate()} de ${meses[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

/*
 * O NIF escreve-se seguido. Separado em três grupos ficava mais legível, mas o
 * texto da declaração quebra linhas nos espaços, e um NIF partido entre duas
 * linhas ("n.º 500 / 000 000") é exactamente o que não se quer num contrato.
 */
const nifLegivel = (n: string) => n;

/** "::ffff:83.132.1.9" é um IPv4 escrito à maneira do IPv6; tira-se o prefixo. */
const ipLegivel = (ip: string) => ip.replace(/^::ffff:/, "");

/** O preço, dito como no contrato e no email. */
export function precoPorExtenso(c: Pick<ConteudoDaDeclaracao, "annual" | "amountCents" | "listMonthlyCents" | "discountPct">): string {
  const base = `${euros(c.amountCents)} ${c.annual ? "por ano" : "por mês"}`;
  if (c.discountPct <= 0) return base + ", IVA incluído";
  const mensal = c.annual ? Math.round(c.amountCents / 12) : c.amountCents;
  return `${base}, IVA incluído (${euros(mensal)}/mês em vez de ${euros(c.listMonthlyCents)}, menos ${c.discountPct}%)`;
}

/**
 * Gera o PDF. Devolve os bytes e a impressão digital deles.
 *
 * A4, uma página no caso normal. O texto quebra-se à largura da página; as
 * observações compridas empurram o resto para baixo, e uma página nova abre-se
 * se for preciso.
 */
export function gerarDeclaracaoPdf(c: ConteudoDaDeclaracao): { pdf: Uint8Array<ArrayBuffer>; sha256: string } {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const M = 20;
  const L = 210 - M * 2;
  let y = 22;

  const quebra = (altura: number) => {
    if (y + altura > 280) {
      doc.addPage();
      y = 22;
    }
  };
  const paragrafo = (texto: string, tamanho = 10.5, estilo: "normal" | "bold" = "normal", cor = 30) => {
    doc.setFont("helvetica", estilo);
    doc.setFontSize(tamanho);
    doc.setTextColor(cor);
    const linhas = doc.splitTextToSize(texto, L) as string[];
    const alto = linhas.length * tamanho * 0.42;
    quebra(alto);
    doc.text(linhas, M, y);
    y += alto + 2;
  };
  const titulo = (texto: string) => {
    y += 3;
    quebra(10);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(texto.toUpperCase(), M, y);
    y += 2;
    doc.setDrawColor(210);
    doc.line(M, y, M + L, y);
    y += 5;
  };
  const linha = (rotulo: string, valor: string) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    const valores = doc.splitTextToSize(valor, L - 52) as string[];
    const alto = Math.max(1, valores.length) * 4.2;
    quebra(alto + 1.5);
    doc.setTextColor(110);
    doc.text(rotulo, M, y);
    doc.setTextColor(30);
    doc.text(valores, M + 52, y);
    y += alto + 1.5;
  };

  /* Cabeçalho */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text("ACADEMIAS", M, y);
  y += 8;
  paragrafo("Declaração de aceitação das condições de subscrição", 16, "bold", 20);
  y += 2;

  /* A declaração */
  paragrafo(
    `${c.signerName}, contribuinte n.º ${nifLegivel(c.signerTaxId)}, com data de nascimento a ` +
      `${diaDeCalendario(c.signerBirthdate)}, na qualidade de representante de ${c.institutionName}, ` +
      `pessoa colectiva n.º ${nifLegivel(c.institutionTaxId)}, declara que:`,
  );
  y += 1;
  paragrafo("1.  Tem poderes para representar a instituição e para a vincular a este contrato.");
  paragrafo(
    "2.  Aceita, em nome da instituição, as condições de subscrição da plataforma Academias descritas abaixo e os " +
      `Termos de Serviço${c.termsVersion ? `, versão ${c.termsVersion}` : ""}, de que fazem parte o Acordo de ` +
      "Tratamento de Dados e a Política de Utilização Aceitável.",
  );
  paragrafo("3.  Os dados de identificação acima são verdadeiros.");

  /* As condições */
  titulo("Condições aceites");
  linha("Plano", c.planName);
  linha("Preço", precoPorExtenso(c));
  linha("Periodicidade", c.annual ? "Anual" : "Mensal");
  linha("Data de início", diaDeCalendario(c.startsOn));
  linha("Período contratual mínimo", periodoMinimoPorExtenso(c.minimumMonths));
  if (c.renewalNote) linha("Renovação", c.renewalNote);
  if (c.notes?.trim()) linha("Observações", c.notes.trim());

  /* O registo */
  titulo("Registo da aceitação");
  linha(
    "Data e hora",
    formatarNoFuso(c.signedAt, {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }) + " (hora de Lisboa)",
  );
  if (c.signerEmail) linha("Conta usada", c.signerEmail);
  if (c.signerTitle) linha("Cargo na plataforma", c.signerTitle);
  if (c.signerIp) linha("Endereço IP", ipLegivel(c.signerIp));
  linha("Referência da ordem", c.orderId);
  if (c.termsHash) linha("Termos de Serviço (SHA-256)", c.termsHash);

  /* Rodapé */
  y += 6;
  paragrafo(
    "Documento gerado pela plataforma Academias no momento da aceitação, a partir dos dados escritos pelo " +
      "representante. Fica anexado às condições de subscrição e pode ser descarregado na consola do clube. academias.pt",
    8.5,
    "normal",
    120,
  );

  // `Uint8Array` sobre o `ArrayBuffer` do jsPDF: é o tipo que o Prisma pede
  // para uma coluna `Bytes`, e um `Buffer` pode assentar num buffer partilhado.
  const pdf = new Uint8Array(doc.output("arraybuffer"));
  return { pdf, sha256: createHash("sha256").update(pdf).digest("hex") };
}

/** O nome do ficheiro: `declaracao-ad-fafe-2026-09-28.pdf`. */
export function nomeDoFicheiro(slug: string, signedAt: Date): string {
  return `declaracao-${slug}-${signedAt.toISOString().slice(0, 10)}.pdf`;
}
