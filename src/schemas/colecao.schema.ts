import { z } from "zod";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const textoObrigatorio = (campo: string, maximo: number) =>
  z
    .string({ message: `${campo} é obrigatório.` })
    .trim()
    .min(1, `${campo} é obrigatório.`)
    .max(maximo, `${campo} deve ter no máximo ${maximo} caracteres.`);

const listaIdsAmbientesSonoros = z
  .array(
    z.string().trim().regex(UUID_REGEX, "O identificador do ambiente sonoro é inválido.")
  )
  .max(1000, "A coleção excede o limite de ambientes permitido.")
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "A lista de ambientes não pode conter itens repetidos.",
  });

export const schemaCriarColecao = z
  .object({
    nome: textoObrigatorio("O nome da coleção", 255),
    descricao: textoObrigatorio("A descrição", 1000).optional().nullable(),
    idsAmbientesSonoros: listaIdsAmbientesSonoros.optional().default([]),
  })
  .strict();

export const schemaAtualizarColecao = z
  .object({
    nome: textoObrigatorio("O nome da coleção", 255).optional(),
    descricao: z
      .union([textoObrigatorio("A descrição", 1000), z.null()])
      .optional(),
    idsAmbientesSonoros: listaIdsAmbientesSonoros.optional(),
  })
  .strict()
  .refine((dados) => Object.keys(dados).length > 0, {
    message: "Informe ao menos um campo para atualizar a coleção.",
  });

export const schemaAdicionarAmbienteColecao = z
  .object({
    idAmbienteSonoro: z
      .string({ message: "O identificador do ambiente sonoro é obrigatório." })
      .trim()
      .regex(UUID_REGEX, "O identificador do ambiente sonoro é inválido."),
  })
  .strict();

export const schemaReordenarAmbientesColecao = z
  .object({
    idsAmbientesSonoros: z
      .array(
        z.string().trim().regex(UUID_REGEX, "O identificador do ambiente sonoro é inválido.")
      )
      .max(1000, "A coleção excede o limite de ambientes permitido."),
  })
  .strict()
  .refine(
    ({ idsAmbientesSonoros }) => new Set(idsAmbientesSonoros).size === idsAmbientesSonoros.length,
    { message: "A ordem não pode conter ambientes repetidos." }
  );

export type EntradaCriarColecao = z.infer<typeof schemaCriarColecao>;
export type EntradaAtualizarColecao = z.infer<typeof schemaAtualizarColecao>;
export type EntradaAdicionarAmbienteColecao = z.infer<typeof schemaAdicionarAmbienteColecao>;
export type EntradaReordenarAmbientesColecao = z.infer<typeof schemaReordenarAmbientesColecao>;

