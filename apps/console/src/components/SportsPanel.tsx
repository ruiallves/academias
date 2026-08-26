import { useState, type FormEvent } from "react";
import { Panel, PanelHead, Pill } from "@/components/primitives";
import { Plus, Trash2 } from "@/lib/icons";
import { apiDelete, apiPatch, apiPost } from "@/lib/http";
import { reloadAcademy, useStore } from "@/lib/store";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { CatalogPanel } from "./CatalogPanel";
import { CATALOG_KEYS, type CatalogKey } from "@/lib/catalogs";
import { ChevronDown } from "@/lib/icons";
import { cx } from "@/components/primitives";
import type { Sport } from "@/data/types";

/**
 * As modalidades do clube.
 *
 * ## Isto era uma lista morta
 *
 * Mostrava os desportos com um botão "Editar" que não fazia nada, e não havia
 * forma nenhuma de acrescentar um. Um clube que abrisse com futebol e quisesse
 * juntar futsal não tinha por onde — e um clube novo, que abre sem desportos
 * nenhuns, ficava com um painel vazio e sem saída.
 *
 * ## Os catálogos vivem aqui dentro
 *
 * Eram um painel à parte, com quatro acordeões — locais, balneários, escalões,
 * tipos de evento — que não diziam de que modalidade eram. Um menu inteiro para
 * uma coisa que nunca se procura por si: ninguém quer "ver os escalões", quer
 * ver *os escalões do futebol*.
 *
 * Agora saem da modalidade a que pertencem. O "Sub-13" do futebol não é o
 * "Sub-13" da natação, e a piscina não é um campo — a arrumação passou a dizer
 * isso sozinha, e as Definições ficaram com um painel a menos.
 *
 * Abrem por omissão, porque é para lá que se vem depois de criar a modalidade.
 * Fecham-se com o mesmo gesto, porque um clube com cinco modalidades não quer
 * vinte listas abertas.
 */
export function SportsPanel({
  mayWrite,
  /** Deep-link de um "gerir locais": abre esse catálogo em todas as modalidades. */
  deepLinked,
}: {
  mayWrite: boolean;
  deepLinked?: CatalogKey | null;
}) {
  const { academy } = useStore();
  const [editing, setEditing] = useState<Sport | null>(null);
  const [creating, setCreating] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function remove(sport: Sport) {
    setErro(null);
    try {
      await apiDelete(`/api/sports/${sport.id}`);
      await reloadAcademy();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível apagar a modalidade.");
    }
  }

  return (
    <>
      <Panel>
        <PanelHead title="Modalidades" hint="o que o clube pratica">
          {mayWrite && (
            <button type="button" className="ctl-primary" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" strokeWidth={2} />
              Nova modalidade
            </button>
          )}
        </PanelHead>

        {academy.sports.length === 0 ? (
          <p className="px-5 py-6 text-center text-meta leading-relaxed text-ink-3">
            Ainda não há modalidades.
            <br />
            Cria a primeira — é ela que organiza os escalões, os balneários e as equipas.
          </p>
        ) : (
          <ul>
            {academy.sports.map((sport) => (
              <SportRow
                key={sport.id}
                deepLinked={deepLinked}
                sport={sport}
                mayWrite={mayWrite}
                onEdit={() => setEditing(sport)}
                onRemove={() => void remove(sport)}
              />
            ))}
          </ul>
        )}

        {erro && <p className="border-t border-line px-5 py-3 text-meta text-risk">{erro}</p>}
      </Panel>

      {(creating || editing) && (
        <SportDialog
          sport={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Uma modalidade, e o que se configura dentro dela.
 *
 * Os quatro catálogos abrem por omissão — é para aqui que se vem a seguir a criar
 * a modalidade, e uma lista fechada por omissão fazia parecer que não havia nada
 * para configurar. Fecham-se com o mesmo botão para um clube com cinco
 * modalidades não ficar com vinte listas abertas.
 */
function SportRow({
  sport,
  mayWrite,
  onEdit,
  onRemove,
  deepLinked,
}: {
  sport: Sport;
  mayWrite: boolean;
  deepLinked?: CatalogKey | null;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <li className="border-b border-line last:border-0">
      <div className="flex items-center gap-3 px-5 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? `Ocultar configuração de ${sport.name}` : `Mostrar configuração de ${sport.name}`}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <ChevronDown
            className={cx("size-4 shrink-0 text-ink-3 transition-transform duration-[120ms]", !open && "-rotate-90")}
            strokeWidth={1.75}
          />
          <span className="w-28 shrink-0 truncate text-body font-medium text-ink">{sport.name}</span>
          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
            {sport.positions.length ? (
              sport.positions.map((p) => <Pill key={p}>{p}</Pill>)
            ) : (
              // Natação não tem posições — e isso é configuração, não um caso
              // especial no código.
              <span className="text-meta text-ink-4">sem posições</span>
            )}
          </span>
        </button>

        {mayWrite && (
          <span className="flex shrink-0 gap-1.5">
            <button type="button" className="ctl-ghost" onClick={onEdit}>
              Editar
            </button>
            <button
              type="button"
              className="ctl-ghost text-ink-3 hover:text-risk"
              onClick={onRemove}
              aria-label={`Apagar ${sport.name}`}
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </button>
          </span>
        )}
      </div>

      {open && (
        <div className="border-t border-line bg-sunken/30 pl-4">
          {CATALOG_KEYS.map((key) => (
            <CatalogPanel
              key={key}
              catalogKey={key}
              sportId={sport.id}
              /*
                Fechados por omissão, sempre.

                Já estiveram abertos quando o clube só tinha uma modalidade, com a
                ideia de servir quem acabou de a criar. Mas o que se abre ao entrar
                nas Definições é a **modalidade** — e ela abre, com os quatro
                títulos e a contagem de cada um à frente. Quatro listas abertas por
                baixo enterram tudo o que vem a seguir no ecrã, e quem entra aqui
                quase nunca vem por causa dos balneários.

                A excepção é o `deepLinked`: quem chegou de um "gerir locais" veio
                mesmo por causa daquele, e só aquele abre.
              */
              defaultOpen={deepLinked === key}
              bare
            />
          ))}
        </div>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Criar ou editar uma modalidade.
 *
 * As posições e as competências são listas escritas pelo clube, separadas por
 * vírgulas. Um enum aqui obrigaria a uma migração por cada desporto novo que um
 * cliente tivesse — e "Bruços" não cabe numa lista pensada para futebol.
 */
function SportDialog({ sport, onClose }: { sport?: Sport; onClose: () => void }) {
  const [name, setName] = useState(sport?.name ?? "");
  const [positions, setPositions] = useState((sport?.positions ?? []).join(", "));
  const [skills, setSkills] = useState((sport?.skills ?? []).join(", "));
  const [dominantSideLabel, setDominantSideLabel] = useState(sport?.dominantSideLabel ?? "");
  const [matchMinutes, setMatchMinutes] = useState(sport?.matchMinutes ? String(sport.matchMinutes) : "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const valid = name.trim().length >= 2;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setErro(null);

    const body = {
      name: name.trim(),
      positions: split(positions),
      skills: split(skills),
      dominantSideLabel: dominantSideLabel.trim(),
      ...(matchMinutes.trim() ? { matchMinutes: Number(matchMinutes) } : {}),
    };

    try {
      if (sport) await apiPatch(`/api/sports/${sport.id}`, body);
      else await apiPost("/api/sports", body);
      await reloadAcademy();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível gravar.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="modalidade"
      title={sport ? "Editar modalidade" : "Nova modalidade"}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" form="form-modalidade" className="ctl-primary" disabled={!valid || busy}>
            {busy ? "A gravar…" : sport ? "Gravar" : "Criar"}
          </button>
        </>
      }
    >
      <form id="form-modalidade" onSubmit={submit} className="space-y-4 p-5">
        <DialogField label="Nome">
          <input
            className={dialogInputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Futebol, Natação, Futsal…"
            autoFocus
          />
        </DialogField>

        <DialogField label="Posições" hint="separadas por vírgulas — deixa vazio se não houver">
          <input
            className={dialogInputClass}
            value={positions}
            onChange={(e) => setPositions(e.target.value)}
            placeholder="Guarda-redes, Defesa, Médio, Avançado"
          />
        </DialogField>

        <DialogField label="Competências avaliadas" hint="o que as avaliações medem nesta modalidade">
          <input
            className={dialogInputClass}
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            placeholder="Técnica, Táctica, Físico, Atitude"
          />
        </DialogField>

        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Lado dominante" hint='"Pé", "Mão"… vazio se não se aplica'>
            <input
              className={dialogInputClass}
              value={dominantSideLabel}
              onChange={(e) => setDominantSideLabel(e.target.value)}
              placeholder="Pé dominante"
            />
          </DialogField>
          <DialogField label="Duração do jogo" hint="minutos">
            <input
              className={dialogInputClass}
              value={matchMinutes}
              onChange={(e) => setMatchMinutes(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="90"
            />
          </DialogField>
        </div>

        {erro && (
          <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2.5 text-meta leading-relaxed text-risk">
            {erro}
          </p>
        )}
      </form>
    </Dialog>
  );
}

const split = (v: string): string[] => v.split(",").map((s) => s.trim()).filter(Boolean);
