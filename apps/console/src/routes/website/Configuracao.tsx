import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy } from "@/lib/icons";
import { cx } from "@/components/primitives";
import { Bloco, Campo, campoClass, Leitura } from "@/components/definicoes/ui";
import { ClubMark } from "@/components/ClubMark";
import { useStore } from "@/lib/store";
import { gravarSite, useSite, type Layout, type SiteDoClube } from "@/lib/website";
import { mostrarOk } from "@/lib/avisos";

/* -------------------------------------------------------------------------- */
/* Identidade                                                                   */
/* -------------------------------------------------------------------------- */

const REDES: { key: keyof SiteDoClube["identidade"]["redes"]; label: string; exemplo: string }[] = [
  { key: "facebook", label: "Facebook", exemplo: "https://facebook.com/oclube" },
  { key: "instagram", label: "Instagram", exemplo: "https://instagram.com/oclube" },
  { key: "youtube", label: "YouTube", exemplo: "https://youtube.com/@oclube" },
  { key: "x", label: "X", exemplo: "https://x.com/oclube" },
  { key: "tiktok", label: "TikTok", exemplo: "https://tiktok.com/@oclube" },
];

/**
 * Quem é o clube. Um rascunho local e um "Guardar": escrever a história de
 * um clube leva tempo, e gravar a cada tecla deixava o site a meio de uma
 * frase.
 */
export function Identidade() {
  const store = useStore();
  const slug = store.academy.slug;
  const site = useSite(slug);
  const [d, setD] = useState(site.identidade);
  const mudou = JSON.stringify(d) !== JSON.stringify(site.identidade);

  const campo = (k: Exclude<keyof typeof d, "redes">) => ({
    value: d[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value }),
  });

  const guardar = () => {
    gravarSite(slug, (s) => ({ ...s, identidade: d }));
    mostrarOk("Identidade guardada.");
  };

  return (
    <div>
      <Bloco titulo="O clube" descricao="O nome e o emblema são os da consola. Mudam-se nas Definições.">
        <div className="flex items-center gap-3">
          <ClubMark size={44} />
          <div className="min-w-0">
            <Leitura label="Nome" valor={store.academy.name} />
          </div>
        </div>
      </Bloco>

      <Bloco titulo="Apresentação" descricao="O lema vai para o rodapé. O texto aparece na página do clube e é o que o Google e o WhatsApp mostram.">
        <div className="space-y-4">
          <Campo label="Lema">
            <input className={campoClass} placeholder="A formação primeiro" {...campo("lema")} />
          </Campo>
          <Campo label="Texto de apresentação" ajuda="Duas ou três frases. Quem é o clube, o que tem, onde fica.">
            <textarea className={cx(campoClass, "h-28 py-2.5")} {...campo("sobre")} />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
            <Campo label="Fundado em">
              <input className={campoClass} inputMode="numeric" placeholder="1947" {...campo("fundacao")} />
            </Campo>
          </div>
          <Campo label="História" ajuda="Parágrafos separados por uma linha em branco.">
            <textarea className={cx(campoClass, "h-44 py-2.5")} {...campo("historia")} />
          </Campo>
        </div>
      </Bloco>

      <Bloco titulo="Contactos" descricao="Aparecem no rodapé de todas as páginas e na página de contactos, com o mapa.">
        <div className="space-y-4">
          <Campo label="Morada" ajuda="Uma linha por cada linha da morada.">
            <textarea className={cx(campoClass, "h-24 py-2.5")} placeholder={"Estádio Municipal\nRua do Campo, 1\n4800-000 Guimarães"} {...campo("morada")} />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Telefone">
              <input className={campoClass} type="tel" {...campo("telefone")} />
            </Campo>
            <Campo label="Email">
              <input className={campoClass} type="email" {...campo("email")} />
            </Campo>
          </div>
        </div>
      </Bloco>

      <Bloco titulo="Redes sociais" descricao="Só as que o clube usa. As vazias não aparecem.">
        <div className="grid gap-4 sm:grid-cols-2">
          {REDES.map((r) => (
            <Campo key={r.key} label={r.label}>
              <input
                className={campoClass}
                type="url"
                placeholder={r.exemplo}
                value={d.redes[r.key] ?? ""}
                onChange={(e) => setD({ ...d, redes: { ...d.redes, [r.key]: e.target.value } })}
              />
            </Campo>
          ))}
        </div>
      </Bloco>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-canvas/95 py-3 backdrop-blur">
        <button type="button" className="ctl-ghost" disabled={!mudou} onClick={() => setD(site.identidade)}>
          Desfazer
        </button>
        <button type="button" className="ctl-primary" disabled={!mudou} onClick={guardar}>
          Guardar
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Aspeto                                                                       */
/* -------------------------------------------------------------------------- */

const LAYOUTS: { key: Layout; nome: string; descricao: string }[] = [
  { key: "classico", nome: "Clássico", descricao: "Cabeçalho em cima, três notícias em destaque, faixa do próximo jogo." },
  { key: "porto", nome: "Porto", descricao: "Barra lateral com ícones, uma notícia de cada vez a toda a largura, cartaz do jogo." },
];

export function Aspeto() {
  const store = useStore();
  const slug = store.academy.slug;
  const site = useSite(slug);

  return (
    <div>
      <Bloco titulo="Layout" descricao="Os dois mostram o mesmo conteúdo. Muda só a disposição da página.">
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Layout do site">
          {LAYOUTS.map((l) => {
            const on = site.layout === l.key;
            return (
              <button
                key={l.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  gravarSite(slug, (s) => ({ ...s, layout: l.key }));
                  mostrarOk(`Layout ${l.nome} escolhido.`);
                }}
                className={cx(
                  "rounded-[12px] border bg-surface p-3 text-left transition-colors",
                  on ? "border-signal-ink ring-1 ring-signal-ink" : "border-line hover:border-line-strong",
                )}
              >
                <Miniatura layout={l.key} />
                <span className="mt-3 flex items-center gap-2 text-panel text-ink">
                  {l.nome}
                  {on && <Check className="size-4 text-signal-ink" strokeWidth={2} />}
                </span>
                <span className="mt-1 block text-meta leading-relaxed text-ink-3">{l.descricao}</span>
              </button>
            );
          })}
        </div>
      </Bloco>

      <Bloco titulo="Cor e emblema" descricao={<>São os do clube, os mesmos da consola e da app. Mudam-se nas <Link to="/definicoes" className="font-medium text-signal-ink hover:underline">Definições</Link>.</>}>
        <div className="flex items-center gap-3">
          <ClubMark size={44} />
          <span className="size-9 rounded-full ring-1 ring-black/10" style={{ background: store.academy.signalColor }} aria-hidden />
          <span className="font-mono text-meta text-ink-3">{store.academy.signalColor}</span>
        </div>
      </Bloco>
    </div>
  );
}

/** Um desenho de cada layout, em blocos, para se escolher sem abrir o site. */
function Miniatura({ layout }: { layout: Layout }) {
  const cor = "var(--color-signal)";
  if (layout === "classico") {
    return (
      <svg viewBox="0 0 160 100" className="w-full rounded-[8px] border border-line bg-canvas" aria-hidden>
        <rect x="0" y="0" width="160" height="6" fill="#1a1917" />
        <rect x="0" y="6" width="160" height="10" fill="#fff" />
        <rect x="8" y="8.5" width="5" height="5" rx="1" fill={cor} />
        <rect x="128" y="9" width="24" height="4" rx="1" fill={cor} />
        <rect x="8" y="21" width="96" height="36" rx="2" fill="#d3cfc6" />
        <rect x="108" y="21" width="44" height="17" rx="2" fill="#d3cfc6" />
        <rect x="108" y="40" width="44" height="17" rx="2" fill="#d3cfc6" />
        <rect x="8" y="62" width="70" height="16" rx="2" fill="#1a1917" />
        <rect x="82" y="62" width="70" height="16" rx="2" fill="#fff" stroke="#e5e2dc" />
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={8 + i * 37} y="83" width="33" height="12" rx="1.5" fill="#e5e2dc" />
        ))}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 160 100" className="w-full rounded-[8px] border border-line bg-white" aria-hidden>
      <rect x="0" y="0" width="16" height="100" fill="#fff" stroke="#e5e2dc" />
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill={cor} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x="5" y={20 + i * 9} width="6" height="4" rx="1" fill="#ada89d" />
      ))}
      <rect x="0" y="90" width="16" height="10" fill={cor} />
      <rect x="16" y="0" width="144" height="5" fill="#fff" stroke="#e5e2dc" />
      <rect x="16" y="5" width="144" height="38" fill="#8a867c" />
      <rect x="22" y="22" width="70" height="5" fill="#fff" />
      <rect x="22" y="29" width="54" height="5" fill="#fff" />
      <rect x="22" y="36" width="16" height="4" fill={cor} />
      <rect x="16" y="43" width="50" height="20" fill="#fff" stroke="#e5e2dc" />
      <rect x="66" y="43" width="50" height="20" fill="#fff" stroke="#e5e2dc" />
      <rect x="116" y="43" width="44" height="20" fill={cor} />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="22" y={68 + i * 10} width="26" height="8" fill="#d3cfc6" />
          <rect x="52" y={69 + i * 10} width="50" height="3" fill={cor} />
          <rect x="52" y={74 + i * 10} width="40" height="2" fill="#d3cfc6" />
        </g>
      ))}
      <rect x="118" y="68" width="36" height="28" fill={cor} />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Domínio                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * O domínio. Registá-lo e apontá-lo é trabalho nosso (ver
 * `docs/08-site-do-clube.md`); aqui o clube diz qual é, e vê o que falta.
 */
export function Dominio() {
  const store = useStore();
  const slug = store.academy.slug;
  const site = useSite(slug);
  const [dominio, setDominio] = useState(site.dominio);
  const limpo = dominio.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const valido = !limpo || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(limpo);
  const preview = `${slug}.sites.academias.pt`;

  return (
    <div>
      <Bloco titulo="Domínio do clube" descricao="Sem www. Registamos o domínio em nome do clube, que fica o titular, e tratamos do resto.">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <input
              className={cx(campoClass, !valido && "border-risk")}
              placeholder="oclube.pt"
              value={dominio}
              onChange={(e) => setDominio(e.target.value)}
              aria-invalid={!valido}
              aria-label="Domínio do clube"
            />
            {!valido && <p className="mt-1.5 text-meta text-risk">Escreve só o domínio, por exemplo oclube.pt.</p>}
          </div>
          <button
            type="button"
            className="ctl-primary h-10"
            disabled={!valido || limpo === site.dominio}
            onClick={() => {
              setDominio(limpo);
              gravarSite(slug, (s) => ({ ...s, dominio: limpo }));
              mostrarOk(limpo ? "Domínio guardado." : "Domínio removido.");
            }}
          >
            Guardar
          </button>
        </div>
      </Bloco>

      <Bloco titulo="Enquanto o domínio não aponta" descricao="O site já funciona neste endereço, para se ir preparando.">
        <Copiavel texto={preview} />
      </Bloco>

      {site.dominio && (
        <Bloco titulo="O que configurar no DNS" descricao="Feito por nós. Fica aqui para se saber o que está pedido.">
          <div className="overflow-hidden rounded-[12px] border border-line">
            <table className="w-full text-meta">
              <thead className="bg-sunken/40 text-left text-ink-3">
                <tr>
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 font-medium">Nome</th>
                  <th className="px-3 py-2 font-medium">Valor</th>
                </tr>
              </thead>
              <tbody className="font-mono text-ink">
                <tr className="border-t border-line">
                  <td className="px-3 py-2">A</td>
                  <td className="px-3 py-2">{site.dominio}</td>
                  <td className="px-3 py-2">76.76.21.21</td>
                </tr>
                <tr className="border-t border-line">
                  <td className="px-3 py-2">CNAME</td>
                  <td className="px-3 py-2">www.{site.dominio}</td>
                  <td className="px-3 py-2">cname.vercel-dns.com</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-meta text-ink-3">O certificado SSL é emitido sozinho quando o DNS apontar. Estado: por ligar.</p>
        </Bloco>
      )}
    </div>
  );
}

function Copiavel({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-[10px] border border-line bg-sunken/40 px-3 py-2.5 font-mono text-meta text-ink">{texto}</code>
      <button
        type="button"
        className="ctl-outline h-10"
        onClick={() => {
          void navigator.clipboard?.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1500);
        }}
      >
        {copiado ? <Check className="size-4" strokeWidth={2} /> : <Copy className="size-4" strokeWidth={1.75} />}
        {copiado ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}
