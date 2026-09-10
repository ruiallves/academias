import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { LegalMarkdown } from "@academia/ui/legal-markdown";
import { Dialog } from "./Dialog";
import { FileText } from "@/lib/icons";
import { ApiError } from "@/lib/http";
import { clearSession, signOut } from "@/lib/session";
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
 * A porta legal da consola.
 *
 * Fica entre o `LoginGate` e o `AcademyBoot` — com sessão, mas **antes** de
 * pedir a academia: com documentos por aceitar, o servidor recusa o
 * `/api/bootstrap` (e tudo o resto) com `LEGAL_ACCEPTANCE_REQUIRED`, por isso
 * de nada serviria arrancar. É a mesma pergunta que o `AcademyBoot` faz para o
 * perfil, feita um passo antes para os termos.
 *
 * Dois ecrãs, decididos pelo servidor e não por nós: **"Antes de começar"**
 * quando nada deste tipo foi aceite (a primeira entrada de um responsável de
 * clube novo, ou um clube que já cá estava e nunca aceitou formalmente), e
 * **"Os termos foram atualizados"** quando há uma versão anterior aceite. Em
 * ambos, cada documento abre-se e lê-se aqui, e o botão só acorda com tudo
 * marcado. Marcar não aceita nada: é o `POST /api/legal/accept` que aceita, e
 * o servidor volta a validar cada linha.
 *
 * Quem não tem nada por aceitar nunca vê isto — a resposta vem vazia e o
 * arranque segue.
 */
export function LegalGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LegalStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setStatus(await legalStatus());
    } catch (e) {
      // Sem sessão válida não há gate — o resto do arranque explica.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setStatus({ audiences: [], canBindClub: false, needsAuthority: false, pending: [], accepted: [], isUpdate: false });
        return;
      }
      setError(e instanceof Error ? e.message : "Não foi possível verificar os termos.");
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (error) return <GateError message={error} onRetry={() => { setError(null); void carregar(); }} />;
  if (!status) return <GateLoading />;
  if (status.pending.length === 0) return <>{children}</>;

  return <AcceptScreen status={status} onAccepted={setStatus} />;
}

/* -------------------------------------------------------------------------- */

function AcceptScreen({ status, onAccepted }: { status: LegalStatus; onAccepted: (s: LegalStatus) => void }) {
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
      const novo = await legalAccept({
        documentIds: pending.map((p) => p.id),
        confirmAuthority: needsAuthority ? autoridade : undefined,
      });
      onAccepted(novo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível registar a aceitação.");
    } finally {
      setAGravar(false);
    }
  };

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col px-5 py-10 md:py-16">
        <p className="text-group uppercase text-ink-3">Academias</p>
        <h1 className="mt-2 text-page text-ink">{isUpdate ? "Os termos do Academias foram atualizados" : "Antes de começar"}</h1>
        <p className="mt-3 max-w-[52ch] text-body leading-relaxed text-ink-2">
          {isUpdate
            ? "Atualizámos os nossos documentos legais. Para continuar a utilizar o Academias, precisamos que revejas e aceites as versões atuais."
            : doClube.length > 0
              ? "Para utilizar o Academias, confirma que estás autorizado a utilizar a plataforma em nome do clube e aceita os documentos abaixo."
              : "Para utilizar o Academias, lê e aceita os documentos abaixo."}
        </p>

        <div className="panel mt-8 divide-y divide-line">
          {needsAuthority && (
            <Linha
              checked={autoridade}
              onChange={setAutoridade}
              label="Confirmo que estou autorizado a representar o clube e a utilizar o Academias em nome dele."
              hint="Os Termos de Serviço e o Acordo de Tratamento de Dados vinculam o clube, não a pessoa que os aceita."
            />
          )}
          {pending.map((doc) => (
            <Linha
              key={doc.id}
              checked={Boolean(marcados[doc.id])}
              onChange={(v) => setMarcados((m) => ({ ...m, [doc.id]: v }))}
              label={acceptanceLabel(doc)}
              hint={
                <>
                  Versão {doc.version} · em vigor desde {dataPT(doc.effectiveAt)}
                  {doc.previousVersion && <> · tinhas aceite a {doc.previousVersion}</>}
                  {doc.scope === "CLUB" && <> · em nome do clube</>}
                </>
              }
              action={
                <button
                  type="button"
                  // `preventDefault`: o botão vive dentro do `<label>`, e abrir o
                  // documento não pode marcar a caixa por ele.
                  onClick={(e) => {
                    e.preventDefault();
                    setALer(doc);
                  }}
                  className="ctl-outline shrink-0"
                >
                  <FileText className="size-3.5" strokeWidth={1.75} />
                  Ler documento
                </button>
              }
            />
          ))}
        </div>

        {erro && <p className="mt-3 text-meta text-risk">{erro}</p>}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className="text-meta text-ink-3 underline-offset-2 hover:text-ink hover:underline"
            onClick={() => signOut()}
          >
            Sair sem aceitar
          </button>
          <button type="button" className="ctl-primary h-10 px-5" disabled={!completo || aGravar} onClick={() => void continuar()}>
            {aGravar ? "A registar…" : "Continuar"}
          </button>
        </div>

        <p className="mt-8 text-meta leading-relaxed text-ink-4">
          A aceitação fica registada com a data, a versão do documento e o dispositivo usado. Podes consultar o histórico nas
          Definições.
        </p>
      </div>

      {aLer && <ReadDialog doc={aLer} onClose={() => setALer(null)} />}
    </div>
  );
}

function Linha({
  checked,
  onChange,
  label,
  hint,
  action,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 px-5 py-4 max-md:flex-wrap">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-signal)]"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-meta text-ink-3">{hint}</span>}
      </span>
      {action && <span className="max-md:ml-7 max-md:w-full">{action}</span>}
    </label>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O documento inteiro, aqui mesmo — ninguém sai do gate para o ler. Também é
 * usado pelas Definições, por isso vive exportado.
 */
export function ReadDialog({ doc, onClose }: { doc: { slug: string; title: string; version: string }; onClose: () => void }) {
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
    <Dialog
      title={doc.title}
      subtitle={full ? `Versão ${full.version} · em vigor desde ${dataPT(full.effectiveAt)}` : `Versão ${doc.version}`}
      onClose={onClose}
      width={760}
      footer={
        <button type="button" onClick={onClose} className="ctl-primary">
          Fechar
        </button>
      }
    >
      <div className="px-5 py-5 md:px-8">
        {erro && <p className="text-meta text-risk">{erro}</p>}
        {!full && !erro && <div className="h-40" aria-busy />}
        {full && <LegalMarkdown content={full.content} className="legal-prose" />}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function GateLoading() {
  return (
    <div role="status" aria-label="A verificar os termos" className="flex min-h-dvh items-center justify-center bg-canvas">
      <span
        className="size-9 animate-spin rounded-full border-[3px] border-line"
        style={{ borderTopColor: "var(--color-signal-line, var(--color-signal))" }}
        aria-hidden
      />
    </div>
  );
}

function GateError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-[360px] text-center">
        <h1 className="mb-1.5 text-panel text-ink">Não foi possível verificar os termos</h1>
        <p className="mb-5 text-meta leading-relaxed text-ink-3">{message}</p>
        <div className="flex justify-center gap-2">
          <button type="button" onClick={onRetry} className="ctl-outline">
            Tentar outra vez
          </button>
          <button
            type="button"
            onClick={() => {
              clearSession();
              window.location.reload();
            }}
            className="ctl-primary"
          >
            Entrar outra vez
          </button>
        </div>
      </div>
    </div>
  );
}
