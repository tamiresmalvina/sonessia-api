import { z } from "zod";
import { CategoriaAudio } from "../../generated/prisma/enums.js";

const textoObrigatorio = (campo: string, maximo: number) =>
  z
    .string()
    .trim()
    .min(1, `${campo} é obrigatório.`)
    .max(maximo, `${campo} deve ter no máximo ${maximo} caracteres.`);

const metadadosBase = {
  descricao: textoObrigatorio("A descrição", 1000).optional(),
  categoria: z.nativeEnum(CategoriaAudio),
  titulo: textoObrigatorio("O título", 255),
  tituloOriginal: textoObrigatorio("O título original", 255),
  fonte: textoObrigatorio("A fonte", 255),
  licenca: textoObrigatorio("A licença", 255),
};

export const schemaCriarAudio = z.object(metadadosBase).strict();

export const schemaAtualizarAudio = z
  .object({
    descricao: z.union([textoObrigatorio("A descrição", 1000), z.null()]),
    categoria: metadadosBase.categoria.optional(),
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
