import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { SendMailOptions, Transporter } from "nodemailer";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { Perfil, StatusSessao } from "../generated/prisma/enums.js";
import { ambiente } from "../src/config/ambiente.js";
import { emitirTokenAcesso } from "../src/utils/jwt.util.js";
import {
  definirForcarExecucaoEtherealEmTestes,
  definirInterceptadorAlteracaoEmailTeste,
  definirTransportadorCustomizado,
  enviarEmailConfirmacaoAlteracaoEmail,
  resetarTransportadorEthereal,
  type ParametrosEnvioConfirmacaoAlteracaoEmail,
} from "../src/utils/email.util.js";
import { gerarHashSenha } from "../src/utils/senha.util.js";
import { gerarHashToken } from "../src/utils/token.util.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Alteração segura do próprio e-mail", () => {
  const prefixoTeste = "test_alteracao_email_";
  const tokensEnviados: Partial<
    Record<ParametrosEnvioConfirmacaoAlteracaoEmail["etapa"], string>
  > = {};

  beforeAll(async () => {
    await garantirBancoTestesIsolado();
  });

  beforeEach(() => {
    delete tokensEnviados.atual;
    delete tokensEnviados.novo;
    definirInterceptadorAlteracaoEmailTeste(async (parametros) => {
      tokensEnviados[parametros.etapa] = parametros.token;
      return { sucesso: true, status: "ENVIADO", mensagemId: "email-teste-id" };
    });
  });

  afterEach(async () => {
    definirInterceptadorAlteracaoEmailTeste(null);
    definirForcarExecucaoEtherealEmTestes(false);
    definirTransportadorCustomizado(null);
    resetarTransportadorEthereal();
    vi.restoreAllMocks();
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: prefixoTeste } },
    });
  });

  async function criarUsuarioTeste(
    perfil: Perfil = Perfil.COMUM,
    senhaHash = "hash-de-teste"
  ) {
    return prisma.usuario.create({
      data: {
        nome: "Usuário Alteração E-mail",
        email: `${prefixoTeste}${randomUUID()}@teste.com`,
        senha: senhaHash,
        dataNascimento: new Date("1994-06-20"),
        emailVerificado: true,
        perfil,
      },
    });
  }

  function criarTokenAcesso(idUsuario: string, versaoToken: number): string {
    return emitirTokenAcesso({ sub: idUsuario, versaoToken });
  }

  async function solicitarAlteracao(
    idUsuario: string,
    versaoToken: number,
    novoEmail: string
  ) {
    return request(app)
      .post("/autenticacao/solicitar-alteracao-email")
      .set("Authorization", `Bearer ${criarTokenAcesso(idUsuario, versaoToken)}`)
      .send({ novoEmail });
  }

  async function confirmarEmailAtual(usuario: {
    id: string;
    versaoToken: number;
  }, token = tokensEnviados.atual) {
    return request(app)
      .post("/autenticacao/confirmar-email-atual")
      .set("Authorization", `Bearer ${criarTokenAcesso(usuario.id, usuario.versaoToken)}`)
      .send({ token });
  }

  async function confirmarNovoEmail(usuario: {
    id: string;
    versaoToken: number;
  }, token = tokensEnviados.novo) {
    return request(app)
      .post("/autenticacao/confirmar-novo-email")
      .set("Authorization", `Bearer ${criarTokenAcesso(usuario.id, usuario.versaoToken)}`)
      .send({ token });
  }

  it.each([Perfil.COMUM, Perfil.ADMIN])(
    "exige as duas confirmações antes de atualizar a conta %s e revoga sessões ao concluir",
    async (perfil) => {
      const usuario = await criarUsuarioTeste(perfil);
      const sessao = await prisma.sessao.create({
        data: {
          idUsuario: usuario.id,
          tokenHash: `hash-sessao-${randomUUID()}`,
          expiraEm: new Date(Date.now() + 60_000),
        },
      });
      const novoEmail = `${prefixoTeste}novo_${randomUUID()}@teste.com`;

      const solicitacao = await solicitarAlteracao(
        usuario.id,
        usuario.versaoToken,
        novoEmail
      );

      expect(solicitacao.status).toBe(202);
      expect(solicitacao.body).toEqual({
        mensagem:
          "Se a solicitação puder ser processada, as instruções serão enviadas ao e-mail atual.",
      });
      expect(JSON.stringify(solicitacao.body)).not.toContain(tokensEnviados.atual);

      let usuarioAtual = await prisma.usuario.findUnique({
        where: { id: usuario.id },
      });
      expect(usuarioAtual?.email).toBe(usuario.email);
      expect(usuarioAtual?.perfil).toBe(perfil);
      expect(usuarioAtual?.versaoToken).toBe(usuario.versaoToken);
      expect(
        (await prisma.sessao.findUnique({ where: { id: sessao.id } }))?.status
      ).toBe(StatusSessao.ATIVA);
      expect(tokensEnviados.atual).toMatch(/^[0-9a-f]{64}$/);
      expect(tokensEnviados.novo).toBeUndefined();

      const confirmacaoAtual = await confirmarEmailAtual(usuario);
      expect(confirmacaoAtual.status).toBe(200);
      expect(confirmacaoAtual.body.mensagem).toBe(
        "Confirmação do novo e-mail enviada."
      );
      expect(tokensEnviados.novo).toMatch(/^[0-9a-f]{64}$/);

      usuarioAtual = await prisma.usuario.findUnique({
        where: { id: usuario.id },
      });
      expect(usuarioAtual?.email).toBe(usuario.email);
      expect(usuarioAtual?.perfil).toBe(perfil);
      expect(
        (await prisma.sessao.findUnique({ where: { id: sessao.id } }))?.status
      ).toBe(StatusSessao.ATIVA);

      const alteracaoPendente = await prisma.alteracaoEmail.findFirst({
        where: { idUsuario: usuario.id, emailNovo: novoEmail },
      });
      expect(alteracaoPendente?.tokenEmailAtualHash).toBeNull();
      expect(alteracaoPendente?.tokenEmailNovoHash).toBe(
        gerarHashToken(tokensEnviados.novo!)
      );
      expect(JSON.stringify(confirmacaoAtual.body)).not.toContain(
        tokensEnviados.novo
      );

      const confirmacaoNovo = await confirmarNovoEmail(usuario);
      expect(confirmacaoNovo.status).toBe(200);
      expect(confirmacaoNovo.body.mensagem).toBe(
        "E-mail atualizado com sucesso. Entre novamente para continuar."
      );
      expect(JSON.stringify(confirmacaoNovo.body)).not.toContain(tokensEnviados.novo);

      usuarioAtual = await prisma.usuario.findUnique({
        where: { id: usuario.id },
      });
      expect(usuarioAtual).toMatchObject({
        id: usuario.id,
        nome: usuario.nome,
        email: novoEmail,
        senha: usuario.senha,
        dataNascimento: usuario.dataNascimento,
        fotoPerfil: usuario.fotoPerfil,
        perfil,
        emailVerificado: true,
        senhaAlteradaEm: usuario.senhaAlteradaEm,
        versaoToken: usuario.versaoToken + 1,
      });

      const sessaoAtualizada = await prisma.sessao.findUnique({
        where: { id: sessao.id },
      });
      expect(sessaoAtualizada?.status).toBe(StatusSessao.REVOGADA);

      const alteracao = await prisma.alteracaoEmail.findFirst({
        where: { idUsuario: usuario.id, emailNovo: novoEmail },
      });
      expect(alteracao?.concluidaEm).toBeInstanceOf(Date);
      expect(alteracao?.tokenEmailAtualHash).toBeNull();
      expect(alteracao?.tokenEmailNovoHash).toBeNull();

      const tokenAcessoAntigo = criarTokenAcesso(usuario.id, usuario.versaoToken);
      const respostaTokenAntigo = await request(app)
        .get("/autenticacao/eu")
        .set("Authorization", `Bearer ${tokenAcessoAntigo}`);
      expect(respostaTokenAntigo.status).toBe(401);
      expect(respostaTokenAntigo.body.erro.codigo).toBe("TOKEN_INVALIDO");

      const repeticaoNovoToken = await confirmarNovoEmail(
        { id: usuario.id, versaoToken: usuario.versaoToken + 1 },
        tokensEnviados.novo
      );
      expect(repeticaoNovoToken.status).toBe(400);
      expect(repeticaoNovoToken.body.erro.codigo).toBe("TOKEN_INVALIDO");
    }
  );

  it("permite login com o novo e-mail e senha original somente após ambas as confirmações", async () => {
    const senhaOriginal = "SenhaOriginal@123";
    const usuario = await criarUsuarioTeste(
      Perfil.COMUM,
      await gerarHashSenha(senhaOriginal)
    );
    const emailAntigo = usuario.email;
    const novoEmail = `${prefixoTeste}login_novo_${randomUUID()}@teste.com`;

    const solicitacao = await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      novoEmail
    );
    expect(solicitacao.status).toBe(202);

    let usuarioNoBanco = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioNoBanco?.email).toBe(emailAntigo);

    const confirmacaoAtual = await confirmarEmailAtual(usuario);
    expect(confirmacaoAtual.status).toBe(200);

    usuarioNoBanco = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioNoBanco?.email).toBe(emailAntigo);

    const loginAntesDaSegundaConfirmacao = await request(app)
      .post("/autenticacao/login")
      .send({ email: novoEmail, senha: senhaOriginal });
    expect(loginAntesDaSegundaConfirmacao.status).toBe(401);
    expect(loginAntesDaSegundaConfirmacao.body.erro.codigo).toBe(
      "CREDENCIAIS_INVALIDAS"
    );

    const confirmacaoNovo = await confirmarNovoEmail(usuario);
    expect(confirmacaoNovo.status).toBe(200);

    usuarioNoBanco = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioNoBanco?.email).toBe(novoEmail);

    const loginComNovoEmail = await request(app)
      .post("/autenticacao/login")
      .send({ email: novoEmail, senha: senhaOriginal });
    expect(loginComNovoEmail.status).toBe(200);
    expect(loginComNovoEmail.body.usuario).toMatchObject({
      id: usuario.id,
      email: novoEmail,
    });

    const loginComEmailAntigo = await request(app)
      .post("/autenticacao/login")
      .send({ email: emailAntigo, senha: senhaOriginal });
    expect(loginComEmailAntigo.status).toBe(401);
    expect(loginComEmailAntigo.body.erro.codigo).toBe("CREDENCIAIS_INVALIDAS");

    const loginComSenhaIncorreta = await request(app)
      .post("/autenticacao/login")
      .send({ email: novoEmail, senha: "SenhaIncorreta@456" });
    expect(loginComSenhaIncorreta.status).toBe(401);
    expect(loginComSenhaIncorreta.body.erro.codigo).toBe("CREDENCIAIS_INVALIDAS");
  });

  it("não retorna sucesso nem altera o e-mail quando a transação final falha", async () => {
    const usuario = await criarUsuarioTeste();
    const novoEmail = `${prefixoTeste}falha_transacao_${randomUUID()}@teste.com`;
    const solicitacao = await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      novoEmail
    );
    expect(solicitacao.status).toBe(202);
    expect((await confirmarEmailAtual(usuario)).status).toBe(200);

    vi.spyOn(prisma, "$transaction").mockRejectedValue(
      new Error("Falha transacional simulada.")
    );

    const confirmacaoFinal = await confirmarNovoEmail(usuario);

    expect(confirmacaoFinal.status).toBe(500);
    expect(confirmacaoFinal.body.erro.codigo).toBe("ERRO_INTERNO");
    expect(confirmacaoFinal.body.mensagem).toBeUndefined();

    const usuarioSemAlteracao = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioSemAlteracao?.email).toBe(usuario.email);
  });

  it("rejeita solicitação sem autenticação", async () => {
    const resposta = await request(app)
      .post("/autenticacao/solicitar-alteracao-email")
      .send({ novoEmail: "novo@teste.com" });

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("NAO_AUTENTICADO");
  });

  it.each([
    ["/autenticacao/solicitar-alteracao-email", { novoEmail: "novo@teste.com" }],
    ["/autenticacao/confirmar-email-atual", { token: "a".repeat(64) }],
    ["/autenticacao/confirmar-novo-email", { token: "a".repeat(64) }],
  ])("rejeita usuário não autenticado em %s", async (rota, corpo) => {
    const resposta = await request(app).post(rota).send(corpo);

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("NAO_AUTENTICADO");
  });

  it("rejeita em produção qualquer origem quando FRONTEND_ORIGIN não está configurada", async () => {
    const nodeEnvOriginal = ambiente.NODE_ENV;
    const origemOriginal = ambiente.FRONTEND_ORIGIN;

    try {
      (ambiente as Record<string, unknown>).NODE_ENV = "production";
      (ambiente as Record<string, unknown>).FRONTEND_ORIGIN = undefined;

      const respostaSemOrigemConfigurada = await request(app)
        .post("/autenticacao/solicitar-alteracao-email")
        .set("Origin", "https://origem-nao-autorizada.example")
        .send({ novoEmail: "novo@teste.com" });

      expect(respostaSemOrigemConfigurada.status).toBe(403);
      expect(respostaSemOrigemConfigurada.body.erro.codigo).toBe(
        "ORIGEM_NAO_CONFIGURADA"
      );

      (ambiente as Record<string, unknown>).FRONTEND_ORIGIN =
        "https://app.sonessia.example";
      const respostaOrigemConfigurada = await request(app)
        .post("/autenticacao/solicitar-alteracao-email")
        .set("Origin", "https://app.sonessia.example")
        .send({ novoEmail: "novo@teste.com" });

      expect(respostaOrigemConfigurada.status).toBe(401);
      expect(respostaOrigemConfigurada.body.erro.codigo).toBe("NAO_AUTENTICADO");
    } finally {
      (ambiente as Record<string, unknown>).NODE_ENV = nodeEnvOriginal;
      (ambiente as Record<string, unknown>).FRONTEND_ORIGIN = origemOriginal;
    }
  });

  it.each([
    ["ausente", {}],
    ["inválido", { novoEmail: "email-invalido" }],
    ["protegido", { novoEmail: "novo@teste.com", idUsuario: randomUUID() }],
  ])("rejeita corpo %s ao solicitar alteração", async (_caso, corpo) => {
    const usuario = await criarUsuarioTeste();
    const resposta = await request(app)
      .post("/autenticacao/solicitar-alteracao-email")
      .set("Authorization", `Bearer ${criarTokenAcesso(usuario.id, usuario.versaoToken)}`)
      .send(corpo);

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");
    expect(tokensEnviados.atual).toBeUndefined();
  });

  it("não altera o e-mail antes das duas confirmações e não aceita mass assignment", async () => {
    const usuario = await criarUsuarioTeste();
    const resposta = await request(app)
      .post("/autenticacao/solicitar-alteracao-email")
      .set("Authorization", `Bearer ${criarTokenAcesso(usuario.id, usuario.versaoToken)}`)
      .send({
        novoEmail: `${prefixoTeste}mass_${randomUUID()}@teste.com`,
        perfil: Perfil.ADMIN,
        senha: "outra-senha",
      });

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");

    const usuarioSemAlteracao = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioSemAlteracao?.email).toBe(usuario.email);
    expect(usuarioSemAlteracao?.perfil).toBe(Perfil.COMUM);
    expect(usuarioSemAlteracao?.senha).toBe(usuario.senha);
  });

  it("não permite que outro usuário use o token de confirmação", async () => {
    const usuarioSolicitante = await criarUsuarioTeste();
    const outroUsuario = await criarUsuarioTeste(Perfil.ADMIN);
    await solicitarAlteracao(
      usuarioSolicitante.id,
      usuarioSolicitante.versaoToken,
      `${prefixoTeste}propriedade_${randomUUID()}@teste.com`
    );

    const resposta = await confirmarEmailAtual(outroUsuario, tokensEnviados.atual);

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("TOKEN_INVALIDO");
    expect(tokensEnviados.novo).toBeUndefined();
  });

  it("rejeita token inválido e token de confirmação do e-mail atual no endpoint do novo endereço", async () => {
    const usuario = await criarUsuarioTeste();
    await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}finalidade_${randomUUID()}@teste.com`
    );

    const tokenInvalido = await confirmarEmailAtual(
      usuario,
      "a".repeat(64)
    );
    expect(tokenInvalido.status).toBe(400);
    expect(tokenInvalido.body.erro.codigo).toBe("TOKEN_INVALIDO");

    const tokenFinalidadeIncorreta = await confirmarNovoEmail(
      usuario,
      tokensEnviados.atual
    );
    expect(tokenFinalidadeIncorreta.status).toBe(400);
    expect(tokenFinalidadeIncorreta.body.erro.codigo).toBe("TOKEN_INVALIDO");
  });

  it("rejeita token pertencente a uma operação de recuperação de senha", async () => {
    const usuario = await criarUsuarioTeste();
    const tokenRecuperacao = randomUUID().replaceAll("-", "").repeat(2);
    await prisma.tokenRecuperacaoSenha.create({
      data: {
        idUsuario: usuario.id,
        tokenHash: gerarHashToken(tokenRecuperacao),
        expiraEm: new Date(Date.now() + 60_000),
      },
    });

    const resposta = await request(app)
      .post("/autenticacao/confirmar-email-atual")
      .set("Authorization", `Bearer ${criarTokenAcesso(usuario.id, usuario.versaoToken)}`)
      .send({ token: tokenRecuperacao });

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("TOKEN_INVALIDO");
  });

  it("consome o token do e-mail atual e impede sua reutilização", async () => {
    const usuario = await criarUsuarioTeste();
    await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}uso_unico_${randomUUID()}@teste.com`
    );

    const primeiraConfirmacao = await confirmarEmailAtual(usuario);
    expect(primeiraConfirmacao.status).toBe(200);

    const repeticao = await confirmarEmailAtual(usuario);
    expect(repeticao.status).toBe(400);
    expect(repeticao.body.erro.codigo).toBe("TOKEN_INVALIDO");
  });

  it("rejeita e invalida token expirado", async () => {
    const usuario = await criarUsuarioTeste();
    await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}expirado_${randomUUID()}@teste.com`
    );

    const alteracao = await prisma.alteracaoEmail.findFirst({
      where: {
        idUsuario: usuario.id,
        tokenEmailAtualHash: gerarHashToken(tokensEnviados.atual!),
      },
    });
    await prisma.alteracaoEmail.update({
      where: { id: alteracao!.id },
      data: { expiraEm: new Date(Date.now() - 1_000) },
    });

    const resposta = await confirmarEmailAtual(usuario);
    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("TOKEN_EXPIRADO");
    const alteracaoExpirada = await prisma.alteracaoEmail.findUnique({
      where: { id: alteracao!.id },
    });
    expect(alteracaoExpirada?.invalidadaEm).toBeInstanceOf(Date);
    expect(alteracaoExpirada?.tokenEmailAtualHash).toBeNull();
  });

  it("expira e invalida também o token da confirmação do novo endereço", async () => {
    const usuario = await criarUsuarioTeste();
    await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}novo_expirado_${randomUUID()}@teste.com`
    );
    await confirmarEmailAtual(usuario);

    const alteracao = await prisma.alteracaoEmail.findFirst({
      where: {
        idUsuario: usuario.id,
        tokenEmailNovoHash: gerarHashToken(tokensEnviados.novo!),
      },
    });
    await prisma.alteracaoEmail.update({
      where: { id: alteracao!.id },
      data: { expiraEm: new Date(Date.now() - 1_000) },
    });

    const resposta = await confirmarNovoEmail(usuario);
    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("TOKEN_EXPIRADO");
    const alteracaoExpirada = await prisma.alteracaoEmail.findUnique({
      where: { id: alteracao!.id },
    });
    expect(alteracaoExpirada?.invalidadaEm).toBeInstanceOf(Date);
    expect(alteracaoExpirada?.tokenEmailNovoHash).toBeNull();
  });

  it("uma nova solicitação invalida tokens anteriores", async () => {
    const usuario = await criarUsuarioTeste();
    await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}anterior_${randomUUID()}@teste.com`
    );
    const tokenAntigo = tokensEnviados.atual!;

    const alteracaoAntiga = await prisma.alteracaoEmail.findFirst({
      where: {
        idUsuario: usuario.id,
        tokenEmailAtualHash: gerarHashToken(tokenAntigo),
      },
    });
    await prisma.alteracaoEmail.update({
      where: { id: alteracaoAntiga!.id },
      data: { criadoEm: new Date(Date.now() - 61_000) },
    });

    const novoEmail = `${prefixoTeste}posterior_${randomUUID()}@teste.com`;
    const novaSolicitacao = await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      novoEmail
    );
    expect(novaSolicitacao.status).toBe(202);

    const tokenAntigoReutilizado = await confirmarEmailAtual(usuario, tokenAntigo);
    expect(tokenAntigoReutilizado.status).toBe(400);
    expect(tokenAntigoReutilizado.body.erro.codigo).toBe("TOKEN_INVALIDO");

    const registroAntigoAtualizado = await prisma.alteracaoEmail.findUnique({
      where: { id: alteracaoAntiga!.id },
    });
    expect(registroAntigoAtualizado?.invalidadaEm).toBeInstanceOf(Date);
    expect(registroAntigoAtualizado?.tokenEmailAtualHash).toBeNull();
  });

  it("aplica intervalo mínimo entre solicitações sem invalidar o token recém-enviado", async () => {
    const usuario = await criarUsuarioTeste();
    const primeiroEmailNovo = `${prefixoTeste}intervalo_1_${randomUUID()}@teste.com`;
    const segundoEmailNovo = `${prefixoTeste}intervalo_2_${randomUUID()}@teste.com`;

    const primeiraSolicitacao = await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      primeiroEmailNovo
    );
    const primeiroToken = tokensEnviados.atual;

    const solicitacaoRepetida = await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      segundoEmailNovo
    );

    expect(primeiraSolicitacao.status).toBe(202);
    expect(solicitacaoRepetida.status).toBe(202);
    expect(solicitacaoRepetida.body).toEqual(primeiraSolicitacao.body);
    expect(tokensEnviados.atual).toBe(primeiroToken);
    expect(
      await prisma.alteracaoEmail.count({ where: { idUsuario: usuario.id } })
    ).toBe(1);
    const alteracaoAtiva = await prisma.alteracaoEmail.findFirst({
      where: { idUsuario: usuario.id },
    });
    expect(alteracaoAtiva?.emailNovo).toBe(primeiroEmailNovo);
    expect(alteracaoAtiva?.invalidadaEm).toBeNull();
  });

  it("responde de forma neutra e não altera a conta quando o novo endereço já está em uso", async () => {
    const usuario = await criarUsuarioTeste();
    const donoDoEmail = await criarUsuarioTeste(Perfil.ADMIN);
    const solicitacao = await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      donoDoEmail.email
    );
    expect(solicitacao.status).toBe(202);

    const confirmacaoAtual = await confirmarEmailAtual(usuario);
    expect(confirmacaoAtual.status).toBe(409);
    expect(confirmacaoAtual.body.erro.codigo).toBe("ALTERACAO_EMAIL_NAO_CONCLUIDA");
    expect(confirmacaoAtual.body.erro.mensagem).not.toContain(donoDoEmail.email);
    expect(tokensEnviados.novo).toBeUndefined();

    const usuarioSemAlteracao = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioSemAlteracao?.email).toBe(usuario.email);
  });

  it("resolve concorrência entre duas contas sem permitir e-mails duplicados", async () => {
    const primeiroUsuario = await criarUsuarioTeste();
    const segundoUsuario = await criarUsuarioTeste();
    const novoEmail = `${prefixoTeste}concorrente_${randomUUID()}@teste.com`;

    await solicitarAlteracao(
      primeiroUsuario.id,
      primeiroUsuario.versaoToken,
      novoEmail
    );
    const tokenAtualPrimeiro = tokensEnviados.atual!;

    await solicitarAlteracao(
      segundoUsuario.id,
      segundoUsuario.versaoToken,
      novoEmail
    );
    const tokenAtualSegundo = tokensEnviados.atual!;

    const confirmacaoAtualPrimeiro = await confirmarEmailAtual(
      primeiroUsuario,
      tokenAtualPrimeiro
    );
    const tokenNovoPrimeiro = tokensEnviados.novo!;

    const confirmacaoAtualSegundo = await confirmarEmailAtual(
      segundoUsuario,
      tokenAtualSegundo
    );
    const tokenNovoSegundo = tokensEnviados.novo!;

    expect(confirmacaoAtualPrimeiro.status).toBe(200);
    expect(confirmacaoAtualSegundo.status).toBe(200);

    const resultados = await Promise.all([
      confirmarNovoEmail(primeiroUsuario, tokenNovoPrimeiro),
      confirmarNovoEmail(segundoUsuario, tokenNovoSegundo),
    ]);

    expect(resultados.map((resultado) => resultado.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.usuario.count({ where: { email: novoEmail } })
    ).toBe(1);
    const contasOriginais = await prisma.usuario.findMany({
      where: { id: { in: [primeiroUsuario.id, segundoUsuario.id] } },
      select: { id: true, email: true },
    });
    expect(contasOriginais.filter((conta) => conta.email === novoEmail)).toHaveLength(1);
  });

  it("não expõe tokens, hashes ou campos internos nas respostas", async () => {
    const usuario = await criarUsuarioTeste();
    const resposta = await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}privacidade_${randomUUID()}@teste.com`
    );

    expect(resposta.status).toBe(202);
    expect(resposta.body).not.toHaveProperty("token");
    expect(resposta.body).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(resposta.body)).not.toContain(tokensEnviados.atual);
    expect(JSON.stringify(resposta.body)).not.toContain(usuario.senha);
  });

  it("invalida a solicitação quando o envio ao e-mail atual falha", async () => {
    const usuario = await criarUsuarioTeste();
    definirInterceptadorAlteracaoEmailTeste(async () => ({
      sucesso: false,
      status: "FALHA_ENVIO",
      motivo: "ERRO_DISPARO_SMTP",
    }));

    const resposta = await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}falha_envio_${randomUUID()}@teste.com`
    );

    expect(resposta.status).toBe(502);
    expect(resposta.body.erro.codigo).toBe("FALHA_ENVIO_EMAIL");
    const alteracao = await prisma.alteracaoEmail.findFirst({
      where: { idUsuario: usuario.id },
    });
    expect(alteracao?.invalidadaEm).toBeInstanceOf(Date);
    expect(alteracao?.tokenEmailAtualHash).toBeNull();

    const usuarioSemAlteracao = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioSemAlteracao?.email).toBe(usuario.email);
  });

  it("preserva uma solicitação quando o resultado do envio é incerto", async () => {
    const usuario = await criarUsuarioTeste();
    definirInterceptadorAlteracaoEmailTeste(async (parametros) => {
      tokensEnviados[parametros.etapa] = parametros.token;
      return { sucesso: false, status: "INCERTO", motivo: "TIMEOUT" };
    });

    const resposta = await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}envio_incerto_${randomUUID()}@teste.com`
    );

    expect(resposta.status).toBe(502);
    const alteracao = await prisma.alteracaoEmail.findFirst({
      where: { idUsuario: usuario.id },
    });
    expect(alteracao?.invalidadaEm).toBeNull();
    expect(alteracao?.tokenEmailAtualHash).toBe(gerarHashToken(tokensEnviados.atual!));
  });

  it("invalida a solicitação quando falha o envio da confirmação ao novo endereço", async () => {
    const usuario = await criarUsuarioTeste();
    await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}falha_novo_${randomUUID()}@teste.com`
    );
    definirInterceptadorAlteracaoEmailTeste(async () => ({
      sucesso: false,
      status: "FALHA_ENVIO",
      motivo: "ERRO_DISPARO_SMTP",
    }));

    const resposta = await confirmarEmailAtual(usuario);

    expect(resposta.status).toBe(502);
    expect(resposta.body.erro.codigo).toBe("FALHA_ENVIO_EMAIL");
    const alteracao = await prisma.alteracaoEmail.findFirst({
      where: { idUsuario: usuario.id },
    });
    expect(alteracao?.invalidadaEm).toBeInstanceOf(Date);
    expect(alteracao?.tokenEmailNovoHash).toBeNull();
    const usuarioSemAlteracao = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioSemAlteracao?.email).toBe(usuario.email);
  });

  it("envia por transporte SMTP somente para o destinatário e trata confirmação explícita", async () => {
    definirInterceptadorAlteracaoEmailTeste(null);
    definirForcarExecucaoEtherealEmTestes(true);
    const enviarMensagem = vi.fn(async (_opcoes: SendMailOptions) => ({
      messageId: "mailpit-mock-id",
      accepted: ["destino@teste.com"],
      rejected: [],
      response: "250 2.0.0 Ok: queued",
    }));
    const transporte = {
      options: {},
      sendMail: enviarMensagem,
    } as unknown as Transporter;
    definirTransportadorCustomizado(transporte);

    const resultado = await enviarEmailConfirmacaoAlteracaoEmail({
      destinatario: "destino@teste.com",
      nome: "<script>Nome</script>",
      token: "a".repeat(64),
      etapa: "novo",
    });

    expect(resultado.sucesso).toBe(true);
    expect(resultado.status).toBe("ENVIADO");
    expect(enviarMensagem).toHaveBeenCalledOnce();
    const mensagem = enviarMensagem.mock.calls[0]?.[0];
    expect(mensagem?.to).toBe("destino@teste.com");
    expect(mensagem?.text).toContain("a".repeat(64));
    expect(mensagem?.html).not.toContain("<script>");
    expect(mensagem?.html).toContain("&lt;script&gt;");
  });
});
