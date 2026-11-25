-- CreateTable
CREATE TABLE "HistoricoReproducaoAmbiente" (
    "id" UUID NOT NULL,
    "idUsuario" UUID NOT NULL,
    "idAmbienteSonoro" UUID NOT NULL,
    "ultimaReproducao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoricoReproducaoAmbiente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HistoricoReproducaoAmbiente_idUsuario_ultimaReproducao_idx" ON "HistoricoReproducaoAmbiente"("idUsuario", "ultimaReproducao" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "HistoricoReproducaoAmbiente_idUsuario_idAmbienteSonoro_key" ON "HistoricoReproducaoAmbiente"("idUsuario", "idAmbienteSonoro");

-- AddForeignKey
ALTER TABLE "HistoricoReproducaoAmbiente" ADD CONSTRAINT "HistoricoReproducaoAmbiente_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoReproducaoAmbiente" ADD CONSTRAINT "HistoricoReproducaoAmbiente_idAmbienteSonoro_fkey" FOREIGN KEY ("idAmbienteSonoro") REFERENCES "AmbienteSonoro"("idAmbienteSonoro") ON DELETE CASCADE ON UPDATE CASCADE;
