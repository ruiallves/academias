/**
 * PHC GO (Cegid) — o conector, pela "API Simples".
 *
 * O PHC GO é a versão na nuvem do PHC; o PHC CS e o PHC Evolution vivem no
 * servidor do clube e não têm API a que se chegue daqui. Este conector é só
 * para o GO.
 *
 * ## Como se liga
 *
 * Nós registamo-nos uma vez como programadores no PHC GO e ficamos com um
 * `AppID` (`PHC_GO_APP_ID` no ambiente). O clube regista esse AppID na
 * instalação dele ("Aplicações externas licenciadas") e dá-nos o endereço
 * da instalação (`https://sisNN.phcgo.net/<nome>`), um utilizador para a API
 * e a palavra-passe. Com isso pede-se um token sem prazo (`tokenLifeTime:
 * "Never"`), que fica guardado com as credenciais.
 *
 * Tudo são POSTs em JSON a `https://interface.phcsoftware.com/v3/<método>`,
 * com o token no cabeçalho `Authorization` (sem "Bearer"). Cada chamada gasta
 * pedidos do pacote mensal do clube: uma fatura-recibo com PDF são 12.
 *
 * `createDocument` cria o cliente, emite a fatura-recibo (a série do clube,
 * pelo `ndoc`) e, com `option: 1`, assina e devolve o link do PDF, que se
 * descarrega logo: a validade do link não está documentada. O email sai por
 * nós, como nos outros programas.
 *
 * Documentação: helpcenter.phcgo.net (API Simples: generateAccessToken,
 * createDocument, fetchDocument, searchEntities, cancelDocument).
 */
import type { InvoicingProvider } from "@prisma/client";
import { descarregar, pedir } from "./http";
import { diaPt, observacoes } from "./documento";
import {
  ErroDeFaturacao,
  type Conector,
  type Credenciais,
  type DefinicoesDaConta,
  type DocumentoAFaturar,
  type Emitido,
  type Opcoes,
  type TipoDeVenda,
} from "./tipos";

const PROGRAMA = "O PHC GO";
const BASE = "https://interface.phcsoftware.com/v3";

/** As referências dos artigos nossos no PHC GO. Curtas: o campo é pequeno. */
const REFERENCIA: Record<TipoDeVenda, string> = {
  MENSALIDADE: "AC-MENS",
  EXTRA: "AC-EXTRA",
  QUOTA: "AC-QUOTA",
  BILHETE: "AC-BILH",
  LOJA: "AC-LOJA",
  ENVIO: "AC-ENVIO",
  TAXA: "AC-TAXA",
};

type Cred = Extract<Credenciais, { provider: "PHC_GO" }>;
type Resposta = { code?: number; message?: string } & Record<string, unknown>;

export class PhcGo implements Conector {
  readonly provider: InvoicingProvider = "PHC_GO";

  constructor(private readonly app: { appId: string }) {}

  get disponivel(): boolean {
    return Boolean(this.app.appId);
  }

  private cred(c: Credenciais): Cred {
    if (c.provider !== "PHC_GO") throw new ErroDeFaturacao("Credenciais de outro programa", true);
    return c;
  }

  private async chamar(c: Cred, metodo: string, corpo: Record<string, unknown>, comToken = true): Promise<Resposta> {
    if (comToken && !c.token) throw new ErroDeFaturacao("O PHC GO ainda não deu um token a este clube. Volta a ligar a faturação.", true);
    const r = await pedir(
      `${BASE}/${metodo}`,
      { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", ...(comToken ? { Authorization: c.token! } : {}) }, body: JSON.stringify(corpo) },
      PROGRAMA,
    );
    if (r.status === 429) throw new ErroDeFaturacao("O PHC GO pediu para abrandar. Voltamos a tentar mais tarde.", false);
    if (r.status >= 500) throw new ErroDeFaturacao("O PHC GO está com problemas. Voltamos a tentar mais tarde.", false, r.texto.slice(0, 300));
    if (r.status === 401 || r.status === 403) throw new ErroDeFaturacao("O PHC GO recusou o acesso: confirma o utilizador, a palavra-passe e o registo da nossa aplicação no clube.", true, r.texto.slice(0, 300));
    const j = (r.json ?? {}) as Resposta;
    if (r.status !== 200) throw new ErroDeFaturacao(`O PHC GO respondeu ${r.status} a ${metodo}: ${j.message ?? r.texto.slice(0, 160)}.`, true, r.texto.slice(0, 500));
    return j;
  }

  /** `code 100` é erro no PHC GO; `code 50` é "gravado mas a impressão falhou". */
  private erro(j: Resposta, oQue: string): ErroDeFaturacao {
    const msg = String(j.message ?? "sem mensagem");
    const quota = /limit|limite|pack|pacote/i.test(msg);
    return new ErroDeFaturacao(
      quota ? `O PHC GO suspendeu a API do clube (pacote de pedidos esgotado): ${msg}.` : `O PHC GO recusou ${oQue}: ${msg}.`,
      true,
      JSON.stringify(j).slice(0, 500),
    );
  }

  async verificar(cred: Credenciais): Promise<{ nome: string; cred: Credenciais }> {
    const c = this.cred(cred);
    const backendUrl = c.backendUrl.trim().replace(/\/$/, "");
    if (!/^https:\/\/[a-z0-9.-]+\.phcgo\.net\/[A-Za-z0-9_-]+$/i.test(backendUrl)) {
      throw new ErroDeFaturacao("O endereço da instalação tem a forma https://sisNN.phcgo.net/nome-da-instalacao.", true);
    }
    const j = await this.chamar(
      c,
      "generateAccessToken",
      { credentials: { backendUrl, appId: this.app.appId, userCode: c.userCode.trim(), password: c.password, ...(c.company.trim() ? { company: c.company.trim() } : {}), tokenLifeTime: "Never" } },
      false,
    );
    const token = typeof j.token === "string" ? j.token : "";
    if (Number(j.code) !== 0 || !token) throw new ErroDeFaturacao(`O PHC GO não deu acesso: ${j.message ?? "sem mensagem"}. Confirma o utilizador, a palavra-passe e o registo da nossa aplicação.`, true);
    return { nome: backendUrl.split("/").pop() ?? "PHC GO", cred: { ...c, backendUrl, token } };
  }

  /** As séries de faturação da instalação: as de fatura-recibo (`tiposaft` FR) para emitir, a primeira de nota de crédito para anular. */
  async opcoes(cred: Credenciais): Promise<Opcoes> {
    const series = await this.series(this.cred(cred));
    return {
      series: series
        .filter((s) => s.tipo === "FR")
        .map((s) => ({ id: String(s.ndoc), label: s.nome, detalhe: `série ${s.ndoc}`, porOmissao: s.ndoc === 2 })),
    };
  }

  private async series(c: Cred): Promise<{ ndoc: number; nome: string; tipo: string }[]> {
    const j = await this.chamar(c, "searchEntities", {
      queryObject: {
        entityName: "Td",
        filterItems: [{ filterItem: "inactivo", comparison: 0, valueItem: "0", groupItem: 0 }],
        SelectItems: ["ndoc", "nmdoc", "tiposaft"],
        limit: 100,
        offset: 0,
      },
    });
    if (Number(j.code) !== 0) throw this.erro(j, "a lista de séries");
    const entidades = (Array.isArray(j.entities) ? j.entities : []) as Record<string, unknown>[];
    return entidades.map((e) => ({ ndoc: Number(e.ndoc), nome: String(e.nmdoc ?? e.ndoc), tipo: String(e.tiposaft ?? "").toUpperCase() })).filter((s) => s.ndoc > 0);
  }

  porDefinir(def: DefinicoesDaConta): string[] {
    return def.serieId ? [] : ["a série de fatura-recibo"];
  }

  /** Guarda a série das notas de crédito (para anular) e tenta criar os artigos nossos, uma vez. */
  async preparar(cred: Credenciais, def: DefinicoesDaConta): Promise<DefinicoesDaConta> {
    const c = this.cred(cred);
    const interno: Record<string, string> = { ...(def.interno ?? {}) };
    const series = await this.series(c);
    const nc = series.find((s) => s.tipo === "NC");
    if (nc) interno.ncSerie = String(nc.ndoc);
    /*
     * Os artigos. A documentação pública não diz se uma referência
     * desconhecida numa linha cria o artigo; cria-se aqui por via das
     * dúvidas, e um "já existe" é bom sinal. Se o método não existir nesta
     * instalação, as linhas dizem-no na primeira emissão.
     */
    if (!interno.artigos) {
      for (const [tipo, reference] of Object.entries(REFERENCIA)) {
        await this.chamar(c, "createProduct", { product: { reference, designation: nomeDoArtigo(tipo as TipoDeVenda), unitPrice: 0, taxPercentage: 23, type: "S" } }).catch(() => undefined);
      }
      interno.artigos = "1";
    }
    interno.preparadoEm = new Date().toISOString();
    return { ...def, interno };
  }

  async procurar(cred: Credenciais, def: DefinicoesDaConta, referencia: string): Promise<Emitido | null> {
    const c = this.cred(cred);
    if (!def.serieId) return null;
    try {
      const j = await this.chamar(c, "searchEntities", {
        queryObject: {
          entityName: "Ft",
          ndoc: Number(def.serieId),
          filterItems: [
            { filterItem: "ndoc", comparison: 0, valueItem: def.serieId, groupItem: 1 },
            { filterItem: "obs", comparison: 10, valueItem: referencia, groupItem: 0 },
          ],
          SelectItems: ["fno", "ftstamp", "nmdoc", "ftano", "anulado"],
          limit: 5,
          offset: 0,
        },
      });
      const e = ((Array.isArray(j.entities) ? j.entities : []) as Record<string, unknown>[]).find((x) => !Number(x.anulado));
      if (!e) return null;
      return this.emitidoDe(Number(def.serieId), e);
    } catch {
      return null;
    }
  }

  async emitir(cred: Credenciais, def: DefinicoesDaConta, doc: DocumentoAFaturar): Promise<Emitido> {
    const c = this.cred(cred);
    if (!def.serieId) throw new ErroDeFaturacao("Falta escolher a série de fatura-recibo nas Definições › Faturação.", true);

    const j = await this.chamar(c, "createDocument", {
      customer: {
        name: doc.cliente.nome.slice(0, 80),
        ...(doc.cliente.nif ? { taxNumber: doc.cliente.nif } : {}),
        ...(doc.cliente.email ? { email: doc.cliente.email } : {}),
        country: "PT",
        address: doc.cliente.morada ?? "",
        postalCode: doc.cliente.codigoPostal ?? "",
        city: doc.cliente.localidade ?? "",
      },
      document: {
        docType: Number(def.serieId),
        documentObservations: observacoes(doc),
        ...(doc.linhas.some((l) => l.regra.iva === 0) ? { taxExemptionCode: doc.linhas.find((l) => l.regra.iva === 0)?.regra.isencao ?? "M07" } : {}),
      },
      products: doc.linhas.map((l) => ({
        reference: REFERENCIA[l.tipo],
        designation: l.descricao.slice(0, 100),
        quantity: l.quantidade,
        unitPrice: l.unitarioCents / 100,
        taxIncluded: true,
        taxPercentage: l.regra.iva,
        taxRegion: "PT",
        ...(l.regra.iva === 0 ? { taxExemptionCode: l.regra.isencao ?? "M07" } : {}),
      })),
      requestOptions: { option: 1, requestedFields: ["fno", "ftstamp", "nmdoc", "ftano", "etotal"] },
    });

    const code = Number(j.code);
    if (code === 100) throw this.erro(j, "a fatura-recibo");
    const campos = (j.requestedFields ?? {}) as Record<string, unknown>;
    const total = Math.round(Number(campos.etotal ?? NaN) * 100);
    if (Number.isFinite(total) && total !== doc.totalCents) {
      throw new ErroDeFaturacao(`O PHC GO calculou ${(total / 100).toFixed(2)} € e o pagamento foi de ${(doc.totalCents / 100).toFixed(2)} €. A fatura ficou emitida no PHC GO: confere-a lá e as taxas de IVA nas Definições.`, true);
    }
    const emitido = this.emitidoDe(Number(def.serieId), campos);
    return { ...emitido, permalink: typeof j.pdf === "string" && j.pdf ? j.pdf : null };
  }

  private emitidoDe(docType: number, campos: Record<string, unknown>): Emitido {
    const fno = Number(campos.fno);
    const ano = Number(campos.ftano) || new Date().getUTCFullYear();
    const stamp = String(campos.ftstamp ?? "");
    return {
      // Tudo o que `fetchDocument` precisa para voltar a pedir o PDF.
      externalId: `${docType}:${ano}:${fno}:${stamp}`,
      number: fno ? `${String(campos.nmdoc ?? "FR")} ${ano}/${fno}` : null,
      atcud: null,
      permalink: null,
    };
  }

  async pdf(cred: Credenciais, _def: DefinicoesDaConta, emitido: Emitido): Promise<Buffer> {
    const c = this.cred(cred);
    const [docType, ano, fno] = emitido.externalId.split(":").map(Number);
    let link = emitido.permalink;
    if (!link) {
      const j = await this.chamar(c, "fetchDocument", { document: { docType, documentNumber: fno, documentYear: ano }, requestOptions: { viaDoc: 0 } });
      if (Number(j.code) !== 0 || typeof j.pdf !== "string") throw this.erro(j, "o PDF");
      link = j.pdf;
    }
    const f = await descarregar(link, {}, PROGRAMA);
    if (f.status !== 200 || f.corpo.subarray(0, 4).toString() !== "%PDF") {
      // O link que veio na emissão pode ter caducado: pede-se outro, uma vez.
      if (emitido.permalink) return this.pdf(cred, _def, { ...emitido, permalink: null });
      throw new ErroDeFaturacao("O PHC GO não devolveu o PDF. Voltamos a tentar mais tarde.", false);
    }
    return f.corpo;
  }

  /**
   * Anular no PHC GO só é possível em cinco dias e sem comunicação à AT em
   * tempo real; o caminho seguro é a nota de crédito, na série que `preparar`
   * encontrou, com as linhas da fatura a apontar para ela.
   */
  async anular(cred: Credenciais, def: DefinicoesDaConta, emitido: Emitido, motivo: string, doc: DocumentoAFaturar): Promise<void> {
    const c = this.cred(cred);
    const ncSerie = Number(def.interno?.ncSerie);
    if (!ncSerie) throw new ErroDeFaturacao("A instalação PHC GO não tem uma série de notas de crédito; a fatura fica por anular lá.", true);
    const [docType, , fno] = emitido.externalId.split(":").map(Number);
    const j = await this.chamar(c, "createDocument", {
      customer: { name: doc.cliente.nome.slice(0, 80), ...(doc.cliente.nif ? { taxNumber: doc.cliente.nif } : {}), country: "PT" },
      document: { docType: ncSerie, rectificationReason: motivo.slice(0, 100) || "Pagamento devolvido", documentObservations: `Anula ${emitido.number ?? ""} (${diaPt(doc.pagoEm)}).` },
      products: doc.linhas.map((l) => ({
        reference: REFERENCIA[l.tipo],
        designation: l.descricao.slice(0, 100),
        quantity: l.quantidade,
        unitPrice: l.unitarioCents / 100,
        taxIncluded: true,
        taxPercentage: l.regra.iva,
        taxRegion: "PT",
        ...(l.regra.iva === 0 ? { taxExemptionCode: l.regra.isencao ?? "M07" } : {}),
        originDocumentNumber: fno,
        originDocumentType: docType,
      })),
      requestOptions: { option: 3 },
    });
    if (Number(j.code) === 100) throw this.erro(j, "a nota de crédito");
  }
}

function nomeDoArtigo(tipo: TipoDeVenda): string {
  const nomes: Record<TipoDeVenda, string> = {
    MENSALIDADE: "Mensalidade",
    EXTRA: "Cobrança avulsa",
    QUOTA: "Quota de sócio",
    BILHETE: "Bilhete",
    LOJA: "Artigo da loja",
    ENVIO: "Portes de envio",
    TAXA: "Comissão do pagamento",
  };
  return nomes[tipo];
}
