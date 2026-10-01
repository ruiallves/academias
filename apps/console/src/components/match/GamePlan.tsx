import { useEffect, useMemo, useState } from "react";
import { cx } from "@/components/primitives";
import { athleteAttendanceSummary, athleteById, listAthletes, naEquipa, numeroNaEquipa, posicaoNaEquipa, sportById } from "@/lib/api";
import { availabilityOf, useClinicalRecords } from "@/lib/clinical";
import { profileOf } from "@/lib/sports";
import { useStore } from "@/lib/store";
import {
  asLineupData,
  listGameModels,
  systemLineup,
  systemsFor,
  teamFormat,
  type GameFormat,
  type GameModelRow,
} from "@/lib/training";
import { getForma, saveMatchPlan, type Forma, type MatchDetail, type MatchPlan, type PlanObjective, type PlanSlot } from "@/lib/matches";
import { exportarFichaDeJogo, type LinhaDaFicha } from "@/lib/match-sheet";
import { useSession } from "@/session";
import { PreJogo, type JogadorNaLista } from "./PreJogo";
import type { PecaNoCampo } from "./PitchBoard";
import { Anel, Cartao, CartaoTopo } from "./ui";

/**
 * O pré-jogo: o onze no campo, o banco, os capitães, os objetivos e a ficha.
 *
 * ## O desenho
 *
 * Papel claro, linhas finas e letra de máquina nos rótulos: um desenho técnico,
 * como uma folha de laboratório. O campo é em traço e a única cor é a do clube,
 * nos jogadores. Sem brilhos nem degradés: foi o que o Rui pediu para esta
 * área, e é o que a distingue das outras sem a tornar um jogo de consola.
 *
 * ## Como se monta
 *
 * Carrega-se numa posição e a lista ao lado reordena-se pela sugestão: quem
 * joga nessa posição, quem foi titular nos últimos jogos, quem tem mais
 * presenças. O motivo vem escrito ao lado de cada nome, para a sugestão se
 * poder contestar. Carregar num jogador põe-no lá; arrastá-lo da lista para o
 * campo faz o mesmo. As posições também se arrastam, para acertar o desenho.
 *
 * A sugestão não é inteligência artificial: é uma ordenação com dados que o
 * clube já registou (posição, boletim clínico, resposta à convocatória,
 * presenças e fichas dos últimos jogos). O treinador decide sempre.
 *
 * ## Quem conta
 *
 * No campo estão os titulares; no banco, os suplentes, por ordem; os outros
 * ficam fora da ficha. Os jogadores vêm dos convocados quando a convocatória
 * já existe, e do plantel da equipa antes disso.
 */

export type Jogador = {
  id: string;
  nome: string;
  curto: string;
  numero: number | null;
  posicao: string | null;
  foto: string | null;
  estado: "ok" | "condicionado" | "baixa" | "recusou";
};

type Rascunho = Omit<MatchPlan, "updatedAt" | "authorName">;

const semAcentos = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const novoId = () => Math.random().toString(36).slice(2, 10);

/** "João Pedro Silva" → "J. Silva". Cabe por baixo de uma camisola. */
export function nomeCurto(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  if (partes.length <= 1) return nome;
  return `${partes[0][0]}. ${partes[partes.length - 1]}`;
}

/**
 * Quão bem um jogador encaixa numa posição do sistema: 3 é a posição dele, 2
 * joga lá perto, 1 desenrasca, 0 não se sabe, -1 é um guarda-redes fora da
 * baliza (ou um jogador de campo na baliza).
 *
 * As posições dos atletas são texto do clube ("Defesa central", "Ala"), e os
 * rótulos do sistema são siglas ("DC", "AE"): casam-se por palavras.
 */
export function afinidade(rotulo: string, posicao: string | null): number {
  const p = semAcentos(posicao ?? "");
  const r = rotulo.toUpperCase();
  const tem = (...xs: string[]) => xs.some((x) => p.includes(x));
  const guardaRedes = tem("guarda", "redes") || p === "gr";
  if (r === "GR") return guardaRedes ? 3 : p ? -1 : 0;
  if (guardaRedes) return -1;
  if (!p) return 0;

  // Basquetebol: as posições são números.
  const basquete: Record<string, string[]> = { "1": ["base"], "2": ["extremo"], "3": ["ala"], "4": ["ala-poste", "ala poste"], "5": ["poste"] };
  if (basquete[r]) {
    if (r === "3" && tem("ala") && !tem("poste")) return 3;
    if (r === "5" && tem("poste") && !tem("ala")) return 3;
    if (r !== "3" && r !== "5" && tem(...basquete[r])) return 3;
    return 1;
  }

  if (tem("universal")) return 2;
  switch (r) {
    case "DC":
      return tem("central") ? 3 : tem("defesa", "fixo") ? 2 : tem("lateral", "medio def") ? 1 : 0;
    case "DD":
    case "DE":
      return tem("lateral") ? 3 : tem("defesa") ? 2 : tem("extremo", "ala") ? 1 : 0;
    case "D":
    case "FX":
      return tem("fixo", "central", "defesa") ? 3 : tem("lateral") ? 2 : 0;
    case "MDC":
      return tem("medio def") ? 3 : tem("medio") ? 2 : tem("central") ? 1 : 0;
    case "MC":
      return tem("medio centro") ? 3 : tem("medio") ? 2 : 0;
    case "MO":
      return tem("ofensivo") ? 3 : tem("medio") ? 2 : tem("avancado", "extremo") ? 1 : 0;
    case "MD":
    case "ME":
      return tem("medio") ? 2 : tem("extremo", "ala") ? 2 : tem("lateral") ? 1 : 0;
    case "ED":
    case "EE":
    case "AD":
    case "AE":
    case "A":
      return tem("extremo", "ala") ? 3 : tem("avancado", "medio of") ? 2 : tem("lateral") ? 1 : 0;
    case "PL":
    case "PV":
      return tem("avancado", "ponta", "pivo") ? 3 : tem("extremo", "ala") ? 1 : 0;
    default:
      return 1;
  }
}

/** Os jogadores de um jogo: os convocados, ou o plantel da equipa antes da convocatória. */
export function useJogadores(match: MatchDetail): Jogador[] {
  const { session } = useSession();
  useStore();
  useClinicalRecords();
  return useMemo(() => {
    const base =
      match.squad.length > 0
        ? match.squad.map((s) => ({ id: s.athleteId, nome: s.name, posicao: s.position, recusou: s.callUpStatus === "DECLINED" }))
        : listAthletes(session)
            .filter((a) => naEquipa(a, match.teamId) && a.status === "active")
            .map((a) => ({ id: a.id, nome: a.name, posicao: posicaoNaEquipa(a, match.teamId) ?? null, recusou: false }));
    return base
      .map((b) => {
        const a = athleteById(b.id);
        const clinico = availabilityOf(b.id);
        return {
          id: b.id,
          nome: b.nome,
          curto: nomeCurto(b.nome),
          numero: a ? (numeroNaEquipa(a, match.teamId) ?? a.squadNumber ?? null) : null,
          posicao: b.posicao ?? (a ? (posicaoNaEquipa(a, match.teamId) ?? null) : null),
          foto: a?.photoUrl ?? null,
          estado: b.recusou ? ("recusou" as const) : clinico === "out" ? ("baixa" as const) : clinico === "limited" ? ("condicionado" as const) : ("ok" as const),
        };
      })
      .sort((x, y) => (x.numero ?? 999) - (y.numero ?? 999) || x.nome.localeCompare(y.nome));
    // O plantel muda com o jogo; o resto é derivado do armazém.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id, match.squad, session]);
}

export function planoInicial(match: MatchDetail): Rascunho {
  if (match.plan) {
    const { updatedAt: _u, authorName: _a, ...resto } = match.plan;
    return { ...resto, objectives: resto.objectives ?? [] };
  }
  const profile = profileOf(sportById(match.sportId));
  const formatos = (profile?.vocabulary.formats ?? ["f11"]) as GameFormat[];
  const sugerido = teamFormat(match.teamId);
  const pitch = formatos.includes(sugerido) ? sugerido : ((profile?.defaultFormat ?? "f11") as GameFormat);
  const system = systemsFor(pitch)[0].label;
  return {
    pitch,
    system,
    gameModelId: null,
    slots: systemLineup(system, pitch).map((s) => ({ ...s, athleteId: null })),
    bench: [],
    captainId: null,
    viceCaptainId: null,
    notes: null,
    objectives: [],
  };
}

/* -------------------------------------------------------------------------- */
/* O pré-jogo                                                                  */
/* -------------------------------------------------------------------------- */

export function GamePlan({ match, mayEdit, onSaved }: { match: MatchDetail; mayEdit: boolean; onSaved: () => void }) {
  const { academy, season } = useStore();
  const sport = sportById(match.sportId);
  const profile = profileOf(sport);
  const formatos = (profile?.vocabulary.formats ?? ["f11"]) as GameFormat[];

  const [plano, setPlano] = useState<Rascunho>(() => planoInicial(match));
  const [mexido, setMexido] = useState(false);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [aGuardar, setAGuardar] = useState(false);
  const [aExportar, setAExportar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  // Outro jogo, ou o plano voltou do servidor: recomeça do que está gravado.
  useEffect(() => {
    setPlano(planoInicial(match));
    setMexido(false);
    setEscolhido(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id, match.plan?.updatedAt]);

  const mudar = (patch: Partial<Rascunho>) => {
    setPlano((p) => ({ ...p, ...patch }));
    setMexido(true);
    setGuardado(false);
  };

  const jogadores = useJogadores(match);
  const porId = useMemo(() => new Map(jogadores.map((j) => [j.id, j])), [jogadores]);
  const noCampo = new Set(plano.slots.map((s) => s.athleteId).filter((x): x is string => Boolean(x)));
  const noBanco = new Set(plano.bench);
  const slotEscolhido = plano.slots.find((s) => s.id === escolhido) ?? null;

  /* ---- a forma recente, para a sugestão ---- */
  const [forma, setForma] = useState<Forma | null>(null);
  useEffect(() => {
    let vivo = true;
    getForma(match.id)
      .then((f) => vivo && setForma(f ?? null))
      .catch(() => vivo && setForma(null));
    return () => {
      vivo = false;
    };
  }, [match.id]);
  const formaDe = useMemo(() => new Map((forma?.athletes ?? []).map((a) => [a.athleteId, a])), [forma]);
  const presencas = useMemo(() => new Map(jogadores.map((j) => [j.id, athleteAttendanceSummary(j.id, 30).rate])), [jogadores]);

  /**
   * A nota de um jogador para uma posição, e porquê.
   *
   * A posição pesa mais do que tudo; depois ser titular nos últimos jogos, e
   * depois as presenças do último mês. Quem está condicionado desce um pouco.
   * Devolve nulo para quem não pode: de baixa, disse que não vai, ou guarda-redes
   * fora da baliza.
   */
  function nota(j: Jogador, rotulo: string): { valor: number; motivos: string[] } | null {
    if (j.estado === "baixa" || j.estado === "recusou") return null;
    const a = afinidade(rotulo, j.posicao);
    if (a < 0) return null;
    const f = formaDe.get(j.id);
    const p = presencas.get(j.id) ?? null;
    const motivos: string[] = [];
    if (a >= 3) motivos.push("posição dele");
    else if (a === 2) motivos.push("adapta-se");
    if (f && forma && forma.matches > 0 && f.starts > 0) motivos.push(`titular em ${f.starts} dos últimos ${forma.matches}`);
    if (p !== null) motivos.push(`${Math.round(p * 100)}% de presenças`);
    if (j.estado === "condicionado") motivos.push("condicionado");
    return { valor: a * 10 + (f ? f.starts * 1.5 + f.minutes / 200 : 0) + (p ?? 0.5) * 3 - (j.estado === "condicionado" ? 4 : 0), motivos };
  }

  /* ---- mexer no onze ---- */
  function por(athleteId: string, slotId: string) {
    const origem = plano.slots.find((s) => s.athleteId === athleteId);
    const destino = plano.slots.find((s) => s.id === slotId);
    if (!destino) return;
    mudar({
      // Quem já estava noutra posição troca com quem estava nesta.
      slots: plano.slots.map((s) =>
        s.id === slotId ? { ...s, athleteId } : origem && s.id === origem.id ? { ...s, athleteId: destino.athleteId } : s,
      ),
      bench: plano.bench.filter((id) => id !== athleteId).concat(destino.athleteId && !origem ? [destino.athleteId] : []),
    });
    setEscolhido(null);
  }
  function tirarDoCampo(slotId: string) {
    const s = plano.slots.find((x) => x.id === slotId);
    if (!s?.athleteId) return;
    mudar({ slots: plano.slots.map((x) => (x.id === slotId ? { ...x, athleteId: null } : x)), bench: [...plano.bench, s.athleteId] });
  }
  function alternarBanco(id: string) {
    if (noCampo.has(id)) return;
    const sai = noBanco.has(id);
    mudar({
      bench: sai ? plano.bench.filter((x) => x !== id) : [...plano.bench, id],
      ...(sai && plano.captainId === id ? { captainId: null } : {}),
      ...(sai && plano.viceCaptainId === id ? { viceCaptainId: null } : {}),
    });
  }
  /** Sobe um suplente na ordem do banco. */
  function subirNoBanco(id: string) {
    const i = plano.bench.indexOf(id);
    if (i <= 0) return;
    const b = [...plano.bench];
    [b[i - 1], b[i]] = [b[i], b[i - 1]];
    mudar({ bench: b });
  }
  function bracadeira(id: string, qual: "captainId" | "viceCaptainId") {
    const outro = qual === "captainId" ? "viceCaptainId" : "captainId";
    mudar({ [qual]: plano[qual] === id ? null : id, ...(plano[outro] === id ? { [outro]: null } : {}) } as Partial<Rascunho>);
  }

  /**
   * Um desenho novo (outro sistema, outro formato, um modelo de jogo) mantém os
   * jogadores que conseguir: cada um vai para a posição livre onde melhor
   * encaixa, e quem não couber passa para o banco.
   */
  function aplicarDesenho(pitch: GameFormat, system: string | null, slots: { id: string; label: string; x: number; y: number }[], gameModelId: string | null) {
    const antigos = plano.slots.filter((s) => s.athleteId).map((s) => ({ id: s.athleteId!, label: s.label }));
    const novos: PlanSlot[] = slots.map((s) => ({ ...s, athleteId: null }));
    const sobram: string[] = [];
    for (const a of antigos) {
      const j = porId.get(a.id);
      const peso = (s: PlanSlot) => (s.label === a.label ? 5 : afinidade(s.label, j?.posicao ?? null));
      const livre = novos.filter((s) => !s.athleteId).sort((x, y) => peso(y) - peso(x))[0];
      if (livre && peso(livre) >= 0) livre.athleteId = a.id;
      else sobram.push(a.id);
    }
    mudar({ pitch, system, gameModelId, slots: novos, bench: [...plano.bench, ...sobram] });
    setEscolhido(null);
  }
  const trocarFormato = (pitch: GameFormat) => {
    const system = systemsFor(pitch)[0].label;
    aplicarDesenho(pitch, system, systemLineup(system, pitch), null);
  };
  const trocarSistema = (system: string) => aplicarDesenho(plano.pitch as GameFormat, system, systemLineup(system, plano.pitch as GameFormat), null);

  /** Preenche as posições vazias com a melhor nota, e põe o resto no banco. */
  function sugerirOnze() {
    const usados = new Set(noCampo);
    const slots = plano.slots.map((s) => ({ ...s }));
    const ordem = slots
      .filter((s) => !s.athleteId)
      .sort((a, b) => {
        if (a.label === "GR") return -1;
        if (b.label === "GR") return 1;
        const n = (s: PlanSlot) => jogadores.filter((j) => !usados.has(j.id) && afinidade(s.label, j.posicao) >= 3).length;
        return n(a) - n(b);
      });
    for (const s of ordem) {
      const melhor = jogadores
        .filter((j) => !usados.has(j.id))
        .map((j) => ({ j, n: nota(j, s.label) }))
        .filter((x) => x.n !== null)
        .sort((x, y) => y.n!.valor - x.n!.valor)[0];
      if (melhor) {
        s.athleteId = melhor.j.id;
        usados.add(melhor.j.id);
      }
    }
    mudar({ slots, bench: jogadores.filter((j) => !usados.has(j.id) && j.estado !== "baixa" && j.estado !== "recusou").map((j) => j.id) });
  }

  /* ---- os modelos de jogo da Área técnica ---- */
  const [modelos, setModelos] = useState<GameModelRow[] | null>(null);
  useEffect(() => {
    let vivo = true;
    listGameModels(match.sportId)
      .then((r) => vivo && setModelos((r ?? []).filter((m) => m.teamId === null || m.teamId === match.teamId)))
      .catch(() => vivo && setModelos([]));
    return () => {
      vivo = false;
    };
  }, [match.sportId, match.teamId]);
  const modelo = modelos?.find((m) => m.id === plano.gameModelId) ?? null;

  function importarModelo(id: string) {
    const m = modelos?.find((x) => x.id === id);
    if (!m) return;
    const d = asLineupData(m.lineup);
    if (d.slots.length === 0) return;
    aplicarDesenho(d.pitch, m.system ?? m.name, d.slots, m.id);
  }

  /* ---- gravar e exportar ---- */
  async function guardar() {
    if (aGuardar) return;
    setAGuardar(true);
    setErro(null);
    try {
      await saveMatchPlan(match.id, plano);
      setMexido(false);
      setGuardado(true);
      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar o plano.");
    } finally {
      setAGuardar(false);
    }
  }

  async function exportar() {
    if (aExportar) return;
    setAExportar(true);
    try {
      const linha = (id: string, rotulo?: string): LinhaDaFicha => {
        const j = porId.get(id);
        return {
          numero: j?.numero ?? null,
          nome: j?.nome ?? athleteById(id)?.name ?? "Atleta",
          posicao: rotulo ? `${rotulo}${j?.posicao ? ` · ${j.posicao}` : ""}` : (j?.posicao ?? ""),
          marca: plano.captainId === id ? "C" : plano.viceCaptainId === id ? "SC" : "",
        };
      };
      await exportarFichaDeJogo({
        academy,
        season,
        team: match.teamName,
        opponent: match.opponent,
        isHome: match.isHome,
        competition: match.competition?.label ?? "",
        round: match.roundLabel ?? "",
        venue: match.venue,
        kickOff: new Date(match.startsAt),
        system: plano.system ?? "",
        titulares: plano.slots.filter((s) => s.athleteId).map((s) => linha(s.athleteId!, s.label)),
        suplentes: plano.bench.map((id) => linha(id)),
        staff: match.staff.length > 0 ? match.staff.map((s) => ({ name: s.name, role: s.role })) : match.teamStaff,
      });
    } finally {
      setAExportar(false);
    }
  }

  const formato = plano.pitch as GameFormat;
  const marcaDe = (id: string) => (plano.captainId === id ? ("C" as const) : plano.viceCaptainId === id ? ("SC" as const) : null);
  const avisoDe = (j: Jogador) => (j.estado === "baixa" ? "de baixa" : j.estado === "condicionado" ? "condicionado" : j.estado === "recusou" ? "não vai" : null);

  const pecas: PecaNoCampo[] = plano.slots.map((s) => {
    const j = s.athleteId ? porId.get(s.athleteId) : undefined;
    return {
      id: s.id,
      label: s.label,
      x: s.x,
      y: s.y,
      jogador: s.athleteId
        ? { numero: j?.numero ?? null, nome: j?.curto ?? "Atleta", foto: j?.foto, marca: marcaDe(s.athleteId), aviso: j?.estado === "condicionado" }
        : null,
    };
  });

  const linha = (j: Jogador, motivos?: string[] | null): JogadorNaLista => {
    const slot = plano.slots.find((s) => s.athleteId === j.id);
    return {
      id: j.id,
      nome: j.nome,
      curto: j.curto,
      numero: j.numero,
      foto: j.foto,
      posicao: j.posicao,
      onde: slot ? { tipo: "campo", sigla: slot.label } : noBanco.has(j.id) ? { tipo: "banco" } : { tipo: "fora" },
      aviso: avisoDe(j),
      indisponivel: j.estado === "baixa" || j.estado === "recusou",
      marca: marcaDe(j.id),
      motivos,
    };
  };

  /*
   * Sem posição escolhida, a lista vai por posição, pela ordem do clube
   * (guarda-redes, defesas, médios, avançados), e dentro de cada uma pelo
   * número. Quem não tem posição fica no fim.
   */
  const posicoes = sport?.positions ?? [];
  const ordemDaPosicao = (pos: string | null) => {
    const i = pos ? posicoes.indexOf(pos) : -1;
    return i >= 0 ? i : pos ? posicoes.length : posicoes.length + 1;
  };

  // A lista ao lado: com uma posição escolhida, ordenada pela nota.
  const lista: JogadorNaLista[] = slotEscolhido
    ? jogadores
        .map((j) => ({ j, n: nota(j, slotEscolhido.label) }))
        .sort((a, b) => (b.n?.valor ?? -99) - (a.n?.valor ?? -99))
        .map(({ j, n }) => linha(j, n ? n.motivos : null))
    : [...jogadores].sort((a, b) => ordemDaPosicao(a.posicao) - ordemDaPosicao(b.posicao) || (a.numero ?? 999) - (b.numero ?? 999) || a.nome.localeCompare(b.nome)).map((j) => linha(j));
  const banco = plano.bench.map((id) => porId.get(id)).filter((j): j is Jogador => Boolean(j)).map((j) => linha(j));

  return (
    <PreJogo
      podeEditar={mayEdit}
      formato={formato}
      formatos={formatos}
      sistema={plano.system ?? ""}
      sistemas={systemsFor(formato).map((x) => x.label)}
      modelos={(modelos ?? []).map((m) => ({ id: m.id, nome: m.name }))}
      modeloId={modelo?.id ?? null}
      pecas={pecas}
      escolhida={escolhido}
      jogadores={lista}
      banco={banco}
      objetivos={plano.objectives}
      notas={plano.notes ?? ""}
      deConvocatoria={match.squad.length > 0}
      estadoDeGravar={{ mexido, aGuardar, guardado, erro, autor: match.plan?.authorName?.split(" ")[0] ?? null, temPlano: Boolean(match.plan) }}
      aExportar={aExportar}
      onFormato={trocarFormato}
      onSistema={trocarSistema}
      onModelo={importarModelo}
      onSugerir={sugerirOnze}
      onEscolher={setEscolhido}
      onMover={(id, x, y) => mudar({ slots: plano.slots.map((s) => (s.id === id ? { ...s, x, y } : s)) })}
      onPor={por}
      onTirar={tirarDoCampo}
      onBanco={alternarBanco}
      onSubir={subirNoBanco}
      onParaBanco={(id) => {
        const slot = plano.slots.find((s) => s.athleteId === id);
        if (slot) tirarDoCampo(slot.id);
        else if (!noBanco.has(id)) alternarBanco(id);
      }}
      onParaFora={(id) => {
        const slot = plano.slots.find((s) => s.athleteId === id);
        if (slot) {
          mudar({
            slots: plano.slots.map((s) => (s.id === slot.id ? { ...s, athleteId: null } : s)),
            ...(plano.captainId === id ? { captainId: null } : {}),
            ...(plano.viceCaptainId === id ? { viceCaptainId: null } : {}),
          });
        } else if (noBanco.has(id)) alternarBanco(id);
      }}
      onMarca={(id, qual) => bracadeira(id, qual === "C" ? "captainId" : "viceCaptainId")}
      onObjetivoNovo={(texto) => mudar({ objectives: [...plano.objectives, { id: novoId(), text: texto.slice(0, 200), met: null } satisfies PlanObjective] })}
      onObjetivoApagar={(id) => mudar({ objectives: plano.objectives.filter((x) => x.id !== id) })}
      onNotas={(texto) => mudar({ notes: texto })}
      onGuardar={() => void guardar()}
      onExportar={() => void exportar()}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Os objetivos, na análise                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Os objetivos do jogo, depois do apito: cumprido ou não.
 *
 * É a ponte entre o plano e a análise. Cada resposta grava logo, com o resto
 * do plano como estava: não há botão de guardar para três cliques.
 */
export function ObjetivosNaAnalise({ match, mayEdit, onSaved }: { match: MatchDetail; mayEdit: boolean; onSaved: () => void }) {
  const [aGravar, setAGravar] = useState<string | null>(null);
  const objetivos = match.plan?.objectives ?? [];
  if (!match.plan || objetivos.length === 0) return null;

  async function marcar(id: string, met: boolean | null) {
    if (!match.plan || aGravar) return;
    setAGravar(id);
    try {
      const { updatedAt: _u, authorName: _a, ...plano } = match.plan;
      await saveMatchPlan(match.id, { ...plano, objectives: objetivos.map((o) => (o.id === id ? { ...o, met } : o)) });
      onSaved();
    } finally {
      setAGravar(null);
    }
  }

  const cumpridos = objetivos.filter((o) => o.met === true).length;
  const avaliados = objetivos.filter((o) => o.met !== null).length;

  return (
    <Cartao>
      <CartaoTopo titulo="Do plano ao que aconteceu" apoio="Os objetivos definidos antes do jogo. Cumpriram-se?">
        <Anel valor={cumpridos} total={objetivos.length} tamanho={46} />
      </CartaoTopo>
      <ol className="space-y-1.5 px-5 pb-5">
        {objetivos.map((o, i) => (
          <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] bg-sunken/60 py-2 pr-2 pl-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-[11px] font-semibold text-ink-2 tabular">{i + 1}</span>
            <span className="min-w-0 flex-1 basis-[220px] text-body text-ink">{o.text}</span>
            <span className="flex shrink-0 gap-1">
              {(
                [
                  [true, "Cumprido"],
                  [false, "Não cumprido"],
                ] as const
              ).map(([valor, rotulo]) => (
                <button
                  key={rotulo}
                  type="button"
                  disabled={!mayEdit || aGravar !== null}
                  aria-pressed={o.met === valor}
                  onClick={() => void marcar(o.id, o.met === valor ? null : valor)}
                  className={cx(
                    "h-8 rounded-full border px-3 text-meta font-medium transition-colors disabled:opacity-60",
                    o.met === valor
                      ? valor
                        ? "border-transparent bg-ok text-white"
                        : "border-transparent bg-risk text-white"
                      : "border-line bg-surface text-ink-3 hover:border-line-strong hover:text-ink",
                  )}
                >
                  {rotulo}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ol>
      {avaliados < objetivos.length && <p className="px-5 pb-4 text-[11.5px] text-ink-4">{objetivos.length - avaliados} por avaliar.</p>}
    </Cartao>
  );
}
