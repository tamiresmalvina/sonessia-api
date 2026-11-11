-- AlterTable
ALTER TABLE "AmbienteSonoro" ADD COLUMN     "publicado" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "AmbienteSonoro_origem_publicado_idx" ON "AmbienteSonoro"("origem", "publicado");

-- CreateIndex
CREATE INDEX "AmbienteSonoro_finalidade_publicado_idx" ON "AmbienteSonoro"("finalidade", "publicado");
