import { useState } from "react";
import { MapPin, Pencil, Plus, Recinto as IconeRecinto, Ticket, Trash2 } from "@/lib/icons";
import { Empty, cx } from "@/components/primitives";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { Interruptor } from "@/components/definicoes/ui";
import { MapaDoRecinto } from "@academia/ui/estadio";
import { useStore, type ApiMatch } from "@/lib/store";
import { gravarSite, novoId, useSite, type BilheteiraDoJogo, type Recinto } from "@/lib/website";
import { mostrarOk } from "@/lib/avisos";

const euro = (v: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v);
const quando = (iso: string) =>
  new Intl.DateTimeFormat("pt-PT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" }).format(new Date(iso));

/**
 * Os bilhetes de partida de um jogo. Com recinto desenhado, um tipo por
 * bancada (o preço é o mesmo para todas, e muda-se à mão); sem recinto, os
 * dois tipos de sempre, sem lugar.
 */
function padrao(recinto: Recinto | null): BilheteiraDoJogo {
  return {
    aberta: false,
    recintoId: recinto?.id ?? null,
    lotacao: null,
    nota: "Sócios com quota em dia entram com o cartão na app.",
    tipos: recinto?.bancadas.length
      ? recinto.bancadas.map((b) => ({ id: novoId(), nome: b.nome, preco: 5, bancadaId: b.id }))
      : [
          { id: novoId(), nome: "Geral", preco: 5, bancadaId: null },
          { id: novoId(), nome: "Até 16 anos", preco: 2, bancadaId: null },
        ],
  };
}

/** Bilheteiras gravadas antes de haver recintos não têm estes campos. */
function normalizar(b: BilheteiraDoJogo): BilheteiraDoJogo {
  return { ...b, recintoId: b.recintoId ?? null, tipos: b.tipos.map((t) => ({ ...t, bancadaId: t.bancadaId ?? null })) };
}

/**
 * A bilheteira: os jogos em casa que aí vêm, os da plataforma (os mesmos do
 * calendário). Para cada um, abrir a venda e dizer os tipos, os preços e a
 * bancada de cada tipo.
 *
 * Só jogos em casa: fora, quem vende é o outro clube.
 */
export function Bilheteira({ onIrParaEstadio }: { onIrParaEstadio: () => void }) {
  const store = useStore();
  const slug = store.academy.slug;
  const site = useSite(slug);
  const [editar, setEditar] = useState<ApiMatch | null>(null);

  const agora = Date.now();
  const jogos = store.matches
    .filter((m) => m.isHome && m.status !== "CANCELLED" && new Date(m.startsAt).getTime() >= agora)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const de = (id: string) => (site.bilheteira[id] ? normalizar(site.bilheteira[id]) : undefined);
  const recintoPadrao = site.recintos[0] ?? null;

  const alternar = (m: ApiMatch) =>
    gravarSite(slug, (s) => {
      const atual = s.bilheteira[m.id] ? normalizar(s.bilheteira[m.id]) : padrao(recintoPadrao);
      return { ...s, bilheteira: { ...s.bilheteira, [m.id]: { ...atual, aberta: !atual.aberta } } };
    });

  if (jogos.length === 0) {
    return <Empty icon={Ticket} title="Não há jogos em casa marcados" detail="Os jogos em casa do calendário aparecem aqui para abrir a venda de bilhetes." />;
  }

  return (
    <>
      {site.recintos.length === 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line bg-sunken/50 px-4 py-3">
          <p className="text-meta text-ink-2">Desenha o estádio para cada bilhete ficar ligado a uma bancada, e quem compra ver no mapa onde vai ficar.</p>
          <button type="button" className="ctl-outline" onClick={onIrParaEstadio}>
            <IconeRecinto className="size-4" strokeWidth={1.75} />
            Desenhar o estádio
          </button>
        </div>
      )}

      <ul className="overflow-hidden rounded-[12px] border border-line bg-surface">
        {jogos.map((m) => {
          const b = de(m.id);
          const desde = b?.tipos.length ? Math.min(...b.tipos.map((t) => t.preco)) : null;
          const recinto = site.recintos.find((r) => r.id === b?.recintoId);
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="text-meta text-ink-3">
                  {m.teamName}
                  {m.competition && ` · ${m.competition.label}`}
                </p>
                <p className="truncate text-body font-medium text-ink">
                  {store.academy.shortName} <span className="text-ink-4">vs</span> {m.opponent}
                </p>
                <p className="flex items-center gap-1 text-meta text-ink-3">
                  <span className="capitalize">{quando(m.startsAt)}</span>
                  <span aria-hidden>·</span>
                  <MapPin className="size-3" strokeWidth={1.75} />
                  <span className="truncate">{recinto?.nome ?? m.venue}</span>
                </p>
              </div>
              <span className={cx("text-meta tabular-nums", b?.aberta ? "text-ok" : "text-ink-4")}>
                {b?.aberta ? (desde != null ? `À venda, desde ${euro(desde)}` : "À venda") : "Sem venda"}
              </span>
              <Interruptor ligado={!!b?.aberta} onChange={() => alternar(m)} label={`Bilhetes para ${m.opponent}`} />
              <button type="button" className="ctl-outline" onClick={() => setEditar(m)}>
                <Pencil className="size-4" strokeWidth={1.75} />
                Bilhetes
              </button>
            </li>
          );
        })}
      </ul>

      {editar && (
        <EditarBilheteira
          jogo={editar}
          nomeCurto={store.academy.shortName}
          recintos={site.recintos}
          inicial={de(editar.id) ?? padrao(recintoPadrao)}
          onClose={() => setEditar(null)}
          onGuardar={(b) => {
            gravarSite(slug, (s) => ({ ...s, bilheteira: { ...s.bilheteira, [editar.id]: b } }));
            mostrarOk(b.aberta ? "Bilheteira aberta." : "Bilheteira guardada.");
            setEditar(null);
          }}
        />
      )}
    </>
  );
}

function EditarBilheteira({
  jogo,
  nomeCurto,
  recintos,
  inicial,
  onClose,
  onGuardar,
}: {
  jogo: ApiMatch;
  nomeCurto: string;
  recintos: Recinto[];
  inicial: BilheteiraDoJogo;
  onClose: () => void;
  onGuardar: (b: BilheteiraDoJogo) => void;
}) {
  const [b, setB] = useState(inicial);
  const [precos, setPrecos] = useState<Record<string, string>>(() =>
    Object.fromEntries(inicial.tipos.map((t) => [t.id, String(t.preco).replace(".", ",")])),
  );
  const [lotacao, setLotacao] = useState(inicial.lotacao ? String(inicial.lotacao) : "");
  const [bancadaVista, setBancadaVista] = useState<string | null>(null);

  const recinto = recintos.find((r) => r.id === b.recintoId) ?? null;
  const numero = (s: string) => Number(s.replace(",", "."));
  const tiposOk =
    b.tipos.length > 0 &&
    b.tipos.every((t) => t.nome.trim() && (precos[t.id] ?? "").trim() && Number.isFinite(numero(precos[t.id] ?? "")) && numero(precos[t.id] ?? "") >= 0);
  const lotacaoOk = !lotacao.trim() || (Number.isInteger(Number(lotacao)) && Number(lotacao) > 0);

  /** O preço mais baixo de cada bancada, para o mapa. */
  const desdeNaBancada = (id: string) => {
    const ps = b.tipos.filter((t) => t.bancadaId === id).map((t) => numero(precos[t.id] ?? ""));
    const validos = ps.filter((p) => Number.isFinite(p));
    return validos.length ? Math.min(...validos) : null;
  };

  const trocarRecinto = (id: string) => {
    const novo = recintos.find((r) => r.id === id) ?? null;
    // As bancadas são do recinto: ao mudar, os bilhetes deixam de ter lugar.
    setB({ ...b, recintoId: novo?.id ?? null, tipos: b.tipos.map((t) => ({ ...t, bancadaId: null })) });
    setBancadaVista(null);
  };

  const juntarTipo = (bancadaId: string | null) => {
    const id = novoId();
    const nome = recinto?.bancadas.find((x) => x.id === bancadaId)?.nome ?? "";
    setB({ ...b, tipos: [...b.tipos, { id, nome, preco: 0, bancadaId }] });
    setPrecos({ ...precos, [id]: "" });
  };

  return (
    <Dialog
      title="Bilhetes"
      subtitle={`${nomeCurto} vs ${jogo.opponent} · ${quando(jogo.startsAt)}`}
      icon={<Ticket className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={720}
      footer={
        <>
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="ctl-primary"
            disabled={!tiposOk || !lotacaoOk}
            onClick={() =>
              onGuardar({
                ...b,
                lotacao: lotacao.trim() ? Number(lotacao) : null,
                tipos: b.tipos.map((t) => ({ ...t, nome: t.nome.trim(), preco: Math.round(numero(precos[t.id]) * 100) / 100 })),
              })
            }
          >
            Guardar
          </button>
        </>
      }
    >
      <div className="space-y-5 px-5 py-4">
        <div className="flex items-center justify-between gap-3 rounded-[8px] border border-line px-3 py-2.5">
          <span className="text-body text-ink">Venda aberta</span>
          <Interruptor ligado={b.aberta} onChange={() => setB({ ...b, aberta: !b.aberta })} label="Venda aberta" />
        </div>

        <DialogField label="Recinto" hint={recintos.length ? "As bancadas que os bilhetes podem ter são as deste recinto." : "Sem recintos desenhados, os bilhetes não têm lugar no mapa."}>
          <select className={dialogInputClass} value={b.recintoId ?? ""} onChange={(e) => trocarRecinto(e.target.value)} disabled={!recintos.length}>
            <option value="">Sem mapa</option>
            {recintos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
          </select>
        </DialogField>

        {recinto && (
          <div>
            <p className="mb-1.5 text-meta font-medium text-ink-2">Como quem compra vai ver</p>
            <div className="rounded-[10px] border border-line bg-surface p-2">
              <MapaDoRecinto
                recinto={recinto}
                className="w-full"
                selecionada={bancadaVista}
                onEscolher={(id) => setBancadaVista(id === bancadaVista ? null : id)}
                estado={(x) => (b.tipos.some((t) => t.bancadaId === x.id) ? "ativa" : "inativa")}
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
          <p className="mb-1.5 text-meta font-medium text-ink-2">Tipos de bilhete</p>
          <ul className="space-y-2">
            {b.tipos.map((t) => (
              <li
                key={t.id}
                className={cx(
                  "grid items-center gap-2 rounded-[8px]",
                  recinto ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_88px_auto]" : "grid-cols-[minmax(0,1fr)_88px_auto]",
                  bancadaVista && t.bancadaId === bancadaVista && "bg-signal-soft/60 ring-1 ring-signal-line/40",
                )}
              >
                <input
                  className={dialogInputClass}
                  aria-label="Nome do tipo"
                  placeholder="Geral, Sócio, Até 16 anos…"
                  value={t.nome}
                  onChange={(e) => setB({ ...b, tipos: b.tipos.map((x) => (x.id === t.id ? { ...x, nome: e.target.value } : x)) })}
                />
                {recinto && (
                  <select
                    className={dialogInputClass}
                    aria-label={`Bancada de ${t.nome || "este tipo"}`}
                    value={t.bancadaId ?? ""}
                    onChange={(e) => setB({ ...b, tipos: b.tipos.map((x) => (x.id === t.id ? { ...x, bancadaId: e.target.value || null } : x)) })}
                  >
                    <option value="">Qualquer lugar</option>
                    {recinto.bancadas.map((bc) => (
                      <option key={bc.id} value={bc.id}>
                        {bc.nome}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  className={cx(dialogInputClass, "text-right tabular-nums")}
                  aria-label={`Preço de ${t.nome || "este tipo"} em euros`}
                  inputMode="decimal"
                  placeholder="€"
                  value={precos[t.id] ?? ""}
                  onChange={(e) => setPrecos({ ...precos, [t.id]: e.target.value })}
                />
                <button
                  type="button"
                  aria-label={`Tirar ${t.nome || "este tipo"}`}
                  disabled={b.tipos.length === 1}
                  onClick={() => setB({ ...b, tipos: b.tipos.filter((x) => x.id !== t.id) })}
                  className="ctl-ghost size-9 justify-center px-0 text-risk disabled:opacity-30"
                >
                  <Trash2 className="size-4" strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="ctl-ghost mt-2" onClick={() => juntarTipo(bancadaVista)}>
            <Plus className="size-4" strokeWidth={2} />
            {bancadaVista && recinto ? `Outro tipo na ${recinto.bancadas.find((x) => x.id === bancadaVista)?.nome}` : "Outro tipo"}
          </button>
        </div>

        <DialogField
          label="Lotação do jogo"
          hint={recinto ? "Vazio = a soma das bancadas. Cada bancada fecha sozinha quando esgota." : "Vazio = sem limite. Quando esgotar, a venda fecha sozinha."}
        >
          <input className={cx(dialogInputClass, !lotacaoOk && "border-risk")} inputMode="numeric" value={lotacao} onChange={(e) => setLotacao(e.target.value)} />
        </DialogField>
        <DialogField label="Nota para quem compra" hint="Aparece ao lado dos bilhetes.">
          <textarea className={cx(dialogInputClass, "h-20 py-2")} value={b.nota} onChange={(e) => setB({ ...b, nota: e.target.value })} />
        </DialogField>
      </div>
    </Dialog>
  );
}
