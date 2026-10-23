-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "senhaAlteradaEm" TIMESTAMP(3),
ADD COLUMN     "versaoToken" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "TokenRecuperacaoSenha" (
    "id" UUID NOT NULL,
    "idUsuario" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "usado" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenRecuperacaoSenha_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenRecuperacaoSenha_tokenHash_key" ON "TokenRecuperacaoSenha"("tokenHash");

-- CreateIndex
CREATE INDEX "TokenRecuperacaoSenha_idUsuario_idx" ON "TokenRecuperacaoSenha"("idUsuario");

-- AddForeignKey
ALTER TABLE "TokenRecuperacaoSenha" ADD CONSTRAINT "TokenRecuperacaoSenha_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
