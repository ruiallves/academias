import { cx } from "./primitives";

/**
 * As três caras do produto, reconstruídas.
 *
 * Feitas a partir do produto real, ecrã a ecrã: os mesmos grupos de navegação, os
 * mesmos alertas com acção à direita, a mesma faixa da semana, o mesmo cartão de
 * sócio. Usam os tokens da consola — neutros quentes, verde de campo, filetes de
 * 1px — e não uma paleta inventada para o site.
 *
 * Continuam a ceder o lugar a capturas verdadeiras se existirem em `public/shots/`.
 */

/* -------------------------------------------------------------------------- */
/* A consola                                                                   */
/* -------------------------------------------------------------------------- */

const NAV_GROUPS: { label?: string; items: { t: string; on?: boolean; badge?: number }[] }[] = [
  { items: [{ t: "Visão geral", on: true }] },
  { label: "Pessoas", items: [{ t: "Atletas" }, { t: "Famílias" }, { t: "Equipas" }, { t: "Staff" }, { t: "Sócios" }] },
  { label: "Clínico", items: [{ t: "Boletins" }, { t: "Consultas" }] },
  { label: "Scouting", items: [{ t: "Prospects" }, { t: "Observações" }, { t: "Pedidos" }] },
  { label: "Operação", items: [{ t: "Calendário" }, { t: "Presenças", badge: 2 }, { t: "Convocatórias", badge: 2 }] },
  { label: "Gestão", items: [{ t: "Mensalidades", badge: 2 }, { t: "Comunicação" }] },
];

const ATENCAO = [
  { t: "2 mensalidades vencidas", d: "80 € por cobrar, de 2 famílias", a: "Cobrar", tone: "risk" },
  { t: "2 treinos sem treinador", d: "O mais próximo é em 5 dias, Sub-11", a: "Atribuir", tone: "risk" },
  { t: "2 treinos sem presenças registadas", d: "Sem registo, a assiduidade fica incompleta", a: "Registar", tone: "warn" },
  { t: "1 ficha médica a expirar", d: "Dentro dos próximos 30 dias", a: "Ver", tone: "warn" },
  { t: "2 famílias ainda sem a app", d: "Continuam a depender do WhatsApp", a: "Convidar", tone: "warn" },
] as const;

const SEMANA = [
  { d: "Seg", n: 24, ev: [{ h: "18:00", t: "Sub-11 Futebol" }], hoje: true },
  { d: "Ter", n: 25, ev: [{ h: "19:30", t: "Sub-13 Futebol" }] },
  { d: "Qua", n: 26, ev: [{ h: "18:00", t: "Sub-11 Futebol" }, { h: "19:00", t: "Sub-11 Futebol", off: true }] },
  { d: "Qui", n: 27, ev: [] },
  { d: "Sex", n: 28, ev: [{ h: "19:30", t: "Sub-13 Futebol" }] },
  { d: "Sáb", n: 29, ev: [{ h: "18:00", t: "Sub-11 Futebol", warn: true }] },
  { d: "Dom", n: 30, ev: [{ h: "18:30", t: "Sub-11 Futebol", warn: true }] },
];

export function ConsoleShot({ className }: { className?: string }) {
  return (
    <div className={cx("flex bg-[#f6f5f2] text-[11px] text-[#1a1917]", className)} aria-hidden>
      {/* Barra lateral */}
      <div className="hidden w-[150px] shrink-0 flex-col border-r border-[#e5e2dc] bg-white lg:flex">
        <div className="flex items-center gap-2 border-b border-[#e5e2dc] px-2.5 py-2">
          <span className="flex size-[18px] items-center justify-center rounded-[4px] bg-[#0f6b62] text-[7px] font-bold text-white">
            LC
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[9.5px] leading-tight font-semibold">Life Club</span>
            <span className="block truncate text-[7.5px] text-[#8a867c]">Época 2026/27</span>
          </span>
        </div>

        <div className="px-2 py-1.5">
          <div className="flex h-[18px] items-center gap-1.5 rounded-[3px] bg-[#efede8] px-2 text-[8px] text-[#ada89d]">
            <span className="size-1.5 rounded-full border border-current" />
            Procurar atleta…
          </div>
        </div>

        <div className="flex-1 px-1.5 pb-2">
          {NAV_GROUPS.map((g, gi) => (
            <div key={g.label ?? gi} className={gi > 0 ? "mt-2" : ""}>
              {g.label && (
                <div className="px-1.5 pb-0.5 text-[6.5px] font-semibold tracking-[0.12em] text-[#ada89d] uppercase">
                  {g.label}
                </div>
              )}
              {g.items.map((it) => (
                <div
                  key={it.t}
                  className={cx(
                    "flex h-[17px] items-center gap-1.5 rounded-[3px] px-1.5 text-[8.5px]",
                    it.on ? "bg-[#e7f0ee] font-medium text-[#0a4c45]" : "text-[#524f48]",
                  )}
                >
                  <span className={cx("size-1 rounded-[1px]", it.on ? "bg-[#0f6b62]" : "bg-[#d3cfc6]")} />
                  <span className="min-w-0 flex-1 truncate">{it.t}</span>
                  {it.badge && (
                    <span className="rounded-full bg-[#fae9e7] px-1 text-[6.5px] font-semibold text-[#a82a20]">
                      {it.badge}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5 border-t border-[#e5e2dc] px-2 py-1.5">
          <span className="flex size-[17px] items-center justify-center rounded-full bg-[#e7f0ee] text-[6.5px] font-bold text-[#0a4c45]">
            HP
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[8px] font-medium">Helena Sá Pereira</span>
            <span className="block truncate text-[7px] text-[#8a867c]">Direção</span>
          </span>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="min-w-0 flex-1 p-3 sm:p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[7.5px] font-semibold tracking-[0.12em] text-[#8a867c] uppercase">
              Academia Life Club
            </div>
            <div className="text-[16px] leading-tight font-semibold tracking-[-0.025em]">Boa tarde, Helena</div>
            <div className="text-[8.5px] text-[#8a867c]">Segunda-feira, 24 de agosto</div>
          </div>
          <div className="hidden shrink-0 gap-1.5 sm:flex">
            <span className="rounded-[3px] border border-[#e5e2dc] bg-white px-2 py-1 text-[8px] font-medium">
              Comunicar
            </span>
            <span className="rounded-[3px] bg-[#1a1917] px-2 py-1 text-[8px] font-medium text-white">+ Novo atleta</span>
          </div>
        </div>

        {/* Precisa de atenção — cada linha com a acção à direita */}
        <div className="mb-2 overflow-hidden rounded-[3px] border border-[#e5e2dc] bg-white">
          <div className="flex items-baseline gap-2 px-3 pt-2 pb-1.5">
            <span className="text-[10px] font-semibold">Precisa de atenção</span>
            <span className="text-[8px] text-[#8a867c]">5 assuntos</span>
          </div>
          {ATENCAO.map((a) => (
            <div key={a.t} className="flex items-center gap-2.5 px-3 py-[5px]">
              <span className={cx("h-6 w-[2px] shrink-0", a.tone === "risk" ? "bg-[#a82a20]" : "bg-[#9a5b08]")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[9px] font-medium">{a.t}</span>
                <span className="block truncate text-[8px] text-[#8a867c]">{a.d}</span>
              </span>
              <span className="hidden shrink-0 rounded-[3px] border border-[#e5e2dc] px-1.5 py-[3px] text-[7.5px] font-medium md:block">
                {a.a} →
              </span>
            </div>
          ))}
        </div>

        {/* Métricas */}
        <div className="mb-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {[
            ["Atletas activos", "8", "+1 este mês", ""],
            ["Cobrado em agosto", "240 €", "de 360 € facturado", "-33,3%"],
            ["Presença média", "47%", "últimos 30 dias", "0%"],
            ["Famílias com a app", "0%", "0 de 2 famílias", ""],
          ].map(([l, v, note, delta]) => (
            <div key={l} className="rounded-[3px] border border-[#e5e2dc] bg-white px-2 py-1.5">
              <div className="truncate text-[7.5px] text-[#8a867c]">{l}</div>
              <div className="mt-0.5 text-[17px] leading-none font-semibold tracking-[-0.03em] tabular">{v}</div>
              <div className="mt-1 flex items-center gap-1">
                {delta && (
                  <span className="rounded-full bg-[#fae9e7] px-1 text-[6.5px] font-semibold text-[#a82a20] tabular">
                    {delta}
                  </span>
                )}
                <span className="truncate text-[7px] text-[#ada89d]">{note}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Esta semana */}
        <div className="overflow-hidden rounded-[3px] border border-[#e5e2dc] bg-white">
          <div className="flex items-baseline gap-2 border-b border-[#e5e2dc] px-3 py-1.5">
            <span className="text-[10px] font-semibold">Esta semana</span>
            <span className="text-[8px] text-[#8a867c]">24–30 de agosto</span>
          </div>
          <div className="grid grid-cols-7">
            {SEMANA.map((d) => (
              <div key={d.d} className="min-h-[46px] border-r border-[#e5e2dc] px-1.5 py-1.5 last:border-r-0">
                <div className="mb-1 flex items-center gap-1">
                  <span className="text-[7.5px] font-medium">{d.d}</span>
                  <span className="text-[7.5px] text-[#8a867c] tabular">{d.n}</span>
                  {d.hoje && <span className="ml-auto size-1 rounded-full bg-[#0f6b62]" />}
                </div>
                {d.ev.length === 0 ? (
                  <span className="text-[7.5px] text-[#d3cfc6]">—</span>
                ) : (
                  d.ev.map((e, i) => (
                    <div
                      key={i}
                      className={cx(
                        "mb-1 rounded-[2px] border px-1 py-[3px] last:mb-0",
                        "warn" in e && e.warn
                          ? "border-[#f0d3cf] bg-[#fdf3f1]"
                          : "off" in e && e.off
                            ? "border-[#e5e2dc] bg-[#f6f5f2] opacity-60"
                            : "border-[#e5e2dc] bg-white",
                      )}
                    >
                      <span className="block text-[6.5px] font-mono text-[#8a867c]">{e.h}</span>
                      <span className="block truncate text-[7px] font-medium">{e.t}</span>
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* A página pública de adesão a sócio                                          */
/* -------------------------------------------------------------------------- */

const TIERS = [
  { n: "Sócio efectivo", a: "A partir dos 18 anos", p: "30 €", u: "/ano", b: ["Entrada nos jogos em casa", "Voto em assembleia"] },
  { n: "Sócio juvenil", a: "Até aos 17 anos", p: "12 €", u: "/ano", b: ["Entrada nos jogos", "Camisola de sócio"] },
  { n: "Sócio Clube +", a: "Dos 18 aos 99 anos", p: "20 €", u: "/mês", b: ["Descontos na loja", "Bilhetes antecipados"] },
  { n: "Sócio Gold", a: "", p: "50 €", u: "/mês", b: ["Camarote com lounge", "Camisola autografada"], on: true },
];

/**
 * A página de adesão a sócio — a montra pública do clube.
 *
 * É a peça que mais surpreende quem vê a plataforma pela primeira vez: o clube tem
 * uma página onde qualquer pessoa se torna sócia, com as categorias que ele
 * definiu e o cartão a preencher-se à medida que a pessoa escreve.
 */
export function MembershipShot({ className }: { className?: string }) {
  return (
    <div className={cx("relative overflow-hidden bg-[#f6f5f2] p-4 text-[#1a1917] sm:p-6", className)} aria-hidden>
      {/* Os estilhaços geométricos do fundo */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span
          className="absolute -right-6 top-6 block h-16 w-20 opacity-70"
          style={{ background: "#8ec2b8", clipPath: "polygon(0 0, 100% 40%, 30% 100%)" }}
        />
        <span
          className="absolute -left-5 bottom-4 block h-20 w-24 opacity-80"
          style={{ background: "#2f6f65", clipPath: "polygon(0 20%, 100% 0, 40% 100%)" }}
        />
        <span
          className="absolute right-10 bottom-2 block h-10 w-12 opacity-60"
          style={{ background: "#b9dbd4", clipPath: "polygon(0 0, 100% 60%, 20% 100%)" }}
        />
      </div>

      <div className="relative">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-[#0f6b62] text-[8px] font-bold text-white">
            LC
          </span>
          <span className="text-[13px] font-bold tracking-[0.02em] uppercase">Life Club</span>
          <span className="ml-auto text-[8px] text-[#8a867c]">Adesão a sócio</span>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_150px]">
          <div>
            <div className="text-[7.5px] font-semibold tracking-[0.14em] text-[#0f6b62] uppercase">Faz-te sócio</div>
            <div className="mt-1 text-[24px] leading-none font-bold tracking-[-0.035em]">A tua categoria</div>
            <div className="mt-1 text-[9px] text-[#524f48]">Podes mudar mais tarde, falando com o clube.</div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {TIERS.map((t) => (
                <div
                  key={t.n}
                  className={cx(
                    "rounded-[2px] border bg-white p-2.5",
                    t.on ? "border-[#0f6b62] shadow-[inset_0_0_0_1px_#0f6b62]" : "border-[#e5e2dc]",
                  )}
                >
                  <div className="text-[9px] font-semibold">{t.n}</div>
                  {t.a && <div className="text-[7px] text-[#ada89d]">{t.a}</div>}
                  <div className="mt-1.5 flex items-baseline gap-0.5">
                    <span className="text-[17px] leading-none font-bold tracking-[-0.03em]">{t.p}</span>
                    <span className="text-[7px] text-[#8a867c]">{t.u}</span>
                  </div>
                  <ul className="mt-1.5 space-y-0.5">
                    {t.b.map((b) => (
                      <li key={b} className="flex gap-1 text-[7px] text-[#524f48]">
                        <span
                          className="mt-[3px] size-[4px] shrink-0 bg-[#0f6b62]"
                          style={{ clipPath: "polygon(0 0, 100% 50%, 0 100%)" }}
                        />
                        <span className="truncate">{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-[#e5e2dc] pt-2.5">
              <span className="text-[8px] text-[#8a867c]">‹ Voltar</span>
              <span className="rounded-[2px] bg-[#0f6b62] px-4 py-1.5 text-[8px] font-bold tracking-[0.06em] text-white uppercase">
                Seguinte
              </span>
            </div>
          </div>

          {/* O cartão de sócio */}
          <div className="hidden lg:block">
            <div
              className="relative overflow-hidden rounded-[6px] p-2.5 text-white"
              style={{ background: "linear-gradient(150deg, #14776d 0%, #0f6b62 45%, #073f3a 100%)", aspectRatio: "1.6" }}
            >
              <span
                aria-hidden
                className="absolute -right-2 top-1/2 block h-14 w-16 opacity-20"
                style={{ background: "#fff", clipPath: "polygon(0 0, 100% 50%, 0 100%)" }}
              />
              <div className="relative flex items-center gap-1.5">
                <span className="flex size-4 items-center justify-center rounded-full bg-white/25 text-[6px] font-bold">
                  LC
                </span>
                <span className="ml-auto text-[6px] font-semibold tracking-[0.1em] uppercase">Sócio Gold</span>
              </div>
              <div className="relative mt-3 text-[11px] font-medium text-white/70">O teu nome</div>
              <div className="relative mt-2 flex items-end justify-between">
                <span>
                  <span className="block text-[5.5px] tracking-[0.1em] text-white/60 uppercase">Sócio n.º</span>
                  <span className="block text-[8px] tracking-[0.3em] text-white/80">— — — —</span>
                </span>
                <span className="text-[6px] text-white/70">Life Club</span>
              </div>
            </div>
            <p className="mt-2 text-[7px] leading-snug text-[#8a867c]">
              O teu cartão fica activo assim que a direção aprovar.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* A app da família                                                            */
/* -------------------------------------------------------------------------- */

export function AppShot({ className, shot = "/shots/app.png" }: { className?: string; shot?: string }) {
  return (
    <div
      className={cx(
        "relative w-[248px] shrink-0 overflow-hidden rounded-[30px] border-[6px] border-[#0c100f] bg-[#f6f5f2] shadow-[0_24px_60px_-28px_rgb(12_16_15/0.55)]",
        className,
      )}
      aria-hidden
    >
      {/* A captura verdadeira, quando existir — cobre o interior e deixa a moldura. */}
      {shot && (
        <img
          src={shot}
          alt=""
          loading="lazy"
          className="absolute inset-0 z-10 h-full w-full object-cover"
          onError={(e) => e.currentTarget.remove()}
        />
      )}

      <div className="flex items-center justify-between px-5 pt-2.5 pb-1 text-[9px] font-semibold text-[#1a1917]">
        <span>9:41</span>
        <span className="h-[7px] w-[16px] rounded-[2px] border border-[#1a1917]" />
      </div>

      <div
        className="px-4 pt-3 pb-4 text-white"
        style={{
          background:
            "radial-gradient(120% 140% at 85% -10%, #2c8a7f 0%, transparent 55%), linear-gradient(158deg, #14776d 0%, #0f6b62 42%, #0a4c45 100%)",
        }}
      >
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-white/20 text-[9px] font-bold">LC</span>
          <span className="text-[11px] font-semibold">Life Club</span>
          <span className="ml-auto text-[9px] text-white/70">Sandra</span>
        </div>

        <div className="mt-3.5 text-[10px] tracking-[0.06em] text-white/70 uppercase">Mensalidade de agosto</div>
        <div className="mt-1 flex items-end gap-2">
          <span className="text-[30px] leading-none font-semibold tracking-[-0.03em] tabular">40,00 €</span>
          <span className="mb-1 rounded-full bg-white/16 px-2 py-0.5 text-[9px] font-semibold">Vence dia 8</span>
        </div>

        <div className="mt-3.5 flex h-8 items-center justify-center rounded-[11px] bg-white text-[11px] font-semibold text-[#0a4c45]">
          Pagar com MB WAY
        </div>
      </div>

      <div className="space-y-2.5 p-3.5">
        <div className="rounded-[15px] bg-white p-3 shadow-[0_1px_2px_rgb(20_18_15/0.04),0_10px_30px_-16px_rgb(20_18_15/0.14)]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold tracking-[0.04em] text-[#8a867c] uppercase">Próximo treino</span>
            <span className="text-[9.5px] text-[#8a867c]">Amanhã</span>
          </div>
          <div className="mt-1 text-[13px] font-semibold">18:30 · Campo n.º 2</div>
          <div className="text-[10.5px] text-[#524f48]">Sub-11 Futebol · Rui Machado</div>
        </div>

        <div className="rounded-[15px] bg-white p-3 shadow-[0_1px_2px_rgb(20_18_15/0.04),0_10px_30px_-16px_rgb(20_18_15/0.14)]">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-[#e7f0ee] text-[10px] font-bold text-[#0a4c45]">
              MB
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11.5px] font-semibold">Convocado para sábado</div>
              <div className="truncate text-[10px] text-[#8a867c]">Life Club vs Fão · 10:00</div>
            </div>
            <span className="size-1.5 rounded-full bg-[#0f6b62]" />
          </div>
        </div>

        <div className="flex gap-2.5">
          {[
            ["Presença", "94%"],
            ["Jogos", "7"],
          ].map(([l, v]) => (
            <div key={l} className="flex-1 rounded-[15px] bg-white p-3 shadow-[0_1px_2px_rgb(20_18_15/0.04)]">
              <div className="text-[9.5px] tracking-[0.04em] text-[#8a867c] uppercase">{l}</div>
              <div className="mt-0.5 text-[19px] leading-none font-semibold tabular">{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-around border-t border-[#e5e2dc] bg-white/90 px-4 py-2.5">
        {["Hoje", "Agenda", "Pagar", "Atleta"].map((t, i) => (
          <span key={t} className={cx("text-[9px] font-medium", i === 0 ? "text-[#0f6b62]" : "text-[#ada89d]")}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
