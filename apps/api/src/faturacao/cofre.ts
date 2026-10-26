/**
 * O cofre das credenciais de faturação.
 *
 * ## Porquê cifrar, quando as chaves da euPago estão em claro
 *
 * Porque estas abrem mais portas. A chave da euPago cria referências de
 * pagamento; a chave de um programa de faturação **emite documentos fiscais
 * em nome do clube** e lê toda a faturação dele. Um despejo da base com isto
 * em claro era um despejo de todos os programas de todos os clubes.
 *
 * AES-256-GCM com uma chave do ambiente (`INVOICING_SECRET`), um nonce por
 * valor, e a etiqueta de autenticação colada ao fim: alterar um byte na base
 * faz a decifra falhar em vez de devolver lixo. O formato guardado é
 * `v1.<nonce>.<cifrado+etiqueta>`, em base64url, para se poder mudar de
 * esquema um dia sem adivinhar o que cada linha é.
 *
 * Sem `INVOICING_SECRET` o cofre recusa-se a guardar e a ler: é melhor um
 * clube não conseguir ligar a faturação do que ligá-la com as credenciais em
 * claro por engano.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const VERSAO = "v1";

export class Cofre {
  private readonly chave: Buffer | null;

  constructor(segredo: string | undefined) {
    const s = segredo?.trim() ?? "";
    // A chave de 32 bytes deriva-se do segredo, seja ele do tamanho que for;
    // assim um segredo é uma frase e não 64 hexadecimais que alguém copia mal.
    this.chave = s.length >= 16 ? createHash("sha256").update(s).digest() : null;
  }

  get pronto(): boolean {
    return this.chave !== null;
  }

  cifrar(texto: string): string {
    if (!this.chave) throw new Error("INVOICING_SECRET por configurar (16 caracteres no mínimo)");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.chave, nonce);
    const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final(), cipher.getAuthTag()]);
    return `${VERSAO}.${nonce.toString("base64url")}.${cifrado.toString("base64url")}`;
  }

  decifrar(guardado: string): string {
    if (!this.chave) throw new Error("INVOICING_SECRET por configurar (16 caracteres no mínimo)");
    const [versao, nonce64, corpo64] = guardado.split(".");
    if (versao !== VERSAO || !nonce64 || !corpo64) throw new Error("Credenciais num formato desconhecido");
    const nonce = Buffer.from(nonce64, "base64url");
    const corpo = Buffer.from(corpo64, "base64url");
    if (corpo.length < 16) throw new Error("Credenciais truncadas");
    const etiqueta = corpo.subarray(corpo.length - 16);
    const cifrado = corpo.subarray(0, corpo.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", this.chave, nonce);
    decipher.setAuthTag(etiqueta);
    return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString("utf8");
  }

  /**
   * Um valor assinado que viaja pelo browser e volta: o `state` do OAuth.
   *
   * Leva o clube e quem pediu, e uma validade; o callback só aceita o que
   * saiu daqui e ainda é válido. Sem isto, o callback do OAuth ligava a conta
   * de quem quer que fosse ao clube que o atacante escolhesse.
   */
  assinar(dados: Record<string, string | number>, validadeMs: number): string {
    if (!this.chave) throw new Error("INVOICING_SECRET por configurar");
    const corpo = Buffer.from(JSON.stringify({ ...dados, exp: Date.now() + validadeMs })).toString("base64url");
    const mac = createHash("sha256").update(this.chave).update(".").update(corpo).digest("base64url");
    return `${corpo}.${mac}`;
  }

  verificar(token: string): Record<string, string | number> | null {
    if (!this.chave) return null;
    const [corpo, mac] = token.split(".");
    if (!corpo || !mac) return null;
    const esperado = createHash("sha256").update(this.chave).update(".").update(corpo).digest("base64url");
    const a = Buffer.from(mac);
    const b = Buffer.from(esperado);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const dados = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as Record<string, string | number>;
      if (typeof dados.exp !== "number" || dados.exp < Date.now()) return null;
      return dados;
    } catch {
      return null;
    }
  }
}
