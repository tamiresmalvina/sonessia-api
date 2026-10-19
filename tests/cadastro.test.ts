import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { verificarSenha } from "../src/utils/senha.util.js";
import { definirInterceptadorEmailTeste } from "../src/utils/email.util.js";

describe("Fluxo de Cadastro — POST /autenticacao/cadastro", () => {
  const prefixoTeste = "test_cad_";

  beforeEach(async () => {
    definirInterceptadorEmailTeste(null);
  });

  afterEach(async () => {
    definirInterceptadorEmailTeste(null);
    // Remove apenas usuários criados durante os testes
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: prefixoTeste } },
    });
  });

  it("cadastro válido cria usuário comum não verificado", async () => {
    const email = `${prefixoTeste}valido_${Date.now()}@teste.com`;

    const resposta = await request(app)
      .post("/autenticacao/cadastro")
      .send({
        nome: "Maria Silva",
        email,
        senha: "SenhaForteSegura@123",
        dataNascimento: "1995-05-15",
      });

    expect(resposta.status).toBe(201);
    expect(resposta.body).toHaveProperty("mensagem");
    expect(resposta.body.usuario).toMatchObject({
      nome: "Maria Silva",
      email,
      perfil: "COMUM",
      emailVerificado: false,
    });
    // Garante que senhas ou hashes nunca são retornados
    expect(resposta.body.usuario).not.toHaveProperty("senha");
    expect(resposta.body.usuario).not.toHaveProperty("codigoHash");

    // Valida no banco
    const usuarioBanco = await prisma.usuario.findUnique({ where: { email } });
    expect(usuarioBanco).not.toBeNull();
    expect(usuarioBanco?.perfil).toBe("COMUM");
    expect(usuarioBanco?.emailVerificado).toBe(false);
  });

  it("senha é armazenada exclusivamente como hash Argon2id", async () => {
    const email = `${prefixoTeste}hash_${Date.now()}@teste.com`;
    const senhaTextoPlano = "MinhaSenhaSuperSecreta@987";

    await request(app)
      .post("/autenticacao/cadastro")
      .send({
        nome: "João Teste",
        email,
        senha: senhaTextoPlano,
        dataNascimento: "1990-01-01",
      });

    const usuarioBanco = await prisma.usuario.findUnique({ where: { email } });
    expect(usuarioBanco).not.toBeNull();
    expect(usuarioBanco?.senha).not.toBe(senhaTextoPlano);
    expect(usuarioBanco?.senha.startsWith("$argon2id$")).toBe(true);

    const valida = await verificarSenha(usuarioBanco!.senha, senhaTextoPlano);
    expect(valida).toBe(true);
  });

  it("tentativa de definir perfil: ADMIN não concede privilégios administrativos", async () => {
    const email = `${prefixoTeste}admin_tentativa_${Date.now()}@teste.com`;

    const resposta = await request(app)
      .post("/autenticacao/cadastro")
      .send({
        nome: "Invasor",
        email,
        senha: "SenhaForteTentativa@123",
        dataNascimento: "1992-03-10",
        perfil: "ADMIN", // Tentativa maliciosa de se registrar como admin
      });

    expect(resposta.status).toBe(201);
    expect(resposta.body.usuario.perfil).toBe("COMUM");

    const usuarioBanco = await prisma.usuario.findUnique({ where: { email } });
    expect(usuarioBanco?.perfil).toBe("COMUM");
  });

  it("dados inválidos são rejeitados com HTTP 400 e detalhes do erro", async () => {
    // Senha com menos de 10 caracteres
    const respostaSenhaCurta = await request(app)
      .post("/autenticacao/cadastro")
      .send({
        nome: "Teste",
        email: `${prefixoTeste}invalido_${Date.now()}@teste.com`,
        senha: "curta",
        dataNascimento: "1990-01-01",
      });

    expect(respostaSenhaCurta.status).toBe(400);
    expect(respostaSenhaCurta.body.erro.codigo).toBe("DADOS_INVALIDOS");

    // E-mail inválido
    const respostaEmailInvalido = await request(app)
      .post("/autenticacao/cadastro")
      .send({
        nome: "Teste",
        email: "email-invalido-sem-arroba",
        senha: "SenhaForteSegura@123",
        dataNascimento: "1990-01-01",
      });

    expect(respostaEmailInvalido.status).toBe(400);
    expect(respostaEmailInvalido.body.erro.codigo).toBe("DADOS_INVALIDOS");
  });

  it("e-mail duplicado tem tratamento seguro com HTTP 409", async () => {
    const email = `${prefixoTeste}duplicado_${Date.now()}@teste.com`;

    const payload = {
      nome: "Primeiro Registro",
      email,
      senha: "SenhaValida@123456",
      dataNascimento: "1995-10-10",
    };

    const primeira = await request(app).post("/autenticacao/cadastro").send(payload);
    expect(primeira.status).toBe(201);

    const segunda = await request(app).post("/autenticacao/cadastro").send(payload);
    expect(segunda.status).toBe(409);
    expect(segunda.body.erro.codigo).toBe("CONFLITO_CADASTRO");
  });

  it("falha no envio de e-mail não produz falsa resposta de sucesso", async () => {
    const email = `${prefixoTeste}falha_email_${Date.now()}@teste.com`;

    // Simula falha no provedor de envio de e-mail
    definirInterceptadorEmailTeste(async () => ({ sucesso: false }));

    const resposta = await request(app)
      .post("/autenticacao/cadastro")
      .send({
        nome: "Sem Email",
        email,
        senha: "SenhaForteEnvio@123",
        dataNascimento: "1998-04-20",
      });

    expect(resposta.status).toBe(502);
    expect(resposta.body.erro.codigo).toBe("FALHA_ENVIO_EMAIL");

    // O usuário foi persistido e a falha de envio foi informada
    const usuarioBanco = await prisma.usuario.findUnique({ where: { email } });
    expect(usuarioBanco).not.toBeNull();
    expect(usuarioBanco?.emailVerificado).toBe(false);
  });
});
