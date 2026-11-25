import { z } from "zod";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const schemaRegistrarReproducao = z
  .object({
    idAmbienteSonoro: z
      .string({ message: "O identificador do ambiente sonoro é obrigatório." })
      .trim()
      .regex(UUID_REGEX, "O identificador do ambiente sonoro é inválido."),
  })
  .strict();

export type EntradaRegistrarReproducao = z.infer<typeof schemaRegistrarReproducao>;
