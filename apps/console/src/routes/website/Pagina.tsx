import { useEffect, useRef, type ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Empty, Loading, cx } from "@/components/primitives";
import { ExternalLink, Eye, Globe, TriangleAlert } from "@/lib/icons";
import { useStore } from "@/lib/store";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { enderecoDoSite, useCarregamentoDoSite, useSite } from "@/lib/website";

/**
 * A moldura das cinco páginas do Website (Site, Conteúdo, Loja, Bilheteira,
 * Mensagens): o cabeçalho com "Ver o site", os avisos que valem para todas,
 * os separadores e o carregamento do site.
 *
 * ## Três níveis, cada um com a sua forma
 *
 *   1. O menu principal escolhe a página (Loja).
 *   2. Os separadores sublinhados, no topo, escolhem a parte (Encomendas).
 *   3. Dentro da parte, os seletores segmentados são filtros (Por tratar).
 *
 * Nunca dois níveis com a mesma forma: era o que fazia a página única de
 * antes parecer um labirinto (um submenu à esquerda dentro do menu à
 * esquerda, e pastilhas dentro das pastilhas).
 *
 * O separador vive em `?secao=`: o F5, o voltar atrás e os links dos emails
 * levam direto a ele. Ver `rotas.ts`.
 */

export type Separador<K extends string> = {
  key: K;
  label: string;
  /** Uma frase sobre o que se faz aqui. Aparece por baixo dos separadores. */
  descricao: string;
  /** O que espera por alguém (encomendas por tratar). Zero não se mostra. */
  pendentes?: number;
  /** Quantos há (produtos, categorias). Discreto, ao lado do nome. */
  contagem?: number;
  /** Esconder sem tirar da lista (quem não pode ver sócios não vê os lugares anuais). */
  oculto?: boolean;
};

export function PaginaDoWebsite<K extends string>({
  titulo,
  descricao,
  separadores,
  acoes,
  children,
}: {
  titulo: string;
  /** Para uma página sem separadores (Mensagens). */
  descricao?: string;
  separadores?: Separador<K>[];
  /** Botões da página, ao lado de "Ver o site". */
  acoes?: ReactNode;
  children: (ativa: K, ir: (k: K) => void) => ReactNode;
}) {
  const store = useStore();
  // Sem o site (Connect Pro, ou o período experimental) o menu não aparece, e quem escreve o endereço volta ao início.
  if (!store.academy.websiteIncluido) return <Navigate to="/" replace />;
  return (
    <Moldura titulo={titulo} descricao={descricao} separadores={separadores} acoes={acoes}>
      {children}
    </Moldura>
  );
}

function Moldura<K extends string>({
  titulo,
  descricao,
  separadores,
  acoes,
  children,
}: {
  titulo: string;
  descricao?: string;
  separadores?: Separador<K>[];
  acoes?: ReactNode;
  children: (ativa: K, ir: (k: K) => void) => ReactNode;
}) {
  const store = useStore();
  const { session } = useSession();
  const site = useSite(store.academy.slug);
  const { carregado, erro } = useCarregamentoDoSite(store.academy.slug);
  const [params, setParams] = useSearchParams();

  const visiveis = (separadores ?? []).filter((s) => !s.oculto);
  const primeiro = visiveis[0]?.key ?? ("" as K);
  const pedida = params.get("secao");
  const ativa = (visiveis.some((s) => s.key === pedida) ? pedida : primeiro) as K;
  const atual = visiveis.find((s) => s.key === ativa);

  /*
   * Mudar de separador é navegar: entra no histórico, para o voltar atrás do
   * browser devolver o separador de antes. Os outros parâmetros da página
   * (filtros, o jogo aberto) não passam de um separador para o outro.
   */
  const ir = (k: K) => setParams(k === primeiro ? {} : { secao: k });

  // Ver é `website:read`; mudar o que quer que seja é `website:write`. O servidor recusa na mesma: a faixa é para a pessoa saber antes de tentar.
  const soLeitura = !can(session, "website:write");

  return (
    <>
      <PageHeader eyebrow="Website" title={titulo}>
        {acoes}
        <a href={enderecoDoSite(store.academy.slug, site.dominio)} target="_blank" rel="noopener noreferrer" className="ctl-outline">
          <Globe className="size-4" strokeWidth={1.75} />
          Ver o site
          <ExternalLink className="size-3.5" strokeWidth={1.75} />
        </a>
      </PageHeader>

      {soLeitura && (
        <Faixa tom="neutro" icone={<Eye className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />}>
          <strong className="font-semibold text-ink">Podes ver o site, mas não publicar.</strong> Mudar o conteúdo ou pôr o site no ar é de quem tem a
          permissão de publicar o website.
        </Faixa>
      )}

      {/*
        Em avaliação, sem o Connect Pro: o site está cá para o clube ver como ia
        ficar. Diz-se até quando, e o que acontece depois, para ninguém publicar
        o site a contar com ele e o ver desaparecer sem aviso.
      */}
      {store.academy.websiteNaExperiencia && (
        <Faixa tom="clube" icone={<Globe className="mt-0.5 size-4 shrink-0 text-signal-ink" strokeWidth={1.75} />}>
          <strong className="font-semibold text-ink">
            O site está incluído no período experimental
            {store.academy.trialEndsAt ? `, até ${new Date(store.academy.trialEndsAt).toLocaleDateString("pt-PT")}` : ""}.
          </strong>{" "}
          Monta-o e publica-o para veres como fica. Depois disso o site vem com o Connect Pro: sem ele sai do ar, e o que preparaste fica guardado para
          quando o ligares.
        </Faixa>
      )}

      {/* Por publicar: o endereço do site mostra "não ligado" até o clube o pôr no ar (Site › Visão geral). */}
      {carregado && !site.publicado && (
        <Faixa tom="aviso" icone={<TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />}>
          <strong className="font-semibold">O site ainda não está no ar.</strong> Prepara o que quiseres e publica-o em Site › Visão geral.
        </Faixa>
      )}

      {visiveis.length > 0 && <Separadores separadores={visiveis} ativa={ativa} onIr={ir} rotulo={`Partes de ${titulo}`} />}

      {(atual?.descricao ?? descricao) && <p className="mb-5 max-w-[72ch] text-body leading-relaxed text-ink-3">{atual?.descricao ?? descricao}</p>}

      <div className="max-w-[1080px]">
        {erro && !carregado && <Empty icon={TriangleAlert} title="Não foi possível abrir o site do clube" detail={erro} />}
        {!erro && !carregado && <Loading size="panel" />}
        {carregado && children(ativa, ir)}
      </div>
    </>
  );
}

function Faixa({ tom, icone, children }: { tom: "neutro" | "clube" | "aviso"; icone: ReactNode; children: ReactNode }) {
  return (
    <p
      className={cx(
        "mb-4 flex items-start gap-2 rounded-[10px] border px-3.5 py-2.5 text-meta leading-relaxed",
        tom === "neutro" && "border-line bg-sunken/60 text-ink-2",
        tom === "clube" && "border-signal/25 bg-signal-soft text-ink-2",
        tom === "aviso" && "border-warn/25 bg-warn-soft text-warn",
      )}
    >
      {icone}
      <span>{children}</span>
    </p>
  );
}

/**
 * Os separadores da página: texto sublinhado, numa linha que rola para o lado
 * no telemóvel (o ativo vem sempre à vista). Botões com `aria-current` e não
 * um `tablist`: cada um muda o endereço, é navegação.
 *
 * 44 px de altura para o toque. O que espera por alguém (`pendentes`) leva a
 * pastilha da cor do clube; uma contagem simples fica em cinzento.
 */
function Separadores<K extends string>({ separadores, ativa, onIr, rotulo }: { separadores: Separador<K>[]; ativa: K; onIr: (k: K) => void; rotulo: string }) {
  const ativoRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    ativoRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [ativa]);

  return (
    <nav aria-label={rotulo} className="scroll-x-clean -mx-4 mb-4 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
      <ul className="flex w-max min-w-full gap-6">
        {separadores.map((s) => {
          const on = s.key === ativa;
          const pendentes = s.pendentes ?? 0;
          return (
            <li key={s.key}>
              <button
                ref={on ? ativoRef : undefined}
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => onIr(s.key)}
                className={cx(
                  "relative flex h-11 items-center gap-2 whitespace-nowrap text-body transition-colors duration-150",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal",
                  on ? "font-medium text-ink" : "text-ink-3 hover:text-ink",
                )}
              >
                {s.label}
                {pendentes > 0 ? (
                  <span
                    className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-signal-strong px-1.5 text-[11px] leading-none font-semibold text-signal-on tabular-nums"
                    aria-label={`${pendentes} por tratar`}
                  >
                    {pendentes > 99 ? "99+" : pendentes}
                  </span>
                ) : s.contagem !== undefined && s.contagem > 0 ? (
                  <span className="text-meta text-ink-4 tabular-nums">{s.contagem}</span>
                ) : null}
                <span
                  aria-hidden
                  className={cx("absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-signal-ink transition-opacity duration-150", on ? "opacity-100" : "opacity-0")}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
