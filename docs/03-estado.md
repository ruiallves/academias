# Estado da implementação

Resumo do que existe, a 16 de agosto de 2026. Para o *porquê* de cada decisão, ver
[00-produto](00-produto.md), [01-design](01-design.md) e [02-arquitetura](02-arquitetura.md).

---

## Fundação

| | |
|---|---|
| Monorepo | npm workspaces: `apps/console`, `apps/family`, `apps/api`, `packages/ui` |
| Sistema de design | tokens partilhados, Tailwind v4 em CSS, Instrument Sans + Geist Mono |
| Permissões | 26 permissões, 8 papéis, âmbito por equipa/atleta — cliente e servidor |
| Dados de demonstração | 116 atletas, 8 equipas, 17 pessoas de staff, 3 modalidades, época inteira |

**Permissões como dados.** Nada pergunta `if (role === "coach")`. A navegação, as
colunas das tabelas e os botões são todos derivados de `can(session, permissão)` —
um item sem permissão não aparece, nem sequer desactivado.

**Multi-desporto no modelo.** Posições, competências, lado dominante e duração de
jogo são configuração da modalidade. A natação não tem posições nem jogos, e a UI
adapta-se por ausência — sem um `if (desporto === …)` em lado nenhum.

---

## Consola — Direção

| Ecrã | O que faz |
|---|---|
| **Visão geral** | "Precisa de atenção" (lista accionável) antes das métricas · faixa da semana · cobrança por escalão |
| **Atletas** | lista filtrável, criação, filtros por ficha médica e baixa clínica |
| **Ficha do atleta** | 5 separadores: visão geral, jogos, assiduidade, clínico, encarregado |
| **Famílias** | encarregados, contactos, **quem já instalou a app** |
| **Equipas** | grelha de cartões + ficha por equipa com 6 separadores |
| **Staff** | direção, equipa técnica, departamento clínico, operações — cargo *e* acesso |
| **Calendário** | agenda + grelha de mês, cor por escalão, criar eventos, detalhe de jogo |
| **Presenças** | registo por treino, marcando **faltas** e não presenças |
| **Mensalidades** | por período ou todos, dívida real de sempre (não só do mês) |
| **Comunicação** | avisos com taxa de leitura |
| **Avaliações** | por competência, rascunho vs publicada |
| **Relatórios** | cobertura por equipa (Fase 4 por construir) |
| **Definições** | white-label ao vivo, catálogos, matriz de permissões, importação ZeroZero |

## Consola — Equipa técnica

Visão geral (próximo treino) · Equipas · Atletas · Calendário · Treinos ·
Clínico · Avaliações · Relatórios — **tudo limitado às suas equipas**, aplicado na
fronteira de dados e não em cada ecrã.

## Consola — Departamento clínico

Visão geral (quem está parado, reavaliações da semana, exames expirados) ·
Boletins · Consultas · Atletas · Equipas · Calendário. Vê a academia toda: uma
lesão não conhece escalões.

---

## Peças que atravessam o produto

**Disponibilidade clínica.** Não é um campo — é derivada do boletim. Enquanto
existir uma baixa sem alta, o atleta aparece marcado na ficha, na lista, no
plantel e em "Precisa de atenção"; **não pode ser convocado** (os controlos
desaparecem) e **não conta como falta** no registo de presenças.

**Quem lê o quê.** `clinical:status` (estado e retoma) chega a toda a gente;
`clinical:read` (diagnóstico e notas) chega à direção, equipa técnica e família;
`clinical:write` é só do departamento clínico, para a origem de um diagnóstico ser
sempre rastreável.

**Presenças como faltas.** Guarda-se a excepção, não a norma. Um treino com lista
vazia significa "estiveram todos" — e é diferente de "ninguém verificou", que
aparece como lacuna e não infla a assiduidade.

---

## App das famílias (PWA)

| | |
|---|---|
| **Hoje** | mensalidade em falta primeiro · próximo treino · alterações · próxima consulta |
| **Agenda** | treinos por dia + consultas e exames agendados |
| **Pagamentos** | MB Way, Multibanco, cartão · estado "a confirmar" honesto · histórico |
| **Atleta** | assiduidade, avaliação do treinador, inscrição, notificações |

**Só corre instalada.** Fora do modo `standalone` a app recusa-se a renderizar e
manda instalar. É uma porta, não um cadeado — o controlo a sério é a autenticação
no servidor.

**Notificações push** funcionam de ponta a ponta: VAPID, subscrição, service
worker, e envio a partir do servidor.

---

## Landing da academia

`GET /l/:slug` — HTML gerado no servidor (o preview do WhatsApp não corre
JavaScript, e sem OG tags o link não vale nada). Só instalar: sem link para abrir
no browser. Instruções por plataforma, detectadas pelo User-Agent, incluindo o
aviso para sair do navegador embutido do WhatsApp. Link discreto para a consola no
rodapé, para treinadores e direção.

---

## Backend

Esquema Prisma completo (multi-tenant com RLS, multi-desporto, RBAC com âmbito,
pagamentos, notificações, avaliações). Módulos NestJS: fluxo euPago com webhook
idempotente e assinado, notificações com canais como adaptadores, landing SSR.

**O pagamento só muda de estado pelo webhook.** Não existe endpoint que marque
algo como pago; o navegador nunca decide.

---

## Por fazer

| | |
|---|---|
| Autenticação Supabase | por ligar — hoje o perfil troca-se na barra lateral |
| API ligada às apps | as apps correm com dados de demonstração; a fronteira é `lib/api.ts` |
| Landing B2B | a página de marketing para angariar academias |
| Relatórios (Fase 4) | o que a família recebe no fim do período |
| Analítica (Fase 5) | receita, retenção, actividade |
| Nota do jogo | o campo existe e é mostrado; **a fórmula está por decidir** |
| ZeroZero | fluxo completo, mas com dados **simulados** — falta resolver licenciamento |
| Push em produção | chaves VAPID de desenvolvimento e subscrições em memória |

## Dívida conhecida

- O horário definido ao criar uma equipa **não gera treinos** no calendário; fica
  guardado e visível, mas a geração de sessões recorrentes está por fazer.
- Estado mutável do frontend vive em quatro pequenos armazéns
  (`roster`, `attendance`, `calendar`, `clinical`) fundidos em `lib/api.ts`.
  Desaparecem todos quando a API entrar.
