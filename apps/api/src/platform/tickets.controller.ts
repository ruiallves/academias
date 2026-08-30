import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { IsIn, IsOptional, IsString, Length, ValidateIf } from "class-validator";
import { TicketStatus } from "@prisma/client";
import { Public } from "../auth/auth.guard";
import { PlatformGuard, PlatformRoles, type PlatformRequest } from "./platform.guard";
import { TicketsService } from "./tickets.service";

const ESTADOS = Object.values(TicketStatus);

class UpdateTicketDto {
  @IsOptional() @IsIn(ESTADOS)
  status?: TicketStatus;

  /**
   * `null` desatribui — e por isso o `ValidateIf`.
   *
   * Sem ele, `@IsString()` rejeitava o `null` e não havia forma nenhuma de tirar o
   * responsável a um pedido: a única maneira era passá-lo a outra pessoa.
   */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(1, 64)
  assigneeId?: string | null;
}

class NoteDto {
  @IsString() @Length(2, 4000)
  body!: string;
}

/**
 * Tickets — a caixa de entrada do site.
 *
 * `@Public()` desliga o guard **das academias** e `@UseGuards(PlatformGuard)` põe o
 * da plataforma no lugar: quem entra aqui é dos nossos, e não tem academia
 * nenhuma no contexto. O mesmo par que `ContactsController` usa, e pela mesma
 * razão.
 *
 * Apagar é só do dono. Um `SUPPORT` triar, escrever notas e fechar é o trabalho
 * dele; apagar o registo de que alguém escreveu é outra coisa — e a única
 * operação daqui que não deixa nada para trás.
 */
@Public()
@UseGuards(PlatformGuard)
@Controller("api/platform/tickets")
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  list(@Query("estado") estado?: string, @Query("q") q?: string) {
    const status =
      estado === "ABERTOS" || (estado && ESTADOS.includes(estado as TicketStatus))
        ? (estado as TicketStatus | "ABERTOS")
        : undefined;
    return this.tickets.list({ status, q });
  }

  /*
   * Antes do `:id`, e não por acaso.
   *
   * O Nest resolve as rotas por ordem de declaração: com `@Get(":id")` primeiro,
   * `/tickets/por-tratar` seria lido como o ticket com o id "por-tratar" e daria
   * 404. É o tipo de erro que só aparece em produção, e cuja causa não está no
   * ficheiro onde se procura.
   */
  @Get("por-tratar")
  porTratar() {
    return this.tickets.porTratar();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.tickets.get(id);
  }

  @Patch(":id")
  update(@Req() req: PlatformRequest, @Param("id") id: string, @Body() dto: UpdateTicketDto) {
    return this.tickets.update(req.admin, id, dto);
  }

  /**
   * "Já vi isto." Um `POST` e não um efeito do `GET`: uma leitura que escreve é
   * uma leitura em que não se pode confiar — nem para repetir, nem para depurar.
   */
  @Post(":id/visto")
  visto(@Req() req: PlatformRequest, @Param("id") id: string) {
    return this.tickets.marcarVisto(req.admin, id);
  }

  @Post(":id/notas")
  note(@Req() req: PlatformRequest, @Param("id") id: string, @Body() dto: NoteDto) {
    return this.tickets.addNote(req.admin, id, dto.body);
  }

  /** Passa o pedido para o funil de vendas. Ver `TicketsService.converter`. */
  @Post(":id/converter")
  converter(@Req() req: PlatformRequest, @Param("id") id: string) {
    return this.tickets.converter(req.admin, id);
  }

  @PlatformRoles("OWNER")
  @Delete(":id")
  remove(@Req() req: PlatformRequest, @Param("id") id: string) {
    return this.tickets.remove(req.admin, id);
  }
}
