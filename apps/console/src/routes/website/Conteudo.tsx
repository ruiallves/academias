import { useEffect, useRef, useState } from "react";
import { Handshake, ImagePlus, Inbox, Loader2, Mail, Plus, Trash2, Users } from "@/lib/icons";
import { Empty, Loading, cx } from "@/components/primitives";
import { Dialog, dialogInputClass } from "@/components/Dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Interruptor } from "@/components/definicoes/ui";
import { useStore } from "@/lib/store";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import {
  apagarMensagem,
  apagarPatrocinador,
  editarPatrocinadorAdiado,
  enviarImagem,
  guardarConfig,
  guardarPatrocinador,
  listarMensagens,
  mudarMensagem,
  useSite,
  type MensagemDoSite,
  type Patrocinador,
} from "@/lib/website";
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
    // Desligar a equipa desliga também as fotografias: voltar a ligá-la não as publica sem se pedir.
    void guardarConfig({ equipas: { ...site.equipas, [id]: { ...site.equipas[id], visivel: nova, plantel: nova, ...(nova ? {} : { fotos: false }) } } });
  };
  /* As fotografias dos atletas no plantel: só numa equipa que está no site. */
  const comFotos = (id: string) => ligada(id) && site.equipas[id]?.fotos === true;
  const mudarFotos = (id: string) => {
    void guardarConfig({ equipas: { ...site.equipas, [id]: { ...site.equipas[id], visivel: true, plantel: true, fotos: !comFotos(id) } } });
  };

  const equipas = [...store.teams].sort((a, b) => b.maxAge - a.maxAge || a.name.localeCompare(b.name));

  return (
    <>
      <p className="mb-4 rounded-[10px] bg-sunken/60 px-3.5 py-2.5 text-meta leading-relaxed text-ink-2">
        Uma equipa no site mostra a equipa técnica, o plantel (nome, número e posição de cada atleta), os jogos e os resultados. Desligada,
        não aparece nada dela. Nos escalões de formação, liga só com o consentimento das famílias.
      </p>
      <p className="mb-4 rounded-[10px] bg-sunken/60 px-3.5 py-2.5 text-meta leading-relaxed text-ink-2">
        "Fotos dos atletas" mostra no plantel a fotografia de cada atleta, a da ficha dele. Liga só com a autorização de imagem das famílias. Desligada, ou num
        atleta sem fotografia, aparece uma imagem padrão com o número.
      </p>
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="grid grid-cols-[96px_minmax(0,1fr)_72px_88px] items-center gap-3 border-b border-line bg-sunken/40 px-4 py-2 text-meta font-medium text-ink-3">
          <span>Fotografia</span>
          <span>Equipa</span>
          <span className="text-center">No site</span>
          <span className="text-center leading-tight">Fotos dos atletas</span>
        </div>
        <ul>
          {equipas.map((t) => {
            const on = ligada(t.id);
            return (
              <li key={t.id} className="grid grid-cols-[96px_minmax(0,1fr)_72px_88px] items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <FotoDaEquipa id={t.id} nome={t.name} />
                <span className={cx("truncate text-body", on ? "font-medium text-ink" : "text-ink-3")}>{t.name}</span>
                <span className="flex justify-center">
                  <Interruptor ligado={on} onChange={() => mudar(t.id)} label={`Mostrar ${t.name} no site`} />
                </span>
                <span className="flex justify-center">
                  <Interruptor ligado={comFotos(t.id)} onChange={() => mudarFotos(t.id)} disabled={!on} label={`Mostrar as fotografias dos atletas de ${t.name} no site`} />
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

const dataEHora = (iso: string) =>
  new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" }).format(new Date(iso));

/**
 * O que chega pelo formulário de contactos do site.
 *
 * Lê-se de fresco ao abrir a secção (as mensagens chegam de fora a qualquer
 * hora; uma cópia em memória estaria velha). Abrir uma marca-a lida; tratar e
 * apagar são decisões, e pedem `website:write`. Responder é por email: o
 * botão abre o programa de correio com o assunto já posto.
 */
export function Mensagens() {
  const store = useStore();
  const site = useSite(store.academy.slug);
  const { session } = useSession();
  const podeTratar = can(session, "website:write");

  const [lista, setLista] = useState<MensagemDoSite[] | null>(null);
  const [separador, setSeparador] = useState<"porTratar" | "tratadas">("porTratar");
  const [aberta, setAberta] = useState<MensagemDoSite | null>(null);
  const [apagar, setApagar] = useState<MensagemDoSite | null>(null);

  useEffect(() => {
    let viva = true;
    listarMensagens()
      .then((m) => viva && setLista(m))
      .catch(() => viva && setLista([]));
    return () => {
      viva = false;
    };
  }, []);

  const substituir = (m: MensagemDoSite) => setLista((l) => (l ? l.map((x) => (x.id === m.id ? m : x)) : l));

  const abrir = async (m: MensagemDoSite) => {
    setAberta(m);
    if (m.lida) return;
    // Abrir é ler: marca-se já, e a pastilha do submenu baixa com ela.
    try {
      const lida = await mudarMensagem(m.id, { lida: true }, m);
      substituir(lida);
      setAberta(lida);
    } catch {
      // O erro já apareceu no cartão de erros; a mensagem fica aberta na mesma.
    }
  };

  const tratar = async (m: MensagemDoSite, tratada: boolean) => {
    const depois = await mudarMensagem(m.id, { tratada }, m);
    substituir(depois);
    setAberta(depois);
    mostrarOk(tratada ? "Mensagem tratada." : "Mensagem reaberta.");
  };

  if (lista === null) return <Loading size="panel" />;

  const porTratar = lista.filter((m) => !m.tratada);
  const tratadas = lista.filter((m) => m.tratada);
  const visiveis = separador === "porTratar" ? porTratar : tratadas;
  const email = site.identidade.email.trim();

  if (lista.length === 0) {
    return (
      <Empty icon={Inbox} title="Ainda não há mensagens" detail="O formulário de contactos do site entrega aqui cada mensagem, com o nome, o email e o assunto de quem escreveu.">
        <p className="mt-2 max-w-[52ch] text-meta leading-relaxed text-ink-3">
          {email ? (
            <>
              Cada mensagem vai também por email para <strong className="font-medium text-ink-2">{email}</strong>, o endereço posto na Identidade.
            </>
          ) : (
            <>Para as receber também por email, põe o endereço do clube nos Contactos da Identidade.</>
          )}
        </p>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-sunken p-1" role="tablist" aria-label="Mensagens">
          {(
            [
              ["porTratar", "Por tratar", porTratar.length],
              ["tratadas", "Tratadas", tratadas.length],
            ] as const
          ).map(([k, rotulo, n]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={separador === k}
              onClick={() => setSeparador(k)}
              className={cx(
                "h-8 rounded-[7px] px-3 text-meta font-semibold transition-colors duration-[120ms]",
                separador === k ? "bg-surface text-ink shadow-[0_1px_2px_rgb(26_25_23/0.06)]" : "text-ink-3 hover:text-ink-2",
              )}
            >
              {rotulo} <span className="tabular-nums text-ink-4">{n}</span>
            </button>
          ))}
        </div>
        <p className="text-meta text-ink-3">
          {email ? (
            <>
              Chegam também por email a <span className="font-medium text-ink-2">{email}</span>.
            </>
          ) : (
            "Põe o email do clube na Identidade para as receber também por email."
          )}
        </p>
      </div>

      {visiveis.length === 0 ? (
        <Empty
          icon={Inbox}
          title={separador === "porTratar" ? "Nada por tratar" : "Ainda nenhuma tratada"}
          detail={separador === "porTratar" ? "Todas as mensagens têm resposta dada." : "Uma mensagem respondida marca-se como tratada e passa para aqui."}
          compact
        />
      ) : (
        <ul className="overflow-hidden rounded-[12px] border border-line bg-surface">
          {visiveis.map((m) => (
            <li key={m.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => void abrir(m)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-sunken/40"
              >
                <span className={cx("size-2 shrink-0 rounded-full", m.lida ? "bg-transparent" : "bg-signal-strong")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={cx("block truncate text-body", m.lida ? "text-ink" : "font-semibold text-ink")}>{m.nome}</span>
                  <span className="block truncate text-meta text-ink-3">{m.assunto || "Sem assunto"}</span>
                </span>
                <span className="shrink-0 text-meta tabular-nums text-ink-4">{dataEHora(m.recebidaEm)}</span>
                {!m.lida && <span className="sr-only">Por ler</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {aberta && (
        <LerMensagem
          m={aberta}
          podeTratar={podeTratar}
          onClose={() => setAberta(null)}
          onTratar={(tratada) => tratar(aberta, tratada)}
          onApagar={() => setApagar(aberta)}
        />
      )}

      {apagar && (
        <ConfirmDialog
          title="Apagar a mensagem?"
          onClose={() => setApagar(null)}
          onConfirm={async () => {
            await apagarMensagem(apagar.id, apagar);
            setLista((l) => (l ? l.filter((x) => x.id !== apagar.id) : l));
            setApagar(null);
            setAberta(null);
            mostrarOk("Mensagem apagada.");
          }}
        >
          A mensagem de «{apagar.nome}» desaparece daqui e não volta. Se já lhe respondeste, marca-a como tratada em vez de a apagar.
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Uma mensagem aberta: tudo o que a pessoa escreveu, e o que se lhe pode fazer. */
function LerMensagem({
  m,
  podeTratar,
  onClose,
  onTratar,
  onApagar,
}: {
  m: MensagemDoSite;
  podeTratar: boolean;
  onClose: () => void;
  onTratar: (tratada: boolean) => Promise<void>;
  onApagar: () => void;
}) {
  const [aGravar, setAGravar] = useState(false);
  const mailto = `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(`Re: ${m.assunto || "A sua mensagem"}`)}`;

  const tratar = async () => {
    setAGravar(true);
    try {
      await onTratar(!m.tratada);
    } catch {
      // O erro já apareceu no cartão de erros.
    } finally {
      setAGravar(false);
    }
  };

  return (
    <Dialog
      title={m.assunto || "Sem assunto"}
      subtitle={`${m.nome} · ${dataEHora(m.recebidaEm)}`}
      icon={<Inbox className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={560}
      footer={
        <>
          {podeTratar && (
            <button type="button" className="ctl-ghost text-risk" onClick={onApagar} disabled={aGravar}>
              <Trash2 className="size-3.5" strokeWidth={1.75} />
              Apagar
            </button>
          )}
          {podeTratar && (
            <button type="button" className="ctl-outline" onClick={() => void tratar()} disabled={aGravar}>
              {m.tratada ? "Reabrir" : "Marcar como tratada"}
            </button>
          )}
          <a href={mailto} className="ctl-primary">
            <Mail className="size-3.5" strokeWidth={1.75} />
            Responder por email
          </a>
        </>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <dl className="grid gap-x-4 gap-y-2 text-meta sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-ink-3">Nome</dt>
          <dd className="font-medium text-ink">{m.nome}</dd>
          <dt className="text-ink-3">Email</dt>
          <dd className="min-w-0 truncate text-ink">
            <a href={`mailto:${m.email}`} className="hover:underline">
              {m.email}
            </a>
          </dd>
          {m.telefone && (
            <>
              <dt className="text-ink-3">Telefone</dt>
              <dd className="text-ink">
                <a href={`tel:${m.telefone}`} className="hover:underline">
                  {m.telefone}
                </a>
              </dd>
            </>
          )}
        </dl>
        <p className="whitespace-pre-wrap rounded-[10px] bg-sunken/60 px-3.5 py-3 text-body leading-relaxed text-ink">{m.mensagem}</p>
        {m.tratada && (
          <p className="text-meta text-ink-3">
            Tratada{m.tratadaPor ? ` por ${m.tratadaPor}` : ""}
            {m.tratadaEm ? ` a ${dataEHora(m.tratadaEm)}` : ""}.
          </p>
        )}
      </div>
    </Dialog>
  );
}
