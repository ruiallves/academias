import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/primitives";
import { Bloco, Campo, Erro, Leitura, campoClass } from "@/components/definicoes/ui";
import { Check, Plus, Trash2, Upload } from "@/lib/icons";
import { apiDelete, apiPatch, apiPost } from "@/lib/http";
import { reloadAcademy, useStore } from "@/lib/store";
import { signalVars } from "@academia/ui/tokens";
import { erroAvisado } from "@/lib/avisos";
import { ASSOCIACOES } from "@/lib/paises";
import { hasDiscipline } from "@/lib/sports";

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

  const escolhida = PRESETS.find((p) => p.hex === signal.toLowerCase());

  return (
    <>
      {erro && <Erro>{erro}</Erro>}

      <Bloco
        titulo="Nome"
        descricao="O nome por extenso e o endereço são os do registo do clube na plataforma. O nome curto é o que aparece onde o outro não cabe."
      >
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Leitura label="Nome do clube" valor={academy.name} />
          <Leitura label="Endereço da app" valor={`${academy.slug}.academias.pt`} mono />
        </div>
        <ShortNameField mayWrite={mayWrite} onError={setErro} />
      </Bloco>

      {(hasDiscipline("football") || hasDiscipline("futsal")) && <FederacaoBloco mayWrite={mayWrite} onError={setErro} />}

      <ClubSymbol mayWrite={mayWrite} onError={setErro} />

      <Bloco
        titulo="Cor do clube"
        descricao="Pinta o que diz «estás aqui»: o menu activo, o foco, a marca. Nunca o estado de um pagamento — pago é verde e vencido é vermelho em todos os clubes."
        estado={
          saving ? (
            <span className="text-meta text-ink-3">a gravar…</span>
          ) : saved ? (
            <span className="flex items-center gap-1 text-meta text-ok">
              <Check className="size-3.5" strokeWidth={2} />
              gravado
            </span>
          ) : undefined
        }
      >
        {/*
          Bolas de cor e não botões com nome: a cor escolhe-se a olhar para ela.
          O nome da que está escolhida vai por baixo, uma vez, em vez de seis
          etiquetas a competir com as seis cores.
        */}
        <div className="flex flex-wrap items-center gap-3">
          {PRESETS.map((p) => {
            const on = signal.toLowerCase() === p.hex;
            return (
              <button
                key={p.hex}
                type="button"
                disabled={!mayWrite || saving}
                onClick={() => void saveColor(p.hex)}
                aria-pressed={on}
                aria-label={p.name}
                title={p.name}
                className={cx(
                  "flex size-9 items-center justify-center rounded-full transition-[box-shadow,transform] duration-[120ms] disabled:opacity-50",
                  on ? "ring-2 ring-ink ring-offset-2 ring-offset-canvas" : "hover:scale-105",
                )}
                style={{ background: p.hex }}
              >
                {on && <Check className="size-4 text-white" strokeWidth={2.5} />}
              </button>
            );
          })}

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
            title="Outra cor"
            className={cx(
              "relative flex size-9 cursor-pointer items-center justify-center rounded-full border border-dashed border-line-strong text-ink-3 transition-colors duration-[120ms] hover:border-ink-3 hover:text-ink",
              !escolhida && "border-solid ring-2 ring-ink ring-offset-2 ring-offset-canvas",
              !mayWrite && "pointer-events-none opacity-50",
            )}
            style={!escolhida ? { background: signal, borderColor: "transparent" } : undefined}
          >
            {/* Sobre uma cor própria o visto leva a tinta que se lê nela: branco num
                amarelo-claro não se via. */}
            {escolhida ? <Plus className="size-4" strokeWidth={1.75} /> : <Check className="size-4 text-signal-on" strokeWidth={2.5} />}
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
        </div>

        <p className="mt-3 text-meta text-ink-3">
          <span className="font-medium text-ink-2">{escolhida?.name ?? "Cor própria"}</span>
          <span className="ml-2 font-mono text-[11px] text-ink-4">{signal.toUpperCase()}</span>
        </p>
      </Bloco>
    </>
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
      // Directo ao armazenamento, fora do cliente HTTP: avisa-se aqui.
      if (!res.ok) throw erroAvisado("O carregamento falhou. Tenta outra vez.");

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
    <Bloco
      centro
      titulo="Símbolo"
      descricao={
        <>
          <p>
            É o ícone que as famílias instalam no telemóvel, e aparece na página do clube e na de sócios. Quadrado, com
            pelo menos 512 px de lado. PNG, WebP ou JPEG até 2 MB.
          </p>
          {/* O ícone da app é gerado a partir do símbolo (ver `tenant/club-icons.ts` na
              API), já quadrado e opaco. O que não depende de nós é quando o telemóvel
              o vai buscar: o Android verifica o manifest quando a app abre, com um
              intervalo que é dele; o iPhone nunca volta a perguntar. */}
          <p className="text-[11px] text-ink-4">
            Ao trocar, o Android muda o ícone sozinho nos dias seguintes. No iPhone é preciso remover a app do ecrã
            principal e voltar a adicioná-la.
          </p>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
        <span
          className="flex size-[72px] shrink-0 items-center justify-center overflow-hidden rounded-[18px] text-[20px] font-bold text-signal-on"
          style={{ background: academy.logoUrl ? "var(--color-sunken)" : "var(--color-signal-strong)" }}
        >
          {academy.logoUrl ? (
            <img src={academy.logoUrl} alt="" className="size-full object-contain" />
          ) : (
            monogram(academy.shortName)
          )}
        </span>

        <div className="min-w-0">
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
          {!academy.logoUrl && (
            <p className="mt-2 text-meta text-ink-3">Sem símbolo, usam-se as iniciais do nome curto.</p>
          )}
        </div>
      </div>
    </Bloco>
  );
}

function monogram(shortName: string): string {
  const parts = shortName.trim().split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : shortName.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * O clube na federação: o código do clube e a Associação de Futebol.
 *
 * É o que o Modelo 2 da FPF pede ao clube em cada inscrição de jogador, e sai
 * em todas as folhas geradas em Gestão → Inscrições. Só aparece a clubes com
 * futebol ou futsal. Grava ao sair do campo, como o nome curto.
 */
function FederacaoBloco({ mayWrite, onError }: { mayWrite: boolean; onError: (m: string | null) => void }) {
  const { academy } = useStore();
  const [codigo, setCodigo] = useState(academy.fpfClubCode);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCodigo(academy.fpfClubCode);
  }, [academy.fpfClubCode]);

  async function gravar(dados: { fpfClubCode?: string; footballAssociation?: string }) {
    setSaving(true);
    onError(null);
    try {
      await apiPatch("/api/identity", dados);
      await reloadAcademy();
    } catch (e) {
      setCodigo(academy.fpfClubCode);
      onError(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setSaving(false);
    }
  }

  function gravarCodigo() {
    const limpo = codigo.replace(/\s+/g, "");
    if (limpo === academy.fpfClubCode) return;
    if (limpo && !/^\d+$/.test(limpo)) {
      setCodigo(academy.fpfClubCode);
      onError("O código do clube tem só algarismos.");
      return;
    }
    void gravar({ fpfClubCode: limpo });
  }

  return (
    <Bloco
      titulo="Federação"
      descricao="O código do clube e a associação onde está filiado. Saem em todos os boletins de inscrição (Modelo 2) gerados em Inscrições."
      estado={saving ? <span className="text-meta text-ink-3">a gravar…</span> : undefined}
    >
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-[minmax(0,10rem)_minmax(0,16rem)]">
        <Campo label="Código do clube">
          <input
            aria-label="Código do clube"
            value={codigo}
            inputMode="numeric"
            maxLength={10}
            placeholder="0000"
            disabled={!mayWrite || saving}
            onChange={(e) => setCodigo(e.target.value)}
            onBlur={gravarCodigo}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setCodigo(academy.fpfClubCode);
            }}
            className={cx(campoClass, "font-mono")}
          />
        </Campo>
        <Campo label="Associação de Futebol">
          <select
            aria-label="Associação de Futebol"
            value={academy.footballAssociation}
            disabled={!mayWrite || saving}
            onChange={(e) => void gravar({ footballAssociation: e.target.value })}
            className={campoClass}
          >
            <option value="">Escolher…</option>
            {ASSOCIACOES.map((a) => (
              <option key={a} value={a}>
                AF {a}
              </option>
            ))}
          </select>
        </Campo>
      </div>
    </Bloco>
  );
}

/** O mesmo tecto do servidor — o do nome completo. Ver `common/short-name.ts`. */
const SHORT_NAME_MAX = 120;

/**
 * O nome curto — como o clube se trata a si próprio.
 *
 * ## Porque é que isto passou a ser um campo
 *
 * Era derivado do nome completo quando o clube nascia, por uma regra que cortava
 * a primeira palavra e truncava a 24 caracteres. Dava "Desportivo de Loureiro"
 * a um "Clube Desportivo de Loureiro" e "Futebol Clube Ferreirens" a um "Futebol
 * Clube Ferreirense" — e era esse o nome que saía no assunto dos emails, na
 * página de sócios e no ecrã inicial do telemóvel dos pais, sem ninguém ter por
 * onde o corrigir.
 *
 * Nenhuma regra acerta com todos os nomes de clube, e quem sabe como o clube se
 * chama está deste lado do ecrã. Grava ao sair do campo e não com um botão,
 * como a cor aqui ao lado.
 */
function ShortNameField({ mayWrite, onError }: { mayWrite: boolean; onError: (m: string | null) => void }) {
  const { academy } = useStore();
  const [texto, setTexto] = useState(academy.shortName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTexto(academy.shortName);
  }, [academy.shortName]);

  async function gravar() {
    const limpo = texto.replace(/\s+/g, " ").trim();
    if (limpo === academy.shortName) return;

    if (limpo.length < 2) {
      // Repõe em vez de deixar o campo vazio a discordar do que está gravado.
      setTexto(academy.shortName);
      onError("O nome curto tem de ter pelo menos 2 caracteres.");
      return;
    }

    setSaving(true);
    onError(null);
    try {
      await apiPatch("/api/identity", { shortName: limpo });
      await reloadAcademy();
    } catch (e) {
      setTexto(academy.shortName);
      onError(e instanceof Error ? e.message : "Não foi possível gravar o nome curto.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Campo
      label="Nome curto"
      className="mt-6"
      ajuda="Aparece no assunto dos emails, na página de sócios, no separador da consola e por baixo do ícone no telemóvel das famílias."
    >
      <input
        aria-label="Nome curto"
        value={texto}
        maxLength={SHORT_NAME_MAX}
        disabled={!mayWrite || saving}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => void gravar()}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setTexto(academy.shortName);
        }}
        className={cx(campoClass, "sm:max-w-[22rem]")}
      />
    </Campo>
  );
}
