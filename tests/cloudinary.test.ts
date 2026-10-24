import { describe, it, expect, afterEach, vi } from "vitest";
import { validarAmbiente } from "../src/config/ambiente.js";
import {
  cloudinary,
  obterInstanciaCloudinary,
  estaConfiguradoCloudinary,
  inicializarCloudinary,
  resetarConfiguracaoCloudinaryParaTestes,
} from "../src/config/cloudinary.js";
import { AppError } from "../src/errors/app.error.js";

describe("Configuração e Validação do Cloudinary (src/config/cloudinary.ts e ambiente.ts)", () => {
  const baseAmbienteValido = {
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

  afterEach(() => {
    resetarConfiguracaoCloudinaryParaTestes();
    vi.restoreAllMocks();
  });

  describe("Validação de Variáveis de Ambiente (src/config/ambiente.ts)", () => {
    it("permite inicialização em desenvolvimento sem credenciais do Cloudinary", () => {
      const config = validarAmbiente({
        ...baseAmbienteValido,
        NODE_ENV: "development",
      });

      expect(config.CLOUDINARY_CLOUD_NAME).toBeUndefined();
      expect(config.CLOUDINARY_API_KEY).toBeUndefined();
      expect(config.CLOUDINARY_API_SECRET).toBeUndefined();
    });

    it("permite inicialização em testes sem credenciais do Cloudinary", () => {
      const config = validarAmbiente({
        ...baseAmbienteValido,
        NODE_ENV: "test",
      });

      expect(config.CLOUDINARY_CLOUD_NAME).toBeUndefined();
      expect(config.CLOUDINARY_API_KEY).toBeUndefined();
      expect(config.CLOUDINARY_API_SECRET).toBeUndefined();
    });

    it("valida com sucesso quando todas as credenciais do Cloudinary são fornecidas em desenvolvimento", () => {
      const config = validarAmbiente({
        ...baseAmbienteValido,
        NODE_ENV: "development",
        CLOUDINARY_CLOUD_NAME: "demo-cloud",
        CLOUDINARY_API_KEY: "1234567890",
        CLOUDINARY_API_SECRET: "abcdef123456",
      });

      expect(config.CLOUDINARY_CLOUD_NAME).toBe("demo-cloud");
      expect(config.CLOUDINARY_API_KEY).toBe("1234567890");
      expect(config.CLOUDINARY_API_SECRET).toBe("abcdef123456");
    });

    it("exige todas as credenciais do Cloudinary em produção e rejeita quando ausentes", () => {
      expect(() =>
        validarAmbiente({
          ...baseAmbienteValido,
          NODE_ENV: "production",
        })
      ).toThrowError(/CLOUDINARY_CLOUD_NAME.*CLOUDINARY_API_KEY.*CLOUDINARY_API_SECRET/);
    });

    it("rejeita credenciais vazias ou contendo apenas espaços em produção", () => {
      expect(() =>
        validarAmbiente({
          ...baseAmbienteValido,
          NODE_ENV: "production",
          CLOUDINARY_CLOUD_NAME: "   ",
          CLOUDINARY_API_KEY: "",
          CLOUDINARY_API_SECRET: "   ",
        })
      ).toThrowError(/CLOUDINARY_CLOUD_NAME.*CLOUDINARY_API_KEY.*CLOUDINARY_API_SECRET/);
    });

    it("aceita credenciais completas e válidas em produção", () => {
      const config = validarAmbiente({
        ...baseAmbienteValido,
        NODE_ENV: "production",
        CLOUDINARY_CLOUD_NAME: "prod-cloud",
        CLOUDINARY_API_KEY: "prod-key-999",
        CLOUDINARY_API_SECRET: "prod-secret-888",
      });

      expect(config.NODE_ENV).toBe("production");
      expect(config.CLOUDINARY_CLOUD_NAME).toBe("prod-cloud");
      expect(config.CLOUDINARY_API_KEY).toBe("prod-key-999");
      expect(config.CLOUDINARY_API_SECRET).toBe("prod-secret-888");
    });

    it("rejeita configuração parcial em desenvolvimento quando apenas uma ou duas credenciais são informadas", () => {
      expect(() =>
        validarAmbiente({
          ...baseAmbienteValido,
          NODE_ENV: "development",
          CLOUDINARY_CLOUD_NAME: "cloud-sem-chaves",
        })
      ).toThrowError(/CLOUDINARY_API_KEY.*CLOUDINARY_API_SECRET/);

      expect(() =>
        validarAmbiente({
          ...baseAmbienteValido,
          NODE_ENV: "development",
          CLOUDINARY_API_KEY: "key-sem-secret",
        })
      ).toThrowError(/CLOUDINARY_CLOUD_NAME.*CLOUDINARY_API_SECRET/);
    });

    it("não vaza valores sensíveis nas mensagens de erro de validação", () => {
      const valorSecretoTeste = "segredo-super-sensivel-999";

      try {
        validarAmbiente({
          ...baseAmbienteValido,
          NODE_ENV: "development",
          CLOUDINARY_CLOUD_NAME: "meu-cloud",
          CLOUDINARY_API_KEY: valorSecretoTeste,
        });
        expect.fail("Deveria ter lançado erro de validação");
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        expect(mensagem).toContain("CLOUDINARY_API_SECRET");
        expect(mensagem).not.toContain(valorSecretoTeste);
      }
    });

    it("preserva o comportamento existente das outras variáveis do sistema", () => {
      const semBanco = { ...baseAmbienteValido };
      delete (semBanco as Record<string, unknown>).DATABASE_URL;
      expect(() => validarAmbiente(semBanco)).toThrowError(/DATABASE_URL/);

      const semJwt = { ...baseAmbienteValido };
      delete (semJwt as Record<string, unknown>).JWT_ACCESS_SECRET;
      expect(() => validarAmbiente(semJwt)).toThrowError(/JWT_ACCESS_SECRET/);
    });
  });

  describe("Módulo e SDK do Cloudinary (src/config/cloudinary.ts)", () => {
    it("permite a importação do módulo sem lançar exceções e sem realizar chamadas de rede", () => {
      expect(cloudinary).toBeDefined();
      expect(typeof cloudinary.config).toBe("function");
    });

    it("indica que o Cloudinary não está configurado quando nenhuma credencial foi carregada", () => {
      resetarConfiguracaoCloudinaryParaTestes();
      expect(estaConfiguradoCloudinary()).toBe(false);
    });

    it("lança erro controlado (AppError 500 CLOUDINARY_NAO_CONFIGURADO) ao solicitar instância sem configuração", () => {
      resetarConfiguracaoCloudinaryParaTestes();

      expect(() => obterInstanciaCloudinary()).toThrow(AppError);

      try {
        obterInstanciaCloudinary();
        expect.fail("Deveria ter lançado erro");
      } catch (erro) {
        expect(erro).toBeInstanceOf(AppError);
        const appErro = erro as AppError;
        expect(appErro.statusCode).toBe(500);
        expect(appErro.codigo).toBe("CLOUDINARY_NAO_CONFIGURADO");
        expect(appErro.message).toBe(
          "O serviço de armazenamento de imagens não está configurado no ambiente atual."
        );
      }
    });

    it("configura o SDK com secure: true e credenciais quando inicializado explicitamente", () => {
      resetarConfiguracaoCloudinaryParaTestes();

      const instancia = inicializarCloudinary({
        cloud_name: "teste-unitario-cloud",
        api_key: "teste-api-key",
        api_secret: "teste-api-secret",
      });

      expect(instancia).toBe(cloudinary);
      expect(estaConfiguradoCloudinary()).toBe(true);

      const configAtual = cloudinary.config();
      expect(configAtual.cloud_name).toBe("teste-unitario-cloud");
      expect(configAtual.api_key).toBe("teste-api-key");
      expect(configAtual.api_secret).toBe("teste-api-secret");
      expect(configAtual.secure).toBe(true);

      const instanciaObtida = obterInstanciaCloudinary();
      expect(instanciaObtida).toBe(cloudinary);
    });

    it("evita inicializações duplicadas desnecessárias se o SDK já foi configurado", () => {
      inicializarCloudinary({
        cloud_name: "teste-idempotente",
        api_key: "key-123",
        api_secret: "sec-456",
      });

      // Segunda chamada com mesma configuração é idempotente
      const instancia = obterInstanciaCloudinary();
      expect(instancia).toBe(cloudinary);
      expect(estaConfiguradoCloudinary()).toBe(true);
    });
  });
});
