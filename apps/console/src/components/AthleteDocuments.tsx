import { useRef, useState, type FormEvent } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { Dialog, dialogInputClass } from "./Dialog";
import { cx, Empty, Panel, PanelHead } from "./primitives";
import { Download, FileText, Pencil, Plus, Trash2, Upload, X } from "@/lib/icons";
import { apiDelete, apiPatch, apiPost } from "@/lib/http";
import { useApi } from "@/lib/query";
import { longDate } from "@/lib/format";
import type { Athlete } from "@/data/types";

/**
 * Os documentos de um atleta — o separador "Documentos" da ficha.
 *
 * ## O que é um documento
 *
 * Um nome que o clube dá ("Cartão de cidadão", "Exame médico 2026",
 * "Autorização de imagem") e os ficheiros que o compõem: fotografias tiradas
 * com o telemóvel, um PDF, um Word. Vários ficheiros no mesmo documento porque
 * é assim que as coisas chegam — a frente e o verso do cartão são duas
 * fotografias de uma coisa só.
 *
 * ## Como se carrega
 *
 * Em três passos, como as fotografias: o servidor autoriza uma chave, o ficheiro
 * vai **directo do browser** para o armazenamento, e o servidor confirma que
 * chegou antes de o juntar ao documento. Nada de megabytes a atravessar a API.
 *
 * ## Quem vê
 *
 * Só o staff que edita a ficha, e só os atletas das equipas dele — é o servidor
 * que o decide (`athlete-ficha.service`). A família não vê este separador. Os
 * links para abrir um ficheiro são assinados e duram dez minutos: não servem
 * para partilhar.
 */

type Ficheiro = { key: string; name: string; type: string; url: string | null };
type Documento = { id: string; name: string; createdAt: string; createdByName: string | null; files: Ficheiro[] };

/** O que o servidor aceita (`DOC_TIPOS`). O `accept` é uma ajuda; quem decide é ele. */
const ACEITA = "image/jpeg,image/png,image/webp,application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_FICHEIROS = 10;

/** Carrega um ficheiro e devolve a chave com que ficou guardado. */
async function carregar(athleteId: string, file: File): Promise<{ key: string; name: string }> {
  const a = await apiPost<{ url: string; headers?: Record<string, string>; key: string; maxBytes: number }>(
    `/api/athletes/${athleteId}/documentos/upload`,
    { contentType: file.type },
  );
  if (file.size > a.maxBytes) {
    throw new Error(`«${file.name}» tem mais de ${Math.round(a.maxBytes / 1024 / 1024)} MB`);
  }
  const r = await fetch(a.url, {
    method: "PUT",
    headers: { "Content-Type": file.type, ...(a.headers ?? {}) },
    body: file,
  });
  if (!r.ok) throw new Error(`Não foi possível carregar «${file.name}»`);
  return { key: a.key, name: file.name };
}

export function AthleteDocuments({ athlete }: { athlete: Athlete }) {
  const { data, loading, error, reload } = useApi<Documento[]>(`/api/athletes/${athlete.id}/documentos`);
  const [novo, setNovo] = useState(false);
  const [aEditar, setAEditar] = useState<Documento | null>(null);
  const [aApagar, setAApagar] = useState<Documento | null>(null);

  const docs = data ?? [];

  return (
    <Panel>
      <PanelHead title="Documentos" hint={docs.length > 0 ? `${docs.length}` : undefined}>
        <button type="button" className="ctl-primary" onClick={() => setNovo(true)}>
          <Plus className="size-3.5" strokeWidth={2} />
          Novo documento
        </button>
      </PanelHead>

      {error ? (
        <p className="px-5 py-8 text-center text-meta text-ink-3">{error}</p>
      ) : loading && !data ? null : docs.length === 0 ? (
        <div className="px-5 py-12">
          <Empty
            icon={FileText}
            title="Ainda sem documentos"
            detail="Cartão de cidadão, exame médico, autorizações. Dá um nome ao documento e junta-lhe fotografias ou ficheiros."
          />
        </div>
      ) : (
        <ul>
          {docs.map((d) => (
            <li key={d.id} className="border-b border-line px-5 py-4 last:border-0">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-sunken text-ink-3">
                  <FileText className="size-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-medium text-ink">{d.name}</div>
                  <div className="text-meta text-ink-3">
                    {longDate(new Date(d.createdAt))}
                    {d.createdByName && ` · ${d.createdByName}`}
                    {` · ${d.files.length} ${d.files.length === 1 ? "ficheiro" : "ficheiros"}`}
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    className="ctl-ghost size-8 justify-center px-0 text-ink-3 hover:text-ink"
                    onClick={() => setAEditar(d)}
                    aria-label={`Editar ${d.name}`}
                    title="Mudar o nome ou juntar ficheiros"
                  >
                    <Pencil className="size-3.5" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    className="ctl-ghost size-8 justify-center px-0 text-ink-4 hover:text-risk"
                    onClick={() => setAApagar(d)}
                    aria-label={`Apagar ${d.name}`}
                    title="Apagar documento"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.75} />
                  </button>
                </span>
              </div>

              <ul className="mt-3 flex flex-wrap gap-2 pl-12">
                {d.files.map((f) => (
                  <li key={f.key}>
                    <FicheiroLink f={f} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {(novo || aEditar) && (
        <DocumentoDialog
          athlete={athlete}
          doc={aEditar}
          onClose={() => {
            setNovo(false);
            setAEditar(null);
          }}
          onSaved={() => {
            setNovo(false);
            setAEditar(null);
            reload();
          }}
          onChanged={reload}
        />
      )}

      {aApagar && (
        <ConfirmDialog
          title={`Apagar «${aApagar.name}»?`}
          onClose={() => setAApagar(null)}
          onConfirm={async () => {
            await apiDelete(`/api/documentos-de-atleta/${aApagar.id}`);
            setAApagar(null);
            reload();
          }}
        >
          O documento e {aApagar.files.length === 1 ? "o ficheiro dele" : `os ${aApagar.files.length} ficheiros dele`} são
          apagados de vez. Não se desfaz.
        </ConfirmDialog>
      )}
    </Panel>
  );
}

/**
 * Um ficheiro: a miniatura, se for imagem, e o nome. Abre noutro separador.
 *
 * O link é assinado e dura dez minutos; uma página aberta há mais tempo pode
 * tê-lo morto, e por isso sem link o ficheiro mostra-se sem ser clicável em vez
 * de levar a um erro do armazenamento.
 */
function FicheiroLink({ f }: { f: Ficheiro }) {
  const imagem = f.type.startsWith("image/");
  const conteudo = (
    <>
      {imagem && f.url ? (
        <img src={f.url} alt="" className="size-10 shrink-0 rounded-[6px] object-cover" loading="lazy" />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[6px] bg-sunken text-[10px] font-semibold uppercase text-ink-3">
          {f.name.includes(".") ? f.name.split(".").pop()!.slice(0, 4) : "doc"}
        </span>
      )}
      <span className="min-w-0 max-w-[22ch] truncate text-meta text-ink-2">{f.name}</span>
      {f.url && <Download className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />}
    </>
  );
  const classe = "flex items-center gap-2 rounded-[10px] border border-line bg-surface py-1.5 pr-2.5 pl-1.5";

  return f.url ? (
    <a href={f.url} target="_blank" rel="noreferrer" className={cx(classe, "transition-colors duration-[120ms] hover:border-line-strong")} title={`Abrir ${f.name}`}>
      {conteudo}
    </a>
  ) : (
    <span className={classe}>{conteudo}</span>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Novo documento, ou editar um: o nome, e os ficheiros.
 *
 * Os ficheiros escolhidos só sobem ao gravar. Carregar à medida que se escolhe
 * deixava ficheiros no armazenamento de cada vez que alguém fechasse o diálogo
 * a meio — e são cópias de documentos de menores.
 */
function DocumentoDialog({
  athlete,
  doc,
  onClose,
  onSaved,
  onChanged,
}: {
  athlete: Athlete;
  doc: Documento | null;
  onClose: () => void;
  onSaved: () => void;
  /** Um ficheiro saiu do documento sem o diálogo fechar: a lista de trás actualiza. */
  onChanged: () => void;
}) {
  const [name, setName] = useState(doc?.name ?? "");
  const [existentes, setExistentes] = useState<Ficheiro[]>(doc?.files ?? []);
  const [escolhidos, setEscolhidos] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const total = existentes.length + escolhidos.length;
  const valid = name.trim().length > 0 && total > 0 && total <= MAX_FICHEIROS;

  function escolher(lista: FileList | null) {
    if (!lista) return;
    setError(null);
    setEscolhidos((antes) => {
      const juntos = [...antes];
      // O mesmo ficheiro escolhido duas vezes não entra duas vezes.
      for (const f of Array.from(lista)) {
        if (!juntos.some((x) => x.name === f.name && x.size === f.size)) juntos.push(f);
      }
      return juntos;
    });
  }

  async function tirar(f: Ficheiro) {
    if (!doc) return;
    setBusy("A tirar o ficheiro…");
    setError(null);
    try {
      await apiPost(`/api/documentos-de-atleta/${doc.id}/remover-ficheiro`, { key: f.key });
      setExistentes((l) => l.filter((x) => x.key !== f.key));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível tirar o ficheiro.");
    } finally {
      setBusy(null);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setError(null);
    try {
      const carregados: { key: string; name: string }[] = [];
      for (let i = 0; i < escolhidos.length; i++) {
        setBusy(escolhidos.length === 1 ? "A carregar o ficheiro…" : `A carregar ${i + 1} de ${escolhidos.length}…`);
        carregados.push(await carregar(athlete.id, escolhidos[i]));
      }
      setBusy("A gravar…");
      if (doc) {
        await apiPatch(`/api/documentos-de-atleta/${doc.id}`, { name: name.trim(), addFiles: carregados });
      } else {
        await apiPost(`/api/athletes/${athlete.id}/documentos`, { name: name.trim(), files: carregados });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gravar o documento.");
      setBusy(null);
    }
  }

  return (
    <Dialog
      labelledBy="documento-de-atleta"
      title={doc ? "Editar documento" : "Novo documento"}
      subtitle={athlete.name}
      icon={<FileText className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={520}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy !== null}>
            Cancelar
          </button>
          <button type="submit" form="form-documento" className="ctl-primary" disabled={!valid || busy !== null}>
            {busy ?? "Guardar"}
          </button>
        </div>
      }
    >
      <form id="form-documento" onSubmit={save} className="space-y-4 p-5">
        <div>
          <div className="mb-1.5 text-meta font-medium text-ink">Nome do documento</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Cartão de cidadão, Exame médico 2026…"
            aria-label="Nome do documento"
            maxLength={120}
            className={dialogInputClass}
            autoFocus
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="text-meta font-medium text-ink">Ficheiros</span>
            <span className="text-meta text-ink-4">
              {total} de {MAX_FICHEIROS}
            </span>
          </div>

          {total > 0 && (
            <ul className="mb-2 overflow-hidden rounded-[var(--radius-control)] border border-line">
              {existentes.map((f) => (
                <LinhaDeFicheiro
                  key={f.key}
                  nome={f.name}
                  nota="já no documento"
                  onRemove={existentes.length + escolhidos.length > 1 && busy === null ? () => void tirar(f) : undefined}
                />
              ))}
              {escolhidos.map((f, i) => (
                <LinhaDeFicheiro
                  key={`${f.name}-${f.size}`}
                  nome={f.name}
                  nota={`${Math.max(1, Math.round(f.size / 1024))} KB · por carregar`}
                  onRemove={busy === null ? () => setEscolhidos((l) => l.filter((_, j) => j !== i)) : undefined}
                />
              ))}
            </ul>
          )}

          {/* O seletor fica escondido e abre-se pelo botão: nada tocável dentro de um rótulo. */}
          <input
            ref={picker}
            type="file"
            multiple
            accept={ACEITA}
            className="hidden"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              escolher(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => picker.current?.click()}
            disabled={busy !== null || total >= MAX_FICHEIROS}
            className="flex h-16 w-full flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] border border-dashed border-line-strong text-meta font-medium text-ink-3 transition-colors duration-[120ms] hover:border-ink-3 hover:text-ink disabled:opacity-50"
          >
            <Upload className="size-4" strokeWidth={1.75} />
            Juntar fotografias ou ficheiros
          </button>
          <p className="mt-1.5 text-meta text-ink-4">Imagens (JPEG, PNG, WebP), PDF ou Word. Até 20 MB cada.</p>
        </div>

        {error && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{error}</p>}
      </form>
    </Dialog>
  );
}

function LinhaDeFicheiro({ nome, nota, onRemove }: { nome: string; nota: string; onRemove?: () => void }) {
  return (
    <li className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-0">
      <FileText className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate text-meta text-ink">{nome}</span>
      <span className="shrink-0 text-[11px] text-ink-4">{nota}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-sunken hover:text-risk"
          aria-label={`Tirar ${nome}`}
        >
          <X className="size-3.5" strokeWidth={2} />
        </button>
      )}
    </li>
  );
}
