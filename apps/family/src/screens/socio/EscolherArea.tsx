import { IdCard, Users } from "lucide-react";
import { readBrand } from "@/lib/brand";
import { chooseContext, type ContextType } from "@/lib/contexts";
import { ClubMark } from "@/ClubMark";

/**
 * "Como queres continuar?" — a escolha de contexto pós-login.
 *
 * ## Isto não é um segundo login
 *
 * A conta já entrou; isto é escolher a roupa. Só aparece a quem tem **mais do
 * que um** contexto — quem só é pai entra direto na Família, quem só é sócio
 * entra direto no Sócio, e nenhum dos dois vê este ecrã (ver `loadContexts`).
 *
 * A escolha fica guardada: amanhã a app abre onde se ficou, e troca-se pelo
 * switcher sem voltar aqui.
 */
export default function EscolherArea({ name }: { name: string }) {
  const brand = readBrand();
  const primeiro = name.trim().split(/\s+/)[0];

  const opcoes: { type: ContextType; label: string; hint: string; icon: typeof Users }[] = [
    { type: "FAMILY", label: "Família", hint: "Acompanha os teus atletas: treinos, convocatórias, avaliações e pagamentos.", icon: Users },
    { type: "MEMBER", label: "Sócio", hint: "O teu cartão, as quotas, os jogos e as novidades do clube.", icon: IdCard },
  ];

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center gap-6 px-6 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <ClubMark logoUrl={brand.logoUrl} mark={brand.mark} size={56} radius={16} className="shadow-[var(--shadow-soft)]" />
        <div>
          <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink">
            {primeiro ? `Bem-vindo de volta, ${primeiro} 👋` : "Bem-vindo de volta 👋"}
          </h1>
          <p className="mt-1 text-[14px] text-ink-3">Como queres continuar?</p>
        </div>
      </header>

      <div className="space-y-3">
        {opcoes.map(({ type, label, hint, icon: Icon }, i) => (
          <button
            key={type}
            type="button"
            onClick={() => chooseContext(type)}
            className="rise flex w-full items-center gap-4 rounded-[20px] bg-surface p-5 text-left shadow-[var(--shadow-soft)] active:scale-[0.99]"
            style={{ ["--i" as string]: i }}
          >
            <span className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-signal-soft text-signal-ink">
              <Icon className="size-6" strokeWidth={1.9} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] font-semibold text-ink">{label}</span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-3">{hint}</span>
            </span>
          </button>
        ))}
      </div>

      <p className="text-center text-[12px] text-ink-4">Podes trocar a qualquer momento, sem sair da conta.</p>
    </div>
  );
}
