import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import type { Request, Response } from "express";
import { app } from "../src/app.js";
import { tratadorDeErros, type FormatoErroResposta } from "../src/middlewares/erro.middleware.js";
import { ambiente } from "../src/config/ambiente.js";

describe("Inicialização e Rotas Base da Aplicação (src/app.ts)", () => {
  it("deve responder 200 OK na rota GET /status com { status: 'ok' }", async () => {
    const resposta = await request(app).get("/status");

    expect(resposta.status).toBe(200);
    expect(resposta.headers["content-type"]).toMatch(/application\/json/);
    expect(resposta.body).toEqual({ status: "ok" });
  });

  it("deve responder 404 com o formato padronizado de erro para rotas inexistentes", async () => {
    const resposta = await request(app).get("/rota-inexistente-para-teste");

    expect(resposta.status).toBe(404);
    expect(resposta.body).toHaveProperty("erro");
    expect(resposta.body.erro).toEqual({
      codigo: "ROTA_NAO_ENCONTRADA",
      mensagem: "A rota solicitada não foi encontrada.",
      detalhes: [],
    });
  });

  it("deve permitir requisições sem o cabeçalho Origin (ferramentas como Insomnia / curl)", async () => {
    const resposta = await request(app).get("/status");

    expect(resposta.status).toBe(200);
  });

  it("não deve conceder Access-Control-Allow-Origin para origens não configuradas", async () => {
    const resposta = await request(app)
      .get("/status")
      .set("Origin", "http://origem-estranha-nao-autorizada.com");

    expect(resposta.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("não registra mensagem bruta de erro inesperado em produção", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ambienteOriginal = ambiente.NODE_ENV;
    try {
      (ambiente as { NODE_ENV: string }).NODE_ENV = "production";

      const req = {} as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as unknown as Response<FormatoErroResposta>;
      const next = vi.fn();

      const erroSensivel = new Error("DB Connection string com postgres://usuario:senha_secreta@host");
      tratadorDeErros(erroSensivel, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        erro: {
          codigo: "ERRO_INTERNO",
          mensagem: "Ocorreu um erro interno no servidor.",
          detalhes: [],
        },
      });

      expect(consoleErrorSpy).toHaveBeenCalled();
      const chamadaLog = consoleErrorSpy.mock.calls.flat().join(" ");
      expect(chamadaLog).not.toContain("senha_secreta");
      expect(chamadaLog).not.toContain("DB Connection string");
      expect(chamadaLog).toContain("[ERRO_INTERNO_INESPERADO]");
    } finally {
      (ambiente as { NODE_ENV: string }).NODE_ENV = ambienteOriginal;
      consoleErrorSpy.mockRestore();
    }
  });
});
