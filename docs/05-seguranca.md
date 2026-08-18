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
