import { Interruptor } from "@/components/definicoes/ui";

/**
 * A pergunta das substituições, no criar e no editar equipa: tem
 * substituições ilimitadas? Ligada, quem sai pode voltar a entrar no "Ao vivo"
 * e os minutos somam cada vez em campo. Ver `Team.unlimitedSubs`.
 *
 * O interruptor fica fora de qualquer `<label>`: nada de tocar dentro de
 * rótulos (ver `check:toque`).
 */
export function CampoSubstituicoes({ ligado, onChange, mudouComJogos = false }: { ligado: boolean; onChange: (v: boolean) => void; mudouComJogos?: boolean }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-meta font-medium text-ink">Substituições ilimitadas</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">
            Quem sai pode voltar a entrar, as vezes que for preciso.
          </p>
        </div>
        <Interruptor ligado={ligado} onChange={() => onChange(!ligado)} label="Substituições ilimitadas" />
      </div>
      {ligado && <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">Os minutos de cada um somam todas as vezes que esteve em campo.</p>}
      {mudouComJogos && <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">Vale para os jogos daqui para a frente; as fichas já gravadas ficam como estão.</p>}
    </div>
  );
}
