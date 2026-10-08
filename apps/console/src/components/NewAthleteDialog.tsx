import { useState, type FormEvent } from "react";
import { listTeams } from "@/lib/api";
import { apiGet, apiPost } from "@/lib/http";
import { ConvidarAoCriar } from "./ConfirmarSobrescrita";
import { reloadAcademy } from "@/lib/store";
import type { Session } from "@/lib/permissions";
import { ATHLETE_SEXES, ATHLETE_SEX_LABEL } from "@/lib/genero";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { EquipasDoAtletaField, equipasParaApi, linhaNova, problemaDasEquipas, type LinhaDeEquipa } from "./EquipasDoAtletaField";
import { IdentificacaoField, identificacaoInicial, identificacaoOk, identificacaoParaApi } from "./IdentificacaoField";
import { MoradaField, moradaParaApi, moradaVazia } from "./MoradaField";

/**
 * Criar atleta.
 *
 * O atleta é gravado na base de dados através de `POST /api/athletes` — o servidor
 * valida tudo e aplica o âmbito. A ficha nasce sem encarregado: um encarregado é
 * uma conta (para receber avisos e mensalidades na app), e liga-se pelo fluxo de
 * **Famílias**, com convite. Criá-lo aqui seria criar uma conta sem consentimento.
 *
 * Um atleta pode ficar logo em várias equipas — futebol e futsal, por exemplo.
 * Cada uma pede a modalidade, a equipa, o número e a posição (ver
 * `EquipasDoAtletaField`); a primeira é a principal. A posição só aparece se a
 * modalidade tiver posições — natação não tem, e o formulário não finge que tem.
 */
export function NewAthleteDialog({
  session,
  onClose,
  teamId: equipaInicial,
}: {
  session: Session;
  onClose: () => void;
  /** A equipa com que abre — quem vem do plantel de uma equipa já a escolheu. */
  teamId?: string;
}) {
  const teams = listTeams(session);

  const [name, setName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [sex, setSex] = useState("");
  const [ident, setIdent] = useState(identificacaoInicial());
  const [linhas, setLinhas] = useState<LinhaDeEquipa[]>(() =>
    teams.length === 0 ? [] : [linhaNova(teams, undefined, equipaInicial && teams.some((t) => t.id === equipaInicial) ? equipaInicial : undefined)],
  );
  /** O email do próprio atleta — opcional; com ele, pode sair o convite da app. */
  const [email, setEmail] = useState("");
  const [morada, setMorada] = useState(moradaVazia);
  /*
   * Ligado por omissão: quem escreve o email ao balcão quer, quase sempre, que
   * o atleta entre na app. Desligar serve quem carrega a ficha antes de o
   * querer avisar. Ver `ConvidarAoCriar`.
   */
  const [convidar, setConvidar] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * O NIF já é de um atleta do clube. Era um beco: o treinador do segundo
   * escalão não via o atleta, tentava inscrevê-lo e parava aqui. Agora a janela
   * oferece pô-lo também nestas equipas, sem o tirar das que já tem.
   */
  const [jaExiste, setJaExiste] = useState(false);

  async function trazerExistente() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const doc = identificacaoParaApi(ident, "criar") as { taxId?: string; idDocNumber?: string };
      const documento = doc.taxId || doc.idDocNumber || "";
      const equipas = [...new Set(linhas.map((l) => l.teamId).filter(Boolean))];
      let trazidos = 0;
      for (const teamId of equipas) {
        const encontrados = await apiGet<{ id: string }[]>(`/api/teams/${teamId}/candidatos`, { documento });
        if (encontrados.length === 0) continue; // já está nesta equipa
        await apiPost(`/api/teams/${teamId}/atletas`, { athleteIds: [encontrados[0].id] });
        trazidos++;
      }
      await reloadAcademy();
      if (trazidos === 0) {
        setError("Este atleta já está nestas equipas.");
        setJaExiste(false);
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível adicionar.");
    } finally {
      setBusy(false);
    }
  }

  // O NIF, ou outro documento, é obrigatório: sem nenhum, nenhuma família consegue
  // reclamar este atleta na app, e a academia só dá por isso quando o pai telefona.
  const nifOk = identificacaoOk(ident);
  const emailOk = email.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const valid = name.trim().length >= 2 && birthdate !== "" && problemaDasEquipas(linhas) === null && nifOk && emailOk;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/athletes", {
        name: name.trim(),
        birthdate,
        ...(sex ? { sex } : {}),
        // As equipas, cada uma com o seu número e posição; a primeira é a principal.
        equipas: equipasParaApi(linhas),
        ...identificacaoParaApi(ident, "criar"),
        ...moradaParaApi(morada, "criar"),
        ...(email.trim() ? { email: email.trim().toLowerCase(), sendInvite: convidar } : {}),
      });
      await reloadAcademy();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Não foi possível inscrever.";
      setError(msg);
      setJaExiste(msg.startsWith("Já existe um atleta com este"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="novo-atleta"
      title="Novo atleta"
      subtitle={linhas.length > 1 ? `Em ${linhas.length} equipas` : teams.find((t) => t.id === linhas[0]?.teamId)?.name}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" form="form-novo-atleta" className="ctl-primary" disabled={!valid || busy || teams.length === 0}>
            {busy ? "A inscrever…" : email.trim() && convidar ? "Inscrever e convidar" : "Inscrever"}
          </button>
        </>
      }
    >
      {teams.length === 0 ? (
        <p className="px-5 py-8 text-meta text-ink-3">
          Ainda não há equipas. Cria uma equipa primeiro — um atleta precisa de um escalão.
        </p>
      ) : (
        <form id="form-novo-atleta" onSubmit={submit} className="space-y-4 p-5">
          <DialogField label="Nome completo">
            <input value={name} onChange={(e) => setName(e.target.value)} className={dialogInputClass} required autoFocus />
          </DialogField>

          {/*
            A ficha médica saiu daqui.
            Inscrever um atleta e ter o exame dele são dois momentos diferentes,
            e o segundo vem quase sempre depois — o miúdo aparece ao treino, faz
            a inscrição, e o exame chega semanas mais tarde. Pedi-la aqui punha
            no ecrã de inscrição um campo que ninguém tem para preencher.
            Preenche-se na ficha do atleta, no separador Clínico, que é onde o
            departamento trabalha. Ver `AthleteEditPanel`.
          */}
          <DialogField label="Data de nascimento">
            <input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} className={dialogInputClass} required />
          </DialogField>

          <DialogField label="Sexo" hint="opcional · como está inscrito na federação">
            <select value={sex} onChange={(e) => setSex(e.target.value)} className={dialogInputClass}>
              <option value="">Por indicar</option>
              {ATHLETE_SEXES.map((s) => (
                <option key={s} value={s}>
                  {ATHLETE_SEX_LABEL[s]}
                </option>
              ))}
            </select>
          </DialogField>

          {/*
            O NIF, ou outro documento para quem não o tem, não é burocracia: é a
            chave com que a família se liga a este atleta ao instalar a app, com
            a data de nascimento. Sem nenhum, nenhum pai o consegue reclamar.
          */}
          <IdentificacaoField value={ident} onChange={setIdent} />

          {/* O CC e a morada, logo a seguir à identificação. Tudo opcional. */}
          <MoradaField value={morada} onChange={setMorada} />

          {/*
            O email é o **do atleta** — e é opcional. Com ele, sai o convite para
            a área de atleta da app; sem ele, a ficha fica na mesma e convida-se
            depois. Como nos sócios, diz-se antes de acontecer: é correio a sair
            em nome do clube, e quem preenche tem de o saber enquanto preenche.
          */}
          <DialogField label="Email do atleta" hint="opcional — o dele, não o do encarregado">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="atleta@mail.pt"
              className={dialogInputClass}
              aria-invalid={!emailOk}
            />
            {!emailOk && <p className="mt-1 text-[11px] text-[#a82a20]">Escreve um email válido.</p>}
          </DialogField>

          <ConvidarAoCriar
            ligado={convidar}
            onChange={setConvidar}
            temEmail={Boolean(email.trim())}
            substantivo="atleta"
          />

          {/*
            As equipas. Um atleta que pratica futebol e futsal fica nas duas, cada
            uma com o seu número e posição, e paga a soma das mensalidades.
          */}
          <DialogField label="Equipas" hint="o número e a posição são de cada equipa">
            <EquipasDoAtletaField linhas={linhas} onChange={setLinhas} teams={teams} comLicenca />
          </DialogField>

          {error && !jaExiste && (
            <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{error}</p>
          )}
          {error && jaExiste && (
            <div className="space-y-2 rounded-[var(--radius-control)] bg-warn-soft px-3 py-2.5 text-meta leading-relaxed text-ink-2">
              <p>
                <span className="font-medium text-ink">{error.replace(/^Já existe um atleta com este (NIF|documento): /, "Este atleta já está no clube: ")}.</span>{" "}
                Não é preciso inscrevê-lo outra vez: podes pô-lo também{" "}
                {linhas.length > 1 ? "nestas equipas" : `no ${teams.find((t) => t.id === linhas[0]?.teamId)?.name ?? "plantel"}`}, e fica nas
                equipas onde já está.
              </p>
              <button type="button" className="ctl-primary" disabled={busy} onClick={() => void trazerExistente()}>
                {busy ? "A adicionar…" : linhas.length > 1 ? "Adicionar também a estas equipas" : "Adicionar também a esta equipa"}
              </button>
            </div>
          )}
        </form>
      )}
    </Dialog>
  );
}
