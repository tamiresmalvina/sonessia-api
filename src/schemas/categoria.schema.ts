import { z } from "zod";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const nomeCategoria = z
  .string()
  .trim()
  .min(1, "O nome da categoria é obrigatório.")
  .max(255, "O nome da categoria deve ter no máximo 255 caracteres.");

export const schemaFiltroCategorias = z
  .object({
    tipo: z.enum(["AUDIO", "AMBIENTE"], {
      message: "O tipo deve ser AUDIO ou AMBIENTE.",
    }),
    incluirInativas: z
      .enum(["true", "false"], {
        message: "incluirInativas deve ser true ou false.",
      })
      .optional()
      .transform((valor) => valor === "true"),
  })
  .strict();

export const schemaCriarCategoria = z
  .object({
    nome: nomeCategoria,
    tipo: z.enum(["AUDIO", "AMBIENTE"], {
      message: "O tipo deve ser AUDIO ou AMBIENTE.",
    }),
  })
  .strict();

export const schemaAtualizarCategoria = z
  .object({
    nome: nomeCategoria.optional(),
    ativa: z.boolean({
      message: "O status ativa deve ser booleano.",
    }).optional(),
  })
  .strict()
  .refine((dados) => Object.keys(dados).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

export const schemaIdCategoria = z.string().regex(UUID_REGEX, "O identificador da categoria é inválido.");

export type FiltroCategorias = z.infer<typeof schemaFiltroCategorias>;
export type EntradaCriarCategoria = z.infer<typeof schemaCriarCategoria>;
export type EntradaAtualizarCategoria = z.infer<typeof schemaAtualizarCategoria>;
