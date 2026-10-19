import "dotenv/config";
import { z } from "zod";

const schemaAmbiente = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  FRONTEND_ORIGIN: z.string().optional(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
  JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET é obrigatório"),
  JWT_ISSUER: z.string().min(1, "JWT_ISSUER é obrigatório"),
  JWT_AUDIENCE: z.string().min(1, "JWT_AUDIENCE é obrigatório"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  EMAIL_PROVIDER: z.string().default("ethereal"),
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
