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
  definirInterceptadorNotificacaoAlteracaoEmailTeste,
  definirTransportadorCustomizado,
  enviarEmailConfirmacaoAlteracaoEmail,
  resetarTransportadorEthereal,
  type ParametrosEnvioConfirmacaoAlteracaoEmail,
} from "../src/utils/email.util.js";
import { gerarHashSenha } from "../src/utils/senha.util.js";
import { gerarHashCodigo } from "../src/utils/codigo.util.js";
import { gerarHashToken } from "../src/utils/token.util.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Alteração segura do próprio e-mail", () => {
  const prefixoTeste = "test_alteracao_email_";
  const senhaTeste = "SenhaAtual@123";
  const notificacoesEnviadas: string[] = [];
  let confirmacoesEnviadas = 0;
  const codigosEnviados: Partial<
    Record<ParametrosEnvioConfirmacaoAlteracaoEmail["etapa"], string>
  > = {};
  const destinatariosCodigos: Partial<
    Record<ParametrosEnvioConfirmacaoAlteracaoEmail["etapa"], string>
  > = {};

  beforeAll(async () => {
    await garantirBancoTestesIsolado();
  });

  beforeEach(() => {
    delete codigosEnviados.atual;
    delete codigosEnviados.novo;
    delete destinatariosCodigos.atual;
    delete destinatariosCodigos.novo;
    notificacoesEnviadas.length = 0;
    confirmacoesEnviadas = 0;
    definirInterceptadorAlteracaoEmailTeste(async (parametros) => {
      confirmacoesEnviadas += 1;
      codigosEnviados[parametros.etapa] = parametros.codigo;
      destinatariosCodigos[parametros.etapa] = parametros.destinatario;
      return { sucesso: true, status: "ENVIADO", mensagemId: "email-teste-id" };
    });
    definirInterceptadorNotificacaoAlteracaoEmailTeste(async (parametros) => {
      notificacoesEnviadas.push(parametros.destinatario);
      return { sucesso: true, status: "ENVIADO", mensagemId: "notificacao-teste-id" };
    });
  });

  afterEach(async () => {
    definirInterceptadorAlteracaoEmailTeste(null);
    definirInterceptadorNotificacaoAlteracaoEmailTeste(null);
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
    senhaHash?: string
  ) {
    return prisma.usuario.create({
      data: {
        nome: "Usuário Alteração E-mail",
        email: `${prefixoTeste}${randomUUID()}@teste.com`,
        senha: senhaHash ?? (await gerarHashSenha(senhaTeste)),
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
    novoEmail: string,
    senhaAtual = senhaTeste
  ) {
    return request(app)
      .post("/autenticacao/solicitar-alteracao-email")
      .set("Authorization", `Bearer ${criarTokenAcesso(idUsuario, versaoToken)}`)
      .send({ novoEmail, senhaAtual });
  }

  async function confirmarEmailAtual(usuario: {
    id: string;
    versaoToken: number;
  }, codigo = codigosEnviados.atual) {
    return request(app)
      .post("/autenticacao/confirmar-email-atual")
      .set("Authorization", `Bearer ${criarTokenAcesso(usuario.id, usuario.versaoToken)}`)
      .send({ codigo });
  }

  async function confirmarNovoEmail(usuario: {
    id: string;
    versaoToken: number;
  }, codigo = codigosEnviados.novo) {
    return request(app)
      .post("/autenticacao/confirmar-novo-email")
      .set("Authorization", `Bearer ${criarTokenAcesso(usuario.id, usuario.versaoToken)}`)
      .send({ codigo });
  }

  async function consultarAlteracaoPendente(usuario: {
    id: string;
    versaoToken: number;
  }) {
    return request(app)
      .get("/autenticacao/eu/alteracao-email")
      .set("Authorization", `Bearer ${criarTokenAcesso(usuario.id, usuario.versaoToken)}`);
  }

  async function reenviarCodigo(usuario: {
    id: string;
    versaoToken: number;
  }) {
    return request(app)
      .post("/autenticacao/eu/alteracao-email/reenviar-codigo")
      .set("Authorization", `Bearer ${criarTokenAcesso(usuario.id, usuario.versaoToken)}`)
      .send({});
  }

  async function cancelarAlteracao(usuario: {
    id: string;
    versaoToken: number;
  }) {
    return request(app)
      .delete("/autenticacao/eu/alteracao-email")
      .set("Authorization", `Bearer ${criarTokenAcesso(usuario.id, usuario.versaoToken)}`);
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
      expect(JSON.stringify(solicitacao.body)).not.toContain(codigosEnviados.atual);

      let usuarioAtual = await prisma.usuario.findUnique({
        where: { id: usuario.id },
      });
      expect(usuarioAtual?.email).toBe(usuario.email);
      expect(usuarioAtual?.perfil).toBe(perfil);
      expect(usuarioAtual?.versaoToken).toBe(usuario.versaoToken);
      expect(
        (await prisma.sessao.findUnique({ where: { id: sessao.id } }))?.status
      ).toBe(StatusSessao.ATIVA);
      expect(codigosEnviados.atual).toMatch(/^\d{6}$/);
      expect(destinatariosCodigos.atual).toBe(usuario.email);
      expect(codigosEnviados.novo).toBeUndefined();

      const confirmacaoAtual = await confirmarEmailAtual(usuario);
      expect(confirmacaoAtual.status).toBe(200);
      expect(confirmacaoAtual.body.mensagem).toBe(
        "Confirmação do novo e-mail enviada."
      );
      expect(codigosEnviados.novo).toMatch(/^\d{6}$/);
      expect(destinatariosCodigos.novo).toBe(novoEmail);

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
        gerarHashCodigo(codigosEnviados.novo!)
      );
      expect(JSON.stringify(confirmacaoAtual.body)).not.toContain(
        codigosEnviados.novo
      );

      const confirmacaoNovo = await confirmarNovoEmail(usuario);
      expect(confirmacaoNovo.status).toBe(200);
      expect(confirmacaoNovo.body.mensagem).toBe(
        "E-mail atualizado com sucesso. Entre novamente para continuar."
      );
      expect(JSON.stringify(confirmacaoNovo.body)).not.toContain(codigosEnviados.novo);
      expect(notificacoesEnviadas.sort()).toEqual(
        [usuario.email, novoEmail].sort()
      );

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
      expect(alteracao?.ipSolicitacao).toBeTruthy();
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
        codigosEnviados.novo
      );
      expect(repeticaoNovoToken.status).toBe(400);
      expect(repeticaoNovoToken.body.erro.codigo).toBe("CODIGO_INVALIDO");
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
      novoEmail,
      senhaOriginal
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

  it("rejeita solicitação quando a senha atual está incorreta", async () => {
    const usuario = await criarUsuarioTeste();
    const resposta = await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}senha_incorreta_${randomUUID()}@teste.com`,
      "SenhaIncorreta@123"
    );

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("SENHA_ATUAL_INVALIDA");
    expect(
      await prisma.alteracaoEmail.count({ where: { idUsuario: usuario.id } })
    ).toBe(0);
    expect(codigosEnviados.atual).toBeUndefined();
  });

  it("armazena somente HMAC e inicia dez minutos independentes em cada etapa", async () => {
    const usuario = await criarUsuarioTeste();
    await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}validade_${randomUUID()}@teste.com`
    );

    const primeiraEtapa = await prisma.alteracaoEmail.findFirst({
      where: { idUsuario: usuario.id },
    });
    expect(codigosEnviados.atual).toMatch(/^\d{6}$/);
    expect(primeiraEtapa?.tokenEmailAtualHash).toBe(
      gerarHashCodigo(codigosEnviados.atual!)
    );
    expect(primeiraEtapa?.tokenEmailAtualHash).not.toContain(
      codigosEnviados.atual
    );
    expect(
      primeiraEtapa!.expiraEm.getTime() -
        primeiraEtapa!.codigoEnviadoEm!.getTime()
    ).toBe(10 * 60 * 1000);

    expect((await confirmarEmailAtual(usuario)).status).toBe(200);
    const segundaEtapa = await prisma.alteracaoEmail.findFirst({
      where: { idUsuario: usuario.id },
    });
    expect(codigosEnviados.novo).toMatch(/^\d{6}$/);
    expect(segundaEtapa?.tokenEmailAtualHash).toBeNull();
    expect(segundaEtapa?.tokenEmailNovoHash).toBe(
      gerarHashCodigo(codigosEnviados.novo!)
    );
    expect(segundaEtapa?.tentativasCodigo).toBe(0);
    expect(segundaEtapa?.reenviosCodigo).toBe(0);
    expect(
      segundaEtapa!.expiraEm.getTime() -
        segundaEtapa!.codigoEnviadoEm!.getTime()
    ).toBe(10 * 60 * 1000);
  });

  it("reenvia um código novo após o cooldown e invalida o código anterior", async () => {
    const usuario = await criarUsuarioTeste();
    await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}reenvio_${randomUUID()}@teste.com`
    );
    const codigoAnterior = codigosEnviados.atual!;

    const cedoDemais = await reenviarCodigo(usuario);
    expect(cedoDemais.status).toBe(429);
    expect(cedoDemais.body.erro.codigo).toBe("REENVIO_CODIGO_AGUARDE");

    await prisma.alteracaoEmail.updateMany({
      where: { idUsuario: usuario.id },
      data: { codigoEnviadoEm: new Date(Date.now() - 61_000) },
    });
    const reenvio = await reenviarCodigo(usuario);
    const codigoNovo = codigosEnviados.atual!;
    expect(reenvio.status).toBe(200);
    expect(codigoNovo).toMatch(/^\d{6}$/);
    expect(codigoNovo).not.toBe(codigoAnterior);
    expect(destinatariosCodigos.atual).toBe(usuario.email);

    const alteracao = await prisma.alteracaoEmail.findFirst({
      where: { idUsuario: usuario.id },
    });
    expect(alteracao?.tokenEmailAtualHash).toBe(gerarHashCodigo(codigoNovo));
    expect(alteracao?.reenviosCodigo).toBe(1);
    expect(alteracao?.tentativasCodigo).toBe(0);
    expect(
      alteracao!.expiraEm.getTime() - alteracao!.codigoEnviadoEm!.getTime()
    ).toBe(10 * 60 * 1000);

    const codigoSubstituido = await confirmarEmailAtual(usuario, codigoAnterior);
    expect(codigoSubstituido.status).toBe(400);
    expect(codigoSubstituido.body.erro.codigo).toBe("CODIGO_INVALIDO");
    expect((await confirmarEmailAtual(usuario, codigoNovo)).status).toBe(200);
  });

  it("limita a cinco tentativas e exige reenvio para continuar", async () => {
    const usuario = await criarUsuarioTeste();
    await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}tentativas_${randomUUID()}@teste.com`
    );

    for (let tentativa = 1; tentativa <= 5; tentativa += 1) {
      const resposta = await confirmarEmailAtual(usuario, "000000");
      expect(resposta.status).toBe(tentativa === 5 ? 429 : 400);
      expect(resposta.body.erro.codigo).toBe(
        tentativa === 5 ? "LIMITE_TENTATIVAS_CODIGO" : "CODIGO_INVALIDO"
      );
    }

    let alteracao = await prisma.alteracaoEmail.findFirst({
      where: { idUsuario: usuario.id },
    });
    expect(alteracao?.tentativasCodigo).toBe(5);
    expect(alteracao?.tokenEmailAtualHash).toBeNull();

    await prisma.alteracaoEmail.update({
      where: { id: alteracao!.id },
      data: { codigoEnviadoEm: new Date(Date.now() - 61_000) },
    });
    expect((await reenviarCodigo(usuario)).status).toBe(200);
    alteracao = await prisma.alteracaoEmail.findUnique({
      where: { id: alteracao!.id },
    });
    expect(alteracao?.tentativasCodigo).toBe(0);
    expect(alteracao?.reenviosCodigo).toBe(1);
    expect(alteracao?.tokenEmailAtualHash).toBe(
      gerarHashCodigo(codigosEnviados.atual!)
    );
  });

  it("limita reenvios a três por etapa e reinicia a cota na segunda etapa", async () => {
    const usuario = await criarUsuarioTeste();
    await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}limite_reenvios_${randomUUID()}@teste.com`
    );
    const alteracaoInicial = await prisma.alteracaoEmail.findFirst({
      where: { idUsuario: usuario.id },
    });

    for (let reenvio = 1; reenvio <= 3; reenvio += 1) {
      await prisma.alteracaoEmail.update({
        where: { id: alteracaoInicial!.id },
        data: { codigoEnviadoEm: new Date(Date.now() - 61_000) },
      });
      expect((await reenviarCodigo(usuario)).status).toBe(200);
    }

    await prisma.alteracaoEmail.update({
      where: { id: alteracaoInicial!.id },
      data: { codigoEnviadoEm: new Date(Date.now() - 61_000) },
    });
    const excesso = await reenviarCodigo(usuario);
    expect(excesso.status).toBe(429);
    expect(excesso.body.erro.codigo).toBe("LIMITE_REENVIO_CODIGO");

    expect((await confirmarEmailAtual(usuario)).status).toBe(200);
    const segundaEtapa = await prisma.alteracaoEmail.findUnique({
      where: { id: alteracaoInicial!.id },
    });
    expect(segundaEtapa?.reenviosCodigo).toBe(0);
    await prisma.alteracaoEmail.update({
      where: { id: alteracaoInicial!.id },
      data: { codigoEnviadoEm: new Date(Date.now() - 61_000) },
    });
    expect((await reenviarCodigo(usuario)).status).toBe(200);
    expect(destinatariosCodigos.novo).toBe(segundaEtapa?.emailNovo);
    const segundaEtapaAtualizada = await prisma.alteracaoEmail.findUnique({
      where: { id: alteracaoInicial!.id },
    });
    expect(segundaEtapaAtualizada?.reenviosCodigo).toBe(1);
  });

  it("aceita o mesmo HMAC em solicitações diferentes sem procurar globalmente pelo código", async () => {
    const primeiroUsuario = await criarUsuarioTeste();
    const segundoUsuario = await criarUsuarioTeste();
    await solicitarAlteracao(
      primeiroUsuario.id,
      primeiroUsuario.versaoToken,
      `${prefixoTeste}otp_igual_a_${randomUUID()}@teste.com`
    );
    await solicitarAlteracao(
      segundoUsuario.id,
      segundoUsuario.versaoToken,
      `${prefixoTeste}otp_igual_b_${randomUUID()}@teste.com`
    );

    await prisma.alteracaoEmail.updateMany({
      where: { idUsuario: { in: [primeiroUsuario.id, segundoUsuario.id] } },
      data: { tokenEmailAtualHash: gerarHashCodigo("123456") },
    });

    expect(
      (await confirmarEmailAtual(primeiroUsuario, "123456")).status
    ).toBe(200);
    expect(
      (await confirmarEmailAtual(segundoUsuario, "123456")).status
    ).toBe(200);
  });

  it("serializa confirmações simultâneas e conclui a alteração uma única vez", async () => {
    const usuario = await criarUsuarioTeste();
    await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}confirmacao_simultanea_${randomUUID()}@teste.com`
    );

    const confirmacoesAtuais = await Promise.all([
      confirmarEmailAtual(usuario),
      confirmarEmailAtual(usuario),
    ]);
    expect(confirmacoesAtuais.map((resposta) => resposta.status).sort()).toEqual([
      200,
      400,
    ]);
    expect(confirmacoesEnviadas).toBe(2);

    const codigoNovo = codigosEnviados.novo!;
    const confirmacoesNovas = await Promise.all([
      confirmarNovoEmail(usuario, codigoNovo),
      confirmarNovoEmail(usuario, codigoNovo),
    ]);
    expect(confirmacoesNovas.map((resposta) => resposta.status).sort()).toEqual([
      200,
      400,
    ]);
    expect(notificacoesEnviadas).toHaveLength(2);
  });

  it("serializa reenvios simultâneos para respeitar o cooldown", async () => {
    const usuario = await criarUsuarioTeste();
    await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}reenvio_simultaneo_${randomUUID()}@teste.com`
    );
    const alteracao = await prisma.alteracaoEmail.findFirst({
      where: { idUsuario: usuario.id },
    });
    await prisma.alteracaoEmail.update({
      where: { id: alteracao!.id },
      data: { codigoEnviadoEm: new Date(Date.now() - 61_000) },
    });

    const respostas = await Promise.all([
      reenviarCodigo(usuario),
      reenviarCodigo(usuario),
    ]);
    expect(respostas.map((resposta) => resposta.status).sort()).toEqual([
      200,
      429,
    ]);
    expect(confirmacoesEnviadas).toBe(2);
    expect(
      (await prisma.alteracaoEmail.findUnique({ where: { id: alteracao!.id } }))
        ?.reenviosCodigo
    ).toBe(1);
  });

  it("exige autenticação para consultar ou cancelar uma solicitação", async () => {
    const consulta = await request(app).get("/autenticacao/eu/alteracao-email");
    const cancelamento = await request(app).delete(
      "/autenticacao/eu/alteracao-email"
    );
    const reenvio = await request(app)
      .post("/autenticacao/eu/alteracao-email/reenviar-codigo")
      .send({});

    expect(consulta.status).toBe(401);
    expect(consulta.body.erro.codigo).toBe("NAO_AUTENTICADO");
    expect(cancelamento.status).toBe(401);
    expect(cancelamento.body.erro.codigo).toBe("NAO_AUTENTICADO");
    expect(reenvio.status).toBe(401);
    expect(reenvio.body.erro.codigo).toBe("NAO_AUTENTICADO");
  });

  it("consulta apenas dados de interface e reflete a etapa atual da confirmação", async () => {
    const usuario = await criarUsuarioTeste();
    const novoEmail = `${prefixoTeste}consulta_${randomUUID()}@teste.com`;

    const consultaVazia = await consultarAlteracaoPendente(usuario);
    expect(consultaVazia.status).toBe(200);
    expect(consultaVazia.body).toEqual({ solicitacaoPendente: null });

    await solicitarAlteracao(usuario.id, usuario.versaoToken, novoEmail);
    const consultaEmailAtual = await consultarAlteracaoPendente(usuario);
    expect(consultaEmailAtual.status).toBe(200);
    expect(consultaEmailAtual.body.solicitacaoPendente).toEqual({
      novoEmail,
      etapa: "CONFIRMAR_EMAIL_ATUAL",
      expiraEm: expect.any(String),
      solicitadaEm: expect.any(String),
      codigoEnviadoEm: expect.any(String),
      reenvioDisponivelEm: expect.any(String),
      reenviosRestantes: 3,
    });
    expect(JSON.stringify(consultaEmailAtual.body)).not.toContain(codigosEnviados.atual);
    expect(JSON.stringify(consultaEmailAtual.body)).not.toContain("tokenEmailAtualHash");

    expect((await confirmarEmailAtual(usuario)).status).toBe(200);
    const consultaNovoEmail = await consultarAlteracaoPendente(usuario);
    expect(consultaNovoEmail.body.solicitacaoPendente).toMatchObject({
      novoEmail,
      etapa: "CONFIRMAR_NOVO_EMAIL",
    });
    expect(JSON.stringify(consultaNovoEmail.body)).not.toContain(codigosEnviados.novo);
  });

  it("cancela uma solicitação e invalida o token pendente do novo endereço", async () => {
    const usuario = await criarUsuarioTeste();
    await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}cancelamento_${randomUUID()}@teste.com`
    );
    expect((await confirmarEmailAtual(usuario)).status).toBe(200);
    const codigoNovo = codigosEnviados.novo!;

    const cancelamento = await cancelarAlteracao(usuario);
    expect(cancelamento.status).toBe(200);
    expect(cancelamento.body.mensagem).toBe(
      "Solicitação de alteração de e-mail cancelada com sucesso."
    );

    const alteracao = await prisma.alteracaoEmail.findFirst({
      where: { idUsuario: usuario.id },
    });
    expect(alteracao?.invalidadaEm).toBeInstanceOf(Date);
    expect(alteracao?.tokenEmailAtualHash).toBeNull();
    expect(alteracao?.tokenEmailNovoHash).toBeNull();

    const tokenCancelado = await confirmarNovoEmail(usuario, codigoNovo);
    expect(tokenCancelado.status).toBe(400);
    expect(tokenCancelado.body.erro.codigo).toBe("CODIGO_INVALIDO");
    expect((await consultarAlteracaoPendente(usuario)).body).toEqual({
      solicitacaoPendente: null,
    });
  });

  it("serializa solicitações simultâneas do mesmo usuário", async () => {
    const usuario = await criarUsuarioTeste();
    const [primeira, segunda] = await Promise.all([
      solicitarAlteracao(
        usuario.id,
        usuario.versaoToken,
        `${prefixoTeste}simultanea_a_${randomUUID()}@teste.com`
      ),
      solicitarAlteracao(
        usuario.id,
        usuario.versaoToken,
        `${prefixoTeste}simultanea_b_${randomUUID()}@teste.com`
      ),
    ]);

    expect([primeira.status, segunda.status]).toEqual([202, 202]);
    expect(
      await prisma.alteracaoEmail.count({ where: { idUsuario: usuario.id } })
    ).toBe(1);
    expect(confirmacoesEnviadas).toBe(1);
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
      .send({ novoEmail: "novo@teste.com", senhaAtual: senhaTeste });

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("NAO_AUTENTICADO");
  });

  it.each([
    [
      "/autenticacao/solicitar-alteracao-email",
      { novoEmail: "novo@teste.com", senhaAtual: senhaTeste },
    ],
    ["/autenticacao/confirmar-email-atual", { codigo: "123456" }],
    ["/autenticacao/confirmar-novo-email", { codigo: "123456" }],
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
        .send({ novoEmail: "novo@teste.com", senhaAtual: senhaTeste });

      expect(respostaSemOrigemConfigurada.status).toBe(403);
      expect(respostaSemOrigemConfigurada.body.erro.codigo).toBe(
        "ORIGEM_NAO_CONFIGURADA"
      );

      (ambiente as Record<string, unknown>).FRONTEND_ORIGIN =
        "https://app.sonessia.example";
      const respostaOrigemConfigurada = await request(app)
        .post("/autenticacao/solicitar-alteracao-email")
        .set("Origin", "https://app.sonessia.example")
        .send({ novoEmail: "novo@teste.com", senhaAtual: senhaTeste });

      expect(respostaOrigemConfigurada.status).toBe(401);
      expect(respostaOrigemConfigurada.body.erro.codigo).toBe("NAO_AUTENTICADO");
    } finally {
      (ambiente as Record<string, unknown>).NODE_ENV = nodeEnvOriginal;
      (ambiente as Record<string, unknown>).FRONTEND_ORIGIN = origemOriginal;
    }
  });

  it.each([
    ["ausente", {}],
    ["inválido", { senhaAtual: senhaTeste, novoEmail: "email-invalido" }],
    [
      "protegido",
      { senhaAtual: senhaTeste, novoEmail: "novo@teste.com", idUsuario: randomUUID() },
    ],
  ])("rejeita corpo %s ao solicitar alteração", async (_caso, corpo) => {
    const usuario = await criarUsuarioTeste();
    const resposta = await request(app)
      .post("/autenticacao/solicitar-alteracao-email")
      .set("Authorization", `Bearer ${criarTokenAcesso(usuario.id, usuario.versaoToken)}`)
      .send(corpo);

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");
    expect(codigosEnviados.atual).toBeUndefined();
  });

  it("não altera o e-mail antes das duas confirmações e não aceita mass assignment", async () => {
    const usuario = await criarUsuarioTeste();
    const resposta = await request(app)
      .post("/autenticacao/solicitar-alteracao-email")
      .set("Authorization", `Bearer ${criarTokenAcesso(usuario.id, usuario.versaoToken)}`)
      .send({
        novoEmail: `${prefixoTeste}mass_${randomUUID()}@teste.com`,
        senhaAtual: senhaTeste,
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

    const resposta = await confirmarEmailAtual(outroUsuario, codigosEnviados.atual);

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("CODIGO_INVALIDO");
    expect(codigosEnviados.novo).toBeUndefined();
  });

  it("rejeita código inválido e código da etapa atual no endpoint do novo endereço", async () => {
    const usuario = await criarUsuarioTeste();
    await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}finalidade_${randomUUID()}@teste.com`
    );

    const codigoInvalido = await confirmarEmailAtual(usuario, "000000");
    expect(codigoInvalido.status).toBe(400);
    expect(codigoInvalido.body.erro.codigo).toBe("CODIGO_INVALIDO");

    const codigoEtapaIncorreta = await confirmarNovoEmail(
      usuario,
      codigosEnviados.atual
    );
    expect(codigoEtapaIncorreta.status).toBe(400);
    expect(codigoEtapaIncorreta.body.erro.codigo).toBe("CODIGO_INVALIDO");
  });

  it("rejeita um código sem solicitação de alteração mesmo quando há token de recuperação", async () => {
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
      .send({ codigo: "123456" });

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("CODIGO_INVALIDO");
  });

  it("consome o código do e-mail atual e impede sua reutilização", async () => {
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
    expect(repeticao.body.erro.codigo).toBe("CODIGO_INVALIDO");
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
        tokenEmailAtualHash: gerarHashCodigo(codigosEnviados.atual!),
      },
    });
    await prisma.alteracaoEmail.update({
      where: { id: alteracao!.id },
      data: { expiraEm: new Date(Date.now() - 1_000) },
    });

    const resposta = await confirmarEmailAtual(usuario);
    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("CODIGO_EXPIRADO");
    const alteracaoExpirada = await prisma.alteracaoEmail.findUnique({
      where: { id: alteracao!.id },
    });
    expect(alteracaoExpirada?.invalidadaEm).toBeNull();
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
        tokenEmailNovoHash: gerarHashCodigo(codigosEnviados.novo!),
      },
    });
    await prisma.alteracaoEmail.update({
      where: { id: alteracao!.id },
      data: { expiraEm: new Date(Date.now() - 1_000) },
    });

    const resposta = await confirmarNovoEmail(usuario);
    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("CODIGO_EXPIRADO");
    const alteracaoExpirada = await prisma.alteracaoEmail.findUnique({
      where: { id: alteracao!.id },
    });
    expect(alteracaoExpirada?.invalidadaEm).toBeNull();
    expect(alteracaoExpirada?.tokenEmailNovoHash).toBeNull();
  });

  it("uma nova solicitação invalida tokens anteriores", async () => {
    const usuario = await criarUsuarioTeste();
    await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      `${prefixoTeste}anterior_${randomUUID()}@teste.com`
    );
    const codigoAntigo = codigosEnviados.atual!;

    const alteracaoAntiga = await prisma.alteracaoEmail.findFirst({
      where: {
        idUsuario: usuario.id,
        tokenEmailAtualHash: gerarHashCodigo(codigoAntigo),
      },
    });
    await prisma.alteracaoEmail.update({
      where: { id: alteracaoAntiga!.id },
      data: { codigoEnviadoEm: new Date(Date.now() - 61_000) },
    });

    const novoEmail = `${prefixoTeste}posterior_${randomUUID()}@teste.com`;
    const novaSolicitacao = await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      novoEmail
    );
    expect(novaSolicitacao.status).toBe(202);

    const tokenAntigoReutilizado = await confirmarEmailAtual(usuario, codigoAntigo);
    expect(tokenAntigoReutilizado.status).toBe(400);
    expect(tokenAntigoReutilizado.body.erro.codigo).toBe("CODIGO_INVALIDO");

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
    const primeiroToken = codigosEnviados.atual;

    const solicitacaoRepetida = await solicitarAlteracao(
      usuario.id,
      usuario.versaoToken,
      segundoEmailNovo
    );

    expect(primeiraSolicitacao.status).toBe(202);
    expect(solicitacaoRepetida.status).toBe(202);
    expect(solicitacaoRepetida.body).toEqual(primeiraSolicitacao.body);
    expect(codigosEnviados.atual).toBe(primeiroToken);
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
    expect(codigosEnviados.novo).toBeUndefined();

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
    const tokenAtualPrimeiro = codigosEnviados.atual!;

    await solicitarAlteracao(
      segundoUsuario.id,
      segundoUsuario.versaoToken,
      novoEmail
    );
    const tokenAtualSegundo = codigosEnviados.atual!;

    const confirmacaoAtualPrimeiro = await confirmarEmailAtual(
      primeiroUsuario,
      tokenAtualPrimeiro
    );
    const tokenNovoPrimeiro = codigosEnviados.novo!;

    const confirmacaoAtualSegundo = await confirmarEmailAtual(
      segundoUsuario,
      tokenAtualSegundo
    );
    const tokenNovoSegundo = codigosEnviados.novo!;

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
    expect(JSON.stringify(resposta.body)).not.toContain(codigosEnviados.atual);
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
      codigosEnviados[parametros.etapa] = parametros.codigo;
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
    expect(alteracao?.tokenEmailAtualHash).toBe(
      gerarHashCodigo(codigosEnviados.atual!)
    );
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
    const provedorOriginal = ambiente.EMAIL_PROVIDER;
    (ambiente as Record<string, unknown>).EMAIL_PROVIDER = "ethereal";
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

    try {
      const resultado = await enviarEmailConfirmacaoAlteracaoEmail({
        destinatario: "destino@teste.com",
        nome: "<script>Nome</script>",
        codigo: "123456",
        etapa: "novo",
      });

      expect(resultado.sucesso).toBe(true);
      expect(resultado.status).toBe("ENVIADO");
      expect(enviarMensagem).toHaveBeenCalledOnce();
      const mensagem = enviarMensagem.mock.calls[0]?.[0];
      expect(mensagem?.to).toBe("destino@teste.com");
      expect(mensagem?.text).toContain("123456");
      expect(mensagem?.text).toContain("10 minutos");
      expect(mensagem?.text).not.toContain("http");
      expect(mensagem?.html).toContain("123456");
      expect(mensagem?.html).toContain("10 minutos");
      expect(mensagem?.html).not.toContain("<a");
      expect(mensagem?.html).not.toContain("<script>");
      expect(mensagem?.html).toContain("&lt;script&gt;");
    } finally {
      (ambiente as Record<string, unknown>).EMAIL_PROVIDER = provedorOriginal;
    }
  });
});
