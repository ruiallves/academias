import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Bot, MessageSquarePlus, Trash2 } from "@/lib/icons";
import { cx, Empty, Loading } from "@/components/primitives";
import { useMobile } from "@/lib/viewport";
import { mostrarErro, textoDoErro } from "@/lib/avisos";
import { abrirConversa, apagarConversa, carregarConversas, carregarEstado, fecharConversa, NOME_DO_ADJUNTO, preCarregar, useAdjunto, type ResumoDeConversa } from "@/lib/adjunto";
import { contextoDaRota, sugestoesPara } from "@/lib/sugestoes";
import { Conversa } from "@/components/adjunto/Conversa";
import { Compositor, SugestoesEmCartoes } from "@/components/adjunto/Compositor";
import { ClubMark } from "@/components/ClubMark";
import { useSession } from "@/session";
import { useBusy } from "@/components/Busy";
import { ConfirmDialog } from "@/components/ConfirmDialog";

/** "Bom dia" até ao meio-dia, "Boa tarde" até às oito, "Boa noite" depois. */
function saudacao(): string {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 20 ? "Boa tarde" : "Boa noite";
}

function primeiroNome(nome: string | undefined): string {
  return (nome ?? "").trim().split(/\s+/)[0] || "olá";
}

/**
 * A página do Adjunto: o histórico à esquerda, a conversa ao meio, a caixa de
 * falar em baixo com as sugestões por cima.
 *
 * É a mesma conversa do minichat (ver `lib/adjunto.ts`): o que se começou ao
 * canto continua aqui, e é aqui que uma importação mostra o ensaio inteiro.
 * No telemóvel a lista de conversas vive atrás de um botão, porque as duas
 * colunas não cabem.
 */
export default function Adjunto() {
  const { ligado, conversa, conversas, semChave, aAbrir } = useAdjunto();
  const { session } = useSession();
  // Abrir uma conversa que ainda não estava em memória: o desfoque e o disco de sempre (ver `Busy`).
  useBusy(aAbrir);
  const { pathname } = useLocation();
  const mobile = useMobile();
  const [listaAberta, setListaAberta] = useState(false);
  const [aCarregar, setACarregar] = useState(true);

  useEffect(() => {
    void carregarEstado();
    carregarConversas()
      .catch(() => undefined)
      .finally(() => setACarregar(false));
  }, []);

  const abrir = async (id: string) => {
    setListaAberta(false);
    try {
      await abrirConversa(id);
    } catch (e) {
      mostrarErro(textoDoErro(e));
    }
  };

  /** A conversa à espera de confirmação para ser apagada: abre o diálogo da consola, nunca o `confirm()` do browser. */
  const [aApagar, setAApagar] = useState<ResumoDeConversa | null>(null);
  const apagar = (c: ResumoDeConversa) => setAApagar(c);

  if (ligado === false) {
    return (
      <div className="page-pad">
        <Empty title="O Assistente IA está desligado neste clube" detail="Fala com a Academias para o ligar." />
      </div>
    );
  }

  const contexto = contextoDaRota(pathname);
  const sugestoes = sugestoesPara(pathname, { minimo: 4 });
  const vazia = !conversa || conversa.messages.length === 0;

  const lista = (
    <aside className={cx("flex min-h-0 flex-col bg-surface", mobile ? "h-full" : "w-[264px] shrink-0 border-r border-line")} aria-label="Conversas">
      <div className="flex flex-col gap-2 p-3">
        <button
          type="button"
          onClick={() => {
            fecharConversa();
            setListaAberta(false);
          }}
          className="ctl-outline h-9 justify-center"
        >
          <MessageSquarePlus className="size-4" strokeWidth={1.75} /> Nova conversa
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {aCarregar ? (
          <Loading />
        ) : conversas.length === 0 ? (
          <div className="px-2 py-3 text-meta text-ink-3">Ainda não há conversas.</div>
        ) : (
          agrupar(conversas).map((g) => (
            <div key={g.rotulo}>
              <div className="px-2 pt-3 pb-1 text-group text-ink-4 uppercase">{g.rotulo}</div>
              {g.itens.map((c) => (
                <div key={c.id} className={cx("group flex items-start gap-1 rounded-[8px]", conversa?.id === c.id && "bg-sunken")}>
                  <button
                    type="button"
                    onClick={() => void abrir(c.id)}
                    // Passar por cima já a vai buscar: o clique encontra-a quase sempre pronta.
                    onPointerEnter={() => preCarregar(c.id)}
                    onFocus={() => preCarregar(c.id)}
                    className="min-w-0 flex-1 px-2.5 py-2 text-left"
                  >
                    <div className="truncate text-body font-medium text-ink">{c.title}</div>
                    <div className="text-meta text-ink-3">{c.pendentes > 0 ? `${c.pendentes} por confirmar` : horaCurta(c.updatedAt)}</div>
                  </button>
                  <button type="button" onClick={() => apagar(c)} aria-label="Apagar conversa" className="ctl-ghost mt-1 size-8 shrink-0 justify-center px-0 opacity-0 group-hover:opacity-100 focus:opacity-100 max-md:opacity-100">
                    <Trash2 className="size-4" strokeWidth={1.75} />
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </aside>
  );

  return (
    /*
     * A página enche o `<main>` e rola por dentro, como uma app de chat: a
     * lista à esquerda e a conversa ao meio têm cada uma o seu scroll, e a caixa
     * de falar fica sempre em baixo. `absolute inset-0` contra o `<main>`
     * (que é `relative`), por cima da moldura de padding de todas as outras
     * páginas, que aqui só afastava os painéis das bordas.
     */
    <div className="absolute inset-0 flex min-h-0 flex-col bg-canvas md:flex-row">
      {!mobile && lista}

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {vazia ? (
          /*
           * O ecrã vazio: tudo ao centro, como se começa uma conversa num chat.
           * O emblema do clube, a saudação com o nome, a caixa de escrever, e
           * as sugestões desta pessoa em cartões por baixo. A caixa só desce
           * para o fundo quando a conversa começa.
           */
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {mobile && (
                <div className="flex justify-end px-3 pt-3">
                  <button type="button" onClick={() => setListaAberta(true)} className="ctl-outline h-9">
                    Conversas{conversas.length ? ` · ${conversas.length}` : ""}
                  </button>
                </div>
              )}
              <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col items-center justify-center px-4 py-10 md:px-6">
                <div className="mb-8 flex flex-col items-center text-center">
                  <ClubMark size={56} radius={14} />
                  <h1 className="mt-5 text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink">
                    {saudacao()}, {primeiroNome(session.name)}
                  </h1>
                  <p className="mt-2 max-w-[460px] text-body text-ink-3">
                    Sou o {NOME_DO_ADJUNTO}. Diz o que aconteceu no treino, pergunta o que precisas, ou larga aqui um Excel de atletas.
                  </p>
                  {semChave && (
                    <p className="mt-3 rounded-full bg-warn-soft px-3 py-1 text-meta text-warn">Desenvolvimento: falta a OPENAI_API_KEY na API, por isso não vai responder.</p>
                  )}
                </div>
                <SugestoesEmCartoes sugestoes={sugestoes} contexto={contexto} />
              </div>
            </div>
            <div className="shrink-0 pt-2">
              <Compositor contexto={contexto} autoFocus={!mobile} />
            </div>
          </>
        ) : (
          <>
            <header className="flex h-[56px] shrink-0 items-center gap-2.5 border-b border-line bg-surface px-4 md:px-6">
              <span className="inline-flex size-7 items-center justify-center rounded-[8px] bg-signal-strong text-signal-on">
                <Bot className="size-4" strokeWidth={2} />
              </span>
              <h1 className="min-w-0 flex-1 truncate text-body font-semibold text-ink">{conversa?.title ?? NOME_DO_ADJUNTO}</h1>
              {mobile && (
                <button type="button" onClick={() => setListaAberta(true)} className="ctl-outline h-9">
                  Conversas{conversas.length ? ` · ${conversas.length}` : ""}
                </button>
              )}
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Conversa contexto={contexto} />
            </div>
            <div className="shrink-0 pt-2">
              <Compositor contexto={contexto} sugestoes={sugestoes} autoFocus={!mobile} />
            </div>
          </>
        )}
      </section>

      {mobile && listaAberta && (
        <div className="fixed inset-0 z-50 flex flex-col bg-surface">
          <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-line px-3">
            <span className="text-body font-semibold text-ink">Conversas</span>
            <button type="button" onClick={() => setListaAberta(false)} className="ctl-ghost h-9">Fechar</button>
          </header>
          <div className="min-h-0 flex-1">{lista}</div>
        </div>
      )}
      {aApagar && (
        <ConfirmDialog
          title="Apagar a conversa?"
          onClose={() => setAApagar(null)}
          onConfirm={async () => {
            // Um erro fica no próprio diálogo (ver `ConfirmDialog`); só fecha quando apagou.
            await apagarConversa(aApagar.id);
            setAApagar(null);
          }}
        >
          <p>
            A conversa <span className="font-medium text-ink">"{aApagar.title}"</span> sai do histórico e não se recupera.
          </p>
          <p>O que já foi confirmado nos cartões (presenças, eventos, comunicados) continua gravado.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function agrupar(conversas: ResumoDeConversa[]): { rotulo: string; itens: ResumoDeConversa[] }[] {
  const hoje = new Date();
  const dia = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const ontem = new Date(hoje.getTime() - 86_400_000);
  const grupos = new Map<string, ResumoDeConversa[]>();
  for (const c of conversas) {
    const d = new Date(c.updatedAt);
    const rotulo = dia(d) === dia(hoje) ? "Hoje" : dia(d) === dia(ontem) ? "Ontem" : hoje.getTime() - d.getTime() < 7 * 86_400_000 ? "Esta semana" : "Antes";
    grupos.set(rotulo, [...(grupos.get(rotulo) ?? []), c]);
  }
  return ["Hoje", "Ontem", "Esta semana", "Antes"].filter((r) => grupos.has(r)).map((r) => ({ rotulo: r, itens: grupos.get(r)! }));
}

function horaCurta(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
