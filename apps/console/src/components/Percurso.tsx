import { useEffect, useState } from "react";
import { Empty, Loading, Panel, PanelHead, Pill } from "@/components/primitives";
import { apiGet } from "@/lib/http";
import { shortDate } from "@/lib/format";

/**
 * Por onde esta pessoa já passou — e quem já passou por esta equipa.
 *
 * ## O que isto responde
 *
 * "Este miúdo veio de onde?", "quem é que treinou o Sub-13 em 2025/26?", "quem
 * passou por esta equipa?". Até agora não havia resposta nenhuma: mudar de
 * escalão reescrevia a ligação à equipa e o ano anterior desaparecia. As
 * passagens passaram a ter entrada e saída (ver a migração
 * `20260920140000_percurso_e_epoca_nova`), e isto lê-as.
 *
 * Uma passagem sem data de saída é o presente, e diz-se "agora" em vez de uma
 * data que ainda não aconteceu.
 */

type PassagemDoAtleta = {
  teamId: string;
  teamName: string;
  season: string;
  position: string | null;
  joinedAt: string;
  leftAt: string | null;
};

type PassagemDoStaff = {
  teamId: string;
  teamName: string;
  season: string;
  title: string;
  joinedAt: string;
  leftAt: string | null;
};

type PercursoDaEquipa = {
  team: { id: string; name: string; season: string };
  veioDe: { id: string; name: string; season: string } | null;
  atletas: { id: string; name: string; status: string; position: string | null; joinedAt: string; leftAt: string | null }[];
  treinadores: { membershipId: string; name: string; title: string; joinedAt: string; leftAt: string | null }[];
};

function useCarregar<T>(url: string) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    apiGet<T>(url)
      .then((r) => vivo && setDados(r))
      .catch((e: Error) => vivo && setErro(e.message));
    return () => {
      vivo = false;
    };
  }, [url]);
  return { dados, erro };
}

/** O intervalo de uma passagem, como se lê: "ago 2026 — agora". */
function intervalo(de: string, ate: string | null): string {
  return `${shortDate(new Date(de))} — ${ate ? shortDate(new Date(ate)) : "agora"}`;
}

/** O percurso de um atleta: escalões e épocas, do mais recente para trás. */
export function PercursoDoAtleta({ athleteId }: { athleteId: string }) {
  const { dados, erro } = useCarregar<PassagemDoAtleta[]>(`/api/athletes/${athleteId}/percurso`);

  return (
    <Panel>
      <PanelHead title="Percurso" hint="escalões por onde passou" />
      {erro ? (
        <div className="p-5"><Empty title="Não foi possível carregar" detail={erro} /></div>
      ) : !dados ? (
        <div className="p-5"><Loading size="panel" /></div>
      ) : dados.length === 0 ? (
        <div className="p-5"><Empty title="Sem passagens" detail="Este atleta ainda não esteve em nenhuma equipa." /></div>
      ) : (
        <ul className="px-5 py-1.5">
          {dados.map((p, i) => (
            <li key={`${p.teamId}-${p.joinedAt}-${i}`} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-ink">{p.teamName}</span>
                <span className="block truncate text-meta text-ink-3">
                  Época {p.season} · {intervalo(p.joinedAt, p.leftAt)}
                  {p.position ? ` · ${p.position}` : ""}
                </span>
              </span>
              {p.leftAt === null && <Pill tone="ok">agora</Pill>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** O mesmo para um treinador: que equipas treinou, e com que função. */
export function PercursoDoStaff({ membershipId }: { membershipId: string }) {
  const { dados, erro } = useCarregar<PassagemDoStaff[]>(`/api/staff/${membershipId}/percurso`);

  return (
    <Panel>
      <PanelHead title="Percurso" hint="equipas que treinou" />
      {erro ? (
        <div className="p-5"><Empty title="Não foi possível carregar" detail={erro} /></div>
      ) : !dados ? (
        <div className="p-5"><Loading size="panel" /></div>
      ) : dados.length === 0 ? (
        <div className="p-5"><Empty title="Sem equipas" detail="Esta pessoa ainda não teve equipas atribuídas." /></div>
      ) : (
        <ul className="px-5 py-1.5">
          {dados.map((p, i) => (
            <li key={`${p.teamId}-${p.joinedAt}-${i}`} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-ink">{p.teamName}</span>
                <span className="block truncate text-meta text-ink-3">
                  Época {p.season} · {p.title} · {intervalo(p.joinedAt, p.leftAt)}
                </span>
              </span>
              {p.leftAt === null && <Pill tone="ok">agora</Pill>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** De onde a equipa veio, e quem passou por ela — incluindo quem já saiu. */
export function PercursoDaEquipa({ teamId }: { teamId: string }) {
  const { dados, erro } = useCarregar<PercursoDaEquipa>(`/api/teams/${teamId}/percurso`);

  if (erro) {
    return (
      <Panel>
        <PanelHead title="Passaram por aqui" />
        <div className="p-5"><Empty title="Não foi possível carregar" detail={erro} /></div>
      </Panel>
    );
  }
  if (!dados) {
    return (
      <Panel>
        <PanelHead title="Passaram por aqui" />
        <div className="p-5"><Loading size="panel" /></div>
      </Panel>
    );
  }

  const sairam = dados.atletas.filter((a) => a.leftAt !== null);

  return (
    <Panel>
      <PanelHead
        title="Passaram por aqui"
        hint={dados.veioDe ? `vem do ${dados.veioDe.name} de ${dados.veioDe.season}` : `época ${dados.team.season}`}
      />
      <div className="space-y-4 p-5">
        <div>
          <p className="mb-1.5 text-meta font-medium text-ink">Treinadores</p>
          {dados.treinadores.length === 0 ? (
            <p className="text-meta text-ink-3">Nenhum, nesta época.</p>
          ) : (
            <ul className="space-y-1">
              {dados.treinadores.map((t, i) => (
                <li key={`${t.membershipId}-${i}`} className="flex items-baseline gap-2 text-meta">
                  <span className="min-w-0 flex-1 truncate text-ink-2">
                    {t.name} · {t.title}
                  </span>
                  <span className="shrink-0 text-ink-4">{intervalo(t.joinedAt, t.leftAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {sairam.length > 0 && (
          <div>
            <p className="mb-1.5 text-meta font-medium text-ink">Atletas que saíram do plantel</p>
            <ul className="space-y-1">
              {sairam.map((a, i) => (
                <li key={`${a.id}-${i}`} className="flex items-baseline gap-2 text-meta">
                  <span className="min-w-0 flex-1 truncate text-ink-2">{a.name}</span>
                  <span className="shrink-0 text-ink-4">{intervalo(a.joinedAt, a.leftAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}
