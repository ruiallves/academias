import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Max, MaxLength, Min } from "class-validator";
import { InvoicingProvider } from "@prisma/client";
import { Public, type AuthedRequest } from "../auth/auth.guard";
import { FaturacaoService } from "./faturacao.service";

/** Ligar a InvoiceXpress: o que o clube copia do programa. */
class LigarInvoiceXpressDto {
  @IsString() @Length(3, 40) accountName!: string;
  @IsString() @Length(10, 200) apiKey!: string;
}

/** Ligar a Vendus: a chave da API. */
class LigarVendusDto {
  @IsString() @Length(10, 200) apiKey!: string;
}

/** Ligar o PHC GO: a instalação do clube e um utilizador dela. */
class LigarPhcGoDto {
  @IsString() @Length(10, 200) backendUrl!: string;
  @IsString() @Length(1, 80) userCode!: string;
  @IsString() @Length(1, 200) password!: string;
  @IsOptional() @IsString() @MaxLength(80) company?: string;
}

/** As escolhas do clube no programa e as regras de IVA. Tudo opcional: manda-se o que mudou. */
class DefinirDto {
  @IsOptional() @IsString() @MaxLength(120) serieId?: string;
  @IsOptional() @IsString() @MaxLength(120) serieNome?: string;
  @IsOptional() @IsString() @MaxLength(120) companyId?: string;
  @IsOptional() @IsString() @MaxLength(120) companyNome?: string;
  @IsOptional() @IsString() @MaxLength(120) paymentMethodId?: string;
  @IsOptional() @IsString() @MaxLength(120) bankAccountId?: string;
  @IsOptional() @IsString() @MaxLength(120) paymentTypeId?: string;
  /** `{ confirmadas, porTipo: { MENSALIDADE: { iva, isencao? }, … } }`. Limpo em `regrasFiscais`. */
  @IsOptional() @IsObject() regras?: { confirmadas: boolean; porTipo: Record<string, { iva: number; isencao?: string }> };
}

class ReenviarDto {
  @IsOptional() @IsString() @MaxLength(254) email?: string;
}

class MeusDadosDto {
  @IsOptional() @IsString() @MaxLength(100) nome?: string;
  @IsOptional() @IsString() @MaxLength(20) nif?: string;
  @IsOptional() @IsString() @MaxLength(200) morada?: string;
  @IsOptional() @IsString() @MaxLength(12) codigoPostal?: string;
  @IsOptional() @IsString() @MaxLength(80) localidade?: string;
}

class FaturasQuery {
  /** Um ou mais estados, separados por vírgula: "PENDING,ISSUED". */
  @IsOptional() @IsString() @MaxLength(60) estado?: string;
  @IsOptional() @IsInt() @Min(1) @Max(500) take?: number;
}

const PROVIDERS = Object.values(InvoicingProvider) as string[];

/**
 * A faturação por API: a ligação do clube (Definições › Faturação), as
 * faturas emitidas, e os dados de faturação de quem paga na app.
 *
 * As permissões decidem-se no serviço: `settings:write` configura,
 * `billing:read` vê, `billing:write` repete e reenvia.
 */
@Controller("api/faturacao")
export class FaturacaoController {
  constructor(private readonly faturacao: FaturacaoService) {}

  @Get()
  estado(@Req() req: AuthedRequest) {
    return this.faturacao.estado(req.ctx);
  }

  @Get("opcoes")
  opcoes(@Req() req: AuthedRequest) {
    return this.faturacao.opcoes(req.ctx);
  }

  @Post("invoicexpress")
  ligarInvoiceXpress(@Req() req: AuthedRequest, @Body() body: LigarInvoiceXpressDto) {
    return this.faturacao.ligarInvoiceXpress(req.ctx, body);
  }

  @Post("vendus")
  ligarVendus(@Req() req: AuthedRequest, @Body() body: LigarVendusDto) {
    return this.faturacao.ligarVendus(req.ctx, body);
  }

  @Post("phc-go")
  ligarPhcGo(@Req() req: AuthedRequest, @Body() body: LigarPhcGoDto) {
    return this.faturacao.ligarPhcGo(req.ctx, body);
  }

  /** OAuth, passo 1: a consola abre o endereço devolvido numa janela nova. */
  @Get("autorizar/:provider")
  autorizar(@Req() req: AuthedRequest, @Param("provider") provider: string) {
    return this.faturacao.urlDeAutorizacao(req.ctx, provider.toUpperCase() as InvoicingProvider);
  }

  @Patch("definicoes")
  definir(@Req() req: AuthedRequest, @Body() body: DefinirDto) {
    return this.faturacao.definir(req.ctx, body as Parameters<FaturacaoService["definir"]>[1]);
  }

  @Delete()
  desligar(@Req() req: AuthedRequest) {
    return this.faturacao.desligar(req.ctx);
  }

  @Get("faturas")
  faturas(@Req() req: AuthedRequest, @Query() q: FaturasQuery) {
    return this.faturacao.faturas(req.ctx, { estado: q.estado, take: q.take ? Number(q.take) : undefined });
  }

  @Post("faturas/:id/repetir")
  repetir(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.faturacao.repetir(req.ctx, id);
  }

  @Post("faturas/:id/reenviar")
  reenviar(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: ReenviarDto) {
    return this.faturacao.reenviar(req.ctx, id, body.email);
  }

  /** Os dados de faturação de quem está a usar a app (nome na fatura, NIF, morada). */
  @Get("dados")
  meusDados(@Req() req: AuthedRequest) {
    return this.faturacao.meusDados(req.ctx);
  }

  @Put("dados")
  guardarMeusDados(@Req() req: AuthedRequest, @Body() body: MeusDadosDto) {
    return this.faturacao.guardarMeusDados(req.ctx, body);
  }
}

/**
 * OAuth, passo 2: o programa devolve o clube aqui. Pública por construção: é
 * o `state` assinado que diz de que clube é. Nunca responde com dados, só
 * redireciona para as Definições com o resultado.
 */
@Public()
@Controller("api/faturacao/callback")
export class FaturacaoCallbackController {
  constructor(private readonly faturacao: FaturacaoService) {}

  @Get(":provider")
  async callback(@Param("provider") provider: string, @Query() q: { code?: string; state?: string; error?: string }, @Res() res: Response) {
    const p = provider.toUpperCase();
    const destino = PROVIDERS.includes(p)
      ? await this.faturacao.callbackOAuth(p as InvoicingProvider, q)
      : await this.faturacao.callbackOAuth("MOLONI", { state: "" });
    res.redirect(302, destino);
  }
}

// Evita o aviso de "não usado" nos decoradores que só servem a validação.
void IsBoolean;
