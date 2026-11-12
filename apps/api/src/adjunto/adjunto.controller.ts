import { Body, Controller, Delete, Get, Param, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import type { Response } from "express";
import type { AuthedRequest } from "../auth/auth.guard";
import { AdjuntoService, type Emitir } from "./adjunto.service";
import { PropostasService } from "./propostas.service";
import { ImportacaoService } from "./importacao/importacao.service";
import { ACOES, type Acao } from "./rotas";

class ContextoDto {
  @IsOptional() @IsString() @MaxLength(200) rota?: string;
  @IsOptional() @IsString() @MaxLength(40) teamId?: string;
  @IsOptional() @IsString() @MaxLength(40) sessionId?: string;
  @IsOptional() @IsString() @MaxLength(40) matchId?: string;
  @IsOptional() @IsString() @MaxLength(40) athleteId?: string;
  @IsOptional() @IsBoolean() voz?: boolean;
}

class EditarPropostaDto {
  @IsObject() valores!: Record<string, string>;
}

class FormularioDto {
  @IsString() @MaxLength(40) acao!: string;
  /** Campo → valor, como a pessoa os deixou no formulário. Validados pelo registo (`acoes.ts`). */
  @IsObject() valores!: Record<string, string>;
  @IsOptional() @IsString() @MaxLength(40) messageId?: string;
}

class EscolhaDto {
  @IsOptional() @IsString() @MaxLength(40) campo?: string;
  @IsString() @MaxLength(80) id!: string;
  @IsString() @MaxLength(160) label!: string;
}

class CriarConversaDto {
  @IsOptional() @ValidateNested() @Type(() => ContextoDto) contexto?: ContextoDto;
}

class MensagemDto {
  @IsString() @MaxLength(4000) texto!: string;
  @IsOptional() @ValidateNested() @Type(() => ContextoDto) contexto?: ContextoDto;
  /** A ação já decidida pelo botão de onde se veio ("Ditar presenças"). */
  @IsOptional() @IsIn(ACOES.filter((a) => a !== "importacao")) acao?: Acao;
  @IsOptional() @ValidateNested() @Type(() => EscolhaDto) escolha?: EscolhaDto;
}

class TranscreverDto {
  @IsString() @MaxLength(12_000_000) audioBase64!: string;
  @IsString() @MaxLength(80) mime!: string;
}

class FicheiroDto {
  @IsString() @MaxLength(200) fileName!: string;
  @IsString() @MaxLength(120) mime!: string;
  @IsString() @MaxLength(12_000_000) base64!: string;
}

class MapeamentoDto {
  /** As correções da pessoa ao mapeamento: a forma é a de `Mapeamento` em `mapear.ts`. */
  @IsObject() mapping!: Record<string, unknown>;
}

class ConfirmarImportacaoDto {
  @IsOptional() @IsBoolean() sobrescrever?: boolean;
  @IsOptional() @IsBoolean() enviarConvites?: boolean;
}

/**
 * As rotas do Adjunto. Quem pode o quê decide-se nos serviços; aqui só a
 * forma dos pedidos e o streaming da resposta.
 */
@Controller("api/adjunto")
export class AdjuntoController {
  constructor(
    private readonly adjunto: AdjuntoService,
    private readonly propostas: PropostasService,
    private readonly importacao: ImportacaoService,
  ) {}

  @Get("estado")
  estado(@Req() req: AuthedRequest) {
    return this.adjunto.estado(req.ctx);
  }

  @Get("conversas")
  listar(@Req() req: AuthedRequest) {
    return this.adjunto.listar(req.ctx);
  }

  @Post("conversas")
  criar(@Req() req: AuthedRequest, @Body() body: CriarConversaDto) {
    return this.adjunto.criar(req.ctx, body.contexto);
  }

  @Get("conversas/:id")
  ver(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.adjunto.ver(req.ctx, id);
  }

  @Delete("conversas/:id")
  apagar(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.adjunto.apagar(req.ctx, id);
  }

  /**
   * Uma mensagem, com a resposta em streaming (Server-Sent Events).
   *
   * `POST` e não `GET`: a mensagem vai no corpo e a sessão no cabeçalho, como
   * em tudo o resto; o `EventSource` do browser não serve e a consola lê o
   * corpo com `fetch`. Cada evento é `event: nome` + `data: JSON`.
   */
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post("conversas/:id/mensagens")
  async responder(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: MensagemDto, @Res() res: Response) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const emitir: Emitir = (evento, dados) => {
      if (res.writableEnded) return;
      res.write(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`);
    };
    // Um batimento a cada 15 s, para o intermediário não fechar a ligação enquanto o modelo pensa.
    const batimento = setInterval(() => { if (!res.writableEnded) res.write(": ping\n\n"); }, 15_000);
    try {
      await this.adjunto.responder(req.ctx, id, body, emitir);
    } catch (e) {
      const erro = e as { message?: string | string[]; status?: number };
      const mensagem = Array.isArray(erro.message) ? erro.message.join("; ") : (erro.message ?? "Não foi possível responder");
      emitir("erro", { mensagem, status: erro.status ?? 500 });
    } finally {
      clearInterval(batimento);
      res.end();
    }
  }

  /** O formulário de uma ação, preenchido no chat. Devolve a conversa com a proposta nova. */
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post("conversas/:id/formularios")
  preencherFormulario(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: FormularioDto) {
    return this.adjunto.preencherFormulario(req.ctx, id, body);
  }

  /** O formulário de uma proposta pendente, para a editar no cartão. */
  @Get("propostas/:id/formulario")
  formularioDaProposta(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.adjunto.formularioDaProposta(req.ctx, id);
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post("propostas/:id/editar")
  editarProposta(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: EditarPropostaDto) {
    return this.adjunto.editarProposta(req.ctx, id, body.valores);
  }

  @Post("propostas/:id/confirmar")
  confirmar(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.propostas.confirmar(req.ctx, id);
  }

  @Post("propostas/:id/recusar")
  recusar(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.propostas.recusar(req.ctx, id);
  }

  @Post("propostas/:id/desfazer")
  desfazer(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.propostas.desfazer(req.ctx, id);
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post("transcrever")
  transcrever(@Req() req: AuthedRequest, @Body() body: TranscreverDto) {
    return this.adjunto.transcrever(req.ctx, body.audioBase64, body.mime);
  }

  /** A resposta de uma mensagem, dita em voz alta (MP3). Para o modo de conversa por voz. */
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get("mensagens/:id/voz")
  async falar(@Req() req: AuthedRequest, @Param("id") id: string, @Res() res: Response) {
    const audio = await this.adjunto.falar(req.ctx, id);
    res.status(200);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Content-Length", String(audio.length));
    res.end(audio);
  }

  /* ---- Importação ----------------------------------------------------------- */

  /** Largar um ficheiro: lê-se, mapeia-se e ensaia-se. Nada fica gravado. */
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @Post("conversas/:id/importacoes")
  importar(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: FicheiroDto) {
    return this.importacao.receber(req.ctx, id, body);
  }

  @Get("importacoes/:id")
  verImportacao(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.importacao.ver(req.ctx, id);
  }

  /** A pessoa corrigiu o mapeamento (uma data é dia/mês, uma coluna não interessa): ensaia-se outra vez. */
  @Post("importacoes/:id/mapeamento")
  corrigirMapeamento(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: MapeamentoDto) {
    return this.importacao.corrigir(req.ctx, id, body.mapping);
  }

  @Post("importacoes/:id/confirmar")
  confirmarImportacao(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: ConfirmarImportacaoDto) {
    return this.importacao.confirmar(req.ctx, id, body ?? {});
  }
}
