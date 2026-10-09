import { useState } from "react";
import { addItem, getCatalog, useCatalogForSport } from "@/lib/catalogs";
import { Check, Plus } from "@/lib/icons";
import { cx } from "@/components/primitives";
import { dialogInputClass } from "@/components/Dialog";

/** A prova que todas as equipas têm. O mesmo nome que `AMIGAVEL` no servidor (`catalogs.service.ts`). */
const AMIGAVEL = "Amigável";

/**
 * As provas que uma equipa disputa.
 *
 * ## Porque é que se cria aqui e não só nas Definições
 *
 * O calendário competitivo aparece em Setembro, com a equipa a ser montada — e
 * mandar alguém a Definições → Catálogos a meio de criar uma equipa é garantir
 * que fecha o diálogo e não volta. A prova nasce onde é precisa, e vai parar ao
 * catálogo do clube na mesma: quem a criar aqui encontra-a lá para renomear ou
 * arquivar, e a equipa seguinte já a tem à escolha.
 *
 * ## O que é uma escolha e o que é um erro
 *
 * Nenhuma prova é um estado legítimo — uma equipa nova pode não ter calendário
 * competitivo ainda, e um escalão de formação pode nunca ter. Por isso não há
 * validação nenhuma aqui: só ausência.
 */
export function CompetitionPicker({
  sportId,
  selected,
  onChange,
  disabled,
}: {
  /** Filtra o catálogo pela modalidade — o campeonato de futsal não é o do futebol. */
  sportId?: string | null;
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const competicoes = useCatalogForSport("competitions", sportId);
  const [nova, setNova] = useState("");
  const [criando, setCriando] = useState(false);

  const alternar = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  async function criar() {
    const label = nova.trim();
    if (!label || criando) return;
    setCriando(true);
    try {
      await addItem("competitions", label, undefined, sportId ?? null);
      /*
       * A prova acabada de criar entra já seleccionada.
       *
       * Quem a escreveu quer-na nesta equipa — pedir um segundo clique a seguir
       * seria não perceber para que a estava a criar. Procura-se pelo nome no
       * catálogo já recarregado: o `addItem` não devolve o id, e mudar-lhe a
       * assinatura mexia nos outros três catálogos que o usam.
       */
      const criada = getCatalog("competitions").find(
        (c) => c.label.trim().toLocaleLowerCase("pt") === label.toLocaleLowerCase("pt"),
      );
      if (criada) onChange([...selected, criada.id]);
      setNova("");
    } finally {
      setCriando(false);
    }
  }

  /*
   * "Amigável" está sempre, marcado e sem se poder tirar.
   *
   * O servidor junta-o a cada equipa (`ensureAmigavel`): é a prova de qualquer
   * jogo fora de campeonato, e é nos amigáveis que se convoca de qualquer
   * escalão. Mostrá-lo desmarcado era dizer o contrário do que acontece. Se o
   * clube ainda não o tem no catálogo, nasce com a equipa.
   */
  const outras = competicoes.filter((c) => c.label.trim().toLocaleLowerCase("pt") !== AMIGAVEL.toLocaleLowerCase("pt"));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <span
          title="Todas as equipas têm os jogos amigáveis"
          className="inline-flex cursor-default items-center gap-1.5 rounded-full bg-signal-soft px-2.5 py-1 text-meta font-medium text-signal-ink"
        >
          <Check className="size-3" strokeWidth={2.5} />
          {AMIGAVEL}
        </span>
        {outras.map((c) => {
            const on = selected.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                disabled={disabled}
                onClick={() => alternar(c.id)}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-meta font-medium transition-colors",
                  on ? "bg-signal-soft text-signal-ink" : "bg-sunken text-ink-2 hover:text-ink",
                  disabled && "cursor-default opacity-60",
                )}
              >
                {on && <Check className="size-3" strokeWidth={2.5} />}
                {c.label}
              </button>
            );
          })}
      </div>

      {!disabled && (
        <div className="flex items-center gap-1.5">
          <input
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void criar();
              }
            }}
            placeholder={outras.length ? "Outra prova…" : "Campeonato Distrital, Taça…"}
            className={cx(dialogInputClass, "h-8")}
          />
          <button type="button" className="ctl-outline h-8 shrink-0" onClick={() => void criar()} disabled={!nova.trim() || criando}>
            <Plus className="size-3.5" strokeWidth={1.75} />
            {criando ? "A criar…" : "Criar"}
          </button>
        </div>
      )}

      {outras.length === 0 && disabled && (
        <p className="text-meta text-ink-4">Sem outras competições no catálogo do clube.</p>
      )}
    </div>
  );
}
