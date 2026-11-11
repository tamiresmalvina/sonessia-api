import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { CategoriaAudio, Finalidade, Perfil } from "../generated/prisma/enums.js";
import { emitirTokenAcesso } from "../src/utils/jwt.util.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Gerenciamento de Coleções Sonoras (US06)", () => {
  const prefixoTeste = "test_col_";

  beforeAll(async () => {
    await garantirBancoTestesIsolado();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const usuarios = await prisma.usuario.findMany({
      where: { email: { startsWith: prefixoTeste } },
      select: { id: true },
    });
    const idsUsuarios = usuarios.map((u) => u.id);

    if (idsUsuarios.length > 0) {
      const colecoes = await prisma.colecao.findMany({
        where: { idUsuario: { in: idsUsuarios } },
        select: { idColecao: true },
      });
      const idsColecoes = colecoes.map((c) => c.idColecao);

      const ambientes = await prisma.ambienteSonoro.findMany({
        where: { idUsuario: { in: idsUsuarios } },
        select: { idAmbienteSonoro: true },
      });
      const idsAmbientes = ambientes.map((a) => a.idAmbienteSonoro);

      if (idsColecoes.length > 0 || idsAmbientes.length > 0) {
        await prisma.colecaoAmbienteSonoro.deleteMany({
          where: {
            OR: [
              ...(idsColecoes.length > 0 ? [{ idColecao: { in: idsColecoes } }] : []),
              ...(idsAmbientes.length > 0 ? [{ idAmbienteSonoro: { in: idsAmbientes } }] : []),
            ],
          },
        });
      }

      if (idsColecoes.length > 0) {
        await prisma.colecao.deleteMany({
          where: { idColecao: { in: idsColecoes } },
        });
      }

      if (idsAmbientes.length > 0) {
        await prisma.ambienteSonoroAudio.deleteMany({
          where: { idAmbienteSonoro: { in: idsAmbientes } },
        });
        await prisma.ambienteSonoro.deleteMany({
          where: { idAmbienteSonoro: { in: idsAmbientes } },
        });
      }

      await prisma.ambienteSonoroAudio.deleteMany({
        where: { audio: { idUsuario: { in: idsUsuarios } } },
      });
      await prisma.audio.deleteMany({
        where: { idUsuario: { in: idsUsuarios } },
      });
      await prisma.usuario.deleteMany({
        where: { id: { in: idsUsuarios } },
      });
    }
  });

  async function criarUsuario(perfil: Perfil = Perfil.COMUM) {
    return prisma.usuario.create({
      data: {
        nome: "Usuário Teste Coleção",
        email: `${prefixoTeste}${randomUUID()}@teste.com`,
        senha: "hash-de-teste-colecao",
        dataNascimento: new Date("1994-04-14T00:00:00.000Z"),
        perfil,
        emailVerificado: true,
      },
    });
  }

  function token(usuario: { id: string; versaoToken: number }) {
    return emitirTokenAcesso({ sub: usuario.id, versaoToken: usuario.versaoToken });
  }

  async function criarAudio(idUsuario: string, titulo: string) {
    return prisma.audio.create({
      data: {
        idUsuario,
        titulo,
        tituloOriginal: `${titulo} Original`,
        categoria: CategoriaAudio.NATUREZA,
        descricao: `Descrição de ${titulo}`,
        arquivo: `https://res.cloudinary.com/cloud-falso/video/upload/sonessia/audios/${randomUUID()}.mp3`,
        arquivoPublicId: `sonessia/audios/${randomUUID()}`,
        fonte: "Domínio público",
        licenca: "CC0",
      },
    });
  }

  async function criarAmbientePersonalizado(idUsuario: string, nome: string) {
    const audio = await criarAudio(idUsuario, `Audio de ${nome}`);
    const ambiente = await prisma.ambienteSonoro.create({
      data: {
        idUsuario,
        nome,
        descricao: `Descrição de ${nome}`,
        finalidade: Finalidade.ESTUDO,
        origem: "personalizado",
        publicado: false,
      },
    });
    await prisma.ambienteSonoroAudio.create({
      data: {
        idAmbienteSonoro: ambiente.idAmbienteSonoro,
        idAudio: audio.idAudio,
        volume: 75,
      },
    });
    return ambiente;
  }

  async function criarAmbientePreConfigurado(idAdmin: string, nome: string) {
    const audio = await criarAudio(idAdmin, `Audio Admin ${nome}`);
    const ambiente = await prisma.ambienteSonoro.create({
      data: {
        idUsuario: idAdmin,
        nome,
        descricao: `Descrição de ${nome}`,
        finalidade: Finalidade.CONCENTRACAO,
        origem: "preconfigurado",
        publicado: true,
      },
    });
    await prisma.ambienteSonoroAudio.create({
      data: {
        idAmbienteSonoro: ambiente.idAmbienteSonoro,
        idAudio: audio.idAudio,
        volume: 60,
      },
    });
    return ambiente;
  }

  /* ========================================================================= */
  /* 1. AUTENTICAÇÃO E RBAC                                                    */
  /* ========================================================================= */
  describe("Autenticação e controle de perfis (RBAC)", () => {
    it("bloqueia operações sem autenticação com HTTP 401", async () => {
      const idInexistente = randomUUID();

      const criacao = await request(app).post("/colecoes").send({ nome: "Estudos" });
      const listagem = await request(app).get("/colecoes");
      const consulta = await request(app).get(`/colecoes/${idInexistente}`);
      const edicao = await request(app).patch(`/colecoes/${idInexistente}`).send({ nome: "Novo" });
      const exclusao = await request(app).delete(`/colecoes/${idInexistente}`);
      const associacao = await request(app)
        .post(`/colecoes/${idInexistente}/ambientes`)
        .send({ idAmbienteSonoro: idInexistente });
      const desassociacao = await request(app).delete(
        `/colecoes/${idInexistente}/ambientes/${idInexistente}`
      );

      expect(criacao.status).toBe(401);
      expect(listagem.status).toBe(401);
      expect(consulta.status).toBe(401);
      expect(edicao.status).toBe(401);
      expect(exclusao.status).toBe(401);
      expect(associacao.status).toBe(401);
      expect(desassociacao.status).toBe(401);
    });

    it("bloqueia usuários com perfil ADMIN de criar e gerenciar coleções com HTTP 403", async () => {
      const admin = await criarUsuario(Perfil.ADMIN);
      const tokenAdmin = token(admin);
      const idInexistente = randomUUID();

      const criacao = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .send({ nome: "Coleção Admin" });

      const listagem = await request(app)
        .get("/colecoes")
        .set("Authorization", `Bearer ${tokenAdmin}`);

      const consulta = await request(app)
        .get(`/colecoes/${idInexistente}`)
        .set("Authorization", `Bearer ${tokenAdmin}`);

      const edicao = await request(app)
        .patch(`/colecoes/${idInexistente}`)
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .send({ nome: "Nova" });

      const exclusao = await request(app)
        .delete(`/colecoes/${idInexistente}`)
        .set("Authorization", `Bearer ${tokenAdmin}`);

      expect(criacao.status).toBe(403);
      expect(criacao.body.erro.codigo).toBe("ACESSO_NEGADO");
      expect(listagem.status).toBe(403);
      expect(consulta.status).toBe(403);
      expect(edicao.status).toBe(403);
      expect(exclusao.status).toBe(403);
    });
  });

  /* ========================================================================= */
  /* 2. CRUD DE COLEÇÕES                                                       */
  /* ========================================================================= */
  describe("Criação, consulta, edição e exclusão de coleções", () => {
    it("permite criar coleção vazia com apenas o nome", async () => {
      const usuario = await criarUsuario(Perfil.COMUM);

      const resposta = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Coleção Matinal",
        });

      expect(resposta.status).toBe(201);
      expect(resposta.body.mensagem).toBe("Coleção criada com sucesso.");
      expect(resposta.body.colecao).toMatchObject({
        nome: "Coleção Matinal",
        descricao: null,
        quantidadeAmbientes: 0,
        ambientes: [],
      });
      expect(resposta.body.colecao.idColecao).toBeDefined();
      expect(resposta.body.colecao).not.toHaveProperty("idUsuario");
    });

    it("permite criar coleção com nome e descrição", async () => {
      const usuario = await criarUsuario(Perfil.COMUM);

      const resposta = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Coleção Noite",
          descricao: "Sons relaxantes para antes de dormir",
        });

      expect(resposta.status).toBe(201);
      expect(resposta.body.colecao.nome).toBe("Coleção Noite");
      expect(resposta.body.colecao.descricao).toBe("Sons relaxantes para antes de dormir");
      expect(resposta.body.colecao.quantidadeAmbientes).toBe(0);
    });

    it("valida dados obrigatórios e limites na criação da coleção", async () => {
      const usuario = await criarUsuario(Perfil.COMUM);

      // Nome vazio
      const semNome = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "   ",
        });
      expect(semNome.status).toBe(400);
      expect(semNome.body.erro.codigo).toBe("DADOS_INVALIDOS");

      // Nome muito longo (> 255)
      const nomeLongo = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "a".repeat(256),
        });
      expect(nomeLongo.status).toBe(400);

      // Descrição muito longa (> 1000)
      const descLonga = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Válido",
          descricao: "d".repeat(1001),
        });
      expect(descLonga.status).toBe(400);

      // Campo adicional não permitido (strict)
      const campoExtra = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Válido",
          idUsuario: randomUUID(),
        });
      expect(campoExtra.status).toBe(400);
    });

    it("lista as coleções do usuário ordenadas por nome", async () => {
      const usuario = await criarUsuario(Perfil.COMUM);
      const tokenUser = token(usuario);

      await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ nome: "Zeta" });

      await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ nome: "Alfa" });

      const listagem = await request(app)
        .get("/colecoes")
        .set("Authorization", `Bearer ${tokenUser}`);

      expect(listagem.status).toBe(200);
      expect(listagem.body.colecoes).toHaveLength(2);
      expect(listagem.body.colecoes[0].nome).toBe("Alfa");
      expect(listagem.body.colecoes[1].nome).toBe("Zeta");
      expect(listagem.body.colecoes[0]).not.toHaveProperty("idUsuario");
    });

    it("consulta detalhes de uma coleção por ID com ambientes associados", async () => {
      const usuario = await criarUsuario(Perfil.COMUM);
      const tokenUser = token(usuario);

      const criacao = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ nome: "Trabalho Intenso", descricao: "Foco profundo" });

      const idColecao = criacao.body.colecao.idColecao;

      const ambiente = await criarAmbientePersonalizado(usuario.id, "Chuva e Trovões");

      await request(app)
        .post(`/colecoes/${idColecao}/ambientes`)
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ idAmbienteSonoro: ambiente.idAmbienteSonoro });

      const consulta = await request(app)
        .get(`/colecoes/${idColecao}`)
        .set("Authorization", `Bearer ${tokenUser}`);

      expect(consulta.status).toBe(200);
      expect(consulta.body.colecao.idColecao).toBe(idColecao);
      expect(consulta.body.colecao.nome).toBe("Trabalho Intenso");
      expect(consulta.body.colecao.quantidadeAmbientes).toBe(1);
      expect(consulta.body.colecao.ambientes[0].idAmbienteSonoro).toBe(ambiente.idAmbienteSonoro);
      expect(consulta.body.colecao.ambientes[0].nome).toBe("Chuva e Trovões");
      expect(consulta.body.colecao.ambientes[0].audios[0].volume).toBe(75);
      expect(consulta.body.colecao).not.toHaveProperty("idUsuario");
    });

    it("retorna HTTP 404 ao consultar coleção inexistente ou com UUID inválido", async () => {
      const usuario = await criarUsuario(Perfil.COMUM);
      const tokenUser = token(usuario);

      const inexistente = await request(app)
        .get(`/colecoes/${randomUUID()}`)
        .set("Authorization", `Bearer ${tokenUser}`);
      expect(inexistente.status).toBe(404);
      expect(inexistente.body.erro.codigo).toBe("COLECAO_NAO_ENCONTRADA");

      const uuidInvalido = await request(app)
        .get("/colecoes/id-invalido")
        .set("Authorization", `Bearer ${tokenUser}`);
      expect(uuidInvalido.status).toBe(400);
      expect(uuidInvalido.body.erro.codigo).toBe("ID_COLECAO_INVALIDO");
    });

    it("atualiza nome e descrição da coleção", async () => {
      const usuario = await criarUsuario(Perfil.COMUM);
      const tokenUser = token(usuario);

      const criacao = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ nome: "Nome Antigo", descricao: "Desc Antiga" });

      const idColecao = criacao.body.colecao.idColecao;

      const atualizacao = await request(app)
        .patch(`/colecoes/${idColecao}`)
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({
          nome: "Nome Atualizado",
          descricao: "Nova Descrição",
        });

      expect(atualizacao.status).toBe(200);
      expect(atualizacao.body.mensagem).toBe("Coleção atualizada com sucesso.");
      expect(atualizacao.body.colecao.nome).toBe("Nome Atualizado");
      expect(atualizacao.body.colecao.descricao).toBe("Nova Descrição");

      // Permite limpar a descrição passando null
      const limparDesc = await request(app)
        .put(`/colecoes/${idColecao}`)
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({
          descricao: null,
        });

      expect(limparDesc.status).toBe(200);
      expect(limparDesc.body.colecao.descricao).toBeNull();
      expect(limparDesc.body.colecao.nome).toBe("Nome Atualizado");
    });

    it("exclui uma coleção com sucesso e confirma que não pode mais ser consultada", async () => {
      const usuario = await criarUsuario(Perfil.COMUM);
      const tokenUser = token(usuario);

      const criacao = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ nome: "Coleção para Deletar" });

      const idColecao = criacao.body.colecao.idColecao;

      const exclusao = await request(app)
        .delete(`/colecoes/${idColecao}`)
        .set("Authorization", `Bearer ${tokenUser}`);

      expect(exclusao.status).toBe(200);
      expect(exclusao.body.mensagem).toBe("Coleção excluída com sucesso.");

      const consulta = await request(app)
        .get(`/colecoes/${idColecao}`)
        .set("Authorization", `Bearer ${tokenUser}`);

      expect(consulta.status).toBe(404);
    });
  });

  /* ========================================================================= */
  /* 3. ISOLAMENTO RIGOROSO ENTRE USUÁRIOS                                     */
  /* ========================================================================= */
  describe("Isolamento entre usuários", () => {
    it("impede que usuário B visualize, edite ou exclua coleção do usuário A", async () => {
      const usuarioA = await criarUsuario(Perfil.COMUM);
      const usuarioB = await criarUsuario(Perfil.COMUM);

      const colecaoA = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${token(usuarioA)}`)
        .send({ nome: "Coleção Privada de A" });

      const idColecaoA = colecaoA.body.colecao.idColecao;

      // Usuário B tenta listar coleções: não deve ver a de A
      const listagemB = await request(app)
        .get("/colecoes")
        .set("Authorization", `Bearer ${token(usuarioB)}`);
      expect(listagemB.status).toBe(200);
      expect(listagemB.body.colecoes).toHaveLength(0);

      // Usuário B tenta consultar diretamente coleção de A: deve receber 404
      const consultaB = await request(app)
        .get(`/colecoes/${idColecaoA}`)
        .set("Authorization", `Bearer ${token(usuarioB)}`);
      expect(consultaB.status).toBe(404);
      expect(consultaB.body.erro.codigo).toBe("COLECAO_NAO_ENCONTRADA");

      // Usuário B tenta editar coleção de A: deve receber 404
      const edicaoB = await request(app)
        .patch(`/colecoes/${idColecaoA}`)
        .set("Authorization", `Bearer ${token(usuarioB)}`)
        .send({ nome: "Tentativa Hacker" });
      expect(edicaoB.status).toBe(404);

      // Usuário B tenta excluir coleção de A: deve receber 404
      const exclusaoB = await request(app)
        .delete(`/colecoes/${idColecaoA}`)
        .set("Authorization", `Bearer ${token(usuarioB)}`);
      expect(exclusaoB.status).toBe(404);

      // Confirma que a coleção de A continua intacta
      const consultaA = await request(app)
        .get(`/colecoes/${idColecaoA}`)
        .set("Authorization", `Bearer ${token(usuarioA)}`);
      expect(consultaA.status).toBe(200);
      expect(consultaA.body.colecao.nome).toBe("Coleção Privada de A");
    });
  });

  /* ========================================================================= */
  /* 4. ASSOCIAÇÃO E REMOÇÃO DE AMBIENTES EM COLEÇÕES                          */
  /* ========================================================================= */
  describe("Associação e desassociação de ambientes sonoros", () => {
    it("permite associar ambiente sonoro personalizado pertencente ao usuário", async () => {
      const usuario = await criarUsuario(Perfil.COMUM);
      const tokenUser = token(usuario);

      const ambiente = await criarAmbientePersonalizado(usuario.id, "Ambiente Meu");

      const colecao = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ nome: "Minha Coleção" });

      const idColecao = colecao.body.colecao.idColecao;

      const associacao = await request(app)
        .post(`/colecoes/${idColecao}/ambientes`)
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ idAmbienteSonoro: ambiente.idAmbienteSonoro });

      expect(associacao.status).toBe(201);
      expect(associacao.body.mensagem).toBe("Ambiente sonoro adicionado à coleção com sucesso.");
      expect(associacao.body.colecao.quantidadeAmbientes).toBe(1);
      expect(associacao.body.colecao.ambientes[0].idAmbienteSonoro).toBe(ambiente.idAmbienteSonoro);
    });

    it("permite que o mesmo ambiente pertença a múltiplas coleções do mesmo usuário", async () => {
      const usuario = await criarUsuario(Perfil.COMUM);
      const tokenUser = token(usuario);

      const ambiente = await criarAmbientePersonalizado(usuario.id, "Ambiente Compartilhado");

      const col1 = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ nome: "Coleção 1" });

      const col2 = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ nome: "Coleção 2" });

      const idCol1 = col1.body.colecao.idColecao;
      const idCol2 = col2.body.colecao.idColecao;

      // Adiciona na coleção 1
      const assoc1 = await request(app)
        .post(`/colecoes/${idCol1}/ambientes`)
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ idAmbienteSonoro: ambiente.idAmbienteSonoro });
      expect(assoc1.status).toBe(201);

      // Adiciona na coleção 2
      const assoc2 = await request(app)
        .post(`/colecoes/${idCol2}/ambientes`)
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ idAmbienteSonoro: ambiente.idAmbienteSonoro });
      expect(assoc2.status).toBe(201);

      // Verifica ambas
      const get1 = await request(app)
        .get(`/colecoes/${idCol1}`)
        .set("Authorization", `Bearer ${tokenUser}`);
      const get2 = await request(app)
        .get(`/colecoes/${idCol2}`)
        .set("Authorization", `Bearer ${tokenUser}`);

      expect(get1.body.colecao.quantidadeAmbientes).toBe(1);
      expect(get2.body.colecao.quantidadeAmbientes).toBe(1);
    });

    it("rejeita adicionar o mesmo ambiente duplicado na mesma coleção com HTTP 409", async () => {
      const usuario = await criarUsuario(Perfil.COMUM);
      const tokenUser = token(usuario);

      const ambiente = await criarAmbientePersonalizado(usuario.id, "Ambiente Único");

      const colecao = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ nome: "Coleção Sem Duplicatas" });

      const idColecao = colecao.body.colecao.idColecao;

      // Primeira adição: sucesso
      await request(app)
        .post(`/colecoes/${idColecao}/ambientes`)
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ idAmbienteSonoro: ambiente.idAmbienteSonoro });

      // Segunda adição: conflito 409
      const duplicada = await request(app)
        .post(`/colecoes/${idColecao}/ambientes`)
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ idAmbienteSonoro: ambiente.idAmbienteSonoro });

      expect(duplicada.status).toBe(409);
      expect(duplicada.body.erro.codigo).toBe("AMBIENTE_JA_NA_COLECAO");
    });

    it("bloqueia adicionar ambiente pré-configurado/público à coleção com HTTP 400", async () => {
      const admin = await criarUsuario(Perfil.ADMIN);
      const usuario = await criarUsuario(Perfil.COMUM);
      const tokenUser = token(usuario);

      const ambientePublico = await criarAmbientePreConfigurado(admin.id, "Ambiente Zen Público");

      const colecao = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ nome: "Coleção Tentativa" });

      const idColecao = colecao.body.colecao.idColecao;

      const resposta = await request(app)
        .post(`/colecoes/${idColecao}/ambientes`)
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ idAmbienteSonoro: ambientePublico.idAmbienteSonoro });

      expect(resposta.status).toBe(400);
      expect(resposta.body.erro.codigo).toBe("AMBIENTE_PRECONFIGURADO_NAO_PERMITIDO");
    });

    it("bloqueia adicionar ambiente de outro usuário à coleção com HTTP 404", async () => {
      const usuarioA = await criarUsuario(Perfil.COMUM);
      const usuarioB = await criarUsuario(Perfil.COMUM);

      const ambienteA = await criarAmbientePersonalizado(usuarioA.id, "Ambiente de A");

      const colecaoB = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${token(usuarioB)}`)
        .send({ nome: "Coleção de B" });

      const idColecaoB = colecaoB.body.colecao.idColecao;

      const resposta = await request(app)
        .post(`/colecoes/${idColecaoB}/ambientes`)
        .set("Authorization", `Bearer ${token(usuarioB)}`)
        .send({ idAmbienteSonoro: ambienteA.idAmbienteSonoro });

      expect(resposta.status).toBe(404);
      expect(resposta.body.erro.codigo).toBe("AMBIENTE_NAO_ENCONTRADO");
    });

    it("remove ambiente da coleção com sucesso e preserva o ambiente sonoro no catálogo", async () => {
      const usuario = await criarUsuario(Perfil.COMUM);
      const tokenUser = token(usuario);

      const ambiente = await criarAmbientePersonalizado(usuario.id, "Ambiente Preservado");

      const colecao = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ nome: "Coleção para Desassociar" });

      const idColecao = colecao.body.colecao.idColecao;

      // Adiciona
      await request(app)
        .post(`/colecoes/${idColecao}/ambientes`)
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ idAmbienteSonoro: ambiente.idAmbienteSonoro });

      // Remove da coleção
      const remocao = await request(app)
        .delete(`/colecoes/${idColecao}/ambientes/${ambiente.idAmbienteSonoro}`)
        .set("Authorization", `Bearer ${tokenUser}`);

      expect(remocao.status).toBe(200);
      expect(remocao.body.mensagem).toBe("Ambiente sonoro removido da coleção com sucesso.");

      // Confirma que a coleção agora está vazia
      const getColecao = await request(app)
        .get(`/colecoes/${idColecao}`)
        .set("Authorization", `Bearer ${tokenUser}`);
      expect(getColecao.body.colecao.quantidadeAmbientes).toBe(0);

      // IMPORTANTE: Confirma que o ambiente sonoro continua existindo no catálogo do usuário
      const getAmbiente = await request(app)
        .get(`/ambientes-sonoros/${ambiente.idAmbienteSonoro}`)
        .set("Authorization", `Bearer ${tokenUser}`);

      expect(getAmbiente.status).toBe(200);
      expect(getAmbiente.body.ambiente.idAmbienteSonoro).toBe(ambiente.idAmbienteSonoro);
    });

    it("retorna HTTP 404 ao tentar remover ambiente que não pertence à coleção", async () => {
      const usuario = await criarUsuario(Perfil.COMUM);
      const tokenUser = token(usuario);

      const ambiente = await criarAmbientePersonalizado(usuario.id, "Ambiente Fora");

      const colecao = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ nome: "Coleção Sem Ele" });

      const idColecao = colecao.body.colecao.idColecao;

      const remocao = await request(app)
        .delete(`/colecoes/${idColecao}/ambientes/${ambiente.idAmbienteSonoro}`)
        .set("Authorization", `Bearer ${tokenUser}`);

      expect(remocao.status).toBe(404);
      expect(remocao.body.erro.codigo).toBe("AMBIENTE_NAO_ENCONTRADO_NA_COLECAO");
    });

    it("exclusão de coleção preserva todos os ambientes sonoros associados intactos", async () => {
      const usuario = await criarUsuario(Perfil.COMUM);
      const tokenUser = token(usuario);

      const amb1 = await criarAmbientePersonalizado(usuario.id, "Ambiente 1");
      const amb2 = await criarAmbientePersonalizado(usuario.id, "Ambiente 2");

      const colecao = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ nome: "Coleção Deletável" });

      const idColecao = colecao.body.colecao.idColecao;

      await request(app)
        .post(`/colecoes/${idColecao}/ambientes`)
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ idAmbienteSonoro: amb1.idAmbienteSonoro });

      await request(app)
        .post(`/colecoes/${idColecao}/ambientes`)
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ idAmbienteSonoro: amb2.idAmbienteSonoro });

      // Exclui a coleção
      const exclusao = await request(app)
        .delete(`/colecoes/${idColecao}`)
        .set("Authorization", `Bearer ${tokenUser}`);

      expect(exclusao.status).toBe(200);

      // Confirma que ambos os ambientes continuam acessíveis no catálogo pessoal do usuário
      const getAmb1 = await request(app)
        .get(`/ambientes-sonoros/${amb1.idAmbienteSonoro}`)
        .set("Authorization", `Bearer ${tokenUser}`);
      const getAmb2 = await request(app)
        .get(`/ambientes-sonoros/${amb2.idAmbienteSonoro}`)
        .set("Authorization", `Bearer ${tokenUser}`);

      expect(getAmb1.status).toBe(200);
      expect(getAmb2.status).toBe(200);
    });
  });

  /* ========================================================================= */
  /* 5. LISTAGEM GERAL E FILTRO ?semColecao=true                               */
  /* ========================================================================= */
  describe("Listagem de ambientes e filtro semColecao=true", () => {
    it("inclui as coleções associadas na listagem geral e suporta filtro ?semColecao=true", async () => {
      const usuario = await criarUsuario(Perfil.COMUM);
      const tokenUser = token(usuario);

      const ambAvulso = await criarAmbientePersonalizado(usuario.id, "Ambiente Avulso");
      const ambEmColecao = await criarAmbientePersonalizado(usuario.id, "Ambiente Em Coleção");

      const colecao = await request(app)
        .post("/colecoes")
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ nome: "Coleção A" });

      const idColecao = colecao.body.colecao.idColecao;

      // Associa apenas ambEmColecao
      await request(app)
        .post(`/colecoes/${idColecao}/ambientes`)
        .set("Authorization", `Bearer ${tokenUser}`)
        .send({ idAmbienteSonoro: ambEmColecao.idAmbienteSonoro });

      // 1. Listagem geral (GET /ambientes-sonoros) deve trazer AMBOS
      const listagemGeral = await request(app)
        .get("/ambientes-sonoros")
        .set("Authorization", `Bearer ${tokenUser}`);

      expect(listagemGeral.status).toBe(200);
      expect(listagemGeral.body.ambientes).toHaveLength(2);

      const itemColecao = listagemGeral.body.ambientes.find(
        (a: any) => a.idAmbienteSonoro === ambEmColecao.idAmbienteSonoro
      );
      const itemAvulso = listagemGeral.body.ambientes.find(
        (a: any) => a.idAmbienteSonoro === ambAvulso.idAmbienteSonoro
      );

      expect(itemColecao.colecoes).toHaveLength(1);
      expect(itemColecao.colecoes[0].idColecao).toBe(idColecao);
      expect(itemColecao.colecoes[0].nome).toBe("Coleção A");

      expect(itemAvulso.colecoes).toHaveLength(0);

      // 2. Listagem com ?semColecao=true deve trazer SOMENTE o ambiente avulso
      const listagemSemColecao = await request(app)
        .get("/ambientes-sonoros?semColecao=true")
        .set("Authorization", `Bearer ${tokenUser}`);

      expect(listagemSemColecao.status).toBe(200);
      expect(listagemSemColecao.body.ambientes).toHaveLength(1);
      expect(listagemSemColecao.body.ambientes[0].idAmbienteSonoro).toBe(
        ambAvulso.idAmbienteSonoro
      );
    });
  });
});

