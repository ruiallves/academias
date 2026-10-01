import type { ReactNode } from "react";
import { cx } from "@/components/primitives";

/**
 * As peças das Definições.
 *
 * ## Porque é que as Definições têm peças suas
 *
 * O resto da consola é feito de painéis: uma caixa com cabeçalho e conteúdo, que
 * é a forma certa para um ecrã de trabalho — uma lista de atletas, um quadro de
 * mensalidades. Nas Definições essa forma atrapalhava. Cada assunto era uma
 * caixa, cada caixa tinha sub-caixas separadas por linhas, e a página lia-se
 * como uma pilha de formulários sem princípio nem fim.
 *
 * Um ecrã de definições é outra coisa: uma lista de **decisões**. Cada decisão
 * tem um nome, uma frase que diz o que muda, e um controlo. É esse o desenho
 * daqui — o nome e a explicação à esquerda, o controlo à direita, uma linha fina
 * entre decisões e nenhuma caixa à volta. As caixas ficam para o que é mesmo uma
 * lista de coisas (cargos, documentos), onde a moldura diz "isto é um conjunto".
 *
 * Continua tudo dentro das regras do produto: separação por linha e não por
 * sombra, nada a flutuar, a cor do clube só para dizer "activo".
 */

/**
 * Uma decisão: o nome e a explicação à esquerda, o controlo à direita.
 *
 * Em ecrãs estreitos empilha — a explicação por cima, o controlo por baixo —
 * porque uma coluna de 240 px ao lado de um formulário não cabe num telemóvel.
 */
export function Bloco({
  titulo,
  descricao,
  estado,
  perigo,
  centro,
  children,
}: {
  titulo: string;
  /** O que esta decisão muda, por palavras. Aceita ligações e negritos. */
  descricao?: ReactNode;
  /** Um sinal pequeno ao lado do título: "gravado", "a gravar…". */
  estado?: ReactNode;
  /** A única decisão sem volta pinta o título de vermelho. */
  perigo?: boolean;
  /**
   * Alinha o controlo ao meio da explicação, em vez de ao cimo. Para blocos em
   * que a explicação é alta e o controlo é baixo — o símbolo do clube ao lado de
   * dois parágrafos ficava pendurado no canto de cima.
   */
  centro?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cx(
        "grid gap-x-10 gap-y-4 border-b border-line py-7 first:pt-1 last:border-b-0 md:grid-cols-[240px_minmax(0,1fr)]",
        centro && "md:items-center",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className={cx("text-panel", perigo ? "text-risk" : "text-ink")}>{titulo}</h3>
          {estado}
        </div>
        {descricao && <div className="mt-1.5 space-y-2 text-meta leading-relaxed text-ink-3">{descricao}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/**
 * Uma lista de coisas, com moldura.
 *
 * A única caixa das Definições. Cantos mais redondos do que um painel da
 * consola, de propósito: aqui a moldura não separa áreas de trabalho, agrupa
 * linhas de uma mesma lista, e lê-se como um objecto só.
 */
export function Lista({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx("overflow-hidden rounded-[12px] border border-line bg-surface", className)}>{children}</div>
  );
}

/** O cabeçalho de uma lista: o nome do conjunto e o que se lhe pode fazer. */
export function ListaTopo({ children }: { children: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line bg-sunken/40 px-4 py-2.5">
      {children}
    </header>
  );
}

/** Uma linha de lista. As linhas separam-se sozinhas; a última não leva traço. */
export function Linha({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <li className={cx("flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 last:border-b-0", className)}>
      {children}
    </li>
  );
}

/** Um campo de formulário: o rótulo por cima, a ajuda por baixo. */
export function Campo({
  label,
  ajuda,
  className,
  children,
}: {
  label: string;
  ajuda?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      {/* Não é um `<label>` a embrulhar: nada tocável vive dentro de rótulos
          (ver `check:toque`), e há campos aqui com botões lá dentro. */}
      <div className="mb-1.5 text-meta font-medium text-ink-2">{label}</div>
      {children}
      {ajuda && <p className="mt-1.5 text-meta leading-relaxed text-ink-3">{ajuda}</p>}
    </div>
  );
}

/** A classe dos campos de texto das Definições — um pouco mais altos do que os dos diálogos. */
export const campoClass =
  "h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-body text-ink outline-none transition-colors duration-[120ms] placeholder:text-ink-4 focus:border-ink-3 disabled:opacity-60";

/**
 * Um valor que só se lê — o endereço da app, o nome registado.
 *
 * Desenhado como texto e não como um campo cinzento: um campo desactivado
 * parece uma coisa que devia poder editar-se e está avariada.
 */
export function Leitura({ label, valor, mono }: { label: string; valor: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-meta text-ink-3">{label}</div>
      <div className={cx("truncate text-ink", mono ? "font-mono text-meta" : "text-body font-medium")}>{valor}</div>
    </div>
  );
}

/**
 * Um interruptor.
 *
 * Um `button` com `role="switch"`, e não uma caixa de verificação escondida
 * dentro de um rótulo: é o que o leitor de ecrã anuncia como ligado/desligado,
 * e não põe nada tocável dentro de um `<label>`.
 */
export function Interruptor({
  ligado,
  onChange,
  disabled,
  label,
}: {
  ligado: boolean;
  onChange: () => void;
  disabled?: boolean;
  /** Para leitores de ecrã: o que este interruptor liga. */
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cx(
        "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-[120ms] disabled:opacity-50",
        ligado ? "bg-signal-strong" : "bg-line-strong",
      )}
    >
      <span
        aria-hidden
        className={cx(
          /* O anel fino segura a bola quando a cor do clube é clara. */
          "absolute top-0.5 size-5 rounded-full bg-white ring-1 ring-black/10 transition-[left] duration-[120ms]",
          ligado ? "left-[18px]" : "left-0.5",
        )}
      />
    </button>
  );
}

/** Uma mensagem de erro dentro de um bloco. */
export function Erro({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-[10px] bg-risk-soft px-3 py-2 text-meta text-risk">
      {children}
    </p>
  );
}
