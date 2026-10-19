import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

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
});
