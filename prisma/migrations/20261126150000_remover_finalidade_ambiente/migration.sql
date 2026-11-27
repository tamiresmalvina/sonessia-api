BEGIN;

-- Ambientes já existentes sem categoria continuam preservados. Não há mapeamento
-- seguro da classificação antiga para todas as categorias dinâmicas disponíveis.
DROP INDEX IF EXISTS "AmbienteSonoro_finalidade_publicado_idx";
DROP INDEX IF EXISTS "AmbienteSonoro_finalidade_idx";

ALTER TABLE "AmbienteSonoro" DROP COLUMN IF EXISTS "finalidade";

-- A migration é repetível em bases onde o tipo já tenha sido removido e falha
-- naturalmente caso ainda exista alguma dependência não prevista.
DROP TYPE IF EXISTS "Finalidade";

COMMIT;
