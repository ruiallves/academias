import { useEffect, useState } from "react";
import { academy, teamById } from "@/lib/api";
import { reloadAcademy, seasonList } from "@/lib/store";
import { can } from "@/lib/permissions";
import { gravarLicenca } from "@/lib/licencas";
import { useSession } from "@/session";
import type { Athlete } from "@/data/types";
import { dialogInputClass } from "./Dialog";
import { Empty, Panel, PanelHead, Pill } from "./primitives";

/**
 * O separador Licenças da ficha do atleta.
 *
 * Uma linha por modalidade do clube, numa época de cada vez (a atual por
 * omissão). As modalidades em que o atleta joga nessa época vêm primeiro, com
 * as equipas dele; as outras ficam por baixo, para o caso de um atleta estar
 * inscrito numa federação sem estar ainda numa equipa do clube.
 *
 * A licença é da modalidade e da época, e não da equipa: dois escalões de
 * futebol na mesma época são a mesma licença. Ver `AthleteLicense` na API.
 */
export function LicencasDoAtleta({ athlete }: { athlete: Athlete }) {
  const { session } = useSession();
  const podeEditar = can(session, "athlete:write");

  const actual = seasonList.find((s) => s.isCurrent) ?? seasonList[0];
  const [epocaId, setEpocaId] = useState(actual?.id ?? "");
  // Mudar de atleta volta à época atual.
  useEffect(() => setEpocaId(actual?.id ?? ""), [athlete.id, actual?.id]);
  const epoca = seasonList.find((s) => s.id === epocaId);

  if (!epoca || academy.sports.length === 0) {
    return (
      <Panel>
        <PanelHead title="Licenças" />
        <Empty title="Sem épocas ou modalidades" detail="As licenças guardam-se por modalidade e por época." />
      </Panel>
    );
  }

  // As equipas do atleta nesta época, por modalidade.
  const equipasPorModalidade = new Map<string, string[]>();
  for (const e of athlete.equipas) {
    const t = teamById(e.teamId);
    if (!t || t.season !== epoca.label) continue;
    equipasPorModalidade.set(t.sportId, [...(equipasPorModalidade.get(t.sportId) ?? []), t.name]);
  }
  const modalidades = [...academy.sports].sort(
    (a, b) => Number(equipasPorModalidade.has(b.id)) - Number(equipasPorModalidade.has(a.id)),
  );

  return (
    <Panel>
      <PanelHead title="Licenças">
        {seasonList.length > 1 && (
          <select
            aria-label="Época"
            value={epocaId}
            onChange={(e) => setEpocaId(e.target.value)}
            className={`${dialogInputClass} h-8 w-auto py-0 text-meta`}
          >
            {seasonList.map((s) => (
              <option key={s.id} value={s.id}>
                Época {s.label}
              </option>
            ))}
          </select>
        )}
      </PanelHead>
      <ul>
        {modalidades.map((sport) => (
          <LinhaDaLicenca
            key={`${sport.id}-${epoca.id}`}
            athleteId={athlete.id}
            sportId={sport.id}
            sportName={sport.name}
            seasonId={epoca.id}
            equipas={equipasPorModalidade.get(sport.id) ?? []}
            numero={athlete.licencas.find((l) => l.sportId === sport.id && l.seasonId === epoca.id)?.number ?? ""}
            podeEditar={podeEditar}
          />
        ))}
      </ul>
    </Panel>
  );
}

function LinhaDaLicenca({
  athleteId,
  sportId,
  sportName,
  seasonId,
  equipas,
  numero,
  podeEditar,
}: {
  athleteId: string;
  sportId: string;
  sportName: string;
  seasonId: string;
  equipas: string[];
  numero: string;
  podeEditar: boolean;
}) {
  const [valor, setValor] = useState(numero);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gravado, setGravado] = useState(false);
  useEffect(() => setValor(numero), [numero]);

  const mudou = valor.trim() !== numero;
  const joga = equipas.length > 0;

  async function guardar() {
    if (!mudou || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await gravarLicenca(athleteId, sportId, seasonId, valor.trim());
      await reloadAcademy();
      setGravado(true);
      setTimeout(() => setGravado(false), 1800);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-b border-line px-5 py-3.5 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-body font-medium text-ink">{sportName}</span>
          {!joga && <Pill>sem equipa nesta época</Pill>}
        </div>
        {joga && <p className="mt-0.5 truncate text-meta text-ink-3">{equipas.join(" · ")}</p>}
      </div>

      {podeEditar ? (
        <div className="mt-2 flex items-center gap-2">
          <input
            aria-label={`N.º de licença em ${sportName}`}
            value={valor}
            onChange={(e) => setValor(e.target.value.slice(0, 40))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void guardar();
              }
            }}
            placeholder="N.º de licença"
            autoComplete="off"
            className={`${dialogInputClass} min-w-0 flex-1 tabular`}
          />
          <button type="button" onClick={() => void guardar()} className="ctl-outline shrink-0" disabled={!mudou || busy}>
            {busy ? "A guardar…" : gravado && !mudou ? "Guardado" : valor.trim() === "" && numero ? "Apagar" : "Guardar"}
          </button>
        </div>
      ) : (
        <p className="mt-1 text-body text-ink tabular">{numero || <span className="text-ink-4">—</span>}</p>
      )}
      {erro && <p className="mt-1 text-meta text-risk">{erro}</p>}
    </li>
  );
}
