-- A bilheteira, depois da revisão de segurança de 21/10/2026.
--
-- Uma compra de bilhetes e o pagamento dela deixam de se apagar por arrasto.
-- Com `ON DELETE CASCADE`, apagar a venda de um jogo (ou o jogo, que leva a
-- venda) apagava as compras pagas e os pagamentos: os reembolsos por fazer
-- deixavam de estar registados, os QR passavam a "inválido" à porta, e uma
-- referência Multibanco paga depois chegava como pagamento desconhecido.
-- Agora a base recusa, e a API diz porquê (cancela-se a venda primeiro, que
-- anula os bilhetes, regista os reembolsos e avisa quem comprou).
--
-- Só muda o comportamento ao apagar; a API em produção não apaga compras.

ALTER TABLE "TicketOrder" DROP CONSTRAINT IF EXISTS "TicketOrder_matchId_fkey";
ALTER TABLE "TicketOrder" ADD CONSTRAINT "TicketOrder_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "SiteMatchTickets"("matchId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_ticketOrderId_fkey";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_ticketOrderId_fkey"
  FOREIGN KEY ("ticketOrderId") REFERENCES "TicketOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
