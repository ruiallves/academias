-- O treinador passa a ser avisado quando uma família diz que o atleta não vai.
--
-- Um clube queixou-se (Santa Maria FC, 27/10/2026): a mãe avisou pela app que o
-- filho não ia ao treino, e o treinador só o soube depois, ao registar as
-- presenças. O aviso ficava gravado e não saía notificação nenhuma.
--
-- Três tipos novos, um por acontecimento:
--   ABSENCE_NOTICED          a família avisa (ou retira o aviso de) uma falta a um treino;
--   CALLUP_DECLINED          a família recusa uma convocatória, ou volta atrás;
--   TRAINING_COACH_ASSIGNED  outra pessoa que não o treinador principal passa a
--                            dar um treino, ou deixa de o dar.
--
-- Só acrescenta valores ao enum. Até isto correr, o servidor novo continua a
-- gravar os avisos das famílias e quem dá cada treino; só as notificações falham,
-- em silêncio e com registo no log. Ver `academy/aviso-ao-treinador.ts`.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ABSENCE_NOTICED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CALLUP_DECLINED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRAINING_COACH_ASSIGNED';
