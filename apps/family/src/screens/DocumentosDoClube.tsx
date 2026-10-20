import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, ChevronLeft, Download } from "lucide-react";
import { useStore } from "@/lib/store";
import { documentosDoClube, type DocumentoDoClube } from "@/lib/conduta";
import { dateShort } from "@/ui";

/**
 * Os documentos do clube: o código de ética, o manual de conduta, o
 * regulamento. O clube carrega-os nas Definições e as famílias leem-nos aqui.
 *
 * Os links são assinados e duram dez minutos; um ecrã deixado aberto pode
 * ficar com links mortos, e por isso cada abertura recarrega a lista.
 */
export default function DocumentosDoClube() {
  const store = useStore();
  const navigate = useNavigate();
  const [docs, setDocs] = useState<DocumentoDoClube[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    documentosDoClube()
      .then(setDocs)
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : "Não foi possível carregar."));
  }, []);

  return (
    <div className="pt-2">
      <button type="button" onClick={() => navigate(-1)} className="-ml-2 mb-2 inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[14px] font-medium text-ink-2">
        <ChevronLeft className="size-4" strokeWidth={2.2} />
        Voltar
      </button>

      <header className="px-1">
        <p className="text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">{store.academy.shortName}</p>
        <h1 className="mt-0.5 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">Documentos do clube</h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">O código de ética, o manual de conduta e o que o clube espera de todos.</p>
      </header>

      {erro && <p className="mt-4 text-center text-[13px] text-risk">{erro}</p>}

      {docs && docs.length === 0 && (
        <div className="mt-6 rounded-[var(--radius-lg)] bg-surface p-6 text-center shadow-[var(--shadow-soft)]">
          <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-sunken text-ink-3">
            <BookOpen className="size-[22px]" strokeWidth={1.75} />
          </span>
          <p className="mt-3 text-body font-semibold text-ink">Ainda não há documentos</p>
          <p className="mx-auto mt-1 max-w-[30ch] text-[13px] leading-relaxed text-ink-3">Quando o clube os publicar, aparecem aqui.</p>
        </div>
      )}

      {docs && docs.length > 0 && (
        <ul className="mt-5 space-y-3">
          {docs.map((d) => (
            <li key={d.id} className="overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-soft)]">
              <div className="flex items-start gap-3 p-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-signal-soft text-signal-ink">
                  <BookOpen className="size-[20px]" strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-body font-semibold text-ink">{d.title}</h2>
                  {d.description && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{d.description}</p>}
                  <p className="mt-1 text-[12px] text-ink-4">Atualizado a {dateShort(new Date(d.updatedAt))}</p>
                </div>
              </div>
              <ul className="border-t border-line">
                {d.files.map((f) => (
                  <li key={f.key} className="border-b border-line last:border-0">
                    {f.url ? (
                      <a href={f.url} target="_blank" rel="noreferrer" className="flex min-h-12 items-center gap-3 px-4 py-2.5 active:bg-sunken/60">
                        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{f.name}</span>
                        <Download className="size-[18px] shrink-0 text-ink-3" strokeWidth={1.9} />
                      </a>
                    ) : (
                      <span className="flex min-h-12 items-center gap-3 px-4 py-2.5 text-[14px] text-ink-3">{f.name}</span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
