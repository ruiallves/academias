import { cloneElement, type FormEvent, isValidElement, type ReactElement, type ReactNode, useId, useState } from "react";
import { apiPatch } from "@/lib/http";
import { listTeams, sportById, teamById } from "@/lib/api";
import { reloadAcademy } from "@/lib/store";
import type { Athlete } from "@/data/types";
import { ATHLETE_SEXES, ATHLETE_SEX_LABEL } from "@/lib/genero";
import { mayReadTaxId, type Session } from "@/lib/permissions";
import { dialogInputClass } from "./Dialog";
import { Panel, PanelHead, cx } from "./primitives";
import { IdentificacaoField, identificacaoInicial, identificacaoOk, identificacaoParaApi } from "./IdentificacaoField";
import { MoradaField, moradaDoAtleta, moradaParaApi } from "./MoradaField";
import { epocaDaEquipa, gravarLicenca } from "@/lib/licencas";
import { seasonList } from "@/lib/store";
import { EquipasDoAtletaField, equipasParaApi, linhaNova, linhasDoAtleta, problemaDasEquipas, type LinhaDeEquipa } from "./EquipasDoAtletaField";

/**
 * Editar a ficha de um atleta — na própria página, não numa janela.
 *
 * ## Porque é que isto não é um diálogo
 *
 * Porque uma ficha de atleta não cabe num. Um diálogo obriga a escolher meia dúzia
 * de campos e a deixar os outros de fora, e a pergunta seguinte é sempre "e a
 * altura, edita-se onde?". Ao ocupar a página, a lista de campos deixa de ser uma
 * negociação de espaço: é simplesmente **tudo o que a ficha mostra**.
 *
 * A página troca de modo em vez de abrir por cima: o cabeçalho do atleta fica no
 * sítio, os separadores dão lugar a Guardar e Cancelar, e ninguém perde a noção de
 * quem está a editar.
 *
 * ## O que continua de fora, e porquê
 *
 * O **clínico**. Lesões, diagnósticos e altas vivem em `ClinicalEntry`, com autor
 * registado e permissão própria (`clinical:write`). O que está aqui é a validade
 * do exame — administrativo: a data, não o que o exame diz.
 */
export function AthleteEditPanel({
  athlete,
  session,
  onDone,
  onCancel,
}: {
  athlete: Athlete;
  session: Session;
  onDone: () => void;
  onCancel: () => void;
}) {
  const teams = listTeams(session);

  const [name, setName] = useState(athlete.name);
  const [birthdate, setBirthdate] = useState(athlete.birthdate.slice(0, 10));
  const [ident, setIdent] = useState(identificacaoInicial(athlete));
  const [email, setEmail] = useState(athlete.email ?? "");
  /*
   * As equipas do atleta, cada uma com o seu número e posição. Um atleta sem
   * equipa nenhuma (a dele foi apagada) abre com uma linha por escolher.
   */
  const [linhas, setLinhas] = useState<LinhaDeEquipa[]>(() => {
    const dele = linhasDoAtleta(athlete, teams);
    return dele.length > 0 ? dele : [{ ...linhaNova(teams), teamId: "" }];
  });
  const [heightCm, setHeightCm] = useState(athlete.heightCm?.toString() ?? "");
  const [weightKg, setWeightKg] = useState(athlete.weightKg?.toString() ?? "");
  const [dominantSide, setDominantSide] = useState(sideToApi(athlete.dominantSide));
  const [sex, setSex] = useState<string>(athlete.sex ?? "");
  const [medicalValidUntil, setMedicalValidUntil] = useState(athlete.medicalValidUntil?.slice(0, 10) ?? "");
  const [morada, setMorada] = useState(() => moradaDoAtleta(athlete));
  /*
   * As licenças, uma por modalidade e época das equipas do formulário. A chave é
   * "modalidade|época"; o valor começa no que está gravado. Acompanham as linhas:
   * pôr o atleta numa equipa de outra modalidade abre logo o campo dela.
   */
  const [licencas, setLicencas] = useState<Record<string, string>>(() =>
    Object.fromEntries(athlete.licencas.map((l) => [`${l.sportId}|${l.seasonId}`, l.number])),
  );
  const gravadas = new Map(athlete.licencas.map((l) => [`${l.sportId}|${l.seasonId}`, l.number]));
  const camposDeLicenca = [
    ...new Map(
      linhas
        .map((l) => ({ sportId: teamById(l.teamId)?.sportId ?? l.sportId, seasonId: epocaDaEquipa(l.teamId) }))
        .filter((c): c is { sportId: string; seasonId: string } => Boolean(c.sportId && c.seasonId))
        .map((c) => [`${c.sportId}|${c.seasonId}`, c] as const),
    ).values(),
  ];

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // O rótulo do lado dominante vem da modalidade principal ("Pé" no futebol, "Mão" no basquetebol).
  const sport = sportById(teamById(linhas[0]?.teamId ?? "")?.sportId ?? "");

  /*
   * O NIF só entra no formulário de quem o recebe.
   *
   * O servidor devolve-o a nulo a quem não trata de famílias (ver
   * `mayReadTaxId`), e o campo ficava na mesma no ecrã: vazio, com o
   * `123456789` cinzento por trás e a exigência de nove dígitos para gravar.
   * Um treinador com `athlete:write` ficava assim sem poder mudar a altura de
   * um atleta — e a única saída que o ecrã lhe dava era escrever um NIF de
   * memória por cima do que já lá estava.
   *
   * Sem permissão, o campo desaparece, não é exigido e **não vai no corpo** —
   * um `PATCH` sem `taxId` deixa o que está gravado exactamente como está.
   */
  const vejoNif = mayReadTaxId(session);

  // Obrigatório desde que passou a ser a chave do registo da família. Numa ficha
  // antiga pode estar vazio — e é aqui que se corrige, por isso o formulário
  // exige-o a quem o vê.
  const nifOk = !vejoNif || identificacaoOk(ident);
  const heightOk = heightCm === "" || (Number(heightCm) >= 50 && Number(heightCm) <= 250);
  const weightOk = weightKg === "" || (Number(weightKg) >= 20 && Number(weightKg) <= 200);
  const valid = name.trim().length >= 2 && birthdate !== "" && problemaDasEquipas(linhas) === null && nifOk && heightOk && weightOk;

  /*
   * As equipas de onde sai. A passagem fica no percurso dele, e as presenças e os
   * jogos já registados não mudam — é histórico, e reescrevê-lo seria mentir
   * sobre onde este atleta jogou.
   */
  const saiDe = athlete.equipas
    .filter((e) => !linhas.some((l) => l.teamId === e.teamId))
    .map((e) => teamById(e.teamId)?.name)
    .filter(Boolean);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      /*
       * Envia-se tudo o que o formulário mostra, e não só o que mudou.
       *
       * Um `PATCH` parcial calculado no cliente parece mais elegante e é uma fonte
       * de enganos silenciosos: um campo limpo no ecrã que não entra no corpo fica
       * como estava, e quem editou jura que o apagou. Aqui o que se vê é o que fica.
       */
      await apiPatch(`/api/athletes/${athlete.id}`, {
        name: name.trim(),
        birthdate,
        // A lista inteira: a que sai da lista sai da equipa. Ver `aplicarEquipas` na API.
        equipas: equipasParaApi(linhas),
        ...(vejoNif ? identificacaoParaApi(ident, "editar") : {}),
        // A morada e o CC seguem a regra do NIF: só no corpo de quem os vê.
        ...(vejoNif ? moradaParaApi(morada, "editar") : {}),
        // Vazio apaga: o que se vê é o que fica.
        email: email.trim().toLowerCase(),
        ...(heightCm ? { heightCm: Number(heightCm) } : {}),
        // O servidor guarda décimas de kg, para casar com o `Decimal(4,1)`.
        ...(weightKg ? { weightDg: Math.round(Number(weightKg) * 10) } : {}),
        ...(dominantSide ? { dominantSide } : {}),
        ...(sex ? { sex } : {}),
        ...(medicalValidUntil ? { medicalValidUntil } : {}),
      });
      /* As licenças que mudaram, depois da ficha: cada uma no seu sítio (modalidade e época). */
      for (const c of camposDeLicenca) {
        const chave = `${c.sportId}|${c.seasonId}`;
        const novo = (licencas[chave] ?? "").trim();
        if (novo !== (gravadas.get(chave) ?? "")) await gravarLicenca(athlete.id, c.sportId, c.seasonId, novo);
      }
      await reloadAcademy();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {/* A barra de acções fica no topo e colada: numa página comprida, um
          "Guardar" só no fundo obriga a rolar para confirmar o que já se decidiu. */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-2.5">
        <span className="min-w-0 flex-1 text-body text-ink-2">
          A editar a ficha de <strong className="font-medium text-ink">{athlete.name}</strong>
        </span>
        {error && <span className="text-meta text-risk">{error}</span>}
        <button type="button" className="ctl-ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" className="ctl-primary" disabled={!valid || busy}>
          {busy ? "A guardar…" : "Guardar"}
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Identidade" />
          <div className="space-y-3 px-5 py-4">
            <Field label="Nome">
              <input value={name} onChange={(e) => setName(e.target.value)} className={dialogInputClass} />
            </Field>

            {/* O email do próprio atleta — é para lá que sai o convite da app. Ver `AppDoAtletaPanel`. */}
            <Field label="Email do atleta" hint="opcional — o dele, não o do encarregado">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="atleta@mail.pt" className={dialogInputClass} />
            </Field>

            <Field label="Data de nascimento">
              <input
                type="date"
                value={birthdate}
                onChange={(e) => setBirthdate(e.target.value)}
                className={dialogInputClass}
              />
            </Field>

            {/* O NIF, ou outro documento para quem não o tem. Ver `IdentificacaoField`. */}
            {vejoNif && <IdentificacaoField value={ident} onChange={setIdent} />}
            {/* O CC e a morada, logo a seguir à identificação. Tudo opcional. */}
            {vejoNif && <MoradaField value={morada} onChange={setMorada} />}
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Equipas" hint="o número e a posição são de cada equipa" />
          <div className="space-y-3 px-5 py-4">
            {/*
              As equipas do atleta. Futebol e futsal, ou dois escalões: cada linha
              é uma equipa, com o seu número e posição. Tirar uma linha é sair
              dessa equipa; a passagem fica no percurso.
            */}
            <EquipasDoAtletaField linhas={linhas} onChange={setLinhas} teams={teams} />

            {saiDe.length > 0 && (
              <p className="rounded-[var(--radius-control)] border border-line bg-sunken/50 px-3 py-2 text-meta leading-relaxed text-ink-2">
                Sai de <strong className="font-medium text-ink">{saiDe.join(", ")}</strong>. As presenças e os jogos já
                registados ficam como estão: são o histórico de onde este atleta jogou.
              </p>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Licenças" hint="por modalidade, na época da equipa" />
          <div className="space-y-3 px-5 py-4">
            {camposDeLicenca.length === 0 ? (
              <p className="text-meta text-ink-3">Escolhe uma equipa para indicar a licença.</p>
            ) : (
              camposDeLicenca.map((c) => {
                const chave = `${c.sportId}|${c.seasonId}`;
                const modalidade = sportById(c.sportId)?.name ?? "Modalidade";
                const epoca = seasonList.find((x) => x.id === c.seasonId)?.label ?? "";
                return (
                  <Field key={chave} label={`N.º de licença em ${modalidade}`} hint={epoca ? `época ${epoca}` : undefined}>
                    <input
                      value={licencas[chave] ?? ""}
                      onChange={(e) => setLicencas((v) => ({ ...v, [chave]: e.target.value.slice(0, 40) }))}
                      placeholder="opcional"
                      autoComplete="off"
                      className={dialogInputClass}
                    />
                  </Field>
                );
              })
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Ficha física" hint="opcional" />
          <div className="space-y-3 px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Altura" hint="cm">
                <input
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  inputMode="numeric"
                  className={cx(dialogInputClass, !heightOk && "border-risk")}
                />
              </Field>

              <Field label="Peso" hint="kg">
                <input
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value.replace(/[^\d.,]/g, "").replace(",", ".").slice(0, 5))}
                  inputMode="decimal"
                  className={cx(dialogInputClass, !weightOk && "border-risk")}
                />
              </Field>
            </div>

            {/* Como está inscrito na federação. Fica "por indicar" até alguém
                o dizer: a ficha não adivinha pelo nome. */}
            <Field label="Sexo" hint="como está inscrito na federação">
              <select value={sex} onChange={(e) => setSex(e.target.value)} className={dialogInputClass}>
                <option value="">Por indicar</option>
                {ATHLETE_SEXES.map((s) => (
                  <option key={s} value={s}>
                    {ATHLETE_SEX_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>

            {/* O rótulo vem da modalidade: "Pé dominante" no futebol, "Mão
                dominante" no basquetebol, e nada na natação. */}
            {sport?.dominantSideLabel && (
              <Field label={sport.dominantSideLabel} hint="opcional">
                <select
                  value={dominantSide}
                  onChange={(e) => setDominantSide(e.target.value)}
                  className={dialogInputClass}
                >
                  <option value="">—</option>
                  <option value="RIGHT">Direito</option>
                  <option value="LEFT">Esquerdo</option>
                  <option value="BOTH">Ambidestro</option>
                </select>
              </Field>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Ficha médica" hint="só a validade do exame" />
          <div className="space-y-3 px-5 py-4">
            <Field label="Exame médico válido até" hint="opcional">
              <input
                type="date"
                value={medicalValidUntil}
                onChange={(e) => setMedicalValidUntil(e.target.value)}
                className={dialogInputClass}
              />
            </Field>

            <p className="text-meta leading-relaxed text-ink-3">
              Lesões, diagnósticos e altas não se editam aqui — vivem no separador <strong className="font-medium text-ink-2">Clínico</strong>,
              onde cada registo fica com o nome de quem o fez. É o que torna um diagnóstico rastreável.
            </p>
          </div>
        </Panel>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  /*
   * A ligação ao campo, quando é um só e não traz `id` seu. É o que mantém o
   * rótulo a focar o campo sem o pôr à volta dele — ver `DialogField`.
   */
  const soUmCampo =
    isValidElement(children) &&
    typeof children.type === "string" &&
    ["input", "select", "textarea"].includes(children.type) &&
    !(children.props as { id?: string }).id;

  return (
    <div className="block">
      <label {...(soUmCampo ? { htmlFor: id } : {})} className="mb-1.5 flex items-baseline justify-between gap-1.5">
        <span className="text-meta font-medium text-ink">{label}</span>
        {hint && <span className="text-[11px] text-ink-4">{hint}</span>}
      </label>
      {soUmCampo ? cloneElement(children as ReactElement<{ id?: string }>, { id }) : children}
    </div>
  );
}

/**
 * O lado dominante chega em formas diferentes conforme o caminho que fez — o
 * enum do servidor (`RIGHT`), a versão em minúsculas do store, ou o português da
 * ficha. Normaliza-se aqui em vez de acreditar em qualquer uma delas.
 */
function sideToApi(value: string | undefined): string {
  const v = (value ?? "").toLowerCase();
  if (v.startsWith("r") || v.startsWith("dir")) return "RIGHT";
  if (v.startsWith("l") || v.startsWith("esq")) return "LEFT";
  if (v.startsWith("b") || v.startsWith("amb")) return "BOTH";
  return "";
}
