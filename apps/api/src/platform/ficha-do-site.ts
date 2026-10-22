import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A ficha do formulário de contacto do site.
 *
 * ## Porque é que existe
 *
 * O IP não serve para travar ninguém: a API vê o IP dos intermediários (que
 * rodam e são partilhados por toda a gente), e quem quer insistir troca de IP.
 * O email também não: `nome+1@gmail.com`, `nome+2@gmail.com`… vão todos para a
 * mesma caixa. O tempo de preenchimento mandado pelo browser inventa-se.
 *
 * A ficha é o servidor a dizer "esta página foi aberta por mim, a esta hora".
 * O formulário pede-a ao abrir; o envio só passa com uma ficha assinada por nós,
 * com pelo menos três segundos e no máximo seis horas, e **cada ficha só serve
 * uma vez**. Um script tem de pedir uma ficha por envio e esperar três segundos
 * por cada uma, e mesmo assim bate no tecto global do serviço.
 */

const MIN_MS = 3_000;
const MAX_MS = 6 * 60 * 60 * 1000;

export class FichaDoSite {
  /** As fichas já gastas, até expirarem. Uma só instância da API chega para isto. */
  private readonly gastas = new Map<string, number>();

  /**
   * `fim` separa as fichas de formulários diferentes (o do site de marketing e
   * o dos sites dos clubes): cada instância tem a sua lista de gastas, e uma
   * ficha de um não pode valer no outro.
   */
  constructor(
    private readonly segredo: string,
    private readonly fim = "site-contacto",
    /** Quanto tempo uma ficha vale. A da bilheteira vale menos: ver `BilheteiraService`. */
    private readonly maxMs = MAX_MS,
  ) {}

  /**
   * `contexto` prende a ficha a um sítio (o clube, na bilheteira): uma ficha
   * tirada no site de um clube não serve no de outro, e não se juntam fichas
   * de vários clubes para gastar num só.
   */
  emitir(agora = Date.now(), contexto = ""): string {
    const corpo = `${agora}.${randomBytes(12).toString("base64url")}`;
    return `${corpo}.${this.assinar(corpo, contexto)}`;
  }

  /** `null` quando passa; senão, a frase para quem enviou. Gasta a ficha. */
  verificar(ficha: string | undefined, agora = Date.now(), contexto = ""): string | null {
    const RECARREGA = "O formulário expirou. Recarrega a página e envia outra vez.";
    if (!ficha) return RECARREGA;
    const partes = ficha.split(".");
    if (partes.length !== 3) return RECARREGA;
    const [ts, nonce, sig] = partes;
    const esperada = Buffer.from(this.assinar(`${ts}.${nonce}`, contexto));
    const dada = Buffer.from(sig);
    if (esperada.length !== dada.length || !timingSafeEqual(esperada, dada)) return RECARREGA;

    const idade = agora - Number(ts);
    if (!Number.isFinite(idade) || idade > this.maxMs) return RECARREGA;
    if (idade < MIN_MS) return "Foi demasiado rápido. Confirma o que escreveste e envia outra vez.";

    this.limpar(agora);
    if (this.gastas.has(nonce)) return RECARREGA;
    this.gastas.set(nonce, Number(ts) + this.maxMs);
    return null;
  }

  private assinar(corpo: string, contexto = ""): string {
    // Sem contexto, a mesma assinatura de sempre: as fichas do formulário de contactos não mudam.
    const prefixo = contexto ? `${this.fim}:${contexto}` : this.fim;
    return createHmac("sha256", this.segredo).update(`${prefixo}:${corpo}`).digest("base64url");
  }

  private limpar(agora: number) {
    for (const [k, expira] of this.gastas) if (expira < agora) this.gastas.delete(k);
  }
}

/**
 * O email como caixa de correio: minúsculas, sem o `+etiqueta`, e no Gmail sem
 * os pontos (que o Gmail ignora). `rui+teste7@gmail.com` e `r.ui@gmail.com`
 * contam como `rui@gmail.com`.
 */
export function caixaDoEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  let local = e.slice(0, at).split("+")[0];
  let dominio = e.slice(at + 1);
  if (dominio === "googlemail.com") dominio = "gmail.com";
  if (dominio === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${dominio}`;
}

/** Os últimos nove algarismos do telefone: `+351 912 345 678` e `912345678` são o mesmo. */
export function numeroDoTelefone(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 6 ? d.slice(-9) : null;
}
