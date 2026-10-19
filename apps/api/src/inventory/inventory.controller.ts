import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { AuthedRequest } from "../auth/auth.guard";
import { InventoryService } from "./inventory.service";
import {
  AssignDto,
  AssignLoteDto,
  CreateItemDto,
  DeleteItemDto,
  ImageConfirmDto,
  ImageUploadDto,
  ImportDto,
  ReturnDto,
  StockMovementDto,
  UpdateAssignmentDto,
  UpdateItemDto,
  UpdateVariantDto,
  VariantInputDto,
} from "./inventory.dto";

/**
 * O inventário.
 *
 * Nenhuma rota verifica permissões aqui: quem o faz é o serviço, à entrada de
 * cada método. É a disciplina do resto do produto — um controlador que valide
 * acessos é um sítio a mais onde a regra pode divergir, e o dia em que um
 * serviço for chamado de outro caminho a verificação vai com ele.
 */
@Controller("api/inventory")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get("overview")
  overview(@Req() req: AuthedRequest) {
    return this.inventory.overview(req.ctx);
  }

  /*
   * Antes do `:id` — o Nest resolve por ordem de declaração, e com `items/:id`
   * primeiro, `items/overview` seria lido como o artigo com o id "overview".
   */
  @Get("items")
  items(
    @Req() req: AuthedRequest,
    @Query("q") q?: string,
    @Query("categoryId") categoryId?: string,
    @Query("status") status?: string,
  ) {
    return this.inventory.items(req.ctx, { q, categoryId, status });
  }

  @Get("items/:id")
  item(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.inventory.item(req.ctx, id);
  }

  @Post("items")
  createItem(@Req() req: AuthedRequest, @Body() dto: CreateItemDto) {
    return this.inventory.createItem(req.ctx, dto);
  }

  @Patch("items/:id")
  updateItem(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: UpdateItemDto) {
    return this.inventory.updateItem(req.ctx, id, dto);
  }

  /** Arquiva — nunca apaga. Ver `archiveItem`. */
  @Delete("items/:id")
  archiveItem(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.inventory.archiveItem(req.ctx, id);
  }

  /**
   * Apagar a sério — o artigo e o histórico dele.
   *
   * Rota própria e não uma variante do `DELETE` de cima: arquivar e apagar são
   * decisões diferentes, e um corpo que decide entre as duas é um corpo que um
   * dia chega mal preenchido e apaga o que era para guardar.
   */
  @Delete("items/:id/definitivo")
  deleteItem(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: DeleteItemDto) {
    return this.inventory.deleteItem(req.ctx, id, dto.confirmName);
  }

  @Post("items/:id/variants")
  addVariant(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: VariantInputDto) {
    return this.inventory.addVariant(req.ctx, id, dto);
  }

  @Patch("variants/:id")
  updateVariant(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: UpdateVariantDto) {
    return this.inventory.updateVariant(req.ctx, id, dto);
  }

  /** Entradas, saídas e correcções de contagem. */
  @Post("variants/:id/stock")
  moveStock(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: StockMovementDto) {
    return this.inventory.moveStock(req.ctx, id, dto);
  }

  /*
   * As fotografias, em três passos: autorizar, o browser carrega direto para o
   * armazenamento, e confirmar. O ficheiro nunca passa por aqui.
   */
  @Post("items/:id/imagens/url")
  imageUrl(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: ImageUploadDto) {
    return this.inventory.imageUploadUrl(req.ctx, id, dto.contentType);
  }

  @Post("items/:id/imagens")
  addImage(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: ImageConfirmDto) {
    return this.inventory.addImage(req.ctx, id, dto.key);
  }

  @Delete("items/:id/imagens")
  removeImage(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: ImageConfirmDto) {
    return this.inventory.removeImage(req.ctx, id, dto.key);
  }

  /** A folha do clube. Ver `importItems`. */
  @Post("import")
  importItems(@Req() req: AuthedRequest, @Body() dto: ImportDto) {
    return this.inventory.importItems(req.ctx, dto.rows);
  }

  /** O equipamento de um atleta, para a app da família. Ver `doMeuAtleta`. */
  @Get("familia/:athleteId")
  doMeuAtleta(@Req() req: AuthedRequest, @Param("athleteId") athleteId: string) {
    return this.inventory.doMeuAtleta(req.ctx, athleteId);
  }

  @Get("familia/:athleteId/:id")
  pecaDoMeuAtleta(@Req() req: AuthedRequest, @Param("athleteId") athleteId: string, @Param("id") id: string) {
    return this.inventory.pecaDoMeuAtleta(req.ctx, athleteId, id);
  }

  @Get("assignments")
  assignments(
    @Req() req: AuthedRequest,
    @Query("teamId") teamId?: string,
    @Query("athleteId") athleteId?: string,
    @Query("itemId") itemId?: string,
    @Query("status") status?: string,
  ) {
    return this.inventory.assignments(req.ctx, { teamId, athleteId, itemId, status });
  }

  @Post("assignments")
  assign(@Req() req: AuthedRequest, @Body() dto: AssignDto) {
    return this.inventory.assign(req.ctx, dto);
  }

  /** Vários artigos ao mesmo atleta, de uma vez. Ver `assignLote`. */
  @Post("assignments/lote")
  assignLote(@Req() req: AuthedRequest, @Body() dto: AssignLoteDto) {
    return this.inventory.assignLote(req.ctx, dto);
  }

  /** Editar uma entrega: as notas e o pagamento. Ver `definirPagamento`. */
  @Patch("assignments/:id")
  updateAssignment(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: UpdateAssignmentDto) {
    return this.inventory.updateAssignment(req.ctx, id, dto);
  }

  @Post("assignments/:id/return")
  returnAssignment(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: ReturnDto) {
    return this.inventory.returnAssignment(req.ctx, id, dto);
  }

  @Get("movements")
  movements(@Req() req: AuthedRequest, @Query("itemId") itemId?: string) {
    return this.inventory.movements(req.ctx, { itemId });
  }
}
