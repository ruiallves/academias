import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import type { ResponseCreateParamsStreaming, ResponseInputItem, Tool } from "openai/resources/responses/responses";
import { MODELOS_POR_OMISSAO, type Esforco, type Nivel } from "./rotas";

/**
 * O cliente dos modelos de linguagem do Adjunto.
 *
 * ## Um sítio só
 *
 * Tudo o que fala com a OpenAI passa por aqui: a chave, o endereço (a rota
 * europeia é um endereço diferente), os nomes dos três modelos e a regra de
 * não guardar nada do outro lado (`store: false`). Trocar de fornecedor, ou
 * de modelo, é mexer neste ficheiro e nas variáveis de ambiente, e em mais
 * nenhum.
 *
 * ## Sem chave, sem Adjunto
 *
 * Como o email sem `MAIL_API_KEY` e o push sem chaves VAPID: a API arranca na
 * mesma, avisa no arranque, e `ligado()` responde `false`. A consola não mostra
 * o botão e as rotas respondem 503.
 *
 * ## Os três níveis
 *
 * `leve`, `medio` e `forte` são níveis, não modelos: o nome de cada um vem de
 * `ADJUNTO_MODELO_LEVE`, `ADJUNTO_MODELO_MEDIO` e `ADJUNTO_MODELO_FORTE`, com os
 * valores por omissão de `rotas.ts`. Quem decide o nível de cada pedido é a
 * tabela de rotas, pela ação; aqui só se traduz o nível no nome.
 */
@Injectable()
export class OpenAiClient {
  private readonly log = new Logger(OpenAiClient.name);
  private readonly cliente: OpenAI | null;
  private readonly modelos: Record<Nivel, string>;

  constructor(private readonly config: ConfigService) {
    const chave = this.config.get<string>("OPENAI_API_KEY")?.trim();
    const baseURL = this.config.get<string>("OPENAI_BASE_URL")?.trim() || undefined;
    this.cliente = chave ? new OpenAI({ apiKey: chave, baseURL, timeout: 120_000, maxRetries: 2 }) : null;
    this.modelos = {
      leve: this.config.get<string>("ADJUNTO_MODELO_LEVE")?.trim() || MODELOS_POR_OMISSAO.leve,
      medio: this.config.get<string>("ADJUNTO_MODELO_MEDIO")?.trim() || MODELOS_POR_OMISSAO.medio,
      forte: this.config.get<string>("ADJUNTO_MODELO_FORTE")?.trim() || MODELOS_POR_OMISSAO.forte,
    };
    if (!this.cliente) {
      this.log.warn("OPENAI_API_KEY em falta: o Adjunto fica desligado. As rotas /api/adjunto respondem 503.");
    } else {
      this.log.log(`Adjunto ligado (${baseURL ?? "api.openai.com"}; leve=${this.modelos.leve}, medio=${this.modelos.medio}, forte=${this.modelos.forte}).`);
    }
  }

  ligado(): boolean {
    return this.cliente !== null;
  }

  modelo(nivel: Nivel): string {
    return this.modelos[nivel];
  }

  /** O nível de um nome de modelo, para quem só tem o nome (o registo de uso). */
  nivelDe(modelo: string): Nivel | null {
    return (Object.keys(this.modelos) as Nivel[]).find((n) => this.modelos[n] === modelo) ?? null;
  }

  private exigir(): OpenAI {
    if (!this.cliente) throw new ServiceUnavailableException("O Assistente IA ainda não tem a OPENAI_API_KEY na API: a interface vê-se, mas não responde");
    return this.cliente;
  }

  /**
   * Um pedido ao modelo, em streaming.
   *
   * `store: false` em todos: a conversa vive na nossa base, e o fornecedor não
   * guarda nada para além do que a monitorização dele exige. Por isso o
   * raciocínio do modelo volta cifrado (`reasoning.encrypted_content`) e é
   * devolvido tal e qual no pedido seguinte, que é a única forma de o manter
   * sem o fornecedor guardar estado.
   */
  responder(pedido: {
    nivel: Nivel;
    esforco: Esforco;
    instrucoes: string;
    entrada: ResponseInputItem[];
    ferramentas?: Tool[];
    /** Chamadas em paralelo são para as leituras; as propostas são uma de cada vez. */
    paralelo?: boolean;
    maxSaida?: number;
    /** Um texto só, com esta forma. Para o classificador e o mapeamento. */
    formato?: { nome: string; schema: Record<string, unknown> };
    /** A chave que junta pedidos iguais na cache do fornecedor: a conversa. */
    chaveDeCache?: string;
    /** `none`: as ferramentas continuam declaradas (a história tem chamadas), mas esta vez só escreve. */
    escolhaDeFerramenta?: "auto" | "none";
    /**
     * O limite deste pedido, em vez dos 120 s e das duas repetições do cliente.
     * O planeador de treinos escreve muito e pode pesquisar na internet: com o
     * limite geral, passava dos 120 s, era cortado e repetido duas vezes, e a
     * pessoa ficava minutos à espera de nada.
     */
    limite?: { ms: number; repeticoes: number };
  }) {
    const cliente = this.exigir();
    const params: ResponseCreateParamsStreaming = {
      model: this.modelo(pedido.nivel),
      instructions: pedido.instrucoes,
      input: pedido.entrada,
      stream: true,
      store: false,
      include: ["reasoning.encrypted_content"],
      reasoning: { effort: pedido.esforco },
      max_output_tokens: pedido.maxSaida ?? 4_000,
      ...(pedido.ferramentas?.length ? { tools: pedido.ferramentas, tool_choice: pedido.escolhaDeFerramenta ?? "auto", parallel_tool_calls: pedido.paralelo ?? true } : {}),
      ...(pedido.formato
        ? { text: { format: { type: "json_schema", name: pedido.formato.nome, strict: true, schema: pedido.formato.schema } } }
        : {}),
      ...(pedido.chaveDeCache ? { prompt_cache_key: pedido.chaveDeCache } : {}),
    };
    return pedido.limite ? cliente.responses.create(params, { timeout: pedido.limite.ms, maxRetries: pedido.limite.repeticoes }) : cliente.responses.create(params);
  }

  /**
   * Dizer uma resposta em voz alta, para o modo de conversa por voz.
   *
   * O texto é o que o Adjunto já respondeu por escrito: a voz é só outra
   * forma de o entregar, e o cartão de confirmar continua no ecrã. Sai em MP3,
   * que toca em todos os browsers sem mais nada.
   */
  async falar(texto: string): Promise<Buffer> {
    const cliente = this.exigir();
    const r = await cliente.audio.speech.create({
      model: this.config.get<string>("ADJUNTO_MODELO_VOZ")?.trim() || "gpt-4o-mini-tts",
      voice: this.config.get<string>("ADJUNTO_VOZ")?.trim() || "marin",
      input: texto.slice(0, 2_000),
      instructions: "Fala em português de Portugal, com um tom calmo e direto, como um adjunto a falar com o treinador à beira do campo. Sem entusiasmo a mais.",
      response_format: "mp3",
      speed: 1.05,
    });
    return Buffer.from(await r.arrayBuffer());
  }

  /**
   * Transcrever um troço de áudio ditado na consola.
   *
   * É a transcrição de todo o ditado e da conversa por voz: o reconhecimento
   * do browser perdia palavras em português de Portugal e ficou só para quando
   * isto não está ligado (ver `lib/voz.ts` na consola). `gpt-transcribe` é o modelo recomendado pelo
   * fornecedor; os anteriores desaparecem em fevereiro de 2027.
   */
  async transcrever(audio: Buffer, mime: string): Promise<string> {
    const cliente = this.exigir();
    const extensao = mime.includes("webm") ? "webm" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("ogg") ? "ogg" : "wav";
    const ficheiro = await OpenAI.toFile(audio, `ditado.${extensao}`, { type: mime });
    const r = await cliente.audio.transcriptions.create({
      file: ficheiro,
      model: this.config.get<string>("ADJUNTO_MODELO_TRANSCRICAO")?.trim() || "gpt-transcribe",
      // A forma nova: várias línguas possíveis, em vez de uma só.
      languages: ["pt"],
    } as Parameters<typeof cliente.audio.transcriptions.create>[0]);
    return typeof r === "string" ? r : ((r as { text?: string }).text ?? "");
  }
}
