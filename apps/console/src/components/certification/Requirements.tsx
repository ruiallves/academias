import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Empty, Panel, Pill } from "@/components/primitives";
import { ResultCount, SearchInput, Segmented, Select, Toolbar } from "@/components/filters";
import { ArrowUpRight, BadgeCheck, Check, Minus } from "@/lib/icons";
import { shortDate } from "@/lib/format";
import { LEVELS, MODE_LABEL, SOURCE, STATUS_LABEL, TIER_LABEL, TIER_LONG, pts, type Requirement, type Summary, type Tier } from "@/lib/certification";

export type RequirementFilter = "next" | "missing" | "all";

export type RequirementsView = {
  filter: RequirementFilter;
  /** `"all"` ou o número do critério. */
  criterion: string;
  /** `"all"`, ou o nível cujos requisitos obrigatórios se querem ver: `"0"` o CBFF, `"1"` a `"5"` as estrelas. */
  level: string;
  /** Com os níveis de baixo (tudo o que o nível pede) ou só o que ele acrescenta. */
  cumulative: boolean;
  query: string;
  open: string | null;
};

/**
 * Os requisitos do manual, um a um.
 *
 * A lista abre no que interessa — o que trava a estrela seguinte — e não nos
 * 195. Quem quer o manual inteiro tem-no a um clique, agrupado como a FPF o
 * numera, para se poder ter a plataforma da Federação aberta ao lado.
 *
 * ## Uma linha, três respostas
 *
 * Cada requisito diz o estado, **porquê** (a frase do cálculo, com os números)
 * e o que a FPF pede em anexo. Quando a plataforma calcula, o clube pode
 * responder por cima: há clubes com o dossier em papel, e é o clube que
 * responde perante o avaliador.
 *
 * ## Por nível
 *
 * "O que é preciso para as 3 estrelas?" é uma pergunta que a lista não
 * respondia: mostrava o que falta para a estrela **seguinte**, e mais nada. O
 * filtro por nível mostra os obrigatórios de qualquer um — tudo o que ele pede,
 * contando com os de baixo, ou só o que acrescenta ao anterior. Com um nível
 * escolhido, "em falta" quer dizer em falta **para esse nível**: um médico na
 * coordenação clínica cumpre as 3 estrelas e falha as 4.
 */
export function Requirements({
  data,
  view,
  onView,
  onAnswer,
  onClear,
  onProfile,
  saving,
}: {
  data: Summary;
  view: RequirementsView;
  onView: (patch: Partial<RequirementsView>) => void;
  onAnswer: (code: string, value: number) => void;
  onClear: (code: string) => void;
  onProfile: () => void;
  /** O requisito que está a ser gravado. */
  saving: string | null;
}) {
  const atalhos = new Set(data.quickWins.map((w) => w.code));
  const termo = view.query.trim().toLowerCase();

  // O nível escolhido, e os patamares que contam para ele.
  const nivel = LEVELS.find((l) => l.value === view.level) ?? null;
  const patamares = new Set<Tier>(nivel ? (view.cumulative ? nivel.tiers : nivel.adds ? [nivel.adds] : []) : []);
  const doNivel = (r: Requirement) => !nivel || r.levels.some((l) => patamares.has(l.tier));
  // Com um nível escolhido, falta o que falta **para ele**.
  const falta = (r: Requirement) =>
    nivel ? r.levels.some((l) => patamares.has(l.tier) && !l.met) : r.status === "missing" || r.status === "partial";
  const proximaEstrela = (r: Requirement) => r.blocking || atalhos.has(r.code);

  const base = data.requirements.filter(doNivel);
  const visiveis = base.filter((r) => {
    if (view.criterion !== "all" && String(r.criterion) !== view.criterion) return false;
    if (termo && !`${r.code} ${r.text}`.toLowerCase().includes(termo)) return false;
    // O que está aberto fica à vista mesmo que a resposta o tire do filtro:
    // um requisito que desaparece no instante em que se responde parece um erro.
    if (r.code === view.open) return true;
    if (view.filter === "next") return proximaEstrela(r);
    if (view.filter === "missing") return falta(r);
    return true;
  });

  const emFalta = base.filter(falta).length;
  const proxima = base.filter(proximaEstrela).length;

  return (
    <Panel>
      <Toolbar>
        <Segmented<RequirementFilter>
          label="Que requisitos mostrar"
          value={view.filter}
          onChange={(filter) => onView({ filter, open: null })}
          options={[
            { value: "next", label: data.next ? "Próxima estrela" : "Por ganhar", count: proxima },
            { value: "missing", label: "Em falta", count: emFalta },
            { value: "all", label: "Todos", count: base.length },
          ]}
        />
        <Select
          label="Nível"
          value={view.level}
          // Escolher um nível mostra-o inteiro: ficar em "Próxima estrela" dava
          // a intersecção das duas coisas, que quase nunca é o que se quer ver.
          onChange={(level) => onView({ level, open: null, ...(level !== "all" && view.filter === "next" ? { filter: "all" as const } : {}) })}
          options={[{ value: "all", label: "Todos os níveis" }, ...LEVELS.map((l) => ({ value: l.value, label: `Obrigatórios: ${l.label}` }))]}
        />
        {nivel && (
          <Segmented<"sim" | "nao">
            label="Contar com os níveis anteriores"
            value={view.cumulative ? "sim" : "nao"}
            onChange={(v) => onView({ cumulative: v === "sim", open: null })}
            options={[
              { value: "sim", label: "Tudo o que pede", hint: "Com os obrigatórios dos níveis de baixo" },
              { value: "nao", label: "Só o que acrescenta", hint: "O que este nível pede a mais do que o anterior" },
            ]}
          />
        )}
        <Select
          label="Critério"
          value={view.criterion}
          onChange={(criterion) => onView({ criterion, open: null })}
          options={[{ value: "all", label: "Todos os critérios" }, ...data.criteria.map((c) => ({ value: String(c.criterion), label: `${c.criterion} · ${c.name}` }))]}
        />
        <SearchInput value={view.query} onChange={(query) => onView({ query })} placeholder="Procurar por código ou texto…" />
        <ResultCount n={visiveis.length} noun={["requisito", "requisitos"]} />
      </Toolbar>

      {nivel && (
        <p className="border-b border-line bg-canvas px-5 py-2.5 text-meta text-ink-2">
          <b className="font-semibold text-ink">
            {base.length === 0
              ? `${nivel.label}: não acrescenta requisitos obrigatórios aos do nível anterior.`
              : `${nivel.label}: ${base.length} ${base.length === 1 ? "obrigatório" : "obrigatórios"}, ${emFalta === 0 ? "todos cumpridos" : `${emFalta} em falta`}.`}
          </b>{" "}
          {nivel.also}
        </p>
      )}

      {visiveis.length === 0 ? (
        <Empty
          compact
          icon={BadgeCheck}
          tone="ok"
          title={nivel && base.length === 0 ? "Sem requisitos próprios" : view.filter === "all" ? "Nenhum requisito com esses filtros" : "Nada por tratar aqui"}
          detail={
            nivel && base.length === 0
              ? `Escolha "Tudo o que pede" para ver os obrigatórios que as ${nivel.label} herdam do nível de baixo.`
              : view.filter === "all"
                ? "Experimente outro critério ou outra palavra."
                : "Com estes filtros está tudo cumprido."
          }
        />
      ) : (
        <div>
          {visiveis.map((r, i) => (
            <Fragment key={r.code}>
              {(i === 0 || visiveis[i - 1].group !== r.group) && (
                <div className="cert-group">
                  <span className="cert-code">{r.group}</span>
                  {data.groups[r.group]}
                </div>
              )}
              <Row
                r={r}
                open={view.open === r.code}
                canWrite={data.canWrite}
                saving={saving === r.code}
                onToggle={() => onView({ open: view.open === r.code ? null : r.code })}
                onAnswer={onAnswer}
                onClear={onClear}
                onProfile={onProfile}
              />
            </Fragment>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Row({
  r,
  open,
  canWrite,
  saving,
  onToggle,
  onAnswer,
  onClear,
  onProfile,
}: {
  r: Requirement;
  open: boolean;
  canWrite: boolean;
  saving: boolean;
  onToggle: () => void;
  onAnswer: (code: string, value: number) => void;
  onClear: (code: string) => void;
  onProfile: () => void;
}) {
  const apagado = r.status === "na" || r.status === "assessor";
  return (
    <div className="cert-req" data-open={open} id={`requisito-${r.code}`}>
      <button type="button" className="cert-req-head" onClick={onToggle} aria-expanded={open}>
        <StatusMark r={r} />
        <span className="cert-code pt-0.5">{r.code}</span>
        <span className={apagado ? "text-body text-ink-3" : "text-body text-ink"}>{r.text}</span>
        <span className="cert-req-meta flex flex-wrap items-center justify-end gap-1.5">
          {r.mandatory && (
            <span className="cert-lv" data-t={r.mandatory} title={TIER_LONG[r.mandatory]}>
              {TIER_LABEL[r.mandatory]}
            </span>
          )}
          <OriginPill r={r} />
          <span className="tabular min-w-[68px] text-right font-mono text-[11.5px] text-ink-3">
            {r.points > 0 ? (
              <>
                <span className={r.earned > 0 ? "text-ink" : undefined}>{pts(r.earned)}</span> / {pts(r.points)}
              </>
            ) : (
              "sem pontos"
            )}
          </span>
        </span>
      </button>

      {open && (
        <div className="cert-req-body">
          <div className="flex min-w-0 flex-col gap-4">
            {r.auto && (
              <Block label="O que a plataforma vê">
                <p>{r.auto.detail}</p>
                {r.auto.progress && r.auto.progress.of > 0 && (
                  <span className="cert-meter mt-2 block max-w-[320px]" aria-hidden>
                    <i style={{ width: `${Math.min(100, (r.auto.progress.got / r.auto.progress.of) * 100)}%` }} />
                  </span>
                )}
              </Block>
            )}
            <Block label="O que a FPF pede em anexo">
              <p>{r.evidence ?? (r.status === "assessor" ? "Nada. Depende do que o avaliador vir na visita técnica." : "Sem anexo próprio.")}</p>
            </Block>
            {r.note && (
              <Block label="Nota do manual">
                <p>{r.note}</p>
              </Block>
            )}
            {r.mandatory && <p className="text-meta text-ink-3">{TIER_LONG[r.mandatory]}.</p>}
            {SOURCE[r.source]?.to && r.status !== "met" && r.status !== "na" && (
              <Link to={SOURCE[r.source].to!} className="ctl-outline self-start">
                Abrir {SOURCE[r.source].label}
                <ArrowUpRight className="size-3.5" strokeWidth={1.75} />
              </Link>
            )}
          </div>

          <div className="min-w-0">
            <Answer r={r} canWrite={canWrite} saving={saving} onAnswer={onAnswer} onClear={onClear} onProfile={onProfile} />
          </div>
        </div>
      )}
    </div>
  );
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="text-body text-ink-2">
      <div className="cert-label mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function StatusMark({ r }: { r: Requirement }) {
  const bloqueia = r.blocking && r.status !== "met";
  return (
    <span className="cert-status" data-s={r.status} data-block={bloqueia} title={STATUS_LABEL[r.status]}>
      {r.status === "met" && <Check className="size-3" strokeWidth={3} />}
      {r.status === "partial" && <span className="block size-1.5 rounded-full bg-current" />}
      {r.status === "na" && <Minus className="size-3" strokeWidth={2} />}
      <span className="sr-only">{STATUS_LABEL[r.status]}</span>
    </span>
  );
}

/** De onde vem a resposta: do cálculo, de alguém do clube, ou ainda de ninguém. */
function OriginPill({ r }: { r: Requirement }) {
  if (r.status === "na") return <Pill>Não se aplica</Pill>;
  if (r.status === "assessor") return <Pill tone="warn">Avaliador</Pill>;
  if (r.origin === "auto") return <Pill tone="signal">Calculado</Pill>;
  if (r.origin === "answer") return <Pill>Resposta do clube</Pill>;
  return <Pill>Por responder</Pill>;
}

const CONDICAO: Record<NonNullable<Requirement["condition"]>, string> = {
  dre: "o perfil diz que o clube não tem praticantes deslocados das famílias (D.R.E.)",
  nn: "o perfil diz que o clube não recruta praticantes não-nacionais",
  rec: "o perfil diz que o clube não faz recrutamento",
  sen: "o perfil diz que o clube não tem equipa sénior",
};

function Answer({
  r,
  canWrite,
  saving,
  onAnswer,
  onClear,
  onProfile,
}: {
  r: Requirement;
  canWrite: boolean;
  saving: boolean;
  onAnswer: (code: string, value: number) => void;
  onClear: (code: string) => void;
  onProfile: () => void;
}) {
  if (r.status === "na") {
    return (
      <Block label="Não se aplica">
        <p>Fica de fora porque {r.condition ? CONDICAO[r.condition] : "não se aplica a este clube"}.</p>
        {canWrite && (
          <button type="button" className="ctl-outline mt-3" onClick={onProfile}>
            Abrir o perfil da candidatura
          </button>
        )}
      </Block>
    );
  }

  if (r.status === "assessor") {
    return (
      <Block label="Pontos do avaliador">
        <p>
          Só o avaliador da FPF os atribui, depois da visita técnica, e só a clubes com todas as questões do critério aprovadas e os documentos
          carregados na data da autoavaliação.
        </p>
      </Block>
    );
  }

  const travado = !canWrite || saving;
  const opcoes = r.tiers
    ? [...r.tiers.map((t, i) => ({ value: i, label: t.label, points: t.points, mandatory: t.mandatory })), { value: -1, label: "Nenhum", points: 0, mandatory: null }]
    : [
        { value: 1, label: r.mode === "declaration" ? "O clube declara que sim" : "Cumprido", points: r.points, mandatory: null },
        { value: 0, label: "Em falta", points: 0, mandatory: null },
      ];

  return (
    <div className="flex flex-col gap-2">
      <div className="cert-label">{canWrite ? "A resposta do clube" : "Resposta"}</div>
      {opcoes.map((o) => (
        <button
          key={o.value}
          type="button"
          className="cert-tier"
          aria-pressed={r.value === o.value}
          disabled={travado}
          onClick={() => onAnswer(r.code, o.value)}
        >
          <span className="min-w-0">{o.label}</span>
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-ink-3">
            {o.mandatory && (
              <span className="cert-lv" data-t={o.mandatory}>
                {TIER_LABEL[o.mandatory]}
              </span>
            )}
            {r.points > 0 && `${pts(o.points)} pt`}
          </span>
        </button>
      ))}

      <p className="mt-1 text-meta text-ink-3">
        {r.answer
          ? `Respondido${r.answer.by ? ` por ${r.answer.by}` : ""} a ${shortDate(new Date(r.answer.at))}.`
          : r.origin === "auto"
            ? "Calculado pela plataforma. Uma resposta do clube passa a valer em vez do cálculo."
            : r.mode === "data"
              ? "A plataforma ainda não calcula este requisito. Até alguém responder, conta como em falta."
              : `Ainda sem resposta. Conta como em falta. Responde-se com ${MODE_LABEL[r.mode].toLowerCase()}.`}
      </p>
      {r.answer && canWrite && (
        <button type="button" className="ctl-ghost self-start" disabled={saving} onClick={() => onClear(r.code)}>
          {r.auto ? "Voltar ao cálculo da plataforma" : "Limpar a resposta"}
        </button>
      )}
    </div>
  );
}
