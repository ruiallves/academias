import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Dialog } from "@/components/Dialog";
import { Interruptor } from "@/components/definicoes/ui";
import { ArrowUpRight, Check } from "@/lib/icons";
import type { Profile, Summary } from "@/lib/certification";

/**
 * O perfil da candidatura.
 *
 * São as perguntas de triagem da FPF, mais o que a plataforma não sabe sozinha
 * sobre o acesso. Cada resposta liga ou desliga um grupo inteiro de questões:
 * dizer que há praticantes deslocados acrescenta treze, e sete delas são
 * obrigatórias desde o primeiro patamar.
 *
 * O manual é claro sobre o que acontece a quem responde "não" para as evitar:
 * perde a certificação por falsas declarações. Por isso cada interruptor diz o
 * que quer dizer, e nenhum vem ligado por conveniência.
 *
 * ## O que já não se pergunta
 *
 * As equipas femininas e o número de praticantes femininas marcavam-se aqui à
 * mão. Saíram quando as equipas ganharam género e os atletas sexo: é a
 * plataforma que conta, e aqui só se mostra o que ela contou e onde se corrige.
 */
export function ProfileDialog({
  data,
  saving,
  onClose,
  onSave,
}: {
  data: Summary;
  saving: boolean;
  onClose: () => void;
  onSave: (profile: Profile) => void;
}) {
  const [p, setP] = useState<Profile>(data.profile);
  const muda = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((atual) => ({ ...atual, [k]: v }));
  const { women } = data.access;
  const porIndicar = data.teams.filter((t) => !t.gender).length;

  return (
    <Dialog
      title="Perfil da candidatura"
      subtitle={`${data.catalog.title} · Época ${data.catalog.season}`}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" disabled={saving} onClick={() => onSave(p)}>
            Guardar perfil
          </button>
        </>
      }
    >
      <Section title="O clube" hint="Cada resposta liga ou desliga um grupo de questões do manual.">
        <Toggle
          label="Tem equipa sénior masculina inscrita"
          hint="As 4 e 5 estrelas pedem-na. Liga as questões de articulação entre a formação e os seniores."
          on={p.hasSenior}
          onChange={() => muda("hasSenior", !p.hasSenior)}
        />
        <Toggle
          label="Faz recrutamento"
          hint="Procura jogadores com potencial para os escalões de competição. Quem só angaria praticantes para os escalões mais novos deixa desligado."
          on={p.recruits}
          onChange={() => muda("recruits", !p.recruits)}
        />
        <Toggle
          label="Tem praticantes deslocados das famílias (D.R.E.)"
          hint="Vivam ou não sob responsabilidade do clube. Liga as questões de alojamento, nutrição e acompanhamento."
          on={p.hasDre}
          onChange={() => muda("hasDre", !p.hasDre)}
        />
        <Toggle
          label="Recruta praticantes não-nacionais não residentes"
          hint="Para os escalões de formação. Liga as questões de legalidade, estadia e aviso à FPF."
          on={p.nonNationals}
          onChange={() => muda("nonNationals", !p.nonNationals)}
        />
      </Section>

      <Section title="Equipas" hint="Contadas pela plataforma a partir das equipas e dos atletas do clube.">
        <div className="px-5 py-3">
          <div className="cert-squads">
            {data.access.squads.map((s) => (
              <div key={s.age} className="cert-squad" data-ok={s.ok}>
                <b>{s.athletes}</b>
                <span>Sub-{s.age}</span>
                {!s.ok && <em>mín. {s.need}</em>}
              </div>
            ))}
          </div>
          <p className="mt-2 text-meta text-ink-3">
            O maior plantel masculino de cada escalão. Uma equipa conta com 11 atletas de Sub-13 para cima e 7 abaixo.
          </p>
        </div>

        <div className="px-5 py-3">
          <div className="flex items-start gap-3">
            <span className="cert-need" data-ok={women.ok} aria-hidden>
              {women.ok && <Check className="size-3" strokeWidth={3} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-body font-medium text-ink">Futebol feminino</div>
              <p className="mt-0.5 text-meta text-ink-3">
                {women.teams} {women.teams === 1 ? "equipa feminina" : "equipas femininas"} e {women.players}{" "}
                {women.players === 1 ? "praticante feminina" : "praticantes femininas"} na formação. As 5 estrelas pedem uma equipa ou 20
                praticantes.
              </p>
              <p className="mt-1.5 text-meta text-ink-3">
                Vem do género de cada equipa e do sexo indicado na ficha de cada atleta.
                {porIndicar > 0 && ` ${porIndicar === 1 ? "Há 1 equipa" : `Há ${porIndicar} equipas`} de futebol sem género indicado.`}
              </p>
              <Link to="/equipas" className="ctl-outline mt-2.5" onClick={onClose}>
                Abrir as equipas
                <ArrowUpRight className="size-3.5" strokeWidth={1.75} />
              </Link>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Acesso" hint="O que a plataforma não sabe sozinha.">
        <Toggle
          label="Provas nacionais numa das últimas 5 épocas"
          hint="Uma equipa de Sub-15 a sénior a disputar provas de âmbito nacional."
          on={p.nationalLast5}
          onChange={() => muda("nationalLast5", !p.nationalLast5)}
        />
        <Toggle
          label="Associação da Madeira ou dos Açores"
          hint="AF da Madeira, de Ponta Delgada, de Angra do Heroísmo ou da Horta. Pede menos escalões e dispensa as provas nacionais."
          on={p.islands}
          onChange={() => muda("islands", !p.islands)}
        />
        <Toggle
          label="Concelho de baixa densidade populacional"
          hint="Um dos 165 concelhos da lista da FPF. Pede um escalão a menos para escola e para as 3 estrelas."
          on={p.lowDensity}
          onChange={() => muda("lowDensity", !p.lowDensity)}
        />
      </Section>
    </Dialog>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="border-b border-line last:border-b-0">
      <header className="bg-canvas px-5 py-2.5">
        <h3 className="text-panel text-ink">{title}</h3>
        <p className="text-meta text-ink-3">{hint}</p>
      </header>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

/** Uma linha com interruptor. Uma `div`, e não um `<label>`: nada de tocar dentro de um rótulo. */
function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <div className="min-w-0">
        <div className="text-body font-medium text-ink">{label}</div>
        <p className="mt-0.5 text-meta text-ink-3">{hint}</p>
      </div>
      <Interruptor ligado={on} onChange={onChange} label={label} />
    </div>
  );
}
