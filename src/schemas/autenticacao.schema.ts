import { z } from "zod";

export const schemaCadastro = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "O nome deve ter no mínimo 2 caracteres.")
    .max(100, "O nome deve ter no máximo 100 caracteres."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("E-mail em formato inválido.")
    .max(255, "O e-mail deve ter no máximo 255 caracteres."),
  senha: z
    .string()
    .min(10, "A senha deve ter no mínimo 10 caracteres.")
    .max(128, "A senha deve ter no máximo 128 caracteres."),
  dataNascimento: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), "Data de nascimento inválida.")
    .transform((val) => new Date(val))
    .refine((data) => data < new Date(), "A data de nascimento deve ser no passado."),
  fotoPerfil: z
    .string()
    .url("A foto de perfil deve ser uma URL válida.")
    .optional(),
});

export type EntradaCadastro = z.infer<typeof schemaCadastro>;

export const schemaVerificarEmail = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("E-mail em formato inválido."),
  codigo: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "O código deve conter exatamente 6 dígitos numéricos."),
});

export type EntradaVerificarEmail = z.infer<typeof schemaVerificarEmail>;

export const schemaReenviarCodigo = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("E-mail em formato inválido."),
});

export type EntradaReenviarCodigo = z.infer<typeof schemaReenviarCodigo>;
