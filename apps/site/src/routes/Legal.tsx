import { Link, useParams } from "react-router-dom";
import { Reveal } from "@/components/primitives";
import { LEGAL_DOCS, LEGAL_UPDATED } from "@/lib/legal";
import { COMPANY, CONTACT_EMAIL } from "@/lib/content";

/**
 * As páginas legais.
 *
 * ## Porque é que se parecem com o resto do site
 *
 * Porque um documento legal com outro tipo de letra, noutra largura e sem a marca
 * lê-se como um anexo que alguém colou. Estas usam a mesma tipografia e o mesmo
 * ritmo — mudam só a densidade: uma coluna estreita, numeração à vista, e um índice
 * lateral que segue a leitura.
 *
 * O texto é o mesmo para as quatro; o que muda é o conteúdo, que vive em
 * `lib/legal.ts`.
 */
export default function Legal() {
  const { slug } = useParams();
  const doc = LEGAL_DOCS.find((d) => d.slug === slug) ?? LEGAL_DOCS[0];

  return (
    <>
      <header className="border-b border-line">
        <div className="wrap pt-14 pb-10 sm:pt-20 sm:pb-14">
          <Reveal>
            <p className="eyebrow">Documentos</p>
            <h1 className="display d2 mt-5">{doc.title}</h1>
            <p className="lede mt-5">{doc.intro}</p>
            <p className="mt-6 font-mono text-[12px] text-ink-4">Última actualização: {LEGAL_UPDATED}</p>
          </Reveal>
        </div>
      </header>

      <div className="wrap band-tight grid gap-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
        {/* Índice: os quatro documentos, e a seguir as secções deste. */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="eyebrow">Documentos</p>
          <ul className="mt-4 space-y-2">
            {LEGAL_DOCS.map((d) => (
              <li key={d.slug}>
                <Link
                  to={`/${d.slug}`}
                  className={
                    d.slug === doc.slug
                      ? "text-[14.5px] font-semibold text-ink"
                      : "text-[14.5px] text-ink-3 transition-colors hover:text-ink"
                  }
                >
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>

          <p className="eyebrow mt-9">Nesta página</p>
          <ul className="mt-4 space-y-2">
            {doc.sections.map((s, i) => (
              <li key={s.h}>
                <a href={`#s${i}`} className="text-[13.5px] leading-snug text-ink-3 transition-colors hover:text-ink">
                  {s.h}
                </a>
              </li>
            ))}
          </ul>
        </aside>

        <article className="max-w-[68ch]">
          {doc.sections.map((s, i) => (
            <section key={s.h} id={`s${i}`} className="scroll-mt-24 border-t border-line py-8 first:border-0 first:pt-0">
              <h2 className="text-[19px] font-semibold tracking-[-0.02em]">{s.h}</h2>
              {s.p.map((p, j) => (
                <p key={j} className="mt-3 text-[15.5px] leading-[1.65] text-ink-2">
                  {p}
                </p>
              ))}
            </section>
          ))}

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
