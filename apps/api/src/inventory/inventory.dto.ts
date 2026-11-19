import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from "class-validator";

/** Um dia, `AAAA-MM-DD`. A validação a sério (existe, não é futuro) é do serviço. */
const DIA = /^\d{4}-\d{2}-\d{2}$/;
import { Type } from "class-transformer";

/**
 * Os corpos do inventário.
 *
 * Nada aqui é generoso com números: `Min(1)` nas quantidades e `Min(0)` nos
 * mínimos. Uma entrega de zero unidades e um stock mínimo negativo são pedidos
 * que não querem dizer nada — e o que não quer dizer nada não deve chegar ao
 * serviço, onde teria de ser tratado a meio de uma transacção.
 */

const MOVEMENT_TYPES = ["ENTRY", "EXIT", "ADJUSTMENT"] as const;
const RETURN_CONDITIONS = ["GOOD", "DAMAGED", "LOST"] as const;

/** Um tamanho, na criação do artigo. */
export class VariantInputDto {
  @IsString() @Length(1, 40) label!: string;
  @IsOptional() @IsString() @Length(0, 60) sku?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) quantity?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) minimumStock?: number;
}

export class CreateItemDto {
  @IsString() @Length(2, 120) name!: string;
  @IsOptional() @IsString() @Length(0, 1000) description?: string;
  @IsOptional() @IsString() @Length(0, 40) categoryId?: string;
  @IsOptional() @IsString() @Length(0, 60) sku?: string;
  @IsOptional() @IsString() @Length(0, 80) brand?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) minimumStock?: number;
  /** O preço base, em cêntimos, com IVA. Ausente ou nulo = sem preço. */
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) priceCents?: number | null;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;

  /**
   * Os tamanhos. Opcional — um artigo sem tamanhos nasce com uma variante
   * "Único", criada pelo serviço. O stock vive sempre numa variante, e essa
   * regra não pode ter excepções: um artigo sem nenhuma seria um artigo onde
   * nunca se conseguiria dar entrada de nada.
   */
  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => VariantInputDto)
  variants?: VariantInputDto[];

  /**
   * A resposta à pergunta "já existe um artigo com este nome".
   *
   * Ausente é **perguntar**: o serviço devolve `conflict` e não escreve nada.
   * `merge` soma o stock ao que lá está, `new` cria um artigo à parte com
   * referência própria. Quem regista é que sabe se a t-shirt é a mesma da época
   * passada ou a nova — e decidir por ele seria escolher entre perder stock e
   * duplicar o armazém.
   *
   * Não se aplica quando a referência é escrita: duas referências iguais são o
   * mesmo artigo, e isso não é uma pergunta.
   */
  @IsOptional() @IsIn(["merge", "new"]) onConflict?: string;
}

export class UpdateItemDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsString() @Length(0, 1000) description?: string;
  @IsOptional() @IsString() @Length(0, 40) categoryId?: string;
  @IsOptional() @IsString() @Length(0, 60) sku?: string;
  @IsOptional() @IsString() @Length(0, 80) brand?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) minimumStock?: number;
  /** O preço base, em cêntimos. `null` tira o preço; ausente não mexe. */
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) priceCents?: number | null;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
}

export class UpdateVariantDto {
  @IsOptional() @IsString() @Length(1, 40) label?: string;
  @IsOptional() @IsString() @Length(0, 60) sku?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) minimumStock?: number;
  @IsOptional() @IsInt() @Min(0) @Max(9999) order?: number;
}

/**
 * Mexer no stock de um tamanho.
 *
 * `ENTRY` e `EXIT` somam e subtraem; `ADJUSTMENT` **fixa** a contagem no valor
 * dado. São perguntas diferentes: "chegaram 50" e "afinal são 48" não se
 * escrevem da mesma maneira, e obrigar a calcular a diferença de cabeça é como
 * se perde a confiança num inventário.
 */
export class StockMovementDto {
  @IsIn(MOVEMENT_TYPES as unknown as string[]) type!: string;
  @IsInt() @Min(0) @Max(1_000_000) quantity!: number;
  @IsOptional() @IsString() @Length(0, 200) reason?: string;
  /**
   * O dia em que chegou, saiu ou se contou (`AAAA-MM-DD`). Omitido = agora. A
   * encomenda que chegou na sexta e só se registou na segunda fica na sexta.
   */
  @IsOptional() @Matches(DIA, { message: "A data não é válida" }) on?: string;
}

/**
 * Uma linha da folha de material do clube.
 *
 * **Uma linha por tamanho**, que é como se conta uma prateleira — e linhas com o
 * mesmo nome de artigo juntam-se num artigo com vários tamanhos. Só o nome é
 * obrigatório: um clube que só saiba o que tem, sem quantidades, importa na
 * mesma e conta depois.
 */
export class ImportRowDto {
  @IsOptional() @IsInt() @Min(1) @Max(100_000) line?: number;

  @IsString() @Length(2, 120) name!: string;
  /** Vazio vira "Único" — um artigo sem tamanhos tem uma variante só. */
  @IsOptional() @IsString() @Length(0, 40) size?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) quantity?: number;
  @IsOptional() @IsString() @Length(0, 60) category?: string;
  @IsOptional() @IsString() @Length(0, 80) brand?: string;
  @IsOptional() @IsString() @Length(0, 60) sku?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) minimumStock?: number;
}

export class ImportDto {
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => ImportRowDto)
  rows!: ImportRowDto[];
}

/**
 * Apagar um artigo a sério.
 *
 * O nome escrito à mão, como no apagar de uma equipa. É a prova de intenção de
 * quem está a apagar — e a única defesa contra o clique distraído numa acção
 * que leva o histórico atrás.
 */
export class DeleteItemDto {
  @IsString() @Length(1, 120) confirmName!: string;
}

/** Passo 1 do carregamento de uma fotografia: pedir o endereço assinado. */
export class ImageUploadDto {
  @IsString() @Length(3, 60) contentType!: string;
}

/** Passo 3: confirmar que o ficheiro chegou. */
export class ImageConfirmDto {
  @IsString() @Length(3, 200) key!: string;
}

/** Entregar equipamento a um atleta. */
/**
 * O pagamento de uma entrega. Ver `InventoryService.definirPagamento`.
 *
 * - `nenhum`: sem pagamento.
 * - `porPagar`: por pagar, só no equipamento (nem Pagamentos da app, nem notificação).
 * - `app`: por pagar na app da família, com notificação; paga-se lá.
 * - `pago`: pago (com o método), e cai nas Contas do clube.
 */
export class PagamentoDaEntregaDto {
  @IsIn(["nenhum", "porPagar", "app", "pago"]) modo!: "nenhum" | "porPagar" | "app" | "pago";
  @IsOptional() @IsInt() @Min(1) @Max(100_000_00) priceCents?: number;
  @IsOptional() @IsIn(["MBWAY", "CASH", "CARD", "TRANSFER"]) method?: "MBWAY" | "CASH" | "CARD" | "TRANSFER";
  /**
   * O dia em que foi pago, só em `pago`. Omitido = hoje. Uma peça entregue em
   * setembro e paga em outubro entra nas Contas de outubro, e não se pode
   * adivinhar qual foi o dia a partir da entrega.
   */
  @IsOptional() @Matches(DIA, { message: "A data do pagamento não é válida" }) paidOn?: string;
}

export class AssignDto {
  @IsString() @Length(1, 40) athleteId!: string;
  @IsString() @Length(1, 40) variantId!: string;
  @IsInt() @Min(1) @Max(1000) quantity!: number;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
  @IsOptional() @ValidateNested() @Type(() => PagamentoDaEntregaDto) pagamento?: PagamentoDaEntregaDto;
  /** `false`: fica por entregar (guardado para o atleta). Ausente = entregue agora. */
  @IsOptional() @IsBoolean() entregue?: boolean;
  /** Entregue num dia que já passou (`AAAA-MM-DD`). Omitido = agora. Ignorado em por entregar. */
  @IsOptional() @Matches(DIA, { message: "A data da entrega não é válida" }) deliveredOn?: string;
}

/** Um artigo de uma entrega de vários: o tamanho, quantas, e o pagamento dele. */
export class LinhaDeEntregaDto {
  @IsString() @Length(1, 40) variantId!: string;
  @IsInt() @Min(1) @Max(1000) quantity!: number;
  @IsOptional() @ValidateNested() @Type(() => PagamentoDaEntregaDto) pagamento?: PagamentoDaEntregaDto;
}

/**
 * Entregar vários artigos ao mesmo atleta de uma vez (a t-shirt, os calções e
 * as meias). Cada linha é uma entrega, com o seu pagamento; o stock desconta-se
 * tudo ou nada. Ver `InventoryService.assignLote`.
 */
export class AssignLoteDto {
  @IsString() @Length(1, 40) athleteId!: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => LinhaDeEntregaDto)
  linhas!: LinhaDeEntregaDto[];
  /** `false`: tudo fica por entregar (guardado para o atleta). Ausente = entregue agora. */
  @IsOptional() @IsBoolean() entregue?: boolean;
  /** Entregue num dia que já passou (`AAAA-MM-DD`). Omitido = agora. Ignorado em por entregar. */
  @IsOptional() @Matches(DIA, { message: "A data da entrega não é válida" }) deliveredOn?: string;
}

/** Editar uma entrega: as notas, o pagamento e se já foi entregue. A devolução tem rota própria. */
export class UpdateAssignmentDto {
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
  @IsOptional() @ValidateNested() @Type(() => PagamentoDaEntregaDto) pagamento?: PagamentoDaEntregaDto;
  /** `true`: por entregar → entregue. `false`: entregue → por entregar (marcado por engano). */
  @IsOptional() @IsBoolean() entregue?: boolean;
  /**
   * O dia da entrega (`AAAA-MM-DD`): ao passar a entregue, o dia em que foi;
   * numa peça já entregue, corrige o dia gravado.
   */
  @IsOptional() @Matches(DIA, { message: "A data da entrega não é válida" }) deliveredOn?: string;
}

/** Entregar o que estava por entregar, hoje ou num dia que já passou. */
export class EntregarDto {
  @IsOptional() @Matches(DIA, { message: "A data da entrega não é válida" }) deliveredOn?: string;
}

/**
 * Devolver.
 *
 * O estado decide para onde vai a unidade: `GOOD` volta à prateleira, `DAMAGED`
 * e `LOST` saem do total e ficam contadas como baixa. Sem valor por omissão de
 * propósito — quem recebe a devolução tem a peça na mão e é quem sabe.
 */
export class ReturnDto {
  @IsIn(RETURN_CONDITIONS as unknown as string[]) condition!: string;
  @IsOptional() @IsInt() @Min(1) @Max(1000) quantity?: number;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
}
