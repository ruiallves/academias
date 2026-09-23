import { Type } from "class-transformer";
import {
  IsEmail,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  Matches,
  ValidateNested,
} from "class-validator";

/**
 * Os corpos de criação e importação de atletas — classes, não interfaces.
 *
 * Sem uma classe decorada, a `ValidationPipe` global não filtra nada e um campo a
 * mais no corpo (`academyId`, `status` escondido) passa inteiro. Ver a auditoria
 * de segurança, VULN-005. Aqui a forma é validada antes de qualquer lógica correr;
 * as regras de negócio — a equipa existir, a data ser plausível — ficam no serviço.
 *
 * ## Porque é que não há encarregado aqui
 *
 * Um encarregado é uma conta (User + Membership + Supabase Auth). Criá-lo por
 * importação seria criar contas sem consentimento. Um atleta importa-se sozinho; a
 * família liga-se depois pelo fluxo de Famílias, que é o que a app existe para
 * fazer. Ver `docs/03-estado.md`.
 */
export class AthleteInputDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  /** ISO `YYYY-MM-DD`. O serviço rejeita datas fora de um intervalo plausível. */
  @IsISO8601()
  birthdate!: string;

  @IsString()
  @Length(1, 40)
  teamId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  position?: string;

  /**
   * O email do próprio atleta — para onde sai o convite da app. Opcional: um
   * Sub-8 não tem email, e a ficha não pode depender disso. Ver
   * `AthleteInvitesService`.
   */
  @IsOptional()
  @IsEmail({}, { message: "Email do atleta inválido" })
  @Length(3, 254)
  email?: string;

  /**
   * NIF do atleta — nove dígitos. **Obrigatório.**
   *
   * Serve a faturação e, sobretudo, o registo da família: é com ele mais a data de
   * nascimento que um pai prova de quem é pai, ao entrar pela app. Ver
   * `family-invites.service.ts`.
   *
   * Era opcional, com o argumento de que travar uma inscrição por um papel que
   * ainda não chegou era pior. Não era: um atleta sem NIF é um atleta que **nenhuma
   * família consegue reclamar**, e a academia só descobre isso semanas depois,
   * quando o pai liga a dizer que a app não encontra o filho. Um campo obrigatório
   * no momento da inscrição custa trinta segundos; a alternativa custa um telefonema
   * por cada atleta e uma ficha que ninguém se lembra de voltar a abrir.
   *
   * A coluna na base continua a aceitar nulo — há atletas inscritos antes desta
   * regra, e apagá-los não é opção. O que muda é que **nenhuma escrita nova** os
   * cria sem NIF.
   */
  @Matches(/^\d{9}$/, { message: "O NIF tem nove dígitos" })
  taxId!: string;

  @IsOptional()
  @IsISO8601()
  medicalValidUntil?: string;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(250)
  heightCm?: number;

  @IsOptional()
  @IsInt()
  @Min(200) // 20,0 kg em décimas
  @Max(2000) // 200,0 kg — guardamos em décimas de kg para casar com o Decimal(4,1)
  weightDg?: number;

  @IsOptional()
  @Matches(/^(RIGHT|LEFT|BOTH)$/)
  dominantSide?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  squadNumber?: number;

  /**
   * Mandar o convite da app ao atleta que acabou de ser inscrito.
   *
   * **Ligado por omissão**, que é o comportamento de sempre: quem escreve o
   * email costuma querer que o atleta entre na app, e obrigar a um segundo
   * gesto era esquecê-lo. Ausente vale `true`, para um cliente antigo continuar
   * a mandar convite como mandava.
   *
   * Desligar é para inscrever com o email já conhecido **sem** avisar ninguém
   * ainda: o clube que quer convidar o escalão todo no mesmo dia, ou o email
   * que entrou para facturação e mais nada.
   *
   * Sem email não muda nada: não há convite para mandar. Gémeo do `sendInvite`
   * de `MemberCreateDto`.
   *
   * **A importação ignora-o.** Este mesmo DTO descreve as linhas de uma folha
   * (ver `rows` em `ImportAthletesDto`), e lá a decisão é uma só para a
   * importação inteira: `enviarConvites`. Uma escolha por linha num ficheiro
   * de Excel é uma coluna que ninguém preenche.
   */
  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean;
}

/**
 * Editar um atleta que já existe.
 *
 * ## Porque é que não é o DTO de criação com tudo opcional
 *
 * Porque não são a mesma lista. Criar exige equipa, data e NIF; editar tem de
 * poder mexer num campo só sem reenviar os outros. E, sobretudo, esta lista é
 * **fechada por decisão**: são exactamente os campos que o formulário de inscrição
 * já recolhe, e mais nenhum.
 *
 * ## O que fica deliberadamente de fora
 *
 * - **`status`** — dar baixa a um atleta tem consequências em mensalidades e
 *   plantéis. É outra acção, com outra conversa, e não um campo escondido a meio
 *   de um formulário de edição.
 * - **Tudo o que é clínico** — lesões, diagnósticos e altas vivem em
 *   `ClinicalEntry`, com autor registado e permissão própria (`clinical:write`).
 *   Um `PATCH` de atleta que lhes tocasse deitava fora essa rastreabilidade.
 *   `medicalValidUntil` está cá porque é administrativo: a validade do exame, não
 *   o que o exame diz.
 * - **`taxId` a nulo** — corrige-se escrevendo o certo por cima. Ver
 *   `AthleteTaxIdDto`.
 */
export class AthleteUpdateDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsISO8601()
  birthdate?: string;

  /** Mudar de escalão. A equipa nova tem de estar no âmbito de quem edita. */
  @IsOptional()
  @IsString()
  @Length(1, 40)
  teamId?: string;

  /** Vazio limpa a posição — em natação não há nenhuma para escolher. */
  @IsOptional()
  @IsString()
  @Length(0, 40)
  position?: string;

  /** Vazio apaga — uma ficha pode deixar de ter email. */
  @IsOptional()
  @IsString()
  @Length(0, 254)
  email?: string;

  @IsOptional()
  @Matches(/^\d{9}$/, { message: "O NIF tem nove dígitos" })
  taxId?: string;

  @IsOptional()
  @IsISO8601()
  medicalValidUntil?: string;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(250)
  heightCm?: number;

  @IsOptional()
  @IsInt()
  @Min(200)
  @Max(2000)
  weightDg?: number;

  @IsOptional()
  @Matches(/^(RIGHT|LEFT|BOTH)$/)
  dominantSide?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  squadNumber?: number;
}

/**
 * A importação em lote.
 *
 * O tecto de 400 linhas por pedido não é arbitrário: é maior do que qualquer
 * academia real de uma vez, e pequeno o suficiente para não deixar um único pedido
 * abrir 400 escritas numa transação sem fim. Uma academia com mais divide em dois
 * ficheiros — que é raro e aceitável.
 */
export class ImportAthletesDto {
  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => AthleteInputDto)
  rows!: AthleteInputDto[];

  /**
   * Actualizar a ficha de quem já cá está, em vez de recusar a linha.
   *
   * Sem isto, a importação **pára** e devolve a lista de quem foi reconhecido
   * pelo NIF, com o que ia mudar em cada um. Substituir dados de atletas —
   * que são menores — não é decisão que o servidor tome por ver uma folha.
   */
  @IsOptional() @IsBoolean() sobrescrever?: boolean;

  /**
   * Mandar a cada atleta com email o convite para a app.
   *
   * **Desligado por omissão.** Um plantel importado são dezenas de emails a
   * sair em nome do clube num só clique, e quem está a carregar a folha quer
   * primeiro os dados lá dentro. A lista de atletas manda-os depois.
   */
  @IsOptional() @IsBoolean() enviarConvites?: boolean;
}

/**
 * Só o NIF — para corrigir, ou para preencher a ficha de quem foi inscrito antes
 * de o campo ser obrigatório.
 *
 * **Já não aceita `null`.** Apagava-se um NIF para o corrigir a seguir, e entre as
 * duas coisas ficava um atleta que nenhuma família conseguia reclamar. Corrigir é
 * escrever o certo por cima; não há passo intermédio nenhum a proteger.
 */
export class AthleteTaxIdDto {
  @Matches(/^\d{9}$/, { message: "O NIF tem nove dígitos" })
  taxId!: string;
}
