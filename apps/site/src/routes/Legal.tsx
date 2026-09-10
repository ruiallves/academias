import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { LegalMarkdown, legalHeadings } from "@academia/ui/legal-markdown";
import { Reveal } from "@/components/primitives";
import { apiGet, ApiError } from "@/lib/api";
import { COMPANY, CONTACT_EMAIL } from "@/lib/content";

/**
 * As páginas legais.
 *
 * ## De onde vem o texto
 *
 * Da base de dados, pela API pública (`/api/legal/documents`): é lá que as
 * versões vivem, e é a mesma versão que a consola e a app do clube pedem para
 * aceitar. Já foi um ficheiro de texto no site (`lib/legal.ts`), e o problema
 * era esse — o site dizia uma coisa, o gate dizia outra, e nenhum dos dois
 * sabia que versão era. Agora cada página diz a versão e a data em vigor, e
 * as versões anteriores continuam a abrir pelo endereço delas.
 *
 * ## Porque é que se parecem com o resto do site
 *
 * Porque um documento legal com outro tipo de letra, noutra largura e sem a
 * marca lê-se como um anexo que alguém colou. Estas usam a mesma tipografia e o
 * mesmo ritmo — mudam só a densidade: uma coluna estreita, e um índice lateral
 * que segue a leitura.
 */

type DocMeta = {
  id: string;
  type: string;
  slug: string;
  title: string;
  summary: string | null;
  version: string;
  effectiveAt: string;
};

type DocFull = DocMeta & { content: string; status?: string };

const dataPT = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" });

export default function Legal() {
  const { slug, version } = useParams();
  const [index, setIndex] = useState<DocMeta[] | null>(null);
  const [doc, setDoc] = useState<DocFull | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    apiGet<DocMeta[]>("/api/legal/documents")
      .then((d) => vivo && setIndex(d))
      .catch((e) => vivo && setError(e instanceof Error ? e.message : "Não foi possível carregar."));
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (!slug) return;
    let vivo = true;
    setDoc(null);
    const path = version ? `/api/legal/documents/${slug}/${version}` : `/api/legal/documents/${slug}`;
    apiGet<DocFull>(path)
      .then((d) => vivo && setDoc(d))
      .catch((e) => {
        if (!vivo) return;
        setError(e instanceof ApiError && e.status === 404 ? "Este documento ainda não está publicado." : e instanceof Error ? e.message : "Não foi possível carregar.");
      });
    return () => {
      vivo = false;
    };
  }, [slug, version]);

  // Sem slug — o índice `/legal` — abre-se o primeiro documento em vigor.
  if (!slug && index && index.length > 0) return <Navigate to={`/legal/${index[0].slug}`} replace />;

  const headings = doc ? legalHeadings(doc.content) : [];
  const antiga = Boolean(version) && doc !== null && index !== null && !index.some((d) => d.id === doc.id);

  return (
    <>
      <header className="border-b border-line">
        <div className="wrap pt-14 pb-10 sm:pt-20 sm:pb-14">
          <Reveal>
            <p className="eyebrow">Documentos</p>
            <h1 className="display d2 mt-5">{doc?.title ?? (error ? "Documento" : " ")}</h1>
            {doc?.summary && <p className="lede mt-5">{doc.summary}</p>}
            {doc && (
              <p className="mt-6 font-mono text-[12px] text-ink-4">
                Versão {doc.version} · Em vigor desde {dataPT(doc.effectiveAt)}
                {antiga && " · versão anterior"}
              </p>
            )}
          </Reveal>
        </div>
      </header>

      <div className="wrap band-tight grid gap-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
        {/* Índice: os documentos em vigor, e a seguir as secções deste. */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="eyebrow">Documentos</p>
          <ul className="mt-4 space-y-2">
            {(index ?? []).map((d) => (
              <li key={d.id}>
                <Link
                  to={`/legal/${d.slug}`}
                  className={
                    d.slug === slug
                      ? "text-[14.5px] font-semibold text-ink"
                      : "text-[14.5px] text-ink-3 transition-colors hover:text-ink"
                  }
                >
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>

          {headings.length > 0 && (
            <>
              <p className="eyebrow mt-9">Nesta página</p>
              <ul className="mt-4 space-y-2">
                {headings.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} className="text-[13.5px] leading-snug text-ink-3 transition-colors hover:text-ink">
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        <article className="max-w-[68ch]">
          {error && !doc && (
            <p className="text-[15.5px] leading-[1.65] text-ink-2">
              {error}{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="link">
                Pede-nos uma cópia.
              </a>
            </p>
          )}
          {antiga && (
            <p className="mb-8 rounded-[6px] border border-line bg-paper-2 px-4 py-3 text-[14px] text-ink-2">
              Esta é uma versão anterior, mantida para consulta.{" "}
              <Link to={`/legal/${slug}`} className="link">
                Ver a versão em vigor.
              </Link>
            </p>
          )}
          {doc && <LegalMarkdown content={doc.content} className="legal-prose" />}

          <div className="rule mt-8 pt-8">
            {/* A identificação legal só aparece quando existir — ver `COMPANY`. */}
            {(COMPANY.legalName || COMPANY.address || COMPANY.nif) && (
              <p className="mb-3 text-[14px] text-ink-3">
                {[COMPANY.legalName, COMPANY.address, COMPANY.nif && `NIF ${COMPANY.nif}`].filter(Boolean).join(" · ")}
              </p>
            )}
            <p className="text-[15px] text-ink-2">
              Dúvidas sobre este documento?{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="link">
                {CONTACT_EMAIL}
              </a>
            </p>
          </div>
        </article>
      </div>
    </>
  );
}

/** Os caminhos antigos do rodapé (`/termos`, `/dpa`…), para nenhum link já enviado deixar de abrir. */
export function LegacyLegal({ to }: { to: string }) {
  return <Navigate to={`/legal/${to}`} replace />;
}
