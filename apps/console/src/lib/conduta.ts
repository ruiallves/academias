import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/http";
import type { Tone } from "@/components/primitives";

/**
 * O canal de denúncia e os documentos de conduta, do lado da consola.
 *
 * Os tipos são o que `ConductService` devolve a quem tem `conduct:read`:
 * nunca trazem quem enviou quando o caso é anónimo, e isso é decisão do
 * servidor, não desta camada.
 */

export type EstadoDaDenuncia = "NEW" | "IN_REVIEW" | "RESOLVED" | "ARCHIVED";
export type CategoriaDaDenuncia = "BULLYING" | "ETHICS" | "DISCRIMINATION" | "SAFETY" | "OTHER";

export type Denuncia = {
  id: string;
  number: number;
  category: CategoriaDaDenuncia;
  categoryLabel: string;
  status: EstadoDaDenuncia;
  statusLabel: string;
  anonymous: boolean;
  athlete: { id: string; name: string; team: string | null } | null;
  happenedOn: string | null;
  place: string | null;
  involved: string | null;
  description: string;
  createdAt: string;
  resolvedAt: string | null;
  lastMessageAt: string | null;
  /** Só quando não é anónima. */
  reporter: { name: string; email: string | null; phone: string | null; role: string | null } | null;
  assignee: { id: string; name: string } | null;
  /** O clube ainda não abriu o caso, ou há mensagem nova da família. */
  unread: boolean;
};

export type MensagemDaDenuncia = {
  id: string;
  fromStaff: boolean;
  internal: boolean;
  authorName: string | null;
  body: string;
  createdAt: string;
};

export type DenunciaCompleta = Denuncia & { messages: MensagemDaDenuncia[] };

export const ESTADOS: { value: EstadoDaDenuncia; label: string; tone: Tone; hint: string }[] = [
  { value: "NEW", label: "Nova", tone: "risk", hint: "ninguém pegou nela" },
  { value: "IN_REVIEW", label: "Em análise", tone: "warn", hint: "o clube está a tratar" },
  { value: "RESOLVED", label: "Resolvida", tone: "ok", hint: "fechada com seguimento" },
  { value: "ARCHIVED", label: "Arquivada", tone: "neutral", hint: "fechada sem seguimento" },
];

export const tomDoEstado = (s: EstadoDaDenuncia): Tone => ESTADOS.find((e) => e.value === s)?.tone ?? "neutral";

export const listarDenuncias = (estado?: EstadoDaDenuncia) =>
  apiGet<Denuncia[]>(`/api/denuncias${estado ? `?estado=${estado}` : ""}`);

export const verDenuncia = (id: string) => apiGet<DenunciaCompleta>(`/api/denuncias/${id}`);

export const responderDenuncia = (id: string, body: string, internal: boolean) =>
  apiPost<MensagemDaDenuncia>(`/api/denuncias/${id}/mensagens`, { body, internal });

export const atualizarDenuncia = (id: string, patch: { status?: EstadoDaDenuncia; assigneeId?: string | null }) =>
  apiPatch<Denuncia>(`/api/denuncias/${id}`, patch);

export const responsaveisDasDenuncias = () =>
  apiGet<{ id: string; name: string; title: string | null }[]>("/api/denuncias/responsaveis");

export const resumoDasDenuncias = () => apiGet<{ novas: number; emAnalise: number; porLer: number }>("/api/denuncias/resumo");

/* -------------------------------------------------------------------------- */
/* Os documentos de conduta                                                    */
/* -------------------------------------------------------------------------- */

export type FicheiroDeConduta = { key: string; name: string; type: string; url: string | null };
export type DocumentoDeConduta = {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  files: FicheiroDeConduta[];
  /** Quantos pais abriram (só para quem gere os documentos). Ausente num servidor antigo. */
  reads?: { opened: number; total: number };
};

export const listarDocumentosDeConduta = () => apiGet<DocumentoDeConduta[]>("/api/conduta/documentos");

/** Uma pessoa na lista "Quem abriu": um encarregado ou um atleta com conta. */
export type LeitorDeConduta = {
  userId: string;
  kind: "GUARDIAN" | "ATHLETE";
  name: string;
  email: string | null;
  athletes: { id: string; name: string; teams: { id: string; name: string }[] }[];
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  count: number;
};

export type LeiturasDeConduta = {
  document: { id: string; title: string; updatedAt: string };
  teams: { id: string; name: string }[];
  people: LeitorDeConduta[];
};

export const leiturasDoDocumento = (id: string) => apiGet<LeiturasDeConduta>(`/api/conduta/documentos/${id}/leituras`);

/*
 * A última lista que chegou, guardada fora do ecrã.
 *
 * As Definições pedem-na mal abrem (`carregarDocumentosDeConduta` em
 * `Settings.tsx`), e a secção Conduta abre com o que já cá está: a caixa
 * aparece logo, em vez de ficar em branco à espera da resposta. Ao abrir, a
 * secção pede outra vez e substitui: os links dos ficheiros duram dez minutos.
 */
let emCache: DocumentoDeConduta[] | null = null;
let emCurso: Promise<DocumentoDeConduta[]> | null = null;

export const documentosDeCondutaEmCache = () => emCache;

/** Vai buscar a lista (um pedido de cada vez) e guarda-a. `forcar` pede outra mesmo havendo uma em cache. */
export function carregarDocumentosDeConduta(forcar = false): Promise<DocumentoDeConduta[]> {
  if (emCurso) return emCurso;
  if (emCache && !forcar) return Promise.resolve(emCache);
  emCurso = listarDocumentosDeConduta()
    .then((d) => {
      emCache = d;
      return d;
    })
    .finally(() => {
      emCurso = null;
    });
  return emCurso;
}

/** Carrega um ficheiro e devolve a chave com que ficou guardado. Os mesmos três passos dos documentos dos atletas. */
export async function carregarFicheiroDeConduta(file: File): Promise<{ key: string; name: string }> {
  const a = await apiPost<{ url: string; headers?: Record<string, string>; key: string; maxBytes: number }>(
    "/api/conduta/documentos/upload",
    { contentType: file.type },
  );
  if (file.size > a.maxBytes) throw new Error(`«${file.name}» tem mais de ${Math.round(a.maxBytes / 1024 / 1024)} MB`);
  const r = await fetch(a.url, { method: "PUT", headers: { "Content-Type": file.type, ...(a.headers ?? {}) }, body: file });
  if (!r.ok) throw new Error(`Não foi possível carregar «${file.name}»`);
  return { key: a.key, name: file.name };
}

export const criarDocumentoDeConduta = (dto: { title: string; description: string | null; files: { key: string; name: string }[] }) =>
  apiPost<DocumentoDeConduta>("/api/conduta/documentos", dto);

export const atualizarDocumentoDeConduta = (
  id: string,
  dto: { title?: string; description?: string | null; addFiles?: { key: string; name: string }[] },
) => apiPatch<DocumentoDeConduta>(`/api/conduta/documentos/${id}`, dto);

export const tirarFicheiroDeConduta = (id: string, key: string) =>
  apiPost<{ ok: true }>(`/api/conduta/documentos/${id}/remover-ficheiro`, { key });

export const apagarDocumentoDeConduta = (id: string) => apiDelete<{ ok: true }>(`/api/conduta/documentos/${id}`);
