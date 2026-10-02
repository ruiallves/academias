import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { LegalMarkdown, legalHeadings } from "@academia/ui/legal-markdown";
import { apiGet, ApiError } from "@/lib/api";
import { COMPANY, CONTACT_EMAIL } from "@/lib/content";

/**
 * As páginas legais.
 *
 * ## De onde vem o texto
 *
 * Da base de dados, pela API pública (`/api/legal/documents`): é lá que as
 * versões vivem, e é a mesma versão que a consola e a app do clube pedem para
 * aceitar. Cada página diz a versão e a data em vigor, e as versões anteriores
 * continuam a abrir pelo endereço delas.
 *
 * ## Porque é que se parecem com o resto do site
 *
 * Um documento legal com outra letra e sem a marca lê-se como um anexo que
 * alguém colou. Estas usam a mesma tipografia e mudam só a densidade: uma
 * coluna estreita e um índice lateral que segue a leitura.
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

  // Sem slug, o índice `/legal` abre o primeiro documento em vigor.
  if (!slug && index && index.length > 0) return <Navigate to={`/legal/${index[0].slug}`} replace />;

  const headings = doc ? legalHeadings(doc.content) : [];
  const antiga = Boolean(version) && doc !== null && index !== null && !index.some((d) => d.id === doc.id);

  return (
    <div className="palco-cal">
      <header className="sob-o-topo border-b border-fio">
        <div className="wrap pb-10 sm:pb-14">
          <p className="rotulo text-texto-3">Documentos</p>
          <h1 className="titulo t2 mt-5">{doc?.title ?? (error ? "Documento" : " ")}</h1>
          {doc?.summary && <p className="lede mt-5">{doc.summary}</p>}
          {doc && (
            <p className="rotulo mt-6 text-texto-3">
              Versão {doc.version} · Em vigor desde {dataPT(doc.effectiveAt)}
              {antiga && " · versão anterior"}
            </p>
          )}
        </div>
      </header>

      <div className="wrap faixa-curta grid gap-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
        {/* Índice: os documentos em vigor, e a seguir as secções deste. */}
        <aside className="lg:sticky lg:top-[calc(var(--topo)+24px)] lg:self-start">
          <p className="rotulo text-texto-3">Documentos</p>
          <ul className="mt-4 space-y-2">
            {(index ?? []).map((d) => (
              <li key={d.id}>
                <Link
                  to={`/legal/${d.slug}`}
                  className={d.slug === slug ? "text-[0.92rem] font-semibold text-texto" : "text-[0.92rem] text-texto-3 transition-colors hover:text-texto"}
                >
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>

          {headings.length > 0 && (
            <>
              <p className="rotulo mt-9 text-texto-3">Nesta página</p>
              <ul className="mt-4 space-y-2">
                {headings.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} className="text-[0.86rem] leading-snug text-texto-3 transition-colors hover:text-texto">
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
            <p className="corpo">
              {error}{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="ligacao">
                Pede-nos uma cópia.
              </a>
            </p>
          )}
          {antiga && (
            <p className="mb-8 border border-fio bg-sup px-4 py-3 text-[0.9rem] text-texto-2">
              Esta é uma versão anterior, mantida para consulta.{" "}
              <Link to={`/legal/${slug}`} className="ligacao">
                Ver a versão em vigor.
              </Link>
            </p>
          )}
          {doc && <LegalMarkdown content={doc.content} className="legal-prose" />}

          <div className="fio-cima mt-8 pt-8">
            {/* A identificação legal só aparece quando existir. Ver `COMPANY`. */}
            {(COMPANY.legalName || COMPANY.address || COMPANY.nif) && (
              <p className="mb-3 text-[0.9rem] text-texto-3">
                {[COMPANY.legalName, COMPANY.address, COMPANY.nif && `NIF ${COMPANY.nif}`].filter(Boolean).join(" · ")}
              </p>
            )}
            <p className="text-[0.95rem] text-texto-2">
              Dúvidas sobre este documento?{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="ligacao">
                {CONTACT_EMAIL}
              </a>
            </p>
          </div>
        </article>
      </div>
    </div>
  );
}

/** Os caminhos antigos do rodapé (`/termos`, `/dpa`…), para nenhum link já enviado deixar de abrir. */
export function LegacyLegal({ to }: { to: string }) {
  return <Navigate to={`/legal/${to}`} replace />;
}
