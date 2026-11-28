import express, { type Request } from "express";
import rateLimit from "express-rate-limit";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { ambiente, validarAmbiente } from "../src/config/ambiente.js";
import { chaveRateLimitPorIp } from "../src/middlewares/rate-limit.middleware.js";
import { obterIpCliente } from "../src/utils/ip-cliente.util.js";

function requisicao(headers: Record<string, string>, remoteAddress = "192.0.2.10"): Request {
  return {
    get: (nome: string) => headers[nome.toLowerCase()],
    socket: { remoteAddress },
  } as unknown as Request;
}

function criarAppComLimiteDeUmaRequisicao() {
  const appTeste = express();
  appTeste.set("trust proxy", false);
  appTeste.use(rateLimit({
    windowMs: 60_000,
    limit: 1,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: chaveRateLimitPorIp,
    handler: (_req, res) => res.status(429).json({ erro: { codigo: "MUITAS_REQUISICOES" } }),
  }));
  appTeste.get("/", (_req, res) => res.status(200).json({ ok: true }));
  return appTeste;
}

describe("Trust proxy e identificação do IP", () => {
  const modoOriginal = ambiente.TRUST_PROXY_MODE;

  afterEach(() => {
    (ambiente as Record<string, unknown>).TRUST_PROXY_MODE = modoOriginal;
  });

  it("mantém Express trust proxy desabilitado explicitamente", () => {
    expect(app.get("trust proxy")).toBe(false);
  });

  it("usa o socket local e ignora X-Forwarded-For e CF-Connecting-IP no modo direct", () => {
    (ambiente as Record<string, unknown>).TRUST_PROXY_MODE = "direct";
    const req = requisicao({
      "x-forwarded-for": "198.51.100.80",
      "cf-connecting-ip": "198.51.100.81",
    });
    expect(obterIpCliente(req)).toBe("192.0.2.10");
  });

  it("no modo Render usa somente CF-Connecting-IP válido e não X-Forwarded-For", () => {
    (ambiente as Record<string, unknown>).TRUST_PROXY_MODE = "render";
    const req = requisicao({
      "x-forwarded-for": "203.0.113.99",
      "cf-connecting-ip": "198.51.100.12",
    });
    expect(obterIpCliente(req)).toBe("198.51.100.12");
    expect(chaveRateLimitPorIp(req)).toBe("198.51.100.12");
  });

  it("rejeita CF-Connecting-IP inválido ou em cadeia e usa o socket como fallback", () => {
    (ambiente as Record<string, unknown>).TRUST_PROXY_MODE = "render";
    expect(obterIpCliente(requisicao({ "cf-connecting-ip": "198.51.100.1, 198.51.100.2" })))
      .toBe("192.0.2.10");
    expect(obterIpCliente(requisicao({ "cf-connecting-ip": "not-an-ip" })))
      .toBe("192.0.2.10");
  });

  it("valida TRUST_PROXY_MODE e aceita somente direct ou render", () => {
    const base = {
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://localhost:5432/sonessia",
      JWT_ACCESS_SECRET: "segredo-local-de-teste",
      JWT_ISSUER: "sonessia-api",
      JWT_AUDIENCE: "sonessia-web",
    };
    expect(validarAmbiente({ ...base, TRUST_PROXY_MODE: "direct" }).TRUST_PROXY_MODE).toBe("direct");
    expect(validarAmbiente({ ...base, TRUST_PROXY_MODE: "render" }).TRUST_PROXY_MODE).toBe("render");
    expect(() => validarAmbiente({ ...base, TRUST_PROXY_MODE: "true" })).toThrowError(/TRUST_PROXY_MODE/);
  });

  it("no modo local, X-Forwarded-For falso não permite trocar a chave do rate limit", async () => {
    (ambiente as Record<string, unknown>).TRUST_PROXY_MODE = "direct";
    const appTeste = criarAppComLimiteDeUmaRequisicao();

    const primeira = await request(appTeste).get("/").set("X-Forwarded-For", "198.51.100.1");
    const segunda = await request(appTeste).get("/").set("X-Forwarded-For", "198.51.100.2");

    expect(primeira.status).toBe(200);
    expect(segunda.status).toBe(429);
  });

  it("no modo Render, X-Forwarded-For falso não permite trocar a chave baseada no IP da borda", async () => {
    (ambiente as Record<string, unknown>).TRUST_PROXY_MODE = "render";
    const appTeste = criarAppComLimiteDeUmaRequisicao();

    const primeira = await request(appTeste).get("/")
      .set("CF-Connecting-IP", "198.51.100.30")
      .set("X-Forwarded-For", "203.0.113.1");
    const segunda = await request(appTeste).get("/")
      .set("CF-Connecting-IP", "198.51.100.30")
      .set("X-Forwarded-For", "203.0.113.2");
    const outroCliente = await request(appTeste).get("/")
      .set("CF-Connecting-IP", "198.51.100.31")
      .set("X-Forwarded-For", "203.0.113.2");

    expect(primeira.status).toBe(200);
    expect(segunda.status).toBe(429);
    expect(segunda.body.erro.codigo).toBe("MUITAS_REQUISICOES");
    expect(segunda.headers["ratelimit-limit"]).toBe("1");
    expect(segunda.headers["x-ratelimit-limit"]).toBeUndefined();
    expect(outroCliente.status).toBe(200);
  });
});
