import { Check } from "@/lib/icons";
import { Pill, cx } from "./primitives";
import { ADMIN_AREAS, AREAS, CLINICAL_AREAS, SCOUTING_AREAS, levelOf, type Area, type Level } from "@/lib/access";
import { NAV_CATALOG, SETTINGS_ITEM } from "@/lib/nav";
import type { Permission } from "@/lib/permissions";

/**
 * As peças partilhadas entre configurar um **departamento** e configurar um
 * **cargo**.
 *
 * Viviam dentro de `RoleDialog`. Saíram quando os departamentos passaram a ter
 * permissões próprias: as duas perguntas são diferentes — "o que é que esta área
 * do clube faz?" e "e esta pessoa, dentro dela?" — mas os controlos com que se
 * respondem têm de ser os mesmos. Quem aprendeu um aprendeu o outro, que é
 * exactamente a razão de o painel de acesso por pessoa já usar estes.
 */

/* -------------------------------------------------------------------------- */

export function SectionHead({ title, hint, subtle }: { title: string; hint?: string; subtle?: boolean }) {
  return (
    <div
      className={cx(
        "flex items-baseline justify-between gap-3 px-5 py-2.5",
        subtle ? "border-t border-line bg-sunken/40" : "bg-sunken/60",
      )}
    >
      <span className="text-group text-ink-3 uppercase">{title}</span>
      {hint && <span className="text-meta text-ink-4">{hint}</span>}
    </div>
  );
}

export function Toggle({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors",
        on ? "border-transparent bg-signal text-white" : "border-line-strong bg-surface",
        disabled && "opacity-40",
      )}
    >
      {on && <Check className="size-3" strokeWidth={3} />}
    </button>
  );
}

/**
 * Uma linha por área, três estados.
 *
 * "Ver" e "editar" não são independentes — não existe editar sem ver — e dois
 * interruptores deixavam exprimir esse estado impossível. Aqui o estado inválido
 * não é evitado por validação: não cabe na interface.
 *
 * ## As etiquetas dizem o que a pessoa faz
 *
 * Diziam "Nada" e "Sim". Numa linha chamada *Boletim clínico*, o "Sim" não
 * respondia a pergunta nenhuma — sim o quê? Ver? Escrever? Numa área que só tem
 * leitura não havia sequer contraste que desfizesse a dúvida. Nomear a acção
 * ("Não vê", "Vê", "Vê e edita") tira-a sem precisar de legenda.
 */
export function AreaList({
  areas,
  permissions,
  mine,
  onChange,
  /** O que este bloco herdou. Marca as linhas que se afastam da herança. */
  inherited,
}: {
  areas: Area[];
  permissions: Set<Permission>;
  mine: Set<Permission>;
  onChange: (area: Area, level: Level) => void;
  inherited?: Set<Permission>;
}) {
  return (
    <ul>
      {areas.map((area) => {
        const level = levelOf(area, permissions);
        // Só se dá o que se tem. Sem isto, a interface deixava escolher algo que o
        // servidor ia calar — e gravava-se sem aquilo, sem explicação.
        const allowed = mine.has(area.read);
        const base = inherited ? levelOf(area, inherited) : level;
        const mudou = Boolean(inherited) && base !== level;

        const options: { value: Level; label: string }[] = [
          { value: "none", label: "Não vê" },
          { value: "read", label: "Vê" },
          ...(area.write && mine.has(area.write) ? [{ value: "write" as const, label: "Vê e edita" }] : []),
        ];

        return (
          <li
            key={area.label}
            className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-2.5 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-body font-medium text-ink">{area.label}</span>
                {mudou && <Pill>alterado</Pill>}
              </div>
              <div className="text-meta text-ink-3">{area.hint}</div>
            </div>

            {allowed ? (
              <div className="flex shrink-0 rounded-[var(--radius-control)] border border-line p-0.5">
                {options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => onChange(area, o.value)}
                    className={cx(
                      "rounded-[6px] px-2.5 py-1 text-meta font-medium transition-colors",
                      level === o.value ? "bg-ink text-surface" : "text-ink-3 hover:text-ink",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ) : (
              <Pill>não tens</Pill>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Os quatro blocos de áreas, na ordem em que se lêem.
 *
 * Clínico e Scouting ficam à parte por razões diferentes e ambas boas: um é
 * categoria especial no RGPD, o outro guarda vídeo de menores que não é do clube.
 */
export function AreaBlocks({
  permissions,
  mine,
  onChange,
  inherited,
}: {
  permissions: Set<Permission>;
  mine: Set<Permission>;
  onChange: (area: Area, level: Level) => void;
  inherited?: Set<Permission>;
}) {
  const props = { permissions, mine, onChange, inherited };
  return (
    <>
      <AreaList areas={AREAS} {...props} />
      <SectionHead title="Clínico" hint="categoria especial no RGPD" subtle />
      <AreaList areas={CLINICAL_AREAS} {...props} />
      <SectionHead title="Scouting" hint="o vídeo é separado de propósito" subtle />
      <AreaList areas={SCOUTING_AREAS} {...props} />
      <SectionHead title="Administração" hint="muda o produto para os outros" subtle />
      <AreaList areas={ADMIN_AREAS} {...props} />
    </>
  );
}

/** Aplica um nível a um conjunto de permissões, sem deixar passar o estado impossível. */
export function applyLevel(current: Set<Permission>, area: Area, level: Level): Set<Permission> {
  const next = new Set(current);
  if (level === "none") {
    next.delete(area.read);
    if (area.write) next.delete(area.write);
  } else {
    next.add(area.read);
    if (area.write) {
      if (level === "write") next.add(area.write);
      else next.delete(area.write);
    }
  }
  return next;
}

/** Os menus que um dado conjunto de permissões torna possíveis. */
export function possibleNavKeys(permissions: Set<Permission>): Set<string> {
  const keys = new Set<string>();
  for (const group of NAV_CATALOG) {
    for (const item of group.items) if (permissions.has(item.requires)) keys.add(item.key);
  }
  if (permissions.has(SETTINGS_ITEM.requires)) keys.add(SETTINGS_ITEM.key);
  return keys;
}

/**
 * Que itens do menu se mostram.
 *
 * Arrumação, não segurança — e o ecrã diz isso por palavras, porque a diferença
 * não se adivinha. Esconder um menu não fecha o endpoint: quem souber o endereço
 * chega lá na mesma. O que fecha é a permissão, no bloco de cima. Uma interface
 * que deixasse acreditar o contrário seria pior do que não ter a funcionalidade.
 */
export function NavPicker({
  navKeys,
  setNavKeys,
  possible,
  disabled,
}: {
  navKeys: string[];
  setNavKeys: (fn: (k: string[]) => string[]) => void;
  possible: Set<string>;
  disabled?: boolean;
}) {
  const items = [...NAV_CATALOG, { label: undefined, items: [SETTINGS_ITEM] }].flatMap((g) => g.items);

  return (
    <div className="space-y-3">
      <p className="text-meta leading-relaxed text-ink-3">
        Isto é arrumação, não segurança: esconder um item não retira a permissão, e quem souber o
        endereço continua a chegar lá. Para fechar mesmo, tira a permissão em cima.
      </p>

      <label className="flex cursor-pointer items-center gap-2">
        <Toggle on={navKeys.length === 0} disabled={disabled} onClick={() => setNavKeys(() => [])} />
        <span className="text-body text-ink-2">Mostrar tudo o que as permissões deixarem</span>
      </label>

      {navKeys.length > 0 ? (
        <ul className="rounded-[var(--radius-control)] border border-line">
          {items.map((item) => {
            const pode = possible.has(item.key);
            const on = navKeys.includes(item.key);
            return (
              <li key={item.key} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
                <Toggle
                  on={on && pode}
                  disabled={disabled || !pode}
                  onClick={() => setNavKeys((k) => (on ? k.filter((x) => x !== item.key) : [...k, item.key]))}
                />
                <item.icon className={cx("size-4", pode ? "text-ink-3" : "text-ink-4")} strokeWidth={1.75} />
                <span className={cx("flex-1 text-body", pode ? "text-ink" : "text-ink-4")}>{item.label}</span>
                {!pode && <Pill>sem permissão</Pill>}
              </li>
            );
          })}
        </ul>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setNavKeys(() => [...possible])}
          className="ctl-ghost"
        >
          Escolher item a item
        </button>
      )}
    </div>
  );
}
