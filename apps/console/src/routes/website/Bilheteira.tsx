import { useState } from "react";
import { LugarAnual as IconeLugarAnual, MapPin, Pencil, Receipt, Recinto as IconeRecinto, SlidersHorizontal, Ticket } from "@/lib/icons";
import { Empty, cx } from "@/components/primitives";
import { Segmented } from "@/components/filters";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { Interruptor } from "@/components/definicoes/ui";
import { MapaDoRecinto } from "@academia/ui/estadio";
import { useStore, type ApiMatch } from "@/lib/store";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { guardarBilheteira, motivoSemVendas, useSite, type BilheteiraDoJogo, type CategoriaDeSocio, type Recinto, type TipoDeBilhete } from "@/lib/website";
import { mostrarOk } from "@/lib/avisos";
import { euro, quando } from "@/lib/bilheteira";
import { GrelhaDePrecos, LegendaDaGrelha, PrecosPorOmissao, colunasDe, contarPrecos, grelhaDe, grelhaValida, linhasDe, tiposDe, type Grelha } from "./PrecosDaBilheteira";
import { VendasDoJogo } from "./VendasDoJogo";
import { LugaresAnuais } from "./LugaresAnuais";


/** Quantos dias depois do jogo a bilheteira ainda aparece: os reembolsos e as contas fazem-se depois. */
const DIAS_DEPOIS = 30;

/**
 * Uma bilheteira por gravar. Sem preços: ao abrir o editor, a grelha começa
 * nos preços por omissão do recinto (e o servidor copia-os se lhe chegar uma
 * lista vazia).
 */
function padrao(recinto: Recinto | null, emCasa: boolean): BilheteiraDoJogo {
  return {
    aberta: false,
    recintoId: recinto?.id ?? null,
    lotacao: null,
    // Os lugares anuais só valem no recinto do clube: fora, o cartão de sócio não abre a porta.
    nota: emCasa ? "Sócios com quota em dia entram com o cartão na app." : "",
    tipos: [],
    sociosDesde: null,
    publicoDesde: null,
    soSocios: false,
    fechaEm: null,
  };
}

/**
 * A bilheteira: os jogos que aí vêm, os da plataforma (os mesmos do
 * calendário). Para cada um, abrir a venda, os preços por bancada e público,
 * quem pode comprar e quando, e as vendas.
 *
 * Em casa e fora: num jogo fora, o clube vende os bilhetes que tem para os
 * seus adeptos, num recinto desenhado no Estádio (a bancada dos visitantes).
 * Os jogos dos últimos trinta dias com bilheteira continuam na lista, só com
 * as vendas: é depois do jogo que se fazem os reembolsos e as contas.
 *
 * Ao lado, os lugares anuais dos sócios (contam na lotação de todos os jogos
 * da época), e à direita os preços por omissão.
 */
export function Bilheteira({ onIrParaEstadio }: { onIrParaEstadio: () => void }) {
  const store = useStore();
  const { session } = useSession();
  const site = useSite(store.academy.slug);
  const [vista, setVista] = useState<"jogos" | "anuais">("jogos");
  const [precos, setPrecos] = useState(false);
  const podeEscrever = can(session, "website:write");
  const verSocios = can(session, "member:read");

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {verSocios ? (
          <Segmented
            value={vista}
            onChange={setVista}
            label="Vistas da bilheteira"
            options={[
              { value: "jogos" as const, label: "Jogos", icon: Ticket },
              { value: "anuais" as const, label: "Lugares anuais", icon: IconeLugarAnual },
            ]}
          />
        ) : (
          <span />
        )}
        {podeEscrever && (
          <button type="button" className="ctl-outline" onClick={() => setPrecos(true)}>
            <SlidersHorizontal className="size-4" strokeWidth={1.75} />
            Preços por omissão
          </button>
        )}
      </div>

      {vista === "anuais" && verSocios ? <LugaresAnuais recintos={site.recintos} /> : <Jogos onIrParaEstadio={onIrParaEstadio} podeEscrever={podeEscrever} />}

      {precos && (
        <PrecosPorOmissao
          recintos={site.recintos}
          precos={site.precosBilheteira}
          categorias={site.categoriasDeSocio}
          onClose={() => setPrecos(false)}
          onIrParaEstadio={onIrParaEstadio}
        />
      )}
    </>
  );
}

function Jogos({ onIrParaEstadio, podeEscrever }: { onIrParaEstadio: () => void; podeEscrever: boolean }) {
  const store = useStore();
  const site = useSite(store.academy.slug);
  const [editar, setEditar] = useState<ApiMatch | null>(null);
  const [vendas, setVendas] = useState<ApiMatch | null>(null);

  const agora = Date.now();
  const de = (id: string) => site.bilheteira[id];
  const todos = [...store.matches].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const futuros = todos.filter((m) => m.status !== "CANCELLED" && new Date(m.startsAt).getTime() >= agora);
  const passados = todos
    .filter((m) => de(m.id) && !futuros.includes(m) && new Date(m.startsAt).getTime() >= agora - DIAS_DEPOIS * 86_400_000)
    .reverse();

  /**
   * O interruptor da lista abre e fecha uma venda já preparada. Um jogo sem
   * bilheteira, ou sem recinto (os bilhetes sem bancada não se vendem), abre o
   * editor: há preços e um recinto a escolher antes.
   */
  const alternar = (m: ApiMatch) => {
    const atual = de(m.id);
    if (!atual || !atual.recintoId || atual.tipos.length === 0) return setEditar(m);
    void guardarBilheteira(m.id, { ...atual, aberta: !atual.aberta }).catch(() => undefined);
  };

  if (futuros.length === 0 && passados.length === 0) {
    return <Empty icon={Ticket} title="Não há jogos marcados" detail="Os jogos do calendário aparecem aqui para abrir a venda de bilhetes." />;
  }

  const linha = (m: ApiMatch, passado: boolean) => {
    const b = de(m.id);
    const desde = b?.tipos.length ? Math.min(...b.tipos.map((t) => t.preco)) : null;
    const recinto = site.recintos.find((r) => r.id === b?.recintoId);
    const fase = !b?.aberta
      ? null
      : b.soSocios
        ? "só sócios"
        : b.publicoDesde && new Date(b.publicoDesde).getTime() > agora
          ? `sócios primeiro, público a ${quando(b.publicoDesde)}`
          : null;
    return (
      <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-b-0">
        <div className="min-w-0 flex-1">
          <p className="text-meta text-ink-3">
            {m.teamName}
            {m.competition && ` · ${m.competition.label}`}
          </p>
          <p className="flex min-w-0 items-center gap-2 text-body font-medium text-ink">
            <span className="truncate">
              {m.isHome ? store.academy.shortName : m.opponent} <span className="text-ink-4">vs</span> {m.isHome ? m.opponent : store.academy.shortName}
            </span>
            {!m.isHome && <span className="shrink-0 rounded-[4px] bg-sunken px-1.5 py-px text-[11px] font-medium text-ink-3">Fora</span>}
          </p>
          <p className="flex items-center gap-1 text-meta text-ink-3">
            <span className="capitalize">{quando(m.startsAt)}</span>
            <span aria-hidden>·</span>
            <MapPin className="size-3" strokeWidth={1.75} />
            <span className="truncate">{recinto?.nome ?? m.venue}</span>
          </p>
        </div>
        {passado ? (
          <span className="text-meta text-ink-4">{m.status === "CANCELLED" ? "Cancelado" : "Já jogado"}</span>
        ) : (
          <>
            <span className={cx("text-meta tabular-nums", b?.aberta ? "text-ok" : "text-ink-4")}>
              {b?.aberta ? (desde != null ? `À venda, desde ${euro(desde)}` : "À venda") : "Sem venda"}
              {fase && <span className="block text-ink-3">{fase}</span>}
            </span>
            {podeEscrever && <Interruptor ligado={!!b?.aberta} onChange={() => alternar(m)} label={`Bilhetes para ${m.opponent}`} />}
            {podeEscrever && (
              <button type="button" className="ctl-outline" onClick={() => setEditar(m)}>
                <Pencil className="size-4" strokeWidth={1.75} />
                Bilhetes
              </button>
            )}
          </>
        )}
        {b && (
          <button type="button" className="ctl-outline" onClick={() => setVendas(m)}>
            <Receipt className="size-4" strokeWidth={1.75} />
            Vendas
          </button>
        )}
      </li>
    );
  };

  return (
    <>
      {/* Sem pagamentos ou sem faturação, o site só vende bilhetes a 0 €. */}
      {motivoSemVendas(site) && (
        <p className="mb-4 rounded-[10px] border border-warn/25 bg-warn-soft px-4 py-3 text-meta leading-relaxed text-warn">
          <strong className="font-semibold">O site ainda não vende bilhetes pagos.</strong> {motivoSemVendas(site)} Os bilhetes a 0 € vendem-se na mesma.
        </p>
      )}

      {site.recintos.length === 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line bg-sunken/50 px-4 py-3">
          <p className="text-meta text-ink-2">Os bilhetes vendem-se por bancada. Desenha o estádio para cada bilhete ficar ligado a uma bancada, e quem compra ver no mapa onde vai ficar.</p>
          <button type="button" className="ctl-outline" onClick={onIrParaEstadio}>
            <IconeRecinto className="size-4" strokeWidth={1.75} />
            Desenhar o estádio
          </button>
        </div>
      )}

      {futuros.length > 0 ? (
        <ul className="overflow-hidden rounded-[12px] border border-line bg-surface">{futuros.map((m) => linha(m, false))}</ul>
      ) : (
        <Empty icon={Ticket} title="Não há jogos marcados" detail="Os jogos do calendário aparecem aqui para abrir a venda de bilhetes." compact />
      )}

      {passados.length > 0 && (
        <>
          <p className="mb-1.5 mt-6 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-4">Últimos {DIAS_DEPOIS} dias</p>
          <ul className="overflow-hidden rounded-[12px] border border-line bg-surface">{passados.map((m) => linha(m, true))}</ul>
        </>
      )}

      {editar && (
        <EditarBilheteira
          jogo={editar}
          nomeCurto={store.academy.shortName}
          recintos={site.recintos}
          precos={site.precosBilheteira}
          categorias={site.categoriasDeSocio}
          semVendas={motivoSemVendas(site)}
          inicial={de(editar.id) ?? padrao(site.recintos[0] ?? null, editar.isHome)}
          onIrParaEstadio={onIrParaEstadio}
          onClose={() => setEditar(null)}
          onGuardar={async (b) => {
            await guardarBilheteira(editar.id, b);
            mostrarOk(b.aberta ? "Bilheteira aberta." : "Bilheteira guardada.");
            setEditar(null);
          }}
        />
      )}

      {vendas && <VendasDoJogo jogo={vendas} nomeCurto={store.academy.shortName} recintos={site.recintos} podeEscrever={podeEscrever} onClose={() => setVendas(null)} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* O editor da bilheteira de um jogo                                            */
/* -------------------------------------------------------------------------- */

/** Quem pode comprar: todos ao mesmo tempo, só os sócios, ou os sócios antes do público. */
type Modo = "todos" | "socios" | "primeiro";

function modoDe(b: BilheteiraDoJogo): Modo {
  if (b.soSocios) return "socios";
  if (b.publicoDesde && b.publicoDesde !== b.sociosDesde) return "primeiro";
  return "todos";
}

/**
 * ISO ↔ o valor de um `<input type="datetime-local">`, na hora do browser.
 * A consola usa-se em Portugal; a API guarda em UTC e o site mostra em Lisboa.
 */
const paraCampo = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const doCampo = (v: string) => (v ? new Date(v).toISOString() : null);

function EditarBilheteira({
  jogo,
  nomeCurto,
  recintos,
  precos,
  categorias,
  semVendas,
  inicial,
  onIrParaEstadio,
  onClose,
  onGuardar,
}: {
  jogo: ApiMatch;
  nomeCurto: string;
  recintos: Recinto[];
  precos: Record<string, TipoDeBilhete[]>;
  categorias: CategoriaDeSocio[];
  /** Porque é que só se vendem bilhetes a 0 € (pagamentos ou faturação por ligar), ou nulo. */
  semVendas: string | null;
  inicial: BilheteiraDoJogo;
  onIrParaEstadio: () => void;
  onClose: () => void;
  onGuardar: (b: BilheteiraDoJogo) => Promise<void>;
}) {
  // Os bilhetes vendem-se por bancada: sem recinto não há venda, por isso um jogo sem ele fica já com o primeiro.
  const recintoInicial = recintos.find((r) => r.id === inicial.recintoId) ?? recintos[0] ?? null;
  // Um jogo ainda sem preços começa nos preços por omissão do recinto.
  const tiposIniciais = inicial.tipos.length || !recintoInicial ? inicial.tipos : (precos[recintoInicial.id] ?? []);

  const [b, setB] = useState<BilheteiraDoJogo>({ ...inicial, recintoId: recintoInicial?.id ?? null });
  const [base, setBase] = useState<TipoDeBilhete[]>(tiposIniciais);
  const [inicio] = useState(() => grelhaDe(tiposIniciais, linhasDe(recintoInicial), colunasDe(categorias, tiposIniciais)));
  const [grelha, setGrelha] = useState<Grelha>(inicio.grelha);
  const [fora, setFora] = useState(inicio.foraDaGrelha);
  const [lotacao, setLotacao] = useState(inicial.lotacao ? String(inicial.lotacao) : "");
  const [bancadaVista, setBancadaVista] = useState<string | null>(null);

  const [modo, setModo] = useState<Modo>(modoDe(inicial));
  const [abre, setAbre] = useState(paraCampo(inicial.sociosDesde ?? inicial.publicoDesde));
  const [sociosDesde, setSociosDesde] = useState(paraCampo(inicial.sociosDesde));
  const [publicoDesde, setPublicoDesde] = useState(paraCampo(inicial.publicoDesde));
  const [fechaEm, setFechaEm] = useState(paraCampo(inicial.fechaEm));

  const recinto = recintos.find((r) => r.id === b.recintoId) ?? null;
  const confronto = jogo.isHome ? `${nomeCurto} vs ${jogo.opponent}` : `${jogo.opponent} vs ${nomeCurto}`;
  const linhas = linhasDe(recinto);
  const colunas = colunasDe(categorias, base);
  const nPrecos = contarPrecos(grelha);
  const precosOk = grelhaValida(grelha) && nPrecos > 0;
  const lotacaoOk = !lotacao.trim() || (/^\d+$/.test(lotacao.trim()) && Number(lotacao) > 0 && Number(lotacao) <= 200_000);

  // As fases: só as datas que o modo usa, e pela ordem certa.
  const t = (v: string) => (v ? new Date(v).getTime() : null);
  const erroDasFases =
    modo === "primeiro" && !publicoDesde
      ? "Diz quando a venda abre ao público."
      : modo === "primeiro" && sociosDesde && publicoDesde && t(sociosDesde)! >= t(publicoDesde)!
        ? "Os sócios têm de começar antes do público."
        : fechaEm && t(fechaEm)! <= (t(modo === "todos" ? abre : sociosDesde) ?? 0)
          ? "A venda tem de fechar depois de abrir."
          : null;

  /** O preço mais baixo de cada bancada, para o mapa. */
  const desdeNaBancada = (id: string) => {
    const ps = tiposDe(grelha, linhas, colunas)
      .filter((x) => x.bancadaId === id)
      .map((x) => x.preco);
    return ps.length ? Math.min(...ps) : null;
  };

  const trocarRecinto = (id: string) => {
    const novo = recintos.find((r) => r.id === id) ?? null;
    // As bancadas são do recinto: ao mudar, a grelha recomeça nos preços por omissão do novo.
    const tipos = novo ? (precos[novo.id] ?? []) : [];
    setB({ ...b, recintoId: novo?.id ?? null });
    setBase(tipos);
    setGrelha(grelhaDe(tipos, linhasDe(novo), colunasDe(categorias, tipos)).grelha);
    setFora(0);
    setBancadaVista(null);
  };

  const guardar = () => {
    const fases =
      modo === "todos"
        ? { soSocios: false, sociosDesde: doCampo(abre), publicoDesde: doCampo(abre) }
        : modo === "socios"
          ? { soSocios: true, sociosDesde: doCampo(sociosDesde), publicoDesde: null }
          : { soSocios: false, sociosDesde: doCampo(sociosDesde), publicoDesde: doCampo(publicoDesde) };
    // Se o servidor recusar (pagamentos por ligar, por exemplo), o erro aparece no cartão de erros e o diálogo fica aberto.
    void onGuardar({
      ...b,
      ...fases,
      fechaEm: doCampo(fechaEm),
      lotacao: lotacao.trim() ? Number(lotacao) : null,
      nota: b.nota.trim(),
      tipos: tiposDe(grelha, linhas, colunas),
    }).catch(() => undefined);
  };

  if (recintos.length === 0) {
    return (
      <Dialog title="Bilhetes" subtitle={`${confronto} · ${quando(jogo.startsAt)}`} icon={<Ticket className="size-4" strokeWidth={1.75} />} onClose={onClose}>
        <Empty icon={IconeRecinto} title="Falta o estádio" detail="Os bilhetes vendem-se por bancada. Desenha primeiro o recinto, com as bancadas e os lugares de cada uma." compact>
          <button
            type="button"
            className="ctl-primary"
            onClick={() => {
              onClose();
              onIrParaEstadio();
            }}
          >
            Desenhar o estádio
          </button>
        </Empty>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Bilhetes"
      subtitle={`${confronto} · ${quando(jogo.startsAt)}`}
      icon={<Ticket className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={860}
      footer={
        <>
          {!precosOk && <span className="mr-auto text-meta text-ink-3">{nPrecos === 0 ? "Escreve pelo menos um preço." : "Há preços escritos mal."}</span>}
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" disabled={!precosOk || !lotacaoOk || !!erroDasFases || !recinto} onClick={guardar}>
            Guardar
          </button>
        </>
      }
    >
      <div className="space-y-5 px-5 py-4">
        <div className="rounded-[8px] border border-line px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-body text-ink">Venda aberta</span>
            <Interruptor ligado={b.aberta} onChange={() => setB({ ...b, aberta: !b.aberta })} label="Venda aberta" />
          </div>
          {semVendas && (
            <p className="mt-1.5 text-meta leading-relaxed text-warn">
              Por agora só abre uma venda em que todos os bilhetes custam 0 €. {semVendas}
            </p>
          )}
        </div>

        <DialogField label="Recinto" hint="As linhas da grelha são as bancadas deste recinto.">
          <select className={dialogInputClass} value={b.recintoId ?? ""} onChange={(e) => trocarRecinto(e.target.value)}>
            {recintos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
          </select>
        </DialogField>
        {!jogo.isHome && (
          <div className="-mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[8px] bg-sunken/60 px-3 py-2.5">
            <p className="min-w-0 flex-1 text-meta leading-relaxed text-ink-2">
              Jogo fora. Para vender os bilhetes que o {jogo.opponent} te cede, desenha no Estádio o recinto deles com a bancada dos visitantes, e escolhe-o aqui. Os lugares anuais não contam fora.
            </p>
            <button
              type="button"
              className="ctl-outline"
              onClick={() => {
                onClose();
                onIrParaEstadio();
              }}
            >
              <IconeRecinto className="size-4" strokeWidth={1.75} />
              Desenhar recinto
            </button>
          </div>
        )}

        {recinto && recinto.bancadas.length > 0 && (
          <div>
            <p className="mb-1.5 text-meta font-medium text-ink-2">Como quem compra vai ver</p>
            <div className="rounded-[10px] border border-line bg-surface p-2">
              <MapaDoRecinto
                recinto={recinto}
                className="w-full"
                selecionada={bancadaVista}
                onEscolher={(id) => setBancadaVista(id === bancadaVista ? null : id)}
                estado={(x) => (desdeNaBancada(x.id) != null ? "ativa" : "inativa")}
                rotulo={(x) => {
                  const d = desdeNaBancada(x.id);
                  return d != null ? `desde ${euro(d)}` : "sem bilhetes";
                }}
              />
            </div>
            <p className="mt-1.5 text-meta text-ink-3">As bancadas a cinzento não têm bilhetes neste jogo e não se escolhem.</p>
          </div>
        )}

        <div>
          <p className="mb-1.5 text-meta font-medium text-ink-2">Preços</p>
          {recinto && recinto.bancadas.length === 0 ? (
            <p className="rounded-[10px] border border-dashed border-line-strong px-4 py-6 text-center text-meta text-ink-3">
              {recinto.nome} ainda não tem bancadas. Acrescenta-as no Estádio.
            </p>
          ) : (
            <>
              <GrelhaDePrecos linhas={linhas} colunas={colunas} grelha={grelha} onChange={setGrelha} realce={bancadaVista} />
              <LegendaDaGrelha />
            </>
          )}
          {fora > 0 && (
            <p className="mt-1.5 rounded-[8px] bg-warn-soft px-3 py-2 text-meta leading-relaxed text-warn">
              {fora === 1 ? "Um tipo de bilhete deste jogo não cabe" : `${fora} tipos de bilhete deste jogo não cabem`} na grelha (outro preço para o mesmo público na
              mesma bancada, ou sem bancada). Ao guardar, {fora === 1 ? "sai" : "saem"}.
            </p>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-meta font-medium text-ink-2">Quem pode comprar</p>
          <div className="grid gap-1.5 sm:grid-cols-3" role="radiogroup" aria-label="Quem pode comprar">
            {(
              [
                { k: "todos", t: "Todos", d: "Sócios e público ao mesmo tempo." },
                { k: "socios", t: "Só sócios", d: "O público não compra." },
                { k: "primeiro", t: "Sócios primeiro", d: "O público só a partir de uma data." },
              ] as const
            ).map((o) => (
              <button
                key={o.k}
                type="button"
                role="radio"
                aria-checked={modo === o.k}
                onClick={() => setModo(o.k)}
                className={cx(
                  "rounded-[8px] border px-3 py-2 text-left transition-colors",
                  modo === o.k ? "border-signal/30 bg-signal-soft" : "border-line hover:border-line-strong",
                )}
              >
                <span className={cx("block text-body font-medium", modo === o.k ? "text-signal-ink" : "text-ink")}>{o.t}</span>
                <span className="block text-meta text-ink-3">{o.d}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {modo === "todos" ? (
              <DialogField label="Abre em" hint="Vazio = abre já, quando ligares a venda.">
                <input type="datetime-local" className={dialogInputClass} value={abre} onChange={(e) => setAbre(e.target.value)} />
              </DialogField>
            ) : (
              <DialogField label="Sócios a partir de" hint="Vazio = os sócios compram desde que a venda abre.">
                <input type="datetime-local" className={dialogInputClass} value={sociosDesde} onChange={(e) => setSociosDesde(e.target.value)} />
              </DialogField>
            )}
            {modo === "primeiro" && (
              <DialogField label="Abre ao público em">
                <input
                  type="datetime-local"
                  className={cx(dialogInputClass, !publicoDesde && "border-warn")}
                  value={publicoDesde}
                  onChange={(e) => setPublicoDesde(e.target.value)}
                />
              </DialogField>
            )}
            <DialogField label="Fecha em" hint="Vazio = fecha à hora do jogo. Nunca fecha depois do início.">
              <input type="datetime-local" className={dialogInputClass} value={fechaEm} onChange={(e) => setFechaEm(e.target.value)} />
            </DialogField>
          </div>
          {erroDasFases && <p className="mt-1.5 text-meta text-risk">{erroDasFases}</p>}
        </div>

        <DialogField label="Lotação do jogo" hint="Vazio = a soma das bancadas. Cada bancada fecha sozinha quando esgota, e os lugares anuais dos sócios já estão descontados.">
          <input className={cx(dialogInputClass, !lotacaoOk && "border-risk")} inputMode="numeric" value={lotacao} onChange={(e) => setLotacao(e.target.value)} />
        </DialogField>
        <DialogField label="Nota para quem compra" hint="Aparece ao lado dos bilhetes.">
          <textarea className={cx(dialogInputClass, "h-20 py-2")} maxLength={500} value={b.nota} onChange={(e) => setB({ ...b, nota: e.target.value })} />
        </DialogField>
      </div>
    </Dialog>
  );
}
