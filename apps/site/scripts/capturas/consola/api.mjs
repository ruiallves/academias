/**
 * A API simulada.
 *
 * Recebe o método, o caminho e a query de um pedido que a consola fez, e devolve
 * o que a API verdadeira devolveria para o CD Academias à hora da cena. Não há
 * servidor nenhum: isto é chamado de dentro do `page.route` do Playwright.
 *
 * O que não estiver aqui responde 404 e fica no registo dos não simulados, que é
 * como se descobre o que falta a uma página nova.
 */

import { criarTecnica } from "./tecnica.mjs";
import { criarDesenvolvimento } from "./desenvolvimento.mjs";
import { criarOutros } from "./outros.mjs";
import { criarGestao } from "./gestao.mjs";

const ok = (json) => ({ status: 200, json });

export function criarApi(clube, extras = {}) {
  const { bootstrap, equipas, atletas, staff, sessoes, cobrancas } = clube;

  const tecnica = criarTecnica(clube);
  const desenvolvimento = criarDesenvolvimento(clube);
  const outros = criarOutros(clube);
  const gestao = criarGestao(clube);

  /** As rotas exatas. O valor é o corpo, ou uma função da query. */
  const GET = {
    "/api/bootstrap": bootstrap,
    "/api/teams": equipas,
    "/api/athletes": atletas,
    "/api/staff": staff,
    "/api/sessions": sessoes,
    "/api/charges": cobrancas,
    "/api/matches": clube.listaDeJogos ?? [],
    "/api/roles": clube.cargos ?? [],
    "/api/departments": clube.departamentos ?? [],
    "/api/members/tiers": clube.categorias ?? [],
    "/api/invites": [],
    "/api/polls": clube.sondagens ?? [],
    "/api/events": clube.eventos ?? [],
    "/api/announcements": clube.avisos ?? [],
    "/api/calendar": (q) => {
      const de = new Date(q.get("from") ?? 0).getTime();
      const ate = new Date(q.get("to") ?? 8.64e15).getTime();
      const dentro = (x) => new Date(x.startsAt).getTime() >= de && new Date(x.startsAt).getTime() <= ate;
      return {
        sessions: sessoes.filter(dentro),
        matches: (clube.listaDeJogos ?? []).filter(dentro),
        events: (clube.eventos ?? []).filter(dentro),
      };
    },
    "/api/legal/status": { audiences: ["STAFF"], canBindClub: false, needsAuthority: false, pending: [], accepted: [], isUpdate: false },
    "/api/notifications": clube.notificacoes ?? [],
    "/api/app/contexts": { contexts: [{ type: "STAFF" }] },
    "/api/catalogs": clube.catalogos ?? [],
    "/api/subscricao/ordem": { pendente: null, assinada: null, avisos: [], podeAssinar: false, sugestao: null },
    "/api/matches/equipa-tecnica": staff
      .filter((s) => ["TECHNICAL", "CLINICAL", "OPERATIONS"].includes(s.department))
      .map((s) => ({ membershipId: s.id, name: s.name, role: s.title })),
    "/api/matches/adversarios": [],
    ...tecnica.GET,
    ...desenvolvimento.GET,
    ...outros.GET,
    ...gestao.GET,
    ...(extras.GET ?? {}),
  };

  /** As rotas com parâmetros: [expressão, função(match, query)]. */
  const PADROES = [
    ...tecnica.PADROES,
    ...desenvolvimento.PADROES,
    [/^\/api\/matches\/([^/]+)$/, (m) => clube.detalheDoJogo?.(m[1])],
    // Quem pode subir de escalão para este jogo: três sub-11 mais velhos.
    [/^\/api\/matches\/([^/]+)\/convidados-elegiveis$/, () =>
      atletas.filter((a) => a.teamId === "t-sub11").slice(0, 3).map((a) => ({
        id: a.id, name: a.name, squadNumber: a.squadNumber, position: a.position, teamId: a.teamId, teamName: "Sub-11", blocked: false,
      }))],
    [/^\/api\/matches\/([^/]+)\/forma$/, () => ({ matches: 0, athletes: [] })],
    [/^\/api\/matches\/([^/]+)\/convocatoria\/respostas$/, (m) => {
      const jg = clube.jogos.find((x) => x.id === m[1]);
      return jg && {
        matchId: jg.id, submitted: jg.submitted, confirmationRequired: jg.confirmationRequired,
        rows: jg.calledUp.map((c) => ({ athleteId: c.athleteId, status: c.status, declineReason: c.declineReason, respondedAt: c.respondedAt })),
      };
    }],
    ...(extras.PADROES ?? []),
  ];

  return function responder(metodo, caminho, query) {
    if (metodo === "GET") {
      if (caminho in GET) {
        const v = GET[caminho];
        return ok(typeof v === "function" ? v(query) : v);
      }
      for (const [re, f] of PADROES) {
        const m = caminho.match(re);
        if (m) {
          const v = f(m, query);
          if (v !== undefined) return ok(v);
        }
      }
      return null;
    }
    // Escritas de fundo que a consola faz sozinha.
    if (metodo === "POST" && caminho === "/api/presence") return ok({ ok: true });
    if (metodo === "PATCH" && caminho === "/api/notifications/read") return ok({ ok: true });
    return null;
  };
}
