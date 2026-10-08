import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { FieldView, THUMB_RATIO } from "@/components/FieldEditor";
import { Empty, Loading, Panel, Pill, SelectField, cx } from "@/components/primitives";
import { Film, Plus, Search, Star } from "@/lib/icons";
import { shortDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { listExercises, setExerciseFavorite, type ExerciseSummary } from "@/lib/training";
import { FiltroDeTreinadores, type TreinadorDaBiblioteca } from "@/components/training/FiltroDeTreinadores";
import { useSession } from "@/session";
import { useSportArea } from "./sport-area-context";

type Tab = "all" | "fav" | "mine" | "used";

/**
 * A biblioteca de exercícios — de uma modalidade.
 *
 * ## Cartões, não tabela
 *
 * Um exercício reconhece-se pelo desenho antes de se ler o nome — quem folheia
 * a biblioteca à procura de "aquela posse com apoios de fora" está a procurar
 * uma imagem. O cartão dá a imagem primeiro e os metadados a seguir.
 *
 * Os separadores são as perguntas reais: *os meus favoritos* (o treino de
 * terça monta-se daqui), *o que eu criei*, *o que o clube mais usa*.
 *
 * ## O que vem da modalidade
 *
 * A lista pede só os exercícios desta modalidade, e as categorias de objectivo
 * são as do perfil dela: o futebol filtra por "Organização ofensiva", o
 * basquetebol por "Tomada de decisão".
 *
 * ## Por treinador
 *
 * O filtro das variantes de terreno deu lugar ao de treinadores: escolhem-se
 * um ou vários, pelo nome ou pelo escalão que treinam, e vêem-se os exercícios
 * que cada um criou. Ver `FiltroDeTreinadores`.
 */
export default function Exercises() {
  const { sport, profile, path } = useSportArea();
  const { session } = useSession();
  const navigate = useNavigate();
  const mayWrite = can(session, "training:write");
  const categories = profile.exercises.categories;

  const [rows, setRows] = useState<ExerciseSummary[] | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [intensity, setIntensity] = useState("");
  const [treinadores, setTreinadores] = useState<Set<string>>(new Set());

  useEffect(() => {
    setRows(null);
    listExercises(sport.id).then(setRows).catch(() => setRows([]));
  }, [sport.id]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    let out = rows.filter((e) => {
      if (tab === "fav" && !e.favorite) return false;
      if (tab === "mine" && !e.mine) return false;
      if (treinadores.size > 0 && !(e.authorId && treinadores.has(e.authorId))) return false;
      if (category && e.category !== category) return false;
      if (intensity) {
        const n = e.intensity ?? 0;
        if (intensity === "low" && n > 4) return false;
        if (intensity === "mid" && (n < 5 || n > 7)) return false;
        if (intensity === "high" && n < 8) return false;
      }
      if (!needle) return true;
      return (
        e.name.toLowerCase().includes(needle) ||
        (e.category ?? "").toLowerCase().includes(needle) ||
        (e.type ?? "").toLowerCase().includes(needle) ||
        e.objectives.some((o) => o.toLowerCase().includes(needle))
      );
    });
    if (tab === "used") out = [...out].sort((a, b) => b.usageCount - a.usageCount);
    return out;
  }, [rows, tab, q, category, intensity, treinadores]);

  /* Quem criou exercícios nesta modalidade, com os escalões que treina e quantos criou. */
  const autores = useMemo<TreinadorDaBiblioteca[]>(() => {
    const porId = new Map<string, TreinadorDaBiblioteca>();
    for (const e of rows ?? []) {
      if (!e.authorId || !e.authorName) continue;
      const t = porId.get(e.authorId);
      if (t) t.count++;
      else porId.set(e.authorId, { id: e.authorId, name: e.authorName, teams: e.authorTeams ?? [], count: 1 });
    }
    return [...porId.values()].sort((a, b) => a.name.localeCompare(b.name, "pt"));
  }, [rows]);

  async function toggleFavorite(e: ExerciseSummary) {
    // A estrela responde já; se o servidor recusar, volta atrás.
    setRows((cur) => cur?.map((x) => (x.id === e.id ? { ...x, favorite: !x.favorite } : x)) ?? null);
    try {
      await setExerciseFavorite(e.id, !e.favorite);
    } catch {
      setRows((cur) => cur?.map((x) => (x.id === e.id ? { ...x, favorite: e.favorite } : x)) ?? null);
    }
  }

  if (rows === null) return <Loading />;

  return (
    <>
      <PageHeader title={profile.exercises.label} subtitle={profile.exercises.description}>
        {mayWrite && (
          <Link to={path("exercises", "novo")} className="ctl-primary">
            <Plus className="size-3.5" strokeWidth={1.75} />
            Novo exercício
          </Link>
        )}
      </PageHeader>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["all", "Todos"],
              ["fav", "Favoritos"],
              ["mine", "Criados por mim"],
              ["used", "Mais utilizados"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cx(
                "h-8 rounded-full px-3 text-meta font-medium transition-colors",
                tab === key ? "bg-ink text-surface" : "bg-sunken text-ink-2 hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <FiltroDeTreinadores treinadores={autores} escolhidos={treinadores} onChange={setTreinadores} />
            <SelectField
              aria-label="Objetivo"
              size="sm"
              value={category}
              onChange={setCategory}
              options={[
                { value: "", label: "Todos os objetivos" },
                ...categories.map((c) => ({ value: c.label, label: c.label })),
              ]}
            />
            <SelectField
              aria-label="Intensidade"
              size="sm"
              value={intensity}
              onChange={setIntensity}
              options={[
                { value: "", label: "Qualquer intensidade" },
                { value: "low", label: "Baixa (1–4)" },
                { value: "mid", label: "Média (5–7)" },
                { value: "high", label: "Alta (8–10)" },
              ]}
            />
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
              <input
                className="h-8 w-48 rounded-[var(--radius-control)] border border-line bg-surface pl-8 pr-2.5 text-meta text-ink focus:border-line-strong focus:outline-none"
                placeholder="Procurar…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <Panel>
            <Empty
              title={rows.length === 0 ? "A biblioteca está vazia" : "Nada com estes filtros"}
              detail={
                rows.length === 0
                  ? "O primeiro exercício do clube desenha-se em minutos: campo, jogadores, setas — e fica para sempre."
                  : "Alarga a procura ou limpa os filtros."
              }
              icon={Film}
            >
              {rows.length === 0 && mayWrite && (
                <Link to={path("exercises", "novo")} className="ctl-primary">
                  Criar o primeiro exercício
                </Link>
              )}
            </Empty>
          </Panel>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((e) => {
              const cat = categories.find((c) => c.label === e.category);
              const to = path("exercises", e.id);
              return (
                <div
                  key={e.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(to)}
                  onKeyDown={(ev) => ev.key === "Enter" && navigate(to)}
                  className="panel group cursor-pointer overflow-hidden transition-colors hover:border-line-strong"
                >
                  <div className="relative">
                    {e.thumbnail ? (
                      <FieldView diagram={e.thumbnail} className="block w-full" ratio={THUMB_RATIO} />
                    ) : e.cover ? (
                      /* Um exercício só de imagens: a primeira, no mesmo formato do campo. */
                      <img src={e.cover} alt="" loading="lazy" className="block aspect-[4/3] w-full bg-sunken object-cover" />
                    ) : (
                      <div className="flex aspect-[4/3] items-center justify-center bg-[#527a5e] text-[11px] font-medium text-white/70">
                        Sem desenho
                      </div>
                    )}
                    {!e.thumbnail && (e.imageCount ?? 0) > 1 && (
                      <span className="absolute right-2 bottom-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-semibold text-white tabular">
                        {e.imageCount} imagens
                      </span>
                    )}
                    {e.frames > 1 && (
                      <span className="absolute right-2 bottom-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-semibold text-white tabular">
                        {e.frames} frames
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={e.favorite ? "Tirar dos favoritos" : "Juntar aos favoritos"}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        void toggleFavorite(e);
                      }}
                      className="absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-full bg-black/35 transition-colors hover:bg-black/55"
                    >
                      <Star className={cx("size-4", e.favorite ? "fill-warn text-warn" : "text-white/85")} strokeWidth={1.75} />
                    </button>
                  </div>

                  <div className="space-y-1.5 p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="min-w-0 truncate text-body font-semibold text-ink">{e.name}</h3>
                      {e.visibility === "PRIVATE" ? <Pill>Só meu</Pill> : !e.authorName && !e.mine ? <Pill>Base</Pill> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {cat && (
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: cat.color.soft, color: cat.color.ink }}>
                          {cat.label}
                        </span>
                      )}
                      {e.objectives.slice(0, 2).map((o) => (
                        <span key={o} className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-ink-3">
                          {o}
                        </span>
                      ))}
                    </div>
                    <div className="text-meta text-ink-3">
                      {[
                        e.durationMin ? `${e.durationMin} min` : null,
                        e.players,
                        e.intensity ? `int. ${e.intensity}/10` : null,
                        e.space,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Sem detalhes"}
                    </div>
                    <div className="text-[11px] text-ink-4">
                      {e.usageCount > 0
                        ? `Usado ${e.usageCount}× · última ${e.lastUsedAt ? shortDate(new Date(e.lastUsedAt)) : "—"}`
                        : "Ainda por estrear"}
                      {/*
                        Sem autor é da biblioteca base — a que vem com a
                        Academias. Dizê-lo por extenso evita a pergunta óbvia
                        ("quem é que criou isto?") e explica porque é que
                        qualquer treinador o pode afinar mas ninguém o apaga.
                      */}
                      {e.authorName && !e.mine ? ` · ${e.authorName}` : e.mine ? " · meu" : " · biblioteca base"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
