import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { validarAmbiente } from "../src/config/ambiente.js";

const dadosValidosDesenvolvimento = {
  NODE_ENV: "development",
  PORT: "3000",
  FRONTEND_ORIGIN: "http://localhost:5173",
  DATABASE_URL: "postgresql://usuario:senha@localhost:5432/sonessia",
  JWT_ACCESS_SECRET: "chave-secreta-controlada-apenas-para-testes-123456",
  JWT_ISSUER: "sonessia-api",
  JWT_AUDIENCE: "sonessia-web",
  ACCESS_TOKEN_TTL: "15m",
  REFRESH_TOKEN_TTL_DAYS: "7",
  EMAIL_PROVIDER: "ethereal",
};

const dadosValidosProducao = {
  ...dadosValidosDesenvolvimento,
  NODE_ENV: "production",
  FRONTEND_ORIGIN: "https://app.sonessia.com",
  JWT_ACCESS_SECRET: crypto.randomBytes(32).toString("base64url"),
  JWT_ISSUER: "https://api.sonessia.com",
  JWT_AUDIENCE: "https://app.sonessia.com",
  CLOUDINARY_CLOUD_NAME: "test-cloud",
  CLOUDINARY_API_KEY: "test-key",
  CLOUDINARY_API_SECRET: "test-cloud-secret",
};

describe("Validação das variáveis de ambiente", () => {
  it("valida desenvolvimento e mantém defaults seguros", () => {
    const config = validarAmbiente({ ...dadosValidosDesenvolvimento, PORT: undefined });

    expect(config.NODE_ENV).toBe("development");
    expect(config.PORT).toBe(3000);
    expect(config.ACCESS_TOKEN_TTL).toBe("15m");
    expect(config.REFRESH_TOKEN_TTL_DAYS).toBe(7);
    expect(config.FRONTEND_ORIGIN).toBe("http://localhost:5173");
  });

  it.each(["development", "test", "production"])("aceita NODE_ENV=%s quando declarado", (nodeEnv) => {
    const dados = nodeEnv === "production"
      ? { ...dadosValidosProducao }
      : { ...dadosValidosDesenvolvimento, NODE_ENV: nodeEnv };

    expect(validarAmbiente(dados).NODE_ENV).toBe(nodeEnv);
  });

  it.each(["development", "test"])("preserva segredos locais não fortes em %s", (nodeEnv) => {
    const dados = { ...dadosValidosDesenvolvimento, NODE_ENV: nodeEnv, JWT_ACCESS_SECRET: "local" };
    expect(validarAmbiente(dados).JWT_ACCESS_SECRET).toBe("local");
  });

  it("rejeita NODE_ENV ausente ou inválido sem assumir development", () => {
    const semNodeEnv = { ...dadosValidosDesenvolvimento } as Record<string, unknown>;
    delete semNodeEnv.NODE_ENV;
    expect(() => validarAmbiente(semNodeEnv)).toThrowError(/NODE_ENV/);
    expect(() => validarAmbiente({ ...dadosValidosDesenvolvimento, NODE_ENV: "staging" })).toThrowError(/NODE_ENV/);
  });

  it("rejeita variáveis obrigatórias ausentes sem expor valores sensíveis", () => {
    for (const campo of ["DATABASE_URL", "JWT_ACCESS_SECRET", "JWT_ISSUER", "JWT_AUDIENCE"] as const) {
      const dados = { ...dadosValidosDesenvolvimento } as Record<string, unknown>;
      delete dados[campo];
      expect(() => validarAmbiente(dados)).toThrowError(new RegExp(campo));
    }

    try {
      validarAmbiente({ ...dadosValidosDesenvolvimento, PORT: "porta-invalida" });
      expect.fail("Deveria rejeitar a configuração inválida");
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      expect(mensagem).toContain("PORT");
      expect(mensagem).not.toContain(dadosValidosDesenvolvimento.JWT_ACCESS_SECRET);
      expect(mensagem).not.toContain("postgresql://");
    }
  });

  describe("produção", () => {
    it("aceita uma configuração de produção completa", () => {
      expect(validarAmbiente(dadosValidosProducao).NODE_ENV).toBe("production");
    });

    it("exige segredo JWT forte e rejeita ausente, curto, repetitivo ou placeholder", () => {
      for (const segredo of [undefined, "curto", "a".repeat(48), "<SEGREDO_ALEATORIO_FORTE>"]) {
        expect(() => validarAmbiente({ ...dadosValidosProducao, JWT_ACCESS_SECRET: segredo }))
          .toThrowError(/JWT_ACCESS_SECRET/);
      }

      expect(() => validarAmbiente({ ...dadosValidosProducao, JWT_ACCESS_SECRET: undefined }))
        .toThrowError(/JWT_ACCESS_SECRET/);
      expect(validarAmbiente(dadosValidosProducao).JWT_ACCESS_SECRET).toBe(dadosValidosProducao.JWT_ACCESS_SECRET);
    });

    it.each([
      ["JWT_ISSUER", undefined],
      ["JWT_ISSUER", "   "],
      ["JWT_ISSUER", "development"],
      ["JWT_ISSUER", "<EMISSOR>"],
      ["JWT_AUDIENCE", undefined],
      ["JWT_AUDIENCE", "   "],
      ["JWT_AUDIENCE", "localhost"],
      ["JWT_AUDIENCE", "<PUBLICO>"],
    ])("rejeita %s inválido", (campo, valor) => {
      expect(() => validarAmbiente({ ...dadosValidosProducao, [campo]: valor })).toThrowError(new RegExp(campo));
    });

    it("exige FRONTEND_ORIGIN em produção", () => {
      expect(() => validarAmbiente({ ...dadosValidosProducao, FRONTEND_ORIGIN: undefined }))
        .toThrowError(/FRONTEND_ORIGIN/);
      expect(() => validarAmbiente({ ...dadosValidosProducao, FRONTEND_ORIGIN: "   " }))
        .toThrowError(/FRONTEND_ORIGIN/);
    });

    it.each([
      "not-a-url",
      "http://app.sonessia.example",
      "https://localhost:5173",
      "https://app.sonessia.example/path",
      "https://app.sonessia.example?x=1",
      "https://app.sonessia.example#fragment",
      "https://*.sonessia.example",
      "https://app.sonessia.com/*",
      "https://[::1]:8443",
      "https://127.0.0.1",
      "*",
    ])("rejeita origem de produção inválida: %s", (origin) => {
      expect(() => validarAmbiente({ ...dadosValidosProducao, FRONTEND_ORIGIN: origin }))
        .toThrowError(/FRONTEND_ORIGIN/);
    });
  });

  describe("origens de desenvolvimento e teste", () => {
    it.each(["http://localhost:5173", "https://preview.example.test"])("aceita origem %s", (origin) => {
      expect(validarAmbiente({ ...dadosValidosDesenvolvimento, FRONTEND_ORIGIN: origin }).FRONTEND_ORIGIN)
        .toBe(origin);
    });

    it("permite FRONTEND_ORIGIN ausente em desenvolvimento e testes", () => {
      const desenvolvimento = { ...dadosValidosDesenvolvimento } as Record<string, unknown>;
      delete desenvolvimento.FRONTEND_ORIGIN;
      expect(validarAmbiente(desenvolvimento).FRONTEND_ORIGIN).toBeUndefined();

      const teste = { ...desenvolvimento, NODE_ENV: "test" };
      expect(validarAmbiente(teste).NODE_ENV).toBe("test");
    });
  });

  describe("TTL dos tokens", () => {
    it.each(["1m", "15m", "60s", "1h"])("aceita ACCESS_TOKEN_TTL=%s", (ttl) => {
      expect(validarAmbiente({ ...dadosValidosDesenvolvimento, ACCESS_TOKEN_TTL: ttl }).ACCESS_TOKEN_TTL).toBe(ttl);
    });

    it.each(["", "15", "0m", "-1m", "59s", "1h1s", "2h", "15fortnights", "999999999999999999999d"])(
      "rejeita ACCESS_TOKEN_TTL=%s",
      (ttl) => expect(() => validarAmbiente({ ...dadosValidosDesenvolvimento, ACCESS_TOKEN_TTL: ttl }))
        .toThrowError(/ACCESS_TOKEN_TTL/)
    );

    it.each([1, 7, 90, "7"])("aceita REFRESH_TOKEN_TTL_DAYS=%s", (days) => {
      expect(validarAmbiente({ ...dadosValidosDesenvolvimento, REFRESH_TOKEN_TTL_DAYS: days }).REFRESH_TOKEN_TTL_DAYS)
        .toBe(Number(days));
    });

    it.each([0, -1, 91, "1.5", "inválido"])("rejeita REFRESH_TOKEN_TTL_DAYS=%s", (days) => {
      expect(() => validarAmbiente({ ...dadosValidosDesenvolvimento, REFRESH_TOKEN_TTL_DAYS: days }))
        .toThrowError(/REFRESH_TOKEN_TTL_DAYS/);
    });

    it("rejeita issuer e audience maiores que 255 caracteres", () => {
      expect(() => validarAmbiente({ ...dadosValidosProducao, JWT_ISSUER: "i".repeat(256) }))
        .toThrowError(/JWT_ISSUER/);
      expect(() => validarAmbiente({ ...dadosValidosProducao, JWT_AUDIENCE: "a".repeat(256) }))
        .toThrowError(/JWT_AUDIENCE/);
    });
  });
});
