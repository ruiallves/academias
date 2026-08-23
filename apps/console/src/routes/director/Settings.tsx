import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { CatalogPanel } from "@/components/CatalogPanel";
import { ZeroZeroPanel } from "@/components/ZeroZeroPanel";
import { cx, Panel, PanelHead, Pill } from "@/components/primitives";
import { Check, CircleCheck, Wallet } from "@/lib/icons";
import { academy } from "@/lib/api";
import { CATALOG_KEYS, type CatalogKey } from "@/lib/catalogs";
import { can, type Permission } from "@/lib/permissions";
import { AREAS, CLINICAL_AREAS, SCOUTING_AREAS, levelOf, type Area } from "@/lib/access";
import { archiveRole, loadRoles, useRoles, type AcademyRole } from "@/lib/roles";
import { RoleDialog } from "@/components/RoleDialog";
import { useSession } from "@/session";
import { signalVars } from "@academia/ui/tokens";

/**
 * Definições — na prática, o ecrã de white-label.
 *
 * Mudar a cor aqui reescreve `--color-signal` no `:root` e a consola inteira segue,
 * ao vivo. Isso não é um truque de demonstração: é a prova de que o white-label é
 * um token, não um tema paralelo que alguém tem de manter.
 *
 * Repara no que **não** muda: verde de pago, vermelho de vencido. As cores
 * semânticas nunca são white-label — se fossem, cada academia teria um vocabulário
 * de estado diferente e o produto deixaria de se poder explicar.
 */

const PRESETS = [
  { name: "Verde-azulado", hex: "#0f6b62" },
  { name: "Azul-noite", hex: "#1f4d80" },
  { name: "Bordô", hex: "#8c2f39" },
  { name: "Terra", hex: "#a2542a" },
  { name: "Violeta", hex: "#5a4b9c" },
  { name: "Grafite", hex: "#3d3d3d" },
];

export default function Settings() {
  const { session } = useSession();
  const [signal, setSignal] = useState(academy.signalColor);
  const [params] = useSearchParams();
  // Deep-link a partir de qualquer diálogo que ofereça "gerir X" — p. ex. o local
  // no Novo evento. Chega aqui já com o catálogo certo aberto.
  const deepLinked = params.get("catalogo") as CatalogKey | null;

  const apply = (hex: string) => {
    setSignal(hex);
    for (const [key, value] of Object.entries(signalVars(hex))) {
      document.documentElement.style.setProperty(key, value);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Academia Life Club"
        title="Definições"
        subtitle="Identidade, desportos, papéis e pagamentos."
      />

      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          <Panel>
            <PanelHead title="Identidade" hint="o que as famílias vêem" />

            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Nome da academia" value={academy.name} />
              <Field label="Endereço da app" value={`${academy.slug}.academia.pt`} mono />
            </div>

            <div className="border-t border-line p-5">
              <div className="mb-1 text-meta font-medium text-ink">Cor de sinal</div>
              <p className="mb-3 max-w-[62ch] text-meta text-ink-3">
                Usada em identidade e selecção — navegação activa, foco, marca. Nunca em
                estado: pago é verde e vencido é vermelho em todas as academias.
              </p>

              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.hex}
                    type="button"
                    onClick={() => apply(p.hex)}
                    aria-pressed={signal === p.hex}
                    className={cx(
                      "inline-flex items-center gap-2 rounded-[var(--radius-control)] border px-2.5 py-1.5 text-meta font-medium transition-colors duration-[120ms]",
                      signal === p.hex ? "border-line-strong text-ink" : "border-line text-ink-2 hover:border-line-strong",
                    )}
                  >
                    <span className="flex size-4 items-center justify-center rounded-full" style={{ background: p.hex }}>
                      {signal === p.hex && <Check className="size-2.5 text-white" strokeWidth={3} />}
                    </span>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHead title="Desportos" hint="modalidades activas" />
            <ul className="px-5 py-1.5">
              {academy.sports.map((s) => (
                <li key={s.id} className="flex items-center gap-3 border-b border-line py-3 last:border-0">
                  <span className="w-32 shrink-0 text-body font-medium text-ink">{s.name}</span>
                  <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                    {s.positions.length ? (
                      s.positions.map((p) => <Pill key={p}>{p}</Pill>)
                    ) : (
                      // Natação não tem posições — e isso é configuração, não um caso
                      // especial no código.
                      <span className="text-meta text-ink-4">sem posições</span>
                    )}
                  </span>
                  <button type="button" className="ctl-ghost shrink-0">
                    Editar
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <ZeroZeroPanel session={session} />

          <Panel>
            <PanelHead
              title="Catálogos"
              hint="locais, escalões, cargos e tipos de evento — usados em toda a consola"
            />
            {CATALOG_KEYS.map((key) => (
              <CatalogPanel key={key} catalogKey={key} defaultOpen={deepLinked === key} />
            ))}
          </Panel>

          <RolesPanel />
        </div>

        <div className="space-y-3">
          <PwaPreview signal={signal} />

          <Panel>
            <PanelHead title="Pagamentos" />
            <div className="space-y-3 p-5">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-full bg-ok-soft text-ok">
                  <CircleCheck className="size-4" strokeWidth={1.75} />
                </span>
                <div>
                  <div className="text-body font-medium text-ink">euPago ligado</div>
                  <div className="text-meta text-ink-3">MB Way, Multibanco e cartão</div>
                </div>
              </div>

              <div className="rounded-[var(--radius-control)] border border-line bg-sunken/50 p-3">
                <div className="mb-1 flex items-center gap-1.5 text-meta font-medium text-ink">
                  <Wallet className="size-3.5" strokeWidth={1.75} />
                  Confirmação por webhook
                </div>
                <p className="text-meta text-ink-3">
                  O estado de um pagamento só muda quando a euPago confirma no servidor. O
                  navegador nunca decide se algo foi pago.
                </p>
              </div>

              <dl className="space-y-2 text-meta">
                <Row label="Dia de vencimento" value="8 de cada mês" />
                <Row label="Lembretes automáticos" value="3 dias antes e no dia" />
                <Row label="Débito directo SEPA" value="por activar" muted />
              </dl>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-meta font-medium text-ink">{label}</span>
      <input
        readOnly
        value={value}
        className={cx(
          "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body text-ink-2",
          mono && "font-mono text-meta",
        )}
      />
    </label>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2 last:border-0">
      <dt className="text-ink-3">{label}</dt>
      <dd className={cx("text-right font-medium", muted ? "text-ink-4" : "text-ink")}>{value}</dd>
    </div>
  );
}

/**
 * Papéis e permissões.
 *
 * Era uma matriz só de leitura, desenhada a partir do mapa em código: mostrava o
 * que estava decidido e não deixava decidir nada. Agora os papéis são linhas da
 * academia — cria-se, edita-se, escolhe-se o que cada um vê — e a matriz continua
 * lá porque a pergunta que ela responde ("porque é que o treinador não vê as
 * mensalidades?") não desapareceu; passou a ter resposta editável.
 */
function RolesPanel() {
  const { session } = useSession();
  const { roles, loaded, error } = useRoles();
  const [editing, setEditing] = useState<AcademyRole | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void loadRoles();
  }, []);

  const mayCreate = can(session, "role:write");

  return (
    <>
      <Panel>
        <PanelHead title="Papéis e permissões" hint={loaded ? `${roles.length} papéis` : "a carregar…"}>
          {mayCreate && (
            <button type="button" className="ctl-primary" onClick={() => setCreating(true)}>
              Novo papel
            </button>
          )}
        </PanelHead>

        {error && <p className="px-5 py-3 text-meta text-risk">{error}</p>}

        <ul>
          {roles.map((role) => (
            <li
              key={role.id}
              className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-body font-medium text-ink">{role.name}</span>
                  {role.isSystem && <Pill>de origem</Pill>}
                  {role.navKeys.length > 0 && <Pill tone="signal">menu próprio</Pill>}
                </div>
                <div className="text-meta text-ink-3">
                  {role.description}
                  <span className="text-ink-4">
                    {" · "}
                    {role.people} {role.people === 1 ? "pessoa" : "pessoas"}
                  </span>
                </div>
              </div>

              {role.editable ? (
                <div className="flex shrink-0 gap-1.5">
                  <button type="button" className="ctl-ghost" onClick={() => setEditing(role)}>
                    Editar
                  </button>
                  {!role.isSystem && role.people === 0 && (
                    <button type="button" className="ctl-ghost" onClick={() => void archiveRole(role.id)}>
                      Arquivar
                    </button>
                  )}
                </div>
              ) : (
                /*
                 * Sem botão, em vez de botão desactivado. Um botão que não faz nada
                 * ensina que existe ali alguma coisa escondida — e a razão de não se
                 * poder editar (é o teu próprio papel, ou está acima de ti) não cabe
                 * num tooltip.
                 */
                <span className="shrink-0 text-meta text-ink-4">
                  {role.key === "presidente" ? "imutável" : "—"}
                </span>
              )}
            </li>
          ))}
        </ul>

        <p className="border-t border-line px-5 py-3 text-meta leading-relaxed text-ink-3">
          Um papel vale para toda a gente que o tem. Para abrir ou fechar acesso a{" "}
          <strong className="font-medium text-ink-2">uma pessoa em concreto</strong> — dar mensalidades a um
          treinador, tirar-lhe o boletim clínico — abre a ficha dela em{" "}
          <Link to="/staff" className="font-medium text-ink hover:underline">
            Staff
          </Link>
          , separador Acesso.
        </p>
      </Panel>

      {roles.length > 0 && (
        <Panel>
          <PanelHead title="Quem vê o quê" hint="uma coluna por papel" />
          <PermissionMatrix roles={roles} />
        </Panel>
      )}

      {(creating || editing) && (
        <RoleDialog
          role={editing ?? undefined}
          session={session}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

/**
 * A matriz existe para tornar visível o que costuma ficar escondido em código — e
 * agora em base de dados. Um diretor consegue ver, sem perguntar a ninguém, que o
 * treinador não tem acesso financeiro.
 *
 * É o retrato dos **papéis**. As excepções são de cada pessoa e vivem na ficha
 * dela, porque é lá que a pergunta aparece. Uma tabela que misturasse as duas
 * deixava de responder a qualquer uma.
 */
function PermissionMatrix({ roles }: { roles: AcademyRole[] }) {
  const areas: Area[] = [...AREAS, ...CLINICAL_AREAS, ...SCOUTING_AREAS];

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-body">
        <thead>
          <tr className="border-b border-line bg-sunken/60">
            <th className="px-5 py-2 text-left text-meta font-medium text-ink-3">Área</th>
            {roles.map((r) => (
              <th key={r.id} className="px-3 py-2 text-center text-meta font-medium text-ink-3 whitespace-nowrap">
                {r.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {areas.map((area) => (
            <tr key={area.label} className="border-b border-line last:border-0">
              <td className="px-5 py-2.5 text-ink-2">{area.label}</td>
              {roles.map((role) => {
                const level = levelOf(area, new Set(role.permissions as Permission[]));
                return (
                  <td key={role.id} className="px-3 py-2.5 text-center">
                    {level === "write" ? (
                      <Pill tone="signal">editar</Pill>
                    ) : level === "read" ? (
                      <Pill>ver</Pill>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Pré-visualização da PWA.
 *
 * Não é decoração: é a resposta à pergunta "como é que isto fica no telemóvel do
 * pai?", e muda ao vivo com a cor escolhida acima.
 */
function PwaPreview({ signal }: { signal: string }) {
  return (
    <Panel>
      <PanelHead title="App das famílias" hint="pré-visualização" />
      <div className="flex flex-col items-center gap-4 p-5">
        <div className="flex w-full items-center gap-3 rounded-[var(--radius-control)] border border-line bg-sunken/40 p-3">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-[12px] text-[15px] font-bold text-white"
            style={{ background: signal }}
          >
            LC
          </span>
          <div className="min-w-0">
            <div className="truncate text-body font-semibold text-ink">{academy.shortName}</div>
            <div className="truncate text-meta text-ink-3">ícone e nome no telemóvel</div>
          </div>
        </div>

        <p className="text-meta text-ink-3">
          O pai instala a app da <strong className="font-medium text-ink-2">{academy.name}</strong>. O nosso
          nome não aparece em lado nenhum — somos a tecnologia por trás.
        </p>
      </div>
    </Panel>
  );
}
