import { useEffect, useState, type ReactNode } from "react";
import { cx } from "@/components/primitives";
import { ChevronDown, Minus, Plus } from "@/lib/icons";
import { Camisola } from "./ui";

/**
 * O desenho da ficha de jogo, no Pós-jogo.
 *
 * ## Uma linha por jogador, lida de relance
 *
 * Cada linha diz primeiro o papel (titular, entrou, não jogou), que é a única
 * coisa obrigatória. Para quem jogou, os números ficam todos à vista e
 * mexem-se com um toque: os golos e as assistências em contadores de mais e
 * menos, os cartões desenhados como cartões, e os minutos já calculados numa
 * pastilha. Não há caixas de texto para o que é contar.
 *
 * Os minutos exatos (de cada golo, da saída, de cada cartão) são opcionais e
 * ficam atrás da seta, como estavam: a maioria dos jogos de formação não os
 * regista.
 *
 * Só desenho. As regras (quem pode ter golos, como se contam os minutos, o que
 * é uma contradição) continuam na página do jogo.
 */

export type Papel = "titular" | "entrou" | "nao";

export type LinhaDaFichaDados = {
  papel: Papel;
  tally: number;
  assists: number;
  yellowCards: number;
  redCard: boolean;
  onMinute: number | null;
  offMinute: number | null;
  yellowAt: number[];
  redAt: number | null;
  tallyAt: number[];
  assistsAt: number[];
};

const PAPEIS: { value: Papel; label: string }[] = [
  { value: "titular", label: "Titular" },
  { value: "entrou", label: "Entrou" },
  { value: "nao", label: "Não jogou" },
];

/** Os números da ficha, num relance, por cima das linhas. */
export function ResumoDaFicha({ itens }: { itens: { valor: ReactNode; rotulo: string; tom?: "ok" | "aviso" | "risco" }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {itens.map((i) => (
        <div key={i.rotulo} className="rounded-[14px] bg-sunken/60 px-3.5 py-3">
          <dd className={cx("text-[24px] leading-none font-semibold tracking-[-0.02em] tabular", i.tom === "ok" ? "text-ok" : i.tom === "aviso" ? "text-warn" : i.tom === "risco" ? "text-risk" : "text-ink")}>{i.valor}</dd>
          <dt className="mt-1.5 text-[11.5px] text-ink-3">{i.rotulo}</dt>
        </div>
      ))}
    </dl>
  );
}

export function LinhaDaFicha({
  nome,
  numero,
  foto,
  apoio,
  linha,
  golo,
  duracao,
  minutos,
  problemas,
  podeEditar,
  semCartoes,
  rotativo,
  substituicao,
  onPapel,
  onChange,
}: {
  nome: string;
  numero: number | null;
  foto?: string | null;
  /** A posição e o que mais houver a dizer ("de Sub-13", "tinha dito que não podia"). */
  apoio: string;
  linha: LinhaDaFichaDados;
  /** "golo" ou "ponto", conforme a modalidade. */
  golo: string;
  duracao: number;
  /** Os minutos em campo, já calculados. Nulo quando não se sabe. */
  minutos: number | null;
  problemas: string[];
  podeEditar: boolean;
  /**
   * Substituições volantes (futsal, basquetebol): entra-se e sai-se a toda a
   * hora, e não se pergunta quando nem por quem. Diz-se só titular ou entrou.
   */
  rotativo?: boolean;
  /**
   * No futebol, quem entra substitui alguém: a linha pergunta por quem. Vem com
   * os jogadores que podem ter saído e com o que está escolhido.
   */
  substituicao?: { opcoes: { id: string; nome: string }[]; valor: string | null; onChange: (id: string | null) => void };
  /** O basquetebol não tem cartões: a ficha não os mostra. */
  semCartoes?: boolean;
  onPapel: (p: Papel) => void;
  onChange: (patch: Partial<LinhaDaFichaDados>) => void;
}) {
  // Quem entrou e ainda não disse quando (ou por quem) abre já com a caixa à vista.
  const [aberto, setAberto] = useState(() => !rotativo && linha.papel === "entrou" && (linha.onMinute == null || Boolean(substituicao && !substituicao.valor)));
  const jogou = linha.papel !== "nao";
  const teto = duracao + 30;

  // Uma contradição escondida atrás de um painel fechado não se corrige: abre-se.
  useEffect(() => {
    if (problemas.length > 0) setAberto(true);
  }, [problemas.length]);

  const substituir = (lista: number[], i: number, n: number | null, max: number) => {
    const proximo = [...lista];
    if (n == null) proximo.splice(i, 1);
    else proximo[i] = n;
    return proximo.filter((m) => m != null).slice(0, max);
  };

  return (
    <li className={cx("border-b border-line last:border-b-0", !jogou && "bg-sunken/25")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3">
        {/* Quem é. */}
        <div className="flex min-w-0 flex-1 basis-[190px] items-center gap-3">
          <Camisola numero={numero} foto={foto} tom={linha.papel === "titular" ? "clube" : linha.papel === "entrou" ? "tinta" : "neutro"} tamanho={38} />
          <div className="min-w-0">
            <div className={cx("truncate text-body", jogou ? "font-semibold text-ink" : "font-medium text-ink-3")}>{nome}</div>
            <div className="truncate text-[11.5px] text-ink-3">{apoio}</div>
          </div>
        </div>

        {/* O papel: a única pergunta obrigatória. */}
        {podeEditar ? (
          <div role="radiogroup" aria-label={`Papel de ${nome}`} className="inline-flex shrink-0 gap-0.5 rounded-full bg-sunken p-0.5">
            {PAPEIS.map((o) => {
              const on = linha.papel === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    onPapel(o.value);
                    // Quem entra tem de dizer quando e por quem: a caixa abre logo.
                    if (o.value === "entrou" && !rotativo) setAberto(true);
                  }}
                  className={cx(
                    "h-8 rounded-full px-3 text-meta font-medium whitespace-nowrap transition-all duration-150",
                    on ? (o.value === "nao" ? "bg-surface text-ink-2 shadow-[0_1px_2px_rgb(26_25_23/0.12)]" : "bg-ink text-surface") : "text-ink-3 hover:text-ink",
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        ) : (
          <span className={cx("shrink-0 rounded-full px-3 py-1 text-meta font-medium", jogou ? "bg-ink text-surface" : "bg-sunken text-ink-3")}>
            {PAPEIS.find((x) => x.value === linha.papel)!.label}
          </span>
        )}

        {/* O que fez em campo. */}
        {jogou && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 max-lg:w-full">
            <Contador rotulo={golo === "golo" ? "Golos" : "Pontos"} valor={linha.tally} max={99} podeEditar={podeEditar} onChange={(n) => onChange({ tally: n, tallyAt: linha.tallyAt.slice(0, n) })} />
            <Contador rotulo="Assist." valor={linha.assists} max={99} podeEditar={podeEditar} onChange={(n) => onChange({ assists: n, assistsAt: linha.assistsAt.slice(0, n) })} />

            {/* Os cartões, desenhados como cartões. O amarelo conta até dois. */}
            <div className={cx("flex items-center gap-1.5", semCartoes && "hidden")}>
              <CartaoDeArbitro
                cor="amarelo"
                numero={linha.yellowCards}
                podeEditar={podeEditar}
                rotulo={`Cartões amarelos de ${nome}: ${linha.yellowCards}`}
                onClick={() => {
                  const n = (linha.yellowCards + 1) % 3;
                  onChange({ yellowCards: n, yellowAt: linha.yellowAt.slice(0, n) });
                }}
              />
              <CartaoDeArbitro
                cor="vermelho"
                numero={linha.redCard ? 1 : 0}
                podeEditar={podeEditar}
                rotulo={`Cartão vermelho de ${nome}: ${linha.redCard ? "sim" : "não"}`}
                onClick={() => onChange({ redCard: !linha.redCard, ...(linha.redCard ? { redAt: null } : {}) })}
              />
            </div>

            {/* Quem entrou do banco diz quando: é daí que saem os minutos dele. */}
            {/* Os minutos são resultado, não pergunta. Com substituições volantes não se contam. */}
            <span
              hidden={rotativo}
              className={cx("inline-flex h-9 min-w-[58px] items-center justify-center rounded-full px-3 text-body font-semibold tabular", minutos === null ? "bg-sunken text-ink-4" : "bg-signal-soft text-signal-ink")}
              title={minutos === null ? "Sem minuto de entrada, os minutos ficam por contar" : "Minutos em campo, calculados da entrada e da saída"}
            >
              {minutos === null ? "—" : `${minutos}′`}
            </span>

            {podeEditar && (
              <button
                type="button"
                hidden={rotativo && linha.tally === 0 && linha.assists === 0 && linha.yellowCards === 0 && !linha.redCard}
                onClick={() => setAberto((v) => !v)}
                aria-expanded={aberto}
                aria-label={aberto ? `Fechar os minutos de ${nome}` : `Abrir os minutos de ${nome}`}
                title="Minutos dos golos, da saída e dos cartões"
                className={cx("flex size-9 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-sunken hover:text-ink max-lg:ml-auto", aberto && "bg-sunken text-ink")}
              >
                <ChevronDown className={cx("size-4 transition-transform duration-150", aberto && "rotate-180")} strokeWidth={1.75} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Os minutos exatos: opcionais, atrás da seta. */}
      {jogou && podeEditar && aberto && (
        <div className="mc-entra mx-5 mb-3 space-y-3 rounded-[14px] bg-sunken/50 px-4 py-3.5">
          {/*
            A substituição, em primeiro lugar: quando entrou e, no futebol, por
            quem. É disto que saem os minutos dele e os de quem saiu.
          */}
          {!rotativo && linha.papel === "entrou" && (
            <Grupo titulo="Substituição">
              <CampoDeMinuto rotulo="Entrou ao" valor={linha.onMinute} max={teto} onCommit={(n) => onChange({ onMinute: n })} />
              {substituicao && (
                <div className="flex items-center gap-2">
                  <span className="text-meta text-ink-3">por</span>
                  <select
                    aria-label={`Por quem entrou ${nome}`}
                    value={substituicao.valor ?? ""}
                    onChange={(e) => substituicao.onChange(e.target.value || null)}
                    className={cx(
                      "h-9 max-w-[200px] rounded-full border bg-surface px-3 text-meta font-medium outline-none transition-colors focus:border-ink-3",
                      substituicao.valor ? "border-line text-ink" : "border-dashed border-line-strong text-ink-3",
                    )}
                  >
                    <option value="">quem saiu?</option>
                    {substituicao.opcoes.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.nome}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </Grupo>
          )}

          {(linha.tally > 0 || linha.assists > 0) && (
            <Grupo titulo={`${golo === "golo" ? "Golos" : "Pontos"} e assistências`}>
              {Array.from({ length: Math.min(linha.tally, 12) }, (_, i) => (
                <CampoDeMinuto
                  key={`g${i}`}
                  rotulo={linha.tally === 1 ? (golo === "golo" ? "Golo" : "Ponto") : `${i + 1}.º ${golo}`}
                  valor={linha.tallyAt[i] ?? null}
                  max={teto}
                  onCommit={(n) => onChange({ tallyAt: substituir(linha.tallyAt, i, n, linha.tally) })}
                />
              ))}
              {Array.from({ length: Math.min(linha.assists, 12) }, (_, i) => (
                <CampoDeMinuto
                  key={`a${i}`}
                  rotulo={linha.assists === 1 ? "Assistência" : `${i + 1}.ª assist.`}
                  valor={linha.assistsAt[i] ?? null}
                  max={teto}
                  onCommit={(n) => onChange({ assistsAt: substituir(linha.assistsAt, i, n, linha.assists) })}
                />
              ))}
            </Grupo>
          )}

          {!rotativo && (
            <Grupo titulo="Em campo">
              <CampoDeMinuto rotulo="Saiu" valor={linha.offMinute} max={teto} nota={linha.offMinute == null ? "jogou até ao fim" : undefined} onCommit={(n) => onChange({ offMinute: n })} />
            </Grupo>
          )}

          {!semCartoes && (linha.yellowCards > 0 || linha.redCard) && (
            <Grupo titulo="Cartões">
              {Array.from({ length: linha.yellowCards }, (_, i) => (
                <CampoDeMinuto
                  key={i}
                  rotulo={linha.yellowCards === 1 ? "Amarelo" : `${i + 1}.º amarelo`}
                  valor={linha.yellowAt[i] ?? null}
                  max={teto}
                  onCommit={(n) => onChange({ yellowAt: substituir(linha.yellowAt, i, n, linha.yellowCards) })}
                />
              ))}
              {linha.redCard && <CampoDeMinuto rotulo="Vermelho" valor={linha.redAt} max={teto} onCommit={(n) => onChange({ redAt: n })} />}
            </Grupo>
          )}
        </div>
      )}

      {/* A contradição, na linha de quem a tem. Trava o gravar, e diz porquê. */}
      {problemas.length > 0 && (
        <ul className="mx-5 mb-3 space-y-1 rounded-[14px] bg-risk-soft px-4 py-2.5">
          {problemas.map((p) => (
            <li key={p} className="text-meta leading-relaxed text-risk">
              {p}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <span className="text-meta font-medium text-ink-2 sm:w-[150px] sm:shrink-0">{titulo}</span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">{children}</div>
    </div>
  );
}

/** Um número que se conta: menos, o valor, mais. */
function Contador({ rotulo, valor, max, podeEditar, onChange }: { rotulo: string; valor: number; max: number; podeEditar: boolean; onChange: (n: number) => void }) {
  if (!podeEditar) {
    return (
      <span className="inline-flex items-baseline gap-1.5 text-meta text-ink-3">
        {rotulo} <span className="text-body font-semibold text-ink tabular">{valor}</span>
      </span>
    );
  }
  const botao = "flex size-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-surface hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div className="flex items-center gap-2">
      <span className="text-meta text-ink-3">{rotulo}</span>
      <div className={cx("inline-flex items-center rounded-full p-0.5 transition-colors", valor > 0 ? "bg-ok-soft" : "bg-sunken")}>
        <button type="button" aria-label={`Menos um: ${rotulo}`} disabled={valor <= 0} onClick={() => onChange(Math.max(0, valor - 1))} className={botao}>
          <Minus className="size-3.5" strokeWidth={2} />
        </button>
        <span className={cx("w-6 text-center text-body font-semibold tabular", valor > 0 ? "text-ok" : "text-ink-3")} aria-live="polite">
          {valor}
        </span>
        <button type="button" aria-label={`Mais um: ${rotulo}`} disabled={valor >= max} onClick={() => onChange(Math.min(max, valor + 1))} className={botao}>
          <Plus className="size-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

/** Um cartão do árbitro: apagado quando não há, cheio quando há. */
function CartaoDeArbitro({ cor, numero, podeEditar, rotulo, onClick }: { cor: "amarelo" | "vermelho"; numero: number; podeEditar: boolean; rotulo: string; onClick: () => void }) {
  const cheio = numero > 0;
  const tinta = cor === "amarelo" ? "#f4c542" : "#d9453a";
  return (
    <button
      type="button"
      disabled={!podeEditar}
      onClick={onClick}
      aria-label={rotulo}
      title={cor === "amarelo" ? "Cartão amarelo (toca para 1, 2 ou nenhum)" : "Cartão vermelho"}
      className={cx("relative flex h-9 w-7 items-center justify-center rounded-[6px] border-2 text-[12px] font-bold transition-all duration-150", podeEditar && "hover:scale-105 active:scale-95", !cheio && "border-dashed")}
      style={cheio ? { background: tinta, borderColor: tinta, color: cor === "amarelo" ? "#14130f" : "#fff" } : { borderColor: "var(--color-line-strong)", color: "transparent" }}
    >
      {numero > 1 ? numero : ""}
      {!cheio && <span aria-hidden className="absolute inset-[5px] rounded-[2px] opacity-40" style={{ background: tinta }} />}
    </button>
  );
}

/**
 * Um minuto do jogo, que pode não estar registado.
 *
 * Vazio é um valor: quer dizer "ninguém registou", que é o estado da maioria
 * das fichas. Conta ao sair do campo, e não a cada tecla: um "6" a caminho de
 * "60" acendia avisos de contradição a meio da escrita.
 */
export function CampoDeMinuto({ rotulo, valor, max, nota, onCommit }: { rotulo: string; valor: number | null; max: number; nota?: string; onCommit: (n: number | null) => void }) {
  const [texto, setTexto] = useState(valor == null ? "" : String(valor));
  useEffect(() => {
    setTexto(valor == null ? "" : String(valor));
  }, [valor]);

  function commit() {
    if (texto.trim() === "") {
      setTexto("");
      if (valor !== null) onCommit(null);
      return;
    }
    const n = Math.max(0, Math.min(max, Number(texto) || 0));
    setTexto(String(n));
    if (n !== valor) onCommit(n);
  }

  return (
    // Uma `div` e não um `label`: nada tocável vive dentro de rótulos.
    <div className="flex items-center gap-2">
      <span className="text-meta whitespace-nowrap text-ink-3">{rotulo}</span>
      <span className="relative inline-flex items-center">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={3}
          value={texto}
          placeholder="—"
          aria-label={`${rotulo}, minuto`}
          onChange={(e) => setTexto(e.target.value.replace(/\D/g, ""))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="h-9 w-[58px] rounded-full border border-line bg-surface pr-4 text-center text-body font-medium text-ink tabular outline-none transition-colors placeholder:font-normal placeholder:text-ink-4 focus:border-ink-3"
        />
        <span aria-hidden className="pointer-events-none absolute right-3 text-meta text-ink-4">
          ′
        </span>
      </span>
      {nota && <span className="text-[11.5px] text-ink-4">{nota}</span>}
    </div>
  );
}
