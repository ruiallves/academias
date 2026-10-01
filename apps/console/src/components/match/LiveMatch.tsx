import { useEffect, useMemo, useState } from "react";
import { cx } from "@/components/primitives";
import { Check, Pause, Play, Trash2, X } from "@/lib/icons";
import { sportById } from "@/lib/api";
import { saveAppearances, saveResult, type MatchDetail } from "@/lib/matches";
import { useJogadores, type Jogador } from "./GamePlan";
import { Cartao } from "./ui";

/**
 * O jogo ao vivo: um relógio e quatro botões.
 *
 * É para o telemóvel, junto ao campo, com uma mão. Por isso não há formulário:
 * carrega-se no que aconteceu (golo, cartão, substituição), escolhe-se o
 * jogador numa lista de quem está em campo, e fica registado ao minuto que o
 * relógio marca. Um engano apaga-se na lista de acontecimentos.
 *
 * ## Onde isto fica guardado
 *
 * Enquanto o jogo decorre, no próprio telemóvel: uma rede fraca no campo não
 * pode fazer perder um golo. No fim, "Terminar e gravar" escreve o resultado e
 * a ficha de uma vez, no mesmo formato que o Pós-jogo usa. O que se gravou
 * aqui abre lá, para acertar o que for preciso.
 *
 * É opcional: quem preferir preenche tudo depois, no Pós-jogo.
 */

type Tipo = "golo" | "sofrido" | "amarelo" | "vermelho" | "sub";
/** `valor` é quanto vale: 1 num golo, 1, 2 ou 3 num cesto. */
type Acontecimento = { id: string; minuto: number; tipo: Tipo; atleta?: string; entra?: string; valor?: number };
type Estado = {
  /** Os titulares, por id. */
  onze: string[];
  /** Minutos já contados até à última paragem. */
  base: number;
  /** Quando o relógio voltou a andar; nulo se está parado. */
  desde: number | null;
  acontecimentos: Acontecimento[];
};

const chave = (id: string) => `academias.jogo.ao-vivo.${id}`;
const novoId = () => Math.random().toString(36).slice(2, 10);

function ler(id: string): Estado | null {
  try {
    const v = localStorage.getItem(chave(id));
    return v ? (JSON.parse(v) as Estado) : null;
  } catch {
    return null;
  }
}

export function LiveMatch({ match, mayRecord, onSaved }: { match: MatchDetail; mayRecord: boolean; onSaved: () => void }) {
  const jogadores = useJogadores(match);
  const porId = useMemo(() => new Map(jogadores.map((j) => [j.id, j])), [jogadores]);
  const titularesDoPlano = (match.plan?.slots ?? []).map((s) => s.athleteId).filter((x): x is string => Boolean(x));

  const [estado, setEstado] = useState<Estado>(() => ler(match.id) ?? { onze: titularesDoPlano, base: 0, desde: null, acontecimentos: [] });
  const [agora, setAgora] = useState(Date.now());
  const [aEscolher, setAEscolher] = useState<{ tipo: Tipo; sai?: string; valor?: number } | null>(null);
  /*
   * O basquetebol conta pontos (1, 2 ou 3 por cesto) e não tem cartões. O
   * futebol e o futsal contam golos e têm amarelos e vermelhos.
   */
  const pontos = sportById(match.sportId)?.code === "basketball";
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gravado, setGravado] = useState(false);

  const mudar = (novo: Estado) => {
    setEstado(novo);
    setGravado(false);
    try {
      localStorage.setItem(chave(match.id), JSON.stringify(novo));
    } catch {
      /* sem armazenamento, o registo vive até fechar a página */
    }
  };

  // O relógio anda de segundo a segundo só enquanto está a contar.
  useEffect(() => {
    if (estado.desde === null) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [estado.desde]);

  const segundos = estado.base * 60 + (estado.desde !== null ? Math.max(0, (agora - estado.desde) / 1000) : 0);
  const minuto = Math.floor(segundos / 60);
  const aAndar = estado.desde !== null;
  const comecou = estado.base > 0 || aAndar || estado.acontecimentos.length > 0;

  /* Quem está em campo agora: os titulares, com as trocas e as expulsões por cima. */
  const emCampo = useMemo(() => {
    const s = new Set(estado.onze);
    for (const a of [...estado.acontecimentos].sort((x, y) => x.minuto - y.minuto)) {
      if (a.tipo === "sub" && a.atleta && a.entra) {
        s.delete(a.atleta);
        s.add(a.entra);
      }
      if (a.tipo === "vermelho" && a.atleta) s.delete(a.atleta);
    }
    return s;
  }, [estado]);
  const jaJogaram = new Set([...estado.onze, ...estado.acontecimentos.map((a) => a.entra).filter((x): x is string => Boolean(x))]);
  const noBanco = jogadores.filter((j) => !jaJogaram.has(j.id) && j.estado !== "baixa" && j.estado !== "recusou");

  const soma = (tipo: Tipo) => estado.acontecimentos.filter((a) => a.tipo === tipo).reduce((n, a) => n + (a.valor ?? 1), 0);
  const nossos = soma("golo");
  const deles = soma("sofrido");

  const registar = (a: Omit<Acontecimento, "id" | "minuto">) => {
    mudar({ ...estado, acontecimentos: [...estado.acontecimentos, { ...a, id: novoId(), minuto: Math.max(1, minuto + 1) }] });
    setAEscolher(null);
  };
  const acertarMinuto = (id: string, d: number) =>
    mudar({ ...estado, acontecimentos: estado.acontecimentos.map((a) => (a.id === id ? { ...a, minuto: Math.max(1, a.minuto + d) } : a)) });

  function alternarRelogio() {
    if (aAndar) mudar({ ...estado, base: segundos / 60, desde: null });
    else {
      // Depois do intervalo, a segunda parte começa a meio do jogo e não onde a primeira parou.
      const meio = match.matchMinutes ? match.matchMinutes / 2 : 0;
      const base = estado.base > 0 && estado.base < meio + 15 && estado.base >= meio * 0.8 ? Math.max(estado.base, meio) : estado.base;
      mudar({ ...estado, base, desde: Date.now() });
      setAgora(Date.now());
    }
  }

  async function terminar() {
    if (aGravar) return;
    setAGravar(true);
    setErro(null);
    try {
      const fim = Math.max(match.matchMinutes ?? 0, minuto);
      const linhas = [...jaJogaram].map((id) => {
        const meus = estado.acontecimentos.filter((a) => a.atleta === id);
        const entrou = estado.acontecimentos.find((a) => a.tipo === "sub" && a.entra === id);
        const saiu = meus.find((a) => a.tipo === "sub");
        const vermelho = meus.find((a) => a.tipo === "vermelho");
        const marcados = meus.filter((a) => a.tipo === "golo");
        const golos = marcados.map((a) => a.minuto);
        const total = marcados.reduce((n, a) => n + (a.valor ?? 1), 0);
        const amarelos = meus.filter((a) => a.tipo === "amarelo").map((a) => a.minuto);
        const de = entrou?.minuto ?? 0;
        const ate = saiu?.minuto ?? vermelho?.minuto ?? fim;
        return {
          athleteId: id,
          minutes: Math.max(0, ate - de),
          started: estado.onze.includes(id),
          tally: total,
          assists: 0,
          yellowCards: Math.min(2, amarelos.length),
          redCard: Boolean(vermelho),
          ...(entrou ? { onMinute: entrou.minuto } : {}),
          ...(saiu ? { offMinute: saiu.minuto } : {}),
          ...(amarelos.length ? { yellowAt: amarelos.slice(0, 2) } : {}),
          ...(vermelho ? { redAt: vermelho.minuto } : {}),
          ...(golos.length && !pontos ? { tallyAt: golos.slice(0, 12) } : {}),
        };
      });
      await saveResult(match.id, nossos, deles);
      await saveAppearances(match.id, linhas);
      setGravado(true);
      mudar({ ...estado, base: segundos / 60, desde: null });
      setGravado(true);
      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar o jogo.");
    } finally {
      setAGravar(false);
    }
  }

  /* ---- antes de começar: confirmar quem começa ---- */
  if (match.squad.length === 0) {
    return <Aviso titulo="O jogo ao vivo precisa dos convocados" texto="Envia a convocatória (ou regista o plantel no Pós-jogo) para poderes marcar golos, cartões e substituições a jogadores." />;
  }
  if (!mayRecord) {
    return <Aviso titulo="Só quem regista a ficha acompanha o jogo ao vivo" texto="O resultado e a ficha aparecem no Pós-jogo quando forem gravados." />;
  }

  const nome = (id?: string) => (id ? (porId.get(id)?.curto ?? "Atleta") : "");
  const TEXTO: Record<Tipo, string> = pontos
    ? { golo: "Cesto", sofrido: "Cesto sofrido", amarelo: "Amarelo", vermelho: "Vermelho", sub: "Substituição" }
    : { golo: "Golo", sofrido: "Golo sofrido", amarelo: "Amarelo", vermelho: "Vermelho", sub: "Substituição" };

  return (
    <div className="mx-auto max-w-[720px] space-y-4">
      {/* O relógio e o resultado. */}
      <Cartao className="px-4 py-5 text-center">
        <Rotulo>{aAndar ? "A decorrer" : comecou ? "Parado" : "Por começar"}</Rotulo>
        <div className="mt-1 flex items-center justify-center gap-5">
          <span className="text-[44px] leading-none font-semibold tracking-[-0.03em] text-ink tabular">{nossos}</span>
          <span className="font-mono text-[28px] leading-none text-ink tabular">
            {String(minuto).padStart(2, "0")}:{String(Math.floor(segundos % 60)).padStart(2, "0")}
          </span>
          <span className="text-[44px] leading-none font-semibold tracking-[-0.03em] text-ink-3 tabular">{deles}</span>
        </div>
        <div className="mt-1 flex justify-center gap-10 text-[11px] text-ink-3">
          <span className="max-w-[40%] truncate">{match.teamName}</span>
          <span className="max-w-[40%] truncate">{match.opponent}</span>
        </div>
        <button type="button" onClick={alternarRelogio} className={cx("mt-3 inline-flex h-11 items-center gap-2 rounded-[10px] px-5 text-body font-semibold", aAndar ? "border border-line text-ink" : "bg-ink text-surface")}>
          {aAndar ? <Pause className="size-4" strokeWidth={2} /> : <Play className="size-4" strokeWidth={2} />}
          {aAndar ? "Parar (intervalo)" : comecou ? "Retomar" : "Começar o jogo"}
        </button>
      </Cartao>

      {/* Os titulares, enquanto o jogo não começa. */}
      {!comecou && (
        <section>
          <div>
            <Rotulo>Quem começa · {estado.onze.length}</Rotulo>
            <p className="mt-0.5 text-meta text-ink-3">{titularesDoPlano.length > 0 ? "Vem da equipa inicial do Pré-jogo. Acerta se mudou à última hora." : "Escolhe os titulares."}</p>
          </div>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {jogadores
              .filter((j) => j.estado !== "baixa" && j.estado !== "recusou")
              .map((j) => {
                const on = estado.onze.includes(j.id);
                return (
                  <li key={j.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => mudar({ ...estado, onze: on ? estado.onze.filter((x) => x !== j.id) : [...estado.onze, j.id] })}
                      className={cx("flex h-12 w-full items-center gap-2.5 rounded-[10px] border px-3 text-left", on ? "border-ink bg-ink text-surface" : "border-line text-ink")}
                    >
                      <span className="w-6 font-mono text-[12px] tabular opacity-70">{j.numero ?? "–"}</span>
                      <span className="min-w-0 flex-1 truncate text-body font-medium">{j.nome}</span>
                      {on && <Check className="size-4" strokeWidth={2} />}
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>
      )}

      {/* Os quatro botões. Alvos grandes: é para carregar com o polegar. */}
      {comecou && (
        <section className="grid grid-cols-2 gap-2">
          {pontos ? (
            <>
              {/* Um cesto vale um, dois ou três: três botões nossos, três deles. */}
              <div className="col-span-2 grid grid-cols-3 gap-2">
                {[1, 2, 3].map((v) => (
                  <Botao key={v} onClick={() => setAEscolher({ tipo: "golo", valor: v })}>{`+${v}`}</Botao>
                ))}
              </div>
              <div className="col-span-2 grid grid-cols-3 gap-2">
                {[1, 2, 3].map((v) => (
                  <Botao key={v} onClick={() => registar({ tipo: "sofrido", valor: v })} suave>{`Eles +${v}`}</Botao>
                ))}
              </div>
            </>
          ) : (
            <>
              <Botao onClick={() => setAEscolher({ tipo: "golo" })}>Golo</Botao>
              <Botao onClick={() => registar({ tipo: "sofrido" })} suave>
                Golo sofrido
              </Botao>
              <Botao onClick={() => setAEscolher({ tipo: "amarelo" })} suave>
                Cartão amarelo
              </Botao>
              <Botao onClick={() => setAEscolher({ tipo: "vermelho" })} suave>
                Cartão vermelho
              </Botao>
            </>
          )}
          <Botao onClick={() => setAEscolher({ tipo: "sub" })} suave largo>
            Substituição
          </Botao>
        </section>
      )}

      {/* Escolher o jogador do acontecimento. */}
      {aEscolher && (
        <section className="rounded-[12px] border border-ink bg-surface p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <Rotulo className="text-ink">
              {aEscolher.tipo === "sub" ? (aEscolher.sai ? `Sai ${nome(aEscolher.sai)}. Quem entra?` : "Quem sai?") : `${TEXTO[aEscolher.tipo]} · de quem?`}
            </Rotulo>
            <button type="button" className="ctl-ghost size-8 justify-center px-0" aria-label="Cancelar" onClick={() => setAEscolher(null)}>
              <X className="size-4" strokeWidth={1.75} />
            </button>
          </div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {(aEscolher.tipo === "sub" && aEscolher.sai ? noBanco : jogadores.filter((j) => emCampo.has(j.id))).map((j: Jogador) => (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (aEscolher.tipo === "sub") {
                      if (!aEscolher.sai) setAEscolher({ tipo: "sub", sai: j.id });
                      else registar({ tipo: "sub", atleta: aEscolher.sai, entra: j.id });
                    } else registar({ tipo: aEscolher.tipo, atleta: j.id, ...(aEscolher.valor ? { valor: aEscolher.valor } : {}) });
                  }}
                  className="flex h-12 w-full items-center gap-2.5 rounded-[10px] border border-line px-3 text-left text-ink hover:border-ink"
                >
                  <span className="w-6 font-mono text-[12px] text-ink-3 tabular">{j.numero ?? "–"}</span>
                  <span className="min-w-0 flex-1 truncate text-body font-medium">{j.nome}</span>
                </button>
              </li>
            ))}
          </ul>
          {aEscolher.tipo === "sub" && aEscolher.sai && noBanco.length === 0 && <p className="text-meta text-ink-3">Não há mais ninguém no banco.</p>}
        </section>
      )}

      {/* O que já aconteceu, do mais recente para trás. */}
      {estado.acontecimentos.length > 0 && (
        <section>
          <div>
            <Rotulo>Acontecimentos · {estado.acontecimentos.length}</Rotulo>
          </div>
          <ol>
            {[...estado.acontecimentos]
              .sort((a, b) => b.minuto - a.minuto)
              .map((a) => (
                <li key={a.id} className="flex items-center gap-2 border-b border-line py-2">
                  <span className="flex shrink-0 items-center">
                    <button type="button" aria-label="Menos um minuto" onClick={() => acertarMinuto(a.id, -1)} className="flex size-8 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-ink">
                      −
                    </button>
                    <span className="w-9 text-center font-mono text-body text-ink tabular">{a.minuto}′</span>
                    <button type="button" aria-label="Mais um minuto" onClick={() => acertarMinuto(a.id, 1)} className="flex size-8 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-ink">
                      +
                    </button>
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body text-ink">
                    <span className="font-medium">
                      {TEXTO[a.tipo]}
                      {pontos && a.valor ? ` de ${a.valor}` : ""}
                    </span>
                    {a.tipo === "sub" ? ` · sai ${nome(a.atleta)}, entra ${nome(a.entra)}` : a.atleta ? ` · ${nome(a.atleta)}` : ""}
                  </span>
                  <button
                    type="button"
                    aria-label="Apagar este acontecimento"
                    onClick={() => mudar({ ...estado, acontecimentos: estado.acontecimentos.filter((x) => x.id !== a.id) })}
                    className="flex size-8 shrink-0 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-risk"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.75} />
                  </button>
                </li>
              ))}
          </ol>
        </section>
      )}

      {/* Terminar. */}
      {comecou && (
        <section className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2.5">
          {erro && (
            <span className="text-meta text-risk" role="alert">
              {erro}
            </span>
          )}
          {gravado && !erro && (
            <span className="inline-flex items-center gap-1 text-meta text-ok">
              <Check className="size-3.5" strokeWidth={2} /> Resultado e ficha gravados. Acerta o resto no Pós-jogo.
            </span>
          )}
          {!gravado && !erro && <span className="text-meta text-ink-3">Fica guardado neste telemóvel até gravares.</span>}
          <button type="button" onClick={() => void terminar()} disabled={aGravar} className="ctl-primary ml-auto h-11 px-4">
            {aGravar ? "A gravar…" : `Terminar e gravar ${nossos}–${deles}`}
          </button>
        </section>
      )}
    </div>
  );
}

/** O título de um bloco. */
function Rotulo({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cx("text-meta font-semibold text-ink", className)}>{children}</span>;
}

function Botao({ children, onClick, suave, largo }: { children: string; onClick: () => void; suave?: boolean; largo?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "h-16 rounded-[12px] text-[16px] font-semibold transition-transform active:scale-[0.98]",
        suave ? "border border-line bg-surface text-ink hover:border-ink" : "bg-ink text-surface",
        largo && "col-span-2",
      )}
    >
      {children}
    </button>
  );
}

function Aviso({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{titulo}</h3>
      <p className="mx-auto mt-1 max-w-[460px] text-meta leading-relaxed text-ink-3">{texto}</p>
    </div>
  );
}
