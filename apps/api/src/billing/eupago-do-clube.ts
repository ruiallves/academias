/**
 * O clube tem o seu canal euPago configurado?
 *
 * ## O que conta como configurado
 *
 * As duas chaves do canal do clube: a da API (com que os pagamentos são criados
 * e o dinheiro cai na conta **dele**) e a do webhook (com que as confirmações
 * desse canal são verificadas). Só a primeira não chega: os pagamentos nasciam
 * e nunca eram confirmados.
 *
 * ## Porque é que isto decide os pagamentos pela app
 *
 * Sem canal próprio, um pagamento iniciado na app seguia pela chave geral do
 * ambiente e o dinheiro ia parar à conta da plataforma, e não à do clube. Foi
 * assim enquanto só um clube cobrava online; com vários, é dinheiro de um clube
 * na conta errada. Por isso um clube sem canal não pode ter os pagamentos pela
 * app ligados: `setPaymentRules` recusa ligá-los, e apagar as chaves no painel
 * desliga-os. Ver a migração `pagamentos_so_com_eupago`.
 */
export function eupagoConfigurado(a: { eupagoApiKey: string | null; eupagoWebhookSecret: string | null } | null | undefined): boolean {
  return Boolean(a?.eupagoApiKey?.trim() && a?.eupagoWebhookSecret?.trim());
}

/** A mensagem de quando se tenta ligar os pagamentos sem canal. Uma só, para as apps e os testes. */
export const MENSAGEM_SEM_EUPAGO =
  "Os pagamentos pela app só se podem ligar depois de o euPago do clube estar configurado. Fala connosco para tratarmos disso.";
