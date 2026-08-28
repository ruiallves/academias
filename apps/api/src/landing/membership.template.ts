import { clubPalette } from "../common/contrast";
import type { AcademyBranding } from "./landing.template";

/**
 * "Faz parte do clube" — a adesão a sócio.
 *
 * ## O que segura a experiência
 *
 * Ninguém acorda com vontade de preencher um formulário. Mas há pessoas que
 * acordam com vontade de **ter o cartão**. Por isso há um cartão de sócio no ecrã
 * desde o primeiro segundo, e ele **preenche-se à medida que se escreve**: o nome
 * aparece nele, a categoria muda-lhe a etiqueta, o número fica em traços à espera
 * de aprovação. O trabalho é o mesmo; o que muda é para onde se olha.
 *
 * ## O clube escreve a página
 *
 * A frase de abertura, a que explica e os pontos que dizem o que se ganha vêm de
 * `Academy.membershipHeadline` / `membershipIntro` / `membershipPoints`, editáveis
 * em Definições. Uma frase escrita por nós seria a mesma em quinhentos clubes — e
 * uma frase igual em quinhentos sítios não convence ninguém. O que está em código
 * é só o que aparece a quem ainda não escreveu nada.
 *
 * ## A linguagem gráfica
 *
 * Estilhaços angulares na cor do clube, em vez de fotografia. Duas razões: uma
 * fotografia teria de existir para cada clube (e não existe), e um fundo liso com
 * cartões brancos é exactamente a estética anónima que este produto não pode ter.
 * Derivam da cor configurada — mudam com o clube, sem um único ficheiro de imagem.
 *
 * ## Nota técnica
 *
 * Isto vive dentro de um template literal de TypeScript: **nenhuma crase pode
 * aparecer no HTML, CSS ou JS abaixo**. O JS do browser usa concatenação com `+`
 * por essa razão, e não por gosto.
 */

export type PublicTier = {
  id: string;
  name: string;
  description: string | null;
  benefits: string[];
  feeCents: number | null;
  period: "MONTHLY" | "QUARTERLY" | "ANNUAL" | "ONCE";
  minAge: number | null;
  maxAge: number | null;
};

const PERIOD_SHORT: Record<PublicTier["period"], string> = {
  MONTHLY: "/mês",
  QUARTERLY: "/tri",
  ANNUAL: "/ano",
  ONCE: "único",
};

/** O que aparece a um clube que ainda não escreveu a sua página. */
const FALLBACK_HEADLINE = "Faz parte do clube.";
const FALLBACK_INTRO =
  "Ser sócio não é uma subscrição. É estar do lado de dentro — e ficar com um lugar que é teu.";
const FALLBACK_POINTS = [
  "Cartão de sócio digital, sempre no telemóvel",
  "Participação na vida do clube",
  "Comunicações que só os sócios recebem",
];

export function renderMembershipPage(opts: {
  academy: AcademyBranding;
  tiers: PublicTier[];
  pageUrl: string;
  apiOrigin: string;
}): string {
  const { academy, tiers, pageUrl, apiOrigin } = opts;

  /*
   * As cores desta academia, já com a tinta decidida.
   *
   * `clubPalette` valida o hex e devolve o tom certo para cada trabalho — é
   * também por isso que o `esc()` desapareceu daqui: o que entra no CSS já não é
   * texto do utilizador, é uma cor calculada. Ver `common/contrast.ts`.
   */
  const paleta = clubPalette(academy.signalColor);

  const headline = (academy.membershipHeadline ?? "").trim() || FALLBACK_HEADLINE;
  const intro = (academy.membershipIntro ?? "").trim() || FALLBACK_INTRO;
  const written = (academy.membershipPoints ?? []).filter((p) => p.trim());
  const points = written.length ? written : FALLBACK_POINTS;

  const title = headline + " — " + academy.shortName;
  const description = "Torna-te sócio do " + academy.name + ". " + intro;
  const from = cheapest(tiers);
  const hasPlans = tiers.length > 0;

  return `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta name="theme-color" content="#ffffff" />

<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(pageUrl)}" />

<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100,600;100,700;112,700&family=Instrument+Sans:wght@400;500;600&display=swap" />

<style>
  /* ====================================================================
     Paleta — clara e quente, com a cor do clube a fazer o trabalho de cor.
     ==================================================================== */
  :root {
    /*
       A cor do clube, e as que dela se derivam. (Sem crases: ver a nota técnica
       no cabeçalho — isto vive dentro de um template literal.)

       --club e --club-deep pintam o que NÃO tem texto por cima: os estilhaços, o
       contorno de um campo com foco, o traço debaixo do passo actual.
       --club-strong é a mesma cor para superfícies COM texto, e --club-on é a
       tinta que se lê nela. Um clube de amarelo claro recebe aqui tinta escura,
       sem ninguém ter de configurar nada. Ver common/contrast.ts.
    */
    --club: ${paleta.club};
    --club-strong: ${paleta.strong};
    --club-on: ${paleta.on};
    /* A mesma tinta em partes, para o que e translucido dentro do cartao. */
    --club-on-rgb: ${paleta.onRgb};
    --club-ink: ${paleta.ink};
    --club-deep: ${paleta.deep};
    --club-lift: ${paleta.lift};
    --paper: #ffffff;
    --canvas: #fbfaf8;
    --line: #e7e4dd;
    --line-2: #d5d1c8;
    --ink: #14130f;
    --ink-2: #55524a;
    --ink-3: #8b877c;
    --ink-4: #b3aea3;
    --bad: #b3271b;
  }

  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

  body {
    margin: 0;
    background: var(--canvas);
    color: var(--ink-2);
    font-family: "Instrument Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 16px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
  }

  /* O display é um grotesco largo e pesado — voz de marca desportiva, e não a
     geométrica redonda que qualquer template usa. */
  .display {
    font-family: "Archivo", ui-sans-serif, system-ui, sans-serif;
    font-variation-settings: "wdth" 112;
    font-weight: 700;
    letter-spacing: -0.035em;
    line-height: 1.02;
    color: var(--ink);
  }

  ::selection { background: var(--club-strong); color: var(--club-on); }
  a { color: var(--club-ink); }

  /* ====================================================================
     Estilhaços — a linguagem gráfica do clube, sem uma imagem
     ==================================================================== */

  .shards { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
  .shards i { position: absolute; display: block; }

  .s1 { width: 190px; height: 130px; left: -46px; bottom: 12%;
        background: var(--club); clip-path: polygon(0 0, 100% 42%, 30% 100%); opacity: 0.9; }
  .s2 { width: 150px; height: 190px; left: 46px; bottom: 4%;
        background: var(--club-deep); clip-path: polygon(0 22%, 100% 0, 62% 100%); opacity: 0.85; }
  .s3 { width: 92px; height: 62px; left: 132px; bottom: 26%;
        background: var(--club); clip-path: polygon(0 50%, 100% 0, 78% 100%); opacity: 0.45; }
  .s4 { width: 210px; height: 150px; right: -60px; top: 16%;
        background: var(--club); clip-path: polygon(0 0, 100% 50%, 26% 100%); opacity: 0.5; }
  .s5 { width: 160px; height: 210px; right: 30px; top: 32%;
        background: var(--club-deep); clip-path: polygon(30% 0, 100% 30%, 0 100%); opacity: 0.65; }
  .s6 { width: 120px; height: 84px; right: -20px; bottom: 10%;
        background: var(--club); clip-path: polygon(0 30%, 100% 0, 60% 100%); opacity: 0.35; }

  /* Abaixo de 1300px os estilhaços da direita ficariam por cima do cartão. */
  @media (max-width: 1300px) { .s4, .s5 { display: none; } }
  @media (max-width: 900px) {
    .s3 { display: none; }
    .s1, .s2 { transform: scale(0.5); transform-origin: left bottom; opacity: 0.4; }
    .s6 { transform: scale(0.5); transform-origin: right bottom; opacity: 0.25; }
  }

  /* ====================================================================
     Estrutura
     ==================================================================== */

  .page { position: relative; z-index: 1; min-height: 100svh; display: flex; flex-direction: column; }
  .wrap { width: 100%; max-width: 1120px; margin: 0 auto; padding: 0 clamp(20px, 4vw, 40px); }

  /*
     A barra do topo: emblema, nome, e ar por baixo.

     O align-items: center sempre lá esteve e mesmo assim o nome lia-se alto ao
     lado do emblema. A razao nao e o alinhamento — e a caixa que se esta a
     alinhar. O nome herda line-height 1.5 do body, por isso a caixa dele tem
     uma vez e meia a altura da letra, e o espaco que sobra distribui-se por
     cima e por baixo. Em maiusculas nao ha descendentes nenhumas a ocupar o de
     baixo: as letras assentam na metade de cima da caixa, a caixa fica centrada
     com o emblema, e as letras ficam acima do meio dele. Ver a regra .bar .nm mais abaixo.

     O respiro por baixo subiu de 24 para 32 no minimo. Com 4vw, um ecra de
     telemovel dava 24 e pouco — menos de metade da altura do emblema — e o
     "Faz-te socio" ficava colado ao escudo.
  */
  header.bar { display: flex; align-items: center; gap: 16px; padding: clamp(20px, 3vw, 34px) 0 clamp(32px, 4vw, 44px); }
  /*
     O circulo e o recurso, nao a moldura.

     Um emblema de clube tem forma propria e fundo transparente. Metido num
     circulo com object-fit: cover, ficava cortado nos lados e assente num disco
     da cor do clube que ninguem desenhou. Com emblema nao ha caixa: a forma e a
     do emblema. Sem emblema, o disco com as iniciais fica.

     (Sem crases: isto vive dentro de um template literal.)
  */
  .crest { --crest: 44px;
           width: var(--crest); height: var(--crest); border-radius: 50%; flex: none;
           background: var(--club-strong); color: var(--club-on);
           display: grid; place-items: center; font-weight: 700; font-size: 14px; }
  .crest.logo { background: none; border-radius: 0; }
  /*
     A medida em pixeis, e nao em percentagem.

     Era width/height a 100%, e a altura nao pegava: a imagem e um item de grelha
     com place-items: center, por isso nao estica, e o height: 100% acabava
     resolvido como auto. Ficava com 44px de largura e a altura que a proporcao
     do ficheiro pedisse — um escudo alto e estreito (46x64) dava 61px e
     transbordava 17px por baixo da caixa.

     O efeito era o alinhamento: a caixa ficava centrada com o nome do clube, o
     escudo ficava centrado 9px mais abaixo, e lia-se o titulo acima do simbolo.
     Medido, nao adivinhado: .crest MEIO=51.5, .crest img MEIO=60.1.

     Com a mesma medida explicita nos dois, o object-fit: contain encaixa o
     emblema dentro do quadrado seja qual for a forma dele.
  */
  .crest.logo img { display: block; width: var(--crest); height: var(--crest); object-fit: contain; border-radius: 0; }
  .bar .nm {
    font-family: "Archivo", sans-serif; font-variation-settings: "wdth" 100;
    font-weight: 700; font-size: clamp(17px, 2.4vw, 22px); letter-spacing: 0.01em;
    text-transform: uppercase; color: var(--ink);
    /* A caixa colada a letra. Ver a nota em header.bar: com o 1.5 herdado, o
       espaco de baixo ficava vazio (nao ha descendentes em maiusculas) e
       empurrava as letras para cima do meio do emblema. */
    line-height: 1;
  }
  .bar .club { margin-left: auto; font-size: 12.5px; color: var(--ink-3); white-space: nowrap; }
  /*
     Ao pe do telemovel, o nome do clube fica com a barra toda.

     "Adesao a socio" e uma etiqueta, nao informacao: o titulo da pagina, o
     "Faz-te socio" logo abaixo e o proprio endereco ja dizem onde a pessoa
     esta. Num ecra estreito disputava o espaco com o nome do clube e partia-se
     em duas linhas ("Ade / socio"), que e pior do que nao estar la.
  */
  @media (max-width: 620px) { .bar .club { display: none; } }

  main { flex: 1; }

  .cols { display: grid; gap: clamp(28px, 5vw, 64px); align-items: start; }
  @media (min-width: 940px) { .cols { grid-template-columns: minmax(0, 1fr) 320px; } }

  /* ====================================================================
     Passos — numerais, como uma paginação. Não uma barra de progresso: uma
     barra convida a calcular quanto falta; um número diz onde se está.
     ==================================================================== */

  footer.foot { padding: clamp(32px, 5vw, 52px) 0 32px; font-size: 12.5px; color: var(--ink-4); }

  .steps { display: none; gap: 20px; margin-bottom: clamp(20px, 3vw, 30px); }
  .steps[data-on] { display: flex; }
  .steps b {
    font-family: "Archivo", sans-serif; font-weight: 600; font-size: 15px;
    color: var(--ink-4); padding-bottom: 6px; border-bottom: 2px solid transparent;
    transition: color 200ms ease, border-color 200ms ease;
  }
  .steps b[data-done] { color: var(--ink-3); }
  .steps b[data-now] { color: var(--ink); border-bottom-color: var(--club); }

  .kicker {
    font-size: 12.5px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--club-ink); margin-bottom: 10px;
  }

  /* A frase de abertura não parte. Uma frase partida em duas linhas por acaso
     deixa de ser um slogan e passa a ser texto corrido. */
  h1.display { margin: 0 0 16px; font-size: clamp(30px, 5.4vw, 60px); white-space: nowrap; }
  @media (max-width: 460px) {
    /* Num ecrã estreito, ler ganha a não partir. */
    h1.display { white-space: normal; font-size: clamp(27px, 8vw, 38px); }
  }

  h2.display { margin: 0 0 12px; font-size: clamp(28px, 4.4vw, 46px); }

  .lede { margin: 0; max-width: 46ch; font-size: clamp(15.5px, 1.8vw, 18px); color: var(--ink-2); }
  .req { margin: 0 0 20px; font-size: 13px; color: var(--club-ink); font-weight: 500; }

  /* ====================================================================
     Ecrãs
     ==================================================================== */

  .screen { display: none; }
  .screen[data-active] { display: block; animation: in 380ms cubic-bezier(0.22, 1, 0.36, 1) both; }
  @keyframes in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

  .head { margin-bottom: clamp(24px, 4vw, 38px); }

  /* ====================================================================
     Pontos do clube
     ==================================================================== */

  .points { margin: clamp(24px, 4vw, 36px) 0 0; padding: 0; list-style: none; }
  .points li {
    display: flex; gap: 16px; align-items: baseline;
    padding: 16px 0; border-top: 1px solid var(--line);
    font-size: 16px; color: var(--ink);
  }
  /* Sem risco a fechar a lista: o que a fecha e o da barra de accoes logo abaixo.
     Um por ponto, e nao mais do que isso. */
  .points li::before {
    content: ""; flex: none; width: 13px; height: 10px;
    background: var(--club); clip-path: polygon(0 0, 100% 50%, 0 100%);
  }

  /* ====================================================================
     Campos
     ==================================================================== */

  .fields { display: grid; gap: 18px 16px; grid-template-columns: 1fr; }
  @media (min-width: 620px) {
    .fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .fields .full { grid-column: 1 / -1; }
  }

  /*
     Codigo postal e cidade andam juntos e nao pedem o mesmo espaco: sete digitos
     nunca precisam de metade da linha, e o nome de uma localidade precisa. Numa
     grelha de duas colunas iguais ficavam a disputar a mesma largura.
  */
  .pair { display: grid; gap: 18px 16px; grid-template-columns: 1fr; }
  @media (min-width: 620px) { .pair { grid-template-columns: minmax(0, 210px) minmax(0, 1fr); } }

  .f { min-width: 0; }
  .f > label {
    display: block; font-size: 12px; font-weight: 600; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--ink-3); margin-bottom: 7px;
  }

  .f input, .f select {
    width: 100%; height: 52px; padding: 0 15px;
    font: inherit; font-size: 16px; color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--line-2); border-radius: 2px;
    appearance: none;
    transition: border-color 140ms ease, box-shadow 140ms ease;
  }
  .f input::placeholder { color: var(--ink-4); }
  .f input:focus, .f select:focus {
    outline: none; border-color: var(--club);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--club) 15%, transparent);
  }
  .f[data-bad] input, .f[data-bad] select { border-color: var(--bad); }

  .f select {
    background-image:
      linear-gradient(45deg, transparent 50%, var(--ink-3) 50%),
      linear-gradient(135deg, var(--ink-3) 50%, transparent 50%);
    background-position: calc(100% - 19px) 24px, calc(100% - 14px) 24px;
    background-size: 5px 5px; background-repeat: no-repeat;
    padding-right: 36px; cursor: pointer;
  }

  .err { display: none; margin-top: 7px; font-size: 13px; color: var(--bad); }
  .f[data-bad] .err { display: block; }

  /*
     Data e codigo postal: campos partidos em segmentos.

     Os segmentos repartem a largura da celula em vez de a fixarem em pixeis. Com
     larguras fixas, DD/MM/AAAA somava mais do que a coluna dava numa janela media
     e transbordava por cima do cartao ao lado. Cresce cada um a pensar nos digitos
     que recebe, e o conjunto nunca passa do limite dos outros campos.
  */
  .segs { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .segs input { flex: 1 1 0; min-width: 0; text-align: center; padding-inline: 4px; }
  .segs .sep { color: var(--ink-4); flex: none; }
  .w2 { flex-grow: 2; }
  .w3 { flex-grow: 3; }
  .w4 { flex-grow: 4; }

  .tel { display: flex; gap: 8px; }
  .tel select { width: 104px; flex: none; padding-right: 28px;
                background-position: calc(100% - 15px) 24px, calc(100% - 10px) 24px; }
  .tel input { flex: 1; min-width: 0; }

  /* Sexo em pastilhas: três opções nunca justificam um menu. */
  .pills { display: flex; flex-wrap: wrap; gap: 7px; }
  .pills button {
    font: inherit; font-size: 14.5px; height: 52px; padding: 0 18px;
    border: 1px solid var(--line-2); border-radius: 2px;
    background: var(--paper); color: var(--ink-2); cursor: pointer;
    transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease;
  }
  .pills button:hover { border-color: var(--ink-4); }
  .pills button[aria-pressed="true"] { background: var(--ink); border-color: var(--ink); color: #fff; font-weight: 600; }

  /* ====================================================================
     Categorias
     ==================================================================== */

  .plans { display: grid; gap: 12px; }
  @media (min-width: 700px) { .plans { grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); } }

  .plan { position: relative; display: flex; }
  .plan input { position: absolute; inset: 0; opacity: 0; cursor: pointer; margin: 0; }
  .plan .face {
    flex: 1; display: flex; flex-direction: column;
    background: var(--paper); border: 1px solid var(--line-2);
    border-radius: 2px; padding: 24px 22px; cursor: pointer;
    transition: border-color 140ms ease, box-shadow 140ms ease;
  }
  .plan input:hover + .face { border-color: var(--ink-4); }
  .plan input:checked + .face { border-color: var(--club); box-shadow: inset 0 0 0 1px var(--club); }
  .plan input:focus-visible + .face { outline: 2px solid var(--club); outline-offset: 3px; }

  .plan .nm { font-size: 16px; font-weight: 600; color: var(--ink); }
  .plan .ag { font-size: 12.5px; color: var(--ink-4); margin-top: 2px; }
  .plan .pr {
    font-family: "Archivo", sans-serif; font-variation-settings: "wdth" 100; font-weight: 700;
    font-size: 34px; letter-spacing: -0.03em; color: var(--ink);
    margin: 14px 0 0; font-variant-numeric: tabular-nums;
  }
  .plan .pr span { font-family: "Instrument Sans", sans-serif; font-weight: 500; font-size: 13px;
                   color: var(--ink-3); letter-spacing: 0; }
  .plan .ds { margin: 8px 0 0; font-size: 14px; color: var(--ink-3); }
  .plan ul { margin: 14px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .plan ul li { display: flex; gap: 9px; font-size: 13.5px; color: var(--ink-2); }
  .plan ul li::before {
    content: ""; flex: none; width: 9px; height: 7px; margin-top: 6px;
    background: var(--club); clip-path: polygon(0 0, 100% 50%, 0 100%);
  }

  /* ====================================================================
     Consentimentos
     ==================================================================== */

  .consents { display: flex; flex-direction: column; }
  .cs { display: flex; gap: 14px; align-items: flex-start; padding: 15px 0; cursor: pointer; }
  .cs + .cs { border-top: 1px solid var(--line); }
  .cs input { position: absolute; opacity: 0; width: 0; height: 0; }
  .box {
    width: 20px; height: 20px; flex: none; margin-top: 1px;
    border: 1.5px solid var(--line-2); background: var(--paper);
    display: grid; place-items: center;
    transition: background-color 130ms ease, border-color 130ms ease;
  }
  .box::after {
    content: ""; width: 9px; height: 5px;
    border-left: 2px solid var(--club-on); border-bottom: 2px solid var(--club-on);
    transform: rotate(-45deg) scale(0.5); opacity: 0; margin-top: -2px;
    transition: opacity 130ms ease, transform 130ms ease;
  }
  .cs input:checked + .box { background: var(--club-strong); border-color: var(--club-strong); }
  .cs input:checked + .box::after { opacity: 1; transform: rotate(-45deg) scale(1); }
  .cs input:focus-visible + .box { outline: 2px solid var(--club); outline-offset: 3px; }
  .cs .tx { font-size: 15px; color: var(--ink-2); }
  .cs .tx b { color: var(--ink); font-weight: 600; }

  /* ====================================================================
     Acção — voltar à esquerda, avançar à direita.
     ==================================================================== */

  .actions {
    display: flex; align-items: center; gap: 16px;
    margin-top: clamp(28px, 5vw, 44px); padding-top: 22px;
    border-top: 1px solid var(--line);
  }

  /* A seguir aos pontos, o risco das accoes e o que fecha a lista — o mesmo
     risco que separa dois pontos, e por isso fica à mesma distância do último
     texto que qualquer risco interno fica do texto acima dele: os 16px do
     padding do <li>, e nem um pixel mais. O padding-top do proprio .actions
     e' o que sobra por baixo do risco, antes do botao — nao soma por cima. */
  .points + .actions { margin-top: 0; }

  .back {
    display: none; align-items: center; gap: 8px;
    background: none; border: 0; cursor: pointer; font: inherit; font-size: 15px;
    color: var(--ink-3); padding: 8px 0;
  }
  .back:hover { color: var(--ink); }
  .back[data-on] { display: inline-flex; }

  .go {
    margin-left: auto; height: 54px; min-width: 190px; padding: 0 34px;
    display: inline-flex; align-items: center; justify-content: center;
    font: inherit; font-size: 15px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--club-on); background: var(--club-strong);
    border: 0; border-radius: 2px; cursor: pointer;
    transition: background-color 140ms ease;
  }
  .go:hover { background: var(--club-deep); }
  .go[disabled] { background: var(--ink-4); cursor: not-allowed; }

  @media (max-width: 560px) {
    .actions { flex-direction: column-reverse; align-items: stretch; }
    .back { justify-content: center; }
    .go { margin-left: 0; width: 100%; }
  }

  .fail {
    margin-top: 16px; padding: 13px 16px;
    background: color-mix(in oklab, var(--bad) 8%, white);
    border-left: 3px solid var(--bad);
    color: var(--bad); font-size: 14px;
  }
  .fail:empty { display: none; }

  /* ====================================================================
     O cartão
     ==================================================================== */

  .card-col { position: sticky; top: 28px; }
  @media (max-width: 939px) { .card-col { position: static; margin-bottom: 28px; max-width: 320px; } }

  /*
     O cartao inteiro na tinta que se le nele.

     A cor de base ja vinha de --club-on, mas tudo o que e translucido la dentro
     — o rotulo da categoria, as etiquetas, o circulo das iniciais, o estilhaco —
     estava escrito a branco fixo. Num clube de cor clara sobrava o nome legivel
     e o resto invisivel: branco sobre amarelo. Agora tudo sai de --club-on-rgb,
     que e a mesma decisao de contraste, em partes. */
  .card {
    position: relative; aspect-ratio: 1.586; border-radius: 10px;
    padding: 24px; color: var(--club-on); display: flex; flex-direction: column; overflow: hidden;
    background:
      radial-gradient(130% 130% at 88% -10%, var(--club-lift) 0%, transparent 58%),
      linear-gradient(152deg, var(--club-strong) 0%, var(--club-deep) 100%);
    box-shadow: 0 24px 50px -26px color-mix(in oklab, var(--club) 55%, black);
  }
  /* O mesmo estilhaço da página, dentro do cartão: a marca gráfica repete-se. */
  .card::after {
    content: ""; position: absolute; right: -30px; bottom: -20px;
    width: 190px; height: 150px;
    background: rgb(var(--club-on-rgb) / 0.08);
    clip-path: polygon(0 40%, 100% 0, 70% 100%);
  }
  .card .ct { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .card .cc { --cc: 32px;
              width: var(--cc); height: var(--cc); flex: none; border-radius: 50%;
              background: rgb(var(--club-on-rgb) / 0.22);
              display: grid; place-items: center; font-size: 11px; font-weight: 700; }
  .card .cc.logo { background: none; border-radius: 0; }
  /* Medida explicita, pela mesma razao do .crest la em cima: com place-items:
     center o height a 100% nao pega, e um emblema alto transborda a caixa. */
  .card .cc.logo img { display: block; width: var(--cc); height: var(--cc); object-fit: contain; border-radius: 0; }
  /*
     22ch cabe as categorias normais numa linha só; o "13ch" que aqui estava era
     apertado a mais e partia algo tao curto como "Socio Clube +" a meio, deixando
     o sinal "+" sozinho na linha de baixo. white-space:nowrap fecha a porta a
     isso de vez — um nome de categoria maior do que o cartao aguenta corta com
     reticencias em vez de quebrar linha, e min-width:0 deixa o texto encolher
     dentro da linha flexivel sem empurrar o logotipo.
  */
  .card .tier { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase;
                color: rgb(var(--club-on-rgb) / 0.85); text-align: right; max-width: 22ch; min-width: 0;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card .nm {
    position: relative; z-index: 1; margin-top: auto;
    font-family: "Archivo", sans-serif; font-variation-settings: "wdth" 100; font-weight: 600;
    font-size: 19px; letter-spacing: 0.01em; text-transform: uppercase; min-height: 1.2em;
    /*
       O tamanho de letra é ajustado por JS a cada tecla (ver fitCardName mais
       abaixo), para que o nome apareça sempre inteiro em vez de cortado. O
       white-space nowrap é o que torna essa medição fiável — sem quebra de
       linha, o scrollWidth diz exactamente se o nome cabe ao tamanho actual. O
       text-overflow ellipsis fica como rede: só entra em jogo se um nome for
       tão comprido que nem o tamanho mínimo de letra o encaixe no cartão.
    */
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .card .nm[data-empty] { color: rgb(var(--club-on-rgb) / 0.4); text-transform: none; font-weight: 400;
                          font-family: "Instrument Sans", sans-serif; }
  .card .bt { position: relative; z-index: 1; display: flex; align-items: flex-end; justify-content: space-between; margin-top: 8px; }
  .card .lb { font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: rgb(var(--club-on-rgb) / 0.6); }
  .card .no { font-size: 14px; font-weight: 600; letter-spacing: 0.16em; font-variant-numeric: tabular-nums; }
  .card .cl { font-size: 10.5px; color: rgb(var(--club-on-rgb) / 0.72); }

  .card-note { margin: 14px 2px 0; font-size: 12.5px; color: var(--ink-4); }

  /* ====================================================================
     Fim
     ==================================================================== */

  .track { margin: clamp(24px, 4vw, 36px) 0 0; padding: 0; list-style: none; }
  .track li { display: flex; gap: 14px; align-items: center; padding: 15px 0;
              border-top: 1px solid var(--line); font-size: 15.5px; color: var(--ink); }
  .track li:last-child { border-bottom: 1px solid var(--line); }
  .track .ic { width: 20px; height: 20px; flex: none; display: grid; place-items: center; font-size: 10px; font-weight: 700; }
  .track .ic[data-done] { background: var(--club-strong); color: var(--club-on); }
  .track .ic[data-wait] { border: 1.5px dashed var(--line-2); color: transparent; }
  .track li[data-pending] { color: var(--ink-4); }


  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
</style>
</head>
<body>

<div class="shards" aria-hidden="true">
  <i class="s1"></i><i class="s2"></i><i class="s3"></i>
  <i class="s4"></i><i class="s5"></i><i class="s6"></i>
</div>

<div class="page">
  <div class="wrap">
    <header class="bar">
      <div class="crest${academy.logoUrl ? " logo" : ""}">${academy.logoUrl ? `<img src="${esc(academy.logoUrl)}" alt="" />` : esc(academy.mark)}</div>
      <div class="nm">${esc(academy.shortName)}</div>
      <div class="club">Adesão a sócio</div>
    </header>
  </div>

  <main class="wrap">
    <div class="steps" id="steps" aria-hidden="true"><b>1</b><b>2</b><b>3</b><b>4</b></div>

    <div class="cols">
      <div>

        <!-- ============ Intro ============ -->
        <section class="screen" data-screen="intro" data-active>
          <div class="head">
            <div class="kicker">Faz-te sócio</div>
            <h1 class="display">${esc(headline)}</h1>
            <p class="lede">${esc(intro)}</p>
          </div>

          <ul class="points">${points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>

          <div class="actions">
            <button type="button" class="go" data-next>Começar${from !== null ? " · desde " + esc(money(from)) : ""}</button>
          </div>
        </section>

        ${hasPlans ? renderPlanScreen(tiers) : ""}

        <!-- ============ 1 · Os teus dados ============ -->
        <section class="screen" data-screen="s1" data-step="0">
          <div class="head">
            <div class="kicker">Faz-te sócio</div>
            <h2 class="display">Os teus dados</h2>
          </div>
          <p class="req">*Todos os campos são obrigatórios</p>

          <div class="fields">
            <div class="f full" data-f="name">
              <label for="i-name">Nome completo</label>
              <input id="i-name" type="text" autocomplete="name" autocapitalize="words" placeholder="Como no documento" maxlength="120" />
              <div class="err"></div>
            </div>

            <div class="f" data-f="email">
              <label for="i-email">E-mail</label>
              <input id="i-email" type="email" inputmode="email" autocomplete="email" placeholder="nome@exemplo.pt" />
              <div class="err"></div>
            </div>

            <div class="f" data-f="birth">
              <label>Data de nascimento</label>
              <div class="segs">
                <input class="w2" id="i-bd" type="text" inputmode="numeric" maxlength="2" placeholder="DD" aria-label="Dia" />
                <span class="sep">/</span>
                <input class="w2" id="i-bm" type="text" inputmode="numeric" maxlength="2" placeholder="MM" aria-label="Mês" />
                <span class="sep">/</span>
                <input class="w4" id="i-by" type="text" inputmode="numeric" maxlength="4" placeholder="AAAA" aria-label="Ano" />
              </div>
              <div class="err"></div>
            </div>
          </div>

          <div class="actions">
            <button type="button" class="back" data-back>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Voltar
            </button>
            <button type="button" class="go" data-next>Seguinte</button>
          </div>
        </section>

        <!-- ============ 2 · Identificação ============ -->
        <section class="screen" data-screen="s2" data-step="1">
          <div class="head">
            <div class="kicker">Faz-te sócio</div>
            <h2 class="display">Identificação</h2>
          </div>
          <p class="req">*Todos os campos são obrigatórios</p>

          <div class="fields">
            <div class="f full" data-f="sex">
              <label>Sexo</label>
              <div class="pills" role="group" aria-label="Sexo">
                <button type="button" data-sex="FEMALE" aria-pressed="false">Feminino</button>
                <button type="button" data-sex="MALE" aria-pressed="false">Masculino</button>
                <button type="button" data-sex="UNSPECIFIED" aria-pressed="true">Prefiro não dizer</button>
              </div>
              <div class="err"></div>
            </div>

            <div class="f" data-f="taxId">
              <label for="i-nif">N.º de contribuinte</label>
              <input id="i-nif" type="text" inputmode="numeric" maxlength="11" placeholder="000 000 000" autocomplete="off" />
              <div class="err"></div>
            </div>

            <div class="f" data-f="docKind">
              <label for="i-dk">Tipo de documento</label>
              <select id="i-dk">
                <option value="CC" selected>Cartão de cidadão</option>
                <option value="PASSPORT">Passaporte</option>
                <option value="RESIDENCE">Título de residência</option>
                <option value="OTHER">Outro</option>
              </select>
              <div class="err"></div>
            </div>

            <div class="f full" data-f="docNumber">
              <label for="i-dn">N.º de documento</label>
              <input id="i-dn" type="text" autocapitalize="characters" placeholder="00000000 0 AA0" autocomplete="off" />
              <div class="err"></div>
            </div>
          </div>

          <div class="actions">
            <button type="button" class="back" data-back>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Voltar
            </button>
            <button type="button" class="go" data-next>Seguinte</button>
          </div>
        </section>

        <!-- ============ 3 · Contacto ============ -->
        <section class="screen" data-screen="s3" data-step="2">
          <div class="head">
            <div class="kicker">Faz-te sócio</div>
            <h2 class="display">Contacto e morada</h2>
          </div>
          <p class="req">*Todos os campos são obrigatórios</p>

          <div class="fields">
            <div class="f" data-f="phone">
              <label for="i-tel">Telemóvel</label>
              <div class="tel">
                <select id="i-cc" aria-label="Indicativo">
                  <option value="+351" selected>+351</option>
                  <option value="+34">+34</option>
                  <option value="+33">+33</option>
                  <option value="+44">+44</option>
                  <option value="+41">+41</option>
                  <option value="+352">+352</option>
                  <option value="+49">+49</option>
                  <option value="+55">+55</option>
                </select>
                <input id="i-tel" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="900 000 000" />
              </div>
              <div class="err"></div>
            </div>

            <div class="f" data-f="country">
              <label for="i-country">País</label>
              <select id="i-country">
                <option value="PT" selected>Portugal</option>
                <option value="ES">Espanha</option>
                <option value="FR">França</option>
                <option value="GB">Reino Unido</option>
                <option value="CH">Suíça</option>
                <option value="LU">Luxemburgo</option>
                <option value="DE">Alemanha</option>
                <option value="BR">Brasil</option>
              </select>
              <div class="err"></div>
            </div>

            <div class="f full" data-f="address">
              <label for="i-addr">Morada</label>
              <input id="i-addr" type="text" autocomplete="street-address" placeholder="Rua, número e andar" />
              <div class="err"></div>
            </div>

            <div class="pair full">
              <div class="f" data-f="postal">
                <label>Código postal</label>
                <div class="segs">
                  <input class="w4" id="i-cp4" type="text" inputmode="numeric" maxlength="4" placeholder="0000" aria-label="Código postal" />
                  <span class="sep">–</span>
                  <input class="w3" id="i-cp3" type="text" inputmode="numeric" maxlength="3" placeholder="000" aria-label="Extensão" />
                </div>
                <div class="err"></div>
              </div>

              <div class="f" data-f="city">
                <label for="i-city">Cidade</label>
                <input id="i-city" type="text" autocomplete="address-level2" placeholder="Braga" />
                <div class="err"></div>
              </div>
            </div>
          </div>

          <div class="actions">
            <button type="button" class="back" data-back>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Voltar
            </button>
            <button type="button" class="go" data-next>Seguinte</button>
          </div>
        </section>

        <!-- ============ 4 · Autorizações ============ -->
        <section class="screen" data-screen="s4" data-step="3">
          <div class="head">
            <div class="kicker">Faz-te sócio</div>
            <h2 class="display">Antes de finalizar</h2>
          </div>

          <div class="consents">
            <label class="cs">
              <input type="checkbox" id="c-terms" />
              <span class="box" aria-hidden="true"></span>
              <span class="tx"><b>Concordo com os termos e condições do ${esc(academy.shortName)}.</b></span>
            </label>

            <label class="cs">
              <input type="checkbox" id="c-comms" />
              <span class="box" aria-hidden="true"></span>
              <span class="tx">Autorizo que o ${esc(academy.shortName)} envie comunicações comerciais dos Parceiros Oficiais.</span>
            </label>

            <label class="cs">
              <input type="checkbox" id="c-data" />
              <span class="box" aria-hidden="true"></span>
              <span class="tx">Autorizo a partilha dos meus dados com os Parceiros Oficiais do ${esc(academy.shortName)} para envio de comunicações comerciais.</span>
            </label>
          </div>

          <div class="actions">
            <button type="button" class="back" data-back>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Voltar
            </button>
            <button type="button" class="go" id="submit">Concluir</button>
          </div>
          <div class="fail" id="fail" role="alert"></div>
        </section>

        <!-- ============ Fim ============ -->
        <section class="screen" data-screen="done">
          <div class="head">
            <div class="kicker">Está feito</div>
            <h2 class="display" id="done-title">Bem-vindo.</h2>
            <p class="lede">Recebemos a tua adesão. A partir daqui é connosco.</p>
          </div>

          <ul class="track">
            <li><span class="ic" data-done>✓</span> Inscrição recebida</li>
            <li><span class="ic" data-done>✓</span> Dados enviados ao clube</li>
            <li data-pending><span class="ic" data-wait>·</span> Aprovação pela direção</li>
            <li data-pending><span class="ic" data-wait>·</span> Número de sócio e cartão digital</li>
          </ul>
        </section>

      </div>

      <aside class="card-col">
        ${cardMarkup(academy)}
        <p class="card-note">O teu cartão fica activo assim que a direção aprovar.</p>
      </aside>
    </div>
  </main>

  <footer class="foot wrap">${esc(academy.name)}</footer>

</div>

<script>
(function () {
  var API = ${jsonForScript(apiOrigin)};
  var SLUG = ${jsonForScript(academy.slug)};

  var el = function (s, r) { return (r || document).querySelector(s); };
  var all = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  var screens = all("[data-screen]");
  var steps = el("#steps");
  var at = 0;

  /* ------------------------------------------------------------------
     Navegação. Os dados vivem nos campos e nunca se limpam — voltar atrás
     e avançar outra vez encontra tudo como estava.
     ------------------------------------------------------------------ */
  function show(i) {
    at = Math.max(0, Math.min(screens.length - 1, i));

    screens.forEach(function (s, k) {
      if (k === at) s.setAttribute("data-active", "");
      else s.removeAttribute("data-active");
    });

    var step = screens[at].getAttribute("data-step");
    if (step === null) {
      steps.removeAttribute("data-on");
    } else {
      steps.setAttribute("data-on", "");
      var n = parseInt(step, 10);
      all("b", steps).forEach(function (b, k) {
        b.removeAttribute("data-done");
        b.removeAttribute("data-now");
        if (k < n) b.setAttribute("data-done", "");
        if (k === n) b.setAttribute("data-now", "");
      });
    }

    // "Voltar" só existe onde há para onde voltar.
    all("[data-back]").forEach(function (b) { b.removeAttribute("data-on"); });
    if (at > 0 && at < screens.length - 1) {
      var b = el("[data-back]", screens[at]);
      if (b) b.setAttribute("data-on", "");
    }

    window.scrollTo(0, 0);

    // Foco automático só em ecrã grande: no telemóvel abriria o teclado por
    // cima da pergunta antes de a pessoa a ler.
    var first = el("input:not([type=checkbox]), select", screens[at]);
    if (first && window.matchMedia("(min-width: 940px)").matches) {
      setTimeout(function () { first.focus(); }, 60);
    }
  }

  all("[data-next]").forEach(function (b) {
    b.addEventListener("click", function () { if (validate(at)) show(at + 1); });
  });
  all("[data-back]").forEach(function (b) {
    b.addEventListener("click", function () { show(at - 1); });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var t = e.target;
    if (t && (t.tagName === "BUTTON" || t.type === "checkbox")) return;
    e.preventDefault();
    var btn = el("[data-next], #submit", screens[at]);
    if (btn) btn.click();
  });

  /* ------------------------------------------------------------------
     Máscaras
     ------------------------------------------------------------------ */
  function digits(v) { return v.replace(/\\D/g, ""); }
  function group(v, size) {
    var out = [];
    for (var i = 0; i < v.length; i += size) out.push(v.substr(i, size));
    return out.join(" ");
  }

  var nif = el("#i-nif");
  nif.addEventListener("input", function () { nif.value = group(digits(nif.value).substr(0, 9), 3); });

  var tel = el("#i-tel");
  tel.addEventListener("input", function () { tel.value = group(digits(tel.value).substr(0, 12), 3); });

  // Salto automático entre caixas curtas: quem escreve "24" espera que o
  // cursor passe ao mês sem tirar a mão do teclado.
  function chain(from, to, len) {
    from.addEventListener("input", function () {
      from.value = digits(from.value).substr(0, len);
      if (from.value.length === len && to) to.focus();
    });
    from.addEventListener("keydown", function (e) {
      if (e.key === "Backspace" && from.value === "" && from.prev) from.prev.focus();
    });
  }

  var bd = el("#i-bd"), bm = el("#i-bm"), by = el("#i-by");
  bm.prev = bd; by.prev = bm;
  chain(bd, bm, 2); chain(bm, by, 2); chain(by, null, 4);

  var cp4 = el("#i-cp4"), cp3 = el("#i-cp3");
  cp3.prev = cp4;
  chain(cp4, cp3, 4); chain(cp3, null, 3);

  el("#i-dn").addEventListener("input", function (e) { e.target.value = e.target.value.toUpperCase(); });

  /* ------------------------------------------------------------------
     Sexo
     ------------------------------------------------------------------ */
  var sex = "UNSPECIFIED";
  all("[data-sex]").forEach(function (b) {
    b.addEventListener("click", function () {
      sex = b.getAttribute("data-sex");
      all("[data-sex]").forEach(function (o) { o.setAttribute("aria-pressed", o === b ? "true" : "false"); });
    });
  });

  /* ------------------------------------------------------------------
     O cartão preenche-se enquanto se escreve
     ------------------------------------------------------------------ */
  var cardName = el("#card-name");
  var cardTier = el("#card-tier");
  var nameInput = el("#i-name");

  /*
     O nome cabe sempre inteiro numa linha — a letra é que encolhe para ele.
     Repõe o tamanho máximo e vai descendo meio pixel de cada vez enquanto o
     texto for mais largo do que o cartão tem para dar. O scrollWidth só é
     fiável porque o .nm tem white-space nowrap: sem isso o texto quebrava
     linha antes de o ciclo alguma vez ver overflow.
  */
  var NM_MAX = 19, NM_MIN = 10;
  function fitCardName() {
    cardName.style.fontSize = NM_MAX + "px";
    var size = NM_MAX;
    while (cardName.scrollWidth > cardName.clientWidth && size > NM_MIN) {
      size -= 0.5;
      cardName.style.fontSize = size + "px";
    }
  }

  nameInput.addEventListener("input", function () {
    var v = nameInput.value.trim();
    if (v) { cardName.textContent = v; cardName.removeAttribute("data-empty"); }
    else { cardName.textContent = "O teu nome"; cardName.setAttribute("data-empty", ""); }
    fitCardName();
  });

  // O cartão muda de largura no breakpoint móvel (ver a classe card-col acima)
  // — o tamanho de letra tem de se recalcular para essa largura nova.
  window.addEventListener("resize", fitCardName);

  all("input[name=tierId]").forEach(function (r) {
    r.addEventListener("change", function () { cardTier.textContent = r.getAttribute("data-name") || "Socio"; });
    if (r.checked) cardTier.textContent = r.getAttribute("data-name") || "Socio";
  });

  /* ------------------------------------------------------------------
     Validação — junto ao campo, em português de gente
     ------------------------------------------------------------------ */
  function bad(key, message) {
    var f = el('[data-f="' + key + '"]');
    if (!f) return false;
    f.setAttribute("data-bad", "");
    el(".err", f).textContent = message;
    var i = el("input, select", f);
    if (i) i.focus();
    return false;
  }
  function ok(key) {
    var f = el('[data-f="' + key + '"]');
    if (f) f.removeAttribute("data-bad");
    return true;
  }

  // O erro desaparece assim que a pessoa mexe no campo: manter o vermelho
  // enquanto alguém está a corrigir é ralhar duas vezes pelo mesmo.
  all("[data-f]").forEach(function (f) {
    all("input, select", f).forEach(function (i) {
      i.addEventListener("input", function () { f.removeAttribute("data-bad"); });
      i.addEventListener("change", function () { f.removeAttribute("data-bad"); });
    });
  });

  function birthDate() {
    var d = bd.value, m = bm.value, y = by.value;
    if (d.length !== 2 || m.length !== 2 || y.length !== 4) return null;
    var dt = new Date(Date.UTC(+y, +m - 1, +d));
    if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d) return null;
    if (dt.getTime() > Date.now()) return null;
    if (+y < new Date().getFullYear() - 110) return null;
    return y + "-" + m + "-" + d;
  }

  function validate(i) {
    var step = screens[i].getAttribute("data-step");
    if (step === null) return true;
    var n = parseInt(step, 10);

    if (n === 0) {
      if (nameInput.value.trim().length < 3) return bad("name", "Escreve o nome completo, como está no documento.");
      if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$/.test(el("#i-email").value.trim())) return bad("email", "Este e-mail não parece válido. Confere a escrita.");
      if (!birthDate()) return bad("birth", "Essa data não existe. Escreve dia, mês e ano.");
      ok("name"); ok("email"); ok("birth");
      return true;
    }
    if (n === 1) {
      if (digits(nif.value).length !== 9) return bad("taxId", "O contribuinte tem nove dígitos.");
      if (el("#i-dn").value.trim().length < 4) return bad("docNumber", "Falta o número do documento.");
      ok("taxId"); ok("docNumber");
      return true;
    }
    if (n === 2) {
      if (digits(tel.value).length < 9) return bad("phone", "O número de telemóvel parece curto.");
      if (el("#i-addr").value.trim().length < 3) return bad("address", "Falta a morada.");
      if (cp4.value.length !== 4 || cp3.value.length !== 3) return bad("postal", "O código postal tem o formato 0000-000.");
      if (el("#i-city").value.trim().length < 2) return bad("city", "Falta a cidade.");
      ok("phone"); ok("address"); ok("postal"); ok("city");
      return true;
    }
    return true;
  }

  /* ------------------------------------------------------------------
     Envio
     ------------------------------------------------------------------ */
  var submit = el("#submit");
  var fail = el("#fail");
  var sending = false;

  submit.addEventListener("click", function () {
    // A bandeira apanha o segundo clique que passa entre o primeiro e o
    // repintar do botão.
    if (sending) return;
    fail.textContent = "";

    if (!el("#c-terms").checked) {
      fail.textContent = "Para concluir a adesão é preciso aceitar os termos e condições.";
      el("#c-terms").focus();
      return;
    }

    // Uma última passagem: alguém pode ter voltado atrás e apagado um campo.
    for (var i = 0; i < screens.length; i++) {
      if (screens[i].getAttribute("data-step") === null) continue;
      if (!validate(i)) { show(i); return; }
    }

    sending = true;
    submit.disabled = true;
    submit.textContent = "A enviar…";

    var picked = el("input[name=tierId]:checked");

    fetch(API + "/api/clubes/" + encodeURIComponent(SLUG) + "/socios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tierId: picked ? picked.value : undefined,
        name: nameInput.value.trim(),
        email: el("#i-email").value.trim(),
        birthdate: birthDate(),
        country: el("#i-country").value,
        address: el("#i-addr").value.trim(),
        postalCode: cp4.value + "-" + cp3.value,
        city: el("#i-city").value.trim(),
        phoneCountry: el("#i-cc").value,
        phone: digits(tel.value),
        sex: sex,
        documentKind: el("#i-dk").value,
        documentNumber: el("#i-dn").value.trim(),
        taxId: digits(nif.value),
        acceptTerms: true,
        partnerComms: el("#c-comms").checked,
        partnerData: el("#c-data").checked
      })
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok) {
          var m = res.body && res.body.message;
          fail.textContent = Array.isArray(m) ? m[0] : (m || "Não foi possível enviar. Tenta outra vez.");
          sending = false; submit.disabled = false; submit.textContent = "Concluir";
          return;
        }
        if (res.body && res.body.name) el("#done-title").textContent = "Bem-vindo, " + res.body.name + ".";
        show(screens.length - 1);
      })
      .catch(function () {
        fail.textContent = "Falhou a ligação. Verifica a internet e tenta outra vez.";
        sending = false; submit.disabled = false; submit.textContent = "Concluir";
      });
  });

  show(0);
})();
</script>
</body>
</html>`;
}

/* -------------------------------------------------------------------------- */

function renderPlanScreen(tiers: PublicTier[]): string {
  return `
        <section class="screen" data-screen="plans">
          <div class="head">
            <div class="kicker">Faz-te sócio</div>
            <h2 class="display">A tua categoria</h2>
            <p class="lede">Podes mudar mais tarde, falando com o clube.</p>
          </div>

          <div class="plans">
            ${tiers
              .map(
                (t, i) => `
            <div class="plan">
              <input type="radio" name="tierId" id="p-${esc(t.id)}" value="${esc(t.id)}"
                     data-name="${esc(t.name)}" ${i === 0 ? "checked" : ""} aria-label="${esc(t.name)}" />
              <div class="face">
                <div class="nm">${esc(t.name)}</div>
                ${ageLabel(t) ? `<div class="ag">${esc(ageLabel(t)!)}</div>` : ""}
                <div class="pr">${
                  t.feeCents === null
                    ? '<span style="font-size:17px">a definir</span>'
                    : esc(money(t.feeCents)) + `<span>${esc(PERIOD_SHORT[t.period])}</span>`
                }</div>
                ${t.description ? `<p class="ds">${esc(t.description)}</p>` : ""}
                ${t.benefits.length ? `<ul>${t.benefits.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
              </div>
            </div>`,
              )
              .join("")}
          </div>

          <div class="actions">
            <button type="button" class="back" data-back>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Voltar
            </button>
            <button type="button" class="go" data-next>Seguinte</button>
          </div>
        </section>`;
}

function cardMarkup(academy: AcademyBranding): string {
  return `
        <div class="card">
          <div class="ct">
            <div class="cc${academy.logoUrl ? " logo" : ""}">${academy.logoUrl ? `<img src="${esc(academy.logoUrl)}" alt="" />` : esc(academy.mark)}</div>
            <div class="tier" id="card-tier">Sócio</div>
          </div>
          <div class="nm" id="card-name" data-empty>O teu nome</div>
          <div class="bt">
            <div>
              <div class="lb">Sócio n.º</div>
              <div class="no">— — — —</div>
            </div>
            <div class="cl">${esc(academy.shortName)}</div>
          </div>
        </div>`;
}

function cheapest(tiers: PublicTier[]): number | null {
  const prices = tiers.map((t) => t.feeCents).filter((c): c is number => c !== null);
  return prices.length ? Math.min(...prices) : null;
}

function ageLabel(t: PublicTier): string | null {
  if (t.minAge != null && t.maxAge != null) return "Dos " + t.minAge + " aos " + t.maxAge + " anos";
  if (t.minAge != null) return "A partir dos " + t.minAge + " anos";
  if (t.maxAge != null) return "Até aos " + t.maxAge + " anos";
  return null;
}

function money(cents: number): string {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", minimumFractionDigits: 0 }).format(
    cents / 100,
  );
}

/** Gémeo do de `landing.template.ts`. Ver VULN-004. */
function esc(s: string): string {
  return String(s).replace(/[<>&"']/g, (c) => {
    return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] ?? c;
  });
}

/** Um valor para dentro de um `<script>`. Ver VULN-004. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}
