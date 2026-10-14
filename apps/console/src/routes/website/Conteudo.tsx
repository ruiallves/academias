import { useRef, useState } from "react";
import { Handshake, ImagePlus, Inbox, Loader2, Plus, Trash2, Users } from "@/lib/icons";
import { Empty, cx } from "@/components/primitives";
import { dialogInputClass } from "@/components/Dialog";
import { Interruptor } from "@/components/definicoes/ui";
import { useStore } from "@/lib/store";
import { apagarPatrocinador, editarPatrocinadorAdiado, enviarImagem, guardarConfig, guardarPatrocinador, useSite, type Patrocinador } from "@/lib/website";
import { mostrarErro, mostrarOk, textoDoErro } from "@/lib/avisos";

/* -------------------------------------------------------------------------- */
/* Equipas                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * As equipas da plataforma, e o que de cada uma vai para o site.
 *
 * Uma opção por equipa. Ligada, a equipa vai para o site com tudo: equipa
 * técnica, plantel, jogos e resultados. Desligada, não aparece nada dela.
 * Desligada por omissão: o plantel publica nomes, e na formação são menores.
 * Ver `equipasValidas` na API.
 */
export function Equipas() {
  const store = useStore();
  const slug = store.academy.slug;
  const site = useSite(slug);

  if (store.teams.length === 0) {
    return <Empty icon={Users} title="O clube ainda não tem equipas" detail="As equipas criadas na consola aparecem aqui para escolher o que vai para o site." />;
  }

  const ligada = (id: string) => site.equipas[id]?.visivel === true;
  const mudar = (id: string) => {
    const nova = !ligada(id);
    void guardarConfig({ equipas: { ...site.equipas, [id]: { ...site.equipas[id], visivel: nova, plantel: nova } } });
  };

  const equipas = [...store.teams].sort((a, b) => b.maxAge - a.maxAge || a.name.localeCompare(b.name));

  return (
    <>
      <p className="mb-4 rounded-[10px] bg-sunken/60 px-3.5 py-2.5 text-meta leading-relaxed text-ink-2">
        Uma equipa no site mostra a equipa técnica, o plantel (nome, número e posição de cada atleta), os jogos e os resultados. Desligada,
        não aparece nada dela. Nos escalões de formação, liga só com o consentimento das famílias.
      </p>
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="grid grid-cols-[96px_minmax(0,1fr)_88px] items-center gap-3 border-b border-line bg-sunken/40 px-4 py-2 text-meta font-medium text-ink-3">
          <span>Fotografia</span>
          <span>Equipa</span>
          <span className="text-center">No site</span>
        </div>
        <ul>
          {equipas.map((t) => {
            const on = ligada(t.id);
            return (
              <li key={t.id} className="grid grid-cols-[96px_minmax(0,1fr)_88px] items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <FotoDaEquipa id={t.id} nome={t.name} />
                <span className={cx("truncate text-body", on ? "font-medium text-ink" : "text-ink-3")}>{t.name}</span>
                <span className="flex justify-center">
                  <Interruptor ligado={on} onChange={() => mudar(t.id)} label={`Mostrar ${t.name} no site`} />
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="mt-3 text-meta text-ink-3">Sem fotografia, o site mostra uma imagem da modalidade da equipa.</p>
    </>
  );
}

/**
 * A fotografia de uma equipa no site: um botão pequeno que abre o seletor de
 * ficheiros (nada tocável dentro de um `<label>`, ver `check:toque`). Grava
 * logo, como o logótipo de um patrocinador.
 */
function FotoDaEquipa({ id, nome }: { id: string; nome: string }) {
  const site = useSite(useStore().academy.slug);
  const ficheiro = useRef<HTMLInputElement | null>(null);
  const [aCarregar, setACarregar] = useState(false);
  const foto = site.equipas[id]?.foto ?? "";

  const gravar = (url: string) => {
    const atual = site.equipas[id] ?? { visivel: false, plantel: false };
    return guardarConfig({ equipas: { ...site.equipas, [id]: { ...atual, foto: url } } }, { imediato: true });
  };

  const escolher = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setACarregar(true);
    try {
      await gravar(await enviarImagem(f, 1600));
      mostrarOk(`Fotografia de ${nome} guardada.`);
    } catch (err) {
      mostrarErro(textoDoErro(err, "Não foi possível usar esta imagem."));
    } finally {
      setACarregar(false);
    }
  };

  return (
    <div className="relative">
      <input ref={ficheiro} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={escolher} />
      <button
        type="button"
        onClick={() => ficheiro.current?.click()}
        disabled={aCarregar}
        aria-label={foto ? `Trocar a fotografia de ${nome}` : `Pôr uma fotografia de ${nome}`}
        title={foto ? "Trocar a fotografia" : "Pôr uma fotografia"}
        className={cx(
          "grid aspect-[16/10] w-24 place-items-center overflow-hidden rounded-[8px] border transition-colors",
          foto ? "border-line hover:border-line-strong" : "border-dashed border-line-strong bg-sunken/40 text-ink-3 hover:border-ink-3 hover:text-ink",
        )}
      >
        {aCarregar ? (
          <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
        ) : foto ? (
          <img src={foto} alt="" className="size-full object-cover" />
        ) : (
          <ImagePlus className="size-4" strokeWidth={1.75} />
        )}
      </button>
      {foto && !aCarregar && (
        <button
          type="button"
          aria-label={`Tirar a fotografia de ${nome}`}
          title="Tirar a fotografia"
          className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full border border-line bg-surface text-risk shadow-sm hover:border-line-strong"
          onClick={() => void gravar("").catch(() => undefined)}
        >
          <Trash2 className="size-3" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Patrocinadores                                                               */
/* -------------------------------------------------------------------------- */

export function Patrocinadores() {
  const store = useStore();
  const slug = store.academy.slug;
  const site = useSite(slug);
  const [nome, setNome] = useState("");
  const [url, setUrl] = useState("");

  const juntar = async () => {
    const n = nome.trim();
    if (!n) return;
    await guardarPatrocinador({ id: "", nome: n, url: url.trim(), logo: "" });
    setNome("");
    setUrl("");
    mostrarOk(`${n} acrescentado.`);
  };

  return (
    <div className="space-y-4">
      <form
        className="grid gap-2 rounded-[12px] border border-line bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          void juntar().catch(() => undefined);
        }}
      >
        <input className={dialogInputClass} aria-label="Nome do patrocinador" placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        <input className={dialogInputClass} aria-label="Site do patrocinador" type="url" placeholder="Site (opcional)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button type="submit" className="ctl-primary" disabled={!nome.trim()}>
          <Plus className="size-4" strokeWidth={2} />
          Acrescentar
        </button>
      </form>

      {site.patrocinadores.length === 0 ? (
        <Empty icon={Handshake} title="Sem patrocinadores" detail="Aparecem no fundo de todas as páginas do site, com ligação ao site de cada um." compact />
      ) : (
        <ul className="overflow-hidden rounded-[12px] border border-line bg-surface">
          {site.patrocinadores.map((p) => (
            <LinhaPatrocinador key={p.id} p={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Um patrocinador: o logótipo (ou um espaço para o pôr), o nome, o site.
 *
 * O botão abre o seletor de ficheiros escondido; não há `<label>` à volta de
 * nada tocável (ver `check:toque`). O logótipo é reduzido a 320 px antes de
 * carregar, ver `enviarImagem`.
 */
function LinhaPatrocinador({ p }: { p: Patrocinador }) {
  const ficheiro = useRef<HTMLInputElement | null>(null);
  const [aCarregar, setACarregar] = useState(false);

  // Escrever no nome ou no site: o ecrã muda já, o servidor ao fim de meio segundo.
  const mudar = (f: (x: Patrocinador) => Patrocinador) => editarPatrocinadorAdiado(f(p));

  const escolher = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setACarregar(true);
    try {
      const logo = await enviarImagem(f, 320);
      await guardarPatrocinador({ ...p, logo });
      mostrarOk(`Logótipo de ${p.nome} guardado.`);
    } catch (err) {
      mostrarErro(textoDoErro(err, "Não foi possível usar esta imagem."));
    } finally {
      setACarregar(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <input ref={ficheiro} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={escolher} />
      <button
        type="button"
        onClick={() => ficheiro.current?.click()}
        disabled={aCarregar}
        aria-label={p.logo ? `Trocar o logótipo de ${p.nome}` : `Pôr o logótipo de ${p.nome}`}
        title={p.logo ? "Trocar o logótipo" : "Pôr o logótipo"}
        className={cx(
          "grid h-14 w-24 shrink-0 place-items-center overflow-hidden rounded-[8px] border transition-colors",
          p.logo ? "border-line bg-white hover:border-line-strong" : "border-dashed border-line-strong bg-sunken/40 text-ink-3 hover:border-ink-3 hover:text-ink",
        )}
      >
        {aCarregar ? (
          <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
        ) : p.logo ? (
          <img src={p.logo} alt="" className="max-h-11 max-w-20 object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-0.5 text-[11px] font-medium">
            <ImagePlus className="size-4" strokeWidth={1.75} />
            Logótipo
          </span>
        )}
      </button>
      <div className="min-w-0 flex-1 space-y-1.5">
        <input
          className={cx(dialogInputClass, "font-medium")}
          aria-label="Nome do patrocinador"
          value={p.nome}
          onChange={(e) => mudar((x) => ({ ...x, nome: e.target.value }))}
        />
        <input
          className={dialogInputClass}
          aria-label={`Site de ${p.nome}`}
          type="url"
          placeholder="Site (opcional)"
          value={p.url}
          onChange={(e) => mudar((x) => ({ ...x, url: e.target.value }))}
        />
      </div>
      <div className="flex items-center gap-1">
        {p.logo && (
          <button type="button" className="ctl-ghost" onClick={() => void guardarPatrocinador({ ...p, logo: "" }).catch(() => undefined)}>
            Tirar logótipo
          </button>
        )}
        <button
          type="button"
          aria-label={`Tirar ${p.nome}`}
          className="ctl-ghost size-9 justify-center px-0 text-risk"
          onClick={async () => {
            await apagarPatrocinador(p.id).catch(() => undefined);
            mostrarOk(`${p.nome} tirado.`);
          }}
        >
          <Trash2 className="size-4" strokeWidth={1.75} />
        </button>
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Mensagens                                                                    */
/* -------------------------------------------------------------------------- */

/** O formulário de contactos do site ainda não escreve em lado nenhum: di-lo. */
export function Mensagens() {
  return (
    <Empty
      icon={Inbox}
      title="Ainda não há mensagens"
      detail="Quando o formulário de contactos do site estiver ligado à API, cada mensagem chega aqui com o assunto, para a secretaria responder por email."
    />
  );
}
