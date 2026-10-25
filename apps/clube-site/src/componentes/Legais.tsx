import Link from "next/link";
import type { Clube } from "@/dados/tipos";
import { legalDe, ligacoesLegais } from "@/lib/legal";

/**
 * A faixa legal do rodapé, nos dois temas: quem é o clube (nome legal e
 * NIPC) e as ligações às páginas legais e ao Livro de Reclamações. As cores
 * vêm de quem a usa (`className` e `ligacao`), o rodapé do Tribuna é escuro
 * e o do Holofote claro.
 */
export function Legais({ clube, className, lista, ligacao }: { clube: Clube; className?: string; lista?: string; ligacao?: string }) {
  const l = legalDe(clube);
  return (
    <div className={className}>
      <p>
        {l.nome}
        {l.nipc && <> · NIPC {l.nipc}</>}
      </p>
      <ul className={`flex flex-wrap gap-x-4 gap-y-1 ${lista ?? ""}`}>
        {ligacoesLegais(clube).map((x) => (
          <li key={x.href}>
            {x.externo ? (
              <a href={x.href} target="_blank" rel="noopener noreferrer" className={ligacao}>
                {x.label}
              </a>
            ) : (
              <Link href={x.href} className={ligacao}>
                {x.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
