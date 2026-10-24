-- CreateTable
CREATE TABLE "AlteracaoEmail" (
    "id" UUID NOT NULL,
    "idUsuario" UUID NOT NULL,
    "emailAtual" TEXT NOT NULL,
    "emailNovo" TEXT NOT NULL,
    "tokenEmailAtualHash" TEXT,
    "tokenEmailNovoHash" TEXT,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "emailAtualConfirmadoEm" TIMESTAMP(3),
    "concluidaEm" TIMESTAMP(3),
    "invalidadaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlteracaoEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlteracaoEmail_tokenEmailAtualHash_key" ON "AlteracaoEmail"("tokenEmailAtualHash");

-- CreateIndex
CREATE UNIQUE INDEX "AlteracaoEmail_tokenEmailNovoHash_key" ON "AlteracaoEmail"("tokenEmailNovoHash");

-- CreateIndex
CREATE INDEX "AlteracaoEmail_idUsuario_idx" ON "AlteracaoEmail"("idUsuario");

-- CreateIndex
CREATE INDEX "AlteracaoEmail_emailNovo_idx" ON "AlteracaoEmail"("emailNovo");

-- CreateIndex
CREATE INDEX "AlteracaoEmail_expiraEm_idx" ON "AlteracaoEmail"("expiraEm");

-- AddForeignKey
ALTER TABLE "AlteracaoEmail" ADD CONSTRAINT "AlteracaoEmail_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
