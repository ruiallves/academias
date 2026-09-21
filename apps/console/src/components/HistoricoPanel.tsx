import { useEffect, useState } from "react";
import { Empty, Loading, Panel, PanelHead } from "@/components/primitives";
import { ArrowRight, History } from "@/lib/icons";
import { lerHistorico, nomeDoCampo, quandoFoi, valorDoCampo, type Alteracao, type TipoDePerfil } from "@/lib/historico";

/**
 * O que já mexeram nesta ficha.
 *
 * ## Porque existe
 *
 * Uma ficha só mostra o estado de agora. Quando o peso de um atleta aparece
 * quatro quilos abaixo, ou quando um sócio passa a inactivo sem ninguém saber
 * porquê, a pergunta é sempre a mesma — quem mexeu, quando, e o que estava lá
 * antes. Sem este painel a resposta era "não dá para saber".
 *
 * ## O que mostra
 *
 * Uma linha por campo mudado, com o antes e o depois lado a lado. As gravações
 * do mesmo momento ficam agrupadas por quem mexeu e quando: editar a ficha é um
 * gesto só, e mostrá-lo como seis entradas soltas faria parecer seis idas à
 * ficha.
 *
 * Só é visível a quem pode editar a ficha — e o servidor verifica o mesmo, que é
 * onde a regra vive (ver `common/historico.controller.ts`). Não há como escrever
 * nem apagar aqui: o histórico escreve-se sozinho de dentro de cada gravação, e
 * a própria base recusa alterá-lo.
 */
export function HistoricoPanel({
  tipo,
  id,
  className,
}: {
  tipo: TipoDePerfil;
  id: string;
  className?: string;
}) {
  const [linhas, setLinhas] = useState<Alteracao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setLinhas(null);
    setErro(null);
    lerHistorico(tipo, id)
      .then((r) => vivo && setLinhas(r))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Não foi possível carregar o histórico."));
    return () => {
      vivo = false;
    };
  }, [tipo, id]);

  const grupos = agrupar(linhas ?? []);

  return (
    <Panel className={className}>
      <PanelHead title="Histórico de alterações" hint={linhas?.length ? `${linhas.length}` : undefined} />

      {erro ? (
        <p className="px-5 py-4 text-meta text-risk">{erro}</p>
      ) : linhas === null ? (
        <Loading size="panel" />
      ) : linhas.length === 0 ? (
        <Empty
          title="Ainda ninguém mexeu nesta ficha"
          detail="A partir de agora, cada campo corrigido fica aqui com o antes, o depois e quem mexeu."
          icon={History}
          compact
        />
      ) : (
        <ul className="divide-y divide-line">
          {grupos.map((g) => (
            <li key={g.chave} className="px-5 py-3">
              <p className="text-meta text-ink-3">
                <span className="font-medium text-ink-2">{g.quem ?? "Alguém"}</span> · {quandoFoi(g.quando)}
              </p>
              <ul className="mt-1.5 space-y-1">
                {g.campos.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-body">
                    <span className="text-ink-2">{nomeDoCampo(c.field)}</span>
                    <span className="text-ink-3 line-through">{valorDoCampo(c.field, c.before)}</span>
                    <ArrowRight className="size-3 shrink-0 text-ink-3" strokeWidth={1.75} />
                    <span className="font-medium text-ink">{valorDoCampo(c.field, c.after)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * Uma gravação, e não um campo.
 *
 * Junta as linhas escritas pela mesma pessoa no mesmo minuto — que é o que uma
 * ida à ficha produz. O minuto chega: duas edições da mesma pessoa no mesmo
 * minuto são, para quem lê, a mesma ida.
 */
function agrupar(linhas: Alteracao[]) {
  const grupos: { chave: string; quem: string | null; quando: string; campos: Alteracao[] }[] = [];
  for (const l of linhas) {
    const minuto = l.createdAt.slice(0, 16);
    const chave = `${l.byName ?? ""}|${minuto}`;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.chave === chave) ultimo.campos.push(l);
    else grupos.push({ chave, quem: l.byName, quando: l.createdAt, campos: [l] });
  }
  return grupos;
}
