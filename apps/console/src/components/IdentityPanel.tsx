import { useEffect, useRef, useState } from "react";
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

  /*
   * O selector nativo é dono do seu próprio estado, e o React não lhe toca.
   *
   * Estas duas linhas são a razão de o selector não fechar sozinho. Enquanto ele
   * está aberto, tudo o que vem de lá aterra em `rascunho` — um ref, que não
   * causa render nenhum. Um `setState` a meio de uma escolha remonta o input, e
   * um input remontado leva a janela do selector com ele.
   */
  const rascunho = useRef(academy.signalColor);
  /**
   * A cor que já está assumida.
   *
   * Um ref e não o `signal` do estado porque quem lê isto é o temporizador, que
   * corre trezentos milissegundos depois de ter sido agendado — e nessa altura o
   * `signal` que a função capturou pode já ser outro. Comparar contra um valor
   * velho gravava a mesma cor duas vezes.
   */
  const assumida = useRef(academy.signalColor);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  /** Escreve a cor no `:root`. Só é chamado quando a escolha está feita. */
  const aplicar = (hex: string) => {
    setSignal(hex);
    rascunho.current = hex;
    assumida.current = hex;
    for (const [k, v] of Object.entries(signalVars(hex))) {
      document.documentElement.style.setProperty(k, v);
    }
  };

  /**
   * Assumir a cor quando a escolha assenta.
   *
   * ## Porque é que isto é um temporizador e não um evento
   *
   * Porque não há um evento fiável para "o utilizador fechou o selector". O
   * Chrome dispara `change` logo ao primeiro clique dentro do selector, e continua
   * a dispará-lo a cada movimento — para ele, `change` e `input` são quase a mesma
   * coisa. O Firefox e o Safari só o disparam ao fechar. Escrever código para um
   * partia o outro, e foi o que aconteceu duas vezes:
   *
   *  - a gravar em cada `change`: a página mudava de cor a cada movimento do rato;
   *  - a remontar o input com uma `key` para o repor: o primeiro clique destruía
   *    a janela aberta e nem dava para arrastar.
   *
   * O que **é** fiável é o silêncio. Enquanto se arrasta, os eventos chegam aos
   * magotes; quando a escolha assenta, param. Trezentos milissegundos sem nada é
   * "acabou de escolher", em qualquer browser, sem depender de nenhum deles.
   *
   * O `blur` continua a comprometer de imediato, para quem fecha o selector e
   * clica noutro sítio não esperar por temporizador nenhum.
   */
  function agendar(hex: string) {
    rascunho.current = hex;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (hex.toLowerCase() !== assumida.current.toLowerCase()) void saveColor(hex);
    }, 300);
  }

  function comprometer() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const hex = rascunho.current;
    if (hex.toLowerCase() !== assumida.current.toLowerCase()) void saveColor(hex);
  }

  // Um temporizador pendente quando o painel desaparece nunca chega a gravar, e
  // deixava um `setState` a apontar para um componente que já não existe.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  /*
   * Quando a cor muda por outra via — um dos atalhos acima, ou uma gravação
   * falhada que reverteu — o selector tem de a acompanhar.
   *
   * Escrever no DOM à mão, e não com uma `key`: remontar o input fecharia o
   * selector se ele estivesse aberto. Isto corre só quando o valor gravado
   * mudou, e nessa altura o selector está fechado — quem carrega num atalho não
   * tem o selector aberto.
   */
  useEffect(() => {
    if (picker.current && picker.current.value.toLowerCase() !== signal.toLowerCase()) {
      picker.current.value = signal;
    }
    rascunho.current = signal;
    assumida.current = signal;
  }, [signal]);

  async function saveColor(hex: string) {
    aplicar(hex);
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
      aplicar(academy.signalColor);
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

            ## Porque é que este input não é controlado, nem tem `key`

            Foi controlado, com `value={signal}` e um `setState` por cada movimento
            do rato — e a página mudava de cor enquanto se escolhia, que era a
            queixa. Depois passou a `defaultValue` com `key={signal}` para o
            repor, e ficou pior: o Chrome dispara `change` logo ao primeiro clique
            dentro do selector, a `key` mudava, o React remontava o input, e a
            janela aberta ia atrás — nem dava para arrastar.

            Agora o React não lhe toca de todo enquanto está aberto. O que vem do
            selector vai para um ref e reinicia um temporizador; a cor só é
            assumida quando os eventos param de chegar. Ver `agendar`.
          */}
          <label
            className={cx(
              "inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-meta font-medium text-ink-2 transition-colors duration-[120ms] hover:border-line-strong",
              !mayWrite && "pointer-events-none opacity-50",
            )}
          >
            <span
              className="size-4 rounded-full ring-1 ring-line-strong ring-inset"
              style={{ background: signal }}
              aria-hidden
            />
            Outra cor
            {/*
              `disabled` só por permissão, e nunca por `saving`.
              O Chrome dispara `change` com o selector ainda aberto; se a gravação
              que isso desencadeia desactivasse o input, o browser fechava-lhe a
              janela nas mãos de quem ainda estava a escolher. Os atalhos acima
              continuam a desactivar-se — são botões, não têm janela aberta.
            */}
            <input
              ref={picker}
              type="color"
              defaultValue={signal}
              disabled={!mayWrite}
              onInput={(e) => agendar((e.target as HTMLInputElement).value)}
              onChange={(e) => agendar(e.target.value)}
              onBlur={comprometer}
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
      {/* O iPhone cola o ícone como um autocolante quadrado: não corrige proporção
          e assenta a transparência sobre preto. Vale a pena dizê-lo aqui, que é
          onde a escolha se faz — ver `landing.template.ts`. */}
      <p className="mb-3 max-w-[62ch] text-[11px] text-ink-4">
        No iPhone o símbolo é usado tal e qual: um ficheiro com fundo transparente fica sobre preto no ecrã inicial, e
        um muito largo fica esticado. Com fundo próprio e quadrado, fica igual ao que carregares.
      </p>

      <div className="flex items-center gap-4">
        <span
          className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-[16px] text-[18px] font-bold text-signal-on"
          style={{ background: academy.logoUrl ? "var(--color-sunken)" : "var(--color-signal-strong)" }}
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
