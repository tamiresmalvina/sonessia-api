BEGIN;

-- CreateEnum
CREATE TYPE "TipoCategoria" AS ENUM ('AUDIO', 'AMBIENTE');

-- CreateTable
CREATE TABLE "Categoria" (
    "idCategoria" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoCategoria" NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataAtualizacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Categoria_pkey" PRIMARY KEY ("idCategoria")
);

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_nome_tipo_key" ON "Categoria"("nome", "tipo");

-- A unicidade normalizada complementa o índice composto usado pelo Prisma.
CREATE UNIQUE INDEX "Categoria_nome_normalizado_tipo_key"
    ON "Categoria" (lower(btrim("nome")), "tipo");

-- CreateIndex
CREATE INDEX "Categoria_tipo_ativa_idx" ON "Categoria"("tipo", "ativa");

-- Inserir categorias padrao iniciais para AUDIO
INSERT INTO "Categoria" ("idCategoria", "nome", "tipo", "ativa", "dataCriacao", "dataAtualizacao")
VALUES
    (gen_random_uuid(), 'Natureza', 'AUDIO', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Ambiente', 'AUDIO', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Instrumental', 'AUDIO', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Ruído', 'AUDIO', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Inserir categorias padrao iniciais para AMBIENTE
INSERT INTO "Categoria" ("idCategoria", "nome", "tipo", "ativa", "dataCriacao", "dataAtualizacao")
VALUES
    (gen_random_uuid(), 'Foco', 'AMBIENTE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Sono', 'AMBIENTE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Relaxamento', 'AMBIENTE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Mascaramento', 'AMBIENTE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Adiciona a relação como nullable para mapear todos os valores existentes antes de
-- tornar a coluna obrigatória.
ALTER TABLE "Audio" ADD COLUMN "idCategoria" UUID;

UPDATE "Audio" a
SET "idCategoria" = c."idCategoria"
FROM "Categoria" c
WHERE c."tipo" = 'AUDIO'
  AND c."nome" = CASE a."categoria"::text
    WHEN 'NATUREZA' THEN 'Natureza'
    WHEN 'AMBIENTE' THEN 'Ambiente'
    WHEN 'INSTRUMENTAL' THEN 'Instrumental'
    WHEN 'RUIDO' THEN 'Ruído'
  END;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "Audio" WHERE "idCategoria" IS NULL) THEN
        RAISE EXCEPTION 'Não foi possível mapear a categoria antiga de todos os áudios; migration cancelada.';
    END IF;
END $$;

-- Tornar idCategoria obrigatorio na tabela Audio
ALTER TABLE "Audio" ALTER COLUMN "idCategoria" SET NOT NULL;

-- Remover a coluna antiga categoria e o enum CategoriaAudio
ALTER TABLE "Audio" DROP COLUMN "categoria";
DROP TYPE "CategoriaAudio";

-- Criar indice e chave estrangeira para Audio -> Categoria
CREATE INDEX "Audio_idCategoria_idx" ON "Audio"("idCategoria");
ALTER TABLE "Audio" ADD CONSTRAINT "Audio_idCategoria_fkey" FOREIGN KEY ("idCategoria") REFERENCES "Categoria"("idCategoria") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Finalidade não determina necessariamente uma categoria administrativa.
-- Ambientes existentes permanecem sem categoria até uma classificação explícita.
ALTER TABLE "AmbienteSonoro" ADD COLUMN "idCategoria" UUID;

-- Criar indice e chave estrangeira para AmbienteSonoro -> Categoria
CREATE INDEX "AmbienteSonoro_idCategoria_idx" ON "AmbienteSonoro"("idCategoria");
ALTER TABLE "AmbienteSonoro" ADD CONSTRAINT "AmbienteSonoro_idCategoria_fkey" FOREIGN KEY ("idCategoria") REFERENCES "Categoria"("idCategoria") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
