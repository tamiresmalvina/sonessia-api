-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "exclusaoDefinitivaEm" TIMESTAMP(3),
ADD COLUMN     "exclusaoProcessamentoAte" TIMESTAMP(3),
ADD COLUMN     "exclusaoProcessamentoToken" UUID,
ADD COLUMN     "exclusaoSolicitadaEm" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Usuario_exclusaoDefinitivaEm_idx" ON "Usuario"("exclusaoDefinitivaEm");
