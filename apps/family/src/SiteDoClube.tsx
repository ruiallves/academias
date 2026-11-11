import { ArrowUpRight, Globe } from "lucide-react";
import { useContexts } from "@/lib/contexts";

/**
 * A caixa do site do clube, no perfil (família, atleta e sócio).
 *
 * Só aparece quando o clube tem o site aberto ao público: publicado e no plano
 * (Connect Pro, ou os 30 dias de experiência). O endereço vem dos contextos
 * (`site`, ver `enderecoDoSite` na API). Abre fora da app: é o site, não uma
 * área dela.
 */
export function SiteDoClube() {
  const { site } = useContexts();
  if (!site) return null;
  return (
    <a
      href={site}
      target="_blank"
      rel="noopener"
      className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] bg-surface p-4 text-left shadow-[var(--shadow-soft)] active:scale-[0.99]"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-signal-soft text-signal-ink">
        <Globe className="size-[18px]" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold text-ink">Site do clube</span>
        <span className="block truncate text-meta text-ink-3">{site.replace(/^https:\/\//, "")}</span>
      </span>
      <ArrowUpRight className="size-5 shrink-0 text-ink-4" strokeWidth={2} />
    </a>
  );
}
