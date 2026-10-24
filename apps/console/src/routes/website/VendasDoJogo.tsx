import { useCallback, useEffect, useState } from "react";
import { Ban, Copy, KeyRound, Plus, Porta as IconePorta, Receipt, Send, Trash2, Undo2 } from "@/lib/icons";
import { Empty, Loading, Pill, cx, type Tone } from "@/components/primitives";
import { Segmented } from "@/components/filters";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { money } from "@/lib/format";
import { mostrarErro, mostrarOk } from "@/lib/avisos";
import { qrPng } from "@/lib/qr-cartaz";
import { useStore, type ApiMatch } from "@/lib/store";
import { carregarSite, type Recinto } from "@/lib/website";
import {
  ESTADO_DA_COMPRA,
  TODAS_AS_PORTAS,
  anularCompra,
  cancelarVendasDoJogo,
  criarAcesso,
  marcarReembolsado,
  portasDoJogo,
  reenviarBilhetes,
  quando,
  revogarAcesso,
  vendasDoJogo,
  type AcessoCriado,
  type AcessoDaPorta,
  type CompraDoJogo,
  type EstadoDaCompra,
  type PortasDoJogo,
  type VendasDoJogo as Vendas,
} from "@/lib/bilheteira";

const TOM: Record<EstadoDaCompra, Tone> = { PAID: "ok", RESERVED: "warn", LATE_PAYMENT: "risk", CANCELLED: "neutral" };

const data = (iso: string) => new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Lisbon" }).format(new Date(iso));
const dataHora = (iso: string) =>
  new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" }).format(new Date(iso));

/**
 * As vendas de um jogo: quanto se vendeu e onde, as compras uma a uma (com
 * anular, reenviar e os reembolsos por fazer), e os acessos dos seguranças.
 *
 * Lê-se de fresco ao abrir e depois de cada ação: as compras chegam a qualquer
 * hora, e uma lista guardada mentia sobre o que está pago.
 *
 * Ver é `website:read`; anular, reembolsar, reenviar, cancelar e o leitor à
 * porta são `website:write` (o servidor recusa na mesma).
 */
export function VendasDoJogo({
  jogo,
  nomeCurto,
  recintos,
  podeEscrever,
  onClose,
}: {
  jogo: ApiMatch;
  nomeCurto: string;
  recintos: Recinto[];
  podeEscrever: boolean;
  onClose: () => void;
}) {
  const [vendas, setVendas] = useState<Vendas | null>(null);
  const [falhou, setFalhou] = useState<string | null>(null);
  const [aba, setAba] = useState<"resumo" | "compras" | "porta">("resumo");

  const carregar = useCallback(() => {
    vendasDoJogo(jogo.id)
      .then((v) => {
        setVendas(v);
        setFalhou(null);
      })
      .catch((e: unknown) => setFalhou(e instanceof Error ? e.message : "Não foi possível ler as vendas."));
  }, [jogo.id]);

  useEffect(carregar, [carregar]);

  const porFazer = vendas?.pedidos.filter((p) => p.reembolso && !p.reembolso.feitoEm) ?? [];

  return (
    <Dialog
      title="Vendas"
      subtitle={`${jogo.isHome ? `${nomeCurto} vs ${jogo.opponent}` : `${jogo.opponent} vs ${nomeCurto}`} · ${quando(jogo.startsAt)}`}
      icon={<Receipt className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={980}
    >
      <div className="space-y-4 px-5 py-4">
        <Segmented
          value={aba}
          onChange={setAba}
          label="Partes das vendas"
          options={[
            { value: "resumo" as const, label: "Resumo" },
            { value: "compras" as const, label: "Compras", count: vendas?.pedidos.length },
            ...(podeEscrever ? [{ value: "porta" as const, label: "Leitor à porta", icon: IconePorta }] : []),
          ]}
        />

        {aba === "porta" && podeEscrever ? (
          <LeitorAPorta matchId={jogo.id} />
        ) : falhou && !vendas ? (
          <Empty icon={Receipt} title="Não foi possível ler as vendas" detail={falhou} compact />
        ) : !vendas ? (
          <Loading size="panel" />
        ) : aba === "compras" ? (
          <Compras vendas={vendas} porFazer={porFazer} podeEscrever={podeEscrever} onMudou={carregar} />
        ) : (
          <Resumo vendas={vendas} porFazer={porFazer} recintos={recintos} jogo={jogo} podeEscrever={podeEscrever} onMudou={carregar} onVerReembolsos={() => setAba("compras")} />
        )}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Resumo                                                                       */
/* -------------------------------------------------------------------------- */

function Numero({ rotulo, valor, nota, tom }: { rotulo: string; valor: string; nota?: string; tom?: "risk" }) {
  return (
    <div className="rounded-[10px] border border-line px-3.5 py-3">
      <p className="text-meta text-ink-3">{rotulo}</p>
      <p className={cx("mt-1 text-[20px] font-semibold tabular-nums leading-tight", tom === "risk" ? "text-risk" : "text-ink")}>{valor}</p>
      {nota && <p className="mt-0.5 text-meta text-ink-3">{nota}</p>}
    </div>
  );
}

function Resumo({
  vendas,
  porFazer,
  recintos,
  jogo,
  podeEscrever,
  onMudou,
  onVerReembolsos,
}: {
  vendas: Vendas;
  porFazer: CompraDoJogo[];
  recintos: Recinto[];
  jogo: ApiMatch;
  podeEscrever: boolean;
  onMudou: () => void;
  onVerReembolsos: () => void;
}) {
  const store = useStore();
  const [cancelar, setCancelar] = useState(false);
  const [motivo, setMotivo] = useState("");

  const v = vendas.venda;
  const bancadas = v.recinto?.bancadas ?? [];
  const recinto = recintos.find((r) => r.id === v.recinto?.id);
  const vendidos = vendas.porTipo.reduce((n, t) => n + t.vendidos, 0);
  const aDevolver = porFazer.reduce((n, p) => n + (p.reembolso?.valorCents ?? 0), 0);
  const livres = v.livresNoJogo ?? (bancadas.every((b) => v.livres[b.id] != null) && bancadas.length ? bancadas.reduce((n, b) => n + (v.livres[b.id] ?? 0), 0) : null);
  const vivas = vendas.pedidos.filter((p) => p.estado === "PAID" || p.estado === "RESERVED").length;

  const nomeDaPorta = (id: string) => (id === TODAS_AS_PORTAS ? "Todas as portas" : (recinto?.portas?.find((p) => p.id === id)?.nome ?? "Porta apagada"));
  const entradas = Object.entries(vendas.entradas).sort((a, b) => b[1] - a[1]);
  const totalEntradas = entradas.reduce((n, [, x]) => n + x, 0);

  const e = v.estado;
  const estado = e.fechada
    ? "Venda fechada."
    : e.publico
      ? "À venda a sócios e público."
      : e.socios
        ? e.soSocios
          ? "À venda só a sócios."
          : `À venda a sócios. Abre ao público a ${e.abrePublicoEm ? quando(e.abrePublicoEm) : "uma data por definir"}.`
        : `Abre aos sócios a ${e.abreSociosEm ? quando(e.abreSociosEm) : "uma data por definir"}.`;

  return (
    <div className="space-y-5">
      <p className="text-body text-ink-2">{estado}</p>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Numero rotulo="Recebido" valor={money(vendas.receitaCents)} nota="das compras pagas" />
        <Numero rotulo="Bilhetes vendidos" valor={vendidos.toLocaleString("pt-PT")} />
        <Numero rotulo="Lugares livres" valor={livres == null ? "Sem limite" : livres.toLocaleString("pt-PT")} />
        <Numero rotulo="Reembolsos por fazer" valor={money(aDevolver)} nota={`${porFazer.length} ${porFazer.length === 1 ? "compra" : "compras"}`} tom={porFazer.length ? "risk" : undefined} />
      </div>
      {porFazer.length > 0 && (
        <button type="button" className="ctl-outline" onClick={onVerReembolsos}>
          <Undo2 className="size-4" strokeWidth={1.75} />
          Ver os reembolsos por fazer
        </button>
      )}

      <section>
        <h3 className="mb-1.5 text-meta font-medium text-ink-2">Por bancada{v.recinto ? ` · ${v.recinto.nome}` : ""}</h3>
        {bancadas.length === 0 ? (
          <p className="text-meta text-ink-3">O jogo não tem recinto com bancadas.</p>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-line">
            <table className="w-full text-body">
              <thead>
                <tr className="bg-sunken/50 text-meta text-ink-2">
                  <th scope="col" className="px-3 py-2 text-left font-medium">Bancada</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Lotação</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Lugares anuais</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Vendidos ou guardados</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Livres</th>
                </tr>
              </thead>
              <tbody>
                {bancadas.map((b) => (
                  <tr key={b.id} className="border-t border-line tabular-nums">
                    <th scope="row" className="px-3 py-2 text-left font-medium text-ink">{b.nome}</th>
                    <td className="px-3 py-2 text-right text-ink-2">{b.lotacao?.toLocaleString("pt-PT") ?? "Sem limite"}</td>
                    <td className="px-3 py-2 text-right text-ink-2">{(vendas.anuais[b.id] ?? 0).toLocaleString("pt-PT")}</td>
                    <td className="px-3 py-2 text-right text-ink-2">{(vendas.ocupados[b.id] ?? 0).toLocaleString("pt-PT")}</td>
                    <td className={cx("px-3 py-2 text-right font-medium", v.livres[b.id] === 0 ? "text-risk" : "text-ink")}>
                      {v.livres[b.id] == null ? "Sem limite" : v.livres[b.id] === 0 ? "Esgotada" : v.livres[b.id]!.toLocaleString("pt-PT")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-1.5 text-meta text-ink-3">Os guardados são compras à espera de pagamento: o lugar fica preso 10 minutos e volta à venda se não pagarem.</p>
      </section>

      <section>
        <h3 className="mb-1.5 text-meta font-medium text-ink-2">Por tipo de bilhete</h3>
        {vendas.porTipo.length === 0 ? (
          <p className="text-meta text-ink-3">Ainda não se vendeu nenhum bilhete.</p>
        ) : (
          <ul className="overflow-hidden rounded-[10px] border border-line">
            {[...vendas.porTipo]
              .sort((a, b) => b.vendidos - a.vendidos)
              .map((t) => (
                <li key={t.typeId} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
                  <span className="min-w-0 flex-1 truncate text-body text-ink">{t.nome}</span>
                  <span className="text-meta tabular-nums text-ink-3">
                    {t.vendidos} {t.vendidos === 1 ? "bilhete" : "bilhetes"}
                  </span>
                  <span className="w-24 text-right text-body font-medium tabular-nums text-ink">{money(t.receitaCents)}</span>
                </li>
              ))}
          </ul>
        )}
        <p className="mt-1.5 text-meta text-ink-3">O valor por tipo é o preço dos bilhetes. O recebido, lá em cima, é o que os pagamentos trouxeram.</p>
      </section>

      <section>
        <h3 className="mb-1.5 text-meta font-medium text-ink-2">Entradas por porta</h3>
        {entradas.length === 0 ? (
          <p className="text-meta text-ink-3">Ainda ninguém entrou com bilhete ou lugar anual.</p>
        ) : (
          <ul className="overflow-hidden rounded-[10px] border border-line">
            {entradas.map(([id, n]) => (
              <li key={id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
                <IconePorta className="size-4 text-ink-3" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate text-body text-ink">{nomeDaPorta(id)}</span>
                <span className="text-body font-medium tabular-nums text-ink">{n.toLocaleString("pt-PT")}</span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 bg-sunken/40 px-3 py-2 text-meta text-ink-2">
              <span>Total</span>
              <span className="font-medium tabular-nums">{totalEntradas.toLocaleString("pt-PT")}</span>
            </li>
          </ul>
        )}
      </section>

      {podeEscrever && (vivas > 0 || !e.fechada) && jogo.status !== "PLAYED" && (
        <section className="rounded-[10px] border border-risk/25 px-4 py-3">
          <h3 className="text-panel text-risk">Cancelar a venda deste jogo</h3>
          <p className="mt-1 text-meta leading-relaxed text-ink-3">
            Para um jogo adiado ou cancelado. A venda fecha, todas as compras são anuladas e quem comprou recebe um email com o motivo. As compras pagas ficam com o
            reembolso por fazer.
          </p>
          <button type="button" className="ctl-outline mt-2.5 border-risk/30 text-risk" onClick={() => setCancelar(true)}>
            <Ban className="size-4" strokeWidth={1.75} />
            Cancelar a venda
          </button>
        </section>
      )}

      {cancelar && (
        <ConfirmDialog
          title="Cancelar a venda deste jogo?"
          confirmLabel="Cancelar a venda"
          onClose={() => {
            setCancelar(false);
            setMotivo("");
          }}
          onConfirm={async () => {
            if (motivo.trim().length < 2) throw new Error("Escreve o motivo. Vai no email a quem comprou.");
            const r = await cancelarVendasDoJogo(jogo.id, motivo.trim());
            mostrarOk(r.anuladas ? `Venda cancelada. ${r.anuladas} ${r.anuladas === 1 ? "compra paga anulada e avisada" : "compras pagas anuladas e avisadas"}.` : "Venda cancelada.");
            setCancelar(false);
            setMotivo("");
            // A venda fechou: a lista dos jogos tem de o saber.
            void carregarSite(store.academy.slug, true);
            onMudou();
          }}
        >
          <p>
            {vivas} {vivas === 1 ? "compra ativa vai ser anulada" : "compras ativas vão ser anuladas"}. Não há como voltar atrás.
          </p>
          <Motivo id="motivo-cancelar" valor={motivo} onChange={setMotivo} rotulo="Motivo (vai no email a quem comprou)" placeholder="Jogo adiado por causa do mau tempo." />
        </ConfirmDialog>
      )}
    </div>
  );
}

/** O campo do motivo, com o rótulo por cima e nada tocável lá dentro. */
function Motivo({ id, valor, onChange, rotulo, placeholder }: { id: string; valor: string; onChange: (v: string) => void; rotulo: string; placeholder?: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-meta font-medium text-ink-2">
        {rotulo}
      </label>
      <textarea id={id} className={cx(dialogInputClass, "h-20 py-2")} maxLength={300} placeholder={placeholder} value={valor} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Compras                                                                      */
/* -------------------------------------------------------------------------- */

function Compras({ vendas, porFazer, podeEscrever, onMudou }: { vendas: Vendas; porFazer: CompraDoJogo[]; podeEscrever: boolean; onMudou: () => void }) {
  const [filtro, setFiltro] = useState<"todas" | "reembolsos">("todas");
  const [anular, setAnular] = useState<CompraDoJogo | null>(null);
  const [reembolsar, setReembolsar] = useState<CompraDoJogo | null>(null);
  const [texto, setTexto] = useState("");
  const [aReenviar, setAReenviar] = useState<string | null>(null);

  const lista = filtro === "reembolsos" ? porFazer : vendas.pedidos;

  const reenviar = async (p: CompraDoJogo) => {
    setAReenviar(p.id);
    try {
      await reenviarBilhetes(p.id);
      mostrarOk(`Bilhetes reenviados para ${p.comprador.email}.`);
    } catch {
      // O erro já está no cartão de erros.
    } finally {
      setAReenviar(null);
    }
  };

  /** "2 × Norte · Público, 1 × Norte · Sócio", e quantos já entraram. */
  const resumoDosBilhetes = (p: CompraDoJogo) => {
    const n = new Map<string, number>();
    for (const b of p.bilhetes) n.set(b.tipo, (n.get(b.tipo) ?? 0) + 1);
    const usados = p.bilhetes.filter((b) => b.estado === "USED").length;
    const partes = [...n].map(([tipo, q]) => `${q} × ${tipo}`).join(", ");
    return partes + (usados ? ` · ${usados} já ${usados === 1 ? "entrou" : "entraram"}` : "");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar compras">
        {(
          [
            { k: "todas", t: `Todas (${vendas.pedidos.length})` },
            { k: "reembolsos", t: `Reembolsos por fazer (${porFazer.length})` },
          ] as const
        ).map((o) => (
          <button
            key={o.k}
            type="button"
            aria-pressed={filtro === o.k}
            onClick={() => setFiltro(o.k)}
            className={cx(
              "h-8 rounded-full border px-3 text-meta font-medium transition-colors",
              filtro === o.k ? "border-signal/30 bg-signal-soft text-signal-ink" : "border-line text-ink-2 hover:border-line-strong",
            )}
          >
            {o.t}
          </button>
        ))}
      </div>

      {lista.length === 0 ? (
        <Empty
          icon={filtro === "reembolsos" ? Undo2 : Receipt}
          tone={filtro === "reembolsos" ? "ok" : "neutral"}
          title={filtro === "reembolsos" ? "Não há reembolsos por fazer" : "Ainda não há compras"}
          detail={filtro === "reembolsos" ? undefined : "As compras do site e da app aparecem aqui assim que alguém escolhe os bilhetes."}
          compact
        />
      ) : (
        <ul className="overflow-hidden rounded-[10px] border border-line">
          {lista.map((p) => {
            const devolver = p.reembolso && !p.reembolso.feitoEm ? p.reembolso : null;
            return (
              <li key={p.id} className="space-y-1.5 border-b border-line px-3.5 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 truncate text-body font-medium text-ink">{p.comprador.nome}</span>
                  <Pill tone={TOM[p.estado]}>{ESTADO_DA_COMPRA[p.estado]}</Pill>
                  {devolver && <Pill tone="risk">Reembolso por fazer: {money(devolver.valorCents)}</Pill>}
                  <span className="ml-auto text-body font-medium tabular-nums text-ink">{money(p.totalCents)}</span>
                </div>
                <p className="text-meta text-ink-3">
                  <a href={`mailto:${p.comprador.email}`} className="hover:underline">
                    {p.comprador.email}
                  </a>
                  {p.comprador.telefone && (
                    <>
                      {" · "}
                      <a href={`tel:${p.comprador.telefone}`} className="tabular-nums hover:underline">
                        {p.comprador.telefone}
                      </a>
                    </>
                  )}
                  {p.comprador.socio != null && ` · Sócio n.º ${p.comprador.socio}`}
                  {` · ${p.canal === "APP" ? "App" : "Site"}`}
                  {` · ${p.pagaEm ? `paga a ${dataHora(p.pagaEm)}` : `feita a ${dataHora(p.criadaEm)}`}`}
                </p>
                {p.bilhetes.length > 0 && <p className="text-meta text-ink-2">{resumoDosBilhetes(p)}</p>}
                {p.reembolso?.feitoEm && (
                  <p className="text-meta text-ink-3">
                    Reembolsado ({money(p.reembolso.valorCents)}) a {data(p.reembolso.feitoEm)}
                    {p.reembolso.nota && `. ${p.reembolso.nota}`}
                  </p>
                )}
                {podeEscrever && (p.estado === "PAID" || p.estado === "RESERVED" || devolver) && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {p.estado === "PAID" && (
                      <button type="button" className="ctl-ghost" disabled={aReenviar === p.id} onClick={() => void reenviar(p)}>
                        <Send className="size-3.5" strokeWidth={1.75} />
                        Reenviar bilhetes
                      </button>
                    )}
                    {devolver && (
                      <button type="button" className="ctl-ghost" onClick={() => setReembolsar(p)}>
                        <Undo2 className="size-3.5" strokeWidth={1.75} />
                        Marcar como reembolsado
                      </button>
                    )}
                    {(p.estado === "PAID" || p.estado === "RESERVED") && (
                      <button type="button" className="ctl-ghost text-risk" onClick={() => setAnular(p)}>
                        <Ban className="size-3.5" strokeWidth={1.75} />
                        Anular
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {anular && (
        <ConfirmDialog
          title={`Anular a compra de ${anular.comprador.nome}?`}
          confirmLabel="Anular"
          onClose={() => {
            setAnular(null);
            setTexto("");
          }}
          onConfirm={async () => {
            if (texto.trim().length < 2) throw new Error("Escreve o motivo.");
            await anularCompra(anular.id, texto.trim());
            mostrarOk("Compra anulada.");
            setAnular(null);
            setTexto("");
            onMudou();
          }}
        >
          <p>
            Os bilhetes deixam de valer e os lugares voltam à venda.
            {anular.estado === "PAID" &&
              ` Quem comprou recebe um email com o motivo, e fica um reembolso por fazer de ${money(anular.pagoCents || anular.totalCents)}.`}
          </p>
          <Motivo id="motivo-anular" valor={texto} onChange={setTexto} rotulo="Motivo" placeholder="Comprou duas vezes por engano." />
        </ConfirmDialog>
      )}

      {reembolsar && reembolsar.reembolso && (
        <ConfirmDialog
          title="Marcar como reembolsado?"
          confirmLabel="Marcar como reembolsado"
          danger={false}
          onClose={() => {
            setReembolsar(null);
            setTexto("");
          }}
          onConfirm={async () => {
            await marcarReembolsado(reembolsar.id, texto);
            mostrarOk("Reembolso marcado como feito.");
            setReembolsar(null);
            setTexto("");
            onMudou();
          }}
        >
          <p>
            Devolveste {money(reembolsar.reembolso.valorCents)} a {reembolsar.comprador.nome} por fora (transferência, MB WAY, em mão). Fica marcado com o teu nome e a data.
          </p>
          <Motivo id="nota-reembolso" valor={texto} onChange={setTexto} rotulo="Nota (opcional)" placeholder="Transferência a 22/10, ref. 123." />
        </ConfirmDialog>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* O leitor à porta                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Os acessos dos seguranças a este jogo: um link e um PIN por porta, sem
 * conta na consola. O link e o PIN só se mostram ao criar (na base fica o
 * resumo); quem os perder cria outro e revoga o antigo.
 */
function LeitorAPorta({ matchId }: { matchId: string }) {
  const [dados, setDados] = useState<PortasDoJogo | null>(null);
  const [falhou, setFalhou] = useState<string | null>(null);
  const [gateId, setGateId] = useState(TODAS_AS_PORTAS);
  const [nome, setNome] = useState("");
  const [aCriar, setACriar] = useState(false);
  const [criado, setCriado] = useState<AcessoCriado | null>(null);
  const [revogar, setRevogar] = useState<AcessoDaPorta | null>(null);

  const carregar = useCallback(() => {
    portasDoJogo(matchId)
      .then((d) => {
        setDados(d);
        setFalhou(null);
      })
      .catch((e: unknown) => setFalhou(e instanceof Error ? e.message : "Não foi possível ler os acessos."));
  }, [matchId]);

  useEffect(carregar, [carregar]);

  const criar = async () => {
    setACriar(true);
    try {
      setCriado(await criarAcesso(matchId, gateId, nome));
      setNome("");
      carregar();
    } catch {
      // O erro já está no cartão de erros.
    } finally {
      setACriar(false);
    }
  };

  if (falhou && !dados) return <Empty icon={KeyRound} title="Não foi possível ler os acessos" detail={falhou} compact />;
  if (!dados) return <Loading size="panel" />;

  const soUma = dados.portas.length === 1;

  return (
    <div className="space-y-4">
      <p className="text-meta leading-relaxed text-ink-3">
        Cada segurança abre o leitor no telemóvel com um link e um PIN, sem conta na consola. O leitor só aceita os bilhetes das bancadas da porta dele, e diz qual é a
        porta certa quando é a errada. O acesso acaba seis horas depois do jogo.
        {soUma && " Este recinto não tem portas: o leitor aceita todas as bancadas. As portas criam-se no Estádio."}
      </p>

      <div className="rounded-[10px] border border-line p-3.5">
        <h3 className="mb-2.5 text-panel text-ink">Novo acesso</h3>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <DialogField label="Porta">
            <select className={dialogInputClass} value={gateId} onChange={(e) => setGateId(e.target.value)}>
              {dados.portas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </DialogField>
          <DialogField label="Nome (opcional)">
            <input className={dialogInputClass} maxLength={60} placeholder="Segurança Porta A" value={nome} onChange={(e) => setNome(e.target.value)} />
          </DialogField>
          <button type="button" className="ctl-primary" disabled={aCriar} onClick={() => void criar()}>
            <Plus className="size-4" strokeWidth={2} />
            Criar acesso
          </button>
        </div>
      </div>

      {dados.acessos.length === 0 ? (
        <Empty icon={KeyRound} title="Ainda não há acessos" detail="Cria um por segurança, ou um por porta." compact />
      ) : (
        <ul className="overflow-hidden rounded-[10px] border border-line">
          {dados.acessos.map((a) => {
            const caducou = new Date(a.expiraEm).getTime() <= Date.now();
            return (
              <li key={a.id} className={cx("flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3.5 py-2.5 last:border-b-0", !a.ativo && "opacity-70")}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-ink">{a.label}</p>
                  <p className="text-meta text-ink-3">
                    {a.porta}
                    {a.criadoPor && ` · criado por ${a.criadoPor}`}
                    {` · ${caducou ? "acabou" : "vale até"} ${dataHora(a.expiraEm)}`}
                  </p>
                </div>
                {a.ativo ? a.bloqueado ? <Pill tone="warn">Bloqueado 15 min</Pill> : <Pill tone="ok">Ativo</Pill> : <Pill>{caducou ? "Acabou" : "Revogado"}</Pill>}
                {a.ativo && (
                  <button type="button" className="ctl-ghost text-risk" onClick={() => setRevogar(a)}>
                    <Trash2 className="size-3.5" strokeWidth={1.75} />
                    Revogar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {criado && <AcessoCriadoDialog acesso={criado} onClose={() => setCriado(null)} />}

      {revogar && (
        <ConfirmDialog
          title={`Revogar ${revogar.label}?`}
          confirmLabel="Revogar"
          onClose={() => setRevogar(null)}
          onConfirm={async () => {
            await revogarAcesso(revogar.id);
            mostrarOk("Acesso revogado.");
            setRevogar(null);
            carregar();
          }}
        >
          O link e o PIN deixam de abrir o leitor, mesmo num telemóvel onde já estejam abertos.
        </ConfirmDialog>
      )}
    </div>
  );
}

/** O link e o PIN, mostrados uma vez, com o QR do link para o segurança apontar a câmara. */
function AcessoCriadoDialog({ acesso, onClose }: { acesso: AcessoCriado; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void qrPng(acesso.link, 480)
      .then((d) => vivo && setQr(d))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [acesso.link]);

  const copiar = async (texto: string, o: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      mostrarOk(`${o} copiado.`);
    } catch {
      mostrarErro("Não foi possível copiar. Seleciona o texto e copia à mão.");
    }
  };

  return (
    <Dialog
      title="Acesso criado"
      icon={<KeyRound className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={520}
      footer={
        <button type="button" className="ctl-primary" onClick={onClose}>
          Já guardei
        </button>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <p className="rounded-[8px] bg-warn-soft px-3 py-2 text-meta leading-relaxed text-warn">
          O PIN só se mostra agora. Envia o link e o PIN por caminhos diferentes.
        </p>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-start">
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-meta font-medium text-ink-2">Link do leitor</p>
              <p className="select-all break-all rounded-[8px] border border-line bg-sunken/40 px-3 py-2 font-mono text-meta text-ink">{acesso.link}</p>
              <button type="button" className="ctl-ghost mt-1.5" onClick={() => void copiar(acesso.link, "Link")}>
                <Copy className="size-3.5" strokeWidth={1.75} />
                Copiar o link
              </button>
            </div>
            <div>
              <p className="mb-1.5 text-meta font-medium text-ink-2">PIN</p>
              <p className="select-all font-mono text-[28px] font-semibold tracking-[0.2em] text-ink tabular-nums">{acesso.pin}</p>
              <button type="button" className="ctl-ghost mt-1" onClick={() => void copiar(acesso.pin, "PIN")}>
                <Copy className="size-3.5" strokeWidth={1.75} />
                Copiar o PIN
              </button>
            </div>
            <p className="text-meta text-ink-3">Vale até {dataHora(acesso.expiraEm)}.</p>
          </div>
          <div className="flex justify-center rounded-[10px] border border-line bg-white p-2">
            {qr ? <img src={qr} alt="Código QR do link do leitor" className="size-[144px]" /> : <div className="size-[144px]" aria-hidden />}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
