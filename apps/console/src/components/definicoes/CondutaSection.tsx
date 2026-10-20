import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Dialog, dialogInputClass } from "@/components/Dialog";
import { Pill, cx } from "@/components/primitives";
import { Spinner } from "@/components/Busy";
import { Bloco, Erro, Lista } from "@/components/definicoes/ui";
import { BookOpen, Download, Pencil, Plus, ShieldAlert, Trash2, Upload, X } from "@/lib/icons";
import { longDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import {
  apagarDocumentoDeConduta,
  atualizarDocumentoDeConduta,
  carregarDocumentosDeConduta,
  carregarFicheiroDeConduta,
  criarDocumentoDeConduta,
  documentosDeCondutaEmCache,
  tirarFicheiroDeConduta,
  type DocumentoDeConduta,
  type FicheiroDeConduta,
} from "@/lib/conduta";

/**
 * Conduta, nas Definições: os documentos que as famílias consultam na app
 * (código de ética, manual de conduta, regulamento interno) e a porta para o
 * canal de denúncia.
 *
 * Os documentos são do clube inteiro e lêem-se na app sem pedir nada a
 * ninguém: é para isso que existem. Carregam-se como os documentos dos
 * atletas, em três passos, direto do browser para o armazenamento.
 */

const ACEITA = "image/jpeg,image/png,image/webp,application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_FICHEIROS = 10;

const SUGESTOES = ["Código de ética", "Manual de conduta", "Regulamento interno", "Política de proteção de menores"];

export function CondutaSection({ mayWrite }: { mayWrite: boolean }) {
  const { session } = useSession();
  const veDenuncias = can(session, "conduct:read");
  // Abre com o que as Definições já foram buscar: a caixa aparece logo. Ver `carregarDocumentosDeConduta`.
  const [docs, setDocs] = useState<DocumentoDeConduta[] | null>(documentosDeCondutaEmCache);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [aEditar, setAEditar] = useState<DocumentoDeConduta | null>(null);
  const [aApagar, setAApagar] = useState<DocumentoDeConduta | null>(null);

  const carregar = useCallback(() => {
    setErro(null);
    carregarDocumentosDeConduta(true)
      .then(setDocs)
      .catch((e: unknown) => {
        setErro(e instanceof Error ? e.message : "Não foi possível carregar os documentos.");
        setDocs((d) => d ?? []);
      });
  }, []);
  useEffect(carregar, [carregar]);

  /*
   * Ainda sem nada (primeira vez, e a resposta das Definições ainda não
   * chegou): um disco no meio da secção, com o fundo desfocado, e o submenu
   * à esquerda intacto. Só depois de 180 ms, como o carregamento da consola:
   * uma resposta rápida não chega a piscar.
   */
  const [veu, setVeu] = useState(false);
  useEffect(() => {
    if (docs !== null) {
      setVeu(false);
      return;
    }
    const t = setTimeout(() => setVeu(true), 180);
    return () => clearTimeout(t);
  }, [docs]);

  return (
    <div className="relative min-h-[420px]">
      {veu && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-canvas/40 backdrop-blur-[3px]">
          <Spinner />
        </div>
      )}
      <Bloco
        titulo="Documentos de conduta"
        estado={docs && docs.length > 0 ? <Pill>{docs.length}</Pill> : undefined}
        descricao={
          <>
            <p>O código de ética, o manual de conduta e o que mais o clube quiser que as famílias e os atletas leiam. Aparecem na app, no perfil, em «Documentos do clube».</p>
            <p>Imagens, PDF ou Word, até 20 MB por ficheiro.</p>
          </>
        }
      >
        {erro && (
          <div className="mb-3">
            <Erro>{erro}</Erro>
          </div>
        )}

        <Lista>
          {docs === null ? null : docs.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-sunken text-ink-3">
                <BookOpen className="size-5" strokeWidth={1.75} />
              </span>
              <p className="mt-3 text-body font-medium text-ink">Ainda sem documentos</p>
              <p className="mx-auto mt-1 max-w-[40ch] text-meta leading-relaxed text-ink-3">
                Começa pelo código de ética ou pelo manual de conduta. As famílias veem-nos na app assim que os carregares.
              </p>
              {mayWrite && (
                <button type="button" className="ctl-primary mt-4" onClick={() => setNovo(true)}>
                  <Plus className="size-3.5" strokeWidth={2} />
                  Carregar documento
                </button>
              )}
            </div>
          ) : (
            <ul>
              {docs.map((d) => (
                <li key={d.id} className="border-b border-line px-4 py-3.5 last:border-b-0">
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-signal-soft text-signal-ink">
                      <BookOpen className="size-4" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body font-medium text-ink">{d.title}</div>
                      {d.description && <p className="mt-0.5 text-meta leading-relaxed text-ink-2">{d.description}</p>}
                      <div className="mt-0.5 text-meta text-ink-3">
                        {longDate(new Date(d.updatedAt))}
                        {d.createdByName && ` · ${d.createdByName}`}
                        {` · ${d.files.length} ${d.files.length === 1 ? "ficheiro" : "ficheiros"}`}
                      </div>
                      <ul className="mt-2.5 flex flex-wrap gap-2">
                        {d.files.map((f) => (
                          <li key={f.key}>
                            <FicheiroLink f={f} />
                          </li>
                        ))}
                      </ul>
                    </div>
                    {mayWrite && (
                      <span className="flex shrink-0 items-center gap-0.5">
                        <button type="button" className="ctl-ghost size-8 justify-center px-0 text-ink-3 hover:text-ink" onClick={() => setAEditar(d)} aria-label={`Editar ${d.title}`} title="Mudar o título ou juntar ficheiros">
                          <Pencil className="size-3.5" strokeWidth={1.75} />
                        </button>
                        <button type="button" className="ctl-ghost size-8 justify-center px-0 text-ink-4 hover:text-risk" onClick={() => setAApagar(d)} aria-label={`Apagar ${d.title}`} title="Apagar documento">
                          <Trash2 className="size-3.5" strokeWidth={1.75} />
                        </button>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Lista>

        {mayWrite && docs && docs.length > 0 && (
          <div className="mt-3">
            <button type="button" className="ctl-outline" onClick={() => setNovo(true)}>
              <Plus className="size-3.5" strokeWidth={2} />
              Carregar documento
            </button>
          </div>
        )}
      </Bloco>

      <Bloco
        titulo="Canal de denúncia"
        descricao={
          <p>
            As famílias e os atletas encontram-no no perfil da app: escolhem o tipo de situação, contam o que aconteceu e, se quiserem, pedem para não ser identificados. Cada caso chega à consola só a quem tem acesso às denúncias.
          </p>
        }
        centro
      >
        <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line px-4 py-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-sunken text-ink-2">
            <ShieldAlert className="size-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-body font-medium text-ink">Sempre ligado</div>
            <p className="text-meta leading-relaxed text-ink-3">
              Por omissão, só a presidência e a direção veem as denúncias. Dá o acesso a mais alguém na ficha de staff, em Acesso.
            </p>
          </div>
          {veDenuncias && (
            <Link to="/denuncias" className="ctl-outline shrink-0">
              Ver denúncias
            </Link>
          )}
        </div>
      </Bloco>

      {(novo || aEditar) && (
        <DocumentoDialog
          doc={aEditar}
          onClose={() => {
            setNovo(false);
            setAEditar(null);
          }}
          onSaved={() => {
            setNovo(false);
            setAEditar(null);
            carregar();
          }}
          onChanged={carregar}
        />
      )}

      {aApagar && (
        <ConfirmDialog
          title={`Apagar «${aApagar.title}»?`}
          onClose={() => setAApagar(null)}
          onConfirm={async () => {
            await apagarDocumentoDeConduta(aApagar.id);
            setAApagar(null);
            carregar();
          }}
        >
          Deixa de aparecer na app das famílias, e {aApagar.files.length === 1 ? "o ficheiro dele é apagado" : `os ${aApagar.files.length} ficheiros dele são apagados`} de vez.
        </ConfirmDialog>
      )}
    </div>
  );
}

function FicheiroLink({ f }: { f: FicheiroDeConduta }) {
  const imagem = f.type.startsWith("image/");
  const conteudo = (
    <>
      {imagem && f.url ? (
        <img src={f.url} alt="" className="size-9 shrink-0 rounded-[6px] object-cover" loading="lazy" />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[6px] bg-sunken text-[10px] font-semibold uppercase text-ink-3">
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

function DocumentoDialog({
  doc,
  onClose,
  onSaved,
  onChanged,
}: {
  doc: DocumentoDeConduta | null;
  onClose: () => void;
  onSaved: () => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(doc?.title ?? "");
  const [description, setDescription] = useState(doc?.description ?? "");
  const [existentes, setExistentes] = useState<FicheiroDeConduta[]>(doc?.files ?? []);
  const [escolhidos, setEscolhidos] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const total = existentes.length + escolhidos.length;
  const valid = title.trim().length > 0 && total > 0 && total <= MAX_FICHEIROS;

  function escolher(lista: FileList | null) {
    if (!lista) return;
    setError(null);
    setEscolhidos((antes) => {
      const juntos = [...antes];
      for (const f of Array.from(lista)) if (!juntos.some((x) => x.name === f.name && x.size === f.size)) juntos.push(f);
      return juntos;
    });
  }

  async function tirar(f: FicheiroDeConduta) {
    if (!doc) return;
    setBusy("A tirar o ficheiro…");
    setError(null);
    try {
      await tirarFicheiroDeConduta(doc.id, f.key);
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
        carregados.push(await carregarFicheiroDeConduta(escolhidos[i]));
      }
      setBusy("A gravar…");
      const descricao = description.trim() || null;
      if (doc) await atualizarDocumentoDeConduta(doc.id, { title: title.trim(), description: descricao, addFiles: carregados });
      else await criarDocumentoDeConduta({ title: title.trim(), description: descricao, files: carregados });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gravar o documento.");
      setBusy(null);
    }
  }

  return (
    <Dialog
      labelledBy="documento-de-conduta"
      title={doc ? "Editar documento" : "Novo documento de conduta"}
      subtitle="Fica à vista das famílias e dos atletas na app."
      icon={<BookOpen className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={520}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy !== null}>
            Cancelar
          </button>
          <button type="submit" form="form-documento-conduta" className="ctl-primary" disabled={!valid || busy !== null}>
            {busy ?? "Guardar"}
          </button>
        </div>
      }
    >
      <form id="form-documento-conduta" onSubmit={save} className="space-y-4 p-5">
        <div>
          <label htmlFor="conduta-titulo" className="mb-1.5 block text-meta font-medium text-ink">
            Título
          </label>
          <input id="conduta-titulo" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Código de ética" maxLength={120} className={dialogInputClass} autoFocus />
          {!doc && !title && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SUGESTOES.map((s) => (
                <button key={s} type="button" onClick={() => setTitle(s)} className="rounded-full border border-line px-2.5 py-1 text-meta text-ink-2 transition-colors hover:bg-sunken">
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="conduta-descricao" className="mb-1.5 block text-meta font-medium text-ink">
            Uma frase sobre o documento <span className="font-normal text-ink-4">(opcional)</span>
          </label>
          <input id="conduta-descricao" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="O que esperamos de atletas, famílias e staff." maxLength={400} className={dialogInputClass} />
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="text-meta font-medium text-ink">Ficheiros</span>
            <span className="text-meta text-ink-4">
              {total} de {MAX_FICHEIROS}
            </span>
          </div>

          {(existentes.length > 0 || escolhidos.length > 0) && (
            <ul className="mb-2 space-y-1.5">
              {existentes.map((f) => (
                <li key={f.key} className="flex items-center gap-2 rounded-[10px] border border-line px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-meta text-ink-2">{f.name}</span>
                  <button type="button" onClick={() => void tirar(f)} disabled={busy !== null} className="ctl-ghost size-7 justify-center px-0 text-ink-4 hover:text-risk" aria-label={`Tirar ${f.name}`}>
                    <X className="size-3.5" strokeWidth={1.75} />
                  </button>
                </li>
              ))}
              {escolhidos.map((f) => (
                <li key={`${f.name}-${f.size}`} className="flex items-center gap-2 rounded-[10px] border border-dashed border-line-strong px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-meta text-ink-2">{f.name}</span>
                  <span className="text-[11px] text-ink-4">por carregar</span>
                  <button type="button" onClick={() => setEscolhidos((l) => l.filter((x) => x !== f))} disabled={busy !== null} className="ctl-ghost size-7 justify-center px-0 text-ink-4 hover:text-risk" aria-label={`Tirar ${f.name}`}>
                    <X className="size-3.5" strokeWidth={1.75} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <input ref={picker} type="file" accept={ACEITA} multiple className="hidden" onChange={(e) => escolher(e.target.files)} />
          <button type="button" onClick={() => picker.current?.click()} disabled={busy !== null || total >= MAX_FICHEIROS} className="ctl-outline w-full justify-center">
            <Upload className="size-3.5" strokeWidth={1.75} />
            Escolher ficheiros
          </button>
        </div>

        {error && <p className="text-meta text-risk">{error}</p>}
      </form>
    </Dialog>
  );
}
