import { useRef, useState } from "react";
import { PageHeader } from "@/components/Shell";
import { Empty, Panel, cx } from "@/components/primitives";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ChevronDown, ChevronUp, ExternalLink, Handshake, ImagePlus, Loader2, Plus } from "@/lib/icons";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { useStore } from "@/lib/store";
import { mostrarErro, mostrarOk, textoDoErro } from "@/lib/avisos";
import {
  apagarPatrocinador,
  dominioDe,
  enviarLogotipo,
  guardarPatrocinador,
  moverPatrocinador,
  usePatrocinadores,
  type PatrocinadorDoClube,
} from "@/lib/patrocinadores";

/**
 * Gestão → Patrocinadores.
 *
 * Os patrocinadores e parceiros do clube, numa lista só: é a mesma que o site
 * mostra no fundo de todas as páginas (Connect Pro) e a que os sócios veem no
 * separador Parcerias da app. A vantagem é opcional; quem a tem aparece na
 * app com ela, e é por ela que o sócio lá vai.
 */
export default function Patrocinadores() {
  return (
    <>
      <PageHeader eyebrow="Gestão" title="Patrocinadores" subtitle="Os parceiros do clube e a vantagem de cada um para os sócios." />
      <EditorDePatrocinadores />
    </>
  );
}

/** O editor, também usado no menu Website (a mesma lista). */
export function EditorDePatrocinadores() {
  const store = useStore();
  const { session } = useSession();
  const { lista, noSite, carregado, erro } = usePatrocinadores(store.academy.slug);
  const podeEditar = can(session, "sponsor:write") || can(session, "website:write");
  const [aEditar, setAEditar] = useState<PatrocinadorDoClube | null>(null);

  const novo = () => setAEditar({ id: "", nome: "", url: "", logo: "", vantagem: "" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[70ch] text-meta leading-relaxed text-ink-3">
          {noSite
            ? "Aparecem no separador Parcerias da app dos sócios e no fundo de todas as páginas do site do clube."
            : "Aparecem no separador Parcerias da app dos sócios. O separador só existe quando há pelo menos um."}
        </p>
        {podeEditar && (
          <button type="button" className="ctl-primary" onClick={novo}>
            <Plus className="size-4" strokeWidth={2} />
            Novo patrocinador
          </button>
        )}
      </div>

      <Panel className="overflow-hidden">
        {erro && !carregado ? (
          <p className="px-5 py-8 text-center text-meta text-ink-3">{erro}</p>
        ) : !carregado ? null : lista.length === 0 ? (
          <Empty
            icon={Handshake}
            title="Ainda sem patrocinadores"
            detail="Junta os parceiros do clube com o logótipo, o site e a vantagem que dão aos sócios. Os sócios passam a vê-los na app."
          >
            {podeEditar && (
              <button type="button" className="ctl-outline" onClick={novo}>
                <Plus className="size-4" strokeWidth={2} />
                Juntar o primeiro
              </button>
            )}
          </Empty>
        ) : (
          <ul>
            {lista.map((p, i) => (
              <Linha
                key={p.id}
                p={p}
                primeiro={i === 0}
                ultimo={i === lista.length - 1}
                podeEditar={podeEditar}
                onEditar={() => setAEditar(p)}
              />
            ))}
          </ul>
        )}
      </Panel>

      {aEditar && <JanelaDoPatrocinador inicial={aEditar} onClose={() => setAEditar(null)} />}
    </div>
  );
}

function Logotipo({ p, className }: { p: Pick<PatrocinadorDoClube, "logo" | "nome">; className?: string }) {
  return (
    <span className={cx("grid shrink-0 place-items-center overflow-hidden rounded-[8px] border border-line bg-white", className)}>
      {p.logo ? (
        <img src={p.logo} alt="" className="max-h-[78%] max-w-[82%] object-contain" />
      ) : (
        <span className="text-[13px] font-semibold tracking-[-0.01em] text-ink-3">{iniciais(p.nome)}</span>
      )}
    </span>
  );
}

function Linha({
  p,
  primeiro,
  ultimo,
  podeEditar,
  onEditar,
}: {
  p: PatrocinadorDoClube;
  primeiro: boolean;
  ultimo: boolean;
  podeEditar: boolean;
  onEditar: () => void;
}) {
  return (
    <li className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:gap-4">
      <Logotipo p={p} className="h-12 w-20" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-medium text-ink">{p.nome}</div>
        <div className={cx("truncate text-meta", p.vantagem ? "text-ink-2" : "text-ink-4")}>{p.vantagem || "Sem vantagem para sócios"}</div>
        {p.url && (
          <a
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex max-w-full items-center gap-1 text-meta text-ink-3 hover:text-ink sm:hidden"
          >
            <span className="truncate">{dominioDe(p.url)}</span>
          </a>
        )}
      </div>
      {p.url && (
        <a
          href={p.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden max-w-[220px] items-center gap-1.5 text-meta text-ink-3 hover:text-ink sm:inline-flex"
        >
          <span className="truncate">{dominioDe(p.url)}</span>
          <ExternalLink className="size-3.5 shrink-0" strokeWidth={1.75} />
        </a>
      )}
      {podeEditar && (
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className="ctl-ghost size-8 justify-center px-0 max-sm:hidden"
            aria-label={`Subir ${p.nome}`}
            title="Subir"
            disabled={primeiro}
            onClick={() => void moverPatrocinador(p.id, -1)}
          >
            <ChevronUp className="size-4" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="ctl-ghost size-8 justify-center px-0 max-sm:hidden"
            aria-label={`Descer ${p.nome}`}
            title="Descer"
            disabled={ultimo}
            onClick={() => void moverPatrocinador(p.id, 1)}
          >
            <ChevronDown className="size-4" strokeWidth={1.9} />
          </button>
          <button type="button" className="ctl-outline ml-1" onClick={onEditar}>
            Editar
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Criar ou editar um patrocinador: logótipo, nome, site e vantagem.
 *
 * Grava no Guardar, não a cada letra. O logótipo carrega-se logo ao escolher
 * (para se ver), mas só fica no patrocinador quando se guarda.
 */
function JanelaDoPatrocinador({ inicial, onClose }: { inicial: PatrocinadorDoClube; onClose: () => void }) {
  const [p, setP] = useState(inicial);
  const [aCarregar, setACarregar] = useState(false);
  const [aGuardar, setAGuardar] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const ficheiro = useRef<HTMLInputElement | null>(null);
  const novo = !inicial.id;

  const escolher = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setACarregar(true);
    try {
      const logo = await enviarLogotipo(f);
      setP((x) => ({ ...x, logo }));
    } catch (err) {
      mostrarErro(textoDoErro(err, "Não foi possível usar esta imagem."));
    } finally {
      setACarregar(false);
    }
  };

  const guardar = async () => {
    if (!p.nome.trim()) return;
    setAGuardar(true);
    try {
      await guardarPatrocinador(p);
      mostrarOk(novo ? `${p.nome.trim()} já está nos patrocinadores.` : "Patrocinador guardado.");
      onClose();
    } catch {
      /* O erro já está no cartão de erros. */
    } finally {
      setAGuardar(false);
    }
  };

  return (
    <>
      <Dialog
        title={novo ? "Novo patrocinador" : p.nome || "Patrocinador"}
        subtitle="Aparece na app dos sócios, e no site quando o clube o tem."
        onClose={onClose}
        width={500}
        footer={
          <>
            {!novo && (
              <button type="button" className="ctl-ghost mr-auto text-risk" onClick={() => setConfirmar(true)}>
                Apagar
              </button>
            )}
            <button type="button" className="ctl-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="ctl-primary" disabled={!p.nome.trim() || aGuardar || aCarregar} onClick={() => void guardar()}>
              {aGuardar && <Loader2 className="size-4 animate-spin" strokeWidth={2} />}
              {novo ? "Juntar" : "Guardar"}
            </button>
          </>
        }
      >
        <form
          className="space-y-4 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void guardar();
          }}
        >
          <div className="flex items-center gap-4">
            <input ref={ficheiro} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={escolher} />
            <button
              type="button"
              onClick={() => ficheiro.current?.click()}
              disabled={aCarregar}
              aria-label={p.logo ? "Trocar o logótipo" : "Carregar o logótipo"}
              className={cx(
                "grid h-20 w-32 shrink-0 place-items-center overflow-hidden rounded-[10px] border transition-colors",
                p.logo ? "border-line bg-white hover:border-line-strong" : "border-dashed border-line-strong bg-sunken/40 text-ink-3 hover:border-ink-3 hover:text-ink",
              )}
            >
              {aCarregar ? (
                <Loader2 className="size-5 animate-spin" strokeWidth={1.75} />
              ) : p.logo ? (
                <img src={p.logo} alt="" className="max-h-16 max-w-28 object-contain" />
              ) : (
                <span className="flex flex-col items-center gap-1 text-[12px] font-medium">
                  <ImagePlus className="size-5" strokeWidth={1.75} />
                  Logótipo
                </span>
              )}
            </button>
            <div className="min-w-0 text-meta leading-relaxed text-ink-3">
              <p>PNG com fundo transparente fica melhor. Aparece numa caixa branca.</p>
              {p.logo && !aCarregar && (
                <button type="button" className="mt-1 font-medium text-risk hover:underline" onClick={() => setP((x) => ({ ...x, logo: "" }))}>
                  Tirar o logótipo
                </button>
              )}
            </div>
          </div>

          <DialogField label="Nome">
            <input
              className={dialogInputClass}
              value={p.nome}
              maxLength={120}
              autoFocus={novo}
              placeholder="Farmácia Central"
              onChange={(e) => setP((x) => ({ ...x, nome: e.target.value }))}
            />
          </DialogField>

          <DialogField label="Site" hint="opcional">
            <input
              className={dialogInputClass}
              value={p.url}
              maxLength={500}
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="farmaciacentral.pt"
              onChange={(e) => setP((x) => ({ ...x, url: e.target.value }))}
            />
          </DialogField>

          <DialogField label="Vantagem para os sócios" hint={`${p.vantagem.length}/160`}>
            <input
              className={dialogInputClass}
              value={p.vantagem}
              maxLength={160}
              placeholder="10 % de desconto em todas as compras"
              onChange={(e) => setP((x) => ({ ...x, vantagem: e.target.value }))}
            />
          </DialogField>
          <p className="-mt-2 text-meta text-ink-4">Opcional. Sem vantagem, aparece só como patrocinador.</p>
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      </Dialog>

      {confirmar && (
        <ConfirmDialog
          title={`Apagar ${inicial.nome}?`}
          onClose={() => setConfirmar(false)}
          onConfirm={async () => {
            await apagarPatrocinador(inicial.id);
            mostrarOk(`${inicial.nome} apagado.`);
            setConfirmar(false);
            onClose();
          }}
        >
          Sai da app dos sócios e do site do clube. Não se desfaz.
        </ConfirmDialog>
      )}
    </>
  );
}

function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "·";
}
