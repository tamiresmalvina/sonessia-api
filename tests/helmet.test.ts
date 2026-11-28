import express from "express";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { criarMiddlewareCabecalhosSeguranca } from "../src/middlewares/cabecalhos-seguranca.middleware.js";

function criarAppComHelmet(producao: boolean) {
  const appTeste = express();
  appTeste.use(criarMiddlewareCabecalhosSeguranca(producao));
  appTeste.get("/", (_req, res) => res.json({ ok: true }));
  return appTeste;
}

describe("cabeçalhos HTTP de segurança", () => {
  it("aplica os cabeçalhos Helmet às respostas da API e remove X-Powered-By", async () => {
    const resposta = await request(app).get("/status");

    expect(resposta.status).toBe(200);
    expect(resposta.headers["x-content-type-options"]).toBe("nosniff");
    expect(resposta.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(resposta.headers["referrer-policy"]).toBe("no-referrer");
    expect(resposta.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(resposta.headers["x-powered-by"]).toBeUndefined();
    expect(resposta.headers["content-security-policy"]).toBeUndefined();
    expect(resposta.headers["cross-origin-resource-policy"]).toBeUndefined();
  });

  it("não envia HSTS em desenvolvimento/testes", async () => {
    const resposta = await request(criarAppComHelmet(false)).get("/");

    expect(resposta.headers["strict-transport-security"]).toBeUndefined();
  });

  it("envia HSTS em produção sem incluir subdomínios ou preload", async () => {
    const resposta = await request(criarAppComHelmet(true)).get("/");

    expect(resposta.headers["strict-transport-security"]).toBe(
      "max-age=15552000"
    );
    expect(resposta.headers["strict-transport-security"]).not.toContain("includeSubDomains");
    expect(resposta.headers["strict-transport-security"]).not.toContain("preload");
  });

  it("não amplia CORS para origens não configuradas", async () => {
    const resposta = await request(app)
      .get("/status")
      .set("Origin", "https://origem-nao-configurada.teste");

    expect(resposta.status).toBe(200);
    expect(resposta.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
