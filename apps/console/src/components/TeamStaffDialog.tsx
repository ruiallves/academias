import { useMemo, useState } from "react";
import { listCoachCandidates, listTeams, staffById } from "@/lib/api";
import { teamAgeLabel } from "@/lib/team-age";
import { apiPatch } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import { can, type Session } from "@/lib/permissions";
import { ROLE_LABEL } from "@/session";
import { Dialog } from "./Dialog";
import { Monogram, cx } from "./primitives";

/**
 * Quem treina o quê — a mesma ligação, das duas pontas.
 *
 * ## Porque é que isto saiu de "Editar ficha"
 *
 * Vivia lá dentro, misturado com o nome, o email e o telemóvel. "Editar ficha" é
 * para corrigir os dados de uma pessoa; decidir que escalões ela treina é outra
 * coisa — é âmbito de dados, e é o gesto que se faz no início de cada época sem
 * ter nada para corrigir na ficha. Quem procurava "atribuir um treinador" não
 * tinha razão nenhuma para abrir um formulário chamado "editar ficha".
 *
 * ## Porque é que é um componente só para as duas direcções
 *
 * A pergunta é a mesma ligação vista de dois lados: da página da equipa
 * pergunta-se *quem a treina*, da página da pessoa pergunta-se *o que ela
 * treina*. Dois diálogos separados divergiriam ao segundo retoque — e a regra de
 * quem pode aparecer na lista, ou de como se grava, é uma só.
 *
 * ## Como grava
 *
 * O servidor só tem um endereço para isto, `PATCH /api/staff/:id/teams`, e ele
 * recebe a **lista completa** de equipas de uma pessoa. Do lado da equipa, isso
 * quer dizer reenviar as equipas que cada pessoa já tinha, mais (ou menos) esta —
 * nunca só a que se acabou de escolher, que apagaria as outras. Ver `setTeams`.
 */

type Modo =
  /** Da página da equipa: escolhem-se pessoas. */
  | { tipo: "equipa"; teamId: string; teamName: string }
  /** Da página da pessoa: escolhem-se equipas. */
  | { tipo: "pessoa"; membershipId: string };

export function TeamStaffDialog({
  modo,
  session,
  onClose,
}: {
  modo: Modo;
  session: Session;
  onClose: () => void;
}) {
  const mayWrite = can(session, "access:write");
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * Quem pode ser escolhido, ou o que pode ser escolhido.
   *
   * `listCoachCandidates` é "quem trabalha cá e não é família" — e não "quem já
   * treina alguma coisa", que numa academia acabada de abrir é ninguém e deixava
   * a primeira atribuição impossível de fazer.
   */
  const candidatos = useMemo(() => (modo.tipo === "equipa" ? listCoachCandidates() : []), [modo]);
  const equipas = useMemo(() => (modo.tipo === "pessoa" ? listTeams(session) : []), [modo, session]);

  const pessoa = modo.tipo === "pessoa" ? staffById(modo.membershipId) : undefined;

  const iniciais = useMemo(() => {
    if (modo.tipo === "equipa") return candidatos.filter((c) => c.teamIds.includes(modo.teamId)).map((c) => c.id);
    return pessoa?.teamIds ?? [];
  }, [modo, candidatos, pessoa]);

  const [escolhidos, setEscolhidos] = useState<string[]>(iniciais);

  const mudou =
    escolhidos.length !== iniciais.length || escolhidos.some((id) => !iniciais.includes(id));

  function alternar(id: string) {
    setEscolhidos((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  }

  async function gravar() {
    if (!mudou || busy) return;
    setBusy(true);
    setErro(null);

    try {
      if (modo.tipo === "pessoa") {
        await apiPatch(`/api/staff/${modo.membershipId}/teams`, { teamIds: escolhidos });
      } else {
        /*
         * Um pedido por pessoa que mudou, e só por essas.
         *
         * Mandar a lista de toda a gente seria reescrever atribuições que
         * ninguém tocou — e cada uma dessas escritas é uma oportunidade de
         * apagar uma equipa que a pessoa treina noutro escalão.
         */
        const antes = new Set(iniciais);
        const agora = new Set(escolhidos);
        const mexidos = candidatos.filter((c) => antes.has(c.id) !== agora.has(c.id));

        for (const c of mexidos) {
          const teamIds = agora.has(c.id)
            ? [...new Set([...c.teamIds, modo.teamId])]
            : c.teamIds.filter((t) => t !== modo.teamId);
          await apiPatch(`/api/staff/${c.id}/teams`, { teamIds });
        }
      }

      await reloadAcademy();
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  const titulo = modo.tipo === "equipa" ? "Quem treina esta equipa" : "Equipas";
  const subtitulo = modo.tipo === "equipa" ? modo.teamName : pessoa?.name;

  return (
    <Dialog
      labelledBy="equipas-staff"
      title={titulo}
      subtitle={subtitulo}
      onClose={onClose}
      width={480}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void gravar()}
            disabled={!mayWrite || !mudou || busy}
            className="ctl-primary"
          >
            {busy ? "A guardar…" : "Guardar"}
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-5">
        {!mayWrite && (
          <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta leading-relaxed text-ink-2">
            As equipas são geridas por quem trata de permissões na academia.
          </p>
        )}

        <div className="max-h-72 overflow-y-auto rounded-[var(--radius-control)] border border-line">
          {modo.tipo === "equipa"
            ? candidatos.map((c) => (
                <Linha
                  key={c.id}
                  marcado={escolhidos.includes(c.id)}
                  disabled={!mayWrite}
                  onToggle={() => alternar(c.id)}
                >
                  <Monogram name={c.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-ink">{c.name}</span>
                    <span className="block truncate text-meta text-ink-4">
                      {c.title || ROLE_LABEL[c.role]}
                    </span>
                  </span>
                  {/* Quantas equipas já tem: atribuir a quinta a alguém é uma
                      decisão diferente de lhe atribuir a primeira. */}
                  {c.teamIds.length > 0 && (
                    <span className="shrink-0 text-meta text-ink-4">
                      {c.teamIds.length} {c.teamIds.length === 1 ? "equipa" : "equipas"}
                    </span>
                  )}
                </Linha>
              ))
            : equipas.map((t) => (
                <Linha
                  key={t.id}
                  marcado={escolhidos.includes(t.id)}
                  disabled={!mayWrite}
                  onToggle={() => alternar(t.id)}
                >
                  <span className="min-w-0 flex-1 truncate text-body text-ink">{t.name}</span>
                  <span className="shrink-0 text-meta text-ink-4">{teamAgeLabel(t.maxAge)}</span>
                </Linha>
              ))}
        </div>

        <p className="text-[11px] leading-relaxed text-ink-3">
          As equipas decidem que atletas cada pessoa vê — incluindo presenças, avaliações e boletim clínico.
        </p>

        {erro && (
          <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2.5 text-meta leading-relaxed text-risk">
            {erro}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function Linha({
  marcado,
  disabled,
  onToggle,
  children,
}: {
  marcado: boolean;
  disabled: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cx(
        "flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0",
        disabled ? "opacity-60" : "cursor-pointer hover:bg-sunken",
      )}
    >
      <input
        type="checkbox"
        checked={marcado}
        disabled={disabled}
        onChange={onToggle}
        className="size-3.5 shrink-0 accent-[var(--color-signal)]"
      />
      {children}
    </label>
  );
}
