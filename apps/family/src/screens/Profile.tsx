import { useState, type FormEvent } from "react";
import { ChevronRight, LogOut, MessageSquare, Plus, Sparkles, ShieldCheck } from "lucide-react";
import { reload, useStore } from "@/lib/store";
import { apiPost } from "@/lib/http";
import { signOut } from "@/lib/session";
import { resetOnboarding } from "@/lib/onboarding";
import { NotificationCard } from "@/NotificationCard";
import { Avatar, Label } from "@/ui";

/**
 * O perfil de quem está a usar a app — o pai, não o filho.
 *
 * Existe porque havia definições sem casa. As notificações estavam penduradas no
 * fundo do histórico de notificações: o sítio onde ninguém vai à procura de um
 * interruptor, e onde o cartão competia com a lista que ali interessa. Uma
 * definição da conta pertence à conta.
 *
 * O ecrã "Atleta" continua a ser do educando; este é da pessoa. A separação faz
 * a app deixar de ter um canto onde as coisas soltas vão parar.
 */
export default function Profile() {
  const store = useStore();
  const [juntar, setJuntar] = useState(false);

  return (
    <div className="space-y-7 pt-3">
      <header className="flex items-center gap-4 px-1 pt-2">
        <Avatar name={store.guardian.name} size={60} ring />
        <div className="min-w-0">
          <h1 className="truncate text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink">
            {store.guardian.firstName}
          </h1>
          <p className="mt-0.5 truncate text-meta text-ink-3">
            Encarregado de educação · {store.academy.shortName}
          </p>
        </div>
      </header>

      <section>
        <Label>Notificações</Label>
        <NotificationCard />
      </section>

      {/* Quem está associado a esta conta. Responde a "a app está a mostrar-me
          tudo o que devia?" sem obrigar a passear pelo seletor lá em cima. */}
      <section>
        <Label>Educandos</Label>
        <ul className="overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-soft)]">
          {store.children.map((c) => (
            <li key={c.id} className="flex items-center gap-3 border-b border-line p-4 last:border-0">
              <Avatar name={c.name} photoUrl={c.photoUrl} size={38} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-semibold text-ink">{c.name}</span>
                <span className="block truncate text-meta text-ink-3">
                  {c.team} · {c.coach}
                </span>
              </span>
            </li>
          ))}

          {/*
            Um irmão que também treina no clube.
            
            A prova é a mesma do registo — NIF e data de nascimento — e é assim de
            propósito: ter conta não dá direito a reclamar crianças. Se aqui
            bastasse escolher de uma lista, a conta de um pai passava a ver os
            filhos dos outros.
          */}
          <li className="p-1.5">
            {juntar ? (
              <AddChild onDone={() => setJuntar(false)} />
            ) : (
              <button
                type="button"
                onClick={() => setJuntar(true)}
                className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2.5 py-2.5 text-body font-semibold text-ink-2 active:bg-sunken"
              >
                <span className="flex size-[38px] items-center justify-center rounded-full bg-sunken text-ink-3">
                  <Plus className="size-[18px]" strokeWidth={2} />
                </span>
                Tenho outro filho no clube
              </button>
            )}
          </li>
        </ul>
      </section>

      <section>
        <Label>Conta</Label>
        <div className="space-y-2">
          <ActionRow icon={MessageSquare} label="Falar com a academia" />
          <ActionRow
            icon={Sparkles}
            label="Rever a apresentação"
            onClick={() => {
              resetOnboarding();
              window.location.reload();
            }}
          />
        </div>
      </section>

      <button
        type="button"
        onClick={() => {
          if (!confirm("Terminar sessão nesta app?")) return;
          signOut();
        }}
        className="flex w-full items-center justify-center gap-2 py-3 text-body font-semibold text-ink-3 active:text-ink"
      >
        <LogOut className="size-[18px]" strokeWidth={1.9} />
        Terminar sessão
      </button>

      <p className="flex items-center justify-center gap-1.5 pb-1 text-[12px] text-ink-4">
        <ShieldCheck className="size-3.5" strokeWidth={1.75} />
        Vês apenas os teus educandos.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ActionRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof MessageSquare;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] bg-surface p-4 text-left shadow-[var(--shadow-soft)] active:scale-[0.99]"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-2">
        <Icon className="size-[18px]" strokeWidth={1.9} />
      </span>
      <span className="flex-1 text-body font-semibold text-ink">{label}</span>
      <ChevronRight className="size-5 shrink-0 text-ink-4" strokeWidth={2} />
    </button>
  );
}

/**
 * Juntar outro educando à mesma conta.
 *
 * Inline e não num ecrã à parte: são dois campos, e o contexto — a lista de
 * educandos logo por cima — é metade da explicação.
 */
function AddChild({ onDone }: { onDone: () => void }) {
  const [taxId, setTaxId] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const valido = /^\d{9}$/.test(taxId.replace(/\s/g, "")) && birthdate !== "";

  async function juntar(e: FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await apiPost("/api/family-invite/educandos", { taxId: taxId.replace(/\s/g, ""), birthdate });
      await reload();
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível juntar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={juntar} className="space-y-2 p-2">
      <input
        value={taxId}
        onChange={(e) => setTaxId(e.target.value)}
        inputMode="numeric"
        maxLength={11}
        placeholder="NIF do educando"
        autoFocus
        className={FIELD}
      />
      <input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} className={FIELD} />

      {erro && <p className="px-1 text-[13px] leading-relaxed text-[#a82a20]">{erro}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onDone} className="cta-quiet flex-1">
          Cancelar
        </button>
        <button type="submit" disabled={!valido || busy} className="cta flex-1">
          {busy ? "A juntar…" : "Juntar"}
        </button>
      </div>
    </form>
  );
}

const FIELD =
  "w-full rounded-[var(--radius-sm)] border border-line bg-surface px-3.5 py-3 text-[16px] text-ink placeholder:text-ink-4 focus:border-ink-3 focus:outline-none";
