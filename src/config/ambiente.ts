import "dotenv/config";
import { z } from "zod";

const normalizarOpcional = (val: unknown) =>
  typeof val === "string" && val.trim() === "" ? undefined : val;

const campoCredencialCloudinary = z.preprocess(
  normalizarOpcional,
  z.string().trim().min(1, "não pode ser vazio").optional()
);

const TTL_ACESSO_MINIMO_SEGUNDOS = 60;
const TTL_ACESSO_MAXIMO_SEGUNDOS = 60 * 60;
const TTL_REFRESH_MINIMO_DIAS = 1;
const TTL_REFRESH_MAXIMO_DIAS = 90;
const TTL_ACESSO_REGEX = /^(\d+)(s|m|h|d)$/i;
const DURACAO_UNIDADES_SEGUNDOS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
};

const PLACEHOLDER_REGEX = /(?:^|[\s_])(?:placeholder|change[-_ ]?me|your(?:[-_ ]|$)|example(?:[-_ ]|$)|localhost|development|dev|test)(?:$|[\s_.-])|<[^>]*>/i;
const VALORES_PLACEHOLDER = new Set(["secret", "password", "123456", "changeme", "example"]);

function ehPlaceholder(valor: string): boolean {
  const normalizado = valor.trim().toLowerCase();
  return VALORES_PLACEHOLDER.has(normalizado) || PLACEHOLDER_REGEX.test(normalizado);
}

function segredoJwtForte(valor: string): boolean {
  const caracteresUnicos = new Set(valor).size;
  return valor.length >= 32 && caracteresUnicos >= 12 && !ehPlaceholder(valor);
}

function ttlAcessoEmSegundos(valor: string): number | undefined {
  const correspondencia = TTL_ACESSO_REGEX.exec(valor);
  if (!correspondencia) return undefined;

  const quantidade = Number(correspondencia[1]);
  const unidade = correspondencia[2]?.toLowerCase();
  const multiplicador = unidade ? DURACAO_UNIDADES_SEGUNDOS[unidade] : undefined;
  if (!Number.isSafeInteger(quantidade) || !multiplicador) return undefined;
  return quantidade * multiplicador;
}

function origemValida(valor: string, producao: boolean): boolean {
  if (valor.includes("*") || valor !== valor.trim()) return false;

  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return false;
  }

  // Uma Origin serializada não possui caminho, query, fragmento ou credenciais.
  if (
    !["http:", "https:"].includes(url.protocol) ||
    valor !== url.origin ||
    url.username ||
    url.password
  ) {
    return false;
  }

  if (!producao) return true;
  const hostname = url.hostname.toLowerCase();
  const localhost =
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname === "0.0.0.0" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname) ||
    hostname.endsWith(".localhost");
  return url.protocol === "https:" && !localhost;
}

const schemaAmbiente = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    PORT: z.coerce.number().int().positive().default(3000),
    FRONTEND_ORIGIN: z.preprocess(
      normalizarOpcional,
      z.string().optional()
    ),
    DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
    JWT_ACCESS_SECRET: z.string().trim().min(1, "JWT_ACCESS_SECRET é obrigatório"),
    JWT_ISSUER: z.string().trim().min(1, "JWT_ISSUER é obrigatório").max(255),
    JWT_AUDIENCE: z.string().trim().min(1, "JWT_AUDIENCE é obrigatório").max(255),
    ACCESS_TOKEN_TTL: z.string().trim().default("15m"),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(7),
    TRUST_PROXY_MODE: z.enum(["direct", "render"]).default("direct"),
    EMAIL_PROVIDER: z.enum(["ethereal", "mailpit", "gmail"]).default("ethereal"),
    EMAIL_FROM: z.preprocess(normalizarOpcional, z.string().trim().email().optional()),
    SMTP_HOST: z.string().trim().min(1).default("smtp.gmail.com"),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.preprocess(normalizarOpcional, z.string().trim().email().optional()),
    SMTP_PASS: z.preprocess(normalizarOpcional, z.string().min(1).optional()),
    MAILPIT_HOST: z.string().default("localhost"),
    MAILPIT_PORT: z.coerce.number().int().positive().default(1025),
    CLOUDINARY_CLOUD_NAME: campoCredencialCloudinary,
    CLOUDINARY_API_KEY: campoCredencialCloudinary,
    CLOUDINARY_API_SECRET: campoCredencialCloudinary,
  })
  .superRefine((dados, ctx) => {
    const isProducao = dados.NODE_ENV === "production";
    const ttlAcesso = ttlAcessoEmSegundos(dados.ACCESS_TOKEN_TTL);

    if (ttlAcesso === undefined || ttlAcesso < TTL_ACESSO_MINIMO_SEGUNDOS || ttlAcesso > TTL_ACESSO_MAXIMO_SEGUNDOS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ACCESS_TOKEN_TTL"],
        message: "deve usar formato como 15m e estar entre 1m e 1h",
      });
    }

    if (
      dados.REFRESH_TOKEN_TTL_DAYS < TTL_REFRESH_MINIMO_DIAS ||
      dados.REFRESH_TOKEN_TTL_DAYS > TTL_REFRESH_MAXIMO_DIAS
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["REFRESH_TOKEN_TTL_DAYS"],
        message: "deve ser um número inteiro entre 1 e 90 dias",
      });
    }

    if (dados.EMAIL_PROVIDER === "gmail") {
      if (!dados.EMAIL_FROM) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["EMAIL_FROM"],
          message: "é obrigatório quando EMAIL_PROVIDER=gmail",
        });
      }
      if (dados.SMTP_HOST.toLowerCase() !== "smtp.gmail.com") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SMTP_HOST"],
          message: "deve ser smtp.gmail.com quando EMAIL_PROVIDER=gmail",
        });
      }
      if (dados.SMTP_PORT !== 587) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SMTP_PORT"],
          message: "deve ser 587 quando EMAIL_PROVIDER=gmail",
        });
      }
      if (!dados.SMTP_USER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SMTP_USER"],
          message: "é obrigatório quando EMAIL_PROVIDER=gmail",
        });
      }
      if (!dados.SMTP_PASS || dados.SMTP_PASS.replace(/\s/g, "").length !== 16) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SMTP_PASS"],
          message: "deve ser uma senha de aplicativo do Google com 16 caracteres",
        });
      }
    }

    if (isProducao) {
      if (!segredoJwtForte(dados.JWT_ACCESS_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["JWT_ACCESS_SECRET"],
          message: "deve ter ao menos 32 caracteres, boa diversidade e não ser um placeholder",
        });
      }

      for (const campo of ["JWT_ISSUER", "JWT_AUDIENCE"] as const) {
        if (ehPlaceholder(dados[campo])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [campo],
            message: "não pode conter valor de exemplo ou desenvolvimento",
          });
        }
      }

      if (!dados.FRONTEND_ORIGIN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["FRONTEND_ORIGIN"],
          message: "FRONTEND_ORIGIN é obrigatória em produção",
        });
      }
    }

    if (dados.FRONTEND_ORIGIN && !origemValida(dados.FRONTEND_ORIGIN, isProducao)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FRONTEND_ORIGIN"],
        message: isProducao
          ? "deve ser uma origem HTTPS exata, sem caminho, wildcard ou localhost"
          : "deve ser uma origem HTTP ou HTTPS exata, sem caminho, query ou fragmento",
      });
    }

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
