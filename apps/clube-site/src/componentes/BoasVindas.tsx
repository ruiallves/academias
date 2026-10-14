import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Clube } from "@/dados/tipos";
import { Emblema } from "@/componentes/Emblema";

/**
 * A abertura do início quando o clube ainda não escreveu notícias.
 *
 * Um site acabado de publicar não tem notícias, e o carrossel (ou o herói)
 * desaparecia: a página começava numa faixa de "Sem jogos marcados" e
 * parecia avariada. Inventar notícias num site público com o nome de um
 * clube real não é opção. Em vez disso abre-se com o que o clube já tem na
 * plataforma: o emblema, o nome, o lema, a cidade, as modalidades e as
 * equipas. Quando a primeira notícia sair, o carrossel volta ao seu lugar.
 */
export function BoasVindas({
  clube,
  equipas,
  temJogos,
  quadrado = false,
}: {
  clube: Clube;
  equipas: number;
  temJogos: boolean;
  /** O layout "porto" é de cantos direitos e a toda a largura. */
  quadrado?: boolean;
}) {
  const factos = [
    clube.foundedYear ? { valor: String(clube.foundedYear), rotulo: "Fundação" } : null,
    clube.city ? { valor: clube.city, rotulo: "Cidade" } : null,
    clube.modalidades.length ? { valor: clube.modalidades.join(" · "), rotulo: clube.modalidades.length === 1 ? "Modalidade" : "Modalidades" } : null,
    equipas ? { valor: String(equipas), rotulo: equipas === 1 ? "Equipa" : "Equipas" } : null,
  ].filter((f): f is { valor: string; rotulo: string } => f !== null);

  // Sem texto do clube, a API manda "Nome, Cidade.": repetia o título por baixo dele.
  const textoPorOmissao = `${clube.name}${clube.city ? `, ${clube.city}` : ""}.`;
  const frase = clube.motto ?? (clube.about && clube.about !== textoPorOmissao ? clube.about : null);

  const botao =`inline-flex h-12 items-center gap-2 px-6 text-sm font-bold uppercase tracking-wider transition ${quadrado ? "" : "rounded-control"}`;

  const faixa = (
    <section aria-label={clube.name} className={`relative overflow-hidden bg-signal-strong text-signal-on ${quadrado ? "" : "rounded-card"}`}>
      {/* O emblema em grande, por trás e cortado: dá corpo à faixa sem fotografia nenhuma. */}
      <div className="pointer-events-none absolute -right-16 -bottom-24 opacity-[0.12] sm:-right-8" aria-hidden>
        <Emblema logoUrl={clube.logoUrl} shortName={clube.shortName} size={420} />
      </div>

      <div className={`relative grid gap-8 py-12 sm:py-16 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center lg:gap-12 ${quadrado ? "px-5 sm:px-8 lg:px-12" : "px-6 sm:px-10"}`}>
        <Emblema logoUrl={clube.logoUrl} shortName={clube.shortName} size={120} />
        <div className="min-w-0">
          <p className="eyebrow opacity-80">Site oficial</p>
          <h1 className="display mt-2 text-4xl text-signal-on sm:text-6xl">{clube.name}</h1>
          {frase && <p className="mt-4 max-w-2xl text-lg text-[color:rgb(var(--signal-on-rgb)/0.85)]">{frase}</p>}
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={temJogos ? "/calendario" : "/equipas"} className={`${botao} bg-white text-[#1a1917] hover:brightness-95`}>
              {temJogos ? "Calendário" : "As equipas"}
              <ArrowRight size={18} aria-hidden />
            </Link>
            <a href={clube.membershipUrl} className={`${botao} border border-[color:rgb(var(--signal-on-rgb)/0.4)] hover:bg-[color:rgb(var(--signal-on-rgb)/0.1)]`}>
              Ser sócio
            </a>
          </div>
        </div>
      </div>

      {factos.length > 0 && (
        <dl
          className={`relative grid grid-cols-2 border-t border-[color:rgb(var(--signal-on-rgb)/0.2)] sm:grid-cols-4 ${quadrado ? "px-5 sm:px-8 lg:px-12" : "px-6 sm:px-10"}`}
        >
          {factos.map((f) => (
            // As modalidades são a linha comprida: no telemóvel ocupam a largura toda e partem a linha.
            <div key={f.rotulo} className={`min-w-0 py-5 pr-4 ${f.rotulo.startsWith("Modalidade") ? "col-span-2 sm:col-span-1" : ""}`}>
              <dt className="text-[0.6875rem] font-bold uppercase tracking-wider opacity-70">{f.rotulo}</dt>
              <dd className="mt-1 text-lg font-bold break-words">{f.valor}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
  // No clássico, a faixa alinha pelas margens do resto da página (o contentor fica por fora do fundo).
  return quadrado ? faixa : <div className="container-site mt-6">{faixa}</div>;
}
