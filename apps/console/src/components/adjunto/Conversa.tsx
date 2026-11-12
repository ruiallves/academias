import { Fragment, useEffect, useRef, useState } from "react";
import { Check, Pencil, Undo2 } from "@/lib/icons";
import { cx, Monogram, Pill } from "@/components/primitives";
import { mostrarOk, textoDoErro, mostrarErro } from "@/lib/avisos";
import {
  confirmarProposta,
  desfazerProposta,
  editarProposta,
  enviar,
  formularioDaProposta,
  NOME_DO_ADJUNTO,
  pedirPagina,
  recusarProposta,
  useAdjunto,
  type Contexto,
  type Formulario as FormularioDoAdjunto,
  type Importacao,
  type Mensagem,
  type Pergunta,
  type Proposta,
} from "@/lib/adjunto";
import { Link } from "react-router-dom";
import { PainelImportacao } from "./Importacao";
import { ClubMark } from "@/components/ClubMark";
import { Formulario } from "./Formulario";
import { DiagramPlayer, FieldView, THUMB_RATIO } from "@/components/FieldEditor";

/**
 * A conversa com o Adjunto: as mensagens, os cartões de proposta, as perguntas
 * com botões e as importações.
 *
 * A mesma lista serve o minichat ao canto (`compacto`) e a página inteira. O
 * que muda em compacto é o tamanho e o que a importação mostra: um resumo com
 * "Abrir o ensaio", porque uma tabela de colunas não cabe num balão de 380px.
 */
export function Conversa({ compacto, contexto }: { compacto?: boolean; contexto?: Contexto }) {
  const { conversa, aResponder, passo } = useAdjunto();
  const fim = useRef<HTMLDivElement>(null);
  const mensagens = conversa?.messages ?? [];

  // O fim da conversa fica sempre à vista enquanto a resposta chega.
  const ultimaChave = `${mensagens.length}:${mensagens[mensagens.length - 1]?.text.length ?? 0}:${conversa?.proposals.length ?? 0}`;
  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [ultimaChave]);

  if (mensagens.length === 0) {
    return <Vazia compacto={compacto} />;
  }

  // Uma pergunta só se responde enquanto for a última coisa dita.
  const indiceDaUltimaDaPessoa = mensagens.map((m) => m.role).lastIndexOf("USER");

  return (
    <div className={cx("flex flex-col", compacto ? "gap-3 px-3.5 py-3" : "mx-auto w-full max-w-[760px] gap-4 px-4 py-6 md:px-6")}>
      {mensagens.map((m, i) => (
        <Balao
          key={m.id}
          mensagem={m}
          compacto={compacto}
          contexto={contexto}
          propostas={conversa?.proposals ?? []}
          importacoes={conversa?.imports ?? []}
          perguntaActiva={m.role === "ASSISTANT" && i > indiceDaUltimaDaPessoa}
          aResponder={aResponder}
          passo={passo}
        />
      ))}
      <div ref={fim} />
    </div>
  );
}

/** O minichat vazio: o emblema, uma frase, e as sugestões ficam na caixa por baixo. */
function Vazia({ compacto }: { compacto?: boolean }) {
  const { semChave } = useAdjunto();
  return (
    <div className={cx("flex h-full flex-col items-center justify-center text-center", compacto ? "px-6 py-8" : "mx-auto w-full max-w-[680px] px-6 py-12")}>
      <ClubMark size={44} radius={12} />
      <div className="mt-4 text-panel text-ink">Em que posso ajudar?</div>
      <p className="mt-1.5 max-w-[280px] text-meta leading-[1.5] text-ink-3">
        Presenças, lesões, convocatórias, quem está indisponível, ou um Excel de atletas. Nada fica gravado sem confirmares.
      </p>
      {semChave && <p className="mt-3 rounded-full bg-warn-soft px-3 py-1 text-[11px] text-warn">Desenvolvimento: falta a OPENAI_API_KEY na API.</p>}
    </div>
  );
}

function Balao({
  mensagem,
  compacto,
  contexto,
  propostas,
  importacoes,
  perguntaActiva,
  aResponder,
  passo,
}: {
  mensagem: Mensagem;
  compacto?: boolean;
  contexto?: Contexto;
  propostas: Proposta[];
  importacoes: Importacao[];
  perguntaActiva: boolean;
  aResponder: boolean;
  passo: string | null;
}) {
  if (mensagem.role === "USER") {
    return (
      <div className="flex justify-end">
        <div className={cx("max-w-[85%] rounded-[12px_12px_4px_12px] border border-line bg-surface px-3 py-2 whitespace-pre-wrap text-ink", compacto ? "text-meta" : "text-body")}>
          {mensagem.text}
        </div>
      </div>
    );
  }

  const aPensar = mensagem.aChegar && !mensagem.text && mensagem.blocks.length === 0;
  return (
    <div className="flex flex-col gap-2.5">
      {aPensar ? (
        <div className={cx("flex items-center gap-2 text-ink-3", compacto ? "text-meta" : "text-body")}>
          <span className="adjunto-pulso inline-block size-2 rounded-full bg-signal" aria-hidden />
          {aResponder && passo ? `${NOME_DO_ADJUNTO} está ${passo}` : `${NOME_DO_ADJUNTO} está a pensar`}
        </div>
      ) : (
        mensagem.text && <div className={cx("whitespace-pre-wrap leading-[1.5] text-ink-2", compacto ? "text-meta" : "text-body")}>{mensagem.text}</div>
      )}
      {mensagem.blocks.map((b, i) => {
        if (b.type === "proposta") {
          const p = propostas.find((x) => x.id === b.id);
          return p ? <CartaoProposta key={b.id} proposta={p} compacto={compacto} /> : null;
        }
        if (b.type === "pergunta") {
          // O texto da pergunta só aparece quando a resposta não o escreveu já (senão saía duas vezes).
          return <Opcoes key={i} pergunta={{ ...b.pergunta, texto: mensagem.text.trim() ? "" : b.pergunta.texto }} activa={perguntaActiva && !aResponder} contexto={contexto} compacto={compacto} />;
        }
        if (b.type === "formulario") {
          return <Formulario key={`f-${i}`} formulario={b.formulario} messageId={mensagem.id} enviado={b.enviado} compacto={compacto} />;
        }
        if (b.type === "importacao") {
          const imp = importacoes.find((x) => x.id === b.id);
          if (!imp) return null;
          return compacto ? <CartaoImportacaoCompacto key={b.id} imp={imp} /> : <PainelImportacao key={b.id} imp={imp} />;
        }
        return null;
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pergunta com botões                                                         */
/* -------------------------------------------------------------------------- */

function Opcoes({ pergunta, activa, contexto, compacto }: { pergunta: Pergunta; activa: boolean; contexto?: Contexto; compacto?: boolean }) {
  const [escolhida, setEscolhida] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      {pergunta.texto && <div className={cx("text-ink-2", compacto ? "text-meta" : "text-body")}>{pergunta.texto}</div>}
      {pergunta.opcoes.length === 0 && activa && <div className="text-meta text-ink-3">Responde na caixa em baixo.</div>}
      <div className="flex flex-wrap gap-2">
        {pergunta.opcoes.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={!activa}
            onClick={() => {
              setEscolhida(o.id);
              void enviar({ texto: "", contexto, escolha: { campo: pergunta.campo, id: o.id, label: o.label } });
            }}
            className={cx(
              "ctl-outline h-9 px-3 text-body font-medium",
              escolhida === o.id && "border-signal-strong bg-signal-soft text-signal-ink",
              !activa && escolhida !== o.id && "opacity-50",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cartão de proposta                                                          */
/* -------------------------------------------------------------------------- */

function CartaoProposta({ proposta, compacto }: { proposta: Proposta; compacto?: boolean }) {
  const [ocupado, setOcupado] = useState(false);
  const [aberto, setAberto] = useState(!compacto);
  /** O formulário da proposta, aberto dentro do cartão para a editar. */
  const [edicao, setEdicao] = useState<FormularioDoAdjunto | null>(null);

  const abrirEdicao = async () => {
    setOcupado(true);
    try {
      setEdicao(await formularioDaProposta(proposta.id));
    } catch (e) {
      mostrarErro(textoDoErro(e));
    } finally {
      setOcupado(false);
    }
  };
  // O "Desfazer" acaba sozinho ao fim de dez minutos: reavaliar de vez em quando.
  const [, forcar] = useState(0);
  useEffect(() => {
    if (proposta.status !== "CONFIRMED") return;
    const t = setInterval(() => forcar((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [proposta.status]);

  const agir = async (accao: () => Promise<unknown>, ok?: string) => {
    setOcupado(true);
    try {
      await accao();
      if (ok) mostrarOk(ok);
    } catch (e) {
      mostrarErro(textoDoErro(e));
    } finally {
      setOcupado(false);
    }
  };

  const view = proposta.view;
  const pendente = proposta.status === "PENDING";
  const podeDesfazer = proposta.status === "CONFIRMED" && proposta.podeDesfazer && proposta.confirmedAt && Date.now() - new Date(proposta.confirmedAt).getTime() < 10 * 60_000;

  return (
    <section className={cx("panel overflow-hidden", pendente && "border-signal-line")} aria-label={proposta.title}>
      <header className="flex items-start justify-between gap-3 px-3.5 pt-3 pb-2.5">
        <div className="min-w-0">
          <div className="text-group text-ink-4 uppercase">{rotuloDoTipo(proposta.kind, view)}</div>
          <div className="mt-0.5 text-body font-semibold text-ink">{tituloCurto(proposta)}</div>
          <div className="text-meta text-ink-3">{proposta.summary}</div>
        </div>
        <EstadoDaProposta proposta={proposta} />
      </header>

      {edicao ? (
        <Formulario
          formulario={edicao}
          compacto={compacto}
          embutido
          onCancelar={() => setEdicao(null)}
          onEnviar={async (valores) => {
            await editarProposta(proposta.id, valores);
            setEdicao(null);
            mostrarOk("Atualizado. Confirma quando estiver certo.");
          }}
        />
      ) : (
        <>
          {aberto && <DetalheDaProposta proposta={proposta} />}
          {compacto && temDetalhe(proposta) && (
            <button type="button" onClick={() => setAberto((v) => !v)} className="px-3.5 pb-2 text-meta font-medium text-signal-ink">
              {aberto ? "Esconder" : "Ver tudo"}
            </button>
          )}
        </>
      )}

      {pendente && !edicao && (
        <footer className="flex items-center gap-2 border-t border-line px-3.5 py-2.5">
          <button type="button" disabled={ocupado} onClick={() => agir(() => confirmarProposta(proposta.id), "Gravado.")} className="ctl-primary h-9">
            <Check className="size-4" strokeWidth={2} /> Confirmar
          </button>
          {proposta.editavel && (
            <button type="button" disabled={ocupado} onClick={() => void abrirEdicao()} className="ctl-outline h-9">
              <Pencil className="size-4" strokeWidth={1.75} /> Editar
            </button>
          )}
          <button type="button" disabled={ocupado} onClick={() => agir(() => recusarProposta(proposta.id))} className="ctl-ghost ml-auto h-9">
            Não registar
          </button>
        </footer>
      )}
      {podeDesfazer && (
        <footer className="flex items-center justify-between gap-2 border-t border-line px-3.5 py-2.5 text-meta text-ink-3">
          <span>{proposta.kind === "CLINICAL" && view.modo === "avisar" ? "O departamento clínico foi avisado." : "Gravado. Dá para desfazer durante dez minutos."}</span>
          {!(proposta.kind === "CLINICAL" && view.modo === "avisar") && (
            <button type="button" disabled={ocupado} onClick={() => agir(() => desfazerProposta(proposta.id), "Desfeito.")} className="ctl-ghost h-8">
              <Undo2 className="size-4" strokeWidth={1.75} /> Desfazer
            </button>
          )}
        </footer>
      )}
      {/* O que ficou gravado tem página própria (o plano na Área técnica): a ligação fica no cartão. */}
      {proposta.status === "CONFIRMED" && abrirDe(view) && (
        <footer className="border-t border-line px-3.5 py-2.5">
          <Link to={abrirDe(view)!.to} className="ctl-outline h-8">
            {abrirDe(view)!.rotulo}
          </Link>
        </footer>
      )}
    </section>
  );
}

function EstadoDaProposta({ proposta }: { proposta: Proposta }) {
  if (proposta.status === "PENDING") return <Pill tone="signal">Por confirmar</Pill>;
  if (proposta.status === "CONFIRMED") return <Pill tone="ok">Gravado</Pill>;
  if (proposta.status === "UNDONE") return <Pill tone="neutral">Desfeito</Pill>;
  if (proposta.status === "REJECTED") return <Pill tone="neutral">Recusado</Pill>;
  return <Pill tone="neutral">Expirou</Pill>;
}

/** As propostas de formulário (marcar, inscrever, publicar, planear) trazem as linhas prontas em `view.linhas`. */
function generica(p: Proposta): boolean {
  return p.kind === "EVENT" || p.kind === "ATHLETE" || p.kind === "ANNOUNCEMENT" || p.kind === "TRAINING_PLAN" || p.kind === "SITE_NEWS" || p.kind === "SITE" || p.kind === "EXERCISE";
}

/** Um atleta na folha de presenças proposta. */
type AtletaDaFolha = { athleteId: string; nome: string; numero: number | null; estado: string; motivo: string | null };

const ROTULO_DO_ESTADO: Record<string, string> = { presente: "Presente", absent: "Falta", justified: "Justificada", late: "Atraso", baixa: "De baixa" };
const TOM_DO_ESTADO: Record<string, "ok" | "risk" | "warn" | "neutral"> = { presente: "ok", absent: "risk", justified: "warn", late: "warn", baixa: "neutral" };

/** A página do que ficou gravado, quando a proposta a traz (`view.abrir`). */
function abrirDe(view: Record<string, unknown>): { rotulo: string; to: string } | null {
  const a = view.abrir as { rotulo?: string; to?: string } | undefined;
  return a && typeof a.to === "string" && a.to.startsWith("/") ? { rotulo: a.rotulo || "Abrir", to: a.to } : null;
}

type BlocoDoPlano = {
  nome: string;
  minutos: number;
  categoria: string | null;
  objetivo: string | null;
  intensidade: number | null;
  jogadores: string | null;
  notas: string | null;
  exercicio: { nome: string; novo: boolean; descricao: string | null; desenho: unknown } | null;
};

/** Os blocos de um plano de treino, com a miniatura do desenho de cada exercício novo. */
function BlocosDoPlano({ blocos }: { blocos: BlocoDoPlano[] }) {
  return (
    <ol className="border-t border-line">
      {blocos.map((b, i) => (
        <li key={`${i}-${b.nome}`} className="flex gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0">
          <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-meta text-ink-4 tabular-nums">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-body font-medium text-ink">{b.nome}</span>
              <span className="text-meta text-ink-3 tabular-nums">{b.minutos} min</span>
              {b.intensidade ? <span className="text-meta text-ink-3">· intensidade {b.intensidade}/10</span> : null}
              {b.categoria ? <span className="text-meta text-ink-3">· {b.categoria}</span> : null}
            </div>
            {b.objetivo && <div className="text-meta text-ink-2">{b.objetivo}</div>}
            {b.exercicio && (
              <div className="mt-1.5 flex gap-3">
                {b.exercicio.desenho ? <FieldView diagram={b.exercicio.desenho} className="block w-[112px] shrink-0 overflow-hidden rounded-[8px]" ratio={THUMB_RATIO} /> : null}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-meta">
                    <span className="font-medium text-ink">{b.exercicio.nome}</span>
                    <Pill tone={b.exercicio.novo ? "signal" : "neutral"}>{b.exercicio.novo ? "Novo" : "Da biblioteca"}</Pill>
                  </div>
                  {b.exercicio.descricao && <p className="mt-0.5 line-clamp-4 text-meta text-ink-3">{b.exercicio.descricao}</p>}
                  {b.jogadores && <div className="mt-0.5 text-meta text-ink-3">{b.jogadores}</div>}
                </div>
              </div>
            )}
            {b.notas && <div className="mt-1 text-meta text-ink-3">{b.notas}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function rotuloDoTipo(kind: Proposta["kind"], view: Record<string, unknown>): string {
  if (kind === "ATTENDANCE") return "Presenças";
  if (kind === "CALLUPS") return "Convocatória";
  if (kind === "CLINICAL") return view.modo === "avisar" ? "Aviso ao clínico" : "Lesão";
  return String(view.rotulo ?? "Ação");
}

function tituloCurto(p: Proposta): string {
  const v = p.view;
  if (p.kind === "ATTENDANCE") return `${v.teamName ?? ""} · ${v.quando ?? ""}`.trim();
  if (p.kind === "CALLUPS") return `${v.teamName ?? ""} · ${v.quando ?? ""} vs ${v.adversario ?? ""}`.trim();
  if (p.kind === "CLINICAL") return String(v.nome ?? p.title);
  return p.title.replace(/^[^·]+·\s*/, "");
}

function temDetalhe(p: Proposta): boolean {
  const v = p.view;
  if (p.kind === "ATTENDANCE") return ((v.atletas as unknown[]) ?? (v.faltas as unknown[]) ?? []).length > 0;
  if (p.kind === "CALLUPS") return ((v.convocados as unknown[]) ?? []).length > 0;
  if (generica(p)) return ((v.linhas as unknown[]) ?? []).length > 0;
  return true;
}

function DetalheDaProposta({ proposta }: { proposta: Proposta }) {
  const v = proposta.view;
  if (generica(proposta)) {
    const linhas = (v.linhas as { rotulo: string; valor: string }[]) ?? [];
    const avisos = (v.avisos as string[]) ?? [];
    return (
      <div className="border-t border-line">
        <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-3.5 py-3 text-body">
          {linhas.map((l) => (
            <Fragment key={l.rotulo}>
              <span className="text-ink-3">{l.rotulo}</span>
              <span className="whitespace-pre-wrap text-ink">{l.valor}</span>
            </Fragment>
          ))}
        </div>
        {proposta.kind === "TRAINING_PLAN" && Array.isArray(v.blocos) && <BlocosDoPlano blocos={v.blocos as BlocoDoPlano[]} />}
        {/* O exercício novo: o desenho, com a animação quando tem vários momentos. */}
        {proposta.kind === "EXERCISE" && v.desenho ? (
          <div className="border-t border-line px-3.5 py-3">
            <DiagramPlayer diagram={v.desenho} className="mx-auto w-full max-w-[520px] overflow-hidden rounded-[10px]" />
          </div>
        ) : null}
        {avisos.map((a) => (
          <div key={a} className="border-t border-line px-3.5 py-2 text-meta text-warn">{a}</div>
        ))}
      </div>
    );
  }
  if (proposta.kind === "ATTENDANCE") {
    const faltas = (v.faltas as { athleteId: string; nome: string; tipo: string; motivo: string | null }[]) ?? [];
    const atletas = v.atletas as AtletaDaFolha[] | undefined;
    // A folha inteira, como na página de Presenças: todos os atletas, cada um com o estado com que fica.
    if (atletas?.length) {
      return (
        <div className="border-t border-line">
          {v.jaFechada === true && <div className="px-3.5 py-2 text-meta text-warn">A folha deste treino já estava fechada; confirmar substitui-a.</div>}
          <ul className="grid grid-cols-1 sm:grid-cols-2">
            {atletas.map((a) => (
              <li key={a.athleteId} className="flex items-center gap-2.5 border-b border-line px-3.5 py-1.5">
                <span className="w-6 shrink-0 text-right font-mono text-meta text-ink-4 tabular-nums">{a.numero ?? ""}</span>
                <span className={cx("min-w-0 flex-1 truncate text-body", a.estado === "presente" ? "text-ink" : a.estado === "baixa" ? "text-ink-3" : "font-medium text-ink")} title={a.motivo ?? undefined}>
                  {a.nome}
                </span>
                <Pill tone={TOM_DO_ESTADO[a.estado] ?? "neutral"}>{ROTULO_DO_ESTADO[a.estado] ?? a.estado}</Pill>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    return (
      <div className="border-t border-line">
        {v.jaFechada === true && <div className="px-3.5 py-2 text-meta text-warn">A folha deste treino já estava fechada; confirmar substitui-a.</div>}
        {faltas.length === 0 ? (
          <div className="px-3.5 py-2.5 text-meta text-ink-3">Estiveram todos.</div>
        ) : (
          faltas.map((f) => (
            <div key={f.athleteId} className="flex items-center gap-2.5 border-b border-line px-3.5 py-2 last:border-b-0">
              <Monogram name={f.nome} size="sm" />
              <span className="min-w-0 flex-1 truncate text-body text-ink">{f.nome}</span>
              <Pill tone={f.tipo === "late" ? "warn" : "risk"}>{f.tipo === "justified" ? "Justificada" : f.tipo === "late" ? "Atraso" : "Falta"}</Pill>
              {f.motivo && <span className="hidden text-meta text-ink-3 sm:inline">{f.motivo}</span>}
            </div>
          ))
        )}
      </div>
    );
  }
  if (proposta.kind === "CALLUPS") {
    const convocados = (v.convocados as { athleteId: string; nome: string; numero: number | null; posicao: string | null }[]) ?? [];
    const deFora = (v.deFora as string[]) ?? [];
    return (
      <div className="border-t border-line">
        {v.jaSubmetida === true && <div className="px-3.5 py-2 text-meta text-warn">A convocatória já tinha sido submetida; confirmar muda a lista guardada.</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2">
          {convocados.map((c) => (
            <div key={c.athleteId} className="flex items-center gap-2.5 border-b border-line px-3.5 py-1.5">
              <span className="w-6 text-right font-mono text-meta text-ink-3 tabular-nums">{c.numero ?? ""}</span>
              <span className="min-w-0 flex-1 truncate text-body text-ink">{c.nome}</span>
              {c.posicao && <span className="text-meta text-ink-3">{c.posicao}</span>}
            </div>
          ))}
        </div>
        {deFora.length > 0 && <div className="px-3.5 py-2 text-meta text-ink-3">Ficam de fora: {deFora.join(", ")}.</div>}
        <div className="px-3.5 py-2 text-meta text-ink-3">Confirmar guarda a lista. Submeter às famílias faz-se na página do jogo.</div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-line px-3.5 py-3 text-body">
      <span className="text-ink-3">O que</span>
      <span className="text-ink">{String(v.descricao ?? "")}</span>
      <span className="text-ink-3">Situação</span>
      <span className="text-ink">{String(v.situacao ?? "")}</span>
      <span className="text-ink-3">Quando</span>
      <span className="text-ink">{String(v.data ?? "")}</span>
      {v.retomaPrevista ? (
        <>
          <span className="text-ink-3">Retoma</span>
          <span className="text-ink">{String(v.retomaPrevista)}</span>
        </>
      ) : null}
      {v.modo === "avisar" && <span className="col-span-2 text-meta text-ink-3">Não escreves no boletim clínico: ao confirmar, o departamento clínico recebe o aviso e regista.</span>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Importação, em compacto                                                     */
/* -------------------------------------------------------------------------- */

function CartaoImportacaoCompacto({ imp }: { imp: Importacao }) {
  const atletas = imp.folhas.filter((f) => f.ensaio?.suportada);
  const entram = atletas.reduce((n, f) => n + (f.ensaio?.entram ?? 0), 0);
  const existem = atletas.reduce((n, f) => n + (f.ensaio?.jaExistiam ?? 0), 0);
  const erros = atletas.reduce((n, f) => n + (f.ensaio?.erros.length ?? 0), 0);
  return (
    <section className="panel px-3.5 py-3">
      <div className="text-group text-ink-4 uppercase">Importação</div>
      <div className="mt-0.5 truncate text-body font-semibold text-ink">{imp.fileName}</div>
      {imp.status === "FAILED" ? (
        <div className="mt-1 text-meta text-risk">{imp.error}</div>
      ) : imp.status === "IMPORTED" ? (
        <div className="mt-1 text-meta text-ink-3">Importação feita.</div>
      ) : (
        <div className="mt-1 text-meta text-ink-3">
          {entram} entram{existem ? `, ${existem} já existiam` : ""}{erros ? `, ${erros} com problemas` : ""}. Nada gravado ainda.
        </div>
      )}
      {imp.status === "REHEARSED" && (
        <button type="button" onClick={() => pedirPagina()} className="ctl-primary mt-2.5 h-9">
          Abrir o ensaio
        </button>
      )}
    </section>
  );
}
