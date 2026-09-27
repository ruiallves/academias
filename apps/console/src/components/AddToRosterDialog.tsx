import { useMemo, useState } from "react";
import { Dialog } from "./Dialog";
import { cx, Monogram } from "./primitives";
import { Search } from "@/lib/icons";
import { listAthletes, naEquipa, teamById, today } from "@/lib/api";
import { apiPatch } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import { age, shortName } from "@/lib/format";
import type { Session } from "@/lib/permissions";
import type { Athlete, Team } from "@/data/types";

/**
 * Pôr atletas que já existem no plantel desta equipa.
 *
 * Até aqui, a única forma era abrir a ficha de cada atleta, editar e mudar a
 * equipa — um a um, longe do plantel que se estava a montar. Aqui escolhem-se
 * vários de uma lista, com a idade à frente, e ficam.
 *
 * ## Mudar na mesma modalidade, juntar noutra
 *
 * Um atleta pode estar em várias equipas (futebol e futsal). Por isso:
 *
 * - Se já está numa equipa **desta modalidade**, sai dela e entra nesta — é
 *   mudar de escalão, com a passagem antiga fechada no percurso. O número e a
 *   posição vêm com ele.
 * - Se as equipas dele são de **outras modalidades**, ficam: esta junta-se-lhes.
 *
 * Vai pela ficha (`PATCH /api/athletes/:id` com a lista de equipas), que é
 * onde vivem o âmbito, o percurso e o histórico. A lista diz, antes de gravar,
 * quem muda e quem junta.
 *
 * Quem saiu do clube não aparece: volta pelo estado da ficha, não por aqui.
 */
export function AddToRosterDialog({
  team,
  session,
  onClose,
}: {
  team: Team;
  session: Session;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /* Os que podem entrar: de outra equipa ou de nenhuma, e ainda no clube. */
  const candidatos = useMemo(
    () =>
      listAthletes(session)
        .filter((a) => !naEquipa(a, team.id) && a.status !== "left")
        .sort((a, b) => a.name.localeCompare(b.name, "pt")),
    [session, team.id],
  );

  const q = query.trim().toLowerCase();
  const visiveis = q ? candidatos.filter((a) => a.name.toLowerCase().includes(q)) : candidatos;
  const mesmaModalidade = (teamId: string) => teamById(teamId)?.sportId === team.sportId;
  /** A equipa desta modalidade de onde o atleta sai, se houver. */
  const deOndeSai = (a: Athlete) => a.equipas.find((e) => mesmaModalidade(e.teamId));
  const saemDeOutra = candidatos.filter((a) => escolhidos.has(a.id) && deOndeSai(a));

  /** As equipas com que o atleta fica: as de outras modalidades, e esta. */
  function equipasDepois(a: Athlete) {
    const sai = deOndeSai(a);
    return [
      ...a.equipas
        .filter((e) => !mesmaModalidade(e.teamId))
        .map((e) => ({ teamId: e.teamId, squadNumber: e.squadNumber ?? null, position: e.position ?? null })),
      { teamId: team.id, squadNumber: sai?.squadNumber ?? null, position: sai?.position ?? null },
    ];
  }

  const alternar = (id: string) =>
    setEscolhidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });

  async function adicionar() {
    if (escolhidos.size === 0 || busy) return;
    setBusy(true);
    setErro(null);
    const falharam: string[] = [];
    /*
     * Um a um, pelo caminho da ficha: é lá que vive a regra do âmbito, o fecho
     * da passagem antiga e o histórico. Um que falhe não trava os outros.
     */
    for (const id of escolhidos) {
      try {
        const atleta = candidatos.find((a) => a.id === id);
        if (!atleta) continue;
        await apiPatch(`/api/athletes/${id}`, { equipas: equipasDepois(atleta) });
      } catch (e) {
        const nome = candidatos.find((a) => a.id === id)?.name ?? "Atleta";
        falharam.push(`${shortName(nome)}: ${e instanceof Error ? e.message : "não foi possível"}`);
      }
    }
    await reloadAcademy();
    setBusy(false);
    if (falharam.length) {
      setErro(falharam.join(" · "));
      setEscolhidos(new Set());
    } else {
      onClose();
    }
  }

  return (
    <Dialog
      labelledBy="adicionar-ao-plantel"
      title="Adicionar atletas"
      subtitle={team.name}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="button" onClick={() => void adicionar()} className="ctl-primary" disabled={escolhidos.size === 0 || busy}>
            {busy
              ? "A adicionar…"
              : escolhidos.size === 0
                ? "Adicionar"
                : `Adicionar ${escolhidos.size} ${escolhidos.size === 1 ? "atleta" : "atletas"}`}
          </button>
        </>
      }
    >
      <div className="space-y-3 p-5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Procurar atleta…"
            aria-label="Procurar atleta"
            className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface pr-2.5 pl-8 text-body text-ink placeholder:text-ink-4 focus:border-line-strong focus:outline-none"
          />
        </div>

        {candidatos.length === 0 ? (
          <p className="py-6 text-center text-meta text-ink-3">
            Todos os atletas que vês já estão nesta equipa. Para um atleta novo, usa "Novo atleta".
          </p>
        ) : (
          <ul className="max-h-[320px] overflow-y-auto rounded-[var(--radius-control)] border border-line">
            {visiveis.length === 0 && <li className="px-3 py-4 text-center text-meta text-ink-3">Nenhum atleta com esse nome.</li>}
            {visiveis.map((a) => {
              const marcado = escolhidos.has(a.id);
              const sai = deOndeSai(a);
              const outras = a.equipas.filter((e) => !mesmaModalidade(e.teamId)).map((e) => teamById(e.teamId)?.name).filter(Boolean);
              const idade = age(new Date(a.birthdate), today);
              const acimaDaIdade = team.maxAge < 99 && idade > team.maxAge;
              return (
                <li key={a.id} className="border-b border-line last:border-0">
                  <label className={cx("flex cursor-pointer items-center gap-2.5 px-3 py-2", marcado && "bg-signal-soft/30")}>
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => alternar(a.id)}
                      className="size-3.5 shrink-0 accent-[var(--color-signal)]"
                    />
                    <Monogram name={a.name} photoUrl={a.photoUrl} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-ink">{a.name}</span>
                      <span className="block truncate text-meta text-ink-3">
                        {idade} anos ·{" "}
                        {sai
                          ? `está no ${teamById(sai.teamId)?.name ?? "outro escalão"}`
                          : outras.length > 0
                            ? `também joga em ${outras.join(" · ")}`
                            : "sem equipa"}
                        {a.status === "paused" && " · em pausa"}
                      </span>
                    </span>
                    {acimaDaIdade && (
                      <span className="shrink-0 text-[11px] font-medium text-warn" title={`A equipa é até aos ${team.maxAge} anos`}>
                        acima da idade
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {saemDeOutra.length > 0 && (
          <p className="rounded-[var(--radius-control)] bg-warn-soft px-3 py-2 text-meta leading-relaxed text-warn">
            {saemDeOutra.length === 1
              ? `${shortName(saemDeOutra[0].name)} sai do ${teamById(deOndeSai(saemDeOutra[0])?.teamId ?? "")?.name ?? "escalão onde está"} e passa para esta equipa.`
              : `${saemDeOutra.length} atletas saem do escalão desta modalidade onde estão e passam para esta equipa.`}{" "}
            A passagem antiga fica no percurso de cada um. As equipas de outras modalidades ficam como estão.
          </p>
        )}

        {erro && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{erro}</p>}
      </div>
    </Dialog>
  );
}
