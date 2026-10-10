import { Facebook, Instagram, Youtube } from "lucide-react";
import type { Clube } from "@/dados/tipos";

/** Os ícones que o lucide não tem. */
function X(props: { size?: number; className?: string }) {
  return (
    <svg width={props.size ?? 20} height={props.size ?? 20} viewBox="0 0 24 24" fill="currentColor" className={props.className} aria-hidden>
      <path d="M18.2 2h3.3l-7.2 8.3L22.8 22h-6.6l-5.2-6.8L5 22H1.7l7.7-8.8L1.2 2H8l4.7 6.2L18.2 2Zm-1.2 18h1.8L7.1 3.9H5.2L17 20Z" />
    </svg>
  );
}

function TikTok(props: { size?: number; className?: string }) {
  return (
    <svg width={props.size ?? 20} height={props.size ?? 20} viewBox="0 0 24 24" fill="currentColor" className={props.className} aria-hidden>
      <path d="M16.5 2c.3 2.6 1.9 4.3 4.5 4.5v3.3c-1.6 0-3.1-.5-4.4-1.4v6.4c0 7.9-8.6 10.3-12.1 4.7-2.2-3.6-.8-9.9 6.3-10.2v3.5c-.5.1-1.1.2-1.6.4-1.6.5-2.5 1.5-2.2 3.3.4 3.4 6.6 4.4 6.1-2.2V2h3.4Z" />
    </svg>
  );
}

const ICONES = {
  facebook: { Icone: Facebook, nome: "Facebook" },
  instagram: { Icone: Instagram, nome: "Instagram" },
  youtube: { Icone: Youtube, nome: "YouTube" },
  x: { Icone: X, nome: "X" },
  tiktok: { Icone: TikTok, nome: "TikTok" },
} as const;

export function Redes({ social, shortName, className = "" }: { social: Clube["social"]; shortName: string; className?: string }) {
  const lista = (Object.keys(ICONES) as (keyof typeof ICONES)[]).filter((k) => social[k]);
  if (!lista.length) return null;
  return (
    <ul className={`flex items-center gap-1 ${className}`}>
      {lista.map((k) => {
        const { Icone, nome } = ICONES[k];
        return (
          <li key={k}>
            <a
              href={social[k]}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${shortName} no ${nome}`}
              className="grid size-11 place-items-center rounded-control transition hover:bg-white/10"
            >
              <Icone size={20} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
