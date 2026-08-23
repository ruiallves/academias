import { useState, type FormEvent } from "react";
import { academy } from "@/lib/api";
import { sportById } from "@/lib/api";
import { createProspect } from "@/lib/scouting";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";

/**
 * Registar alguém que o clube passa a acompanhar.
 *
 * ## Porque é que pede tão pouco
 *
 * Porque um prospecto nasce quase sempre de uma frase dita no carro à saída de um
 * torneio: "há um miúdo no Vizela que tens de ver". Se este formulário pedir
 * quinze campos, essa frase nunca chega à plataforma — fica num WhatsApp, e o
 * dossiê nasce dois meses depois ou nunca.
 *
 * Nome, data de nascimento e modalidade. Tudo o resto — clube, posição, como
 * apareceu — é opcional e preenche-se na ficha, quando se souber.
 *
 * ## Sem NIF
 *
 * Ao contrário de um atleta, aqui não se pede NIF. Um prospecto não é nosso: não
 * há mensalidade para faturar nem família para ligar à app, e guardar o número de
 * contribuinte de uma criança de outro clube "para o caso de" é exactamente o tipo
 * de dado que não se recolhe antes de existir uma razão.
 */
export function NewProspectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const sports = academy.sports;

  const [name, setName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [sportId, setSportId] = useState(sports[0]?.id ?? "");
  const [currentClub, setCurrentClub] = useState("");
  const [position, setPosition] = useState("");
  const [discoveredVia, setDiscoveredVia] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const positions = sportById(sportId)?.positions ?? [];
  const valid = name.trim().length >= 2 && birthdate !== "" && sportId !== "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createProspect({
        name: name.trim(),
        birthdate,
        sportId,
        ...(currentClub.trim() ? { currentClub: currentClub.trim() } : {}),
        ...(position ? { position } : {}),
        ...(discoveredVia.trim() ? { discoveredVia: discoveredVia.trim() } : {}),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Novo prospecto"
      subtitle="Alguém que passamos a acompanhar"
      onClose={onClose}
      width={480}
      labelledBy="new-prospect"
      footer={
        <>
          {error && <span className="mr-auto text-meta text-risk">{error}</span>}
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="new-prospect-form" className="ctl-primary" disabled={!valid || busy}>
            {busy ? "A criar…" : "Criar"}
          </button>
        </>
      }
    >
      <form id="new-prospect-form" onSubmit={submit} className="space-y-3 px-5 py-4">
        <DialogField label="Nome">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome completo"
            className={dialogInputClass}
          />
        </DialogField>

        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Data de nascimento">
            <input
              type="date"
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
              className={dialogInputClass}
            />
          </DialogField>

          <DialogField label="Modalidade">
            <select value={sportId} onChange={(e) => setSportId(e.target.value)} className={dialogInputClass}>
              {sports.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </DialogField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Clube actual" hint="opcional">
            <input
              value={currentClub}
              onChange={(e) => setCurrentClub(e.target.value)}
              placeholder="FC Vizela"
              className={dialogInputClass}
            />
          </DialogField>

          {/* A modalidade decide se há posições. Natação não tem, e o campo
              desaparece em vez de pedir algo que não existe. */}
          {positions.length > 0 && (
            <DialogField label="Posição" hint="opcional">
              <select value={position} onChange={(e) => setPosition(e.target.value)} className={dialogInputClass}>
                <option value="">—</option>
                {positions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </DialogField>
          )}
        </div>

        <DialogField label="Como apareceu" hint="opcional">
          <input
            value={discoveredVia}
            onChange={(e) => setDiscoveredVia(e.target.value)}
            placeholder="Torneio de Braga · indicação do treinador dos Sub-11"
            className={dialogInputClass}
          />
        </DialogField>

        <p className="text-meta leading-relaxed text-ink-3">
          Fica em <strong className="font-medium text-ink-2">Descoberto</strong> e passa a
          <strong className="font-medium text-ink-2"> Observado</strong> assim que alguém registar a primeira
          ida ao campo.
        </p>
      </form>
    </Dialog>
  );
}
