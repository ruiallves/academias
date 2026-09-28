import { Bar, Panel, PanelHead, type Tone } from "./primitives";
import { Spinner } from "./Busy";
import { useApi } from "@/lib/query";

/** `GET /api/espaco` — ver `EspacoService` na API. */
type Espaco = {
  usedBytes: number;
  limitBytes: number;
  categorias: { key: string; label: string; bytes: number; ficheiros: number }[];
};

/**
 * O espaço de ficheiros do clube: quanto usa, de quanto dispõe, e em quê.
 *
 * ## Porque é que está nas Definições
 *
 * Um clube no limite deixa de conseguir carregar fotografias, imagens do
 * inventário, exercícios e vídeos. Isso tem de se ver antes de acontecer, e no
 * sítio onde se vê o que o clube contratou: o limite por omissão é de 5 GB, e
 * aumentá-lo é uma conversa com a plataforma, normalmente com a mensalidade.
 *
 * A barra é neutra até perto do limite, e só então muda de tom. A cor do clube
 * fica de fora de propósito: um símbolo verde a encher-se lia-se como "está
 * tudo bem" quando está quase cheio.
 */
export function EspacoPanel() {
  const espaco = useApi<Espaco>("/api/espaco");

  return (
    <Panel>
      <PanelHead title="Espaço" hint="ficheiros do clube" />
      <div className="px-5 py-4">
        {espaco.loading ? (
          <Spinner className="py-2" />
        ) : espaco.error || !espaco.data ? (
          <p className="text-meta text-ink-3">Não foi possível ler o espaço usado.</p>
        ) : (
          <Conteudo espaco={espaco.data} />
        )}
      </div>
    </Panel>
  );
}

function Conteudo({ espaco }: { espaco: Espaco }) {
  const fracao = espaco.limitBytes > 0 ? espaco.usedBytes / espaco.limitBytes : 0;
  const tom: Tone = fracao >= 1 ? "risk" : fracao >= 0.8 ? "warn" : "neutral";
  const livre = Math.max(0, espaco.limitBytes - espaco.usedBytes);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-body font-medium text-ink tabular">
          {tamanho(espaco.usedBytes)} <span className="font-normal text-ink-3">de {tamanho(espaco.limitBytes)}</span>
        </span>
        <span className="text-meta text-ink-3 tabular">{Math.min(100, Math.round(fracao * 100))}%</span>
      </div>
      <div className="mt-2">
        <Bar value={Math.min(1, fracao)} tone={tom} />
      </div>

      {fracao >= 1 ? (
        <p className="mt-2.5 text-meta leading-relaxed text-risk">
          O clube chegou ao limite. Não se carregam ficheiros novos até libertar espaço ou aumentar o limite.
        </p>
      ) : fracao >= 0.8 ? (
        <p className="mt-2.5 text-meta leading-relaxed text-warn">
          Quase no limite: faltam {tamanho(livre)}. Quando chegar, deixam de se carregar ficheiros novos.
        </p>
      ) : (
        <p className="mt-2.5 text-meta text-ink-3">Livres: {tamanho(livre)}.</p>
      )}

      {espaco.categorias.length > 0 && (
        <ul className="mt-3.5 space-y-1.5 border-t border-line pt-3">
          {espaco.categorias.map((c) => (
            <li key={c.key} className="flex items-baseline justify-between gap-3 text-meta">
              <span className="min-w-0 truncate text-ink-2">
                {c.label} <span className="text-ink-4">· {c.ficheiros}</span>
              </span>
              <span className="shrink-0 text-ink-3 tabular">{tamanho(c.bytes)}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3.5 text-[11px] leading-relaxed text-ink-4">
        {espaco.limitBytes > 5 * 1024 * 1024 * 1024
          ? "O espaço deste clube já foi aumentado. Para mais, fala connosco."
          : "O plano inclui 5 GB. Para mais espaço, fala connosco: quando for possível, aumenta-se com a mensalidade do clube."}
      </p>
    </div>
  );
}

/** "1,2 GB", "340 MB", "12 KB". */
function tamanho(bytes: number): string {
  const MB = 1024 * 1024;
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  if (bytes === 0) return "0 MB";
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
