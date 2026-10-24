import { describe, it, expect, afterEach, beforeAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { ambiente } from "../src/config/ambiente.js";
import { gerarHashSenha } from "../src/utils/senha.util.js";
import { emitirTokenAcesso } from "../src/utils/jwt.util.js";
import { Perfil } from "../generated/prisma/enums.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Middleware de Autenticação e Consulta de Usuário — GET /autenticacao/eu", () => {
  const prefixoTeste = "test_eu_";

  beforeAll(async () => {
    await garantirBancoTestesIsolado();
  });

  afterEach(async () => {
    // Remove apenas usuários criados durante estes testes
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: prefixoTeste } },
    });
  });

  async function criarUsuarioTeste(opcoes?: { email?: string; emailVerificado?: boolean; perfil?: Perfil }) {
    const email =
      opcoes?.email ??
      `${prefixoTeste}${Date.now()}_${Math.random().toString(36).substring(2, 8)}@teste.com`;
    const senhaHash = await gerarHashSenha("SenhaValida@123");

    return prisma.usuario.create({
      data: {
        nome: "Usuário Teste Consulta",
        email: email.toLowerCase().trim(),
        senha: senhaHash,
        dataNascimento: new Date("1994-06-20"),
        emailVerificado: opcoes?.emailVerificado ?? true,
        perfil: opcoes?.perfil ?? Perfil.COMUM,
      },
    });
  }

  it("retorna HTTP 200 e dados públicos do usuário quando o JWT de acesso é válido", async () => {
    const usuario = await criarUsuarioTeste();
    const token = emitirTokenAcesso({ sub: usuario.id, versaoToken: usuario.versaoToken });

    const resposta = await request(app)
      .get("/autenticacao/eu")
      .set("Authorization", `Bearer ${token}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        perfil: "COMUM",
        fotoPerfil: null,
      },
    });

    // Garante que campos sensíveis nunca são expostos
    expect(resposta.body.usuario).not.toHaveProperty("senha");
    expect(resposta.body.usuario).not.toHaveProperty("tokenHash");
    expect(resposta.body.usuario).not.toHaveProperty("codigoHash");
    expect(resposta.body).not.toHaveProperty("refreshToken");
  });

  it("expõe somente o caminho autenticado da foto, nunca o public_id interno", async () => {
    const usuario = await criarUsuarioTeste();
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { fotoPerfilPublicId: "sonessia/perfis/referencia-interna" },
    });
    const token = emitirTokenAcesso({
      sub: usuario.id,
      versaoToken: usuario.versaoToken,
    });

    const resposta = await request(app)
      .get("/autenticacao/eu")
      .set("Authorization", `Bearer ${token}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body.usuario.fotoPerfil).toBe(
      "/autenticacao/eu/foto-perfil"
    );
    expect(JSON.stringify(resposta.body)).not.toContain(
      "referencia-interna"
    );
    expect(resposta.body.usuario).not.toHaveProperty("fotoPerfilPublicId");
  });

  it("busca o perfil atualizado do banco de dados e não confia em claims de perfil no token", async () => {
    const usuario = await criarUsuarioTeste({ perfil: Perfil.COMUM });

    // Emite token contendo claim maliciosa perfil: "ADMIN" forjada no payload, com versaoToken válida
    const tokenComClaimMaliciosa = jwt.sign(
      {
        sub: usuario.id,
        versaoToken: usuario.versaoToken,
        perfil: "ADMIN", // Tentativa de forjar perfil no token
      },
      ambiente.JWT_ACCESS_SECRET,
      {
        algorithm: "HS256",
        issuer: ambiente.JWT_ISSUER,
        audience: ambiente.JWT_AUDIENCE,
        expiresIn: "15m",
      }
    );

    const resposta = await request(app)
      .get("/autenticacao/eu")
      .set("Authorization", `Bearer ${tokenComClaimMaliciosa}`);

    expect(resposta.status).toBe(200);
    // Deve retornar o perfil real do banco (COMUM), ignorando o que estava no token
    expect(resposta.body.usuario.perfil).toBe("COMUM");
  });

  it("retorna HTTP 401 NAO_AUTENTICADO quando o cabeçalho Authorization está ausente", async () => {
    const resposta = await request(app).get("/autenticacao/eu");

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("NAO_AUTENTICADO");
  });

  it("retorna HTTP 401 TOKEN_INVALIDO quando o cabeçalho não segue o formato Bearer <token>", async () => {
    const respostaSemBearer = await request(app)
      .get("/autenticacao/eu")
      .set("Authorization", "TokenInvalidoSemBearer");

    expect(respostaSemBearer.status).toBe(401);
    expect(respostaSemBearer.body.erro.codigo).toBe("TOKEN_INVALIDO");

    const respostaBearerVazio = await request(app)
      .get("/autenticacao/eu")
      .set("Authorization", "Bearer ");

    expect(respostaBearerVazio.status).toBe(401);
    expect(respostaBearerVazio.body.erro.codigo).toBe("TOKEN_INVALIDO");
  });

  it("retorna HTTP 401 TOKEN_EXPIRADO quando o token de acesso já expirou", async () => {
    const usuario = await criarUsuarioTeste();

    // Cria token expirado há 1 hora
    const tokenExpirado = jwt.sign(
      { sub: usuario.id },
      ambiente.JWT_ACCESS_SECRET,
      {
        algorithm: "HS256",
        issuer: ambiente.JWT_ISSUER,
        audience: ambiente.JWT_AUDIENCE,
        expiresIn: -3600, // Expirado no passado
      }
    );

    const resposta = await request(app)
      .get("/autenticacao/eu")
      .set("Authorization", `Bearer ${tokenExpirado}`);

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("TOKEN_EXPIRADO");
  });

  it("retorna HTTP 401 TOKEN_INVALIDO quando o token possui assinatura forjada", async () => {
    const usuario = await criarUsuarioTeste();

    // Assinado com chave secreta diferente
    const tokenFalsificado = jwt.sign(
      { sub: usuario.id },
      "chave_secreta_totalmente_diferente",
      {
        algorithm: "HS256",
        issuer: ambiente.JWT_ISSUER,
        audience: ambiente.JWT_AUDIENCE,
        expiresIn: "15m",
      }
    );

    const resposta = await request(app)
      .get("/autenticacao/eu")
      .set("Authorization", `Bearer ${tokenFalsificado}`);

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("TOKEN_INVALIDO");
  });

  it("retorna HTTP 401 TOKEN_INVALIDO quando o token usa issuer ou audience divergente", async () => {
    const usuario = await criarUsuarioTeste();

    const tokenAudienceDivergente = jwt.sign(
      { sub: usuario.id },
      ambiente.JWT_ACCESS_SECRET,
      {
        algorithm: "HS256",
        issuer: ambiente.JWT_ISSUER,
        audience: "audience_incorreta",
        expiresIn: "15m",
      }
    );

    const resposta = await request(app)
      .get("/autenticacao/eu")
      .set("Authorization", `Bearer ${tokenAudienceDivergente}`);

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("TOKEN_INVALIDO");
  });

  it("retorna HTTP 401 USUARIO_NAO_ENCONTRADO quando o sub do token não existe mais no banco", async () => {
    const tokenUsuarioInexistente = emitirTokenAcesso({
      sub: "a0000000-0000-0000-0000-000000000000",
      versaoToken: 1,
    });

    const resposta = await request(app)
      .get("/autenticacao/eu")
      .set("Authorization", `Bearer ${tokenUsuarioInexistente}`);

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("USUARIO_NAO_ENCONTRADO");
  });

  it("retorna HTTP 403 EMAIL_NAO_VERIFICADO quando a conta não está verificada", async () => {
    const usuarioNaoVerificado = await criarUsuarioTeste({ emailVerificado: false });
    const token = emitirTokenAcesso({
      sub: usuarioNaoVerificado.id,
      versaoToken: usuarioNaoVerificado.versaoToken,
    });

    const resposta = await request(app)
      .get("/autenticacao/eu")
      .set("Authorization", `Bearer ${token}`);

    expect(resposta.status).toBe(403);
    expect(resposta.body.erro.codigo).toBe("EMAIL_NAO_VERIFICADO");
  });
});
