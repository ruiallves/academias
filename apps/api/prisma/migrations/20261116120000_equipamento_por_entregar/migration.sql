-- Equipamento por entregar (16/11/2026).
--
-- Uma peça pode ser do atleta (e até estar paga) sem lhe ter sido entregue.
-- `RESERVED` é esse estado: conta em "assignedQuantity" para não se dar a
-- outro, mas ainda está no clube. Os três movimentos novos contam a história:
-- guardar (RESERVE), não entregar (UNRESERVE) e entregar o que estava guardado
-- (HANDOVER).
--
-- Só acrescenta valores: o código antigo continua a funcionar até ao deploy,
-- porque nenhuma linha os usa antes disso.

ALTER TYPE "InventoryAssignmentStatus" ADD VALUE IF NOT EXISTS 'RESERVED' BEFORE 'ACTIVE';

ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'RESERVE';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'UNRESERVE';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'HANDOVER';
