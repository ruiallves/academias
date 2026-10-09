/**
 * Os países, como o boletim da FPF os pede.
 *
 * Na ficha guarda-se o código ISO 3166-1 alfa-2 ("PT"), que é o que toda a
 * gente usa. O boletim pede o nome e um código de três letras ao lado: sai o
 * alfa-3 ("PRT"). Se a federação vier a pedir outro código, é esta tabela que
 * muda e mais nada.
 *
 * Gémea de `apps/console/src/lib/paises.ts` (a consola só precisa dos códigos
 * e dos nomes, para o seletor da ficha).
 */

const TABELA =
  "AD:AND AE:ARE AF:AFG AG:ATG AI:AIA AL:ALB AM:ARM AO:AGO AR:ARG AS:ASM AT:AUT AU:AUS AW:ABW AX:ALA AZ:AZE " +
  "BA:BIH BB:BRB BD:BGD BE:BEL BF:BFA BG:BGR BH:BHR BI:BDI BJ:BEN BL:BLM BM:BMU BN:BRN BO:BOL BQ:BES BR:BRA " +
  "BS:BHS BT:BTN BW:BWA BY:BLR BZ:BLZ CA:CAN CC:CCK CD:COD CF:CAF CG:COG CH:CHE CI:CIV CK:COK CL:CHL CM:CMR " +
  "CN:CHN CO:COL CR:CRI CU:CUB CV:CPV CW:CUW CX:CXR CY:CYP CZ:CZE DE:DEU DJ:DJI DK:DNK DM:DMA DO:DOM DZ:DZA " +
  "EC:ECU EE:EST EG:EGY EH:ESH ER:ERI ES:ESP ET:ETH FI:FIN FJ:FJI FK:FLK FM:FSM FO:FRO FR:FRA GA:GAB GB:GBR " +
  "GD:GRD GE:GEO GF:GUF GG:GGY GH:GHA GI:GIB GL:GRL GM:GMB GN:GIN GP:GLP GQ:GNQ GR:GRC GT:GTM GU:GUM GW:GNB " +
  "GY:GUY HK:HKG HN:HND HR:HRV HT:HTI HU:HUN ID:IDN IE:IRL IL:ISR IM:IMN IN:IND IQ:IRQ IR:IRN IS:ISL IT:ITA " +
  "JE:JEY JM:JAM JO:JOR JP:JPN KE:KEN KG:KGZ KH:KHM KI:KIR KM:COM KN:KNA KP:PRK KR:KOR KW:KWT KY:CYM KZ:KAZ " +
  "LA:LAO LB:LBN LC:LCA LI:LIE LK:LKA LR:LBR LS:LSO LT:LTU LU:LUX LV:LVA LY:LBY MA:MAR MC:MCO MD:MDA ME:MNE " +
  "MF:MAF MG:MDG MH:MHL MK:MKD ML:MLI MM:MMR MN:MNG MO:MAC MP:MNP MQ:MTQ MR:MRT MS:MSR MT:MLT MU:MUS MV:MDV " +
  "MW:MWI MX:MEX MY:MYS MZ:MOZ NA:NAM NC:NCL NE:NER NF:NFK NG:NGA NI:NIC NL:NLD NO:NOR NP:NPL NR:NRU NU:NIU " +
  "NZ:NZL OM:OMN PA:PAN PE:PER PF:PYF PG:PNG PH:PHL PK:PAK PL:POL PM:SPM PR:PRI PS:PSE PT:PRT PW:PLW PY:PRY " +
  "QA:QAT RE:REU RO:ROU RS:SRB RU:RUS RW:RWA SA:SAU SB:SLB SC:SYC SD:SDN SE:SWE SG:SGP SH:SHN SI:SVN SK:SVK " +
  "SL:SLE SM:SMR SN:SEN SO:SOM SR:SUR SS:SSD ST:STP SV:SLV SX:SXM SY:SYR SZ:SWZ TC:TCA TD:TCD TG:TGO TH:THA " +
  "TJ:TJK TL:TLS TM:TKM TN:TUN TO:TON TR:TUR TT:TTO TV:TUV TW:TWN TZ:TZA UA:UKR UG:UGA US:USA UY:URY UZ:UZB " +
  "VA:VAT VC:VCT VE:VEN VG:VGB VI:VIR VN:VNM VU:VUT WF:WLF WS:WSM XK:XKX YE:YEM YT:MYT ZA:ZAF ZM:ZMB ZW:ZWE";

const ALFA3 = new Map(TABELA.split(" ").map((par) => par.split(":") as [string, string]));

/** Os 27 da União Europeia. Portugal está cá, mas o estatuto dele é "Português". */
const UE = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

/** O código como se guarda: duas letras maiúsculas que existem na tabela, ou nulo. */
export function codigoDePais(v: string | null | undefined): string | null {
  const c = (v ?? "").trim().toUpperCase();
  return ALFA3.has(c) ? c : null;
}

export function alfa3(codigo: string | null | undefined): string | null {
  return codigo ? (ALFA3.get(codigo) ?? null) : null;
}

const nomes = new Intl.DisplayNames(["pt-PT"], { type: "region" });

export function nomeDoPais(codigo: string | null | undefined): string | null {
  if (!codigo || !ALFA3.has(codigo)) return null;
  try {
    return nomes.of(codigo) ?? codigo;
  } catch {
    return codigo;
  }
}

/**
 * O estatuto perante a FPF, pela nacionalidade.
 *
 * O "Estatuto Geral de Igualdade" (brasileiros que o pediram ao Estado) não se
 * adivinha pela nacionalidade: quem o tem escreve-o à mão na folha.
 */
export function estatutoFpf(nacionalidade: string | null | undefined): string | null {
  if (!nacionalidade) return null;
  if (nacionalidade === "PT") return "Português";
  if (UE.has(nacionalidade)) return "União Europeia";
  return "Estrangeiro";
}

export const TODOS_OS_PAISES: readonly string[] = [...ALFA3.keys()];
