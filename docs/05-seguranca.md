# Auditoria de segurança

Auditoria adversarial a 17 de agosto de 2026, com exploits executados contra a API
a correr. Este documento é o registo do que foi encontrado, do que foi corrigido, e
do que ficou em aberto por decisão consciente.

**Regressão:** `npm run test:security` (31 casos) codifica cada achado e cada
fronteira que resistiu. Uma falha aí é uma regressão de segurança e deve travar o
CI.

---

## Corrigido

| ID | Severidade | O quê | Correção |
|---|---|---|---|
| VULN-001 | **Critical** | Webhook de pagamento forjável — `EUPAGO_WEBHOOK_SECRET` vazio deixava assinar com segredo público | Segredo forte (32 bytes); `verifySignature` recusa segredo < 16 chars; `EupagoClient.onModuleInit` recusa arrancar sem ele em produção |
| VULN-002 | **High** | Diagnóstico clínico (RGPD Art. 9) exposto a STAFF sem `clinical:read` via `/api/athletes` | `restriction.title` só quando `can(ctx, "clinical:read")`; a disponibilidade (`clinical:status`) continua a chegar a todos |
| VULN-003 | **High** | Sem rate-limiting — password oracle no resgate de convite, força bruta, DoS de webhooks | `@nestjs/throttler` global (120/min); resgate de convite apertado a 5/min |
| VULN-004 | **High** | XSS armazenado na página de convite — email com `</script>` quebrava o bloco de script | Regex de email restrito a caracteres reais; `jsonForScript` escapa `< > &` para `\uXXXX` (defesa em profundidade) |
| VULN-005 | High/Med | Bodies sem DTO — a `ValidationPipe` não filtrava mass-assignment | Classes DTO com `class-validator` em convites, convocatórias e criação de academia |
| VULN-006 | Medium | Sem cabeçalhos de segurança | `helmet()` (nosniff, frameguard, HSTS, referrer). CSP com nonce fica para depois — a API serve HTML com script inline |
| VULN-008 | Medium | IP de auditoria spoofável atrás de proxy | `trust proxy = 1` — confia só no primeiro salto |
| VULN-010 | Medium | Webhook sem verificação de valor pago | `confirmPayment` compara `paidCents` com o esperado; divergência marca FAILED |
| VULN-012 | Low | Stack traces no `WebhookEvent.error` | Só a mensagem, truncada a 500 chars |
| VULN-015 | Low | Slugs reservados (`admin`, `api`) registáveis como academia | Lista de reservados recusada em `createAcademy` |

---

## Fronteiras que resistiram (e têm de continuar a resistir)

Testadas com uma academia atacante real. Cada uma é um caso em `test-security.mjs`:

- **Isolamento entre academias.** Um DIRECTOR de outra academia a passar
  `x-academy-slug: life-club` leva 403 em todos os endpoints. IDOR com IDs
  conhecidos → 404. A RLS do Postgres + o `contextFor` (que verifica membership,
  não confia no header) + `findFirst` com filtro de âmbito seguram isto.
- **Platform Admin.** Uma academia não entra em `/api/platform/*` (403). Um
  platform admin não entra numa consola de academia (403). A separação é verificada
  nos dois sentidos.
- **RBAC.** Coach não convida staff, não vê mensalidades, não muda configuração de
  equipa. Verificado no servidor, não escondido no frontend.
- **Escalada por convite.** Não se convida acima do próprio nível (RANK server-side).
- **Pagamento.** Não existe endpoint que marque como pago; só o webhook, agora
  fechado. O browser nunca decide.
- **Segredos no frontend.** Só a anon key (pública por desenho). `service_role`,
  `JWT_SECRET`, `WEBHOOK_SECRET`, `EUPAGO_API_KEY` não aparecem em nenhum bundle.
- **`.env`** fora do git.

---

## Em aberto — por decisão, não por esquecimento

| ID | O quê | Porquê fica, e o que falta |
|---|---|---|
| VULN-007 | Token em `sessionStorage` (não `httpOnly` cookie) | Trade-off real: a entrega de sessão landing→consola precisa que o JS leia o token. Com o XSS fechado (VULN-004), o vetor principal de roubo desapareceu. Migrar para cookie `httpOnly` exige repensar a entrega — trabalho à parte |
| VULN-009 | MFA na impersonation "ver como academia" | A funcionalidade **não está implementada**. O campo `mfaEnrolledAt` existe mas não é verificado porque não há nada para proteger ainda. Implementa-se com a feature — ver `04-plataforma.md` |
| VULN-011 | Enumeração de emails via `hasAccount` na página de convite | Mitigado pelo rate-limit (VULN-003) e por exigir um token de convite válido (32 bytes) para chegar lá. O campo é necessário ao fluxo (pedir password nova vs. existente) |
| CSP | Content-Security-Policy estrita | A API serve HTML (landing, convite) com `<script>` inline gerado no servidor. Uma CSP com `nonce` por resposta fecha isto por completo; é endurecimento, não correção de um exploit aberto |

---

## Configuração obrigatória para produção

1. **`EUPAGO_WEBHOOK_SECRET`** — o valor real da euPago, não o de desenvolvimento.
   O servidor recusa arrancar sem ele quando `EUPAGO_API_KEY` está definida.
2. **`NODE_ENV=production`** — activa a recusa de arranque com segredo fraco.
3. **`CONSOLE_ORIGIN`, `FAMILY_ORIGIN`, `PLATFORM_ORIGIN`** — as três origens reais;
   sem elas, o CORS cai nos `localhost` de desenvolvimento.
4. **Papel `platform_app` sem BYPASSRLS** — ver dívida em `04-plataforma.md`.

---

# Segunda auditoria adversarial — 21 de setembro de 2026

Auditoria completa, do princípio. O isolamento entre academias, o modelo de
permissões, a assinatura do webhook euPago e as verificações de prefixo do
armazenamento foram sondados a fundo e **resistiram** — a camada de base de dados
provou-se contra Postgres a sério (PGlite), com tentativas activas de leitura e
escrita cruzadas. Os achados novos vivem quase todos acima da base: distribuição
de cargos, apagamento de ficheiros e uma fuga de estado entre famílias.

**Regressão nova:** `npm run test:rls-cobertura` (80 asserções — toda a tabela de
tenant tem RLS+FORCE+política, ou é inacessível à ligação da academia; o histórico
é só-escrita; e A não toca em B) e `npm run test:escalada` (a decisão de não
conceder o que não se tem, validada ao contrário). O `test:rls` de sempre foi
**reparado** — a migração `periodizacao` (btree_gist) partia-o no PGlite desde 19
de setembro, e a rede de isolamento estava a correr a vermelho sem ninguém ver. Um
workflow de CI (`.github/workflows/ci.yml`) corre esta rede em cada push.

## Corrigido

| ID | Severidade | O quê | Correção |
|---|---|---|---|
| VULN-016 | **Alta** | Escalada por cargo — `roles.assign` e `invites.create` só verificavam a **patente** do cargo, nunca as permissões dele. Quem tinha `access:write`/`staff:write` mas não `role:write` podia atribuir (ou convidar para) um cargo de patente igual à sua que carregasse `role:write`, `academy:delete` ou uma permissão retirada por pessoa, e escalar por um testa de ferro. `setAccess`/`filterGrantable` já barravam isto; a distribuição de cargos já criados não. | `ungrantablePermissions(ctx, perms)` em `common/permissions.ts` — nega o cargo se carregar uma permissão que quem o dá não tem. Aplicada ao principal e aos secundários, em `assign` e em `invite`. |
| VULN-017 | **Alta** | Direito ao apagamento — apagar um clube deixava **vídeos e recortes de menores** da Academias AI (bucket `ai-videos`, `{academyId}/…`) órfãos no armazenamento para sempre. | `deleteAcademy` varre o prefixo `ai-videos/{academyId}` (novo `StorageService.removePrefix`, melhor-esforço). |
| VULN-018 | Média | Direito ao apagamento — as fotografias dos **sócios** (`socios/{memberId}`) e o **símbolo do clube** (`clube-publico`) também ficavam órfãos; o cabeçalho do método prometia apagar o símbolo e não o fazia. | `deleteAcademy` recolhe `Member.photoKey` e apaga o símbolo pela chave lida do `logoUrl`. |
| VULN-019 | Média | Fuga entre famílias — o bloco `absences` de `sessionsIn` devolvia a **falta e o estado** (faltou/lesão/atraso) de qualquer atleta do escalão a qualquer família dele; só mascarava o motivo. O estado é dado pessoal de um menor de outra família. | Filtro `meus` no bloco `absences`, igual ao que o bloco `notices` já fazia. O staff (âmbito nulo) continua a ver a folha inteira. |
| VULN-020 | Baixa | `/auth/me` calculava as permissões do `ROLE_PERMISSIONS[papel]` do enum, ignorando o cargo à medida e as retiradas por pessoa. Não era fronteira (o `can()` do servidor decide), mas a consola construía menus a partir daqui e mostrava portas que o servidor depois recusava. | Passa a medir por `can(ctx, p)` sobre o universo de permissões — honra `rolePermissions`, `grants` e `revokes`. |
| VULN-021 | Baixa | `contacts.ics` não escapava um `\r` sozinho — injeção de linha/propriedade num ICS a partir de campos do CRM (que nascem do formulário público do site). | `escape` trata `\r\n`, `\r` e `\n`. |

## Fronteiras que resistiram (provadas, não lidas)

- **Isolamento entre academias.** Toda a tabela com `academyId` tem RLS + `FORCE` +
  política, confirmado pelo catálogo do Postgres em `test:rls-cobertura`. As três
  tabelas de plataforma sem RLS (`Contact`, `Subscription`, `SupportSession`) têm
  os privilégios de `academia_app` **retirados** — a ligação da academia nem as
  toca. As funções `SECURITY DEFINER` fixam `search_path` e devolvem só ids.
- **Escalada de hierarquia.** `outranks` mede quem age pelo papel-base e o alvo pelo
  cargo **mais alto** (secundário incluído): um director não despromove, não apaga,
  não desactiva nem retira acesso a quem tem um cargo acima. `test:escalada` cobre-o.
- **Webhook euPago.** Assinatura HMAC em tempo constante, arranque recusado sem
  segredo forte, valor comparado com a base. O tenant vem sempre do pagamento, nunca
  do pedido — não se liquida a academia de outro.
- **Armazenamento.** Prefixo verificado **e** âmbito verificado em cada set/remove;
  os caminhos "próprio" tiram o id da sessão, não do cliente. Buckets privados, menos
  o símbolo do clube, por desenho.
- **Auditoria só-escrita.** `academia_app` não tem UPDATE/DELETE em `ProfileChange`
  nem em `LegalAcceptance`, e só INSERT em `AuditLog`. Confirmado no catálogo.

## Em aberto — por decisão ou por precisar de contexto do produto

| ID | O quê | Porquê fica |
|---|---|---|
| VULN-022 | Webhook `PAID` sem `amount` não verifica valor | O guard de valor só corre quando o `amount` vem no evento; um `PAID` sem `amount` liquida sem comparar. Fechá-lo (recusar em vez de liquidar) toca no caminho do dinheiro e depende das garantias reais do payload da euPago — decisão a tomar com essa informação, não às cegas. |
| VULN-023 | CSP nas páginas SSR | Sem Content-Security-Policy na landing, convite e reposição de palavra-passe. Não há injeção aberta (o escape de contexto está fechado), mas uma CSP com `nonce` por resposta é a rede que falta. Já estava anotada como endurecimento futuro. |
| VULN-024 | CORS reflecte qualquer `*.academias.pt` com `credentials` | Inofensivo hoje (não há cookies de sessão; a sessão é `Bearer` em `localStorage` por origem), mas perigoso no dia em que entrar o cookie `httpOnly` (VULN-007). Estreitar antes disso. |
| VULN-025 | FKs do cliente sem verificação de tenant | `createTransaction` e afins gravam `athleteId`/`memberId`/… do DTO sem confirmar que são da academia. A RLS impede a fuga (a leitura cruzada volta nula, a escrita no pai alheio é recusada), mas fica um risco de referência pendente. Validar o id com um `findFirst` no âmbito remove o pé-de-cabra. |
| — | `test-security.mjs` desactualizado | O caso do webhook usa o formato antigo (`transacao/estado`), o header `x-eupago-signature` em hex e não o `x-signature` em base64 de agora. Precisa de ser reescrito para o formato 2.0 antes de voltar a valer como regressão. |
