import { describe, it, expect, afterEach, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { ambiente } from "../src/config/ambiente.js";
import { gerarHashSenha } from "../src/utils/senha.util.js";
import {
  gerarRefreshToken,
  gerarHashToken,
  calcularExpiracaoSessao,
} from "../src/utils/token.util.js";
import { verificarTokenAcesso } from "../src/utils/jwt.util.js";
import { StatusSessao } from "../generated/prisma/enums.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Fluxo de Renovação de Sessão — POST /autenticacao/renovar-sessao", () => {
  const prefixoTeste = "test_renov_";

  beforeAll(async () => {
    await garantirBancoTestesIsolado();
  });

  afterEach(async () => {
    // Remove apenas usuários criados durante estes testes (e suas sessões em cascata)
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: prefixoTeste } },
    });
  });

  async function criarUsuarioComSessao(opcoes: {
    email: string;
    emailVerificado?: boolean;
    statusSessao?: StatusSessao;
    expirada?: boolean;
  }) {
    const senhaHash = await gerarHashSenha("SenhaForte@123456");

    const usuario = await prisma.usuario.create({
      data: {
        nome: "Usuário Teste Renovação",
        email: opcoes.email.toLowerCase().trim(),
        senha: senhaHash,
        dataNascimento: new Date("1995-01-01"),
        emailVerificado: opcoes.emailVerificado ?? true,
      },
    });

    const refreshTokenPlano = gerarRefreshToken();
    const tokenHash = gerarHashToken(refreshTokenPlano);
    const expiraEm = opcoes.expirada
      ? new Date(Date.now() - 1000 * 60) // 1 minuto atrás (expirada)
      : calcularExpiracaoSessao();

    const sessao = await prisma.sessao.create({
      data: {
        idUsuario: usuario.id,
        tokenHash,
        status: opcoes.statusSessao ?? StatusSessao.ATIVA,
        expiraEm,
      },
    });

    return {
      usuario,
      sessao,
      refreshTokenPlano,
    };
  }

  it("renovação válida rotaciona o refresh token, emite novo JWT e atualiza o cookie protegido", async () => {
    const email = `${prefixoTeste}sucesso_${Date.now()}@teste.com`;
    const { usuario, sessao, refreshTokenPlano } = await criarUsuarioComSessao({ email });

    const resposta = await request(app)
      .post("/autenticacao/renovar-sessao")
      .set("Cookie", [`refreshToken=${refreshTokenPlano}`]);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toHaveProperty("mensagem", "Sessão renovada com sucesso.");
    expect(resposta.body).toHaveProperty("tokenAcesso");
    expect(typeof resposta.body.tokenAcesso).toBe("string");

    // Valida dados públicos do usuário
    expect(resposta.body.usuario).toEqual({
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: "COMUM",
    });

    // Garante que o corpo JSON NUNCA expõe o refresh token ou hashes
    expect(resposta.body).not.toHaveProperty("refreshToken");
    expect(resposta.body.usuario).not.toHaveProperty("senha");
    expect(resposta.body.usuario).not.toHaveProperty("tokenHash");

    // Valida novo JWT emitido
    const payloadValidado = verificarTokenAcesso(resposta.body.tokenAcesso);
    expect(payloadValidado.sub).toBe(usuario.id);

    // Valida o novo cookie Set-Cookie
    const cookiesResposta = resposta.headers["set-cookie"];
    expect(cookiesResposta).toBeDefined();
    const listaCookies = Array.isArray(cookiesResposta)
      ? cookiesResposta
      : typeof cookiesResposta === "string"
      ? [cookiesResposta]
      : [];
    const cookieRefresh = listaCookies.find((c: string) => c.startsWith("refreshToken="));
    expect(cookieRefresh).toBeDefined();
    expect(cookieRefresh).toContain("HttpOnly");
    expect(cookieRefresh).toContain("Path=/autenticacao");
    expect(cookieRefresh).toContain("SameSite=Lax");

    const novoRefreshToken = cookieRefresh!.split(";")[0]!.replace("refreshToken=", "");
    expect(novoRefreshToken).not.toBe(refreshTokenPlano);
    expect(novoRefreshToken).toHaveLength(64);

    // Valida no banco de dados a rotação atômica
    const sessaoAntigaAtualizada = await prisma.sessao.findUnique({
      where: { id: sessao.id },
    });
    expect(sessaoAntigaAtualizada?.status).toBe(StatusSessao.ROTACIONADA);
    expect(sessaoAntigaAtualizada?.substituidaPor).toBeDefined();

    const novaSessaoCriada = await prisma.sessao.findUnique({
      where: { id: sessaoAntigaAtualizada!.substituidaPor! },
    });
    expect(novaSessaoCriada).not.toBeNull();
    expect(novaSessaoCriada?.status).toBe(StatusSessao.ATIVA);
    expect(novaSessaoCriada?.tokenHash).toBe(gerarHashToken(novoRefreshToken));
  });

  it("retorna HTTP 401 quando o cookie refreshToken está ausente", async () => {
    const resposta = await request(app).post("/autenticacao/renovar-sessao");

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("TOKEN_ATUALIZACAO_INVALIDO");
  });

  function obterListaCookies(resposta: request.Response): string[] {
    const cookies = resposta.headers["set-cookie"];
    if (Array.isArray(cookies)) return cookies;
    if (typeof cookies === "string") return [cookies];
    return [];
  }

  it("retorna HTTP 401 e limpa o cookie quando o formato do token é inválido", async () => {
    const resposta = await request(app)
      .post("/autenticacao/renovar-sessao")
      .set("Cookie", ["refreshToken=token_invalido_curto"]);

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("TOKEN_ATUALIZACAO_INVALIDO");

    const listaCookies = obterListaCookies(resposta);
    expect(listaCookies.length).toBeGreaterThan(0);
    // Confirma que a instrução de expiração do cookie foi emitida para limpeza
    const cookieLimpo = listaCookies.some(
      (c: string) => c.includes("refreshToken=;") || c.includes("Expires=Thu, 01 Jan 1970")
    );
    expect(cookieLimpo).toBe(true);
  });

  it("retorna HTTP 401 SESSAO_INVALIDA quando o token não existe no banco e limpa o cookie", async () => {
    const tokenInexistente = gerarRefreshToken();

    const resposta = await request(app)
      .post("/autenticacao/renovar-sessao")
      .set("Cookie", [`refreshToken=${tokenInexistente}`]);

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("SESSAO_INVALIDA");

    const listaCookies = obterListaCookies(resposta);
    expect(listaCookies.length).toBeGreaterThan(0);
    const cookieLimpo = listaCookies.some(
      (c: string) => c.includes("refreshToken=;") || c.includes("Expires=Thu, 01 Jan 1970")
    );
    expect(cookieLimpo).toBe(true);
  });

  it("sessão expirada retorna HTTP 401, é persistida como ENCERRADA no banco e limpa o cookie", async () => {
    const email = `${prefixoTeste}expirada_${Date.now()}@teste.com`;
    const { sessao, refreshTokenPlano } = await criarUsuarioComSessao({
      email,
      expirada: true,
    });

    const resposta = await request(app)
      .post("/autenticacao/renovar-sessao")
      .set("Cookie", [`refreshToken=${refreshTokenPlano}`]);

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("SESSAO_EXPIRADA");

    // Confirma que a transação fez commit da alteração para ENCERRADA
    const sessaoNoBanco = await prisma.sessao.findUnique({ where: { id: sessao.id } });
    expect(sessaoNoBanco?.status).toBe(StatusSessao.ENCERRADA);

    const cookiesResposta = resposta.headers["set-cookie"];
    expect(cookiesResposta).toBeDefined();
  });

  it("detecção de reutilização de token ROTACIONADO revoga atomicamente todas as sessões ativas do usuário no banco", async () => {
    const email = `${prefixoTeste}reuso_rot_${Date.now()}@teste.com`;
    const { usuario, sessao, refreshTokenPlano } = await criarUsuarioComSessao({ email });

    // 1ª renovação legítima: rotaciona a sessão original
    const primeiraRenovacao = await request(app)
      .post("/autenticacao/renovar-sessao")
      .set("Cookie", [`refreshToken=${refreshTokenPlano}`]);
    expect(primeiraRenovacao.status).toBe(200);

    // Cria também uma segunda sessão ativa paralela (ex.: outro dispositivo do usuário)
    const outroTokenPlano = gerarRefreshToken();
    const sessaoParalela = await prisma.sessao.create({
      data: {
        idUsuario: usuario.id,
        tokenHash: gerarHashToken(outroTokenPlano),
        status: StatusSessao.ATIVA,
        expiraEm: calcularExpiracaoSessao(),
      },
    });

    // 2ª requisição usando o token ANTIGO (já rotacionado) -> Detecção de Reutilização!
    const tentativaReutilizacao = await request(app)
      .post("/autenticacao/renovar-sessao")
      .set("Cookie", [`refreshToken=${refreshTokenPlano}`]);

    expect(tentativaReutilizacao.status).toBe(401);
    expect(tentativaReutilizacao.body.erro.codigo).toBe("REUTILIZACAO_DETECTADA");

    // Confirma que a transação foi commitada no banco e TODAS as sessões ativas do usuário foram revogadas
    const sessoesAtivasRestantes = await prisma.sessao.findMany({
      where: {
        idUsuario: usuario.id,
        status: StatusSessao.ATIVA,
      },
    });
    expect(sessoesAtivasRestantes).toHaveLength(0);

    const sessaoParalelaAtualizada = await prisma.sessao.findUnique({
      where: { id: sessaoParalela.id },
    });
    expect(sessaoParalelaAtualizada?.status).toBe(StatusSessao.REVOGADA);
  });

  it("detecção de reutilização de token REVOGADO revoga demais sessões ativas e rejeita com 401", async () => {
    const email = `${prefixoTeste}reuso_rev_${Date.now()}@teste.com`;
    const { usuario, refreshTokenPlano } = await criarUsuarioComSessao({
      email,
      statusSessao: StatusSessao.REVOGADA,
    });

    // Cria outra sessão ativa para este usuário
    const sessaoAtiva = await prisma.sessao.create({
      data: {
        idUsuario: usuario.id,
        tokenHash: gerarHashToken(gerarRefreshToken()),
        status: StatusSessao.ATIVA,
        expiraEm: calcularExpiracaoSessao(),
      },
    });

    const resposta = await request(app)
      .post("/autenticacao/renovar-sessao")
      .set("Cookie", [`refreshToken=${refreshTokenPlano}`]);

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("REUTILIZACAO_DETECTADA");

    // Confirma que a sessão ativa foi revogada no banco
    const sessaoAtivaAtualizada = await prisma.sessao.findUnique({
      where: { id: sessaoAtiva.id },
    });
    expect(sessaoAtivaAtualizada?.status).toBe(StatusSessao.REVOGADA);
  });

  it("bloqueia renovação com HTTP 403 EMAIL_NAO_VERIFICADO quando a conta não está mais elegível", async () => {
    const email = `${prefixoTeste}nao_verificado_${Date.now()}@teste.com`;
    const { refreshTokenPlano } = await criarUsuarioComSessao({
      email,
      emailVerificado: false,
    });

    const resposta = await request(app)
      .post("/autenticacao/renovar-sessao")
      .set("Cookie", [`refreshToken=${refreshTokenPlano}`]);

    expect(resposta.status).toBe(403);
    expect(resposta.body.erro.codigo).toBe("EMAIL_NAO_VERIFICADO");
  });

  it("duas renovações simultâneas concorrentes com o mesmo token são serializadas pelo lock FOR UPDATE", async () => {
    const email = `${prefixoTeste}concorrente_${Date.now()}@teste.com`;
    const { refreshTokenPlano } = await criarUsuarioComSessao({ email });

    // Dispara 2 requisições concorrentes simultâneas com o mesmo token de refresh
    const [respostaA, respostaB] = await Promise.all([
      request(app)
        .post("/autenticacao/renovar-sessao")
        .set("Cookie", [`refreshToken=${refreshTokenPlano}`]),
      request(app)
        .post("/autenticacao/renovar-sessao")
        .set("Cookie", [`refreshToken=${refreshTokenPlano}`]),
    ]);

    const statusList = [respostaA.status, respostaB.status].sort();

    // Exatamente uma requisição deve obter sucesso (200) e a outra deve ser rejeitada (401)
    expect(statusList).toEqual([200, 401]);

    const respostaErro = respostaA.status === 401 ? respostaA : respostaB;
    // Pela política de rotação atômica com serialização, a segunda requisição que tentou reusar o token já rotacionado
    // é detectada como reutilização
    expect(respostaErro.body.erro.codigo).toBe("REUTILIZACAO_DETECTADA");
  });

  it("rejeita requisições com cabeçalho Origin não autorizado quando FRONTEND_ORIGIN está configurado", async () => {
    const email = `${prefixoTeste}origin_${Date.now()}@teste.com`;
    const { refreshTokenPlano } = await criarUsuarioComSessao({ email });

    const origemOriginal = ambiente.FRONTEND_ORIGIN;
    (ambiente as any).FRONTEND_ORIGIN = "https://app.sonessia.com";

    try {
      const respostaOrigemInvalida = await request(app)
        .post("/autenticacao/renovar-sessao")
        .set("Origin", "https://site-malicioso.com")
        .set("Cookie", [`refreshToken=${refreshTokenPlano}`]);

      expect(respostaOrigemInvalida.status).toBe(403);
      expect(respostaOrigemInvalida.body.erro.codigo).toBe("ORIGEM_NAO_AUTORIZADA");

      // Com a origem autorizada correta, deve renovar com sucesso
      const respostaOrigemCorreta = await request(app)
        .post("/autenticacao/renovar-sessao")
        .set("Origin", "https://app.sonessia.com")
        .set("Cookie", [`refreshToken=${refreshTokenPlano}`]);

      expect(respostaOrigemCorreta.status).toBe(200);
    } finally {
      (ambiente as any).FRONTEND_ORIGIN = origemOriginal;
    }
  });

  it("rejeita ausência de Origin em ambiente de produção para a rota de renovação", async () => {
    const nodeEnvOriginal = ambiente.NODE_ENV;
    (ambiente as any).NODE_ENV = "production";

    try {
      const respostaSemOrigin = await request(app)
        .post("/autenticacao/renovar-sessao")
        .set("Cookie", [`refreshToken=${gerarRefreshToken()}`]);

      expect(respostaSemOrigin.status).toBe(403);
      expect(respostaSemOrigin.body.erro.codigo).toBe("ORIGEM_INVALIDA");
    } finally {
      (ambiente as any).NODE_ENV = nodeEnvOriginal;
    }
  });
});
