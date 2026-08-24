import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

/**
 * Os corpos dos sócios.
 *
 * `MemberSignupDto` é o mais exposto do produto inteiro: chega de um formulário
 * público, de alguém sem sessão, e escreve na base de dados. Sem uma classe
 * decorada a `ValidationPipe` não filtra nada, e um `status: "ACTIVE"` escondido
 * no JSON fazia alguém sócio efectivo sem passar pela direção. Ver VULN-005.
 */

const SEXES = ["FEMALE", "MALE", "UNSPECIFIED"] as const;
const DOCS = ["CC", "PASSPORT", "RESIDENCE", "OTHER"] as const;
const PERIODS = ["MONTHLY", "QUARTERLY", "ANNUAL", "ONCE"] as const;
const STATUSES = ["PENDING", "ACTIVE", "SUSPENDED", "CANCELLED"] as const;

export class MemberSignupDto {
  /** A categoria escolhida. Opcional: um clube pode ainda não ter nenhuma. */
  @IsOptional() @IsString() @Length(1, 40) tierId?: string;

  @IsString() @Length(3, 120) name!: string;
  @IsEmail({}, { message: "Email inválido" }) email!: string;
  @IsISO8601() birthdate!: string;

  /** ISO 3166-1 alfa-2. */
  @IsOptional() @IsString() @Length(2, 2) country?: string;

  @IsString() @Length(3, 160) address!: string;
  /**
   * Código postal português: quatro dígitos, hífen, três.
   *
   * Validado com a forma e não com uma lista de códigos válidos — uma lista
   * desactualiza-se e recusa moradas reais, que é pior do que aceitar um código
   * inexistente que a secretaria corrige numa chamada.
   */
  @Matches(/^\d{4}-\d{3}$/, { message: "Código postal no formato 0000-000" }) postalCode!: string;
  @IsString() @Length(2, 80) city!: string;

  @IsOptional() @Matches(/^\+\d{1,4}$/, { message: "Indicativo inválido" }) phoneCountry?: string;
  @Matches(/^[\d\s]{6,15}$/, { message: "Telemóvel inválido" }) phone!: string;

  @IsOptional() @IsIn(SEXES as unknown as string[]) sex?: string;

  @IsOptional() @IsIn(DOCS as unknown as string[]) documentKind?: string;
  @IsString() @Length(4, 40) documentNumber!: string;

  @Matches(/^\d{9}$/, { message: "O NIF tem nove dígitos" }) taxId!: string;

  /**
   * Os termos. Obrigatório, e verificado no servidor.
   *
   * Uma caixa obrigatória validada só no browser é uma caixa que qualquer pedido
   * directo ignora — e o consentimento que o clube julga ter fica sem base
   * nenhuma. `@IsIn([true])` recusa o pedido em vez de guardar um "não" como se
   * fosse um "sim".
   */
  @IsIn([true], { message: "É preciso aceitar os termos e condições" }) acceptTerms!: boolean;

  /** As duas autorizações opcionais. São perguntas separadas — ver o modelo. */
  @IsOptional() @IsBoolean() partnerComms?: boolean;
  @IsOptional() @IsBoolean() partnerData?: boolean;
}

export class MemberUpdateDto {
  @IsOptional() @IsIn(STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsString() @Length(0, 40) tierId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(9_999_999) number?: number;
  @IsOptional() @IsString() @Length(3, 120) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @Length(6, 20) phone?: string;
  @IsOptional() @IsString() @Length(3, 160) address?: string;
  @IsOptional() @Matches(/^\d{4}-\d{3}$/) postalCode?: string;
  @IsOptional() @IsString() @Length(2, 80) city?: string;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
}

export class MemberTierInputDto {
  @IsString() @Length(2, 60) name!: string;
  @IsOptional() @IsString() @Length(0, 240) description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) benefits?: string[];
  /** Em cêntimos, como todo o dinheiro no produto. */
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) feeCents?: number;
  @IsOptional() @IsIn(PERIODS as unknown as string[]) period?: string;
  @IsOptional() @IsInt() @Min(0) @Max(120) minAge?: number;
  @IsOptional() @IsInt() @Min(0) @Max(120) maxAge?: number;
  @IsOptional() @IsBoolean() isPublic?: boolean;
}

/**
 * Uma linha da folha de sócios do clube.
 *
 * ## Porquê uma classe própria e não a `MemberSignupDto`
 *
 * Porque quem importa não se está a inscrever. Não há termos para aceitar — o
 * sócio já era sócio antes desta plataforma e assinou o que assinou em papel —,
 * e há campos que só existem aqui: o número de sócio que o clube já lhe deu e a
 * categoria por nome, que é como vem escrita numa folha de cálculo.
 *
 * Os campos obrigatórios são os mesmos da inscrição pública. Um livro de sócios
 * importado pela metade é um livro que a secretaria vai ter de completar à mão,
 * pessoa a pessoa, e nessa altura mais valia não ter importado.
 */
export class MemberImportRowDto {
  /** A linha na folha. Só serve para o relatório dizer onde está o erro. */
  @IsOptional() @IsInt() @Min(1) @Max(100_000) line?: number;

  @IsString() @Length(3, 120) name!: string;
  @IsEmail({}, { message: "Email inválido" }) email!: string;
  @IsISO8601() birthdate!: string;

  @IsString() @Length(3, 160) address!: string;
  @Matches(/^\d{4}-\d{3}$/, { message: "Código postal no formato 0000-000" }) postalCode!: string;
  @IsString() @Length(2, 80) city!: string;
  @IsOptional() @IsString() @Length(2, 2) country?: string;

  @IsOptional() @Matches(/^\+\d{1,4}$/, { message: "Indicativo inválido" }) phoneCountry?: string;
  @Matches(/^[\d\s]{6,15}$/, { message: "Telemóvel inválido" }) phone!: string;

  @IsString() @Length(4, 40) documentNumber!: string;
  @Matches(/^\d{9}$/, { message: "O NIF tem nove dígitos" }) taxId!: string;

  @IsOptional() @IsIn(SEXES as unknown as string[]) sex?: string;
  @IsOptional() @IsIn(DOCS as unknown as string[]) documentKind?: string;

  /** A categoria pelo nome, como está escrita na folha. */
  @IsOptional() @IsString() @Length(0, 60) tier?: string;
  /** O número que o clube já usava. Fica como está se estiver livre. */
  @IsOptional() @IsInt() @Min(1) @Max(9_999_999) number?: number;
  @IsOptional() @IsIn(STATUSES as unknown as string[]) status?: string;
}

export class MemberImportDto {
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => MemberImportRowDto)
  rows!: MemberImportRowDto[];
}

/**
 * Um sócio criado à mão, na secretaria.
 *
 * Os mesmos campos obrigatórios da inscrição pública — quem se inscreve na mesa
 * do clube não fica com meia ficha —, mais o que só a direção pode decidir: a
 * categoria, o número e o estado.
 *
 * `acceptedTerms` é uma pergunta e não um automatismo. Quem está a preencher tem
 * a pessoa à frente e sabe se ela assinou; carimbar o consentimento só porque
 * alguém da direção abriu um formulário seria inventar a prova que o clube tem de
 * conseguir mostrar.
 */
export class MemberCreateDto {
  @IsOptional() @IsString() @Length(1, 40) tierId?: string;

  @IsString() @Length(3, 120) name!: string;
  @IsEmail({}, { message: "Email inválido" }) email!: string;
  @IsISO8601() birthdate!: string;

  @IsOptional() @IsString() @Length(2, 2) country?: string;
  @IsString() @Length(3, 160) address!: string;
  @Matches(/^\d{4}-\d{3}$/, { message: "Código postal no formato 0000-000" }) postalCode!: string;
  @IsString() @Length(2, 80) city!: string;

  @IsOptional() @Matches(/^\+\d{1,4}$/, { message: "Indicativo inválido" }) phoneCountry?: string;
  @Matches(/^[\d\s]{6,15}$/, { message: "Telemóvel inválido" }) phone!: string;

  @IsOptional() @IsIn(SEXES as unknown as string[]) sex?: string;
  @IsOptional() @IsIn(DOCS as unknown as string[]) documentKind?: string;
  @IsString() @Length(4, 40) documentNumber!: string;
  @Matches(/^\d{9}$/, { message: "O NIF tem nove dígitos" }) taxId!: string;

  @IsOptional() @IsInt() @Min(1) @Max(9_999_999) number?: number;
  @IsOptional() @IsIn(STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsBoolean() acceptedTerms?: boolean;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
}
