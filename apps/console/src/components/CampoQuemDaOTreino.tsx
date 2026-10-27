import { useEffect, useState } from "react";
import { apiGetSilencioso } from "@/lib/http";
import { teamById, teamCoaches } from "@/lib/api";
import { DialogField } from "./Dialog";
import { SelectField } from "./primitives";

type Pessoa = { membershipId: string; name: string; role: string | null };

/**
 * O treinador principal, pela regra do servidor (`pesoDoTitulo` em
 * `head-coaches.ts`): só conta quem tem "treinador" ou "técnico" no título, e
 * "principal" ganha. Pela ordem do título em empate, como lá. Sem isto, a
 * consola chamava principal ao delegado de uma equipa sem treinador.
 */
function principalDaEquipa(teamId: string) {
  const equipa = teamById(teamId);
  if (!equipa) return undefined;
  const peso = (t: string) => (!/treinad|t[ée]cnic/i.test(t) ? 0 : /principal/i.test(t) ? 2 : 1);
  let melhor: { id: string; name: string } | undefined;
  let maior = 0;
  for (const c of [...teamCoaches(equipa)].sort((a, b) => a.title.localeCompare(b.title))) {
    if (peso(c.title) > maior) {
      melhor = c;
      maior = peso(c.title);
    }
  }
  return melhor;
}

/* Uma lista por sessão da consola: o staff não muda entre dois diálogos. */
let cache: Promise<Pessoa[] | null> | null = null;
function carregar(): Promise<Pessoa[] | null> {
  cache ??= apiGetSilencioso<Pessoa[]>("/api/matches/equipa-tecnica").catch(() => {
    cache = null;
    return null;
  });
  return cache;
}

/**
 * Quem dá este treino.
 *
 * ## Por omissão, o treinador principal
 *
 * Vazio é o principal da equipa, e é o que fica gravado quando se escolhe o
 * próprio principal: se a equipa mudar de principal, os treinos passam para o
 * novo. Só se escolhe outra pessoa quando é mesmo outra a dar o treino, e essa
 * pessoa é avisada no telemóvel ("Vais dar um treino") e passa a receber os
 * avisos de falta das famílias. O principal não é avisado: sabe que o treino é
 * dele.
 *
 * ## A lista
 *
 * Todo o staff activo, e não só a equipa técnica: quem substitui é muitas vezes
 * o coordenador ou o treinador de outro escalão. Vem do mesmo endereço da ficha
 * técnica dos jogos, que um treinador pode ler sem ter acesso ao Staff. Quem não
 * a pode ler não vê o campo, e o treino fica com o principal.
 */
export function CampoQuemDaOTreino({
  teamId,
  value,
  onChange,
}: {
  teamId: string;
  /** Vazio é o treinador principal. */
  value: string;
  onChange: (membershipId: string) => void;
}) {
  const [pessoas, setPessoas] = useState<Pessoa[] | null | undefined>(undefined);

  useEffect(() => {
    let vivo = true;
    void carregar().then((l) => vivo && setPessoas(l));
    return () => {
      vivo = false;
    };
  }, []);

  if (!pessoas || !teamId) return null;

  const principal = principalDaEquipa(teamId);
  const outras = pessoas.filter((p) => p.membershipId !== principal?.id);
  /* O principal escolhido aparece como "por omissão", e não duas vezes. */
  const escolhido = value === principal?.id ? "" : value;

  return (
    <DialogField label="Quem dá o treino" hint={escolhido ? "vai ser avisado" : undefined}>
      <SelectField
        className="w-full"
        aria-label="Quem dá o treino"
        value={escolhido}
        onChange={onChange}
        options={[
          { value: "", label: principal ? `${principal.name} (treinador principal)` : "O treinador principal" },
          ...outras.map((p) => ({ value: p.membershipId, label: p.role ? `${p.name} · ${p.role}` : p.name })),
        ]}
      />
    </DialogField>
  );
}
