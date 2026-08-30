import {
  ArrayMaxSize,
  ValidateIf,
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

/**
 * Corrigir a ficha de um sócio.
 *
 * ## Vazio quer dizer "apaga", e não "erro"
 *
 * Todos os campos de texto aceitam **string vazia**. Não é frouxidão de
 * validação: é a diferença entre um campo que não veio no pedido (fica como
 * está) e um campo que veio vazio (limpa-se). Sem isto, a morada errada de um
 * sócio ficava lá para sempre — só se podia trocar por outra, nunca tirar.
 *
 * Era também de onde vinha o "obriga a ter morada": a interface mandava sempre
 * os campos todos, os vazios batiam num `@Length(3, 160)` e a gravação era
 * recusada com uma queixa sobre a morada que ninguém tinha pedido para mexer.
 *
 * As validações de **forma** ficam todas. Opcional quer dizer "pode não vir",
 * nunca "pode vir errado": um código postal que venha, vem em 0000-000.
 *
 * ## Os campos de identidade editam-se
 *
 * Data de nascimento, documento e contribuinte já não estão de fora. Estavam por
 * uma razão defensável — corrigem-se a olhar para o documento, e um formulário
 * que os mude em dois cliques é um formulário onde alguém troca o sócio errado —
 * mas a razão não sobreviveu ao balcão: um sócio criado à pressa com o nome e o
 * telemóvel fica **para sempre** sem NIF, e o clube não lhe consegue passar um
 * recibo. O travão certo é a permissão de escrever sócios, que já existe, e o
 * registo de quem alterou.
 */
export class MemberUpdateDto {
  @IsOptional() @IsIn(STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsString() @Length(0, 40) tierId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(9_999_999) number?: number;
  @IsOptional() @IsString() @Length(3, 120) name?: string;

  /** Vazio limpa; preenchido tem de ser um email a sério. */
  @IsOptional() @ValidateIf((o: MemberUpdateDto) => o.email !== "") @IsEmail({}, { message: "Email inválido" }) email?: string;
  @IsOptional() @IsString() @Length(0, 20) phone?: string;
  @IsOptional() @Matches(/^\+\d{1,4}$/, { message: "Indicativo inválido" }) phoneCountry?: string;

  @IsOptional() @IsString() @Length(0, 160) address?: string;
  @IsOptional() @Matches(/^$|^\d{4}-\d{3}$/, { message: "Código postal no formato 0000-000" }) postalCode?: string;
  @IsOptional() @IsString() @Length(0, 80) city?: string;
  @IsOptional() @IsString() @Length(0, 2) country?: string;

  @IsOptional() @ValidateIf((o: MemberUpdateDto) => o.birthdate !== "") @IsISO8601() birthdate?: string;
  @IsOptional() @IsIn(SEXES as unknown as string[]) sex?: string;
  @IsOptional() @IsIn(DOCS as unknown as string[]) documentKind?: string;
  @IsOptional() @IsString() @Length(0, 40) documentNumber?: string;
  @IsOptional() @Matches(/^$|^\d{9}$/, { message: "O NIF tem nove dígitos" }) taxId?: string;

  /**
   * O consentimento. `true` carimba a data de hoje se ainda não houver nenhuma;
   * `false` retira-o — que é o que se faz quando se descobre que a assinatura
   * afinal não existe. Ver o modelo: guarda-se **quando**, não "sim".
   */
  @IsOptional() @IsBoolean() acceptedTerms?: boolean;

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
 * ## Quatro campos obrigatórios, e são estes
 *
 * **Nome, número de sócio, telemóvel e tipo de sócio.** Nada mais.
 *
 * Exigiam-se os mesmos campos da inscrição pública — email, data de nascimento,
 * morada, código postal, localidade, documento e NIF — com o argumento de que um
 * livro importado pela metade é um livro para completar à mão. O argumento estava
 * errado sobre o mundo: **a folha do clube não tem esses campos**. Os livros de
 * sócios reais são o nome, o número, um contacto e a categoria; o resto nunca foi
 * pedido a ninguém. Exigi-lo não produzia fichas completas — produzia clubes que
 * não conseguiam importar, ou que inventavam NIFs para o formulário deixar passar.
 *
 * Um NIF inventado é pior do que um NIF em falta, porque ninguém sabe que está
 * errado.
 *
 * As validações de forma ficam: o que vier, vem certo.
 */
export class MemberImportRowDto {
  /** A linha na folha. Só serve para o relatório dizer onde está o erro. */
  @IsOptional() @IsInt() @Min(1) @Max(100_000) line?: number;

  @IsString() @Length(3, 120) name!: string;
  /** O número do livro do clube. É ele que identifica o sócio — ver `importMembers`. */
  @IsInt() @Min(1) @Max(9_999_999) number!: number;
  @Matches(/^[\d\s]{6,15}$/, { message: "Telemóvel inválido" }) phone!: string;
  /** A categoria pelo nome, como está escrita na folha. */
  @IsString() @Length(1, 60) tier!: string;

  @IsOptional() @ValidateIf((o: MemberImportRowDto) => o.email !== "") @IsEmail({}, { message: "Email inválido" }) email?: string;
  @IsOptional() @ValidateIf((o: MemberImportRowDto) => o.birthdate !== "") @IsISO8601() birthdate?: string;

  @IsOptional() @IsString() @Length(0, 160) address?: string;
  @IsOptional() @Matches(/^$|^\d{4}-\d{3}$/, { message: "Código postal no formato 0000-000" }) postalCode?: string;
  @IsOptional() @IsString() @Length(0, 80) city?: string;
  @IsOptional() @IsString() @Length(2, 2) country?: string;

  @IsOptional() @Matches(/^\+\d{1,4}$/, { message: "Indicativo inválido" }) phoneCountry?: string;

  @IsOptional() @IsString() @Length(0, 40) documentNumber?: string;
  @IsOptional() @Matches(/^$|^\d{9}$/, { message: "O NIF tem nove dígitos" }) taxId?: string;

  @IsOptional() @IsIn(SEXES as unknown as string[]) sex?: string;
  @IsOptional() @IsIn(DOCS as unknown as string[]) documentKind?: string;
  @IsOptional() @IsIn(STATUSES as unknown as string[]) status?: string;
}

export class MemberImportDto {
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => MemberImportRowDto)
  rows!: MemberImportRowDto[];

  /**
   * Criar as categorias que a folha traz e o clube ainda não tem.
   *
   * Sem isto, a importação **pára** e devolve a lista dos nomes desconhecidos —
   * é a pergunta que se faz a quem está a importar, e não uma decisão que o
   * servidor toma sozinho: "Sócio Ouro" a mais no livro do clube é uma categoria
   * a mais nas quotas, nos benefícios e no site.
   */
  @IsOptional() @IsBoolean() createTiers?: boolean;
}

/**
 * Um sócio criado à mão, na secretaria.
 *
 * **Só o nome é obrigatório**, mais um contacto (email ou telemóvel, exigido no
 * serviço). A inscrição pública continua a pedir a ficha inteira, e faz sentido
 * que peça: quem se inscreve pelo site está sentado, com os documentos à mão.
 * Quem chega ao balcão dá o nome e o número de telefone, e o resto completa-se
 * na ficha quando se souber. Ver a migração `socio_manual_leve`.
 *
 * `acceptedTerms` é uma pergunta e não um automatismo. Quem está a preencher tem
 * a pessoa à frente e sabe se ela assinou; carimbar o consentimento só porque
 * alguém da direção abriu um formulário seria inventar a prova que o clube tem de
 * conseguir mostrar.
 */
export class MemberCreateDto {
  @IsOptional() @IsString() @Length(1, 40) tierId?: string;

  @IsString() @Length(3, 120) name!: string;

  /*
   * Tudo o resto é opcional — mas **um contacto** é exigido no serviço.
   *
   * Quem inscreve ao balcão tem o nome e o telemóvel, não o cartão de cidadão.
   * Obrigar à ficha inteira não produzia fichas completas: produzia dados
   * inventados para o formulário deixar gravar, e um NIF inventado é pior do que
   * um NIF em falta porque ninguém sabe que está errado.
   *
   * As validações de **forma** ficam todas: opcional quer dizer "pode não vir",
   * nunca "pode vir errado". Um código postal que venha, vem no formato certo.
   */
  @IsOptional() @IsEmail({}, { message: "Email inválido" }) email?: string;
  @IsOptional() @IsISO8601() birthdate?: string;

  @IsOptional() @IsString() @Length(2, 2) country?: string;
  @IsOptional() @IsString() @Length(3, 160) address?: string;
  @IsOptional() @Matches(/^\d{4}-\d{3}$/, { message: "Código postal no formato 0000-000" }) postalCode?: string;
  @IsOptional() @IsString() @Length(2, 80) city?: string;

  @IsOptional() @Matches(/^\+\d{1,4}$/, { message: "Indicativo inválido" }) phoneCountry?: string;
  @IsOptional() @Matches(/^[\d\s]{6,15}$/, { message: "Telemóvel inválido" }) phone?: string;

  @IsOptional() @IsIn(SEXES as unknown as string[]) sex?: string;
  @IsOptional() @IsIn(DOCS as unknown as string[]) documentKind?: string;
  @IsOptional() @IsString() @Length(4, 40) documentNumber?: string;
  @IsOptional() @Matches(/^\d{9}$/, { message: "O NIF tem nove dígitos" }) taxId?: string;

  @IsOptional() @IsInt() @Min(1) @Max(9_999_999) number?: number;
  @IsOptional() @IsIn(STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsBoolean() acceptedTerms?: boolean;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
}
