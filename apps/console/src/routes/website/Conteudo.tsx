import { useRef, useState } from "react";
import { Handshake, ImagePlus, Inbox, Loader2, Plus, Trash2, Users } from "@/lib/icons";
import { Empty, cx } from "@/components/primitives";
import { dialogInputClass } from "@/components/Dialog";
import { Interruptor } from "@/components/definicoes/ui";
import { useStore } from "@/lib/store";
import { gravarSite, imagemReduzida, novoId, useSite, type Patrocinador } from "@/lib/website";
import { mostrarErro, mostrarOk, textoDoErro } from "@/lib/avisos";

/* -------------------------------------------------------------------------- */
/* Equipas                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * As equipas da plataforma, e o que de cada uma vai para o site.
 *
 * Por omissão a equipa aparece (nome, equipa técnica, jogos) e o plantel não:
 * nos escalões jovens são menores, e os nomes só vão para um site público com
 * o consentimento das famílias.
 */
export function Equipas() {
  const store = useStore();
  const slug = store.academy.slug;
  const site = useSite(slug);

  if (store.teams.length === 0) {
    return <Empty icon={Users} title="O clube ainda não tem equipas" detail="As equipas criadas na consola aparecem aqui para escolher o que vai para o site." />;
  }

  const de = (id: string) => site.equipas[id] ?? { visivel: true, plantel: false };
  const mudar = (id: string, campo: "visivel" | "plantel") =>
    gravarSite(slug, (s) => {
      const atual = s.equipas[id] ?? { visivel: true, plantel: false };
      return { ...s, equipas: { ...s.equipas, [id]: { ...atual, [campo]: !atual[campo] } } };
    });

  const equipas = [...store.teams].sort((a, b) => b.maxAge - a.maxAge || a.name.localeCompare(b.name));

  return (
    <>
      <p className="mb-4 rounded-[10px] bg-sunken/60 px-3.5 py-2.5 text-meta leading-relaxed text-ink-2">
        Mostrar o plantel publica o nome e o número de cada atleta. Nos escalões de formação, só com o consentimento escrito das famílias.
      </p>
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="grid grid-cols-[minmax(0,1fr)_88px_88px] items-center gap-3 border-b border-line bg-sunken/40 px-4 py-2 text-meta font-medium text-ink-3">
          <span>Equipa</span>
          <span className="text-center">No site</span>
          <span className="text-center">Plantel</span>
        </div>
        <ul>
          {equipas.map((t) => {
            const e = de(t.id);
            return (
              <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_88px_88px] items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <span className={cx("truncate text-body", e.visivel ? "font-medium text-ink" : "text-ink-3")}>{t.name}</span>
                <span className="flex justify-center">
                  <Interruptor ligado={e.visivel} onChange={() => mudar(t.id, "visivel")} label={`Mostrar ${t.name} no site`} />
                </span>
                <span className="flex justify-center">
                  <Interruptor ligado={e.plantel} disabled={!e.visivel} onChange={() => mudar(t.id, "plantel")} label={`Mostrar o plantel de ${t.name}`} />
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </>
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

  const juntar = () => {
    const n = nome.trim();
    if (!n) return;
    gravarSite(slug, (s) => ({ ...s, patrocinadores: [...s.patrocinadores, { id: novoId(), nome: n, url: url.trim(), logo: "" }] }));
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
          juntar();
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
            <LinhaPatrocinador key={p.id} p={p} slug={slug} />
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
 * nada tocável (ver `check:toque`). A imagem é reduzida antes de se gravar,
 * ver `imagemReduzida`.
 */
function LinhaPatrocinador({ p, slug }: { p: Patrocinador; slug: string }) {
  const ficheiro = useRef<HTMLInputElement | null>(null);
  const [aCarregar, setACarregar] = useState(false);

  const mudar = (f: (x: Patrocinador) => Patrocinador) =>
    gravarSite(slug, (s) => ({ ...s, patrocinadores: s.patrocinadores.map((x) => (x.id === p.id ? f(x) : x)) }));

  const escolher = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setACarregar(true);
    try {
      const logo = await imagemReduzida(f);
      mudar((x) => ({ ...x, logo }));
      mostrarOk(`Logótipo de ${p.nome} guardado.`);
    } catch (err) {
      mostrarErro(textoDoErro(err, "Não foi possível usar esta imagem."));
    } finally {
      setACarregar(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <input ref={ficheiro} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={escolher} />
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
          <button type="button" className="ctl-ghost" onClick={() => mudar((x) => ({ ...x, logo: "" }))}>
            Tirar logótipo
          </button>
        )}
        <button
          type="button"
          aria-label={`Tirar ${p.nome}`}
          className="ctl-ghost size-9 justify-center px-0 text-risk"
          onClick={() => {
            gravarSite(slug, (s) => ({ ...s, patrocinadores: s.patrocinadores.filter((x) => x.id !== p.id) }));
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
