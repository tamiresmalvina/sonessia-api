import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { prisma } from "../lib/prisma.js";
import { CategoriaAudio, Finalidade, Perfil, StatusSessao } from "../generated/prisma/enums.js";
import { app } from "../src/app.js";
import {
  cloudinary,
  inicializarCloudinary,
  resetarConfiguracaoCloudinaryParaTestes,
} from "../src/config/cloudinary.js";
import {
  processarContasExpiradas,
  reativarConta,
  solicitarExclusaoConta,
} from "../src/services/exclusao-conta.service.js";
import { emitirTokenAcesso } from "../src/utils/jwt.util.js";
import { gerarHashSenha } from "../src/utils/senha.util.js";
import { gerarHashToken } from "../src/utils/token.util.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Exclusão e reativação de conta", () => {
  const prefixoTeste = `test_exclusao_${randomUUID()}_`;
  const idsUsuariosCriados: string[] = [];
  const senha = "SenhaDeTeste@123";
  let hashSenha: string;

  beforeAll(async () => {
    await garantirBancoTestesIsolado();
    hashSenha = await gerarHashSenha(senha);
  });

  beforeEach(() => {
    inicializarCloudinary({
      cloud_name: "cloud-falso-testes",
      api_key: "chave-falsa-testes",
      api_secret: "segredo-falso-testes",
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetarConfiguracaoCloudinaryParaTestes();

    if (!idsUsuariosCriados.length) {
      return;
    }

    await prisma.$transaction(async (tx) => {
      const [colecoes, ambientes, audios] = await Promise.all([
        tx.colecao.findMany({
          where: { idUsuario: { in: idsUsuariosCriados } },
          select: { idColecao: true },
        }),
        tx.ambienteSonoro.findMany({
          where: { idUsuario: { in: idsUsuariosCriados } },
          select: { idAmbienteSonoro: true },
        }),
        tx.audio.findMany({
          where: { idUsuario: { in: idsUsuariosCriados } },
          select: { idAudio: true },
        }),
      ]);
      const idsColecoes = colecoes.map(({ idColecao }) => idColecao);
      const idsAmbientes = ambientes.map(({ idAmbienteSonoro }) => idAmbienteSonoro);
      const idsAudios = audios.map(({ idAudio }) => idAudio);

      const filtrosColecao = [];
      if (idsColecoes.length) {
        filtrosColecao.push({ idColecao: { in: idsColecoes } });
      }
      if (idsAmbientes.length) {
        filtrosColecao.push({ idAmbienteSonoro: { in: idsAmbientes } });
      }
      if (filtrosColecao.length) {
        await tx.colecaoAmbienteSonoro.deleteMany({
          where: { OR: filtrosColecao },
        });
      }

      const filtrosAudio = [];
      if (idsAmbientes.length) {
        filtrosAudio.push({ idAmbienteSonoro: { in: idsAmbientes } });
      }
      if (idsAudios.length) {
        filtrosAudio.push({ idAudio: { in: idsAudios } });
      }
      if (filtrosAudio.length) {
        await tx.ambienteSonoroAudio.deleteMany({
          where: { OR: filtrosAudio },
        });
      }

      await tx.colecao.deleteMany({
        where: { idUsuario: { in: idsUsuariosCriados } },
      });
      await tx.ambienteSonoro.deleteMany({
        where: { idUsuario: { in: idsUsuariosCriados } },
      });
      await tx.audio.deleteMany({
        where: { idUsuario: { in: idsUsuariosCriados } },
      });
      await tx.usuario.deleteMany({
        where: { id: { in: idsUsuariosCriados } },
      });
    });
    idsUsuariosCriados.length = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function criarUsuario(
    perfil: Perfil = Perfil.COMUM,
    fotoPerfilPublicId: string | null = null
  ) {
    const usuario = await prisma.usuario.create({
      data: {
        nome: "Conta de teste",
        email: `${prefixoTeste}${randomUUID()}@teste.com`,
        senha: hashSenha,
        dataNascimento: new Date("1990-01-01T00:00:00.000Z"),
        perfil,
        emailVerificado: true,
        fotoPerfilPublicId,
      },
    });
    idsUsuariosCriados.push(usuario.id);
    return usuario;
  }

  function criarToken(idUsuario: string, versaoToken: number): string {
    return emitirTokenAcesso({ sub: idUsuario, versaoToken });
  }

  function mockRemocaoCloudinary(
    estado: "deleted" | "not found" = "deleted"
  ) {
    return vi
      .spyOn(cloudinary.api, "delete_resources")
      .mockImplementation(async (ids) => ({
        deleted: Object.fromEntries(ids.map((id) => [id, estado])),
      }));
  }

  async function solicitarExclusao(idUsuario: string, versaoToken: number) {
    return request(app)
      .delete("/autenticacao/eu")
      .set("Authorization", `Bearer ${criarToken(idUsuario, versaoToken)}`)
      .send({ senhaAtual: senha, confirmacao: "EXCLUIR_CONTA" });
  }

  async function criarAmbiente(idUsuario: string, nome: string) {
    return prisma.ambienteSonoro.create({
      data: {
        idUsuario,
        nome,
        descricao: null,
        finalidade: Finalidade.RELAXAMENTO,
        origem: "personalizado",
      },
    });
  }

  async function criarAudio(idUsuario: string, nome: string) {
    return prisma.audio.create({
      data: {
        idUsuario,
        nome,
        descricao: null,
        categoria: CategoriaAudio.NATUREZA,
        arquivo: "referencia-nao-gerenciada-pelo-projeto",
        titulo: nome,
        tituloOriginal: nome,
        fonte: "teste",
        licenca: "teste",
      },
    });
  }

  it("solicita a exclusão de COMUM, exige senha/confirmação e invalida as sessões", async () => {
    const usuario = await criarUsuario();
    const tokenAcesso = criarToken(usuario.id, usuario.versaoToken);
    const refreshToken = randomUUID().replaceAll("-", "").repeat(2);
    await prisma.sessao.create({
      data: {
        idUsuario: usuario.id,
        tokenHash: gerarHashToken(refreshToken),
        status: StatusSessao.ATIVA,
        expiraEm: new Date(Date.now() + 60_000),
      },
    });

    const resposta = await solicitarExclusao(usuario.id, usuario.versaoToken);
    const atualizado = await prisma.usuario.findUnique({
      where: { id: usuario.id },
      include: { sessoes: true },
    });

    expect(resposta.status).toBe(202);
    expect(resposta.body.exclusaoDefinitivaEm).toBe(
      atualizado?.exclusaoDefinitivaEm?.toISOString()
    );
    expect(
      atualizado!.exclusaoDefinitivaEm!.getTime() -
        atualizado!.exclusaoSolicitadaEm!.getTime()
    ).toBe(30 * 24 * 60 * 60 * 1000);
    expect(atualizado?.versaoToken).toBe(usuario.versaoToken + 1);
    expect(atualizado?.sessoes[0]?.status).toBe(StatusSessao.REVOGADA);

    const acessoComTokenAntigo = await request(app)
      .get("/autenticacao/eu")
      .set("Authorization", `Bearer ${tokenAcesso}`);
    expect(acessoComTokenAntigo.status).toBe(403);
    expect(acessoComTokenAntigo.body.erro.codigo).toBe(
      "CONTA_EXCLUSAO_PENDENTE"
    );
  });

  it("rejeita conta ADMIN, senha incorreta, confirmação incorreta e ausência de autenticação", async () => {
    const administrador = await criarUsuario(Perfil.ADMIN);
    const comum = await criarUsuario();

    const adminResponse = await solicitarExclusao(
      administrador.id,
      administrador.versaoToken
    );
    const senhaIncorreta = await request(app)
      .delete("/autenticacao/eu")
      .set(
        "Authorization",
        `Bearer ${criarToken(comum.id, comum.versaoToken)}`
      )
      .send({ senhaAtual: "SenhaErrada@123", confirmacao: "EXCLUIR_CONTA" });
    const confirmacaoIncorreta = await request(app)
      .delete("/autenticacao/eu")
      .set(
        "Authorization",
        `Bearer ${criarToken(comum.id, comum.versaoToken)}`
      )
      .send({ senhaAtual: senha, confirmacao: "excluir" });
    const semAutenticacao = await request(app)
      .delete("/autenticacao/eu")
      .send({ senhaAtual: senha, confirmacao: "EXCLUIR_CONTA" });

    expect(adminResponse.status).toBe(403);
    expect(adminResponse.body.erro.codigo).toBe(
      "EXCLUSAO_ADMIN_NAO_PERMITIDA"
    );
    expect(senhaIncorreta.status).toBe(401);
    expect(senhaIncorreta.body.erro.codigo).toBe("SENHA_ATUAL_INVALIDA");
    expect(confirmacaoIncorreta.status).toBe(400);
    expect(semAutenticacao.status).toBe(401);

    const [adminSemAlteracao, comumSemAlteracao] = await Promise.all([
      prisma.usuario.findUnique({ where: { id: administrador.id } }),
      prisma.usuario.findUnique({ where: { id: comum.id } }),
    ]);
    expect(adminSemAlteracao?.exclusaoDefinitivaEm).toBeNull();
    expect(comumSemAlteracao?.exclusaoDefinitivaEm).toBeNull();
  });

  it("reativa com credenciais válidas antes do prazo e exige novo login", async () => {
    const usuario = await criarUsuario();
    const tokenAntigo = criarToken(usuario.id, usuario.versaoToken);
    const pedido = await solicitarExclusao(usuario.id, usuario.versaoToken);
    expect(pedido.status).toBe(202);

    const reativacao = await request(app)
      .post("/autenticacao/reativar-conta")
      .send({ email: usuario.email, senha });
    expect(reativacao.status).toBe(200);

    const login = await request(app)
      .post("/autenticacao/login")
      .send({ email: usuario.email, senha });
    const acessoAntigo = await request(app)
      .get("/autenticacao/eu")
      .set("Authorization", `Bearer ${tokenAntigo}`);
    const atualizado = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });

    expect(login.status).toBe(200);
    expect(acessoAntigo.status).toBe(401);
    expect(atualizado?.exclusaoSolicitadaEm).toBeNull();
    expect(atualizado?.exclusaoDefinitivaEm).toBeNull();
    expect(atualizado?.versaoToken).toBe(usuario.versaoToken + 2);
  });

  it("não reativa a conta quando o prazo de 30 dias já expirou", async () => {
    const usuario = await criarUsuario();
    const solicitadaEm = new Date("2026-01-01T12:00:00.000Z");
    const resultado = await solicitarExclusaoConta(
      usuario.id,
      { senhaAtual: senha, confirmacao: "EXCLUIR_CONTA" },
      solicitadaEm
    );
    const resposta = await request(app)
      .post("/autenticacao/reativar-conta")
      .send({ email: usuario.email, senha });
    const expirouExatamenteEm = await reativarConta(
      { email: usuario.email, senha },
      resultado.exclusaoDefinitivaEm
    );

    expect(resposta.status).toBe(200);
    expect(expirouExatamenteEm.mensagem).toBe(resposta.body.mensagem);
    expect(
      (
        await prisma.usuario.findUnique({
          where: { id: usuario.id },
        })
      )?.exclusaoDefinitivaEm
    ).toEqual(resultado.exclusaoDefinitivaEm);
  });

  it("não distingue conta ausente de senha incorreta no fluxo de reativação", async () => {
    const usuario = await criarUsuario();
    await solicitarExclusao(usuario.id, usuario.versaoToken);

    const senhaIncorreta = await request(app)
      .post("/autenticacao/reativar-conta")
      .send({ email: usuario.email, senha: "SenhaErrada@123" });
    const contaAusente = await request(app)
      .post("/autenticacao/reativar-conta")
      .send({ email: `${prefixoTeste}ausente@teste.com`, senha });

    expect(senhaIncorreta.status).toBe(200);
    expect(contaAusente.status).toBe(200);
    expect(senhaIncorreta.body).toEqual(contaAusente.body);
  });

  it("bloqueia login, renovação e recuperação enquanto a conta está pendente", async () => {
    const usuario = await criarUsuario();
    const refreshToken = randomUUID().replaceAll("-", "").repeat(2);
    await prisma.sessao.create({
      data: {
        idUsuario: usuario.id,
        tokenHash: gerarHashToken(refreshToken),
        status: StatusSessao.ATIVA,
        expiraEm: new Date(Date.now() + 60_000),
      },
    });
    await solicitarExclusao(usuario.id, usuario.versaoToken);

    const login = await request(app)
      .post("/autenticacao/login")
      .send({ email: usuario.email, senha });
    const renovacao = await request(app)
      .post("/autenticacao/renovar-sessao")
      .set("Cookie", `refreshToken=${refreshToken}`);
    const recuperacao = await request(app)
      .post("/autenticacao/recuperar-senha")
      .send({ email: usuario.email });

    expect(login.status).toBe(403);
    expect(login.body.erro.codigo).toBe("CONTA_EXCLUSAO_PENDENTE");
    expect(renovacao.status).toBe(401);
    expect(recuperacao.status).toBe(200);
    expect(recuperacao.body.mensagem).toContain(
      "Se o e-mail informado estiver cadastrado"
    );
    expect(
      await prisma.tokenRecuperacaoSenha.count({
        where: { idUsuario: usuario.id, usado: false },
      })
    ).toBe(0);
  });

  it("purga dados próprios e associações sem remover recursos de ADMIN ou terceiros", async () => {
    const usuario = await criarUsuario(Perfil.COMUM, "sonessia/perfis/foto-exclusao");
    const terceiro = await criarUsuario();
    const administrador = await criarUsuario(Perfil.ADMIN);
    const colecaoPropria = await prisma.colecao.create({
      data: { idUsuario: usuario.id, nome: "Coleção própria" },
    });
    const colecaoTerceiro = await prisma.colecao.create({
      data: { idUsuario: terceiro.id, nome: "Coleção de terceiro" },
    });
    const ambienteProprio = await criarAmbiente(usuario.id, "Ambiente próprio");
    const ambienteAdmin = await criarAmbiente(
      administrador.id,
      "Ambiente público do admin"
    );
    const audioProprio = await criarAudio(usuario.id, "Áudio próprio");
    const audioAdmin = await criarAudio(administrador.id, "Áudio do admin");

    await prisma.colecaoAmbienteSonoro.createMany({
      data: [
        {
          idColecao: colecaoPropria.idColecao,
          idAmbienteSonoro: ambienteProprio.idAmbienteSonoro,
        },
        {
          idColecao: colecaoPropria.idColecao,
          idAmbienteSonoro: ambienteAdmin.idAmbienteSonoro,
        },
        {
          idColecao: colecaoTerceiro.idColecao,
          idAmbienteSonoro: ambienteProprio.idAmbienteSonoro,
        },
      ],
    });
    await prisma.ambienteSonoroAudio.createMany({
      data: [
        {
          idAmbienteSonoro: ambienteProprio.idAmbienteSonoro,
          idAudio: audioAdmin.idAudio,
          volume: 50,
        },
        {
          idAmbienteSonoro: ambienteAdmin.idAmbienteSonoro,
          idAudio: audioProprio.idAudio,
          volume: 50,
        },
        {
          idAmbienteSonoro: ambienteAdmin.idAmbienteSonoro,
          idAudio: audioAdmin.idAudio,
          volume: 50,
        },
      ],
    });
    const token = criarToken(usuario.id, usuario.versaoToken);
    await solicitarExclusao(usuario.id, usuario.versaoToken);
    const exclusao = await prisma.usuario.findUnique({
      where: { id: usuario.id },
      select: { exclusaoDefinitivaEm: true },
    });
    const remocaoCloudinary = mockRemocaoCloudinary();
    const resultadoPurga = await processarContasExpiradas(
      exclusao!.exclusaoDefinitivaEm!
    );

    expect(resultadoPurga.excluidas).toBe(1);
    expect(remocaoCloudinary).toHaveBeenCalledWith(
      ["sonessia/perfis/foto-exclusao"],
      expect.objectContaining({
        resource_type: "image",
        type: "authenticated",
      })
    );
    expect(await prisma.usuario.findUnique({ where: { id: usuario.id } })).toBeNull();
    expect(await prisma.colecao.findUnique({ where: { idColecao: colecaoPropria.idColecao } })).toBeNull();
    expect(await prisma.ambienteSonoro.findUnique({ where: { idAmbienteSonoro: ambienteProprio.idAmbienteSonoro } })).toBeNull();
    expect(await prisma.audio.findUnique({ where: { idAudio: audioProprio.idAudio } })).toBeNull();
    expect(await prisma.colecao.findUnique({ where: { idColecao: colecaoTerceiro.idColecao } })).not.toBeNull();
    expect(await prisma.ambienteSonoro.findUnique({ where: { idAmbienteSonoro: ambienteAdmin.idAmbienteSonoro } })).not.toBeNull();
    expect(await prisma.audio.findUnique({ where: { idAudio: audioAdmin.idAudio } })).not.toBeNull();
    expect(
      await prisma.colecaoAmbienteSonoro.count({
        where: { idColecao: colecaoTerceiro.idColecao },
      })
    ).toBe(0);
    expect(
      await prisma.ambienteSonoroAudio.count({
        where: { idAmbienteSonoro: ambienteAdmin.idAmbienteSonoro },
      })
    ).toBe(1);
    const tokenAntigoAposPurga = await request(app)
      .get("/autenticacao/eu")
      .set("Authorization", `Bearer ${token}`);
    expect(tokenAntigoAposPurga.status).toBe(401);
  });

  it("repete a purga após falha Cloudinary sem apagar conta ou dados", async () => {
    const usuario = await criarUsuario(Perfil.COMUM, "sonessia/perfis/foto-retry");
    await solicitarExclusao(usuario.id, usuario.versaoToken);
    const exclusao = await prisma.usuario.findUnique({
      where: { id: usuario.id },
      select: { exclusaoDefinitivaEm: true },
    });
    const remocao = vi
      .spyOn(cloudinary.api, "delete_resources")
      .mockRejectedValueOnce(new Error("falha simulada"))
      .mockImplementation(async (ids) => ({
        deleted: Object.fromEntries(ids.map((id) => [id, "deleted"])),
      }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const primeira = await processarContasExpiradas(
      exclusao!.exclusaoDefinitivaEm!
    );
    const aindaPendente = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    const segunda = await processarContasExpiradas(
      exclusao!.exclusaoDefinitivaEm!
    );

    expect(primeira.pendentes).toBe(1);
    expect(aindaPendente?.exclusaoDefinitivaEm).toEqual(
      exclusao!.exclusaoDefinitivaEm
    );
    expect(aindaPendente?.exclusaoProcessamentoToken).toBeNull();
    expect(segunda.excluidas).toBe(1);
    expect(remocao).toHaveBeenCalledTimes(2);
    expect(await prisma.usuario.findUnique({ where: { id: usuario.id } })).toBeNull();
  });

  it("permite retry idempotente se Cloudinary concluir e a transação de banco falhar", async () => {
    const usuario = await criarUsuario(Perfil.COMUM, "sonessia/perfis/foto-db-retry");
    await solicitarExclusao(usuario.id, usuario.versaoToken);
    const exclusao = await prisma.usuario.findUnique({
      where: { id: usuario.id },
      select: { exclusaoDefinitivaEm: true },
    });
    const remocao = vi
      .spyOn(cloudinary.api, "delete_resources")
      .mockImplementation(async (ids) => ({
        deleted: Object.fromEntries(ids.map((id) => [id, "deleted"])),
      }));
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
      new Error("falha de banco simulada")
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const primeira = await processarContasExpiradas(
      exclusao!.exclusaoDefinitivaEm!
    );
    vi.restoreAllMocks();
    inicializarCloudinary({
      cloud_name: "cloud-falso-testes",
      api_key: "chave-falsa-testes",
      api_secret: "segredo-falso-testes",
    });
    const remocaoIdempotente = vi
      .spyOn(cloudinary.api, "delete_resources")
      .mockImplementation(async (ids) => ({
        deleted: Object.fromEntries(ids.map((id) => [id, "not found"])),
      }));
    const segunda = await processarContasExpiradas(
      exclusao!.exclusaoDefinitivaEm!
    );

    expect(primeira.pendentes).toBe(1);
    expect(segunda.excluidas).toBe(1);
    expect(remocao).toHaveBeenCalledOnce();
    expect(remocaoIdempotente).toHaveBeenCalledOnce();
    expect(await prisma.usuario.findUnique({ where: { id: usuario.id } })).toBeNull();
  });

  it("coordena ciclos concorrentes com lease e processa uma conta uma única vez", async () => {
    const usuario = await criarUsuario();
    await solicitarExclusao(usuario.id, usuario.versaoToken);
    const exclusao = await prisma.usuario.findUnique({
      where: { id: usuario.id },
      select: { exclusaoDefinitivaEm: true },
    });
    const instantePurga = exclusao!.exclusaoDefinitivaEm!;

    const [primeiro, segundo] = await Promise.all([
      processarContasExpiradas(instantePurga),
      processarContasExpiradas(instantePurga),
    ]);

    expect(primeiro.excluidas + segundo.excluidas).toBe(1);
    expect(await prisma.usuario.findUnique({ where: { id: usuario.id } })).toBeNull();
  });
});
