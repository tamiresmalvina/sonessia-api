import { describe, it, expect, beforeAll, afterEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { ambiente } from "../src/config/ambiente.js";
import { gerarHashSenha, verificarSenha } from "../src/utils/senha.util.js";
import {
  gerarRefreshToken,
  gerarHashToken,
  calcularExpiracaoSessao,
  gerarTokenRecuperacao,
} from "../src/utils/token.util.js";
import { emitirTokenAcesso } from "../src/utils/jwt.util.js";
import {
  definirInterceptadorRecuperacaoTeste,
  type ParametrosEnvioRecuperacaoSenha,
} from "../src/utils/email.util.js";
import { StatusSessao } from "../generated/prisma/enums.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Fluxo de Recuperação e Redefinição de Senha — POST /autenticacao/*", () => {
  const idsUsuariosCriados = new Set<string>();

  beforeAll(async () => {
    // Validação estrita da conexão e do isolamento comprovado do banco de testes
    await garantirBancoTestesIsolado();
  });

  afterEach(async () => {
    definirInterceptadorRecuperacaoTeste(null);

    // Limpeza cirúrgica estritamente baseada nos IDs criados durante o teste
    if (idsUsuariosCriados.size > 0) {
      const ids = Array.from(idsUsuariosCriados);
      idsUsuariosCriados.clear();

      await prisma.usuario.deleteMany({
        where: { id: { in: ids } },
      });
    }
  });

  async function criarUsuarioTeste(opcoes?: {
    email?: string;
    emailVerificado?: boolean;
    senhaTextoPlano?: string;
  }) {
    const email =
      opcoes?.email ??
      `test_recup_${Date.now()}_${Math.random().toString(36).substring(2, 8)}@teste.com`;
    const senhaHash = await gerarHashSenha(opcoes?.senhaTextoPlano ?? "SenhaValida@123");

    const usuario = await prisma.usuario.create({
      data: {
        nome: "Usuário Teste Recuperação",
        email: email.toLowerCase().trim(),
        senha: senhaHash,
        dataNascimento: new Date("1994-05-12"),
        emailVerificado: opcoes?.emailVerificado ?? true,
      },
    });

    idsUsuariosCriados.add(usuario.id);
    return usuario;
  }

  async function criarSessaoAtiva(idUsuario: string) {
    const refreshTokenPlano = gerarRefreshToken();
    const tokenHash = gerarHashToken(refreshTokenPlano);

    const sessao = await prisma.sessao.create({
      data: {
        idUsuario,
        tokenHash,
        status: StatusSessao.ATIVA,
        expiraEm: calcularExpiracaoSessao(),
      },
    });

    return { sessao, refreshTokenPlano };
  }

  it("solicitação para e-mail verificado responde HTTP 200 neutro, grava hash SHA-256 e envia e-mail", async () => {
    let emailRecebido: ParametrosEnvioRecuperacaoSenha | null = null;
    definirInterceptadorRecuperacaoTeste(async (params) => {
      emailRecebido = params;
      return { sucesso: true, status: "ENVIADO", mensagemId: "test-recup-1" };
    });

    const usuario = await criarUsuarioTeste();

    const resposta = await request(app)
      .post("/autenticacao/recuperar-senha")
      .send({ email: usuario.email });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      mensagem:
        "Se o e-mail informado estiver cadastrado e verificado, as instruções para redefinição de senha foram enviadas.",
    });

    expect(emailRecebido).not.toBeNull();
    const dadosEmail = emailRecebido as unknown as ParametrosEnvioRecuperacaoSenha;
    expect(dadosEmail.destinatario).toBe(usuario.email);
    expect(dadosEmail.token).toMatch(/^[0-9a-fA-F]{64}$/);

    // Confirma que no banco reside apenas o hash SHA-256 e NUNCA o token em texto plano
    const tokenHashCalculado = gerarHashToken(dadosEmail.token);
    const tokenNoBanco = await prisma.tokenRecuperacaoSenha.findUnique({
      where: { tokenHash: tokenHashCalculado },
    });

    expect(tokenNoBanco).not.toBeNull();
    expect(tokenNoBanco?.idUsuario).toBe(usuario.id);
    expect(tokenNoBanco?.usado).toBe(false);
  });

  it("solicitação para e-mail inexistente responde HTTP 200 neutro idêntico e não envia e-mail", async () => {
    let emailEnviado = false;
    definirInterceptadorRecuperacaoTeste(async () => {
      emailEnviado = true;
      return { sucesso: true, status: "ENVIADO" };
    });

    const emailInexistente = `inexistente_${Date.now()}@teste.com`;

    const resposta = await request(app)
      .post("/autenticacao/recuperar-senha")
      .send({ email: emailInexistente });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      mensagem:
        "Se o e-mail informado estiver cadastrado e verificado, as instruções para redefinição de senha foram enviadas.",
    });
    expect(emailEnviado).toBe(false);
  });

  it("solicitação para conta existente mas NÃO verificada responde HTTP 200 neutro e não envia e-mail", async () => {
    let emailEnviado = false;
    definirInterceptadorRecuperacaoTeste(async () => {
      emailEnviado = true;
      return { sucesso: true, status: "ENVIADO" };
    });

    const usuarioNaoVerificado = await criarUsuarioTeste({ emailVerificado: false });

    const resposta = await request(app)
      .post("/autenticacao/recuperar-senha")
      .send({ email: usuarioNaoVerificado.email });

    expect(resposta.status).toBe(200);
    expect(resposta.body.mensagem).toBe(
      "Se o e-mail informado estiver cadastrado e verificado, as instruções para redefinição de senha foram enviadas."
    );
    expect(emailEnviado).toBe(false);

    // Confirma que nenhum token foi criado para o usuário
    const tokens = await prisma.tokenRecuperacaoSenha.findMany({
      where: { idUsuario: usuarioNaoVerificado.id },
    });
    expect(tokens.length).toBe(0);
  });

  it("respeita cooldown de 60s em solicitações repetidas para a mesma conta sem gerar novo token", async () => {
    let contagemEmails = 0;
    definirInterceptadorRecuperacaoTeste(async () => {
      contagemEmails++;
      return { sucesso: true, status: "ENVIADO" };
    });

    const usuario = await criarUsuarioTeste();

    // 1ª solicitação
    const resp1 = await request(app)
      .post("/autenticacao/recuperar-senha")
      .send({ email: usuario.email });
    expect(resp1.status).toBe(200);
    expect(contagemEmails).toBe(1);

    // 2ª solicitação imediata para a mesma conta (com espaços/maiúsculas no e-mail)
    const resp2 = await request(app)
      .post("/autenticacao/recuperar-senha")
      .send({ email: `  ${usuario.email.toUpperCase()}  ` });
    expect(resp2.status).toBe(200);
    // Não deve disparar segundo e-mail devido ao cooldown
    expect(contagemEmails).toBe(1);

    const tokens = await prisma.tokenRecuperacaoSenha.findMany({
      where: { idUsuario: usuario.id },
    });
    expect(tokens.length).toBe(1);
  });

  it("redefinição com senha fraca falha com HTTP 400 DADOS_INVALIDOS e NÃO consome o token", async () => {
    let tokenPlano = "";
    definirInterceptadorRecuperacaoTeste(async (params) => {
      tokenPlano = params.token;
      return { sucesso: true, status: "ENVIADO" };
    });

    const usuario = await criarUsuarioTeste();
    await request(app)
      .post("/autenticacao/recuperar-senha")
      .send({ email: usuario.email });

    // Envia senha fraca (apenas números)
    const resposta = await request(app)
      .post("/autenticacao/redefinir-senha")
      .send({
        token: tokenPlano,
        novaSenha: "12345",
      });

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");

    // Confirma que o token NÃO foi consumido
    const tokenNoBanco = await prisma.tokenRecuperacaoSenha.findUnique({
      where: { tokenHash: gerarHashToken(tokenPlano) },
    });
    expect(tokenNoBanco?.usado).toBe(false);
  });

  it("redefinição bem-sucedida atualiza senha, incrementa versaoToken, consome token e revoga sessões", async () => {
    let tokenPlano = "";
    definirInterceptadorRecuperacaoTeste(async (params) => {
      tokenPlano = params.token;
      return { sucesso: true, status: "ENVIADO" };
    });

    const usuario = await criarUsuarioTeste({ senhaTextoPlano: "SenhaAntiga@123" });
    const { sessao: sessaoAtiva } = await criarSessaoAtiva(usuario.id);

    // Emite token JWT de acesso antes da troca (versaoToken = 1)
    const tokenAcessoAntigo = emitirTokenAcesso({
      sub: usuario.id,
      versaoToken: usuario.versaoToken,
    });

    // Solicita recuperação
    await request(app)
      .post("/autenticacao/recuperar-senha")
      .send({ email: usuario.email });

    const novaSenhaPlana = "NovaSenhaForte@456";

    // Executa redefinição
    const resposta = await request(app)
      .post("/autenticacao/redefinir-senha")
      .send({
        token: tokenPlano,
        novaSenha: novaSenhaPlana,
      });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      mensagem: "Senha redefinida com sucesso. Faça login com a nova senha.",
    });

    // 1. Confirma que a nova senha é válida com Argon2id
    const usuarioAtualizado = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioAtualizado).not.toBeNull();
    const senhaValida = await verificarSenha(usuarioAtualizado!.senha, novaSenhaPlana);
    expect(senhaValida).toBe(true);

    // 2. Confirma que versaoToken foi incrementada e senhaAlteradaEm gravada
    expect(usuarioAtualizado!.versaoToken).toBe(usuario.versaoToken + 1);
    expect(usuarioAtualizado!.senhaAlteradaEm).not.toBeNull();

    // 3. Confirma que o token foi marcado como usado
    const tokenNoBanco = await prisma.tokenRecuperacaoSenha.findUnique({
      where: { tokenHash: gerarHashToken(tokenPlano) },
    });
    expect(tokenNoBanco?.usado).toBe(true);

    // 4. Confirma que as sessões ativas anteriores foram revogadas
    const sessaoNoBanco = await prisma.sessao.findUnique({
      where: { id: sessaoAtiva.id },
    });
    expect(sessaoNoBanco?.status).toBe(StatusSessao.REVOGADA);

    // 5. Confirma que o access token emitido antes da troca é REJEITADO imediatamente
    const respostaEu = await request(app)
      .get("/autenticacao/eu")
      .set("Authorization", `Bearer ${tokenAcessoAntigo}`);
    expect(respostaEu.status).toBe(401);
    expect(respostaEu.body.erro.codigo).toBe("TOKEN_INVALIDO");
  });

  it("tentativa de reutilizar token já consumido falha com HTTP 400 TOKEN_INVALIDO", async () => {
    let tokenPlano = "";
    definirInterceptadorRecuperacaoTeste(async (params) => {
      tokenPlano = params.token;
      return { sucesso: true, status: "ENVIADO" };
    });

    const usuario = await criarUsuarioTeste();
    await request(app)
      .post("/autenticacao/recuperar-senha")
      .send({ email: usuario.email });

    // 1º uso: sucesso
    const resp1 = await request(app)
      .post("/autenticacao/redefinir-senha")
      .send({
        token: tokenPlano,
        novaSenha: "PrimeiraSenha@123",
      });
    expect(resp1.status).toBe(200);

    // 2º uso repetido do mesmo token: deve falhar
    const resp2 = await request(app)
      .post("/autenticacao/redefinir-senha")
      .send({
        token: tokenPlano,
        novaSenha: "SegundaSenha@456",
      });
    expect(resp2.status).toBe(400);
    expect(resp2.body.erro.codigo).toBe("TOKEN_INVALIDO");
  });

  it("tentativa de usar token expirado falha com HTTP 400 TOKEN_EXPIRADO", async () => {
    const usuario = await criarUsuarioTeste();
    const tokenExpiradoPlano = gerarTokenRecuperacao();
    const tokenHash = gerarHashToken(tokenExpiradoPlano);

    // Grava token já expirado no passado
    await prisma.tokenRecuperacaoSenha.create({
      data: {
        idUsuario: usuario.id,
        tokenHash,
        usado: false,
        expiraEm: new Date(Date.now() - 60_000), // 1 minuto atrás
      },
    });

    const resposta = await request(app)
      .post("/autenticacao/redefinir-senha")
      .send({
        token: tokenExpiradoPlano,
        novaSenha: "NovaSenhaForte@123",
      });

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("TOKEN_EXPIRADO");
  });

  it("concorrência na redefinição com o mesmo token resulta em exatamente 1 sucesso e 1 rejeição", async () => {
    let tokenPlano = "";
    definirInterceptadorRecuperacaoTeste(async (params) => {
      tokenPlano = params.token;
      return { sucesso: true, status: "ENVIADO" };
    });

    const usuario = await criarUsuarioTeste();
    await request(app)
      .post("/autenticacao/recuperar-senha")
      .send({ email: usuario.email });

    // Dispara duas requisições de redefinição exatamente simultâneas com Promise.all
    const [res1, res2] = await Promise.all([
      request(app)
        .post("/autenticacao/redefinir-senha")
        .send({ token: tokenPlano, novaSenha: "SenhaConcorrenteA@123" }),
      request(app)
        .post("/autenticacao/redefinir-senha")
        .send({ token: tokenPlano, novaSenha: "SenhaConcorrenteB@123" }),
    ]);

    const statusList = [res1.status, res2.status];
    expect(statusList).toContain(200);
    expect(statusList).toContain(400);

    // Valida que a requisição rejeitada falhou explicitamente por TOKEN_INVALIDO
    const requisicaoRejeitada = res1.status === 400 ? res1 : res2;
    expect(requisicaoRejeitada.body.erro.codigo).toBe("TOKEN_INVALIDO");
  });

  it("falha no envio do e-mail invalida o token recém-criado e responde HTTP 200 neutro", async () => {
    let tokenGerado = "";
    definirInterceptadorRecuperacaoTeste(async (params) => {
      tokenGerado = params.token;
      return {
        sucesso: false,
        status: "FALHA_ENVIO",
        motivo: "DESTINATARIO_REJEITADO",
      };
    });

    const usuario = await criarUsuarioTeste();

    const resposta = await request(app)
      .post("/autenticacao/recuperar-senha")
      .send({ email: usuario.email });

    // Para o cliente a resposta é neutra (anti-enumeração)
    expect(resposta.status).toBe(200);

    // No banco, o token deve ter sido invalidado para não deixar tokens órfãos
    expect(tokenGerado).not.toBe("");
    const tokenNoBanco = await prisma.tokenRecuperacaoSenha.findUnique({
      where: { tokenHash: gerarHashToken(tokenGerado) },
    });
    expect(tokenNoBanco?.usado).toBe(true);
  });

  it("rejeita JWTs sem o claim versaoToken no middleware autenticar", async () => {
    const usuario = await criarUsuarioTeste();

    // Forja token sem versaoToken (legado anterior à mudança)
    const tokenLegadoSemVersao = jwt.sign(
      { sub: usuario.id },
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
      .set("Authorization", `Bearer ${tokenLegadoSemVersao}`);

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("TOKEN_INVALIDO");
  });
});
