import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { cx } from "./primitives";
import { CampoSubstituicoes } from "./CampoSubstituicoes";
import { lerMinutosDasPartes, lerPartes, minutosGravados, MinutosPorParte, notaDasPartes, repartir } from "./CampoPartes";
import { sportById } from "@/lib/api";
import { partesDoJogo, profileOf } from "@/lib/sports";
import { substituicoesVolantes } from "@/components/match/substituicoes";
import { Settings } from "@/lib/icons";
import { updateTeam } from "@/lib/matches";
import { reloadAcademy } from "@/lib/store";
import { useCatalogForSport } from "@/lib/catalogs";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { SEM_LIMITE, teamAgeLabel } from "@/lib/team-age";
import { TEAM_GENDERS, TEAM_GENDER_LABEL } from "@/lib/genero";
import type { Team, TeamGender } from "@/data/types";

const AMIGAVEL = "Amigável";

/**
 * Editar a equipa — tudo o que é da equipa, num sítio só.
 *
 * As provas e a duração do jogo viviam em dois painéis na visão geral, cada um
 * a gravar sozinho, o máximo de convocados vivia na página das convocatórias,
 * e o nome e o escalão não se editavam em lado nenhum. Quatro sítios para a
 * mesma pergunta — "como é esta equipa?" — e uma página cheia de caixas que
 * quase nunca mudam.
 *
 * Aqui juntam-se, e gravam de uma vez (`PATCH /api/teams/:id`, numa transacção):
 * só vai o que mudou, e ou fica tudo ou não fica nada.
 *
 * A modalidade e a época não se mudam daqui: uma equipa com jogos que mudasse
 * de modalidade ficava com posições e provas que não são dela, e a época muda
 * pela viragem de época.
 */
export function EditTeamDialog({ team, onClose }: { team: Team; onClose: () => void }) {
  const { session } = useSession();
  const provas = useCatalogForSport("competitions", team.sportId);

  const [nome, setNome] = useState(team.name);
  const [idade, setIdade] = useState(String(team.maxAge));
  const [genero, setGenero] = useState<"" | TeamGender>(team.gender ?? "");
  const [minutos, setMinutos] = useState(team.matchMinutes == null ? "" : String(team.matchMinutes));
  const [convocados, setConvocados] = useState(team.maxCallUps == null ? "" : String(team.maxCallUps));
  const [escolhidas, setEscolhidas] = useState<Set<string>>(() => new Set(team.competitions.map((c) => c.id)));
  /* A da equipa; num servidor antigo, a da modalidade. */
  const volantesAntes = substituicoesVolantes(team.unlimitedSubs, sportById(team.sportId)?.code);
  const [volantes, setVolantes] = useState(volantesAntes);
  /* As partes do jogo: as da equipa, ou as da modalidade. Ver `Team.matchParts`. */
  const perfil = profileOf(sportById(team.sportId));
  const partesDaModalidade = partesDoJogo(perfil, null);
  const partesAntes = partesDoJogo(perfil, team.matchParts);
  /* Vazio são as da modalidade; uma equipa com as suas mostra o número. */
  const [partesTexto, setPartesTexto] = useState(team.matchParts == null ? "" : String(team.matchParts));
  const partes = lerPartes(partesTexto, partesDaModalidade);
  /* Partes com minutos diferentes (15 + 15 + 40), como estão gravadas. Ver `MinutosPorParte`. */
  const gravadas = minutosGravados(team.matchPartMinutes, partesAntes);
  const [porParte, setPorParte] = useState(gravadas.length > 0);
  const [valoresPartes, setValoresPartes] = useState<string[]>(gravadas);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const idadeN = Number(idade);
  const minutosN = Number(minutos);
  const convocadosN = Number(convocados);
  const nomeOk = nome.trim().length >= 2;
  const idadeOk = /^\d{1,2}$/.test(idade) && idadeN >= 4 && idadeN <= SEM_LIMITE;
  const minutosOk = minutos === "" || (Number.isInteger(minutosN) && minutosN >= 1 && minutosN <= 300);
  const convocadosOk = convocados === "" || (Number.isInteger(convocadosN) && convocadosN >= 1 && convocadosN <= 60);
  /* Os minutos de cada parte só contam com a caixa ligada e mais de uma parte. */
  const comPorParte = porParte && partes !== null && partes >= 2;
  const minutosDasPartes = comPorParte ? lerMinutosDasPartes(valoresPartes.slice(0, partes)) : null;
  const somaDasPartes = minutosDasPartes?.reduce((n, m) => n + m, 0) ?? null;
  /* A duração que vai ficar: a soma das partes, ou a escrita. Com partes iguais tem de se dividir nelas (60 em 3 dá 20). */
  const duracaoFinal = comPorParte ? somaDasPartes : minutos !== "" && minutosOk ? minutosN : team.matchMinutes;
  /* "3 partes de 20 minutos", "15 + 15 + 40 = 70 minutos", ou porque é que não dá. Ver `notaDasPartes`. */
  const nota = perfil
    ? notaDasPartes(partes, duracaoFinal, perfil.match.periodName, { ligado: comPorParte, minutos: minutosDasPartes })
    : null;
  const partesOk = !nota?.erro;
  const valido = nomeOk && idadeOk && (minutosOk || comPorParte) && convocadosOk && partesOk;
  const ligarPorParte = (ligado: boolean) => {
    // Começa pela duração repartida (70 em 3 dá 23 + 23 + 24), para só mexer no que muda.
    if (ligado && partes) setValoresPartes(repartir(minutos !== "" && minutosOk ? minutosN : team.matchMinutes, partes));
    setPorParte(ligado);
  };
  /* O que mudou nos minutos de cada parte: a lista nova, vazia para voltar às iguais, ou nada. */
  const listaMudou = minutosDasPartes
    ? minutosDasPartes.join(",") !== gravadas.join(",")
    : !comPorParte && gravadas.length > 0;

  /* "Amigável" está sempre: é o que torna a competição obrigatória num jogo possível. */
  const amigavel = provas.find((p) => p.label === AMIGAVEL);
  const ligar = (id: string) =>
    setEscolhidas((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;

    const antes = new Set(team.competitions.map((c) => c.id));
    const provasMudaram = antes.size !== escolhidas.size || [...escolhidas].some((id) => !antes.has(id));
    const patch = {
      ...(nome.trim() !== team.name ? { name: nome.trim() } : {}),
      ...(idadeN !== team.maxAge ? { maxAge: idadeN } : {}),
      ...(genero !== (team.gender ?? "") ? { gender: genero || null } : {}),
      // Com os minutos de cada parte, a duração é a soma deles.
      ...(comPorParte
        ? somaDasPartes !== null && somaDasPartes !== team.matchMinutes ? { matchMinutes: somaDasPartes } : {}
        : minutos !== "" && minutosN !== team.matchMinutes ? { matchMinutes: minutosN } : {}),
      ...(listaMudou ? { matchPartMinutes: minutosDasPartes ?? [] } : {}),
      ...(convocados !== "" && convocadosN !== team.maxCallUps ? { maxCallUps: convocadosN } : {}),
      ...(volantes !== volantesAntes ? { unlimitedSubs: volantes } : {}),
      // As da modalidade gravam-se como nulo: a equipa volta a segui-la.
      ...(partes !== null && partes !== partesAntes ? { matchParts: partes === partesDaModalidade ? null : partes } : {}),
      ...(provasMudaram ? { competitionIds: [...escolhidas] } : {}),
    };
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setBusy(true);
    setErro(null);
    try {
      await updateTeam(team.id, patch);
      await reloadAcademy();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível guardar.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="editar-equipa"
      title="Editar equipa"
      subtitle={team.name}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" form="form-editar-equipa" className="ctl-primary" disabled={!valido || busy}>
            {busy ? "A guardar…" : "Guardar"}
          </button>
        </>
      }
    >
      <form id="form-editar-equipa" onSubmit={guardar} className="space-y-4 p-5">
        {erro && (
          <p role="alert" className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">
            {erro}
          </p>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
          <DialogField label="Nome">
            <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} className={dialogInputClass} />
          </DialogField>
          <DialogField label="Idade máxima">
            <div
              className={cx(
                "flex h-9 items-center rounded-[var(--radius-control)] border bg-surface px-2.5 focus-within:border-signal-line",
                idade && !idadeOk ? "border-risk" : "border-line",
              )}
            >
              <span aria-hidden className="select-none text-body font-medium text-ink-3">
                Sub-
              </span>
              <input
                value={idade}
                onChange={(e) => setIdade(e.target.value.replace(/\D/g, "").slice(0, 2))}
                inputMode="numeric"
                aria-label="Idade máxima dos atletas da equipa"
                className="w-full min-w-0 bg-transparent text-body text-ink outline-none"
              />
            </div>
          </DialogField>
        </div>
        {idadeOk && idadeN !== team.maxAge && (
          <p className="-mt-2 text-meta text-ink-3">
            Passa a {teamAgeLabel(idadeN)}: é esta idade que decide quem pode ser convocado de outra equipa.
          </p>
        )}

        <DialogField label="Género" hint="opcional">
          <select value={genero} onChange={(e) => setGenero(e.target.value as "" | TeamGender)} className={dialogInputClass}>
            <option value="">Por indicar</option>
            {TEAM_GENDERS.map((g) => (
              <option key={g} value={g}>
                {TEAM_GENDER_LABEL[g]}
              </option>
            ))}
          </select>
        </DialogField>

        <div className={cx("grid gap-3", perfil ? "grid-cols-3" : "grid-cols-2")}>
          <DialogField label="Duração do jogo" hint={comPorParte ? "soma" : "minutos"}>
            {/* Com os minutos de cada parte, a duração é a soma deles e não se escreve. */}
            <input
              value={comPorParte ? (somaDasPartes ? String(somaDasPartes) : "") : minutos}
              onChange={(e) => setMinutos(e.target.value.replace(/\D/g, "").slice(0, 3))}
              readOnly={comPorParte}
              inputMode="numeric"
              placeholder={comPorParte ? "" : "60"}
              className={cx(dialogInputClass, !minutosOk && !comPorParte && "border-risk", comPorParte && "bg-sunken text-ink-3")}
            />
          </DialogField>
          {/* Em quantas partes se joga. Vazio são as da modalidade (a sugestão). Ver `Team.matchParts`. */}
          {perfil && (
            <DialogField label="Partes do jogo">
              <input
                value={partesTexto}
                onChange={(e) => setPartesTexto(e.target.value.replace(/\D/g, "").slice(0, 1))}
                inputMode="numeric"
                placeholder={String(partesDaModalidade)}
                aria-label="Partes do jogo"
                className={cx(dialogInputClass, nota?.erro && "border-risk")}
              />
            </DialogField>
          )}
          <DialogField label="Máximo de convocados">
            <input
              value={convocados}
              onChange={(e) => setConvocados(e.target.value.replace(/\D/g, "").slice(0, 2))}
              inputMode="numeric"
              placeholder="18"
              className={cx(dialogInputClass, !convocadosOk && "border-risk")}
            />
          </DialogField>
        </div>
        {perfil && partes !== null && partes >= 2 && (
          <MinutosPorParte
            partes={partes}
            nomeDaParte={perfil.match.periodName}
            ligado={porParte}
            onLigar={ligarPorParte}
            valores={valoresPartes}
            onValores={setValoresPartes}
          />
        )}
        {nota && <p className={cx("-mt-2 text-[11px] leading-relaxed", nota.erro ? "text-risk" : "text-ink-3")}>{nota.texto}</p>}
        <p className={cx("text-[11px] leading-relaxed text-ink-4", !nota && "-mt-2")}>
          A duração e as partes decidem os minutos de quem jogou até ao fim; mudam as fichas daqui para a frente, não
          as já gravadas.
        </p>

        <CampoSubstituicoes ligado={volantes} onChange={setVolantes} mudouComJogos={volantes !== volantesAntes} />

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="text-meta font-medium text-ink">Competições que disputa</span>
            {can(session, "settings:write") && (
              <Link
                to="/definicoes?catalogo=competitions"
                className="inline-flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink"
              >
                <Settings className="size-3" strokeWidth={1.75} />
                gerir provas
              </Link>
            )}
          </div>
          {provas.length === 0 ? (
            <p className="text-meta text-ink-3">O clube ainda não tem provas nas Definições.</p>
          ) : (
            <div className="grid max-h-44 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto rounded-[var(--radius-control)] border border-line p-2.5">
              {provas.map((p) => {
                const fixa = p.id === amigavel?.id;
                return (
                  <label
                    key={p.id}
                    className={cx("flex min-w-0 items-center gap-2 py-0.5", fixa ? "cursor-default" : "cursor-pointer")}
                  >
                    <input
                      type="checkbox"
                      checked={fixa || escolhidas.has(p.id)}
                      disabled={fixa}
                      onChange={() => ligar(p.id)}
                      className="size-3.5 shrink-0 accent-[var(--color-signal)]"
                    />
                    <span className={cx("truncate text-body", fixa || escolhidas.has(p.id) ? "text-ink" : "text-ink-3")}>
                      {p.label}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">
            É esta lista que o calendário oferece ao marcar um jogo desta equipa. "Amigável" está sempre.
          </p>
        </div>
      </form>
    </Dialog>
  );
}
