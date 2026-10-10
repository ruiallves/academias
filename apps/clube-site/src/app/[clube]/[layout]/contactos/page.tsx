import type { Metadata } from "next";
import { Mail, MapPin, Phone } from "lucide-react";
import { clubeOu404 } from "@/lib/clube";
import { CabecalhoPagina } from "@/componentes/Seccao";
import { Redes } from "@/componentes/Redes";
import { FormularioContacto } from "./FormularioContacto";

export const revalidate = 60;

export const metadata: Metadata = { title: "Contactos" };

/** Onde estamos e como falar connosco. A mensagem entra na consola do clube. */
export default async function Contactos({ params }: { params: Promise<{ clube: string }> }) {
  const clube = await clubeOu404(params);
  const morada = clube.address.lines.join(", ");

  return (
    <>
      <CabecalhoPagina eyebrow="Contactos" titulo="Fala com o clube" />
      <div className="container-site mt-10 grid gap-12 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-8" data-reveal>
          <div className="rounded-card border border-line bg-surface p-5">
            <address className="space-y-4 not-italic">
              <p className="flex gap-3">
                <MapPin size={20} className="mt-0.5 shrink-0 text-signal-ink" aria-hidden />
                <span>
                  {clube.address.lines.map((l, i) => (
                    <span key={i} className="block text-ink">
                      {l}
                    </span>
                  ))}
                  {clube.address.mapsUrl && (
                    <a href={clube.address.mapsUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm font-semibold text-signal-ink hover:underline">
                      Ver no mapa
                    </a>
                  )}
                </span>
              </p>
              {clube.phone && (
                <p className="flex gap-3">
                  <Phone size={20} className="mt-0.5 shrink-0 text-signal-ink" aria-hidden />
                  <a href={`tel:${clube.phone.replace(/\s/g, "")}`} className="text-ink hover:underline">
                    {clube.phone}
                  </a>
                </p>
              )}
              {clube.email && (
                <p className="flex gap-3">
                  <Mail size={20} className="mt-0.5 shrink-0 text-signal-ink" aria-hidden />
                  <a href={`mailto:${clube.email}`} className="text-ink hover:underline">
                    {clube.email}
                  </a>
                </p>
              )}
            </address>
            <div className="mt-5 rounded-card bg-night p-2 text-night-ink">
              <Redes social={clube.social} shortName={clube.shortName} />
            </div>
          </div>
          <div className="overflow-hidden rounded-card border border-line bg-sunken">
            <iframe
              title={`Mapa: ${morada}`}
              src={`https://www.google.com/maps?q=${encodeURIComponent(morada)}&output=embed`}
              className="h-72 w-full"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>

        <section data-reveal>
          <h2 className="display text-2xl">Envia uma mensagem</h2>
          <span className="traco mt-3" aria-hidden />
          <p className="mt-4 text-ink-2">A mensagem chega à secretaria do clube. Respondemos por email, normalmente em dois dias úteis.</p>
          <FormularioContacto />
        </section>
      </div>
    </>
  );
}
