import { useEffect, useRef } from "react";
import { useMobile } from "@/lib/viewport";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { CartaoDeSocioPanel } from "@/components/CartaoDeSocio";
import { DeleteAcademyPanel } from "@/components/DeleteAcademyPanel";
import { IdentityPanel } from "@/components/IdentityPanel";
import { ContratoPanel } from "@/components/ContratoPanel";
import { EspacoPanel } from "@/components/EspacoPanel";
import { LegalPanel } from "@/components/LegalPanel";
import { SportsPanel } from "@/components/SportsPanel";
import { ConsultationTypesPanel } from "@/components/ConsultationTypesPanel";
/*
 * A importação de jogos (zerozero) saiu daqui por agora.
 *
 * O componente fica no repositório — `components/ZeroZeroPanel.tsx` — porque o
 * trabalho está feito e volta a entrar quando a funcionalidade for para a frente.
 * Tirá-lo do ecrã é só não oferecer uma caixa que ainda não se quer que ninguém
 * use.
 */
import { cx } from "@/components/primitives";
import { CargosSection } from "@/components/definicoes/CargosSection";
import { MensalidadesSection } from "@/components/definicoes/MensalidadesSection";
import { EpocaPanel } from "@/components/EpocaPanel";
import { MensalidadeDaPlataformaPanel } from "@/components/MensalidadeDaPlataformaPanel";
import {
  CalendarDays,
  CreditCard,
  FileText,
  IdCard,
  Receipt,
  Settings as SettingsIcon,
  Shield,
  Stethoscope,
  TriangleAlert,
  Trophy,
  Wallet,
  type LucideIcon,
} from "@/lib/icons";
import { SECOES, secaoDoEndereco, type SecaoKey } from "@/lib/definicoes";
import { useStore } from "@/lib/store";
import { type CatalogKey } from "@/lib/catalogs";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";

/**
 * Definições.
 *
 * ## Um submenu, e uma secção de cada vez
 *
 * Isto era uma página só: doze painéis em duas colunas, sem navegação. Para
 * mudar um cargo passava-se pela identidade, pelas modalidades e pelos tipos de
 * consulta, e a coluna da direita misturava a época com o contrato e com os
 * documentos legais. Quem a usa descreveu-a como "bastante confusa", e estava.
 *
 * Agora é o desenho que toda a gente já conhece de um ecrã de definições: as
 * secções à esquerda, o conteúdo de **uma** à direita, com um título que diz
 * onde se está e uma frase que diz o que ali se decide. As secções e a ordem
 * delas vivem em `lib/definicoes.ts`.
 *
 * ## O endereço diz a secção
 *
 * `?secao=cargos`. Por três razões: um F5 não devolve a pessoa ao Geral, o botão
 * de voltar atrás do browser anda entre secções, e os links "gerir cargos" e
 * "gerir locais" espalhados pelo produto continuam a abrir no sítio certo (ver
 * `secaoDoEndereco`, que lê também os dois formatos antigos).
 *
 * ## Moderno pela estrutura, não pelo enfeite
 *
 * O pedido foi "futurista". O guia de design da consola proíbe vidro, gradientes
 * e cartões com brilho, e tem razão: uma página de definições com néon ao lado
 * de uma lista de atletas sóbria parecia de outro produto. O que este ecrã tem
 * de novo é hierarquia — submenu com ícones, título grande, uma coluna de
 * leitura — desenhada com as mesmas linhas de 1px e a mesma cor do clube que o
 * resto.
 */

const ICONE: Record<SecaoKey, LucideIcon> = {
  geral: SettingsIcon,
  epoca: CalendarDays,
  modalidades: Trophy,
  cargos: Shield,
  socios: IdCard,
  clinico: Stethoscope,
  mensalidades: Wallet,
  mensalidade: CreditCard,
  plano: Receipt,
  legal: FileText,
  perigo: TriangleAlert,
};

export default function Settings() {
  const { session } = useSession();
  const store = useStore();
  const [params, setParams] = useSearchParams();
  const mobile = useMobile();

  const maySettings = can(session, "settings:write");

  /* Só o que esta pessoa pode ver. A zona de perigo é de quem pode apagar o clube. */
  const secoes = SECOES.filter((sec) => sec.key !== "perigo" || can(session, "academy:delete"));
  const disponiveis = secoes.map((sec) => sec.key);

  // Deep-link a partir de qualquer diálogo que ofereça "gerir X" — p. ex. o local
  // no Novo evento. Chega aqui já com o catálogo certo aberto.
  const deepLinked = params.get("catalogo") as CatalogKey | null;
  const ativa = secaoDoEndereco(
    { secao: params.get("secao"), painel: params.get("painel"), catalogo: params.get("catalogo") },
    disponiveis,
  );
  const secao = secoes.find((sec) => sec.key === ativa) ?? secoes[0];

  /*
   * Mudar de secção deita fora o `catalogo` e o `painel` do endereço: eram a
   * razão de se ter chegado aqui, e ao sair da secção deixam de valer. Ficando,
   * um F5 noutra secção voltava a abrir o catálogo antigo.
   */
  const ir = (key: SecaoKey) => setParams(key === "geral" ? {} : { secao: key });

  return (
    <>
      <PageHeader eyebrow={store.academy.name} title="Definições"/>

      <div className="grid gap-x-10 gap-y-4 lg:grid-cols-[212px_minmax(0,1fr)]">
        <Submenu secoes={secoes} ativa={ativa} onIr={ir} horizontal={mobile} />

        <section className="min-w-0" aria-labelledby="secao-titulo">
          {/*
            O cabeçalho da secção: onde se está, e o que aqui se decide. É a
            pergunta que a página antiga nunca respondia.
          */}
          <header className="mb-5 border-b border-line pb-4">
            <h2
              id="secao-titulo"
              className={cx("text-[22px] font-semibold leading-tight tracking-[-0.01em]", ativa === "perigo" ? "text-risk" : "text-ink")}
            >
              {secao.label}
            </h2>
            <p className="mt-1 max-w-[68ch] text-body leading-relaxed text-ink-3">{secao.descricao}</p>
          </header>

          <div className="max-w-[980px]">
            {ativa === "geral" && <IdentityPanel mayWrite={maySettings} />}

            {/* Em que época o clube está, e o botão que começa a seguinte. */}
            {ativa === "epoca" && <EpocaPanel />}

            {/*
              As modalidades trazem os catálogos consigo: ninguém procura "os
              escalões", procura os escalões do futebol. Ver `SportsPanel`.
            */}
            {ativa === "modalidades" && <SportsPanel mayWrite={maySettings} deepLinked={deepLinked} />}

            {ativa === "cargos" && <CargosSection />}

            {/* O cartão de sócio: estava num diálogo da página dos sócios. */}
            {ativa === "socios" && <CartaoDeSocioPanel mayWrite={maySettings} />}

            {/* Os tipos de consulta são do clube e não de uma modalidade. */}
            {ativa === "clinico" && (
              <ConsultationTypesPanel mayWrite={maySettings} focus={deepLinked === "consultationTypes"} />
            )}

            {ativa === "mensalidades" && <MensalidadesSection />}

            {/* O que o clube paga à plataforma, e como: MB WAY ou Multibanco. */}
            {ativa === "mensalidade" && <MensalidadeDaPlataformaPanel />}

            {ativa === "plano" && (
              <>
                {/* O que o clube contratou — e o botão de assinar, para quem o representa. */}
                <ContratoPanel />
                {/* O espaço de ficheiros: quanto usa, e o limite (5 GB por omissão). */}
                <EspacoPanel />
              </>
            )}

            {/* O que está em vigor e o que esta conta (e o clube) já aceitou. Só leitura. */}
            {ativa === "legal" && <LegalPanel />}

            {/* Apagar o clube é a única acção sem volta do produto. */}
            {ativa === "perigo" && <DeleteAcademyPanel />}
          </div>
        </section>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O submenu das secções.
 *
 * No computador é uma coluna que fica presa ao cimo enquanto a secção rola; no
 * telemóvel é uma fila que rola na horizontal, por cima do conteúdo — uma coluna
 * de dez linhas empurrava a secção para fora do ecrã.
 *
 * O item activo tem a cor do clube (`signal`), que é a regra do produto para
 * "estás aqui". A zona de perigo é vermelha mesmo sem estar activa: é a única
 * linha deste menu que não é uma definição, é um aviso.
 *
 * São botões e não links porque não mudam de página — mudam um parâmetro. O
 * `aria-current` diz a um leitor de ecrã qual está aberto.
 */
function Submenu({
  secoes,
  ativa,
  onIr,
  horizontal,
}: {
  secoes: typeof SECOES;
  ativa: SecaoKey;
  onIr: (key: SecaoKey) => void;
  horizontal: boolean;
}) {
  /*
   * No telemóvel a fila rola, e a secção aberta pode estar fora do ecrã: com dez
   * secções, só as quatro primeiras cabem. Sem isto, quem chegava às
   * Mensalidades por um link via a fila parada no Geral e nenhuma marca de onde
   * estava. `nearest` na vertical para a página não saltar.
   */
  const ativoRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (horizontal) ativoRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [horizontal, ativa]);

  if (horizontal) {
    return (
      <nav aria-label="Secções das definições" className="-mx-4 overflow-x-auto px-4">
        <ul className="flex w-max gap-1.5 pb-1">
          {secoes.map((sec) => {
            const Icone = ICONE[sec.key];
            const on = sec.key === ativa;
            return (
              <li key={sec.key}>
                <button
                  ref={on ? ativoRef : undefined}
                  type="button"
                  aria-current={on ? "page" : undefined}
                  onClick={() => onIr(sec.key)}
                  className={cx(
                    "flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-meta font-medium transition-colors",
                    on
                      ? sec.key === "perigo"
                        ? "border-risk/30 bg-risk-soft text-risk"
                        : "border-signal/30 bg-signal-soft text-signal-ink"
                      : sec.key === "perigo"
                        ? "border-line text-risk"
                        : "border-line text-ink-2",
                  )}
                >
                  <Icone className="size-3.5" strokeWidth={1.75} />
                  {sec.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  /* Os grupos, pela ordem em que aparecem na lista. */
  const grupos: { nome: string; itens: typeof SECOES }[] = [];
  for (const sec of secoes) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.nome === sec.grupo) ultimo.itens.push(sec);
    else grupos.push({ nome: sec.grupo, itens: [sec] });
  }

  return (
    <nav aria-label="Secções das definições" className="lg:sticky lg:top-4 lg:self-start">
      {grupos.map((g, i) => (
        <div key={g.nome || "fim"} className={cx(i > 0 && "mt-4", g.nome === "" && "border-t border-line pt-3")}>
          {g.nome && (
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-4">{g.nome}</p>
          )}
          <ul className="space-y-px">
            {g.itens.map((sec) => (
              <li key={sec.key}>
                <ItemDoSubmenu secao={sec} on={sec.key === ativa} onClick={() => onIr(sec.key)} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function ItemDoSubmenu({ secao, on, onClick }: { secao: (typeof SECOES)[number]; on: boolean; onClick: () => void }) {
  const Icone = ICONE[secao.key];
  const perigo = secao.key === "perigo";
  return (
    <button
      type="button"
      aria-current={on ? "page" : undefined}
      onClick={onClick}
      className={cx(
        /*
         * Sem fundo e sem recuo, de propósito. Um fundo arredondado obriga a
         * dar margem ao texto lá dentro, e o texto deixava de alinhar com o
         * título "Definições" por cima — dez píxeis ao lado, que era a primeira
         * coisa em que se reparava. Assim o ícone cai exactamente por baixo da
         * primeira letra do título.
         */
        "group relative flex h-9 w-full items-center gap-2.5 text-left text-body transition-colors duration-[120ms]",
        on
          ? perigo
            ? "font-medium text-risk"
            : "font-medium text-ink"
          : perigo
            ? "text-risk/75 hover:text-risk"
            : "text-ink-3 hover:text-ink",
      )}
    >
      {/* A marca de "estás aqui": um traço da cor do clube, fora da coluna do texto. */}
      <span
        aria-hidden
        className={cx(
          "absolute -left-3 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full transition-opacity duration-[120ms]",
          /*
           * `signal-ink` e não `signal`. A cor do clube crua serve superfícies
           * sem texto; para um traço ou um ícone sobre fundo claro é preciso a
           * versão que se lê. Com um clube de amarelo-claro, o `signal` dava um
           * traço e um ícone invisíveis — "estás aqui" sem se ver onde.
           */
          perigo ? "bg-risk" : "bg-signal-ink",
          on ? "opacity-100" : "opacity-0",
        )}
      />
      <Icone
        className={cx("size-4 shrink-0", on && !perigo ? "text-signal-ink" : "")}
        strokeWidth={on ? 2 : 1.75}
      />
      <span className="truncate">{secao.label}</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
