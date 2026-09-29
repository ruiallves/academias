import { useMemo, useState } from "react";
import { Megaphone, Pencil, Send, Trash2, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/Shell";
import { Empty, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { Failed, Skeleton } from "./Overview";
import { useApi } from "@/lib/query";
import { shortDate } from "@/lib/format";
import { ESTADO_LABEL, ESTADO_TOM, estadoComercial } from "@/lib/estado";
import {
  createRelease,
  deleteRelease,
  escolhidosPorOmissao,
  linhasDeNovidades,
  sendRelease,
  updateRelease,
  type Destinatario,
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
 * Escreve-se a versão, escolhem-se os clubes, e sai um email ao responsável de
 * cada um.
 *
 * ## Rascunho e envio
 *
 * Uma versão nasce rascunho: escreve-se hoje, relê-se amanhã, manda-se quando
 * estiver. Depois de enviada fecha-se — o texto que saiu por email não se
 * reescreve, porque reescrevê-lo mudava o histórico sem mudar o que as pessoas
 * leram. Reenviar a clubes **novos** continua a dar, e é para isso que serve:
 * um clube que entrou depois, ou um email que falhou.
 */
export default function Novidades() {
  const releases = useApi<Release[]>("/releases");
  const [aEditar, setAEditar] = useState<Release | "nova" | null>(null);
  const [aEnviar, setAEnviar] = useState<Release | null>(null);

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
            detail="Escreve o que mudou e manda aos clubes. Cada um recebe um email do responsável dele."
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
              onMudou={releases.reload}
            />
          ))}
        </div>
      )}

      {aEditar && (
        <EditorDialog
          release={aEditar === "nova" ? null : aEditar}
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
          onClose={() => setAEnviar(null)}
          onDone={() => {
            setAEnviar(null);
            releases.reload();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function VersaoPanel({
  release,
  onEditar,
  onEnviar,
  onMudou,
}: {
  release: Release;
  onEditar: () => void;
  onEnviar: () => void;
  onMudou: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const rascunho = !release.sentAt;
  const itens = linhasDeNovidades(release.notes);

  async function apagar() {
    if (!confirm(`Apagar a versão ${release.version}? Não há como voltar atrás.`)) return;
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
                  {d.sentAt ? (
                    <Pill tone="ok">Enviado</Pill>
                  ) : (
                    <Pill tone="risk">Falhou</Pill>
                  )}
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
          {/*
            Editar e apagar só num rascunho: ver o cabeçalho. O servidor recusa na
            mesma — isto é só não abrir um botão que abre para dizer que não.
          */}
          {rascunho && (
            <>
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
            </>
          )}
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
  onClose,
  onDone,
}: {
  release: Release | null;
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
          <button type="button" className="ctl-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" disabled={!valido || busy} onClick={() => void guardar()}>
            {busy ? "A guardar…" : "Guardar rascunho"}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
        <Campo label="Versão" hint="como quiseres">
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            maxLength={40}
            className={inputClass}
          />
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

      <Campo label="Novidades" hint="uma por linha">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={10}
          placeholder={"- Ficha do atleta: as equipas passam a editar-se na Visão geral.\n- Quadro tático: a cor dos jogadores é livre."}
          className={cx(inputClass, "resize-y font-mono text-meta leading-relaxed")}
        />
      </Campo>

      {/*
        A pré-visualização, porque quem escreve tem de ver o que vai sair. O
        travessão à cabeça é opcional: escreve-se como num release.txt e o email
        faz a lista. Ver `linhasDeNovidades`.
      */}
      {itens.length > 0 && (
        <div className="rounded-[var(--radius-control)] bg-sunken px-4 py-3">
          <p className="mb-2 text-meta text-ink-3">
            {itens.length === 1 ? "1 novidade no email" : `${itens.length} novidades no email`}
          </p>
          <ul className="space-y-1.5">
            {itens.map((linha, i) => (
              <li key={i} className="flex gap-2 text-meta leading-relaxed text-ink-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-4" />
                <span className="min-w-0">{linha}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialogo>
  );
}

/* -------------------------------------------------------------------------- */

function EnvioDialog({ release, onClose, onDone }: { release: Release; onClose: () => void; onDone: () => void }) {
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
          {erro && <span className="mr-auto text-meta text-risk">{erro}</span>}
          <span className="mr-auto text-meta text-ink-3">
            {marcados.size === 1 ? "1 clube escolhido" : `${marcados.size} clubes escolhidos`}
          </span>
          <button type="button" className="ctl-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" disabled={marcados.size === 0 || busy} onClick={() => void enviar()}>
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
  children,
}: {
  title: string;
  onClose: () => void;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-[var(--radius-panel)] border border-line bg-surface shadow-xl">
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
