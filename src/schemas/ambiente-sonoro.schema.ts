import { z } from "zod";
import { Finalidade } from "../../generated/prisma/enums.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const textoObrigatorio = (campo: string, maximo: number) =>
  z
    .string()
    .trim()
    .min(1, `${campo} é obrigatório.`)
    .max(maximo, `${campo} deve ter no máximo ${maximo} caracteres.`);

export const itemComposicaoAudioSchema = z
  .object({
    idAudio: z
      .string()
      .trim()
      .regex(UUID_REGEX, "O identificador do áudio é inválido."),
    volume: z
      .number()
      .int("O volume deve ser um número inteiro.")
      .min(0, "O volume deve ser no mínimo 0.")
      .max(100, "O volume deve ser no máximo 100."),
  })
  .strict();

export const schemaCriarAmbienteSonoro = z
  .object({
    nome: textoObrigatorio("O nome", 255),
    descricao: textoObrigatorio("A descrição", 1000).optional().nullable(),
    finalidade: z.nativeEnum(Finalidade),
    audios: z
      .array(itemComposicaoAudioSchema)
      .min(1, "O ambiente deve conter ao menos um áudio.")
      .refine(
        (itens) =>
          new Set(itens.map((item) => item.idAudio.toLowerCase())).size ===
          itens.length,
        {
          message: "Não é permitido áudio duplicado na mesma composição.",
        }
      ),
  })
  .strict();

export const schemaAtualizarAmbienteSonoro = z
  .object({
    nome: textoObrigatorio("O nome", 255).optional(),
    descricao: z
      .union([textoObrigatorio("A descrição", 1000), z.null()])
      .optional(),
    finalidade: z.nativeEnum(Finalidade).optional(),
    audios: z
      .array(itemComposicaoAudioSchema)
      .min(1, "O ambiente deve conter ao menos um áudio.")
      .refine(
        (itens) =>
          new Set(itens.map((item) => item.idAudio.toLowerCase())).size ===
          itens.length,
        {
          message: "Não é permitido áudio duplicado na mesma composição.",
        }
      )
      .optional(),
  })
  .strict()
  .refine((dados) => Object.keys(dados).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

export const schemaCriarAmbientePreConfigurado = z
  .object({
    nome: textoObrigatorio("O nome", 255),
    descricao: textoObrigatorio("A descrição", 1000).optional().nullable(),
    finalidade: z.nativeEnum(Finalidade),
    publicado: z.boolean().optional().default(false),
    imagem: textoObrigatorio("A imagem", 2048).optional().nullable(),
    autorImagem: textoObrigatorio("O autor da imagem", 255).optional().nullable(),
    tituloOriginalImagem: textoObrigatorio("O título original da imagem", 255).optional().nullable(),
    fonteImagem: textoObrigatorio("A fonte da imagem", 255).optional().nullable(),
    licencaImagem: textoObrigatorio("A licença da imagem", 255).optional().nullable(),
    audios: z
      .array(itemComposicaoAudioSchema)
      .min(1, "O ambiente deve conter ao menos um áudio.")
      .refine(
        (itens) =>
          new Set(itens.map((item) => item.idAudio.toLowerCase())).size ===
          itens.length,
        {
          message: "Não é permitido áudio duplicado na mesma composição.",
        }
      ),
  })
  .strict();

export const schemaAtualizarAmbientePreConfigurado = z
  .object({
    nome: textoObrigatorio("O nome", 255).optional(),
    descricao: z
      .union([textoObrigatorio("A descrição", 1000), z.null()])
      .optional(),
    finalidade: z.nativeEnum(Finalidade).optional(),
    publicado: z.boolean().optional(),
    imagem: z.union([textoObrigatorio("A imagem", 2048), z.null()]).optional(),
    autorImagem: z.union([textoObrigatorio("O autor da imagem", 255), z.null()]).optional(),
    tituloOriginalImagem: z.union([textoObrigatorio("O título original da imagem", 255), z.null()]).optional(),
    fonteImagem: z.union([textoObrigatorio("A fonte da imagem", 255), z.null()]).optional(),
    licencaImagem: z.union([textoObrigatorio("A licença da imagem", 255), z.null()]).optional(),
    audios: z
      .array(itemComposicaoAudioSchema)
      .min(1, "O ambiente deve conter ao menos um áudio.")
      .refine(
        (itens) =>
          new Set(itens.map((item) => item.idAudio.toLowerCase())).size ===
          itens.length,
        {
          message: "Não é permitido áudio duplicado na mesma composição.",
        }
      )
      .optional(),
  })
  .strict()
  .refine((dados) => Object.keys(dados).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

export const schemaPublicacaoAmbiente = z
  .object({
    publicado: z.boolean({
      message: "O campo publicado deve ser um booleano.",
    }),
  })
  .strict();

export const schemaFiltroAmbientesPublicos = z
  .object({
    finalidade: z.nativeEnum(Finalidade).optional(),
  })
  .strict();

export type EntradaCriarAmbienteSonoro = z.infer<typeof schemaCriarAmbienteSonoro>;
export type EntradaAtualizarAmbienteSonoro = z.infer<typeof schemaAtualizarAmbienteSonoro>;
export type EntradaCriarAmbientePreConfigurado = z.infer<typeof schemaCriarAmbientePreConfigurado>;
export type EntradaAtualizarAmbientePreConfigurado = z.infer<typeof schemaAtualizarAmbientePreConfigurado>;
export type EntradaPublicacaoAmbiente = z.infer<typeof schemaPublicacaoAmbiente>;
export type FiltroAmbientesPublicos = z.infer<typeof schemaFiltroAmbientesPublicos>;
export type ItemComposicaoAudio = z.infer<typeof itemComposicaoAudioSchema>;
