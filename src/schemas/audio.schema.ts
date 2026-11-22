import { z } from "zod";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const textoObrigatorio = (campo: string, maximo: number) =>
  z
    .string()
    .trim()
    .min(1, `${campo} é obrigatório.`)
    .max(maximo, `${campo} deve ter no máximo ${maximo} caracteres.`);

const identificadorIcone = z
  .string()
  .trim()
  .min(1, "O identificador do ícone não pode ser vazio.")
  .max(64, "O identificador do ícone deve ter no máximo 64 caracteres.")
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "O identificador do ícone é inválido.")
  .nullable();

const metadadosBase = {
  descricao: textoObrigatorio("A descrição", 1000).optional(),
  icone: identificadorIcone.optional(),
  idCategoria: z
    .string()
    .trim()
    .regex(UUID_REGEX, "O identificador da categoria é inválido.")
    .optional(),
  categoria: z.string().trim().min(1, "A categoria é obrigatória.").optional(),
  titulo: textoObrigatorio("O título", 255),
  tituloOriginal: textoObrigatorio("O título original", 255),
  fonte: textoObrigatorio("A fonte", 255),
  licenca: textoObrigatorio("A licença", 255),
};

export const schemaCriarAudio = z
  .object(metadadosBase)
  .strict()
  .refine((dados) => dados.idCategoria !== undefined || dados.categoria !== undefined, {
    message: "O identificador ou nome da categoria é obrigatório.",
    path: ["idCategoria"],
  });

export const schemaAtualizarAudio = z
  .object({
    descricao: z.union([textoObrigatorio("A descrição", 1000), z.null()]),
    icone: metadadosBase.icone,
    idCategoria: metadadosBase.idCategoria,
    categoria: metadadosBase.categoria,
    titulo: metadadosBase.titulo.optional(),
    tituloOriginal: metadadosBase.tituloOriginal.optional(),
    fonte: metadadosBase.fonte.optional(),
    licenca: metadadosBase.licenca.optional(),
  })
  .partial()
  .strict()
  .refine((dados) => Object.keys(dados).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

export type EntradaCriarAudio = z.infer<typeof schemaCriarAudio>;
export type EntradaAtualizarAudio = z.infer<typeof schemaAtualizarAudio>;
