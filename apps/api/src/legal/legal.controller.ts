import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString } from "class-validator";
import type { Request } from "express";
import { Public } from "../auth/auth.guard";
import { LegalService, view } from "./legal.service";
import { LEGAL_AUDIENCES, LEGAL_TYPES } from "./legal.catalog";
import type { LegalAudience } from "@prisma/client";

class AcceptDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  documentIds!: string[];

  /** "Confirmo que estou autorizado a representar o clube." Obrigatório para o âmbito CLUB. */
  @IsOptional()
  @IsBoolean()
  confirmAuthority?: boolean;

  /** Só `SETTINGS` é aceite daqui; o resto é decidido no servidor. */
  @IsOptional()
  @IsIn(["SETTINGS"])
  context?: string;
}

/**
 * Os documentos legais, para quem os lê e para quem os aceita.
 *
 * `@Public()` aqui não quer dizer "aberto" — quer dizer que a autenticação é
 * outra (ver `ClubAppController`): as leituras dos documentos são mesmo públicas
 * (é o rodapé do site), e as rotas de estado e aceitação verificam o JWT e
 * resolvem a pessoa sem exigir uma `Membership`, porque um sócio pode não ter
 * nenhuma. O gate do guard global não se aplica a estas rotas de propósito: são
 * elas que permitem sair dele.
 */
@Public()
@Controller("api/legal")
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  /* ---- Público: o que está em vigor -------------------------------------- */

  /** As versões em vigor, sem texto — o índice do rodapé. */
  @Get("documents")
  async documents() {
    const docs = await this.legal.current();
    return docs.map((d) => ({ ...view(d), effectiveAt: d.effectiveAt }));
  }

  /** A versão em vigor de um documento, com o texto. */
  @Get("documents/:slug")
  async document(@Param("slug") slug: string) {
    const doc = await this.legal.currentOf(slug);
    if (!doc) throw new NotFoundException("Documento não encontrado");
    return { ...view(doc), content: doc.content, contentHash: doc.contentHash };
  }

  /** As versões que já valeram — o histórico público. */
  @Get("documents/:slug/versions")
  async versions(@Param("slug") slug: string) {
    const rows = await this.legal.versionsOf(slug);
    return rows.map((d) => ({ ...view(d), retiredAt: d.retiredAt }));
  }

  /** Uma versão concreta — o que uma aceitação antiga aponta. */
  @Get("documents/:slug/:version")
  async version(@Param("slug") slug: string, @Param("version") version: string) {
    const doc = await this.legal.versionOf(slug, version);
    if (!doc || doc.status === "DRAFT") throw new NotFoundException("Versão não encontrada");
    return { ...view(doc), content: doc.content, contentHash: doc.contentHash, status: doc.status };
  }

  /**
   * O que uma audiência tem de aceitar ao criar conta. Público: é lido pelas
   * páginas de registo, antes de haver sessão. Só metadados e o link do site.
   */
  @Get("required")
  required(@Query("audience") audience: string) {
    const a = (audience ?? "").toUpperCase();
    if (!LEGAL_AUDIENCES.includes(a as LegalAudience)) throw new BadRequestException("Audiência desconhecida");
    return this.legal.requiredFor([a as LegalAudience]);
  }

  /** O catálogo dos tipos — o que existe, mesmo sem versão publicada. */
  @Get("types")
  types() {
    return Object.entries(LEGAL_TYPES).map(([type, info]) => ({ type, slug: info.slug, label: info.label, order: info.order }));
  }

  /* ---- Autenticado: o que me falta, e aceitar ------------------------------ */

  /** O que esta conta ainda tem de aceitar neste clube. A pergunta do gate. */
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get("status")
  async status(@Headers("authorization") auth: string, @Headers("x-academy-slug") slug: string) {
    const subject = await this.legal.subjectFor(auth, slug ?? "");
    return this.legal.statusFor(subject);
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post("accept")
  async accept(
    @Headers("authorization") auth: string,
    @Headers("x-academy-slug") slug: string,
    @Body() body: AcceptDto,
    @Req() req: Request,
  ) {
    const subject = await this.legal.subjectFor(auth, slug ?? "");
    const ua = req.headers["user-agent"];
    return this.legal.accept(subject, body, {
      // `trust proxy = 1` está posto no arranque — é o IP real, não o do proxy.
      ip: req.ip,
      userAgent: typeof ua === "string" ? ua : undefined,
    });
  }

  /** O histórico: o que aceitei, e o que o clube aceitou se o represento. */
  @Get("history")
  async history(@Headers("authorization") auth: string, @Headers("x-academy-slug") slug: string) {
    const subject = await this.legal.subjectFor(auth, slug ?? "");
    return this.legal.history(subject);
  }
}
