import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, FileText } from "lucide-react";
import { LegalMarkdown } from "@academia/ui/legal-markdown";
import { ApiError } from "@/lib/http";
import { onLegalRequired } from "@/lib/legal-signal";
import { signOut } from "@/lib/session";
import {
  acceptanceLabel,
  dataPT,
  legalAccept,
  legalDocument,
  legalStatus,
  type LegalDocumentFull,
  type LegalStatus,
  type PendingDocument,
} from "@/lib/legal";

/**
 * A porta legal da app do clube.
 *
 * Corre depois de se saber que contextos a conta tem e antes de qualquer vista:
 * com documentos por aceitar, o servidor recusa o resto (`LEGAL_ACCEPTANCE_REQUIRED`).
 * É a mesma peça da consola, desenhada para o telemóvel: uma coluna, os documentos
 * em lista, cada um abre em ecrã inteiro para ler, e o botão só acorda com tudo
 * marcado. Quem não tem nada por aceitar nunca a vê.
 */
export function LegalGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LegalStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setStatus(await legalStatus());
    } catch (e) {
      // Sem vínculo nenhum aqui não há gate — a app explica o resto melhor.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404)) {
        setStatus({ audiences: [], canBindClub: false, needsAuthority: false, pending: [], accepted: [], isUpdate: false });
        return;
      }
      setError(e instanceof Error ? e.message : "Não foi possível verificar os termos.");
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /*
   * Os documentos podem ser publicados com a app já aberta. O cliente HTTP
   * avisa quando o servidor recusar por causa disso, e aqui volta-se a
   * perguntar o que falta — sem recarregar nada. Ver `legal-signal.ts`.
   */
  useEffect(() => onLegalRequired(() => void carregar()), [carregar]);

  if (error) {
    return (
      <Moldura title="Não foi possível verificar os termos">
        <p className="max-w-[34ch] text-meta leading-relaxed text-ink-3">{error}</p>
        <button type="button" className="cta mt-2" onClick={() => { setError(null); void carregar(); }}>
          Tentar outra vez
        </button>
      </Moldura>
    );
  }
  if (!status) return <div className="min-h-dvh" aria-busy />;
  if (status.pending.length === 0) return <>{children}</>;
  return <Aceitar status={status} onAccepted={setStatus} />;
}

function Aceitar({ status, onAccepted }: { status: LegalStatus; onAccepted: (s: LegalStatus) => void }) {
  const { pending, isUpdate, needsAuthority } = status;
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const [autoridade, setAutoridade] = useState(false);
  const [aLer, setALer] = useState<PendingDocument | null>(null);
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const doClube = useMemo(() => pending.filter((p) => p.scope === "CLUB"), [pending]);
  const completo = pending.every((p) => marcados[p.id]) && (!needsAuthority || autoridade);

  const continuar = async () => {
    setAGravar(true);
    setErro(null);
    try {
      onAccepted(
        await legalAccept({
          documentIds: pending.map((p) => p.id),
          confirmAuthority: needsAuthority ? autoridade : undefined,
        }),
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível registar a aceitação.");
    } finally {
      setAGravar(false);
    }
  };

  if (aLer) return <Ler doc={aLer} onBack={() => setALer(null)} />;

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col px-5 pt-[calc(28px+env(safe-area-inset-top))] pb-[calc(24px+env(safe-area-inset-bottom))]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Academias</p>
      <h1 className="mt-2 text-[24px] font-semibold leading-tight tracking-[-0.01em] text-ink">
        {isUpdate ? "Os termos foram atualizados" : "Antes de começar"}
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
        {isUpdate
          ? "Atualizámos os nossos documentos legais. Para continuar, revê e aceita as versões atuais."
          : doClube.length > 0
            ? "Confirma que estás autorizado a utilizar o Academias em nome do clube e aceita os documentos abaixo."
            : "Para utilizar a app do clube, lê e aceita os documentos abaixo."}
      </p>

      <div className="mt-6 divide-y divide-line rounded-[var(--radius-md)] border border-line bg-surface">
        {needsAuthority && (
          <Linha
            checked={autoridade}
            onChange={setAutoridade}
            label="Confirmo que estou autorizado a representar o clube e a utilizar o Academias em nome dele."
          />
        )}
        {pending.map((doc) => (
          <Linha
            key={doc.id}
            checked={Boolean(marcados[doc.id])}
            onChange={(v) => setMarcados((m) => ({ ...m, [doc.id]: v }))}
            label={acceptanceLabel(doc)}
            // A versão fica onde o documento se lê — ver a nota no gate da consola.
            hint={doc.scope === "CLUB" ? "Em nome do clube" : undefined}
            onRead={() => setALer(doc)}
          />
        ))}
      </div>

      {erro && <p className="mt-3 text-meta text-risk">{erro}</p>}

      <div className="mt-auto pt-6">
        <button type="button" className="cta w-full disabled:opacity-40" disabled={!completo || aGravar} onClick={() => void continuar()}>
          {aGravar ? "A registar…" : "Continuar"}
        </button>
        <button
          type="button"
          onClick={() => signOut()}
          className="mt-4 block w-full text-center text-meta font-semibold text-ink-3 underline-offset-2 active:underline"
        >
          Sair sem aceitar
        </button>
      </div>
    </div>
  );
}

function Linha({
  checked,
  onChange,
  label,
  hint,
  onRead,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  onRead?: () => void;
}) {
  return (
    <div className="px-4 py-3.5">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-[3px] size-[18px] shrink-0 accent-[var(--color-signal)]"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium leading-snug text-ink">{label}</span>
          {hint && <span className="mt-0.5 block text-meta text-ink-3">{hint}</span>}
        </span>
      </label>
      {onRead && (
        <button
          type="button"
          onClick={onRead}
          className="ml-[30px] mt-2 inline-flex items-center gap-1.5 text-meta font-semibold text-ink-2 active:text-ink"
        >
          <FileText className="size-[15px]" strokeWidth={1.9} />
          Ler documento
        </button>
      )}
    </div>
  );
}

/** O documento em ecrã inteiro, com o caminho de volta no topo. */
function Ler({ doc, onBack }: { doc: { slug: string; title: string; version: string }; onBack: () => void }) {
  const [full, setFull] = useState<LegalDocumentFull | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    legalDocument(doc.slug)
      .then((d) => vivo && setFull(d))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Não foi possível abrir o documento."));
    return () => {
      vivo = false;
    };
  }, [doc.slug]);

  return (
    <div className="mx-auto min-h-dvh max-w-[480px]">
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-canvas/90 px-3 pt-[calc(10px+env(safe-area-inset-top))] pb-2 backdrop-blur-xl">
        <button type="button" onClick={onBack} aria-label="Voltar" className="grid size-10 place-items-center rounded-full active:bg-sunken">
          <ArrowLeft className="size-5" strokeWidth={1.9} />
        </button>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-ink">{doc.title}</p>
          <p className="text-meta text-ink-3">
            Versão {full?.version ?? doc.version}
            {full && ` · em vigor desde ${dataPT(full.effectiveAt)}`}
          </p>
        </div>
      </header>
      <div className="px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-2">
        {erro && <p className="text-meta text-risk">{erro}</p>}
        {full && <LegalMarkdown content={full.content} className="legal-prose" />}
        <button type="button" onClick={onBack} className="cta-quiet mt-8 w-full">
          Voltar
        </button>
      </div>
    </div>
  );
}

function Moldura({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
      <p className="text-[19px] font-semibold text-ink">{title}</p>
      {children}
      <button type="button" onClick={() => signOut()} className="mt-1 text-meta font-semibold text-ink-3 underline-offset-2 active:underline">
        Entrar com outra conta
      </button>
    </div>
  );
}
