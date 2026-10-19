-- CreateEnum
CREATE TYPE "StatusSessao" AS ENUM ('ATIVA', 'ROTACIONADA', 'ENCERRADA', 'REVOGADA');

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "emailVerificado" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "perfil" SET DEFAULT 'COMUM';

-- CreateTable
CREATE TABLE "CodigoVerificacaoEmail" (
    "id" UUID NOT NULL,
    "idUsuario" UUID NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "usado" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodigoVerificacaoEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sessao" (
    "id" UUID NOT NULL,
    "idUsuario" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "StatusSessao" NOT NULL DEFAULT 'ATIVA',
    "substituidaPor" UUID,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sessao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodigoVerificacaoEmail_idUsuario_idx" ON "CodigoVerificacaoEmail"("idUsuario");

-- CreateIndex
CREATE UNIQUE INDEX "Sessao_tokenHash_key" ON "Sessao"("tokenHash");

-- CreateIndex
CREATE INDEX "Sessao_idUsuario_idx" ON "Sessao"("idUsuario");

-- AddForeignKey
ALTER TABLE "CodigoVerificacaoEmail" ADD CONSTRAINT "CodigoVerificacaoEmail_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sessao" ADD CONSTRAINT "Sessao_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
