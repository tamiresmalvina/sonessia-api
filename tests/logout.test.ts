import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { ambiente } from "../src/config/ambiente.js";
import { gerarHashSenha } from "../src/utils/senha.util.js";
import {
  gerarRefreshToken,
  gerarHashToken,
  calcularExpiracaoSessao,
} from "../src/utils/token.util.js";
import { emitirTokenAcesso } from "../src/utils/jwt.util.js";
import { StatusSessao } from "../generated/prisma/enums.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Fluxo de Logout — POST /autenticacao/logout", () => {
  const prefixoTeste = "test_logout_";

  beforeAll(async () => {
    await garantirBancoTestesIsolado();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // Remove apenas os usuários criados para estes testes (e suas sessões em cascata)
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: prefixoTeste } },
    });
  });

  async function criarUsuarioComSessao(opcoes?: { email?: string }) {
    const email =
      opcoes?.email ??
      `${prefixoTeste}${Date.now()}_${Math.random().toString(36).substring(2, 8)}@teste.com`;
    const senhaHash = await gerarHashSenha("SenhaValida@123");

    const usuario = await prisma.usuario.create({
      data: {
        nome: "Usuário Teste Logout",
        email: email.toLowerCase().trim(),
        senha: senhaHash,
        dataNascimento: new Date("1993-08-10"),
        emailVerificado: true,
      },
    });

    const refreshTokenPlano = gerarRefreshToken();
    const tokenHash = gerarHashToken(refreshTokenPlano);

    const sessao = await prisma.sessao.create({
      data: {
        idUsuario: usuario.id,
        tokenHash,
        status: StatusSessao.ATIVA,
        expiraEm: calcularExpiracaoSessao(),
      },
    });

    return {
      usuario,
      sessao,
      refreshTokenPlano,
    };
  }

  function obterListaCookies(resposta: request.Response): string[] {
    const cookies = resposta.headers["set-cookie"];
    if (Array.isArray(cookies)) return cookies;
    if (typeof cookies === "string") return [cookies];
    return [];
  }

  it("logout de sessão válida encerra a sessão no banco e limpa o cookie", async () => {
    const { sessao, refreshTokenPlano } = await criarUsuarioComSessao();

    const resposta = await request(app)
      .post("/autenticacao/logout")
      .set("Cookie", [`refreshToken=${refreshTokenPlano}`]);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      mensagem: "Logout realizado com sucesso.",
    });

    // Confirma que a instrução de limpeza de cookie foi emitida
    const listaCookies = obterListaCookies(resposta);
    expect(listaCookies.length).toBeGreaterThan(0);
    const cookieLimpo = listaCookies.some(
      (c) => c.includes("refreshToken=;") || c.includes("Expires=Thu, 01 Jan 1970")
    );
    expect(cookieLimpo).toBe(true);

    // Confirma que a sessão foi atualizada para ENCERRADA no banco
    const sessaoAtualizada = await prisma.sessao.findUnique({
      where: { id: sessao.id },
    });
    expect(sessaoAtualizada?.status).toBe(StatusSessao.ENCERRADA);
  });

  it("isolamento de sessões: encerrar a sessão de um dispositivo não encerra as sessões dos demais", async () => {
    const { usuario, sessao: sessaoDispositivoA, refreshTokenPlano: tokenA } = await criarUsuarioComSessao();

    // Cria uma segunda sessão ativa para o mesmo usuário (ex.: Dispositivo B)
    const tokenB = gerarRefreshToken();
    const sessaoDispositivoB = await prisma.sessao.create({
      data: {
        idUsuario: usuario.id,
        tokenHash: gerarHashToken(tokenB),
        status: StatusSessao.ATIVA,
        expiraEm: calcularExpiracaoSessao(),
      },
    });

    // Logout realizado a partir do Dispositivo A
    const resposta = await request(app)
      .post("/autenticacao/logout")
      .set("Cookie", [`refreshToken=${tokenA}`]);

    expect(resposta.status).toBe(200);

    // Sessão do Dispositivo A deve estar encerrada
    const sessaoAAtualizada = await prisma.sessao.findUnique({
      where: { id: sessaoDispositivoA.id },
    });
    expect(sessaoAAtualizada?.status).toBe(StatusSessao.ENCERRADA);

    // Sessão do Dispositivo B DEVE continuar ATIVA
    const sessaoBAtualizada = await prisma.sessao.findUnique({
      where: { id: sessaoDispositivoB.id },
    });
    expect(sessaoBAtualizada?.status).toBe(StatusSessao.ATIVA);
  });

  it("comportamento idempotente: repetir logout de sessão já encerrada responde com sucesso e limpa cookie", async () => {
    const { sessao, refreshTokenPlano } = await criarUsuarioComSessao();

    // 1º logout
    await request(app)
      .post("/autenticacao/logout")
      .set("Cookie", [`refreshToken=${refreshTokenPlano}`]);

    // 2º logout repetido com o mesmo cookie
    const respostaRepetida = await request(app)
      .post("/autenticacao/logout")
      .set("Cookie", [`refreshToken=${refreshTokenPlano}`]);

    expect(respostaRepetida.status).toBe(200);
    expect(respostaRepetida.body).toEqual({
      mensagem: "Logout realizado com sucesso.",
    });

    const sessaoNoBanco = await prisma.sessao.findUnique({
      where: { id: sessao.id },
    });
    expect(sessaoNoBanco?.status).toBe(StatusSessao.ENCERRADA);
  });

  it("comportamento idempotente: logout sem cookie ou com cookie malformado retorna HTTP 200 e limpa o cookie", async () => {
    // Sem cookie
    const respostaSemCookie = await request(app).post("/autenticacao/logout");
    expect(respostaSemCookie.status).toBe(200);
    expect(respostaSemCookie.body.mensagem).toBe("Logout realizado com sucesso.");

    // Cookie malformado
    const respostaCookieInvalido = await request(app)
      .post("/autenticacao/logout")
      .set("Cookie", ["refreshToken=valor_invalido_curto"]);
    expect(respostaCookieInvalido.status).toBe(200);
    expect(respostaCookieInvalido.body.mensagem).toBe("Logout realizado com sucesso.");
  });

  it("validação cruzada: rejeita com HTTP 403 quando o Bearer token identifica um usuário diferente do dono da sessão", async () => {
    const { usuario: usuarioA, sessao: sessaoA, refreshTokenPlano: tokenSessaoA } = await criarUsuarioComSessao();
    const { usuario: usuarioB } = await criarUsuarioComSessao();

    // Usuário B envia seu Bearer token, mas com o cookie de refresh do Usuário A
    const tokenAcessoB = emitirTokenAcesso({
      sub: usuarioB.id,
      versaoToken: usuarioB.versaoToken,
    });

    const resposta = await request(app)
      .post("/autenticacao/logout")
      .set("Authorization", `Bearer ${tokenAcessoB}`)
      .set("Cookie", [`refreshToken=${tokenSessaoA}`]);

    expect(resposta.status).toBe(403);
    expect(resposta.body.erro.codigo).toBe("OPERACAO_NAO_PERMITIDA");

    // A sessão do Usuário A NÃO pode ter sido encerrada
    const sessaoAAtualizada = await prisma.sessao.findUnique({
      where: { id: sessaoA.id },
    });
    expect(sessaoAAtualizada?.status).toBe(StatusSessao.ATIVA);
  });

  it("validação cruzada: rejeita com HTTP 401 TOKEN_INVALIDO quando o Bearer token fornecido é forjado", async () => {
    const { sessao, refreshTokenPlano } = await criarUsuarioComSessao();

    const resposta = await request(app)
      .post("/autenticacao/logout")
      .set("Authorization", "Bearer token_falsificado_invalido")
      .set("Cookie", [`refreshToken=${refreshTokenPlano}`]);

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("TOKEN_INVALIDO");

    // A sessão NÃO é encerrada
    const sessaoNoBanco = await prisma.sessao.findUnique({ where: { id: sessao.id } });
    expect(sessaoNoBanco?.status).toBe(StatusSessao.ATIVA);
  });

  it("validação cruzada: permite logout quando o Bearer token está expirado, mas o refresh token é válido e compatível", async () => {
    const { usuario, sessao, refreshTokenPlano } = await criarUsuarioComSessao();

    // Emite token expirado para o mesmo usuário
    const tokenExpirado = jwt.sign(
      { sub: usuario.id },
      ambiente.JWT_ACCESS_SECRET,
      {
        algorithm: "HS256",
        issuer: ambiente.JWT_ISSUER,
        audience: ambiente.JWT_AUDIENCE,
        expiresIn: -3600,
      }
    );

    const resposta = await request(app)
      .post("/autenticacao/logout")
      .set("Authorization", `Bearer ${tokenExpirado}`)
      .set("Cookie", [`refreshToken=${refreshTokenPlano}`]);

    expect(resposta.status).toBe(200);
    expect(resposta.body.mensagem).toBe("Logout realizado com sucesso.");

    const sessaoAtualizada = await prisma.sessao.findUnique({ where: { id: sessao.id } });
    expect(sessaoAtualizada?.status).toBe(StatusSessao.ENCERRADA);
  });

  it("falha de persistência: retorna HTTP 500 e não declara sucesso falso se o banco falhar na atualização", async () => {
    const { refreshTokenPlano } = await criarUsuarioComSessao();

    // Simula erro inesperado no banco durante o update da sessão
    vi.spyOn(prisma.sessao, "update").mockRejectedValueOnce(
      new Error("Falha de conexão com o banco de dados")
    );

    const resposta = await request(app)
      .post("/autenticacao/logout")
      .set("Cookie", [`refreshToken=${refreshTokenPlano}`]);

    expect(resposta.status).toBe(500);
    expect(resposta.body.erro.codigo).toBe("ERRO_INTERNO");
  });

  it("rejeita requisições com cabeçalho Origin não autorizado quando FRONTEND_ORIGIN está configurado", async () => {
    const { refreshTokenPlano } = await criarUsuarioComSessao();

    const origemOriginal = ambiente.FRONTEND_ORIGIN;
    (ambiente as any).FRONTEND_ORIGIN = "https://app.sonessia.com";

    try {
      const respostaOrigemInvalida = await request(app)
        .post("/autenticacao/logout")
        .set("Origin", "https://site-malicioso.com")
        .set("Cookie", [`refreshToken=${refreshTokenPlano}`]);

      expect(respostaOrigemInvalida.status).toBe(403);
      expect(respostaOrigemInvalida.body.erro.codigo).toBe("ORIGEM_NAO_AUTORIZADA");

      // Com origem correta, passa normalmente
      const respostaOrigemCorreta = await request(app)
        .post("/autenticacao/logout")
        .set("Origin", "https://app.sonessia.com")
        .set("Cookie", [`refreshToken=${refreshTokenPlano}`]);

      expect(respostaOrigemCorreta.status).toBe(200);
    } finally {
      (ambiente as any).FRONTEND_ORIGIN = origemOriginal;
    }
  });

  it("rejeita ausência de Origin em ambiente de produção para a rota de logout", async () => {
    const nodeEnvOriginal = ambiente.NODE_ENV;
    (ambiente as any).NODE_ENV = "production";

    try {
      const respostaSemOrigin = await request(app)
        .post("/autenticacao/logout")
        .set("Cookie", [`refreshToken=${gerarRefreshToken()}`]);

      expect(respostaSemOrigin.status).toBe(403);
      expect(respostaSemOrigin.body.erro.codigo).toBe("ORIGEM_INVALIDA");
    } finally {
      (ambiente as any).NODE_ENV = nodeEnvOriginal;
    }
  });
});
