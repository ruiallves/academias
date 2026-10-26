import { useEffect, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { Spinner } from "@/components/Busy";
import { cx } from "@/components/primitives";
import { Check, Trash2, TriangleAlert } from "@/lib/icons";
import { apiPost } from "@/lib/http";
import { KIND_LABEL, type EventKind } from "@/lib/calendar";
import { reloadAcademy } from "@/lib/store";

/**
 * Apagar um evento (treino, jogo, torneio ou outro), de vez.
 *
 * Abre-se a partir do próprio evento: a gaveta do calendário, a janela de
 * edição, a página do jogo e a do treino. Usa o mesmo pedido do "Apagar
 * eventos" do calendário (`POST /api/events/cancelar-varios`, com um id só),
 * por isso as regras são as do servidor (`cancelarVarios`):
 *
 * - pode já ter passado;
 * - só o das equipas de quem pede, com `calendar:write`;
 * - um evento **sem nada registado** apaga-se com uma confirmação simples;
 * - um evento **com dados** (resultado, ficha, convocatória, presenças,
 *   planos…) só a direção o apaga, e a janela lista o que se perde e pede que
 *   se confirme de propósito. Os dados vão com o evento, por isso as
 *   estatísticas dos atletas deixam de o contar;
 * - bilhetes vendidos e análises de vídeo travam sempre.
 *
 * Ao abrir pergunta ao servidor (o ensaio). Assim a janela diz logo o que
 * acontece, em vez de pedir uma confirmação que depois falha.
 */
type Linha = { id: string; ok: boolean; motivo?: string; perdas?: string[]; comDadosPossivel?: boolean };
type Resposta = { feitos: number; linhas: Linha[] };
type Estado = "a-verificar" | "pode" | "com-dados" | "nao-pode";

export function ApagarEventoDialog({
  id,
  descricao,
  onClose,
  onApagado,
}: {
  id: string;
  /** O que se mostra por baixo do título: "Sub-13 · Treino · sáb, 1 nov, 10:00". */
  descricao: string;
  onClose: () => void;
  /** Depois de apagado e com a consola já recarregada. Quem chama decide para onde ir. */
  onApagado: () => void;
}) {
  const [estado, setEstado] = useState<Estado>("a-verificar");
  const [linha, setLinha] = useState<Linha | null>(null);
  /** No caso com dados: a pessoa disse que percebeu o que se perde. */
  const [percebi, setPercebi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const pedir = (ensaio: boolean, comDados = false) =>
    apiPost<Resposta>("/api/events/cancelar-varios", { ids: [id], acao: "apagar", ensaio, ...(comDados ? { comDados: true } : {}) });

  function ler(r: Resposta) {
    const l = r.linhas.find((x) => x.id === id) ?? null;
    setLinha(l);
    setPercebi(false);
    if (r.feitos === 1) setEstado("pode");
    else if (l?.comDadosPossivel) setEstado("com-dados");
    else setEstado("nao-pode");
  }

  useEffect(() => {
    let vivo = true;
    pedir(true)
      .then((r) => vivo && ler(r))
      .catch((e) => {
        if (!vivo) return;
        setEstado("nao-pode");
        setLinha({ id, ok: false, motivo: e instanceof Error ? e.message : undefined });
      });
    return () => {
      vivo = false;
    };
  }, [id]);

  async function apagar() {
    if (busy) return;
    const comDados = estado === "com-dados";
    if (comDados && !percebi) return;
    setBusy(true);
    setErro(null);
    try {
      const r = await pedir(false, comDados);
      if (r.feitos !== 1) {
        // Entre o ensaio e agora, alguma coisa mudou no evento: mostra-se o estado novo.
        ler(r);
        return;
      }
      await reloadAcademy();
      onApagado();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível apagar o evento.");
    } finally {
      setBusy(false);
    }
  }

  const podeConfirmar = estado === "pode" || (estado === "com-dados" && percebi);

  return (
    <Dialog
      title="Apagar evento"
      subtitle={descricao}
      icon={<Trash2 className="size-4 text-risk" strokeWidth={1.75} />}
      onClose={() => !busy && onClose()}
      width={estado === "com-dados" ? 500 : 440}
      labelledBy="apagar-evento"
      footer={
        estado === "pode" || estado === "com-dados" ? (
          <>
            <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void apagar()}
              disabled={busy || !podeConfirmar}
              className="ctl-risk"
              autoFocus={estado === "pode"}
            >
              <Trash2 className="size-3.5" strokeWidth={1.9} />
              {busy ? "A apagar…" : estado === "com-dados" ? "Apagar com os dados" : "Apagar evento"}
            </button>
          </>
        ) : (
          <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
            Fechar
          </button>
        )
      }
    >
      <div className="space-y-3 px-5 py-4 text-body leading-relaxed text-ink-2">
        {estado === "a-verificar" && <Spinner className="py-4" />}

        {estado === "pode" && (
          <p>Este evento desaparece do calendário e da app das famílias. Não há forma de o recuperar.</p>
        )}

        {estado === "com-dados" && (
          <>
            <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-risk-soft px-3 py-2.5 text-ink">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-risk" strokeWidth={1.75} />
              <span>
                Este evento já tem dados registados. Apagá-lo apaga também:
              </span>
            </p>
            <ul className="space-y-1.5 pl-1">
              {(linha?.perdas ?? []).map((p) => (
                <li key={p} className="flex items-start gap-2">
                  <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-risk" aria-hidden />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <p className="text-meta text-ink-3">
              Os números dos atletas deixam de contar este evento logo a seguir. Os relatórios de atleta já publicados guardam
              os números do dia em que foram publicados e não mudam.
            </p>
            {/* Um botão e não um <label> com checkbox: no telemóvel, tocar dentro de rótulos falha (ver check:toque). */}
            <button
              type="button"
              aria-pressed={percebi}
              onClick={() => setPercebi((x) => !x)}
              className="flex w-full items-center gap-2.5 rounded-[var(--radius-control)] border border-line px-3 py-2.5 text-left transition-colors hover:bg-sunken"
            >
              <span
                className={cx(
                  "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                  percebi ? "border-risk bg-risk text-white" : "border-line-strong",
                )}
              >
                {percebi && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className="text-body text-ink">Percebo que estes dados se apagam e não se recuperam.</span>
            </button>
          </>
        )}

        {estado === "nao-pode" && (
          <>
            <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-warn-soft/60 px-3 py-2.5 text-ink">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={1.75} />
              <span>
                Este evento não pode ser apagado.
                {linha?.motivo && <span className="mt-0.5 block text-meta text-ink-2">{explicar(linha.motivo)}</span>}
              </span>
            </p>
            {/* Tem dados, e quem pede não é da direção: diz-se a quem pedir. */}
            {linha?.perdas && linha.perdas.length > 0 && (
              <p className="text-meta text-ink-3">
                Um evento com dados registados só pode ser apagado pela direção do clube, porque as estatísticas e as presenças
                dos atletas vão com ele.
              </p>
            )}
          </>
        )}

        {erro && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{erro}</p>}
      </div>
    </Dialog>
  );
}

/** "Sub-13 · Treino · sáb., 01/11 · 10:00": o subtítulo da janela. */
export function descreverEvento(e: { title: string; kind: EventKind; teamName?: string | null; start: Date }): string {
  const dia = e.start.toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "2-digit" });
  const hora = e.start.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  const oQue = e.kind === "match" ? e.title : [e.teamName, KIND_LABEL[e.kind]].filter(Boolean).join(" · ");
  return `${oQue} · ${dia} · ${hora}`;
}

/** Os motivos do servidor, escritos para quem está a olhar para um só evento. */
function explicar(motivo: string): string {
  if (motivo === "Fora das tuas equipas") return "É de uma equipa que não é tua.";
  return motivo.endsWith(".") ? motivo : `${motivo}.`;
}
