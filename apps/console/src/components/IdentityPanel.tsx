import { useRef, useState } from "react";
import { Panel, PanelHead, cx } from "@/components/primitives";
import { Check, Trash2, Upload } from "@/lib/icons";
import { apiDelete, apiPatch, apiPost } from "@/lib/http";
import { reloadAcademy, useStore } from "@/lib/store";
import { signalVars } from "@academia/ui/tokens";

/**
 * A identidade do clube — a cor e o símbolo.
 *
 * ## Isto não gravava nada
 *
 * A paleta já cá estava, mas escolher uma cor só escrevia uma variável CSS no
 * `:root` do browser de quem escolheu. Recarregar a página desfazia tudo, e
 * nenhum pai chegou a ver cor nenhuma. Agora cada escolha vai a
 * `PATCH /api/identity` e volta no arranque seguinte, para toda a gente.
 *
 * ## Onde é que isto aparece
 *
 * Em tudo o que o clube mostra a quem está de fora: o ícone que o pai instala no
 * telemóvel, a página do clube, a página pública de adesão a sócio, a app e esta
 * consola. É o white-label, e é por isso que vive na academia e não numa
 * preferência de utilizador.
 *
 * Repara no que **não** muda: verde de pago, vermelho de vencido. As cores
 * semânticas nunca são white-label — se fossem, cada academia teria um
 * vocabulário de estado diferente e o produto deixaria de se poder explicar.
 */

const PRESETS = [
  { name: "Verde-azulado", hex: "#0f6b62" },
  { name: "Azul-noite", hex: "#1f4d80" },
  { name: "Bordô", hex: "#8c2f39" },
  { name: "Terra", hex: "#a2542a" },
  { name: "Violeta", hex: "#5a4b9c" },
  { name: "Grafite", hex: "#3d3d3d" },
];

/** 2 MB — o mesmo tecto do servidor. Ver `club-logo.service.ts`. */
const MAX_BYTES = 2 * 1024 * 1024;

export function IdentityPanel({ mayWrite }: { mayWrite: boolean }) {
  const store = useStore();
  const { academy } = store;

  const [signal, setSignal] = useState(academy.signalColor);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // A pré-visualização local enquanto se arrasta o selector de cor. O `signal`
  // guardado é o que se grava; isto é só o que se vê enquanto se decide.
  const preview = (hex: string) => {
    setSignal(hex);
    for (const [k, v] of Object.entries(signalVars(hex))) {
      document.documentElement.style.setProperty(k, v);
    }
  };

  async function saveColor(hex: string) {
    preview(hex);
    if (!mayWrite) return;
    setSaving(true);
    setErro(null);
    try {
      await apiPatch("/api/identity", { signalColor: hex });
      await reloadAcademy();
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar a cor.");
      // Repor o que o servidor tem: uma cor que ficou no ecrã mas não gravou é
      // pior do que nenhuma — quem a vê acredita que está aplicada.
      preview(academy.signalColor);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel>
      <PanelHead title="Identidade" hint="o que as famílias vêem">
        {saving && <span className="text-meta text-ink-3">a gravar…</span>}
        {saved && !saving && (
          <span className="flex items-center gap-1 text-meta text-ok">
            <Check className="size-3.5" strokeWidth={2} />
            gravado
          </span>
        )}
      </PanelHead>

      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Nome da academia" value={academy.name} />
        <Field label="Endereço da app" value={`${academy.slug}.academias.pt`} mono />
      </div>

      <ClubSymbol mayWrite={mayWrite} onError={setErro} />

      <div className="border-t border-line p-5">
        <div className="mb-1 text-meta font-medium text-ink">Cor do clube</div>
        <p className="mb-3 max-w-[62ch] text-meta text-ink-3">
          Usada em identidade e selecção — navegação activa, foco, marca. Nunca em estado: pago é verde e vencido é
          vermelho em todas as academias.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.hex}
              type="button"
              disabled={!mayWrite || saving}
              onClick={() => void saveColor(p.hex)}
              aria-pressed={signal.toLowerCase() === p.hex}
              className={cx(
                "inline-flex items-center gap-2 rounded-[var(--radius-control)] border px-2.5 py-1.5 text-meta font-medium transition-colors duration-[120ms] disabled:opacity-50",
                signal.toLowerCase() === p.hex
                  ? "border-line-strong text-ink"
                  : "border-line text-ink-2 hover:border-line-strong",
              )}
            >
              <span className="flex size-4 items-center justify-center rounded-full" style={{ background: p.hex }}>
                {signal.toLowerCase() === p.hex && <Check className="size-2.5 text-white" strokeWidth={3} />}
              </span>
              {p.name}
            </button>
          ))}

          {/*
            O selector livre, a seguir aos atalhos.
            Um clube tem a sua cor e ela raramente é uma das seis — as seis
            existem para quem não faz questão. `onInput` pré-visualiza a cada
            movimento; só o `onChange` (quando o selector fecha) é que grava, para
            não escrever cem vezes no servidor enquanto se arrasta.
          */}
          <label
            className={cx(
              "inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-meta font-medium text-ink-2 transition-colors duration-[120ms] hover:border-line-strong",
              (!mayWrite || saving) && "pointer-events-none opacity-50",
            )}
          >
            <span
              className="size-4 rounded-full ring-1 ring-line-strong ring-inset"
              style={{ background: signal }}
              aria-hidden
            />
            Outra cor
            <input
              type="color"
              value={signal}
              disabled={!mayWrite || saving}
              onInput={(e) => preview((e.target as HTMLInputElement).value)}
              onChange={(e) => void saveColor(e.target.value)}
              className="sr-only"
              aria-label="Escolher outra cor"
            />
          </label>

          <span className="font-mono text-[11px] text-ink-4">{signal.toUpperCase()}</span>
        </div>
      </div>

      {erro && <p className="border-t border-line px-5 py-3 text-meta text-risk">{erro}</p>}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O símbolo.
 *
 * Duas fases, como as fotografias dos atletas: pedir autorização, carregar
 * directamente para o Supabase, confirmar. O ficheiro não passa pela nossa API —
 * ver `club-logo.service.ts`.
 */
function ClubSymbol({ mayWrite, onError }: { mayWrite: boolean; onError: (m: string | null) => void }) {
  const { academy } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File) {
    onError(null);

    if (file.size > MAX_BYTES) {
      onError("O símbolo tem de ter menos de 2 MB.");
      return;
    }

    setBusy(true);
    try {
      const { url, token, key } = await apiPost<{ url: string; token: string; key: string }>(
        "/api/identidade/simbolo/upload",
        { contentType: file.type },
      );

      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": file.type, Authorization: `Bearer ${token}` },
        body: file,
      });
      if (!res.ok) throw new Error("O carregamento falhou. Tenta outra vez.");

      await apiPost("/api/identidade/simbolo", { key });
      await reloadAcademy();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Não foi possível carregar o símbolo.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    onError(null);
    try {
      await apiDelete("/api/identidade/simbolo");
      await reloadAcademy();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Não foi possível remover o símbolo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-line p-5">
      <div className="mb-1 text-meta font-medium text-ink">Símbolo do clube</div>
      <p className="mb-3 max-w-[62ch] text-meta text-ink-3">
        Aparece no ícone que as famílias instalam no telemóvel, na página do clube e na página de sócios. Quadrado e
        com pelo menos 512 px de lado dá o melhor resultado. PNG, WebP ou JPEG até 2 MB.
      </p>

      <div className="flex items-center gap-4">
        <span
          className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-[16px] text-[18px] font-bold text-white"
          style={{ background: academy.logoUrl ? "var(--color-sunken)" : "var(--color-signal)" }}
        >
          {academy.logoUrl ? (
            <img src={academy.logoUrl} alt="" className="size-full object-contain" />
          ) : (
            monogram(academy.shortName)
          )}
        </span>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!mayWrite || busy}
            onClick={() => input.current?.click()}
            className="ctl-outline disabled:opacity-50"
          >
            <Upload className="size-3.5" strokeWidth={1.75} />
            {busy ? "A carregar…" : academy.logoUrl ? "Trocar símbolo" : "Carregar símbolo"}
          </button>

          {academy.logoUrl && (
            <button
              type="button"
              disabled={!mayWrite || busy}
              onClick={() => void remove()}
              className="ctl-ghost text-risk disabled:opacity-50"
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
              Remover
            </button>
          )}

          <input
            ref={input}
            type="file"
            accept="image/png,image/webp,image/jpeg"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pick(f);
            }}
          />
        </div>
      </div>

      {!academy.logoUrl && (
        <p className="mt-3 text-[11px] text-ink-4">
          Sem símbolo, usamos as iniciais do nome curto — é o que está no quadrado acima.
        </p>
      )}
    </div>
  );
}

function monogram(shortName: string): string {
  const parts = shortName.trim().split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : shortName.slice(0, 2);
  return letters.toUpperCase();
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-meta font-medium text-ink">{label}</span>
      <input
        readOnly
        value={value}
        className={cx(
          "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body text-ink-2",
          mono && "font-mono text-meta",
        )}
      />
    </label>
  );
}
