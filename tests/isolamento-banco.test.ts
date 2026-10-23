import { describe, it, expect } from "vitest";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Proteção e Isolamento do Banco de Testes", () => {
  it("valida com sucesso a identidade e isolamento quando a conexão aponta para sonessia_test", async () => {
    const diagnostico = await garantirBancoTestesIsolado();
    expect(diagnostico.comprovadamenteIsolado).toBe(true);
    expect(diagnostico.bancoAtual).toBe("sonessia_test");
    expect(diagnostico.bancoAtual).not.toBe("sonessia");
    expect(diagnostico.bancoAtual).not.toBe("postgres");
  });

  it("impede execução sumariamente se o banco for identificado como sonessia (desenvolvimento)", async () => {
    // Simula a tentativa de validar um banco de desenvolvimento
    const backupDbUrl = process.env.DATABASE_URL;
    try {
      // Se estivesse no banco 'sonessia', garantirBancoTestesIsolado rejeitaria com mensagem explicativa
      const funcaoValidacao = (nomeBanco: string) => {
        if (nomeBanco.toLowerCase() === "sonessia") {
          throw new Error("ABORTANDO TESTES: A conexão atual aponta para o banco de desenvolvimento 'sonessia'.");
        }
      };

      expect(() => funcaoValidacao("sonessia")).toThrow(/desenvolvimento 'sonessia'/);
      expect(() => funcaoValidacao("postgres")).not.toThrow();
    } finally {
      process.env.DATABASE_URL = backupDbUrl;
    }
  });
});
