import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { verificarSenha } from "../src/utils/senha.util.js";
import { definirInterceptadorEmailTeste } from "../src/utils/email.util.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Fluxo de Cadastro — POST /autenticacao/cadastro", () => {
  const prefixoTeste = "test_cad_";

  beforeAll(async () => {
    await garantirBancoTestesIsolado();
  });

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
    // Senha com menos de 8 caracteres
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

  describe("Nova Política de Validação de Senhas — Limites e Composição", () => {
    it("rejeita senha com 7 caracteres mesmo contendo maiúscula, minúscula, número e símbolo", async () => {
      // 7 caracteres: 'A' (maiúscula), 'a' (minúscula), '1' (número), '!' (símbolo) + 'aaa'
      const resposta = await request(app)
        .post("/autenticacao/cadastro")
        .send({
          nome: "Senha Curta",
          email: `${prefixoTeste}senha_7_${Date.now()}@teste.com`,
          senha: "Aa1!aaa",
          dataNascimento: "1990-01-01",
        });

      expect(resposta.status).toBe(400);
      expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");
      const mensagens = resposta.body.erro.detalhes.map((d: { mensagem: string }) => d.mensagem);
      expect(mensagens).toContain("A senha deve ter no mínimo 8 caracteres.");
    });

    it("aceita senha válida com exatamente 8 caracteres cumprindo todos os requisitos", async () => {
      const email = `${prefixoTeste}senha_8_${Date.now()}@teste.com`;
      const resposta = await request(app)
        .post("/autenticacao/cadastro")
        .send({
          nome: "Senha Oito",
          email,
          senha: "Aa1!aaaa", // Exatamente 8 caracteres
          dataNascimento: "1990-01-01",
        });

      expect(resposta.status).toBe(201);
      const usuario = await prisma.usuario.findUnique({ where: { email } });
      expect(usuario).not.toBeNull();
    });

    it("aceita senha válida com exatamente 128 caracteres cumprindo todos os requisitos", async () => {
      const email = `${prefixoTeste}senha_128_${Date.now()}@teste.com`;
      // 'Aa1!' (4 chars) + 'a' repetido 124 vezes = exatamente 128 caracteres
      const senha128 = "Aa1!" + "a".repeat(124);

      const resposta = await request(app)
        .post("/autenticacao/cadastro")
        .send({
          nome: "Senha Maxima",
          email,
          senha: senha128,
          dataNascimento: "1990-01-01",
        });

      expect(resposta.status).toBe(201);
      const usuario = await prisma.usuario.findUnique({ where: { email } });
      expect(usuario).not.toBeNull();
    });

    it("rejeita senha com 129 caracteres mesmo cumprindo todos os requisitos de composição", async () => {
      // 'Aa1!' (4 chars) + 'a' repetido 125 vezes = exatamente 129 caracteres
      const senha129 = "Aa1!" + "a".repeat(125);

      const resposta = await request(app)
        .post("/autenticacao/cadastro")
        .send({
          nome: "Senha Excedida",
          email: `${prefixoTeste}senha_129_${Date.now()}@teste.com`,
          senha: senha129,
          dataNascimento: "1990-01-01",
        });

      expect(resposta.status).toBe(400);
      expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");
      const mensagens = resposta.body.erro.detalhes.map((d: { mensagem: string }) => d.mensagem);
      expect(mensagens).toContain("A senha deve ter no máximo 128 caracteres.");
    });

    it("rejeita senha sem letra maiúscula mesmo cumprindo os demais requisitos", async () => {
      // 8 caracteres, sem maiúscula
      const resposta = await request(app)
        .post("/autenticacao/cadastro")
        .send({
          nome: "Sem Maiuscula",
          email: `${prefixoTeste}sem_maiuscula_${Date.now()}@teste.com`,
          senha: "aa1!aaaa",
          dataNascimento: "1990-01-01",
        });

      expect(resposta.status).toBe(400);
      expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");
      const mensagens = resposta.body.erro.detalhes.map((d: { mensagem: string }) => d.mensagem);
      expect(mensagens).toContain("A senha deve conter pelo menos uma letra maiúscula.");
    });

    it("rejeita senha sem letra minúscula mesmo cumprindo os demais requisitos", async () => {
      // 8 caracteres, sem minúscula
      const resposta = await request(app)
        .post("/autenticacao/cadastro")
        .send({
          nome: "Sem Minuscula",
          email: `${prefixoTeste}sem_minuscula_${Date.now()}@teste.com`,
          senha: "AA1!AAAA",
          dataNascimento: "1990-01-01",
        });

      expect(resposta.status).toBe(400);
      expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");
      const mensagens = resposta.body.erro.detalhes.map((d: { mensagem: string }) => d.mensagem);
      expect(mensagens).toContain("A senha deve conter pelo menos uma letra minúscula.");
    });

    it("rejeita senha sem número mesmo cumprindo os demais requisitos", async () => {
      // 8 caracteres, sem número
      const resposta = await request(app)
        .post("/autenticacao/cadastro")
        .send({
          nome: "Sem Numero",
          email: `${prefixoTeste}sem_numero_${Date.now()}@teste.com`,
          senha: "Aaa!aaaa",
          dataNascimento: "1990-01-01",
        });

      expect(resposta.status).toBe(400);
      expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");
      const mensagens = resposta.body.erro.detalhes.map((d: { mensagem: string }) => d.mensagem);
      expect(mensagens).toContain("A senha deve conter pelo menos um número.");
    });

    it("rejeita senha sem símbolo mesmo cumprindo os demais requisitos", async () => {
      // 8 caracteres, sem símbolo
      const resposta = await request(app)
        .post("/autenticacao/cadastro")
        .send({
          nome: "Sem Simbolo",
          email: `${prefixoTeste}sem_simbolo_${Date.now()}@teste.com`,
          senha: "Aa1aaaaa",
          dataNascimento: "1990-01-01",
        });

      expect(resposta.status).toBe(400);
      expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");
      const mensagens = resposta.body.erro.detalhes.map((d: { mensagem: string }) => d.mensagem);
      expect(mensagens).toContain("A senha deve conter pelo menos um símbolo.");
    });

    it("aceita senhas com caracteres acentuados da língua portuguesa", async () => {
      const email = `${prefixoTeste}acentuada_${Date.now()}@teste.com`;
      const resposta = await request(app)
        .post("/autenticacao/cadastro")
        .send({
          nome: "Usuario Portugues",
          email,
          senha: "Ótima@Senha123", // Contém maiúscula acentuada 'Ó', minúscula, número e símbolo '@'
          dataNascimento: "1991-04-12",
        });

      expect(resposta.status).toBe(201);
      const usuario = await prisma.usuario.findUnique({ where: { email } });
      expect(usuario).not.toBeNull();
    });

    it("não trata letras portuguesas (ç, ã) como símbolos", async () => {
      // 'Coração123' tem maiúscula 'C', minúsculas 'o', 'r', 'a', 'ç', 'ã', 'o' e números, mas NÃO tem símbolo
      const resposta = await request(app)
        .post("/autenticacao/cadastro")
        .send({
          nome: "Sem Simbolo Real",
          email: `${prefixoTeste}sem_simbolo_pt_${Date.now()}@teste.com`,
          senha: "Coração123",
          dataNascimento: "1992-08-15",
        });

      expect(resposta.status).toBe(400);
      expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");
      const mensagens = resposta.body.erro.detalhes.map((d: { mensagem: string }) => d.mensagem);
      expect(mensagens).toContain("A senha deve conter pelo menos um símbolo.");
    });

    it("não considera espaços em branco como símbolos", async () => {
      const resposta = await request(app)
        .post("/autenticacao/cadastro")
        .send({
          nome: "Sem Simbolo Espaco",
          email: `${prefixoTeste}espaco_simbolo_${Date.now()}@teste.com`,
          senha: "Senha Forte 123", // Contém espaços, mas nenhum símbolo ou pontuação
          dataNascimento: "1990-01-01",
        });

      expect(resposta.status).toBe(400);
      expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");
      const mensagens = resposta.body.erro.detalhes.map((d: { mensagem: string }) => d.mensagem);
      expect(mensagens).toContain("A senha deve conter pelo menos um símbolo.");
    });

    it("aceita senha com pontuação e símbolos Unicode mantendo suporte a acentuação", async () => {
      const email = `${prefixoTeste}simbolo_unicode_${Date.now()}@teste.com`;
      const resposta = await request(app)
        .post("/autenticacao/cadastro")
        .send({
          nome: "Simbolo Unicode",
          email,
          senha: "Coração€Forte123", // Letras acentuadas 'ç', 'ã', símbolo de moeda Unicode '€'
          dataNascimento: "1990-01-01",
        });

      expect(resposta.status).toBe(201);
      const usuario = await prisma.usuario.findUnique({ where: { email } });
      expect(usuario).not.toBeNull();
    });
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

  it("cadastros simultâneos com o mesmo e-mail retornam HTTP 409 sem erro 500", async () => {
    const email = `${prefixoTeste}concorrente_${Date.now()}@teste.com`;

    const payload = {
      nome: "Concorrente Teste",
      email,
      senha: "SenhaConcorrente@123",
      dataNascimento: "1994-06-12",
    };

    // Dispara duas requisições de cadastro simultaneamente
    const [res1, res2] = await Promise.all([
      request(app).post("/autenticacao/cadastro").send(payload),
      request(app).post("/autenticacao/cadastro").send(payload),
    ]);

    const statusCodes = [res1.status, res2.status].sort();
    expect(statusCodes).toEqual([201, 409]);

    const respostaConflito = res1.status === 409 ? res1 : res2;
    expect(respostaConflito.body.erro.codigo).toBe("CONFLITO_CADASTRO");
    expect(respostaConflito.status).not.toBe(500);

    // Garante que apenas um usuário foi criado no banco
    const usuarios = await prisma.usuario.findMany({ where: { email } });
    expect(usuarios.length).toBe(1);
  });

  it("recuperação coerente após falha de envio permite reenvio imediato sem esperar 60s", async () => {
    const email = `${prefixoTeste}recup_${Date.now()}@teste.com`;

    // 1. Simula falha de envio no cadastro
    definirInterceptadorEmailTeste(async () => ({ sucesso: false, status: "FALHA_ENVIO" }));

    const resCadastro = await request(app)
      .post("/autenticacao/cadastro")
      .send({
        nome: "Usuario Recuperacao",
        email,
        senha: "SenhaRecuperacao@123",
        dataNascimento: "1996-03-10",
      });

    expect(resCadastro.status).toBe(502);
    expect(resCadastro.body.erro.codigo).toBe("FALHA_ENVIO_EMAIL");

    // O usuário existe e não está verificado
    const usuarioBanco = await prisma.usuario.findUnique({ where: { email } });
    expect(usuarioBanco).not.toBeNull();
    expect(usuarioBanco?.emailVerificado).toBe(false);

    // 2. Agora o e-mail volta a funcionar
    definirInterceptadorEmailTeste(async () => ({
      sucesso: true,
      status: "ENVIADO",
      mensagemId: "recup-sucesso-id",
    }));

    // O usuário deve conseguir solicitar o reenvio IMEDIATAMENTE (sem tomar 429 por cooldown de código fantasma)
    const resReenvio = await request(app)
      .post("/autenticacao/reenviar-codigo")
      .send({ email });

    expect(resReenvio.status).toBe(200);
    expect(resReenvio.body.mensagem).toContain("reenviado com sucesso");

    // Agora há exatamente um código ativo no banco
    const codigosAtivos = await prisma.codigoVerificacaoEmail.findMany({
      where: { usuario: { email }, usado: false },
    });
    expect(codigosAtivos.length).toBe(1);
  });
});

