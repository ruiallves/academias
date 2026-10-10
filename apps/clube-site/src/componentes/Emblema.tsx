import Image from "next/image";

/**
 * O emblema do clube. Com logótipo, a imagem; sem ele, um escudo com o
 * monograma na cor do clube, o mesmo que a consola e a app desenham.
 */
export function Emblema({
  logoUrl,
  shortName,
  size = 48,
  className = "",
}: {
  logoUrl?: string;
  shortName: string;
  size?: number;
  className?: string;
}) {
  if (logoUrl) {
    return (
      <Image
        src={logoUrl}
        alt={`Emblema do ${shortName}`}
        width={size}
        height={size}
        className={`object-contain ${className}`}
        priority={size >= 40}
      />
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 56"
      aria-label={`Emblema do ${shortName}`}
      role="img"
      className={className}
    >
      <path d="M24 2 44 9v19c0 13-9 21-20 26C13 49 4 41 4 28V9l20-7Z" fill="var(--color-signal-strong)" />
      <path d="M24 7 39.5 12.5V28c0 10.5-7 17-15.5 21.2C15.5 45 8.5 38.5 8.5 28V12.5L24 7Z" fill="none" stroke="var(--color-signal-on)" strokeOpacity="0.35" strokeWidth="1.5" />
      <text
        x="24"
        y="33"
        textAnchor="middle"
        fontFamily="var(--font-sans)"
        fontWeight="800"
        fontSize="17"
        letterSpacing="-0.5"
        fill="var(--color-signal-on)"
      >
        {monograma(shortName)}
      </text>
    </svg>
  );
}

/** "AD Monte Verde" → "AV": a primeira e a última palavra, como na API. */
export function monograma(name: string): string {
  const parts = name.trim().split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

/** O emblema de um adversário: só temos o nome, por isso é um escudo neutro. */
export function EmblemaAdversario({ name, logoUrl, size = 48 }: { name: string; logoUrl?: string; size?: number }) {
  if (logoUrl) {
    return <Image src={logoUrl} alt={`Emblema do ${name}`} width={size} height={size} className="object-contain" />;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 48 56" aria-label={`Emblema do ${name}`} role="img">
      <path d="M24 2 44 9v19c0 13-9 21-20 26C13 49 4 41 4 28V9l20-7Z" fill="currentColor" fillOpacity="0.12" />
      <path d="M24 2 44 9v19c0 13-9 21-20 26C13 49 4 41 4 28V9l20-7Z" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.5" />
      <text
        x="24"
        y="33"
        textAnchor="middle"
        fontFamily="var(--font-sans)"
        fontWeight="800"
        fontSize="16"
        fill="currentColor"
        fillOpacity="0.8"
      >
        {monograma(name)}
      </text>
    </svg>
  );
}
