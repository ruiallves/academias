import { useState } from "react";
import { ExternalLink } from "@/lib/icons";
import { cx } from "@/components/primitives";
import { Bloco, Campo, campoClass, Erro } from "@/components/definicoes/ui";
import { useStore } from "@/lib/store";
import { enderecoDoSite, guardarConfig, useSite, type EntidadeRalKey, type LegalDoSite } from "@/lib/website";
import { nifValido } from "@/lib/subscricao";
import { mostrarOk } from "@/lib/avisos";
import { ENTIDADES_RAL, entidadeSugerida } from "./entidades-ral";

/**
 * A informação legal do site: quem é o clube perante quem compra, e o que o
 * clube acrescenta às páginas legais que o site gera (privacidade, condições
 * de venda, termos do sócio).
 *
 * O site escreve essas páginas sozinho com os dados do clube. Aqui o clube
 * põe o que só ele sabe: o nome legal, o NIPC, o centro de arbitragem da sua
 * zona e as regras próprias. Um rascunho e um Guardar, como a Identidade.
 */
export function InformacaoLegal() {
  const store = useStore();
  const slug = store.academy.slug;
  const site = useSite(slug);
  const [d, setD] = useState<LegalDoSite>(site.identidade.legal);
  const [aGravar, setAGravar] = useState(false);
  const mudou = JSON.stringify(d) !== JSON.stringify(site.identidade.legal);

  const nipcLimpo = d.nipc.replace(/\D/g, "");
  const nipcErrado = nipcLimpo.length > 0 && !nifValido(nipcLimpo);
  const sugerida = entidadeSugerida(store.academy.city);
  const escolhida: EntidadeRalKey = d.ral || sugerida;
  const outra = escolhida === "outra";
  const enderecoSite = enderecoDoSite(slug, site.dominio);

  const texto = (k: keyof LegalDoSite) => ({
    value: d[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value }),
  });

  const guardar = async () => {
    setAGravar(true);
    try {
      await guardarConfig({ identidade: { ...site.identidade, legal: { ...d, nipc: nipcLimpo } } }, { imediato: true });
      mostrarOk("Informação legal guardada.");
    } finally {
      setAGravar(false);
    }
  };

  const nomeNoRodape = d.nome.trim() || store.academy.name;

  return (
    <div>
      <Bloco
        titulo="Quem vende"
        descricao="Aparece no rodapé de todas as páginas, nas condições de venda e na política de privacidade. A lei pede-o a quem vende pela internet."
      >
        <div className="space-y-4">
          <Campo label="Nome legal" ajuda={`Como está registado. Vazio, o site usa "${store.academy.name}".`}>
            <input className={campoClass} placeholder={store.academy.name} {...texto("nome")} />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
            <Campo label="NIPC">
              <input className={cx(campoClass, "font-mono")} inputMode="numeric" maxLength={11} placeholder="500000000" {...texto("nipc")} />
            </Campo>
          </div>
          {nipcErrado && <Erro>Este NIPC não está certo: confere os 9 algarismos. Um NIPC errado não se grava.</Erro>}
          <div className="rounded-[10px] border border-line bg-sunken/40 px-3.5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-4">Assim fica no rodapé</p>
            <p className="mt-1.5 text-meta text-ink-2">
              {nomeNoRodape}
              {nipcLimpo && !nipcErrado ? ` · NIPC ${nipcLimpo}` : ""}
            </p>
            <p className="mt-1 text-meta text-ink-3">Privacidade · Cookies · Condições de venda · Termos do sócio · Livro de Reclamações</p>
          </div>
        </div>
      </Bloco>

      <Bloco
        titulo="Resolução de litígios"
        descricao="Quem compra tem de saber a que centro de arbitragem pode recorrer se não se entender com o clube. Escolhe o da zona do clube; o nacional serve onde não há centro regional."
      >
        <div className="space-y-4">
          <Campo
            label="Centro de arbitragem"
            ajuda={!d.ral ? `Sugerido pela cidade do clube${store.academy.city ? ` (${store.academy.city})` : ""}. Confirma se é o da tua zona.` : undefined}
          >
            <select className={campoClass} value={escolhida} onChange={(e) => setD({ ...d, ral: e.target.value as EntidadeRalKey })}>
              {ENTIDADES_RAL.map((e) => (
                <option key={e.key} value={e.key}>
                  {e.sigla} · {e.area}
                </option>
              ))}
              <option value="outra">Outro centro (Madeira, Açores, setorial)</option>
            </select>
          </Campo>
          {outra ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Nome do centro">
                <input className={campoClass} {...texto("ralNome")} />
              </Campo>
              <Campo label="Endereço do site do centro">
                <input className={campoClass} type="url" placeholder="https://" {...texto("ralUrl")} />
              </Campo>
            </div>
          ) : (
            <p className="text-meta leading-relaxed text-ink-3">{ENTIDADES_RAL.find((e) => e.key === escolhida)?.nome}</p>
          )}
        </div>
      </Bloco>

      <Bloco
        titulo="Termos do sócio"
        descricao="Quem pede para ser sócio pelo site aceita estes termos. O site já diz que o pedido fica à espera do clube e que valem os estatutos; aqui acrescentas as regras do clube."
      >
        <div className="space-y-4">
          <Campo label="Estatutos ou regulamento de sócios" ajuda="Se estiverem online, o link aparece nos termos.">
            <input className={campoClass} type="url" placeholder="https://" {...texto("estatutosUrl")} />
          </Campo>
          <Campo label="Regras do clube" ajuda="Por exemplo: quando se ganha direito a voto, o que acontece com quotas em atraso. Parágrafos separados por uma linha em branco.">
            <textarea className={cx(campoClass, "h-32 py-2.5")} {...texto("termosSocio")} />
          </Campo>
        </div>
      </Bloco>

      <Bloco
        titulo="Condições de venda"
        descricao="O site escreve as condições da loja e da bilheteira com o que configuraste (entrega, portes, reserva de 10 minutos, devoluções em 14 dias, garantia). Acrescenta aqui só o que é próprio do clube."
      >
        <Campo label="Nota do clube" ajuda="Por exemplo: trocas de tamanho na sede, ou se o clube paga a devolução.">
          <textarea className={cx(campoClass, "h-24 py-2.5")} {...texto("notaVenda")} />
        </Campo>
      </Bloco>

      <Bloco titulo="Privacidade" descricao="A política de privacidade é escrita pelo site e diz o que cada formulário recolhe. Acrescenta aqui o que o clube faz de diferente.">
        <Campo label="Nota do clube">
          <textarea className={cx(campoClass, "h-24 py-2.5")} {...texto("notaPrivacidade")} />
        </Campo>
      </Bloco>

      <Bloco titulo="As páginas no site" descricao="Abrem no site do clube, como as vê quem visita. Mostram o que está guardado.">
        <ul className="flex flex-wrap gap-2">
          {[
            ["Privacidade", "/privacidade"],
            ["Condições de venda", "/condicoes-de-venda"],
            ["Termos do sócio", "/termos-do-socio"],
          ].map(([rotulo, caminho]) => (
            <li key={caminho}>
              <a href={`${enderecoSite}${caminho}`} target="_blank" rel="noopener noreferrer" className="ctl-outline">
                {rotulo}
                <ExternalLink className="size-3.5" strokeWidth={1.75} />
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-meta leading-relaxed text-ink-3">
          Os textos seguem a lei portuguesa e foram escritos pela plataforma; não substituem o conselho de um advogado. As condições de venda só aparecem no rodapé
          quando o clube vende pelo site.
        </p>
      </Bloco>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-canvas/95 py-3 backdrop-blur">
        <button type="button" className="ctl-ghost" disabled={!mudou} onClick={() => setD(site.identidade.legal)}>
          Desfazer
        </button>
        <button type="button" className="ctl-primary" disabled={!mudou || aGravar || nipcErrado} onClick={() => void guardar()}>
          Guardar
        </button>
      </div>
    </div>
  );
}
