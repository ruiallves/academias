import { useMemo } from "react";
import { listAthletes, listStaffActivo } from "@/lib/api";
import { dayKey } from "@/lib/calendar";
import { isAcademyWide, type Session } from "@/lib/permissions";
import { useStore } from "@/lib/store";

/**
 * Os aniversários no calendário do clube.
 *
 * ## Quem vê quem
 *
 * - **Atletas:** os que a pessoa já vê na lista de atletas (`listAthletes`). O
 *   treinador vê os das suas equipas; a direção e a coordenação veem todos.
 * - **Staff:** só quem vê o clube todo (direção, coordenação, clínico,
 *   scouting). A data de nascimento do staff nem chega aos outros: o servidor
 *   manda-a vazia. Ver `staff` na API.
 *
 * Os sócios ficam de fora: são centenas num clube grande, e o calendário é do
 * trabalho desportivo.
 *
 * Desligado por omissão: liga-se no botão "Aniversários", ao lado dos filtros.
 */
export type Aniversario = {
  id: string;
  nome: string;
  /** A idade que faz nesse dia. */
  idade: number;
  tipo: "atleta" | "staff";
  /** Para onde leva um clique: a ficha da pessoa. */
  href: string;
  /** A equipa principal do atleta, para a cor. */
  teamId?: string;
};

/** Os aniversários entre `de` e `ate` (inclusive), por dia (`AAAA-MM-DD`). */
export function useAniversarios(session: Session, de: Date, ate: Date, ligado: boolean): Map<string, Aniversario[]> {
  const store = useStore();
  return useMemo(() => {
    const porDia = new Map<string, Aniversario[]>();
    if (!ligado) return porDia;

    const pessoas: { id: string; nome: string; nascimento: string; tipo: Aniversario["tipo"]; href: string; teamId?: string }[] = [
      ...listAthletes(session)
        .filter((a) => a.status !== "left" && a.birthdate)
        .map((a) => ({ id: a.id, nome: a.name, nascimento: a.birthdate, tipo: "atleta" as const, href: `/atletas/${a.id}`, teamId: a.teamId ?? undefined })),
      ...(isAcademyWide(session)
        ? listStaffActivo()
            .filter((m) => m.birthdate)
            .map((m) => ({ id: m.id, nome: m.name, nascimento: m.birthdate!, tipo: "staff" as const, href: `/staff/${m.id}` }))
        : []),
    ];

    // Dia a dia no intervalo: no máximo umas semanas, e a lista de pessoas é a do clube.
    const inicio = new Date(de.getFullYear(), de.getMonth(), de.getDate());
    const fim = new Date(ate.getFullYear(), ate.getMonth(), ate.getDate());
    for (const p of pessoas) {
      const [ano, mes, dia] = p.nascimento.slice(0, 10).split("-").map(Number);
      if (!ano || !mes || !dia) continue;
      for (let y = inicio.getFullYear(); y <= fim.getFullYear(); y++) {
        // Quem nasceu a 29 de fevereiro faz anos a 28 nos anos que não são bissextos.
        const bissexto = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
        const d = new Date(y, mes - 1, mes === 2 && dia === 29 && !bissexto ? 28 : dia);
        if (d < inicio || d > fim) continue;
        const chave = dayKey(d);
        const lista = porDia.get(chave) ?? [];
        lista.push({ id: `${p.tipo}-${p.id}`, nome: p.nome, idade: y - ano, tipo: p.tipo, href: p.href, teamId: p.teamId });
        porDia.set(chave, lista);
      }
    }
    for (const lista of porDia.values()) lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
    return porDia;
    // `store` muda quando a academia é recarregada: é o que faz a lista acompanhar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, session, de.getTime(), ate.getTime(), ligado]);
}
