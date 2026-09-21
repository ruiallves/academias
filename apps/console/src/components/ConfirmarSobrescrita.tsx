import { TriangleAlert } from "@/lib/icons";
import type { LinhaExistente } from "@/lib/importacao";

/**
 * "Estas pessoas já cá estão. Os dados vão ser substituídos."
 *
 * ## Porque é que isto tem de ser um ecrã e não um aviso
 *
 * Porque é a única coisa nesta aplicação que apaga dados de pessoas a sério
 * sem que ninguém tenha escrito nada à mão. Uma folha de cálculo com trezentas
 * linhas aplicada por engano sobre o livro do clube é uma tarde de telefonemas.
 * Quem carrega no botão tem de ver **quem** vai mudar e **o quê**, antes.
 *
 * ## Os dois nomes lado a lado
 *
 * O nome da folha e o nome da ficha encontrada. Se a correspondência estiver
 * errada — um telemóvel de casa partilhado por dois sócios, um NIF trocado —
 * vê-se aqui, numa linha, e não daqui a um mês quando alguém der pela morada
 * do irmão na ficha errada.
 *
 * ## O que não se diz
 *
 * Linhas que não mudam nada não entram: reimportar a folha do ano passado com
 * três nomes novos no fim não deve produzir uma parede de trezentos nomes a
 * dizer que ficam na mesma.
 */
export function ConfirmarSobrescrita({
  linhas,
  total,
  substantivo,
  nota,
}: {
  linhas: LinhaExistente[];
  /** Quantos ao todo. A lista vem cortada — ver `existingTotal`. */
  total: number;
  /** "sócio" / "atleta" — a frase muda de substantivo, não de forma. */
  substantivo: "sócio" | "atleta";
  /** Uma linha a mais, quando o caso a pede (as equipas dos atletas). */
  nota?: string;
}) {
  const plural = substantivo === "sócio" ? "sócios" : "atletas";

  return (
    <div className="rounded-[var(--radius-control)] border border-warn/30 bg-warn-soft p-4">
      <p className="flex items-start gap-2 text-body font-medium text-ink">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2} />
        {total === 1
          ? `Um ${substantivo} da folha já está na plataforma.`
          : `${total} ${plural} da folha já estão na plataforma.`}
      </p>

      <p className="mt-1.5 pl-6 text-meta leading-relaxed text-ink-3">
        Se continuares, {total === 1 ? "a ficha" : "as fichas"} passam a ter o que está na folha. O que a folha
        não traz fica como está.
        {nota ? ` ${nota}` : ""}
      </p>

      <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pl-6">
        {linhas.map((l) => (
          <li key={l.line} className="text-meta leading-relaxed">
            <span className="tabular text-ink-4">L{l.line}</span>{" "}
            <span className="font-medium text-ink">{l.name}</span>
            {/* O nome da ficha só quando é outro: repetir o mesmo nome duas
                vezes em trezentas linhas é ruído que esconde as que interessam. */}
            {l.matchedName.trim().toLowerCase() !== l.name.trim().toLowerCase() && (
              <span className="text-ink-3"> sobre a ficha de {l.matchedName}</span>
            )}
            {l.changes.length > 0 && <span className="text-ink-3"> · muda {l.changes.join(", ")}</span>}
          </li>
        ))}
      </ul>

      {total > linhas.length && (
        <p className="mt-2 pl-6 text-meta text-ink-4">e mais {total - linhas.length}.</p>
      )}
    </div>
  );
}

/**
 * "Enviar o convite para a app?"
 *
 * Desligada, sempre. A importação de um livro antigo é trabalho de secretaria;
 * mandar correio a trezentas pessoas é outra decisão, com outro momento e
 * outro responsável. Estava ligada por omissão e ninguém a via — o botão dizia
 * "Importar e convidar" e os emails saíam.
 */
export function EnviarConvites({
  ligado,
  onChange,
  substantivo,
  desativado,
  semEmail,
}: {
  ligado: boolean;
  onChange: (v: boolean) => void;
  substantivo: "sócio" | "atleta";
  desativado?: boolean;
  /** Quantos da folha não têm email. Esses nunca recebem nada. */
  semEmail?: number;
}) {
  const plural = substantivo === "sócio" ? "sócios" : "atletas";

  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-control)] border border-line bg-sunken/40 px-3 py-2.5">
      <input
        type="checkbox"
        checked={ligado}
        disabled={desativado}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-[var(--color-signal)]"
      />
      <span className="text-body text-ink-2">
        Enviar o convite para a app
        <span className="block text-meta leading-relaxed text-ink-4">
          Cada {substantivo} com email na folha recebe, ao importar, um email para criar conta. Deixa desligado
          para carregar os dados agora e convidar os {plural} depois, pela lista.
          {semEmail ? ` ${semEmail} ${semEmail === 1 ? "linha não tem" : "linhas não têm"} email e não recebem nada.` : ""}
        </span>
      </span>
    </label>
  );
}
