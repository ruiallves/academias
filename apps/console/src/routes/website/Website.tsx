import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { SlidersHorizontal } from "@/lib/icons";
import { useStore } from "@/lib/store";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { useState } from "react";
import { useCarregamentoDoSite, useSite } from "@/lib/website";
import { PaginaDoWebsite } from "./Pagina";
import { destinoAntigo, enderecoDaSecao, separadorQueSaiu } from "./rotas";
import { VisaoGeral } from "./VisaoGeral";
import { Identidade, Aspeto, Dominio } from "./Configuracao";
import { InformacaoLegal } from "./Legal";
import { Inicio } from "./Inicio";
import { Noticias } from "./Noticias";
import { Loja } from "./Loja";
import { Bilheteira } from "./Bilheteira";
import { PrecosPorOmissao } from "./PrecosDaBilheteira";
import { Estadio } from "./Estadio";
import { Equipas, Mensagens } from "./Conteudo";
import { Encomendas } from "./Encomendas";

/**
 * Website: o site do clube, gerido daqui, em seis páginas do menu principal.
 * Só para clubes com o site no plano (Connect Pro, ou o período experimental):
 * ver `GRUPO_WEBSITE` em `lib/nav.ts`.
 *
 * Era uma página só com treze secções num submenu próprio. Com a loja, a
 * bilheteira e as mensagens a crescer, quem vinha tratar de uma encomenda
 * tinha de atravessar o desenho do site para lá chegar. Cada página é agora
 * um trabalho (montar o site, escrever, vender, vender bilhetes, responder),
 * com as partes em separadores. Endereços em `rotas.ts`; moldura em `Pagina.tsx`.
 */

/** Ir para uma secção de qualquer página (a Visão geral e a Página de início apontam para várias). */
function useIrParaSecao() {
  const navigate = useNavigate();
  return (secao: string) => navigate(enderecoDaSecao(secao));
}

/* -------------------------------------------------------------------------- */
/* Site                                                                        */
/* -------------------------------------------------------------------------- */

type SecaoDoSite = "geral" | "identidade" | "aspeto" | "inicio" | "dominio" | "legal";

/**
 * Site: montar o site e pô-lo no ar. Também é para onde levam os endereços
 * antigos (`/website?secao=loja`); esses seguem para a página nova.
 */
export default function Website() {
  const [params] = useSearchParams();
  const destino = destinoAntigo(params);
  if (destino) return <Navigate to={destino} replace />;
  return <Site />;
}

function Site() {
  const irPara = useIrParaSecao();
  return (
    <PaginaDoWebsite<SecaoDoSite>
      titulo="Site"
      separadores={[
        { key: "geral", label: "Visão geral", descricao: "Se o site está no ar, o que tem, e o que falta para ficar completo." },
        { key: "inicio", label: "Página de início", descricao: "A página de início como o visitante a vê. Arrasta as secções, mostra ou esconde, e acrescenta banners onde quiseres." },
        { key: "identidade", label: "Identidade", descricao: "Quem é o clube: o lema, o texto de apresentação, a história, a direção, as instalações, a morada e as redes." },
        { key: "aspeto", label: "Aspeto", descricao: "O layout do site. A cor e o emblema são os do clube, os mesmos da consola e da app." },
        { key: "dominio", label: "Domínio", descricao: "O endereço .pt do clube, e onde o site vive enquanto o domínio não aponta para cá." },
        {
          key: "legal",
          label: "Informação legal",
          descricao: "O nome legal e o NIPC, o centro de arbitragem e as regras do clube. O site escreve com isto a privacidade, as condições de venda e os termos do sócio.",
        },
      ]}
    >
      {(ativa) => (
        <>
          {ativa === "geral" && <VisaoGeral onIr={irPara} />}
          {ativa === "inicio" && <Inicio onIr={irPara} />}
          {ativa === "identidade" && <Identidade />}
          {ativa === "aspeto" && <Aspeto />}
          {ativa === "dominio" && <Dominio />}
          {ativa === "legal" && <InformacaoLegal />}
        </>
      )}
    </PaginaDoWebsite>
  );
}

/* -------------------------------------------------------------------------- */
/* Conteúdo                                                                    */
/* -------------------------------------------------------------------------- */

type SecaoDoConteudo = "noticias" | "equipas";

/** Os patrocinadores eram um separador daqui: estão em Gestão › Patrocinadores (a mesma lista). */
export function ConteudoDoSite() {
  const store = useStore();
  const site = useSite(store.academy.slug);
  const [params] = useSearchParams();
  const rascunhos = site.noticias.filter((n) => n.estado !== "publicada").length;
  const saiu = separadorQueSaiu("conteudo", params);
  if (saiu) return <Navigate to={saiu} replace />;
  return (
    <PaginaDoWebsite<SecaoDoConteudo>
      titulo="Conteúdo"
      separadores={[
        { key: "noticias", label: "Notícias", contagem: site.noticias.length, descricao: rascunhos > 0 ? `O que se escreve sobre o clube. As três em destaque abrem a página de início. ${rascunhos === 1 ? "Há 1 por publicar." : `Há ${rascunhos} por publicar.`}` : "O que se escreve sobre o clube. As três em destaque abrem a página de início." },
        { key: "equipas", label: "Equipas", descricao: "Que equipas aparecem no site, com que fotografia, e se mostram resultados e o plantel." },
      ]}
    >
      {(ativa) => (
        <>
          {ativa === "noticias" && <Noticias />}
          {ativa === "equipas" && <Equipas />}
        </>
      )}
    </PaginaDoWebsite>
  );
}

/* -------------------------------------------------------------------------- */
/* Loja                                                                        */
/* -------------------------------------------------------------------------- */

type SecaoDaLoja = "produtos" | "categorias" | "codigos" | "entrega";

/** O catálogo e a entrega. As encomendas têm página própria (`EncomendasDoSite`). */
export function LojaDoSite() {
  const store = useStore();
  const site = useSite(store.academy.slug);
  const [params] = useSearchParams();
  // `/website/loja?secao=encomendas`: o endereço dos emails de encomenda enviados antes de as Encomendas terem página.
  const saiu = separadorQueSaiu("loja", params);
  if (saiu) return <Navigate to={saiu} replace />;
  return (
    <PaginaDoWebsite<SecaoDaLoja>
      titulo="Loja"
      separadores={[
        { key: "produtos", label: "Produtos", contagem: site.produtos.length, descricao: "O que está à venda no site: fotografias, preço e promoção, categoria, tamanhos e stock." },
        { key: "categorias", label: "Categorias", contagem: site.categorias.length, descricao: "Como os produtos se arrumam na montra e no filtro do site, e por que ordem." },
        { key: "codigos", label: "Códigos promocionais", contagem: site.codigos.filter((c) => c.estado === "ativo").length, descricao: "Descontos em percentagem, em valor ou no envio, com datas, mínimos e limites de uso." },
        { key: "entrega", label: "Entrega", descricao: "Como o clube entrega: levantamento no clube, envio pelo correio e o aviso no topo da loja." },
      ]}
    >
      {(ativa, ir) => <Loja vista={ativa} onIrParaEntrega={() => ir("entrega")} />}
    </PaginaDoWebsite>
  );
}

/* -------------------------------------------------------------------------- */
/* Encomendas                                                                  */
/* -------------------------------------------------------------------------- */

/** As encomendas da loja, numa página só para elas: é o que se abre todos os dias, e o email de cada encomenda nova traz aqui. */
export function EncomendasDoSite() {
  return (
    <PaginaDoWebsite titulo="Encomendas" descricao="As encomendas pagas para preparar e entregar, e as que precisam de reembolso.">
      {() => <Encomendas />}
    </PaginaDoWebsite>
  );
}

/* -------------------------------------------------------------------------- */
/* Bilheteira                                                                  */
/* -------------------------------------------------------------------------- */

type SecaoDaBilheteira = "jogos" | "anuais" | "estadio";

export function BilheteiraDoSite() {
  const store = useStore();
  const { session } = useSession();
  const site = useSite(store.academy.slug);
  // O diálogo dos preços grava a lista inteira: só abre com o site carregado, ou gravava por cima com listas vazias.
  const { carregado } = useCarregamentoDoSite(store.academy.slug);
  const [precos, setPrecos] = useState(false);
  const navigate = useNavigate();
  const irParaEstadio = () => {
    setPrecos(false);
    navigate(enderecoDaSecao("estadio"));
  };

  return (
    <>
      <PaginaDoWebsite<SecaoDaBilheteira>
        titulo="Bilheteira"
        acoes={
          carregado && can(session, "website:write") && (
            <button type="button" className="ctl-outline" onClick={() => setPrecos(true)}>
              <SlidersHorizontal className="size-4" strokeWidth={1.75} />
              Preços por omissão
            </button>
          )
        }
        separadores={[
          { key: "jogos", label: "Jogos", descricao: "Bilhetes para os jogos, em casa e fora: abrir a venda, preços por bancada e público, quem compra e quando, as vendas e o leitor à porta." },
          {
            key: "anuais",
            label: "Lugares anuais",
            // Os lugares são de sócios: sem ver os sócios não há o que mostrar.
            oculto: !can(session, "member:read"),
            descricao: "Os lugares dos sócios para a época inteira. Contam na lotação de todos os jogos em casa.",
          },
          { key: "estadio", label: "Estádio", contagem: site.recintos.length || undefined, descricao: "Os recintos vistos de cima, com as bancadas e as portas. Quem compra um bilhete vê no mapa onde vai ficar." },
        ]}
      >
        {(ativa) => (
          <>
            {(ativa === "jogos" || ativa === "anuais") && <Bilheteira vista={ativa} onIrParaEstadio={irParaEstadio} />}
            {ativa === "estadio" && <Estadio />}
          </>
        )}
      </PaginaDoWebsite>

      {precos && carregado && (
        <PrecosPorOmissao recintos={site.recintos} precos={site.precosBilheteira} categorias={site.categoriasDeSocio} onClose={() => setPrecos(false)} onIrParaEstadio={irParaEstadio} />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Mensagens                                                                   */
/* -------------------------------------------------------------------------- */

export function MensagensDoSite() {
  return (
    <PaginaDoWebsite titulo="Mensagens" descricao="O que chega pelo formulário de contactos do site. Responde por email ou telefone e marca como tratada.">
      {() => <Mensagens />}
    </PaginaDoWebsite>
  );
}
