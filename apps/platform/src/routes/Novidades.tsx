import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, Megaphone, Monitor, Pencil, Send, Smartphone, Trash2, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/Shell";
import { Empty, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { Failed, Skeleton } from "./Overview";
import { useApi } from "@/lib/query";
import { shortDate } from "@/lib/format";
import { ESTADO_LABEL, ESTADO_TOM, estadoComercial, temReceita } from "@/lib/estado";
import {
  createRelease,
  deleteRelease,
  escolhidosPorOmissao,
  linhasDeNovidades,
  previewRelease,
  sendRelease,
  updateRelease,
  type Destinatario,
  type EmailPreview,
  type Release,
} from "@/lib/releases";

/**
 * As novidades da plataforma.
 *
 * ## O que esta página resolve
 *
 * Um clube que não sabe o que mudou não usa o que mudou. As novidades viviam num
 * `release.txt` na raiz do repositório, escrito a cada deploy e lido por uma
 * pessoa — e funcionalidades pedidas por um clube ficavam meses por usar **por
 * esse clube**, que não sabia que já lá estavam.
 *
 * Escreve-se a versão, vê-se o email tal e qual vai sair, escolhem-se os clubes,
 * e sai um email ao responsável de cada um.
 *
 * ## Editar depois de enviar
 *
 * Dá sempre. Uma gralha encontrada depois de mandar a três clubes tem de se
 * poder corrigir antes de mandar aos outros nove. O que se muda não chega a quem
 * já recebeu, e o editor diz isso em vez de o proibir.
 */

/** O que a pré-visualização mostra: o texto (gravado ou não) e, opcionalmente, a versão. */
type AVer = { version: string; title: string; notes: string; releaseId?: string };

export default function Novidades() {
  const releases = useApi<Release[]>("/releases");
  const [aEditar, setAEditar] = useState<Release | "nova" | null>(null);
  const [aEnviar, setAEnviar] = useState<Release | null>(null);
  const [aVer, setAVer] = useState<AVer | null>(null);

  if (releases.loading) return <Skeleton />;
  if (releases.error) return <Failed message={releases.error} onRetry={releases.reload} />;

  const lista = releases.data ?? [];

  return (
    <>
      <PageHeader title="Novidades" subtitle="O que mudou, contado aos clubes">
        <button type="button" className="ctl-primary" onClick={() => setAEditar("nova")}>
          <Megaphone className="size-3.5" strokeWidth={1.75} />
          Nova versão
        </button>
      </PageHeader>

      {lista.length === 0 ? (
        <Panel>
          <Empty
            title="Ainda não há nenhuma versão"
            detail="Escreve o que mudou, vê como fica o email, e manda aos clubes. Cada um recebe um email do responsável dele."
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          {lista.map((r) => (
            <VersaoPanel
              key={r.id}
              release={r}
              onEditar={() => setAEditar(r)}
              onEnviar={() => setAEnviar(r)}
              onVer={() => setAVer({ version: r.version, title: r.title, notes: r.notes, releaseId: r.id })}
              onMudou={releases.reload}
            />
          ))}
        </div>
      )}

      {aEditar && (
        <EditorDialog
          release={aEditar === "nova" ? null : aEditar}
          onVer={setAVer}
          onClose={() => setAEditar(null)}
          onDone={() => {
            setAEditar(null);
            releases.reload();
          }}
        />
      )}

      {aEnviar && (
        <EnvioDialog
          release={aEnviar}
          onVer={() => setAVer({ version: aEnviar.version, title: aEnviar.title, notes: aEnviar.notes, releaseId: aEnviar.id })}
          onClose={() => setAEnviar(null)}
          onDone={() => {
            setAEnviar(null);
            releases.reload();
          }}
        />
      )}

      {/* Por cima de tudo, porque se abre de dentro do editor e do envio. */}
      {aVer && <PreviewDialog texto={aVer} onClose={() => setAVer(null)} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function VersaoPanel({
  release,
  onEditar,
  onEnviar,
  onVer,
  onMudou,
}: {
  release: Release;
  onEditar: () => void;
  onEnviar: () => void;
  onVer: () => void;
  onMudou: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const rascunho = !release.sentAt;
  const itens = linhasDeNovidades(release.notes);

  async function apagar() {
    /*
     * Apagar uma versão enviada dá, mas não desfaz nada do lado de quem a
     * recebeu: o email continua na caixa dessas pessoas. A pergunta diz isso,
     * para ninguém apagar a julgar que está a "retirar" o anúncio.
     */
    const pergunta = rascunho
      ? `Apagar o rascunho ${release.version}? Não há como voltar atrás.`
      : `Apagar a versão ${release.version}? Já foi enviada a ${release.enviados} ${release.enviados === 1 ? "clube" : "clubes"}: ` +
        "o email continua na caixa deles, e aqui perde-se o registo de quem a recebeu.";
    if (!confirm(pergunta)) return;
    setBusy(true);
    try {
      await deleteRelease(release.id);
      onMudou();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHead title={release.title} hint={`Versão ${release.version}`}>
        {rascunho ? <Pill tone="neutral">Rascunho</Pill> : <Pill tone="ok">Enviada {shortDate(release.sentAt)}</Pill>}
      </PanelHead>

      <div className="space-y-3 px-5 py-4">
        <ul className="space-y-1.5">
          {itens.map((linha, i) => (
            <li key={i} className="flex gap-2 text-body leading-relaxed text-ink-2">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-4" />
              <span className="min-w-0">{linha}</span>
            </li>
          ))}
        </ul>

        {/*
          Quem já recebeu, e quem não. As falhas ficam visíveis de propósito: um
          envio a doze clubes que falha em três é indistinguível de um envio a
          nove, e o que se quer saber no dia seguinte é exactamente quais três.
        */}
        {release.recipients.length > 0 && (
          <div className="rounded-[var(--radius-control)] border border-line">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-meta">
              <span className="font-medium text-ink">
                {release.enviados === 1 ? "1 clube recebeu" : `${release.enviados} clubes receberam`}
              </span>
              {release.falhados > 0 && (
                <span className="text-risk">
                  {release.falhados === 1 ? "1 por enviar" : `${release.falhados} por enviar`}
                </span>
              )}
            </div>
            <ul className="max-h-56 overflow-y-auto">
              {release.recipients.map((d) => (
                <li key={d.academyId} className="flex gap-3 border-b border-line px-3 py-1.5 last:border-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-meta text-ink">{d.academyName}</span>
                    <span className="block truncate text-meta text-ink-4">
                      {d.sentAt ? `${d.name} · ${d.email}` : (d.error ?? "Por enviar")}
                    </span>
                  </span>
                  {d.sentAt ? <Pill tone="ok">Enviado</Pill> : <Pill tone="risk">Falhou</Pill>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="ctl-primary" disabled={busy} onClick={onEnviar}>
            <Send className="size-3.5" strokeWidth={1.75} />
            {rascunho ? "Escolher clubes e enviar" : "Enviar a mais clubes"}
          </button>
          <button type="button" className="ctl-ghost" disabled={busy} onClick={onVer}>
            <Eye className="size-3.5" strokeWidth={1.75} /> Ver o email
          </button>
          <button type="button" className="ctl-ghost" disabled={busy} onClick={onEditar}>
            <Pencil className="size-3.5" strokeWidth={1.75} /> Editar
          </button>
          <button
            type="button"
            className="ctl-ghost text-risk hover:bg-risk-soft hover:text-risk"
            disabled={busy}
            onClick={() => void apagar()}
          >
            <Trash2 className="size-3.5" strokeWidth={1.75} /> Apagar
          </button>
          <span className="ml-auto text-meta text-ink-4">
            {release.author ? `Escrita por ${release.author}` : "Escrita no painel"} · {shortDate(release.createdAt)}
          </span>
        </div>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function EditorDialog({
  release,
  onVer,
  onClose,
  onDone,
}: {
  release: Release | null;
  onVer: (t: AVer) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [version, setVersion] = useState(release?.version ?? hoje());
  const [title, setTitle] = useState(release?.title ?? "");
  const [notes, setNotes] = useState(release?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const itens = useMemo(() => linhasDeNovidades(notes), [notes]);
  const valido = version.trim().length > 0 && title.trim().length >= 3 && itens.length > 0;
  const jaSaiu = Boolean(release?.sentAt);

  async function guardar() {
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      if (release) await updateRelease(release.id, { version, title, notes });
      else await createRelease({ version, title, notes });
      onDone();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
      setBusy(false);
    }
  }

  return (
    <Dialogo
      title={release ? "Editar a versão" : "Nova versão"}
      onClose={onClose}
      footer={
        <>
          {erro && <span className="mr-auto text-meta text-risk">{erro}</span>}
          {/*
            A pré-visualização do texto **por gravar**: o que se vê é o que está
            escrito agora, não o que foi gravado da última vez.
          */}
          <button
            type="button"
            className="ctl-ghost mr-auto"
            disabled={itens.length === 0}
            onClick={() => onVer({ version, title, notes, releaseId: release?.id })}
          >
            <Eye className="size-3.5" strokeWidth={1.75} /> Pré-visualizar o email
          </button>
          <button type="button" className="ctl-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" disabled={!valido || busy} onClick={() => void guardar()}>
            {busy ? "A guardar…" : jaSaiu ? "Guardar alterações" : "Guardar rascunho"}
          </button>
        </>
      }
    >
      {/*
        Editar depois de enviar dá — foi pedido — mas o que se muda não viaja
        para trás. Dito aqui, para ninguém corrigir uma gralha a julgar que a
        corrigiu na caixa de correio de quem já leu.
      */}
      {jaSaiu && release && (
        <p className="flex items-start gap-1.5 rounded-[var(--radius-control)] bg-warn-soft px-3 py-2 text-meta leading-relaxed text-ink-2">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" strokeWidth={1.75} />
          <span>
            Esta versão já foi enviada a{" "}
            <strong className="font-medium">
              {release.enviados} {release.enviados === 1 ? "clube" : "clubes"}
            </strong>
            . O que mudares aqui vale para os próximos envios — não chega a quem já recebeu.
          </span>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
        <Campo label="Versão" hint="como quiseres">
          <input value={version} onChange={(e) => setVersion(e.target.value)} maxLength={40} className={inputClass} />
        </Campo>
        <Campo label="Assunto do email">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="O que há de novo na plataforma"
            maxLength={120}
            className={inputClass}
          />
        </Campo>
      </div>

      <Campo label="Novidades" hint="uma por linha · «Tema: descrição» põe o tema em destaque">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={12}
          placeholder={
            "- Ficha do atleta: as equipas passam a editar-se na Visão geral.\n- Quadro tático: a cor dos jogadores é livre."
          }
          className={cx(inputClass, "h-auto resize-y py-2 font-mono text-meta leading-relaxed")}
        />
      </Campo>

      <p className="text-meta text-ink-4">
        {itens.length === 0
          ? "Ainda sem novidades."
          : itens.length === 1
            ? "1 novidade no email."
            : `${itens.length} novidades no email.`}
      </p>
    </Dialogo>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O email tal e qual vai sair.
 *
 * Desenhado pelo **servidor**, com a mesma função do envio — não é uma imitação
 * feita aqui. Uma pré-visualização feita por outra mão é uma segunda versão do
 * email, e as duas acabam por discordar.
 *
 * Mostra-se como um cliente de email o mostraria: remetente, destinatário e
 * assunto por cima, que são as três coisas que se leem antes de abrir. O corpo
 * vai num `<iframe>` isolado (`sandbox`), para os estilos do email não se
 * misturarem com os do painel, nem os do painel com os do email.
 */
function PreviewDialog({ texto, onClose }: { texto: AVer; onClose: () => void }) {
  const clubes = useApi<Destinatario[]>(
    `/releases/destinatarios${texto.releaseId ? `?release=${encodeURIComponent(texto.releaseId)}` : ""}`,
  );
  const [academyId, setAcademyId] = useState<string | "">("");
  const [vista, setVista] = useState<"email" | "texto">("email");
  const [largura, setLargura] = useState<"computador" | "telemovel">("computador");
  const [email, setEmail] = useState<EmailPreview | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  /* Os clubes a quem se pode escrever, os que pagam primeiro. */
  const opcoes = useMemo(
    () =>
      (clubes.data ?? [])
        .filter((c) => c.responsavel)
        .sort((a, b) => Number(temReceita(estadoComercial(b))) - Number(temReceita(estadoComercial(a)))),
    [clubes.data],
  );

  /* Por omissão, ver como o primeiro clube pagante o recebe — é o caso real. */
  useEffect(() => {
    if (academyId === "" && opcoes.length > 0) setAcademyId(opcoes[0].id);
  }, [opcoes, academyId]);

  useEffect(() => {
    let vivo = true;
    setErro(null);
    previewRelease({ ...texto, ...(academyId ? { academyId } : {}) })
      .then((r) => vivo && setEmail(r))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Não foi possível pré-visualizar."));
    return () => {
      vivo = false;
    };
  }, [texto, academyId]);

  /*
   * Os links do email abrem num separador novo. Sem isto, carregar no botão
   * dentro da pré-visualização navegava o próprio `<iframe>`. É um acrescento só
   * da pré-visualização: o email que sai não o leva.
   */
  const srcDoc = email ? email.html.replace("<head>", '<head><base target="_blank" />') : "";

  return (
    <Dialogo title="Pré-visualizar o email" onClose={onClose} largura="max-w-4xl" footer={
      <button type="button" className="ctl-primary" onClick={onClose}>
        Fechar
      </button>
    }>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-meta text-ink-3">
          Ver como
          <select
            value={academyId}
            onChange={(e) => setAcademyId(e.target.value)}
            className={cx(inputClass, "h-8 min-w-0 flex-1")}
          >
            <option value="">Um clube de exemplo</option>
            {opcoes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex rounded-[var(--radius-control)] border border-line p-0.5">
          <Alternar ativo={vista === "email"} onClick={() => setVista("email")}>
            Email
          </Alternar>
          <Alternar ativo={vista === "texto"} onClick={() => setVista("texto")}>
            Texto simples
          </Alternar>
        </div>
        {vista === "email" && (
          <div className="flex rounded-[var(--radius-control)] border border-line p-0.5">
            <Alternar ativo={largura === "computador"} onClick={() => setLargura("computador")} titulo="Computador">
              <Monitor className="size-3.5" strokeWidth={1.75} />
            </Alternar>
            <Alternar ativo={largura === "telemovel"} onClick={() => setLargura("telemovel")} titulo="Telemóvel">
              <Smartphone className="size-3.5" strokeWidth={1.75} />
            </Alternar>
          </div>
        )}
      </div>

      {erro && <p className="text-meta text-risk">{erro}</p>}

      {email && (
        <div className="overflow-hidden rounded-[var(--radius-control)] border border-line">
          {/* O cabeçalho de um cliente de email: é o que se lê antes de abrir. */}
          <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-line bg-sunken/60 px-4 py-3 text-meta">
            <dt className="text-ink-4">De</dt>
            <dd className="min-w-0 truncate text-ink-2">
              {email.de.name}
              {email.de.email ? (
                <span className="text-ink-4"> &lt;{email.de.email}&gt;</span>
              ) : (
                <span className="text-warn"> · remetente por configurar (MAIL_FROM)</span>
              )}
            </dd>
            <dt className="text-ink-4">Para</dt>
            <dd className="min-w-0 truncate text-ink-2">
              {email.para.name} <span className="text-ink-4">&lt;{email.para.email}&gt;</span>
            </dd>
            <dt className="text-ink-4">Assunto</dt>
            <dd className="min-w-0 font-medium text-ink">{email.subject}</dd>
          </dl>

          {vista === "email" ? (
            <div className="flex justify-center bg-[#f1efeb]">
              <iframe
                title="O email"
                srcDoc={srcDoc}
                /* Sem scripts e sem mexer no painel; só abrir links num separador. */
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                className={cx(
                  "h-[62vh] border-0 bg-[#f1efeb] transition-[width]",
                  largura === "telemovel" ? "w-[390px]" : "w-full",
                )}
              />
            </div>
          ) : (
            <pre className="h-[62vh] overflow-auto whitespace-pre-wrap bg-surface px-4 py-3 font-mono text-meta leading-relaxed text-ink-2">
              {email.text}
            </pre>
          )}
        </div>
      )}

      {!email && !erro && <p className="py-10 text-center text-meta text-ink-4">A desenhar o email…</p>}
    </Dialogo>
  );
}

function Alternar({
  ativo,
  onClick,
  titulo,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  titulo?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      aria-pressed={ativo}
      className={cx(
        "flex h-7 items-center gap-1 rounded-[calc(var(--radius-control)-2px)] px-2.5 text-meta transition-colors",
        ativo ? "bg-signal-soft font-medium text-signal-ink" : "text-ink-3 hover:bg-sunken",
      )}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */

function EnvioDialog({
  release,
  onVer,
  onClose,
  onDone,
}: {
  release: Release;
  onVer: () => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const clubes = useApi<Destinatario[]>(`/releases/destinatarios?release=${encodeURIComponent(release.id)}`);
  const [escolhidos, setEscolhidos] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const lista = clubes.data ?? [];
  /* A escolha por omissão calcula-se **uma vez**, quando a lista chega: recalcular
     a cada render desfazia o que a pessoa tivesse desmarcado. */
  const marcados = escolhidos ?? escolhidosPorOmissao(lista);

  const alternar = (id: string) => {
    const novo = new Set(marcados);
    if (novo.has(id)) novo.delete(id);
    else novo.add(id);
    setEscolhidos(novo);
  };

  async function enviar() {
    if (marcados.size === 0 || busy) return;
    setBusy(true);
    setErro(null);
    try {
      const r = await sendRelease(release.id, [...marcados]);
      if (r.falhas.length > 0) {
        setErro(`${r.enviados} enviados. Não deu em: ${r.falhas.map((f) => f.name).join(", ")}.`);
        setBusy(false);
        return;
      }
      onDone();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar.");
      setBusy(false);
    }
  }

  return (
    <Dialogo
      title={`Enviar “${release.title}”`}
      onClose={onClose}
      footer={
        <>
          {erro ? (
            <span className="mr-auto text-meta text-risk">{erro}</span>
          ) : (
            <button type="button" className="ctl-ghost mr-auto" onClick={onVer}>
              <Eye className="size-3.5" strokeWidth={1.75} /> Ver o email
            </button>
          )}
          <span className="text-meta text-ink-3">
            {marcados.size === 1 ? "1 clube escolhido" : `${marcados.size} clubes escolhidos`}
          </span>
          <button type="button" className="ctl-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="ctl-primary"
            disabled={marcados.size === 0 || busy}
            onClick={() => void enviar()}
          >
            <Send className="size-3.5" strokeWidth={1.75} />
            {busy ? "A enviar…" : `Enviar a ${marcados.size}`}
          </button>
        </>
      }
    >
      <p className="text-meta leading-relaxed text-ink-3">
        Cada clube recebe um email do <strong className="font-medium text-ink-2">responsável</strong> dele — a mesma
        pessoa que assina o contrato. Os clubes que pagam vêm escolhidos; os outros estão aqui a um clique.
      </p>

      {clubes.loading && <p className="text-meta text-ink-4">A carregar os clubes…</p>}
      {clubes.error && <p className="text-meta text-risk">{clubes.error}</p>}

      <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-[var(--radius-control)] border border-line">
        {lista.map((c) => {
          const estado = estadoComercial(c);
          const podeReceber = Boolean(c.responsavel);
          return (
            <li key={c.id}>
              <label
                className={cx(
                  "flex cursor-pointer items-center gap-3 px-3 py-2",
                  !podeReceber && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  checked={marcados.has(c.id)}
                  disabled={!podeReceber}
                  onChange={() => alternar(c.id)}
                  className="size-4 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-ink">{c.name}</span>
                  <span className="block truncate text-meta text-ink-4">
                    {c.responsavel
                      ? `${c.responsavel.name} · ${c.responsavel.email}`
                      : "Sem ninguém com poderes de representação e email"}
                  </span>
                </span>
                {c.jaRecebeu && <Pill tone="neutral">Já recebeu</Pill>}
                <Pill tone={ESTADO_TOM[estado]}>{ESTADO_LABEL[estado]}</Pill>
              </label>
            </li>
          );
        })}
      </ul>

      {lista.some((c) => !c.responsavel) && (
        <p className="flex items-start gap-1.5 text-meta leading-relaxed text-warn">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
          Há clubes sem responsável registado. Para lhes escrever, alguém do clube tem de ter poderes de representação e
          um email na ficha.
        </p>
      )}
    </Dialogo>
  );
}

/* -------------------------------------------------------------------------- */

const inputClass =
  "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body text-ink focus:border-line-strong focus:outline-none";

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-meta text-ink-3">
        {label}
        {hint && <span className="ml-1.5 text-ink-4">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** Um diálogo simples — o painel não tem componente próprio para isto. */
function Dialogo({
  title,
  onClose,
  footer,
  largura = "max-w-2xl",
  children,
}: {
  title: string;
  onClose: () => void;
  footer: React.ReactNode;
  /** A pré-visualização precisa de mais largura que um formulário. */
  largura?: string;
  children: React.ReactNode;
}) {
  const eu = useRef<HTMLDivElement | null>(null);

  /*
   * Escape fecha **só o de cima**.
   *
   * A pré-visualização abre por cima do editor, e os dois ouviam a tecla: um Esc
   * para fechar a pré-visualização fechava também o editor, e o texto por gravar
   * ia com ele. O de cima é o último `[role=dialog]` do documento.
   */
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const todos = document.querySelectorAll('[role="dialog"]');
      if (todos[todos.length - 1] === eu.current) onClose();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div
      ref={eu}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cx("w-full rounded-[var(--radius-panel)] border border-line bg-surface shadow-xl", largura)}>
        <header className="border-b border-line px-5 py-3">
          <h2 className="text-section text-ink">{title}</h2>
        </header>
        <div className="space-y-4 px-5 py-4">{children}</div>
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          {footer}
        </footer>
      </div>
    </div>
  );
}

/** "29/09/2026" — o formato que o `release.txt` já usava no topo. */
function hoje(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
