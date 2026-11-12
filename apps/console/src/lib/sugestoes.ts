import { matches, sessions, teams } from "@/lib/store";
import type { Contexto } from "@/lib/adjunto";
import type { Sugestao } from "@/components/adjunto/Compositor";

/**
 * O que o Adjunto sugere em cada página.
 *
 * ## Duas coisas de uma vez
 *
 * `contextoDaRota` diz ao servidor onde a pessoa está (que treino, que jogo,
 * que equipa), para o modelo não ter de perguntar. `sugestoesPara` dá as
 * frases prontas por cima da caixa: carregar numa envia-a já com a ação
 * decidida, sem passar pelo classificador.
 *
 * Tudo derivado do que o `store` já tem carregado: nenhuma destas funções vai
 * ao servidor.
 */

export function contextoDaRota(pathname: string): Contexto {
  const ctx: Contexto = { rota: pathname };
  let m: RegExpExecArray | null;
  if ((m = /^\/treinos\/([^/]+)/.exec(pathname))) {
    const s = sessions.find((x) => x.id === m![1]);
    ctx.sessionId = m[1];
    if (s) ctx.teamId = s.teamId;
  } else if ((m = /^\/jogos\/([^/]+)/.exec(pathname)) && m[1] !== "adversarios") {
    const j = matches.find((x) => x.id === m![1]);
    ctx.matchId = m[1];
    if (j) ctx.teamId = j.teamId;
  } else if ((m = /^\/equipas\/([^/]+)/.exec(pathname))) {
    ctx.teamId = m[1];
  } else if ((m = /^\/atletas\/([^/]+)/.exec(pathname))) {
    ctx.athleteId = m[1];
  }
  return ctx;
}

const DIA_MS = 86_400_000;

function hoje(iso: string): boolean {
  const d = new Date(iso);
  const h = new Date();
  return d.getFullYear() === h.getFullYear() && d.getMonth() === h.getMonth() && d.getDate() === h.getDate();
}

function quando(iso: string): string {
  const d = new Date(iso);
  if (hoje(iso)) return `hoje às ${d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleString("pt-PT", { weekday: "short", day: "numeric", month: "short" }).replace(".", "");
}

export function sugestoesPara(pathname: string, opcoes: { minimo?: number } = {}): Sugestao[] {
  const minimo = opcoes.minimo ?? 3;
  const ctx = contextoDaRota(pathname);
  const agora = Date.now();
  const saida: Sugestao[] = [];

  if (ctx.sessionId) {
    const s = sessions.find((x) => x.id === ctx.sessionId);
    if (s && s.status !== "cancelled") {
      saida.push({ texto: s.attendance ? "Corrigir as presenças deste treino" : "Marcar as presenças deste treino", acao: "presencas" });
      saida.push({ texto: "Registar uma lesão neste treino", acao: "lesao" });
      // O plano com exercícios e desenhos: só faz sentido antes de o treino acontecer.
      if (new Date(s.start).getTime() > agora) saida.push({ texto: "Montar o plano deste treino com exercícios" });
    }
  }
  if (ctx.matchId) {
    const j = matches.find((x) => x.id === ctx.matchId);
    if (j) {
      saida.push({ texto: j.submitted ? "Quem já respondeu à convocatória?" : "Convocar os mesmos do último jogo", acao: j.submitted ? "pergunta_simples" : "convocatoria_simples" });
      saida.push({ texto: "Quem está indisponível para este jogo?", acao: "pergunta_simples" });
    }
  }
  if (ctx.teamId && !ctx.sessionId && !ctx.matchId) {
    saida.push({ texto: "Quem faltou mais aos treinos este mês?", acao: "pergunta_cruzada" });
    saida.push({ texto: "Quem está indisponível nesta equipa?", acao: "pergunta_simples" });
  }

  // O treino de hoje por fechar, de uma equipa minha: o pedido mais comum do dia.
  const treinoDeHoje = sessions
    .filter((s) => s.mine && s.status !== "cancelled" && !s.attendance && hoje(s.start) && new Date(s.start).getTime() < agora + 2 * 3_600_000)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  if (treinoDeHoje && treinoDeHoje.id !== ctx.sessionId) {
    saida.push({ texto: `Marcar as presenças do ${treinoDeHoje.teamName ?? "treino"} de ${quando(treinoDeHoje.start)}`, acao: "presencas" });
  }

  // O próximo jogo sem convocatória submetida, nos próximos 7 dias.
  const proximoJogo = matches
    .filter((j) => !j.submitted && new Date(j.startsAt).getTime() > agora && new Date(j.startsAt).getTime() < agora + 7 * DIA_MS)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  if (proximoJogo && proximoJogo.id !== ctx.matchId) {
    saida.push({ texto: `Convocar o ${proximoJogo.teamName} para ${quando(proximoJogo.startsAt)} vs ${proximoJogo.opponent}`, acao: "convocatoria_simples" });
  }

  if (saida.length < minimo) saida.push({ texto: "Quem está indisponível neste momento?", acao: "pergunta_simples" });
  if (saida.length < minimo && teams.length > 0) saida.push({ texto: "Quando é o próximo jogo?", acao: "pergunta_simples" });
  if (saida.length < minimo) saida.push({ texto: "Quem faltou mais aos treinos este mês?", acao: "pergunta_cruzada" });
  if ((pathname.startsWith("/atletas") || pathname === "/assistente") && saida.length < 4) saida.push({ texto: "Importar um Excel de atletas" });

  // Sem repetidas, e poucas: três ou quatro chegam para uma linha.
  const vistas = new Set<string>();
  return saida.filter((s) => (vistas.has(s.texto) ? false : (vistas.add(s.texto), true))).slice(0, 4);
}
