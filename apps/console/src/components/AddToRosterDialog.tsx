import { useMemo, useState } from "react";
import { Dialog } from "./Dialog";
import { cx, Monogram } from "./primitives";
import { Spinner } from "./Busy";
import { Search } from "@/lib/icons";
import { listAthletes, today } from "@/lib/api";
import { apiPost } from "@/lib/http";
import { useApi } from "@/lib/query";
import { reloadAcademy } from "@/lib/store";
import { age } from "@/lib/format";
import type { Session } from "@/lib/permissions";
import type { Team } from "@/data/types";

/** Um atleta do clube que pode entrar nesta equipa. Ver `candidatosParaEquipa` na API. */
type Candidato = {
  id: string;
  name: string;
  birthdate: string;
  equipas: { teamId: string; nome: string; sportId: string }[];
};

/**
 * Pôr atletas que já existem no plantel desta equipa.
 *
 * Aqui escolhem-se vários de uma lista, com a idade à frente, e ficam.
 *
 * ## Qualquer atleta do clube, e fica onde estava
 *
 * Há atletas que treinam e jogam em dois escalões. A lista vem do servidor e
 * traz **todos** os atletas activos do clube, e não só os que esta pessoa já
 * vê: o treinador do segundo escalão não os tinha na consola, tentava
 * inscrevê-los outra vez e levava "Já existe um atleta com este NIF".
 *
 * O atleta entra nesta equipa **sem sair das outras**, e o outro treinador não
 * é avisado (decisão do clube: é desportiva e não lhe tira nada). Mudar de
 * escalão, que é sair de uma e entrar noutra, faz-se na ficha do atleta.
 *
 * Quem saiu do clube não aparece: volta pelo estado da ficha, não por aqui.
 * Quem tem idade acima da equipa também não: o servidor filtra e recusa, pela
 * idade do ano da época (a mesma regra das convocatórias).
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

  const lista = useApi<Candidato[]>(`/api/teams/${team.id}/candidatos`);
  /* As fotografias dos que esta pessoa já vê; os outros ficam com as iniciais. */
  const fotos = useMemo(() => new Map(listAthletes(session).map((a) => [a.id, a.photoUrl])), [session]);

  const candidatos = lista.data ?? [];
  const q = query.trim().toLowerCase();
  const visiveis = q ? candidatos.filter((a) => a.name.toLowerCase().includes(q)) : candidatos;

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
    try {
      await apiPost(`/api/teams/${team.id}/atletas`, { athleteIds: [...escolhidos] });
      await reloadAcademy();
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível adicionar.");
      setBusy(false);
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
            placeholder="Procurar atleta do clube…"
            aria-label="Procurar atleta"
            className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface pr-2.5 pl-8 text-body text-ink placeholder:text-ink-4 focus:border-line-strong focus:outline-none"
          />
        </div>

        {/* Só quem cabe na idade: um mais novo pode jogar acima, um mais velho não joga abaixo. */}
        {team.maxAge < 99 && (
          <p className="text-meta text-ink-3">Aparecem os atletas do clube até aos {team.maxAge} anos, a idade do ano da época.</p>
        )}

        {lista.loading && !lista.data ? (
          <Spinner className="py-6" />
        ) : lista.error && !lista.data ? (
          <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{lista.error}</p>
        ) : candidatos.length === 0 ? (
          <p className="py-6 text-center text-meta text-ink-3">
            {team.maxAge < 99
              ? `Não há mais atletas do clube até aos ${team.maxAge} anos fora desta equipa. Para um atleta novo, usa "Novo atleta".`
              : `Todos os atletas do clube já estão nesta equipa. Para um atleta novo, usa "Novo atleta".`}
          </p>
        ) : (
          <ul className="max-h-[320px] overflow-y-auto rounded-[var(--radius-control)] border border-line">
            {visiveis.length === 0 && <li className="px-3 py-4 text-center text-meta text-ink-3">Nenhum atleta com esse nome.</li>}
            {visiveis.map((a) => {
              const marcado = escolhidos.has(a.id);
              const idade = age(new Date(a.birthdate), today);
              return (
                <li key={a.id} className="border-b border-line last:border-0">
                  <label className={cx("flex cursor-pointer items-center gap-2.5 px-3 py-2", marcado && "bg-signal-soft/30")}>
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => alternar(a.id)}
                      className="size-3.5 shrink-0 accent-[var(--color-signal)]"
                    />
                    <Monogram name={a.name} photoUrl={fotos.get(a.id)} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-ink">{a.name}</span>
                      <span className="block truncate text-meta text-ink-3">
                        {idade} anos · {a.equipas.length > 0 ? `está em ${a.equipas.map((e) => e.nome).join(" · ")}` : "sem equipa"}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {escolhidos.size > 0 && (
          <p className="text-meta leading-relaxed text-ink-3">
            Ficam também nas equipas onde já estão. Para mudar um atleta de escalão, edita as equipas na ficha dele.
          </p>
        )}

        {erro && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{erro}</p>}
      </div>
    </Dialog>
  );
}
