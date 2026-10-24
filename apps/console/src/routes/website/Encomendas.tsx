import { useCallback, useEffect, useState } from "react";
import { Ban, Package, PackageCheck, PackageOpen, Send, Truck, Undo2 } from "@/lib/icons";
import { Empty, Loading, Pill, cx, type Tone } from "@/components/primitives";
import { Dialog, dialogInputClass } from "@/components/Dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { mostrarOk } from "@/lib/avisos";
import { carregarSite } from "@/lib/website";
import { useStore } from "@/lib/store";
import {
  ESTADO_DA_ENCOMENDA,
  anularEncomenda,
  listarEncomendas,
  marcarEntregue,
  marcarEnviada,
  marcarPronta,
  marcarReembolsado,
  reenviarConfirmacao,
  type Encomenda,
  type EstadoDaEncomenda,
} from "@/lib/loja";

const TOM: Record<EstadoDaEncomenda, Tone> = { PAID: "signal", READY: "ok", SHIPPED: "ok", DELIVERED: "neutral", RESERVED: "warn", LATE_PAYMENT: "risk", CANCELLED: "neutral" };

const dataHora = (iso: string) => new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" }).format(new Date(iso));
const data = (iso: string) => new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Lisbon" }).format(new Date(iso));

type Filtro = "tratar" | "curso" | "entregues" | "reembolsos" | "todas";

/**
 * As encomendas da loja: as pagas por preparar, as prontas ou enviadas, as
 * entregues, os reembolsos por fazer, e todas. Cada uma abre-se para ver os
 * artigos e a morada e para mudar de estado; quem comprou recebe um email a
 * cada passo (pronta, enviada, anulada).
 *
 * Lê-se de fresco ao abrir e depois de cada ação: as encomendas chegam a
 * qualquer hora, e uma lista guardada mentia sobre o que está pago.
 */
export function Encomendas() {
  const { session } = useSession();
  const store = useStore();
  const podeEscrever = can(session, "website:write");
  const [lista, setLista] = useState<Encomenda[] | null>(null);
  const [falhou, setFalhou] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("tratar");
  const [aberta, setAberta] = useState<string | null>(null);

  const carregar = useCallback(() => {
    listarEncomendas()
      .then((l) => {
        setLista(l);
        setFalhou(null);
        // A pastilha do submenu acompanha o que se tratou.
        void carregarSite(store.academy.slug, true);
      })
      .catch((e: unknown) => setFalhou(e instanceof Error ? e.message : "Não foi possível ler as encomendas."));
  }, [store.academy.slug]);

  useEffect(carregar, [carregar]);

  if (falhou && !lista) return <Empty icon={PackageOpen} title="Não foi possível ler as encomendas" detail={falhou} compact />;
  if (!lista) return <Loading size="panel" />;

  const porTratar = lista.filter((e) => e.estado === "PAID");
  const emCurso = lista.filter((e) => e.estado === "READY" || e.estado === "SHIPPED");
  const entregues = lista.filter((e) => e.estado === "DELIVERED");
  const reembolsos = lista.filter((e) => e.reembolso && !e.reembolso.feitoEm);
  const visiveis = filtro === "tratar" ? porTratar : filtro === "curso" ? emCurso : filtro === "entregues" ? entregues : filtro === "reembolsos" ? reembolsos : lista;
  const escolhida = aberta ? lista.find((e) => e.id === aberta) ?? null : null;

  const filtros: { k: Filtro; t: string; n: number }[] = [
    { k: "tratar", t: "Por preparar", n: porTratar.length },
    { k: "curso", t: "Prontas e enviadas", n: emCurso.length },
    { k: "entregues", t: "Entregues", n: entregues.length },
    { k: "reembolsos", t: "Reembolsos por fazer", n: reembolsos.length },
    { k: "todas", t: "Todas", n: lista.length },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar encomendas">
        {filtros.map((o) => (
          <button
            key={o.k}
            type="button"
            aria-pressed={filtro === o.k}
            onClick={() => setFiltro(o.k)}
            className={cx(
              "h-8 rounded-full border px-3 text-meta font-medium transition-colors",
              filtro === o.k ? "border-signal/30 bg-signal-soft text-signal-ink" : "border-line text-ink-2 hover:border-line-strong",
              o.k === "reembolsos" && o.n > 0 && filtro !== o.k && "border-risk/30 text-risk",
            )}
          >
            {o.t} ({o.n})
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <Empty
          icon={filtro === "reembolsos" ? Undo2 : filtro === "tratar" ? PackageCheck : PackageOpen}
          tone={filtro === "reembolsos" || filtro === "tratar" ? "ok" : "neutral"}
          title={
            filtro === "reembolsos"
              ? "Não há reembolsos por fazer"
              : filtro === "tratar"
                ? "Não há encomendas por preparar"
                : filtro === "curso"
                  ? "Nada pronto nem enviado à espera"
                  : filtro === "entregues"
                    ? "Ainda não há encomendas entregues"
                    : "Ainda não há encomendas"
          }
          detail={filtro === "todas" ? "As encomendas do site aparecem aqui assim que alguém paga. Chega também um email ao endereço da Identidade do site." : undefined}
          compact
        />
      ) : (
        <ul className="overflow-hidden rounded-[10px] border border-line">
          {visiveis.map((e) => {
            const devolver = e.reembolso && !e.reembolso.feitoEm ? e.reembolso : null;
            const unidades = e.linhas.reduce((n, l) => n + l.quantidade, 0);
            return (
              <li key={e.id}>
                <button type="button" onClick={() => setAberta(e.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3.5 py-3 text-left transition-colors hover:bg-sunken/40 last:border-b-0">
                  <span className="w-14 shrink-0 text-body font-semibold tabular-nums text-ink">n.º {e.numero}</span>
                  <span className="min-w-0 flex-1 truncate text-body text-ink">{e.comprador.nome}</span>
                  <Pill tone={TOM[e.estado]}>{ESTADO_DA_ENCOMENDA[e.estado]}</Pill>
                  {devolver && <Pill tone="risk">Reembolso por fazer: {money(devolver.valorCents)}</Pill>}
                  <span className="hidden items-center gap-1 text-meta text-ink-3 sm:inline-flex">
                    {e.entrega === "SHIPPING" ? <Truck className="size-3.5" strokeWidth={1.75} /> : <Package className="size-3.5" strokeWidth={1.75} />}
                    {unidades} {unidades === 1 ? "artigo" : "artigos"}
                  </span>
                  <span className="text-meta text-ink-3">{e.pagaEm ? dataHora(e.pagaEm) : dataHora(e.criadaEm)}</span>
                  <span className="w-20 text-right text-body font-medium tabular-nums text-ink">{money(e.totalCents)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {escolhida && <DetalheDaEncomenda encomenda={escolhida} podeEscrever={podeEscrever} onClose={() => setAberta(null)} onMudou={carregar} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Uma encomenda                                                                */
/* -------------------------------------------------------------------------- */

function DetalheDaEncomenda({ encomenda: e, podeEscrever, onClose, onMudou }: { encomenda: Encomenda; podeEscrever: boolean; onClose: () => void; onMudou: () => void }) {
  const [acao, setAcao] = useState<"enviada" | "anular" | "reembolsar" | null>(null);
  const [texto, setTexto] = useState("");
  const [aFazer, setAFazer] = useState(false);
  const devolver = e.reembolso && !e.reembolso.feitoEm ? e.reembolso : null;
  const viva = e.estado === "PAID" || e.estado === "READY" || e.estado === "SHIPPED";

  const fazer = async (f: () => Promise<unknown>, ok: string) => {
    setAFazer(true);
    try {
      await f();
      mostrarOk(ok);
      onMudou();
    } catch {
      // O erro já está no cartão de erros.
    } finally {
      setAFazer(false);
    }
  };

  return (
    <Dialog
      title={`Encomenda n.º ${e.numero}`}
      subtitle={`${e.comprador.nome} · ${ESTADO_DA_ENCOMENDA[e.estado]}`}
      icon={<PackageOpen className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={640}
      footer={
        <button type="button" className="ctl-ghost" onClick={onClose}>
          Fechar
        </button>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={TOM[e.estado]}>{ESTADO_DA_ENCOMENDA[e.estado]}</Pill>
          {devolver && <Pill tone="risk">Reembolso por fazer: {money(devolver.valorCents)}</Pill>}
          {e.reembolso?.feitoEm && <Pill tone="ok">Reembolsado a {data(e.reembolso.feitoEm)}</Pill>}
        </div>

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[10px] border border-line px-3.5 py-3">
            <p className="text-meta text-ink-3">Quem comprou</p>
            <p className="mt-1 text-body font-medium text-ink">{e.comprador.nome}</p>
            <p className="text-meta text-ink-2">
              <a href={`mailto:${e.comprador.email}`} className="hover:underline">
                {e.comprador.email}
              </a>
              {e.comprador.telefone && (
                <>
                  {" · "}
                  <a href={`tel:${e.comprador.telefone}`} className="tabular-nums hover:underline">
                    {e.comprador.telefone}
                  </a>
                </>
              )}
            </p>
          </div>
          <div className="rounded-[10px] border border-line px-3.5 py-3">
            <p className="flex items-center gap-1.5 text-meta text-ink-3">
              {e.entrega === "SHIPPING" ? <Truck className="size-3.5" strokeWidth={1.75} /> : <Package className="size-3.5" strokeWidth={1.75} />}
              {e.entrega === "SHIPPING" ? "Envio pelo correio" : "Levantamento no clube"}
            </p>
            {e.entrega === "SHIPPING" && e.morada.length > 0 && <p className="mt-1 text-body text-ink">{e.morada.join(", ")}</p>}
            {e.rastreio && <p className="text-meta text-ink-2">Código de seguimento: {e.rastreio}</p>}
            <p className="mt-1 text-meta text-ink-3">
              {e.pagaEm ? `Paga a ${dataHora(e.pagaEm)}` : `Feita a ${dataHora(e.criadaEm)}`}
              {e.prontaEm && ` · pronta a ${dataHora(e.prontaEm)}`}
              {e.enviadaEm && ` · enviada a ${dataHora(e.enviadaEm)}`}
              {e.entregueEm && ` · entregue a ${dataHora(e.entregueEm)}`}
              {e.anuladaEm && ` · anulada a ${dataHora(e.anuladaEm)}`}
            </p>
          </div>
        </section>

        {e.nota && (
          <p className="rounded-[8px] bg-sunken/60 px-3 py-2 text-body text-ink-2">
            <span className="text-meta text-ink-3">Nota de quem comprou: </span>
            {e.nota}
          </p>
        )}
        {e.motivo && (
          <p className="rounded-[8px] bg-sunken/60 px-3 py-2 text-body text-ink-2">
            <span className="text-meta text-ink-3">Motivo: </span>
            {e.motivo}
          </p>
        )}

        <section>
          <h3 className="mb-1.5 text-meta font-medium text-ink-2">Artigos</h3>
          <ul className="overflow-hidden rounded-[10px] border border-line">
            {e.linhas.map((l, i) => (
              <li key={i} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
                <div className="h-11 w-9 shrink-0 overflow-hidden rounded-[6px] bg-sunken">{l.imageUrl && <img src={l.imageUrl} alt="" className="size-full object-cover" loading="lazy" />}</div>
                <span className="min-w-0 flex-1 truncate text-body text-ink">
                  <span className="font-medium tabular-nums">{l.quantidade} ×</span> {l.nome}
                  {l.tamanho && <span className="text-ink-3"> · {l.tamanho}</span>}
                </span>
                <span className="w-20 text-right text-body font-medium tabular-nums text-ink">{money(l.quantidade * l.unitPriceCents)}</span>
              </li>
            ))}
            {e.envioCents > 0 && (
              <li className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 text-meta text-ink-2">
                <span>Envio</span>
                <span className="tabular-nums">{money(e.envioCents)}</span>
              </li>
            )}
            <li className="flex items-center justify-between gap-3 bg-sunken/40 px-3 py-2 text-body text-ink">
              <span className="font-medium">Total</span>
              <span className="font-semibold tabular-nums">{money(e.totalCents)}</span>
            </li>
          </ul>
          {e.pagoCents > 0 && e.pagoCents !== e.totalCents && <p className="mt-1.5 text-meta text-ink-3">Recebido: {money(e.pagoCents)} (com a comissão do pagamento).</p>}
          {e.reembolso?.feitoEm && e.reembolso.nota && <p className="mt-1.5 text-meta text-ink-3">{e.reembolso.nota}</p>}
        </section>

        {podeEscrever && (viva || devolver) && (
          <div className="flex flex-wrap gap-1.5 border-t border-line pt-4">
            {e.estado === "PAID" && e.entrega === "PICKUP" && (
              <button type="button" className="ctl-primary" disabled={aFazer} onClick={() => void fazer(() => marcarPronta(e.id), "Marcada como pronta. Quem comprou recebe o aviso.")}>
                <PackageCheck className="size-4" strokeWidth={1.75} />
                Pronta para levantar
              </button>
            )}
            {e.estado === "PAID" && e.entrega === "SHIPPING" && (
              <button type="button" className="ctl-primary" disabled={aFazer} onClick={() => setAcao("enviada")}>
                <Truck className="size-4" strokeWidth={1.75} />
                Marcar como enviada
              </button>
            )}
            {(e.estado === "READY" || e.estado === "SHIPPED") && (
              <button type="button" className="ctl-primary" disabled={aFazer} onClick={() => void fazer(() => marcarEntregue(e.id), e.entrega === "PICKUP" ? "Marcada como levantada." : "Marcada como recebida.")}>
                <PackageCheck className="size-4" strokeWidth={1.75} />
                {e.entrega === "PICKUP" ? "Foi levantada" : "Foi recebida"}
              </button>
            )}
            {viva && (
              <button type="button" className="ctl-ghost" disabled={aFazer} onClick={() => void fazer(() => reenviarConfirmacao(e.id), `Confirmação reenviada para ${e.comprador.email}.`)}>
                <Send className="size-3.5" strokeWidth={1.75} />
                Reenviar confirmação
              </button>
            )}
            {devolver && (
              <button type="button" className="ctl-ghost" onClick={() => setAcao("reembolsar")}>
                <Undo2 className="size-3.5" strokeWidth={1.75} />
                Marcar como reembolsado
              </button>
            )}
            {viva && (
              <button type="button" className="ctl-ghost text-risk" onClick={() => setAcao("anular")}>
                <Ban className="size-3.5" strokeWidth={1.75} />
                Anular
              </button>
            )}
          </div>
        )}
      </div>

      {acao === "enviada" && (
        <ConfirmDialog
          title="Marcar como enviada?"
          confirmLabel="Marcar como enviada"
          danger={false}
          onClose={() => {
            setAcao(null);
            setTexto("");
          }}
          onConfirm={async () => {
            await marcarEnviada(e.id, texto);
            mostrarOk("Marcada como enviada. Quem comprou recebe o aviso.");
            setAcao(null);
            setTexto("");
            onMudou();
          }}
        >
          <p>Quem comprou recebe um email a dizer que a encomenda seguiu para {e.morada.join(", ")}.</p>
          <Campo id="rastreio" valor={texto} onChange={setTexto} rotulo="Código de seguimento (opcional)" placeholder="RR123456789PT" />
        </ConfirmDialog>
      )}

      {acao === "anular" && (
        <ConfirmDialog
          title={`Anular a encomenda n.º ${e.numero}?`}
          confirmLabel="Anular"
          onClose={() => {
            setAcao(null);
            setTexto("");
          }}
          onConfirm={async () => {
            if (texto.trim().length < 2) throw new Error("Escreve o motivo. Vai no email a quem comprou.");
            await anularEncomenda(e.id, texto.trim());
            mostrarOk("Encomenda anulada.");
            setAcao(null);
            setTexto("");
            onMudou();
          }}
        >
          <p>Os artigos voltam ao stock. Quem comprou recebe um email com o motivo, e fica um reembolso por fazer de {money(e.pagoCents || e.totalCents)}.</p>
          <Campo id="motivo-anular" valor={texto} onChange={setTexto} rotulo="Motivo (vai no email)" placeholder="O artigo deixou de se fabricar." multiline />
        </ConfirmDialog>
      )}

      {acao === "reembolsar" && e.reembolso && (
        <ConfirmDialog
          title="Marcar como reembolsado?"
          confirmLabel="Marcar como reembolsado"
          danger={false}
          onClose={() => {
            setAcao(null);
            setTexto("");
          }}
          onConfirm={async () => {
            await marcarReembolsado(e.id, texto);
            mostrarOk("Reembolso marcado como feito.");
            setAcao(null);
            setTexto("");
            onMudou();
          }}
        >
          <p>Devolveste {money(e.reembolso.valorCents)} a {e.comprador.nome} por fora (transferência, MB WAY, em mão). Fica marcado com o teu nome e a data.</p>
          <Campo id="nota-reembolso" valor={texto} onChange={setTexto} rotulo="Nota (opcional)" placeholder="Transferência a 24/10, ref. 123." multiline />
        </ConfirmDialog>
      )}
    </Dialog>
  );
}

/** Um campo de texto com o rótulo por cima e nada tocável lá dentro. */
function Campo({ id, valor, onChange, rotulo, placeholder, multiline = false }: { id: string; valor: string; onChange: (v: string) => void; rotulo: string; placeholder?: string; multiline?: boolean }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-meta font-medium text-ink-2">
        {rotulo}
      </label>
      {multiline ? (
        <textarea id={id} className={cx(dialogInputClass, "h-20 py-2")} maxLength={300} placeholder={placeholder} value={valor} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} className={dialogInputClass} maxLength={80} placeholder={placeholder} value={valor} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
