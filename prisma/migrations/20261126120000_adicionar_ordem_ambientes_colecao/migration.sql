-- Persist the playback order for each collection.
ALTER TABLE "ColecaoAmbienteSonoro"
ADD COLUMN "posicao" INTEGER NOT NULL DEFAULT 0;

-- Existing associations had no defined order. Establish a stable initial order.
WITH ordenacao AS (
  SELECT
    "idColecao",
    "idAmbienteSonoro",
    ROW_NUMBER() OVER (
      PARTITION BY "idColecao"
      ORDER BY "idAmbienteSonoro"
    ) - 1 AS posicao
  FROM "ColecaoAmbienteSonoro"
)
UPDATE "ColecaoAmbienteSonoro" AS associacao
SET "posicao" = ordenacao.posicao
FROM ordenacao
WHERE associacao."idColecao" = ordenacao."idColecao"
  AND associacao."idAmbienteSonoro" = ordenacao."idAmbienteSonoro";
