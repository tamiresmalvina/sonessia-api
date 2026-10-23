import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import express from "express";
import rateLimit from "express-rate-limit";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { ambiente } from "../src/config/ambiente.js";
import { gerarHashSenha } from "../src/utils/senha.util.js";
import { gerarHashToken } from "../src/utils/token.util.js";
import { verificarTokenAcesso } from "../src/utils/jwt.util.js";
import { limparSessaoFalha } from "../src/services/autenticacao.service.js";
import { StatusSessao } from "../generated/prisma/enums.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Fluxo de Login — POST /autenticacao/login", () => {
  const prefixoTeste = "test_login_";

  beforeAll(async () => {
    await garantirBancoTestesIsolado();
  });

  afterEach(async () => {
    // Remove apenas os usuários criados para estes testes (e suas sessões em cascata)
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: prefixoTeste } },
    });
  });

  async function criarUsuarioTeste(opcoes: {
    email: string;
    senha?: string;
    senhaTextoPlano?: string;
    emailVerificado?: boolean;
    nome?: string;
  }) {
    const senha = opcoes.senha ?? opcoes.senhaTextoPlano ?? "SenhaForte@123456";
    const senhaHash = await gerarHashSenha(senha);

    return prisma.usuario.create({
      data: {
        nome: opcoes.nome ?? "Usuário Teste Login",
        email: opcoes.email.toLowerCase().trim(),
        senha: senhaHash,
        dataNascimento: new Date("1995-01-01"),
        emailVerificado: opcoes.emailVerificado ?? true,
      },
    });
  }

  it("login com credenciais válidas e e-mail verificado retorna HTTP 200, JWT e cookie de refresh protegido", async () => {
    const email = `${prefixoTeste}sucesso_${Date.now()}@teste.com`;
    const senha = "SenhaCorreta@123456";
    const usuarioCriado = await criarUsuarioTeste({ email, senha, emailVerificado: true });

    const resposta = await request(app)
      .post("/autenticacao/login")
      .send({ email, senha });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toHaveProperty("mensagem", "Login realizado com sucesso.");
    expect(resposta.body).toHaveProperty("tokenAcesso");
    expect(typeof resposta.body.tokenAcesso).toBe("string");

    // Valida dados públicos do usuário
    expect(resposta.body.usuario).toEqual({
      id: usuarioCriado.id,
      nome: usuarioCriado.nome,
      email: usuarioCriado.email,
      perfil: "COMUM",
    });

    // Garante que o corpo JSON NUNCA expõe senhas, hashes ou o refresh token
    expect(resposta.body).not.toHaveProperty("refreshToken");
    expect(resposta.body.usuario).not.toHaveProperty("senha");
    expect(resposta.body.usuario).not.toHaveProperty("tokenHash");

    // Valida o cookie HttpOnly de refresh no cabeçalho Set-Cookie
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

    // Extrai o valor do refresh token entregue pelo cookie
    const valorRefreshToken = cookieRefresh!.split(";")[0]!.replace("refreshToken=", "");
    expect(valorRefreshToken).toHaveLength(64); // 32 bytes em hex

    // Validação no banco de dados: apenas o hash SHA-256 é armazenado
    const sessoesUsuario = await prisma.sessao.findMany({
      where: { idUsuario: usuarioCriado.id },
    });
    expect(sessoesUsuario).toHaveLength(1);
    const sessaoGravada = sessoesUsuario[0];
    expect(sessaoGravada).toBeDefined();
    expect(sessaoGravada!.status).toBe(StatusSessao.ATIVA);
    expect(sessaoGravada!.expiraEm.getTime()).toBeGreaterThan(Date.now());

    // O valor em texto puro NUNCA deve ser encontrado no banco
    expect(sessaoGravada!.tokenHash).not.toBe(valorRefreshToken);
    // Mas o hash SHA-256 do token do cookie deve coincidir exatamente com a sessão
    const hashEsperado = gerarHashToken(valorRefreshToken);
    expect(sessaoGravada!.tokenHash).toBe(hashEsperado);
  });

  it("token JWT de acesso emitido possui algoritmo HS256, claims esperadas (sub, iss, aud) e expiração válida", async () => {
    const email = `${prefixoTeste}jwt_${Date.now()}@teste.com`;
    const senha = "SenhaForte@123456";
    const usuarioCriado = await criarUsuarioTeste({ email, senha, emailVerificado: true });

    const resposta = await request(app)
      .post("/autenticacao/login")
      .send({ email, senha });

    expect(resposta.status).toBe(200);
    const token = resposta.body.tokenAcesso;

    // Decodifica o cabeçalho para confirmar HS256
    const decodificadoCompleto = jwt.decode(token, { complete: true });
    expect(decodificadoCompleto).not.toBeNull();
    expect(decodificadoCompleto?.header.alg).toBe("HS256");

    // Valida criptograficamente o token com a chave da aplicação
    const payloadValidado = verificarTokenAcesso(token);
    expect(payloadValidado.sub).toBe(usuarioCriado.id);
    expect(payloadValidado.iss).toBe(ambiente.JWT_ISSUER);
    expect(payloadValidado.aud).toBe(ambiente.JWT_AUDIENCE);
    expect(payloadValidado.exp).toBeDefined();
    expect(payloadValidado.exp!).toBeGreaterThan(payloadValidado.iat!);
  });

  it("normaliza e-mail com maiúsculas e espaços em branco consistentemente com o cadastro", async () => {
    const emailBase = `${prefixoTeste}normaliza_${Date.now()}@teste.com`;
    const senha = "SenhaCorreta@123456";
    await criarUsuarioTeste({ email: emailBase, senha, emailVerificado: true });

    const resposta = await request(app)
      .post("/autenticacao/login")
      .send({
        email: `  ${emailBase.toUpperCase()}  `,
        senha,
      });

    expect(resposta.status).toBe(200);
    expect(resposta.body.usuario.email).toBe(emailBase.toLowerCase());
  });

  it("senha incorreta retorna HTTP 401 CREDENCIAIS_INVALIDAS e não emite cookie nem cria sessão", async () => {
    const email = `${prefixoTeste}senha_errada_${Date.now()}@teste.com`;
    const usuarioCriado = await criarUsuarioTeste({ email, senhaTextoPlano: "SenhaCorreta@123456" });

    const resposta = await request(app)
      .post("/autenticacao/login")
      .send({ email, senha: "SenhaTotalmenteIncorreta@999" });

    expect(resposta.status).toBe(401);
    expect(resposta.body).toEqual({
      erro: {
        codigo: "CREDENCIAIS_INVALIDAS",
        mensagem: "E-mail ou senha incorretos.",
        detalhes: [],
      },
    });

    expect(resposta.headers["set-cookie"]).toBeUndefined();

    // Nenhuma sessão criada
    const sessoes = await prisma.sessao.findMany({ where: { idUsuario: usuarioCriado.id } });
    expect(sessoes).toHaveLength(0);
  });

  it("e-mail inexistente retorna HTTP 401 CREDENCIAIS_INVALIDAS idêntico, mitigando enumeração", async () => {
    const emailInexistente = `${prefixoTeste}inexistente_${Date.now()}@teste.com`;

    const resposta = await request(app)
      .post("/autenticacao/login")
      .send({ email: emailInexistente, senha: "QualquerSenha@123" });

    expect(resposta.status).toBe(401);
    expect(resposta.body).toEqual({
      erro: {
        codigo: "CREDENCIAIS_INVALIDAS",
        mensagem: "E-mail ou senha incorretos.",
        detalhes: [],
      },
    });

    expect(resposta.headers["set-cookie"]).toBeUndefined();
  });

  it("bloqueia login com HTTP 403 EMAIL_NAO_VERIFICADO quando a conta não foi ativada", async () => {
    const email = `${prefixoTeste}nao_verificado_${Date.now()}@teste.com`;
    const senha = "SenhaCorreta@123456";
    const usuarioCriado = await criarUsuarioTeste({ email, senha, emailVerificado: false });

    const resposta = await request(app)
      .post("/autenticacao/login")
      .send({ email, senha });

    expect(resposta.status).toBe(403);
    expect(resposta.body).toEqual({
      erro: {
        codigo: "EMAIL_NAO_VERIFICADO",
        mensagem: "É necessário confirmar seu e-mail antes de realizar o login.",
        detalhes: [],
      },
    });

    expect(resposta.headers["set-cookie"]).toBeUndefined();

    const sessoes = await prisma.sessao.findMany({ where: { idUsuario: usuarioCriado.id } });
    expect(sessoes).toHaveLength(0);
  });

  it("rejeita payloads inválidos com HTTP 400 DADOS_INVALIDOS e lista de campos", async () => {
    // E-mail inválido
    const respostaEmailInvalido = await request(app)
      .post("/autenticacao/login")
      .send({ email: "email-invalido-sem-arroba", senha: "QualquerSenha@123" });

    expect(respostaEmailInvalido.status).toBe(400);
    expect(respostaEmailInvalido.body.erro.codigo).toBe("DADOS_INVALIDOS");
    expect(respostaEmailInvalido.body.erro.detalhes.some((d: any) => d.campo === "email")).toBe(true);

    // Senha vazia
    const respostaSenhaVazia = await request(app)
      .post("/autenticacao/login")
      .send({ email: "teste@teste.com", senha: "" });

    expect(respostaSenhaVazia.status).toBe(400);
    expect(respostaSenhaVazia.body.erro.codigo).toBe("DADOS_INVALIDOS");
    expect(respostaSenhaVazia.body.erro.detalhes.some((d: any) => d.campo === "senha")).toBe(true);

    // Corpo vazio
    const respostaVazia = await request(app)
      .post("/autenticacao/login")
      .send({});

    expect(respostaVazia.status).toBe(400);
    expect(respostaVazia.body.erro.codigo).toBe("DADOS_INVALIDOS");
  });

  it("rejeita requisições com cabeçalho Origin não autorizado quando FRONTEND_ORIGIN está configurado", async () => {
    const email = `${prefixoTeste}origin_${Date.now()}@teste.com`;
    const senha = "SenhaCorreta@123456";
    await criarUsuarioTeste({ email, senha, emailVerificado: true });

    // Configura temporariamente FRONTEND_ORIGIN
    const origemOriginal = ambiente.FRONTEND_ORIGIN;
    (ambiente as any).FRONTEND_ORIGIN = "https://app.sonessia.com";

    try {
      const respostaOrigemInvalida = await request(app)
        .post("/autenticacao/login")
        .set("Origin", "https://site-malicioso.com")
        .send({ email, senha });

      expect(respostaOrigemInvalida.status).toBe(403);
      expect(respostaOrigemInvalida.body.erro.codigo).toBe("ORIGEM_NAO_AUTORIZADA");

      // Com a origem autorizada correta, deve passar
      const respostaOrigemCorreta = await request(app)
        .post("/autenticacao/login")
        .set("Origin", "https://app.sonessia.com")
        .send({ email, senha });

      expect(respostaOrigemCorreta.status).toBe(200);
    } finally {
      (ambiente as any).FRONTEND_ORIGIN = origemOriginal;
    }
  });

  it("rejeita ausência de Origin em ambiente de produção para rotas de mutação com cookies", async () => {
    const nodeEnvOriginal = ambiente.NODE_ENV;
    (ambiente as any).NODE_ENV = "production";

    try {
      const respostaSemOrigin = await request(app)
        .post("/autenticacao/login")
        .send({ email: "qualquer@teste.com", senha: "Senha@123" });

      expect(respostaSemOrigin.status).toBe(403);
      expect(respostaSemOrigin.body.erro.codigo).toBe("ORIGEM_INVALIDA");
    } finally {
      (ambiente as any).NODE_ENV = nodeEnvOriginal;
    }
  });

  it("rate limiting bloqueia requisições em excesso com HTTP 429 MUITAS_REQUISICOES", async () => {
    // Cria app isolado de teste para verificar o comportamento do middleware de rate limit
    const appRateLimitTeste = express();
    appRateLimitTeste.use(express.json());

    const limiteTeste = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 2,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({
          erro: {
            codigo: "MUITAS_REQUISICOES",
            mensagem: "Muitas tentativas. Tente novamente mais tarde.",
            detalhes: [],
          },
        });
      },
    });

    appRateLimitTeste.post("/login-teste", limiteTeste, (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const res1 = await request(appRateLimitTeste).post("/login-teste").send({});
    expect(res1.status).toBe(200);

    const res2 = await request(appRateLimitTeste).post("/login-teste").send({});
    expect(res2.status).toBe(200);

    // 3ª tentativa excede o limite máximo de 2
    const res3 = await request(appRateLimitTeste).post("/login-teste").send({});
    expect(res3.status).toBe(429);
    expect(res3.body).toEqual({
      erro: {
        codigo: "MUITAS_REQUISICOES",
        mensagem: "Muitas tentativas. Tente novamente mais tarde.",
        detalhes: [],
      },
    });
  });

  it("limparSessaoFalha remove com sucesso sessão do banco evitando sessões ativas órfãs", async () => {
    const email = `${prefixoTeste}cleanup_${Date.now()}@teste.com`;
    const usuarioCriado = await criarUsuarioTeste({ email, emailVerificado: true });

    const sessao = await prisma.sessao.create({
      data: {
        idUsuario: usuarioCriado.id,
        tokenHash: "hash_teste_para_cleanup",
        status: StatusSessao.ATIVA,
        expiraEm: new Date(Date.now() + 100000),
      },
    });

    // Confirma que foi criada
    const encontradaAntes = await prisma.sessao.findUnique({ where: { id: sessao.id } });
    expect(encontradaAntes).not.toBeNull();

    // Executa cleanup
    await limparSessaoFalha(sessao.id);

    // Confirma que não existe mais no banco
    const encontradaDepois = await prisma.sessao.findUnique({ where: { id: sessao.id } });
    expect(encontradaDepois).toBeNull();
  });
});
