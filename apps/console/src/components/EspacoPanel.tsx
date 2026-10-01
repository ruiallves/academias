import { Bar, type Tone } from "./primitives";
import { Bloco, Lista, Linha } from "./definicoes/ui";
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
    <Bloco
      titulo="Espaço"
      descricao="Fotografias, imagens de treino, documentos e vídeos do clube. No limite, deixam de se carregar ficheiros novos."
    >
      {espaco.loading ? (
        <Spinner className="py-2" />
      ) : espaco.error || !espaco.data ? (
        <p className="text-meta text-ink-3">Não foi possível ler o espaço usado.</p>
      ) : (
        <Conteudo espaco={espaco.data} />
      )}
    </Bloco>
  );
}

function Conteudo({ espaco }: { espaco: Espaco }) {
  const fracao = espaco.limitBytes > 0 ? espaco.usedBytes / espaco.limitBytes : 0;
  const tom: Tone = fracao >= 1 ? "risk" : fracao >= 0.8 ? "warn" : "neutral";
  const livre = Math.max(0, espaco.limitBytes - espaco.usedBytes);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[20px] font-semibold leading-none tracking-[-0.01em] text-ink tabular">
          {tamanho(espaco.usedBytes)}{" "}
          <span className="text-body font-normal tracking-normal text-ink-3">de {tamanho(espaco.limitBytes)}</span>
        </span>
        <span className="text-meta text-ink-3 tabular">{Math.min(100, Math.round(fracao * 100))}%</span>
      </div>
      <div className="mt-3">
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
        <Lista className="mt-5">
          <ul>
            {espaco.categorias.map((c) => (
              <Linha key={c.key} className="py-2.5">
                <span className="min-w-0 flex-1 truncate text-body text-ink">{c.label}</span>
                <span className="shrink-0 text-meta text-ink-4 tabular">
                  {c.ficheiros} {c.ficheiros === 1 ? "ficheiro" : "ficheiros"}
                </span>
                <span className="w-16 shrink-0 text-right text-meta text-ink-2 tabular">{tamanho(c.bytes)}</span>
              </Linha>
            ))}
          </ul>
        </Lista>
      )}

      <p className="mt-3 text-meta leading-relaxed text-ink-3">
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
