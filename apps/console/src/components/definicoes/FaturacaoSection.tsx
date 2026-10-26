import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { DataTable, Empty, Pill, cx, type Column, type Tone } from "@/components/primitives";
import { useBusy } from "@/components/Busy";
import { Bloco, Erro, Lista, campoClass } from "@/components/definicoes/ui";
import { ExternalLink, FileCheck, KeyRound } from "@/lib/icons";
import { money } from "@/lib/format";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/http";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";

/**
 * Faturação, nas Definições: o programa de faturação do clube, as regras de
 * IVA e as faturas que saem a cada pagamento.
 *
 * ## O que aqui se decide
 *
 * O clube liga o seu programa (InvoiceXpress, Moloni, Sage One, PHC GO ou
 * Vendus) e cada pagamento online passa a gerar uma fatura lá, com o PDF
 * enviado por email a quem pagou. A ligação só fica pronta quando o programa
 * tem tudo o que pede (a série, a empresa, o método) e o clube confirmou as
 * regras de IVA. Sem isso não sai fatura nenhuma, de propósito: o IVA de uma
 * quota é uma decisão do contabilista, e emitir com uma regra que ninguém
 * confirmou é passar faturas erradas em nome dele.
 *
 * ## Um passo de cada vez
 *
 * Não há uma lista de campos: há cartões, pela ordem que o programa pede, e
 * cada um diz se já está definido. A Moloni é o caso que obriga a esta ordem,
 * porque as séries e os métodos só existem depois de se escolher a empresa.
 *
 * Quem vê: quem configura o clube (`settings:write`) ou quem vê a cobrança
 * (`billing:read`). Repetir e reenviar faturas pede `billing:write`. O
 * servidor decide o mesmo em `/api/faturacao`.
 */

type Provider = "INVOICEXPRESS" | "MOLONI" | "SAGE_ONE" | "PHC_GO" | "VENDUS";
type Iva = 0 | 6 | 13 | 23;
type Regra = { iva: Iva; isencao?: string };

type Programa = { provider: Provider; nome: string; disponivel: boolean; comoLiga: "chave" | "oauth" };

type Definicoes = {
  serieId?: string;
  serieNome?: string;
  companyId?: string;
  companyNome?: string;
  paymentMethodId?: string;
  bankAccountId?: string;
  paymentTypeId?: string;
};

type Ligacao = {
  provider: Provider;
  nome: string;
  pronta: boolean;
  desde: string | null;
  porDefinir: string[];
  definicoes: Definicoes;
  regras: { confirmadas: boolean; porTipo: Partial<Record<string, Regra>> };
  sugeridas: Record<string, Regra>;
  tipos: { tipo: string; label: string; explicacao: string }[];
  erro: { mensagem: string; quando: string } | null;
};

type Estado = {
  programas: Programa[];
  ligacao: Ligacao | null;
  resumo: { porEmitir: number; falhadas: number; emitidasEsteMes: number };
};

type Opcao = { id: string; label: string; detalhe?: string; porOmissao?: boolean; aviso?: string };
type Opcoes = {
  series?: Opcao[];
  empresas?: Opcao[];
  metodosDePagamento?: Opcao[];
  contasBancarias?: Opcao[];
  tiposDePagamento?: Opcao[];
};

type EstadoDaFatura = "PENDING" | "ISSUED" | "SENT" | "FAILED" | "CANCELLED";
type Fatura = {
  id: string;
  status: EstadoDaFatura;
  programa: string;
  numero: string | null;
  atcud: string | null;
  permalink: string | null;
  cliente: { nome: string; nif: string | null; email: string | null };
  resumo: string;
  totalCents: number;
  metodo: string;
  pagoEm: string | null;
  referencia: string | null;
  enviadaPara: string | null;
  enviadaEm: string | null;
  tentativas: number;
  proximaTentativa: string | null;
  erro: string | null;
  criadaEm: string;
};

/* -------------------------------------------------------------------------- */
/* O que cada programa pede                                                    */
/* -------------------------------------------------------------------------- */

/** A frase do cartão de cada programa: o que o clube precisa de ter antes de ligar. */
const PRECISA: Record<Provider, string> = {
  INVOICEXPRESS: "Precisas do nome da conta e de uma chave da API.",
  MOLONI: "Precisas de uma conta Moloni com o plano Flex ou Pro.",
  SAGE_ONE: "Precisas de uma conta Sage One com o plano Standard.",
  PHC_GO: "Precisas do endereço da instalação e de um utilizador.",
  VENDUS: "Precisas da chave da API de um utilizador. Planos Flex ou Pro.",
};

/** Uma nota por baixo do cabeçalho da ligação, quando o programa tem uma particularidade. */
const NOTA: Partial<Record<Provider, string>> = {
  SAGE_ONE: "A Sage One não tem fatura-recibo: sai uma fatura e o recibo dela (dois documentos por pagamento). Precisa do plano Standard.",
};

/**
 * Um passo de configuração: a lista de opções que o programa dá (`lista`), o
 * campo onde a escolha fica (`campo`) e, quando o nome também se guarda, em
 * que campo (`nome`). `dependeDe` é o campo que tem de estar definido antes
 * (na Moloni, as séries só existem depois da empresa).
 */
type Passo = {
  lista: keyof Opcoes;
  campo: keyof Definicoes;
  nome?: "serieNome" | "companyNome";
  titulo: string;
  ajuda: string;
  obrigatorio: boolean;
  dependeDe?: keyof Definicoes;
};

const PASSOS: Record<Provider, Passo[]> = {
  INVOICEXPRESS: [
    { lista: "series", campo: "serieId", nome: "serieNome", titulo: "Série", ajuda: "A série em que as faturas saem. Sem escolher, vale a série por omissão da conta.", obrigatorio: false },
  ],
  MOLONI: [
    { lista: "empresas", campo: "companyId", nome: "companyNome", titulo: "Empresa", ajuda: "A empresa da Moloni em nome da qual saem as faturas. Escolhe primeiro: as séries e os métodos são dela.", obrigatorio: true },
    { lista: "series", campo: "serieId", nome: "serieNome", titulo: "Série", ajuda: "A série de fatura-recibo em que os documentos saem.", obrigatorio: true, dependeDe: "companyId" },
    { lista: "metodosDePagamento", campo: "paymentMethodId", titulo: "Método de pagamento", ajuda: "O método que fica registado em cada fatura-recibo.", obrigatorio: true, dependeDe: "companyId" },
  ],
  SAGE_ONE: [
    { lista: "contasBancarias", campo: "bankAccountId", titulo: "Conta bancária", ajuda: "A conta onde o recibo regista o pagamento.", obrigatorio: true },
    { lista: "tiposDePagamento", campo: "paymentTypeId", titulo: "Tipo de pagamento", ajuda: "O tipo de pagamento que fica no recibo.", obrigatorio: true },
  ],
  PHC_GO: [
    { lista: "series", campo: "serieId", nome: "serieNome", titulo: "Série de fatura-recibo", ajuda: "A série do PHC GO em que as faturas-recibo saem.", obrigatorio: true },
  ],
  VENDUS: [
    { lista: "series", campo: "serieId", nome: "serieNome", titulo: "Caixa", ajuda: "A caixa (registo) da Vendus por onde saem os documentos.", obrigatorio: true },
    { lista: "metodosDePagamento", campo: "paymentMethodId", titulo: "Método de pagamento", ajuda: "O método que fica registado em cada fatura-recibo.", obrigatorio: true },
  ],
};

const TAXAS: Iva[] = [0, 6, 13, 23];

/** Os motivos de isenção que os clubes usam. O contabilista do clube escolhe. Os mesmos códigos do servidor. */
const MOTIVOS: { codigo: string; label: string }[] = [
  { codigo: "M07", label: "M07 · Isento, artigo 9.º do CIVA (associações sem fins lucrativos, desporto)" },
  { codigo: "M10", label: "M10 · IVA, regime de isenção (artigo 53.º)" },
  { codigo: "M01", label: "M01 · Artigo 16.º n.º 6 do CIVA" },
  { codigo: "M04", label: "M04 · Isento, artigo 13.º do CIVA" },
  { codigo: "M05", label: "M05 · Isento, artigo 14.º do CIVA" },
  { codigo: "M06", label: "M06 · Isento, artigo 15.º do CIVA" },
  { codigo: "M09", label: "M09 · IVA, não confere direito a dedução" },
  { codigo: "M16", label: "M16 · Isento, artigo 14.º do RITI" },
  { codigo: "M99", label: "M99 · Não sujeito, não tributado" },
];

/** O filtro da lista de faturas e os estados que pede ao servidor (vários, separados por vírgula). */
const FILTROS: { key: string; label: string; estado?: string }[] = [
  { key: "todas", label: "Todas" },
  // Por emitir = ainda não chegou a quem pagou: por criar no programa, ou criada e com o email por sair.
  { key: "porEmitir", label: "Por emitir", estado: "PENDING,ISSUED" },
  { key: "falhadas", label: "Falhadas", estado: "FAILED" },
  { key: "enviadas", label: "Enviadas", estado: "SENT" },
];

const ESTADO_DA_FATURA: Record<EstadoDaFatura, { label: string; tone: Tone }> = {
  PENDING: { label: "Por emitir", tone: "warn" },
  ISSUED: { label: "Emitida", tone: "signal" },
  SENT: { label: "Enviada", tone: "ok" },
  FAILED: { label: "Falhou", tone: "risk" },
  CANCELLED: { label: "Anulada", tone: "neutral" },
};

const dataCurta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-PT") : "");
const dataEHora = (iso: string) => new Date(iso).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" });

/* -------------------------------------------------------------------------- */

export function FaturacaoSection() {
  const { session } = useSession();
  const mayWrite = can(session, "settings:write");
  const veFaturas = can(session, "billing:read");
  const mexeFaturas = can(session, "billing:write");

  const [estado, setEstado] = useState<Estado | null>(null);
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null);
  const [busy, setBusy] = useState(false);
  /** A mensagem de cima: o resultado da autorização, ou o que acabou de acontecer. */
  const [mensagem, setMensagem] = useState<{ tom: "ok" | "risk"; texto: string } | null>(null);

  const ligacao = estado?.ligacao ?? null;
  const provider = ligacao?.provider ?? null;

  /* A primeira leitura desfoca a página, como em toda a consola. As seguintes desfocam o que está a gravar. */
  useBusy(estado === null || busy);

  const carregar = useCallback(async () => {
    const e = await apiGet<Estado>("/api/faturacao");
    setEstado(e);
    return e;
  }, []);

  useEffect(() => {
    carregar().catch(() => setEstado((e) => e ?? { programas: [], ligacao: null, resumo: { porEmitir: 0, falhadas: 0, emitidasEsteMes: 0 } }));
  }, [carregar]);

  /*
   * As opções do programa (séries, empresas, métodos) pedem-se ao programa, e
   * só a quem pode configurar. Voltam a pedir-se quando a ligação muda, e na
   * Moloni quando a empresa muda, porque as séries são dela.
   */
  const companyId = ligacao?.definicoes.companyId;
  useEffect(() => {
    if (!mayWrite || !provider) {
      setOpcoes(null);
      return;
    }
    let vivo = true;
    apiGet<Opcoes>("/api/faturacao/opcoes")
      .then((o) => vivo && setOpcoes(o))
      .catch(() => vivo && setOpcoes({}));
    return () => {
      vivo = false;
    };
  }, [mayWrite, provider, companyId]);

  /*
   * O regresso da página do programa (Moloni, Sage One): `?oauth=ligado`,
   * `recusado` ou `erro`. Diz-se o que aconteceu e tira-se o parâmetro do
   * endereço, para um F5 não repetir a mensagem.
   */
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const oauth = params.get("oauth");
    if (!oauth) return;
    if (oauth === "ligado") setMensagem({ tom: "ok", texto: "O programa está ligado. Falta escolher o que ele pede e confirmar as regras de IVA." });
    else if (oauth === "recusado") setMensagem({ tom: "risk", texto: "O clube não autorizou." });
    else setMensagem({ tom: "risk", texto: "Não foi possível ligar. Tenta outra vez." });
    const limpo = new URLSearchParams(params);
    limpo.delete("oauth");
    setParams(limpo, { replace: true });
  }, [params, setParams]);

  /** Uma escrita de cada vez: desfoca, grava, e fica com o estado que o servidor devolve. */
  async function gravar(trabalho: () => Promise<Estado>) {
    setBusy(true);
    try {
      setEstado(await trabalho());
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function desligar() {
    if (!window.confirm("Desligar a faturação? As faturas já emitidas ficam. O clube deixa de vender bilhetes pagos e na loja do site até voltar a ligar.")) return;
    if (await gravar(() => apiDelete<Estado>("/api/faturacao"))) setMensagem({ tom: "ok", texto: "A faturação ficou desligada." });
  }

  if (!estado) return <div className="min-h-[420px]" aria-hidden />;

  return (
    <>
      {mensagem && (
        <div className="mb-2">
          {mensagem.tom === "ok" ? (
            <p role="status" className="rounded-[10px] bg-ok-soft px-3 py-2 text-meta text-ok">{mensagem.texto}</p>
          ) : (
            <Erro>{mensagem.texto}</Erro>
          )}
        </div>
      )}

      {!ligacao ? (
        <Bloco
          titulo="Programa de faturação"
          descricao={
            <>
              <p>O clube liga o programa que já usa. Cada pagamento online passa a gerar uma fatura nesse programa, com o PDF enviado por email a quem pagou.</p>
              <p>Mensalidades, cobranças avulsas, quotas de sócio, bilhetes e loja do site.</p>
            </>
          }
        >
          <Programas programas={estado.programas} mayWrite={mayWrite} onLigado={(e) => setEstado(e)} setBusy={setBusy} />
        </Bloco>
      ) : (
        <>
          <Bloco
            titulo="Programa de faturação"
            estado={ligacao.pronta ? <Pill tone="ok">pronta</Pill> : <Pill tone="warn">por completar</Pill>}
            descricao={<p>O programa ligado e o que ainda falta para as faturas saírem.</p>}
          >
            <CabecalhoDaLigacao ligacao={ligacao} mayWrite={mayWrite} busy={busy} onDesligar={() => void desligar()} />
          </Bloco>

          {mayWrite && PASSOS[ligacao.provider].length > 0 && (
            <Bloco
              titulo="No programa"
              descricao={<p>O que {ligacao.nome} pede para emitir. Cada escolha grava-se ao ser feita.</p>}
            >
              <Passos ligacao={ligacao} opcoes={opcoes} busy={busy} onGravar={(patch) => gravar(() => apiPatch<Estado>("/api/faturacao/definicoes", patch))} />
            </Bloco>
          )}

          <Bloco
            titulo="Regras de IVA"
            estado={ligacao.regras.confirmadas ? <Pill tone="ok">confirmadas</Pill> : <Pill tone="warn">por confirmar</Pill>}
            descricao={
              <>
                <p>O IVA de cada tipo de venda é uma decisão do contabilista do clube. Sem as regras confirmadas, não sai nenhuma fatura.</p>
                <p>A 0 %, a fatura leva o motivo de isenção escolhido.</p>
              </>
            }
          >
            <RegrasDeIva
              key={ligacao.provider}
              ligacao={ligacao}
              mayWrite={mayWrite}
              busy={busy}
              onGravar={(regras) => gravar(() => apiPatch<Estado>("/api/faturacao/definicoes", { regras }))}
            />
          </Bloco>
        </>
      )}

      {veFaturas && (
        <Bloco
          titulo="Faturas"
          descricao={<p>As faturas de cada pagamento online, com o estado de cada uma. Uma que falhe volta a tentar sozinha; aqui pode tentar-se já.</p>}
        >
          <Faturas resumo={estado.resumo} mexe={mexeFaturas} onMudou={() => void carregar().catch(() => undefined)} />
        </Bloco>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Sem ligação: um cartão por programa                                         */
/* -------------------------------------------------------------------------- */

function Programas({
  programas,
  mayWrite,
  onLigado,
  setBusy,
}: {
  programas: Programa[];
  mayWrite: boolean;
  onLigado: (e: Estado) => void;
  setBusy: (b: boolean) => void;
}) {
  const [escolhido, setEscolhido] = useState<Programa | null>(null);

  /** Por autorização: pede-se o endereço ao servidor e vai-se à página do programa. */
  async function autorizar(p: Programa) {
    setBusy(true);
    try {
      const { url } = await apiGet<{ url: string }>(`/api/faturacao/autorizar/${p.provider.toLowerCase()}`);
      window.location.assign(url);
    } catch {
      setBusy(false);
    }
  }

  return (
    <>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {programas.map((p) => {
          const on = escolhido?.provider === p.provider;
          return (
            <li
              key={p.provider}
              className={cx(
                "flex flex-col rounded-[12px] border px-4 py-3.5 transition-colors duration-[120ms]",
                on ? "border-ink-3 bg-surface" : p.disponivel ? "border-line bg-surface" : "border-dashed border-line-strong",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className={cx("text-body font-medium", p.disponivel ? "text-ink" : "text-ink-3")}>{p.nome}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-4">
                    {p.comoLiga === "chave" ? <KeyRound className="size-3" strokeWidth={1.75} /> : <ExternalLink className="size-3" strokeWidth={1.75} />}
                    {p.comoLiga === "chave" ? "liga com uma chave" : "liga com autorização"}
                  </div>
                </div>
              </div>
              <p className="mt-2 flex-1 text-meta leading-relaxed text-ink-3">{PRECISA[p.provider]}</p>
              <div className="mt-3">
                {!p.disponivel ? (
                  <span className="text-meta text-ink-4">Ainda não disponível</span>
                ) : !mayWrite ? null : on ? (
                  <button type="button" className="ctl-ghost" onClick={() => setEscolhido(null)}>
                    Cancelar
                  </button>
                ) : (
                  <button type="button" className="ctl-outline" onClick={() => setEscolhido(p)}>
                    Ligar
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {escolhido && (
        <div className="mt-3 rounded-[12px] border border-ink-3 bg-surface px-4 py-4">
          <div className="text-body font-medium text-ink">Ligar {escolhido.nome}</div>
          {escolhido.comoLiga === "oauth" ? (
            <>
              <p className="mt-1 max-w-[56ch] text-meta leading-relaxed text-ink-3">
                Vais à página do programa autorizar a ligação e voltas para aqui. {NOTA[escolhido.provider] ?? ""}
              </p>
              <button type="button" className="ctl-primary mt-3" onClick={() => void autorizar(escolhido)}>
                <ExternalLink className="size-3.5" strokeWidth={1.75} />
                Autorizar na página do programa
              </button>
            </>
          ) : (
            <FormularioDeChave provider={escolhido.provider} onLigado={onLigado} setBusy={setBusy} />
          )}
        </div>
      )}
    </>
  );
}

/** Os campos de cada programa que liga por chave, e onde o clube os vai buscar. */
const CAMPOS: Record<"INVOICEXPRESS" | "VENDUS" | "PHC_GO", { nome: string; rotulo: string; ajuda?: string; tipo?: "password" | "url"; opcional?: boolean }[]> = {
  INVOICEXPRESS: [
    { nome: "accountName", rotulo: "Nome da conta", ajuda: "O que vem antes de .app.invoicexpress.com no endereço da conta." },
    { nome: "apiKey", rotulo: "Chave da API", ajuda: "Em app.invoicexpress.com/users/api.", tipo: "password" },
  ],
  VENDUS: [{ nome: "apiKey", rotulo: "Chave da API", ajuda: "A chave de um utilizador, em Configuração › Utilizadores › API.", tipo: "password" }],
  PHC_GO: [
    { nome: "backendUrl", rotulo: "Endereço da instalação", ajuda: "Como https://sisNN.phcgo.net/nome.", tipo: "url" },
    { nome: "userCode", rotulo: "Utilizador" },
    { nome: "password", rotulo: "Palavra-passe", tipo: "password" },
    { nome: "company", rotulo: "Empresa", ajuda: "Só se a instalação tiver mais do que uma.", opcional: true },
  ],
};

const ROTA: Record<"INVOICEXPRESS" | "VENDUS" | "PHC_GO", string> = {
  INVOICEXPRESS: "/api/faturacao/invoicexpress",
  VENDUS: "/api/faturacao/vendus",
  PHC_GO: "/api/faturacao/phc-go",
};

function FormularioDeChave({ provider, onLigado, setBusy }: { provider: Provider; onLigado: (e: Estado) => void; setBusy: (b: boolean) => void }) {
  const chave = provider as keyof typeof CAMPOS;
  const campos = CAMPOS[chave] ?? [];
  const [valores, setValores] = useState<Record<string, string>>({});
  const [aLigar, setALigar] = useState(false);

  const completo = campos.every((c) => c.opcional || (valores[c.nome] ?? "").trim().length > 0);

  async function ligar(e: FormEvent) {
    e.preventDefault();
    if (!completo || aLigar) return;
    setALigar(true);
    setBusy(true);
    try {
      const corpo: Record<string, string> = {};
      for (const c of campos) {
        const v = (valores[c.nome] ?? "").trim();
        if (v) corpo[c.nome] = v;
      }
      onLigado(await apiPost<Estado>(ROTA[chave], corpo));
    } catch {
      /* O erro já está no cartão do canto, pelo `lib/http.ts`. */
    } finally {
      setALigar(false);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={ligar} className="mt-3 space-y-3">
      {provider === "PHC_GO" && (
        <p className="rounded-[10px] bg-sunken px-3 py-2 text-meta leading-relaxed text-ink-2">
          Antes de ligar, o clube regista a nossa aplicação no PHC GO, em «Aplicações externas licenciadas».
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {campos.map((c) => {
          const id = `fat-${provider.toLowerCase()}-${c.nome}`;
          return (
            <div key={c.nome} className={cx(c.nome === "backendUrl" && "sm:col-span-2")}>
              <label htmlFor={id} className="mb-1.5 block text-meta font-medium text-ink-2">
                {c.rotulo}
                {c.opcional && <span className="font-normal text-ink-4"> (opcional)</span>}
              </label>
              <input
                id={id}
                type={c.tipo ?? "text"}
                value={valores[c.nome] ?? ""}
                onChange={(e) => setValores((v) => ({ ...v, [c.nome]: e.target.value }))}
                autoComplete="off"
                spellCheck={false}
                className={campoClass}
              />
              {c.ajuda && <p className="mt-1.5 text-meta leading-relaxed text-ink-3">{c.ajuda}</p>}
            </div>
          );
        })}
      </div>
      <button type="submit" className="ctl-primary" disabled={!completo || aLigar}>
        <FileCheck className="size-3.5" strokeWidth={1.75} />
        Ligar e verificar
      </button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Com ligação: o cabeçalho                                                    */
/* -------------------------------------------------------------------------- */

function CabecalhoDaLigacao({ ligacao, mayWrite, busy, onDesligar }: { ligacao: Ligacao; mayWrite: boolean; busy: boolean; onDesligar: () => void }) {
  return (
    <div className="rounded-[12px] border border-line bg-surface px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-[10px]", ligacao.pronta ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")}>
            <FileCheck className="size-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <div className="text-body font-medium text-ink">{ligacao.nome}</div>
            {ligacao.pronta ? (
              <p className="mt-0.5 text-meta font-medium text-ok">Pronta: as faturas saem a cada pagamento.</p>
            ) : (
              <p className="mt-0.5 text-meta leading-relaxed text-ink-2">
                <span className="font-medium text-warn">Falta:</span> {ligacao.porDefinir.join(", ")}.
              </p>
            )}
            {ligacao.pronta && ligacao.desde && <p className="mt-0.5 text-meta text-ink-4">Desde {dataCurta(ligacao.desde)}.</p>}
            {NOTA[ligacao.provider] && <p className="mt-2 max-w-[56ch] text-meta leading-relaxed text-ink-3">{NOTA[ligacao.provider]}</p>}
          </div>
        </div>
        {mayWrite && (
          <button type="button" className="ctl-ghost text-ink-3 hover:text-risk" disabled={busy} onClick={onDesligar}>
            Desligar
          </button>
        )}
      </div>

      {ligacao.erro && (
        <p className="mt-3 border-t border-line pt-3 text-meta leading-relaxed text-risk">
          {ligacao.erro.mensagem} <span className="text-ink-4">({dataEHora(ligacao.erro.quando)})</span>
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Os passos de configuração                                                   */
/* -------------------------------------------------------------------------- */

function Passos({
  ligacao,
  opcoes,
  busy,
  onGravar,
}: {
  ligacao: Ligacao;
  opcoes: Opcoes | null;
  busy: boolean;
  onGravar: (patch: Partial<Definicoes>) => Promise<boolean>;
}) {
  const passos = PASSOS[ligacao.provider];
  const def = ligacao.definicoes;

  return (
    <ol className="space-y-2.5">
      {passos.map((p, i) => {
        const bloqueado = Boolean(p.dependeDe && !def[p.dependeDe]);
        const lista = opcoes?.[p.lista] ?? [];
        const guardado = def[p.campo] ?? "";
        const porOmissao = lista.find((o) => o.porOmissao)?.id ?? "";
        const valor = guardado || porOmissao;
        const escolhida = lista.find((o) => o.id === valor);
        const id = `fat-passo-${p.campo}`;

        const guardar = (novo: string) => {
          const opcao = lista.find((o) => o.id === novo);
          const patch: Partial<Definicoes> = {};
          patch[p.campo] = novo;
          if (p.nome) patch[p.nome] = opcao?.label ?? "";
          void onGravar(patch);
        };

        return (
          <li key={p.campo} className={cx("rounded-[12px] border px-4 py-3.5", bloqueado ? "border-dashed border-line-strong" : "border-line bg-surface")}>
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
              <div className="flex min-w-0 items-start gap-3">
                <span className={cx("flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold", guardado ? "bg-ok-soft text-ok" : "bg-sunken text-ink-3")}>
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <label htmlFor={id} className="block text-body font-medium text-ink">
                    {p.titulo}
                    {!p.obrigatorio && <span className="font-normal text-ink-4"> (opcional)</span>}
                  </label>
                  <p className="mt-0.5 max-w-[52ch] text-meta leading-relaxed text-ink-3">{p.ajuda}</p>
                </div>
              </div>
              {guardado ? <Pill tone="ok">definida</Pill> : bloqueado ? <Pill>depois do passo anterior</Pill> : p.obrigatorio ? <Pill tone="warn">por definir</Pill> : <Pill>por omissão</Pill>}
            </div>

            {!bloqueado && (
              <div className="mt-3 flex flex-wrap items-center gap-2 sm:pl-10">
                <select
                  id={id}
                  value={valor}
                  disabled={busy || lista.length === 0}
                  onChange={(e) => guardar(e.target.value)}
                  className={cx(campoClass, "sm:max-w-[360px]")}
                >
                  {!valor && <option value="">{lista.length === 0 ? (opcoes ? "O programa não devolveu opções" : "") : p.obrigatorio ? "Escolhe uma" : "A por omissão da conta"}</option>}
                  {valor && !escolhida && <option value={valor}>{(p.nome && def[p.nome]) || valor}</option>}
                  {lista.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                      {o.detalhe ? ` · ${o.detalhe}` : ""}
                    </option>
                  ))}
                </select>
                {/*
                  Sem nada guardado, a lista mostra a opção por omissão do programa
                  e um botão confirma-a: uma escolha pré-feita que ninguém gravou
                  ficava a parecer feita.
                */}
                {!guardado && valor && (
                  <button type="button" className="ctl-primary" disabled={busy} onClick={() => guardar(valor)}>
                    Usar esta
                  </button>
                )}
              </div>
            )}
            {!bloqueado && escolhida?.aviso && <p className="mt-1.5 text-meta leading-relaxed text-warn sm:pl-10">{escolhida.aviso}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* As regras de IVA                                                            */
/* -------------------------------------------------------------------------- */

function RegrasDeIva({
  ligacao,
  mayWrite,
  busy,
  onGravar,
}: {
  ligacao: Ligacao;
  mayWrite: boolean;
  busy: boolean;
  onGravar: (regras: { confirmadas: boolean; porTipo: Record<string, Regra> }) => Promise<boolean>;
}) {
  /* O ponto de partida: o que o clube já gravou, ou a sugestão. */
  const inicial = (): Record<string, Regra> => {
    const r: Record<string, Regra> = {};
    for (const t of ligacao.tipos) r[t.tipo] = ligacao.regras.porTipo[t.tipo] ?? ligacao.sugeridas[t.tipo] ?? { iva: 23 };
    return r;
  };
  const [porTipo, setPorTipo] = useState<Record<string, Regra>>(inicial);
  const [confirmadas, setConfirmadas] = useState(ligacao.regras.confirmadas);
  const [gravado, setGravado] = useState(false);

  const mudar = (tipo: string, patch: Partial<Regra>) => {
    setGravado(false);
    setPorTipo((r) => {
      const atual = r[tipo] ?? { iva: 23 };
      const nova: Regra = { ...atual, ...patch };
      if (nova.iva > 0) delete nova.isencao;
      else if (!nova.isencao) nova.isencao = "M07";
      return { ...r, [tipo]: nova };
    });
  };

  const semMotivo = ligacao.tipos.filter((t) => porTipo[t.tipo]?.iva === 0 && !porTipo[t.tipo]?.isencao);

  async function guardar() {
    if (await onGravar({ confirmadas, porTipo })) setGravado(true);
  }

  return (
    <div>
      <Lista>
        <ul>
          {ligacao.tipos.map((t) => {
            const r = porTipo[t.tipo] ?? { iva: 23 };
            const idIva = `fat-iva-${t.tipo}`;
            const idMotivo = `fat-isencao-${t.tipo}`;
            return (
              <li key={t.tipo} className="grid gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_120px_minmax(0,1.2fr)] md:items-center">
                <div className="min-w-0">
                  <label htmlFor={idIva} className="block text-body font-medium text-ink">
                    {t.label}
                  </label>
                  <p className="mt-0.5 text-meta leading-relaxed text-ink-3">{t.explicacao}</p>
                </div>
                <select
                  id={idIva}
                  value={r.iva}
                  disabled={!mayWrite || busy}
                  onChange={(e) => mudar(t.tipo, { iva: Number(e.target.value) as Iva })}
                  className={cx(campoClass, "h-9")}
                >
                  {TAXAS.map((x) => (
                    <option key={x} value={x}>
                      {x} %
                    </option>
                  ))}
                </select>
                {r.iva === 0 ? (
                  <div className="min-w-0">
                    <label htmlFor={idMotivo} className="sr-only">
                      Motivo de isenção de {t.label}
                    </label>
                    <select
                      id={idMotivo}
                      value={r.isencao ?? ""}
                      disabled={!mayWrite || busy}
                      onChange={(e) => mudar(t.tipo, { isencao: e.target.value })}
                      className={cx(campoClass, "h-9")}
                    >
                      {!r.isencao && <option value="">Motivo de isenção</option>}
                      {MOTIVOS.map((m) => (
                        <option key={m.codigo} value={m.codigo}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <span className="hidden text-meta text-ink-4 md:block">com IVA</span>
                )}
              </li>
            );
          })}
        </ul>
      </Lista>

      {mayWrite && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <input
              id="fat-regras-confirmadas"
              type="checkbox"
              checked={confirmadas}
              disabled={busy}
              onChange={(e) => {
                setGravado(false);
                setConfirmadas(e.target.checked);
              }}
              className="size-4 accent-[var(--color-signal)]"
            />
            <label htmlFor="fat-regras-confirmadas" className="text-meta text-ink-2 select-none">
              Confirmei estas regras com o contabilista do clube
            </label>
          </div>
          <div className="flex items-center gap-2">
            {gravado && <span className="text-meta text-ok">Guardadas</span>}
            <button type="button" className="ctl-primary" disabled={busy || semMotivo.length > 0} onClick={() => void guardar()}>
              Guardar regras
            </button>
          </div>
        </div>
      )}
      {semMotivo.length > 0 && <p className="mt-2 text-meta text-warn">Falta o motivo de isenção em: {semMotivo.map((t) => t.label).join(", ")}.</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* As faturas                                                                  */
/* -------------------------------------------------------------------------- */

function Faturas({ resumo, mexe, onMudou }: { resumo: Estado["resumo"]; mexe: boolean; onMudou: () => void }) {
  const [filtro, setFiltro] = useState("todas");
  const [faturas, setFaturas] = useState<Fatura[] | null>(null);
  const [aTratar, setATratar] = useState<string | null>(null);

  const carregar = useCallback(async (f: string) => {
    const estado = FILTROS.find((x) => x.key === f)?.estado;
    const lista = await apiGet<Fatura[]>("/api/faturacao/faturas", { estado, take: "100" });
    setFaturas(lista);
  }, []);

  useEffect(() => {
    carregar(filtro).catch(() => setFaturas((f) => f ?? []));
  }, [carregar, filtro]);

  async function repetir(f: Fatura) {
    setATratar(f.id);
    try {
      const nova = await apiPost<Fatura>(`/api/faturacao/faturas/${f.id}/repetir`, {});
      setFaturas((lista) => (lista ?? []).map((x) => (x.id === nova.id ? nova : x)));
      onMudou();
    } catch {
      /* já no cartão de erro */
    } finally {
      setATratar(null);
    }
  }

  /*
   * Reenviar pede um email, com o de quem pagou já escrito: Escape cancela,
   * apagar o texto manda para o email de sempre.
   */
  async function reenviar(f: Fatura) {
    const sugerido = f.enviadaPara ?? f.cliente.email ?? "";
    const email = window.prompt("Reenviar a fatura para que email?", sugerido);
    if (email === null) return;
    setATratar(f.id);
    try {
      await apiPost(`/api/faturacao/faturas/${f.id}/reenviar`, email.trim() ? { email: email.trim() } : {});
      await carregar(filtro);
      onMudou();
    } catch {
      /* já no cartão de erro */
    } finally {
      setATratar(null);
    }
  }

  const colunas: Column<Fatura>[] = [
    { key: "data", header: "Pago em", width: "110px", render: (f) => <span className="tabular text-ink-2">{dataCurta(f.pagoEm ?? f.criadaEm)}</span> },
    {
      key: "cliente",
      header: "Cliente",
      primary: true,
      render: (f) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{f.cliente.nome}</div>
          {f.cliente.nif && <div className="text-meta tabular text-ink-3">NIF {f.cliente.nif}</div>}
        </div>
      ),
    },
    {
      key: "resumo",
      header: "O que é",
      hideBelow: "md",
      render: (f) => (
        <div className="min-w-0">
          <div className="truncate text-ink-2" title={f.resumo}>{f.resumo}</div>
          <div className="text-meta text-ink-4">{f.metodo}</div>
        </div>
      ),
    },
    { key: "total", header: "Total", align: "right", width: "100px", render: (f) => <span className="tabular text-ink">{money(f.totalCents)}</span> },
    {
      key: "numero",
      header: "Número",
      hideBelow: "lg",
      render: (f) =>
        f.numero ? (
          f.permalink ? (
            <a href={f.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink-2 hover:text-ink hover:underline" onClick={(e) => e.stopPropagation()}>
              {f.numero}
              <ExternalLink className="size-3 text-ink-4" strokeWidth={1.75} />
            </a>
          ) : (
            <span className="text-ink-2">{f.numero}</span>
          )
        ) : (
          <span className="text-ink-4">sem número</span>
        ),
    },
    {
      key: "estado",
      header: "Estado",
      render: (f) => {
        const e = ESTADO_DA_FATURA[f.status];
        return (
          <div className="min-w-0">
            <Pill tone={e.tone}>{e.label}</Pill>
            {f.status === "FAILED" && f.erro && <p className="mt-1 max-w-[36ch] text-meta leading-relaxed text-risk">{f.erro}</p>}
            {f.status === "SENT" && f.enviadaPara && <p className="mt-1 text-meta text-ink-4">para {f.enviadaPara}</p>}
          </div>
        );
      },
    },
    ...(mexe
      ? [
          {
            key: "acoes",
            header: "",
            align: "right" as const,
            render: (f: Fatura) => {
              const ocupada = aTratar === f.id;
              if (f.status === "FAILED" || f.status === "PENDING")
                return (
                  <button type="button" className="ctl-outline" disabled={ocupada} onClick={() => void repetir(f)}>
                    Tentar outra vez
                  </button>
                );
              if (f.status === "ISSUED" || f.status === "SENT")
                return (
                  <button type="button" className="ctl-ghost" disabled={ocupada} onClick={() => void reenviar(f)}>
                    Reenviar
                  </button>
                );
              return null;
            },
          },
        ]
      : []),
  ];

  return (
    <div>
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[12px] border border-line bg-line">
        <Numero valor={String(resumo.emitidasEsteMes)} rotulo="emitidas este mês" />
        <Numero valor={String(resumo.porEmitir)} rotulo="por emitir" tom={resumo.porEmitir > 0 ? "warn" : undefined} />
        <Numero valor={String(resumo.falhadas)} rotulo="falhadas" tom={resumo.falhadas > 0 ? "risk" : undefined} />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar faturas por estado">
        {FILTROS.map((f) => {
          const on = f.key === filtro;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={on}
              onClick={() => setFiltro(f.key)}
              className={cx(
                "h-8 rounded-full border px-3 text-meta font-medium transition-colors duration-[120ms]",
                on ? "border-signal/30 bg-signal-soft text-signal-ink" : "border-line text-ink-2 hover:text-ink",
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3">
        <Lista>
          {faturas === null ? (
            <div className="min-h-[120px]" aria-hidden />
          ) : (
            <DataTable
              columns={colunas}
              rows={faturas}
              keyOf={(f) => f.id}
              empty={<Empty compact icon={FileCheck} title={filtro === "todas" ? "Ainda sem faturas" : "Nada neste estado"} detail={filtro === "todas" ? "A primeira sai com o próximo pagamento online, assim que a ligação estiver pronta." : undefined} />}
            />
          )}
        </Lista>
      </div>
    </div>
  );
}

function Numero({ valor, rotulo, tom }: { valor: string; rotulo: ReactNode; tom?: "warn" | "risk" }) {
  return (
    <div className="bg-surface px-4 py-3.5">
      <div className={cx("text-[22px] font-semibold leading-none tracking-[-0.01em] tabular", tom === "risk" ? "text-risk" : tom === "warn" ? "text-warn" : "text-ink")}>{valor}</div>
      <div className="mt-1.5 text-meta text-ink-3">{rotulo}</div>
    </div>
  );
}
