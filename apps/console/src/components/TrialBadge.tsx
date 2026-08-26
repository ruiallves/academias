import { Sparkle } from "@/lib/icons";
import { cx } from "./primitives";

/**
 * Quanto falta do período experimental — no rodapé do menu, debaixo do utilizador.
 *
 * ## Porque é que fica ali, e não no topo da página
 *
 * Porque é contexto permanente e não um assunto a despachar: não é uma tarefa,
 * é um facto sobre a conta que faz sentido estar sempre à vista, no mesmo sítio
 * onde já está "quem sou eu e em que clube" — e não a competir pela atenção com
 * "Precisa de atenção", que é para trabalho, não para estado da subscrição.
 *
 * ## O anel, e não uma barra
 *
 * Um anel de progresso ocupa o mesmo espaço fechado ou aberto — na barra
 * encolhida é só ele, sozinho, do tamanho de um ícone de navegação; aberta,
 * ganha o número de dias ao lado. Uma barra horizontal exigiria a largura toda
 * do menu para se ler, e desaparecia por completo quando alguém encolhe a
 * barra — exactamente o sítio onde isto também tem de continuar visível.
 *
 * ## A cor do menu é fixa — a do clube não entra aqui
 *
 * A regra já está escrita em `styles.css`: a navegação usa `--nav-accent`, uma
 * ardósia fixa, e não `--color-signal` — um clube amarelo dava texto amarelo
 * sobre branco no item activo, ilegível. Este cartão vive dentro do menu, por
 * isso segue a mesma regra: o anel fica em `--nav-accent` enquanto sobra tempo
 * confortável, e só passa a âmbar (`--color-warn`, uma cor de estado, não de
 * identidade) nos últimos três dias — o mesmo limiar de "convocatória urgente"
 * nos Jogos. Nunca vermelho: isto não é uma dívida, é um período gratuito a
 * acabar, e tratá-lo como alarme transformava um cartão elegante num aviso de
 * pânico.
 */
export function TrialBadge({
  status,
  trialEndsAt,
  createdAt,
  collapsed,
}: {
  status: string;
  trialEndsAt: string | null;
  createdAt: string;
  collapsed: boolean;
}) {
  /*
    `SETUP` conta como período experimental, tal como `TRIAL`.

    Isto exigia `status === "TRIAL"` e não aparecia em lado nenhum — porque uma
    academia acabada de criar nasce em `SETUP` **com** `trialEndsAt` já
    preenchido, e só passa a `TRIAL` mais tarde. A plataforma já trata os dois
    da mesma maneira (ver a coluna de MRR em `Academies.tsx`: "TRIAL || SETUP"
    → mostra até quando, e não receita); esta condição é que estava mais
    estreita do que a regra do produto.

    O que decide mesmo é a **data**: sem `trialEndsAt` não há período nenhum a
    contar, seja qual for o estado.
  */
  if ((status !== "TRIAL" && status !== "SETUP") || !trialEndsAt) return null;

  const fim = new Date(trialEndsAt);
  const agora = Date.now();
  const msFalta = fim.getTime() - agora;
  if (msFalta <= 0) return null;

  const diasFalta = Math.max(1, Math.ceil(msFalta / 86_400_000));

  // O total do período, a partir de quando a academia nasceu — não há um campo
  // próprio de "início do teste", e a data de criação é a aproximação certa: é
  // literalmente quando o período começou a contar.
  const inicio = createdAt ? new Date(createdAt).getTime() : agora - msFalta;
  const totalMs = Math.max(msFalta, fim.getTime() - inicio);
  const percorrido = Math.min(1, Math.max(0, 1 - msFalta / totalMs));

  const urgente = diasFalta <= 3;
  const cor = urgente ? "var(--color-warn)" : "var(--nav-accent)";
  // O miolo do anel — e o fundo da linha, quando aberta — têm de ser exactamente
  // a mesma cor um do outro, senão o "buraco" do anel aparece como um quadrado
  // mal-recortado. Uma só variável para os dois lados dessa igualdade.
  const fundo = urgente ? "var(--color-warn-soft)" : "var(--color-sunken)";

  const dataFim = fim.toLocaleDateString("pt-PT", { day: "numeric", month: "short" }).replace(".", "");

  const anel = (
    <span
      className="relative flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: 30,
        height: 30,
        background: `conic-gradient(${cor} ${percorrido * 360}deg, var(--color-line) 0deg)`,
      }}
      aria-hidden
    >
      <span
        className="flex size-[22px] items-center justify-center rounded-full"
        style={{ background: collapsed ? "var(--color-surface)" : fundo }}
      >
        <Sparkle className="size-3" style={{ color: cor }} strokeWidth={2} />
      </span>
    </span>
  );

  if (collapsed) {
    return (
      <div className="flex justify-center border-t border-line px-2 py-2.5" title={`${diasFalta} dias de teste — até ${dataFim}`}>
        {anel}
      </div>
    );
  }

  return (
    <div className="border-t border-line px-2 pt-2.5 pb-1">
      <div
        className="flex items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-2"
        style={{ background: fundo }}
      >
        {anel}
        <span className="min-w-0 flex-1">
          <span
            className={cx("block text-body font-medium tabular", urgente ? "" : "text-ink")}
            style={urgente ? { color: "var(--color-warn)" } : undefined}
          >
            {diasFalta} {diasFalta === 1 ? "dia" : "dias"} de teste
          </span>
          <span className="block truncate text-[11px] text-ink-3">Termina a {dataFim}</span>
        </span>
      </div>
    </div>
  );
}
