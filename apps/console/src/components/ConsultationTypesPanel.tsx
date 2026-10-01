import { useEffect, useRef, useState, type FormEvent } from "react";
import { addItem, renameItem, setItemColor, toggleArchived, useCatalog } from "@/lib/catalogs";
import { kindOfConsultationType } from "@/lib/clinical";
import { Check, Pencil, Plus, RotateCcw, X } from "@/lib/icons";
import { corDaArea } from "./ConsultasMes";
import { Erro, campoClass } from "./definicoes/ui";

/**
 * Os tipos de consulta do clube, nas Definições.
 *
 * ## Cartões, e não linhas
 *
 * Isto era uma lista: uma bola de cor de dezasseis pixéis, o nome, e dois botões
 * de texto. A cor é metade do que aqui se decide — é com ela que a consulta
 * aparece no calendário — e estava reduzida a um ponto. E "o primeiro vem
 * escolhido" lia-se numa etiqueta, perdida no fim da linha.
 *
 * Cada tipo passou a ser um cartão com a sua cor em cima, à largura toda, como a
 * consulta aparece no calendário. Tocar na faixa abre o seletor. O cartão novo é
 * o último da grelha, tracejado, no sítio onde o tipo novo vai aparecer.
 *
 * Estes tipos não são de uma modalidade, e a ordem deles decide uma coisa que se
 * tem de ver: o primeiro é o que vem escolhido ao agendar.
 */
export function ConsultationTypesPanel({ mayWrite, focus }: { mayWrite: boolean; focus?: boolean }) {
  const items = useCatalog("consultationTypes");
  const active = items.filter((i) => !i.archived);
  const archived = items.filter((i) => i.archived);
  const [novo, setNovo] = useState("");
  const [aCriar, setACriar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Quem chega de um "gerir" no diálogo de agendar veio por causa disto.
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);

  async function acrescentar(e: FormEvent) {
    e.preventDefault();
    if (!novo.trim()) return;
    setErro(null);
    try {
      await addItem("consultationTypes", novo);
      setNovo("");
      setACriar(false);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível acrescentar.");
    }
  }

  return (
    <div ref={ref}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h3 className="text-panel text-ink">Tipos de consulta</h3>
          <p className="mt-1 max-w-[62ch] text-meta leading-relaxed text-ink-3">
            O que o departamento clínico pode agendar em Consultas. A cor é a que a consulta leva no calendário.
          </p>
        </div>
        <span className="text-meta tabular text-ink-3">
          {active.length} {active.length === 1 ? "activo" : "activos"}
        </span>
      </div>

      {erro && (
        <div className="mb-3">
          <Erro>{erro}</Erro>
        </div>
      )}

      {active.length === 0 && (
        <p className="mb-3 rounded-[12px] border border-line bg-surface px-4 py-4 text-meta text-ink-3">
          Sem tipos activos. Enquanto não houver pelo menos um, não se agendam consultas.
        </p>
      )}

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {active.map((item, i) => (
          <Cartao
            key={item.id}
            id={item.id}
            label={item.label}
            color={item.color}
            primeiro={i === 0}
            mayWrite={mayWrite}
          />
        ))}

        {/*
          Acrescentar é o último cartão da grelha, no sítio onde o tipo novo vai
          aparecer.
        */}
        {mayWrite && (
          <li className="min-w-0">
            {aCriar ? (
              <form
                onSubmit={acrescentar}
                className="flex h-full min-h-[124px] flex-col justify-between gap-2 rounded-[12px] border border-dashed border-line-strong p-3"
              >
                <input
                  autoFocus
                  value={novo}
                  onChange={(e) => setNovo(e.target.value)}
                  placeholder="Psicologia, Podologia…"
                  aria-label="Novo tipo de consulta"
                  className={campoClass + " h-9"}
                />
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    className="ctl-ghost h-8"
                    onClick={() => {
                      setNovo("");
                      setACriar(false);
                    }}
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="ctl-primary h-8" disabled={!novo.trim()}>
                    Acrescentar
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setACriar(true)}
                className="flex h-full min-h-[124px] w-full flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-line-strong text-meta font-medium text-ink-3 transition-colors duration-[120ms] hover:border-ink-3 hover:text-ink"
              >
                <Plus className="size-4" strokeWidth={1.75} />
                Novo tipo
              </button>
            )}
          </li>
        )}
      </ul>

      {archived.length > 0 && (
        <div className="mt-7 border-t border-line pt-5">
          <h4 className="text-meta font-medium text-ink-3">
            Arquivados <span className="tabular text-ink-4">{archived.length}</span>
          </h4>
          <p className="mt-1 text-meta text-ink-4">Já não se agendam. As consultas antigas continuam com eles.</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {archived.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-1.5 rounded-full border border-line py-1 pr-1 pl-3 text-meta text-ink-3"
              >
                <span className="max-w-[22ch] truncate">{item.label}</span>
                {mayWrite && (
                  <button
                    type="button"
                    onClick={() => void toggleArchived("consultationTypes", item.id)}
                    className="flex size-6 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-sunken hover:text-ink"
                    aria-label={`Restaurar ${item.label}`}
                    title="Restaurar"
                  >
                    <RotateCcw className="size-3" strokeWidth={2} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Cartao({
  id,
  label,
  color,
  primeiro,
  mayWrite,
}: {
  id: string;
  label: string;
  color?: string;
  primeiro: boolean;
  mayWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [nome, setNome] = useState(label);
  const [erro, setErro] = useState<string | null>(null);
  const kind = kindOfConsultationType(label);
  const actual = color ?? corDaArea(kind).base;
  /*
   * A cor enquanto se escolhe. O seletor dispara a cada movimento do rato; o
   * servidor só recebe a última, meio segundo depois de parar.
   */
  const [cor, setCor] = useState(actual);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => setCor(actual), [actual]);
  useEffect(() => {
    if (cor.toLowerCase() === actual.toLowerCase()) return;
    const t = setTimeout(() => {
      setErro(null);
      setItemColor(id, cor).catch((e) => {
        setErro(e instanceof Error ? e.message : "Não foi possível gravar a cor.");
        setCor(actual);
      });
    }, 500);
    return () => clearTimeout(t);
  }, [cor, actual, id]);

  function guardar() {
    if (nome.trim()) void renameItem("consultationTypes", id, nome);
    setEditing(false);
  }

  return (
    <li className="flex min-h-[124px] min-w-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
      {/* A faixa de cor: é o cartão como a consulta aparece no calendário. */}
      <span className="relative block">
        <button
          type="button"
          disabled={!mayWrite}
          onClick={() => picker.current?.click()}
          className="group flex h-12 w-full items-end justify-between px-3 pb-1.5"
          style={{ background: cor }}
          aria-label={`Mudar a cor de ${label}`}
          title={mayWrite ? "Mudar a cor" : undefined}
        >
          {primeiro ? (
            <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-ink">vem escolhido</span>
          ) : (
            <span />
          )}
          {mayWrite && (
            <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-ink opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-visible:opacity-100">
              mudar cor
            </span>
          )}
        </button>
        {mayWrite && (
          <input
            ref={picker}
            type="color"
            value={cor}
            onChange={(e) => setCor(e.target.value)}
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none absolute top-full left-3 size-0 opacity-0"
          />
        )}
      </span>

      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            guardar();
          }}
          className="flex flex-1 items-center gap-1 px-2.5 py-2.5"
        >
          <input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            aria-label="Nome do tipo"
            className={campoClass + " h-9 min-w-0 flex-1 px-2.5"}
          />
          <button
            type="submit"
            className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ok hover:bg-ok-soft"
            aria-label="Guardar"
          >
            <Check className="size-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => {
              setNome(label);
              setEditing(false);
            }}
            className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-3 hover:bg-sunken"
            aria-label="Cancelar"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </form>
      ) : (
        <div className="flex flex-1 flex-col justify-between gap-2 px-3.5 pt-3 pb-2">
          <div className="min-w-0">
            <div className="truncate text-body font-medium text-ink" title={label}>
              {label}
            </div>
            {erro && <div className="mt-0.5 text-meta text-risk">{erro}</div>}
          </div>
          {mayWrite && (
            <div className="-mx-1.5 flex items-center justify-between">
              <button type="button" onClick={() => setEditing(true)} className="ctl-ghost h-7 text-meta text-ink-3 hover:text-ink">
                <Pencil className="size-3" strokeWidth={1.75} />
                Mudar nome
              </button>
              <button
                type="button"
                onClick={() => void toggleArchived("consultationTypes", id)}
                className="ctl-ghost h-7 text-meta text-ink-4 hover:text-ink"
              >
                Arquivar
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
