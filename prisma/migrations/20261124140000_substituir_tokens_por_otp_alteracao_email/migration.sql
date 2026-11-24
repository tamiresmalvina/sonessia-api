ALTER TABLE "AlteracaoEmail"
  ADD COLUMN "tentativasCodigo" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reenviosCodigo" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "codigoEnviadoEm" TIMESTAMP(3);

DROP INDEX IF EXISTS "AlteracaoEmail_tokenEmailAtualHash_key";
DROP INDEX IF EXISTS "AlteracaoEmail_tokenEmailNovoHash_key";

UPDATE "AlteracaoEmail"
SET
  "tokenEmailAtualHash" = NULL,
  "tokenEmailNovoHash" = NULL,
  "invalidadaEm" = COALESCE("invalidadaEm", CURRENT_TIMESTAMP),
  "tentativasCodigo" = 0,
  "reenviosCodigo" = 0,
  "codigoEnviadoEm" = NULL
WHERE "concluidaEm" IS NULL
  AND "invalidadaEm" IS NULL;
