import "dotenv/config";
import { z } from "zod";

const normalizarOpcional = (val: unknown) =>
  typeof val === "string" && val.trim() === "" ? undefined : val;

const campoCredencialCloudinary = z.preprocess(
  normalizarOpcional,
  z.string().trim().min(1, "não pode ser vazio").optional()
);

const schemaAmbiente = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    FRONTEND_ORIGIN: z.string().optional(),
    DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
    JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET é obrigatório"),
    JWT_ISSUER: z.string().min(1, "JWT_ISSUER é obrigatório"),
    JWT_AUDIENCE: z.string().min(1, "JWT_AUDIENCE é obrigatório"),
    ACCESS_TOKEN_TTL: z.string().default("15m"),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
    EMAIL_PROVIDER: z.enum(["ethereal", "mailpit"]).default("ethereal"),
    MAILPIT_HOST: z.string().default("localhost"),
    MAILPIT_PORT: z.coerce.number().int().positive().default(1025),
    CLOUDINARY_CLOUD_NAME: campoCredencialCloudinary,
    CLOUDINARY_API_KEY: campoCredencialCloudinary,
    CLOUDINARY_API_SECRET: campoCredencialCloudinary,
  })
  .superRefine((dados, ctx) => {
    const isProducao = dados.NODE_ENV === "production";
    const temAlgumaCredencialCloudinary =
      Boolean(dados.CLOUDINARY_CLOUD_NAME) ||
      Boolean(dados.CLOUDINARY_API_KEY) ||
      Boolean(dados.CLOUDINARY_API_SECRET);

    if (isProducao || temAlgumaCredencialCloudinary) {
      if (!dados.CLOUDINARY_CLOUD_NAME) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CLOUDINARY_CLOUD_NAME"],
          message: isProducao
            ? "CLOUDINARY_CLOUD_NAME é obrigatório em produção"
            : "CLOUDINARY_CLOUD_NAME é obrigatório quando a configuração do Cloudinary for fornecida",
        });
      }

      if (!dados.CLOUDINARY_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CLOUDINARY_API_KEY"],
          message: isProducao
            ? "CLOUDINARY_API_KEY é obrigatória em produção"
            : "CLOUDINARY_API_KEY é obrigatória quando a configuração do Cloudinary for fornecida",
        });
      }

      if (!dados.CLOUDINARY_API_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CLOUDINARY_API_SECRET"],
          message: isProducao
            ? "CLOUDINARY_API_SECRET é obrigatório em produção"
            : "CLOUDINARY_API_SECRET é obrigatório quando a configuração do Cloudinary for fornecida",
        });
      }
    }
  });

export type Ambiente = z.infer<typeof schemaAmbiente>;

export function validarAmbiente(dados: Record<string, unknown> = process.env): Ambiente {
  const resultado = schemaAmbiente.safeParse(dados);

  if (!resultado.success) {
    const variaveisComErro = resultado.error.issues.map((issue) => {
      const nomeVariavel = issue.path.join(".");
      return `${nomeVariavel}: ${issue.message}`;
    });

    console.error("Falha na validação das variáveis de ambiente:");
    for (const erro of variaveisComErro) {
      console.error(`- ${erro}`);
    }

    const nomesVariaveis = resultado.error.issues
      .map((i) => i.path.join("."))
      .filter(Boolean)
      .join(", ");

    throw new Error(
      `Variáveis de ambiente inválidas ou ausentes: ${nomesVariaveis || "configuração inválida"}`
    );
  }

  return resultado.data;
}

export const ambiente = validarAmbiente();
