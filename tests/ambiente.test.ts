import { describe, it, expect } from "vitest";
import { validarAmbiente } from "../src/config/ambiente.js";

describe("Validação de Variáveis de Ambiente (src/config/ambiente.ts)", () => {
  const dadosValidosPadrao = {
    NODE_ENV: "development",
    PORT: "3000",
    DATABASE_URL: "postgresql://usuario:senha@localhost:5432/sonessia",
    JWT_ACCESS_SECRET: "chave-secreta-forte-para-testes-123456",
    JWT_ISSUER: "sonessia-api",
    JWT_AUDIENCE: "sonessia-web",
    ACCESS_TOKEN_TTL: "15m",
    REFRESH_TOKEN_TTL_DAYS: "7",
    EMAIL_PROVIDER: "ethereal",
  };

  it("deve validar com sucesso variáveis completas e aplicar defaults", () => {
    const config = validarAmbiente(dadosValidosPadrao);

    expect(config.NODE_ENV).toBe("development");
    expect(config.PORT).toBe(3000);
    expect(config.DATABASE_URL).toBe("postgresql://usuario:senha@localhost:5432/sonessia");
    expect(config.JWT_ISSUER).toBe("sonessia-api");
    expect(config.JWT_AUDIENCE).toBe("sonessia-web");
    expect(config.ACCESS_TOKEN_TTL).toBe("15m");
    expect(config.REFRESH_TOKEN_TTL_DAYS).toBe(7);
    expect(config.EMAIL_PROVIDER).toBe("ethereal");
  });

  it("deve aplicar default de porta 3000 quando PORT não for informada", () => {
    const semPorta = { ...dadosValidosPadrao };
    delete (semPorta as Record<string, unknown>).PORT;

    const config = validarAmbiente(semPorta);
    expect(config.PORT).toBe(3000);
  });

  it("deve lançar erro listando o nome do campo quando DATABASE_URL estiver ausente", () => {
    const semBanco = { ...dadosValidosPadrao };
    delete (semBanco as Record<string, unknown>).DATABASE_URL;

    expect(() => validarAmbiente(semBanco)).toThrowError(/DATABASE_URL/);
  });

  it("deve lançar erro listando o nome do campo quando JWT_ACCESS_SECRET estiver ausente", () => {
    const semJwt = { ...dadosValidosPadrao };
    delete (semJwt as Record<string, unknown>).JWT_ACCESS_SECRET;

    expect(() => validarAmbiente(semJwt)).toThrowError(/JWT_ACCESS_SECRET/);
  });

  it("não deve expor valores sensíveis na mensagem de erro lançada", () => {
    const comErro = {
      ...dadosValidosPadrao,
      PORT: "porta-invalida",
    };

    try {
      validarAmbiente(comErro);
      expect.fail("Deveria ter lançado erro de validação");
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      expect(mensagem).toContain("PORT");
      expect(mensagem).not.toContain("chave-secreta-forte");
      expect(mensagem).not.toContain("postgresql://");
    }
  });
});
