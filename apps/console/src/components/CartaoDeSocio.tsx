import { useEffect, useState } from "react";
import { Loading } from "@/components/primitives";
import { Bloco, Erro, Interruptor } from "@/components/definicoes/ui";
import { setMemberCard } from "@/lib/members";

/**
 * O cartão de sócio na app — dois interruptores.
 *
 * ## Porque é que isto vive nas Definições
 *
 * Porque é `settings:write`, como a cor do clube e o nome: uma decisão sobre o
 * que o clube oferece, não sobre um sócio em particular. Estava dentro de um
 * diálogo na página dos sócios, e quem procurasse "onde é que se liga o cartão"
 * ia às Definições — que é onde está tudo o resto que se liga e desliga — e não
 * o encontrava lá.
 *
 * ## O estado inicial vem de um PATCH vazio
 *
 * O endpoint devolve os valores actuais sem mudar nada. Não é elegante, mas
 * evita um GET que só serviria a este painel: dois interruptores não justificam
 * uma rota de leitura própria, e o `academy` do store não os traz.
 */
export function CartaoDeSocioPanel({ mayWrite }: { mayWrite: boolean }) {
  const [estado, setEstado] = useState<{ cardEnabled: boolean; qrEnabled: boolean } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setMemberCard({})
      .then(setEstado)
      .catch((e: Error) => setErro(e.message));
  }, []);

  async function alternar(campo: "cardEnabled" | "qrEnabled") {
    if (!estado || !mayWrite) return;
    const novo = { ...estado, [campo]: !estado[campo] };
    setEstado(novo); // optimista: um interruptor que espera pela rede parece avariado
    try {
      setEstado(await setMemberCard({ [campo]: novo[campo] }));
    } catch (e) {
      setEstado(estado);
      setErro(e instanceof Error ? e.message : "Não foi possível gravar.");
    }
  }

  if (erro) return <Erro>{erro}</Erro>;
  if (!estado) {
    return (
      <div className="py-10">
        <Loading size="panel" />
      </div>
    );
  }

  return (
    <>
      <Bloco
        titulo="Cartão de sócio"
        descricao="O cartão digital na app do clube: nome, número, categoria e estado. Com ele desligado, os sócios não veem cartão nenhum."
      >
        <div className="flex items-center justify-between gap-4">
          <span className="text-body text-ink">{estado.cardEnabled ? "Ligado" : "Desligado"}</span>
          <Interruptor
            label="Cartão de sócio"
            ligado={estado.cardEnabled}
            onChange={() => void alternar("cardEnabled")}
            disabled={!mayWrite}
          />
        </div>
      </Bloco>

      <Bloco
        titulo="QR Code"
        descricao="Um código no cartão para identificar o sócio à entrada. Leva um código opaco, nunca dados pessoais. Só faz sentido com o cartão ligado."
      >
        <div className="flex items-center justify-between gap-4">
          <span className="text-body text-ink">
            {!estado.cardEnabled ? "Precisa do cartão ligado" : estado.qrEnabled ? "Ligado" : "Desligado"}
          </span>
          <Interruptor
            label="QR Code no cartão"
            ligado={estado.qrEnabled}
            onChange={() => void alternar("qrEnabled")}
            disabled={!mayWrite || !estado.cardEnabled}
          />
        </div>
      </Bloco>
    </>
  );
}
