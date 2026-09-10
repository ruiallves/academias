import { useEffect, useState } from "react";
import { apiGet } from "@/lib/http";
import { acceptanceLabel, type LegalDocumentView } from "@/lib/legal";

type Required = LegalDocumentView & { url: string };

/**
 * Os termos, ao lado da password.
 *
 * Quem cria a conta aceita-os ao criá-la: uma caixa por documento, cada um a
 * abrir no site com a versão em vigor. `onChange` diz ao formulário se está
 * tudo marcado — é ele que envia `acceptLegal: true`, e é o servidor que volta
 * a exigi-lo. Sem documentos publicados para esta audiência não há caixas, e
 * o formulário segue: um clube que ainda não publicou termos não trava
 * inscrições.
 */
export function ConsentimentoLegal({
  audience,
  onChange,
}: {
  audience: "FAMILY" | "MEMBER";
  onChange: (ok: boolean) => void;
}) {
  const [docs, setDocs] = useState<Required[] | null>(null);
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let vivo = true;
    apiGet<Required[]>(`/api/legal/required?audience=${audience}`)
      .then((d) => {
        if (!vivo) return;
        setDocs(d);
        onChange(d.length === 0);
      })
      // Sem resposta não se bloqueia o registo por causa disto: o gate à entrada
      // apanha o que faltar.
      .catch(() => {
        if (!vivo) return;
        setDocs([]);
        onChange(true);
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience]);

  if (!docs || docs.length === 0) return null;

  const marcar = (id: string, v: boolean) => {
    const next = { ...marcados, [id]: v };
    setMarcados(next);
    onChange(docs.every((d) => next[d.id]));
  };

  return (
    <div className="space-y-2.5 border-t border-line pt-4">
      {docs.map((d) => (
        <label key={d.id} className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={Boolean(marcados[d.id])}
            onChange={(e) => marcar(d.id, e.target.checked)}
            className="mt-[3px] size-[18px] shrink-0 accent-[var(--color-signal)]"
          />
          {/* Sem a versão por baixo: quem abre o documento vê-a lá, no site. */}
          <span className="text-[14px] leading-snug text-ink">
            {acceptanceLabel(d).replace(d.title, "").trim()}{" "}
            <a href={d.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {d.title}
            </a>
          </span>
        </label>
      ))}
    </div>
  );
}
