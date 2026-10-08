import { academy, sportById, teamById } from "@/lib/api";
import { epocaDaEquipa } from "@/lib/licencas";
import { Plus, X } from "@/lib/icons";
import type { Athlete, Team } from "@/data/types";
import { dialogInputClass } from "./Dialog";
import { cx } from "./primitives";

/**
 * As equipas de um atleta, no formulário: uma linha por equipa.
 *
 * ## Porquê uma lista
 *
 * Um atleta pode praticar várias modalidades (futebol e futsal) ou jogar em dois
 * escalões da mesma. Cada linha pergunta, por esta ordem, **a modalidade, a
 * equipa, o número e a posição** — o número e a posição são de cada equipa: o 10
 * no futebol pode ser o 7 no futsal. "Acrescentar outra modalidade" abre mais uma.
 *
 * A modalidade só aparece quando o clube tem mais do que uma: num clube só de
 * futebol, perguntá-la em cada linha era uma pergunta sem escolha. A posição só
 * aparece quando a modalidade as tem (natação não tem).
 *
 * ## As equipas fora do âmbito
 *
 * Na edição, uma equipa do atleta que quem edita não gere (o treinador do
 * futsal a olhar para um atleta que também joga futebol) aparece, mas fechada:
 * é do atleta, e o servidor recusa mexer-lhe a quem não a gere. Ver
 * `aplicarEquipas` na API.
 *
 * Usado na inscrição (`NewAthleteDialog`) e na ficha (`AthleteEditPanel`).
 */

export type LinhaDeEquipa = {
  /** Só para o React: a linha é a mesma enquanto se muda a equipa. */
  chave: string;
  sportId: string;
  teamId: string;
  squadNumber: string;
  position: string;
  /** Uma equipa do atleta que quem edita não gere — mostra-se, não se muda. */
  fechada?: boolean;
  /**
   * O n.º de licença na modalidade desta equipa, na época dela. Só na
   * inscrição (`comLicenca`): depois gere-se no separador Licenças da ficha.
   */
  licenseNumber?: string;
};

let contador = 0;
const novaChave = () => `linha-${++contador}`;

/** Uma linha nova, na primeira equipa da modalidade (ou da primeira modalidade com equipas). */
export function linhaNova(teams: Team[], sportId?: string, teamId?: string): LinhaDeEquipa {
  const equipa = (teamId && teams.find((t) => t.id === teamId)) || teams.find((t) => !sportId || t.sportId === sportId) || teams[0];
  return {
    chave: novaChave(),
    sportId: equipa?.sportId ?? sportId ?? "",
    teamId: equipa?.id ?? "",
    squadNumber: "",
    position: "",
  };
}

/** As linhas de um atleta que já existe, a principal primeiro. */
export function linhasDoAtleta(athlete: Athlete, noAmbito: Team[]): LinhaDeEquipa[] {
  return athlete.equipas.map((e) => ({
    chave: novaChave(),
    sportId: teamById(e.teamId)?.sportId ?? "",
    teamId: e.teamId,
    squadNumber: e.squadNumber?.toString() ?? "",
    position: e.position ?? "",
    fechada: !noAmbito.some((t) => t.id === e.teamId),
  }));
}

/** O que vai para a API (`equipas` em `POST`/`PATCH /api/athletes`). */
export function equipasParaApi(linhas: LinhaDeEquipa[]) {
  // A licença vai só da primeira linha de cada modalidade e época (ver o campo).
  const vistas = new Set<string>();
  return linhas.map((l) => {
    const chave = `${teamById(l.teamId)?.sportId ?? l.sportId}|${epocaDaEquipa(l.teamId) ?? ""}`;
    const dona = !vistas.has(chave);
    vistas.add(chave);
    return { ...l, licenseNumber: dona ? l.licenseNumber : undefined };
  }).map((l) => ({
    teamId: l.teamId,
    squadNumber: l.squadNumber === "" ? null : Number(l.squadNumber),
    position: l.position.trim() || null,
    ...(l.licenseNumber?.trim() ? { licenseNumber: l.licenseNumber.trim() } : {}),
  }));
}

/** Uma equipa escolhida em cada linha, e nenhuma repetida. Devolve o que falta, ou nulo. */
export function problemaDasEquipas(linhas: LinhaDeEquipa[]): string | null {
  if (linhas.length === 0) return "Escolhe pelo menos uma equipa.";
  if (linhas.some((l) => !l.teamId)) return "Escolhe a equipa de cada linha.";
  if (new Set(linhas.map((l) => l.teamId)).size !== linhas.length) return "A mesma equipa aparece duas vezes.";
  return null;
}

export function EquipasDoAtletaField({
  linhas,
  onChange,
  teams,
  comLicenca = false,
}: {
  linhas: LinhaDeEquipa[];
  onChange: (linhas: LinhaDeEquipa[]) => void;
  /** As equipas que quem preenche pode escolher (o âmbito dele). */
  teams: Team[];
  /** Pergunta o n.º de licença em cada linha. Só na inscrição. */
  comLicenca?: boolean;
}) {
  // As modalidades que têm equipas que se podem escolher, pela ordem do clube.
  const modalidades = academy.sports.filter((s) => teams.some((t) => t.sportId === s.id));
  const variasModalidades = modalidades.length > 1;
  const escolhidas = new Set(linhas.map((l) => l.teamId));
  const problema = problemaDasEquipas(linhas);

  /*
   * A licença é da modalidade e da época, não da equipa: o Sub-13 e o Sub-15 de
   * futebol na mesma época são a mesma inscrição. O campo aparece na primeira
   * linha de cada modalidade e época; as outras dizem que usam essa.
   */
  const chaveDaLicenca = (l: LinhaDeEquipa) => `${teamById(l.teamId)?.sportId ?? l.sportId}|${epocaDaEquipa(l.teamId) ?? ""}`;
  const donaDaLicenca = new Map<string, number>();
  linhas.forEach((l, i) => {
    if (l.teamId && !donaDaLicenca.has(chaveDaLicenca(l))) donaDaLicenca.set(chaveDaLicenca(l), i);
  });

  const mudar = (chave: string, patch: Partial<LinhaDeEquipa>) =>
    onChange(linhas.map((l) => (l.chave === chave ? { ...l, ...patch } : l)));

  /*
   * A modalidade seguinte que o atleta ainda não pratica — é o que "Acrescentar
   * outra modalidade" costuma querer dizer. Se já tem todas, abre na primeira:
   * pode ser um segundo escalão da mesma.
   */
  function acrescentar() {
    const usadas = new Set(linhas.map((l) => l.sportId));
    const proxima = modalidades.find((s) => !usadas.has(s.id))?.id;
    const livres = teams.filter((t) => !escolhidas.has(t.id));
    const equipa = livres.find((t) => !proxima || t.sportId === proxima) ?? livres[0];
    onChange([...linhas, linhaNova(teams, equipa?.sportId, equipa?.id)]);
  }

  return (
    <div className="space-y-2">
      {linhas.map((l, i) => {
        const equipasDaModalidade = teams.filter((t) => t.sportId === l.sportId);
        const posicoes = sportById(l.sportId)?.positions ?? [];
        const nome = teamById(l.teamId)?.name ?? "Equipa";
        const principal = i === 0 && linhas.length > 1;

        if (l.fechada) {
          return (
            <div key={l.chave} className="rounded-[var(--radius-control)] border border-line bg-sunken/40 px-3 py-2.5">
              <div className="text-body text-ink-2">
                {variasModalidades && <span className="text-ink-3">{sportById(l.sportId)?.name} · </span>}
                {nome}
                {l.squadNumber && <span className="text-ink-3"> · n.º {l.squadNumber}</span>}
                {l.position && <span className="text-ink-3"> · {l.position}</span>}
              </div>
              <p className="mt-0.5 text-[11px] text-ink-4">Equipa fora do teu âmbito: fica como está.</p>
            </div>
          );
        }

        return (
          <div key={l.chave} className="rounded-[var(--radius-control)] border border-line px-3 py-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 text-meta font-medium text-ink">
                {linhas.length === 1 ? "Equipa" : `Equipa ${i + 1}`}
                {principal && <span className="font-normal text-ink-4"> · principal</span>}
              </span>
              {linhas.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange(linhas.filter((x) => x.chave !== l.chave))}
                  className="ctl-ghost h-7 px-2 text-meta"
                  aria-label={`Tirar ${nome}`}
                >
                  <X className="size-3.5" strokeWidth={1.75} />
                  Tirar
                </button>
              )}
            </div>

            <div className={cx("grid gap-2", variasModalidades ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "grid-cols-1")}>
              {variasModalidades && (
                <select
                  aria-label="Modalidade"
                  value={l.sportId}
                  onChange={(e) => {
                    // Mudar de modalidade leva a primeira equipa livre dela, e a posição
                    // de outra modalidade deixa de fazer sentido.
                    const sportId = e.target.value;
                    const equipa =
                      teams.find((t) => t.sportId === sportId && !escolhidas.has(t.id)) ??
                      teams.find((t) => t.sportId === sportId);
                    mudar(l.chave, { sportId, teamId: equipa?.id ?? "", position: "" });
                  }}
                  className={dialogInputClass}
                >
                  {modalidades.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
              <select
                aria-label="Equipa"
                value={l.teamId}
                onChange={(e) => mudar(l.chave, { teamId: e.target.value })}
                className={dialogInputClass}
              >
                {l.teamId === "" && <option value="">Escolhe a equipa</option>}
                {equipasDaModalidade.map((t) => (
                  <option key={t.id} value={t.id} disabled={t.id !== l.teamId && escolhidas.has(t.id)}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={cx("mt-2 grid gap-2", posicoes.length > 0 ? "grid-cols-[96px_minmax(0,1fr)]" : "grid-cols-[96px]")}>
              <input
                aria-label={`Número em ${nome}`}
                placeholder="Número"
                value={l.squadNumber}
                onChange={(e) => mudar(l.chave, { squadNumber: e.target.value.replace(/\D/g, "").slice(0, 3) })}
                inputMode="numeric"
                className={dialogInputClass}
              />
              {posicoes.length > 0 && (
                <select
                  aria-label={`Posição em ${nome}`}
                  value={l.position}
                  onChange={(e) => mudar(l.chave, { position: e.target.value })}
                  className={dialogInputClass}
                >
                  <option value="">Posição (opcional)</option>
                  {posicoes.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {comLicenca && l.teamId && donaDaLicenca.get(chaveDaLicenca(l)) !== i ? (
              <p className="mt-2 text-[11px] text-ink-4">
                Usa a licença da equipa {(donaDaLicenca.get(chaveDaLicenca(l)) ?? 0) + 1}: na mesma modalidade e época, a licença é a mesma.
              </p>
            ) : comLicenca && (
              <input
                aria-label={`N.º de licença em ${nome}`}
                placeholder={`N.º de licença${variasModalidades ? ` em ${sportById(l.sportId)?.name ?? "esta modalidade"}` : ""} (opcional)`}
                value={l.licenseNumber ?? ""}
                onChange={(e) => mudar(l.chave, { licenseNumber: e.target.value.slice(0, 40) })}
                autoComplete="off"
                className={cx(dialogInputClass, "mt-2")}
              />
            )}
          </div>
        );
      })}

      {teams.some((t) => !escolhidas.has(t.id)) && (
        <button type="button" onClick={acrescentar} className="ctl-outline">
          <Plus className="size-3.5" strokeWidth={2} />
          {variasModalidades ? "Acrescentar outra modalidade" : "Acrescentar outra equipa"}
        </button>
      )}

      {problema && linhas.length > 0 && <p className="text-[11px] text-ink-3">{problema}</p>}
    </div>
  );
}
