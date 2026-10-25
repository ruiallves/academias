"use client";

import { useState } from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";

/**
 * O mapa do Google, só depois de a pessoa carregar no botão.
 *
 * O mapa embutido põe cookies do Google mal carrega, e esses cookies não são
 * precisos para o site funcionar: pedem consentimento. Carregar só ao clicar
 * é esse consentimento, e o site fica sem cookies de terceiros e sem aviso
 * de cookies por cima das páginas.
 */
export function Mapa({ morada }: { morada: string }) {
  const [ver, setVer] = useState(false);

  if (ver) {
    return (
      <div className="overflow-hidden rounded-card border border-line bg-sunken">
        <iframe
          title={`Mapa: ${morada}`}
          src={`https://www.google.com/maps?q=${encodeURIComponent(morada)}&output=embed`}
          className="h-72 w-full"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    );
  }

  return (
    <div className="flex h-72 flex-col items-center justify-center gap-3 rounded-card border border-line bg-sunken px-6 text-center">
      <MapPin size={28} className="text-signal-ink" aria-hidden />
      <button type="button" onClick={() => setVer(true)} className="inline-flex min-h-11 items-center rounded-full bg-signal-strong px-5 text-sm font-semibold text-signal-on transition hover:brightness-110">
        Mostrar o mapa
      </button>
      <p className="max-w-sm text-xs text-ink-3">
        O mapa é do Google, que pode guardar cookies quando o mapa abre.{" "}
        <Link href="/privacidade#cookies" className="font-semibold text-ink hover:underline">
          Sobre cookies
        </Link>
      </p>
    </div>
  );
}
