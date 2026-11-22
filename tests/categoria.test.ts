import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { Finalidade, Perfil } from "../generated/prisma/enums.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";
import { emitirTokenAcesso } from "../src/utils/jwt.util.js";
import { criarAudio } from "../src/services/audio.service.js";
import { criarAmbienteSonoro } from "../src/services/ambiente-sonoro.service.js";

describe("CRUD administrativo de categorias", () => {
  const prefixoCategoria = "test_categoria_";
  const prefixoUsuario = "test_categoria_user_";

  beforeAll(async () => {
    await garantirBancoTestesIsolado();
  });

  afterEach(async () => {
    const categorias = await prisma.categoria.findMany({
      where: { nome: { startsWith: prefixoCategoria } },
      select: { idCategoria: true },
    });
    const idsCategorias = categorias.map(({ idCategoria }) => idCategoria);
    const usuarios = await prisma.usuario.findMany({
      where: { email: { startsWith: prefixoUsuario } },
      select: { id: true },
    });
    const idsUsuarios = usuarios.map(({ id }) => id);

    if (idsCategorias.length > 0) {
      const ambientes = await prisma.ambienteSonoro.findMany({
        where: { idCategoria: { in: idsCategorias } },
        select: { idAmbienteSonoro: true },
      });
      const idsAmbientes = ambientes.map(({ idAmbienteSonoro }) => idAmbienteSonoro);
      if (idsAmbientes.length > 0) {
        await prisma.colecaoAmbienteSonoro.deleteMany({
          where: { idAmbienteSonoro: { in: idsAmbientes } },
        });
        await prisma.ambienteSonoroAudio.deleteMany({
          where: { idAmbienteSonoro: { in: idsAmbientes } },
        });
        await prisma.ambienteSonoro.deleteMany({
          where: { idAmbienteSonoro: { in: idsAmbientes } },
        });
      }

      await prisma.ambienteSonoroAudio.deleteMany({
        where: { audio: { idCategoria: { in: idsCategorias } } },
      });
      await prisma.audio.deleteMany({ where: { idCategoria: { in: idsCategorias } } });
      await prisma.categoria.deleteMany({ where: { idCategoria: { in: idsCategorias } } });
    }

    if (idsUsuarios.length > 0) {
      await prisma.ambienteSonoroAudio.deleteMany({
        where: { audio: { idUsuario: { in: idsUsuarios } } },
      });
      await prisma.audio.deleteMany({ where: { idUsuario: { in: idsUsuarios } } });
      const ambientes = await prisma.ambienteSonoro.findMany({
        where: { idUsuario: { in: idsUsuarios } },
        select: { idAmbienteSonoro: true },
      });
      const idsAmbientes = ambientes.map(({ idAmbienteSonoro }) => idAmbienteSonoro);
      if (idsAmbientes.length > 0) {
        await prisma.colecaoAmbienteSonoro.deleteMany({
          where: { idAmbienteSonoro: { in: idsAmbientes } },
        });
        await prisma.ambienteSonoroAudio.deleteMany({
          where: { idAmbienteSonoro: { in: idsAmbientes } },
        });
        await prisma.ambienteSonoro.deleteMany({
          where: { idAmbienteSonoro: { in: idsAmbientes } },
        });
      }
      await prisma.usuario.deleteMany({ where: { id: { in: idsUsuarios } } });
    }
  });

  async function criarUsuario(perfil: Perfil) {
    return prisma.usuario.create({
      data: {
        nome: "Usuário de teste de categorias",
        email: `${prefixoUsuario}${randomUUID()}@teste.com`,
        senha: "hash-de-teste",
        dataNascimento: new Date("1990-01-01T00:00:00.000Z"),
        perfil,
        emailVerificado: true,
      },
    });
  }

  function token(usuario: { id: string; versaoToken: number }) {
    return emitirTokenAcesso({ sub: usuario.id, versaoToken: usuario.versaoToken });
  }

  function nomeUnico(rotulo: string) {
    return `${prefixoCategoria}${rotulo}_${randomUUID()}`;
  }

  async function criarCategoria(nome: string, tipo: "AUDIO" | "AMBIENTE", ativa = true) {
    return prisma.categoria.create({ data: { nome, tipo, ativa } });
  }

  async function criarAudioBanco(idUsuario: string, idCategoria: string) {
    return prisma.audio.create({
      data: {
        idUsuario,
        idCategoria,
        titulo: "Áudio de teste",
        tituloOriginal: "Test audio",
        arquivo: "https://example.test/audio.mp3",
        fonte: "Teste",
        licenca: "CC0",
      },
    });
  }

  it("filtra por tipo, publica apenas categorias ativas e permite ADMIN consultar inativas", async () => {
    const admin = await criarUsuario(Perfil.ADMIN);
    const audioAtivo = await criarCategoria(nomeUnico("audio_ativo"), "AUDIO");
    const audioInativo = await criarCategoria(nomeUnico("audio_inativo"), "AUDIO", false);
    const ambienteAtivo = await criarCategoria(nomeUnico("ambiente_ativo"), "AMBIENTE");

    const publicasAudio = await request(app).get("/categorias?tipo=AUDIO");
    const publicasAmbiente = await request(app).get("/categorias?tipo=AMBIENTE");
    const adminComInativas = await request(app)
      .get("/categorias?tipo=AUDIO&incluirInativas=true")
      .set("Authorization", `Bearer ${token(admin)}`);

    expect(publicasAudio.status).toBe(200);
    expect(publicasAudio.body.categorias.map((categoria: { idCategoria: string }) => categoria.idCategoria))
      .toContain(audioAtivo.idCategoria);
    expect(publicasAudio.body.categorias.map((categoria: { idCategoria: string }) => categoria.idCategoria))
      .not.toContain(audioInativo.idCategoria);
    expect(publicasAmbiente.body.categorias.map((categoria: { idCategoria: string }) => categoria.idCategoria))
      .toContain(ambienteAtivo.idCategoria);
    expect(adminComInativas.status).toBe(200);
    expect(adminComInativas.body.categorias.map((categoria: { idCategoria: string }) => categoria.idCategoria))
      .toContain(audioInativo.idCategoria);
  });

  it("cria com nome normalizado, edita nome/status e bloqueia operações administrativas de usuários comuns", async () => {
    const admin = await criarUsuario(Perfil.ADMIN);
    const comum = await criarUsuario(Perfil.COMUM);
    const nome = nomeUnico("crud");
    const criacao = await request(app)
      .post("/categorias")
      .set("Authorization", `Bearer ${token(admin)}`)
      .send({ nome: `  ${nome}  `, tipo: "AUDIO" });

    expect(criacao.status).toBe(201);
    expect(criacao.body.categoria.nome).toBe(nome);
    const idCategoria = criacao.body.categoria.idCategoria;

    const edicao = await request(app)
      .patch(`/categorias/${idCategoria}`)
      .set("Authorization", `Bearer ${token(admin)}`)
      .send({ nome: `  ${nome}_renomeada  `, ativa: false });
    expect(edicao.status).toBe(200);
    expect(edicao.body.categoria.nome).toBe(`${nome}_renomeada`);
    expect(edicao.body.categoria.ativa).toBe(false);

    const ocultada = await request(app).get("/categorias?tipo=AUDIO");
    expect(ocultada.body.categorias.map((categoria: { idCategoria: string }) => categoria.idCategoria))
      .not.toContain(idCategoria);

    const postComum = await request(app)
      .post("/categorias")
      .set("Authorization", `Bearer ${token(comum)}`)
      .send({ nome: nomeUnico("negada"), tipo: "AUDIO" });
    const patchComum = await request(app)
      .patch(`/categorias/${idCategoria}`)
      .set("Authorization", `Bearer ${token(comum)}`)
      .send({ ativa: true });
    const deleteComum = await request(app)
      .delete(`/categorias/${idCategoria}`)
      .set("Authorization", `Bearer ${token(comum)}`);
    const inativasComum = await request(app)
      .get("/categorias?tipo=AUDIO&incluirInativas=true")
      .set("Authorization", `Bearer ${token(comum)}`);

    expect(postComum.status).toBe(403);
    expect(patchComum.status).toBe(403);
    expect(deleteComum.status).toBe(403);
    expect(inativasComum.status).toBe(403);
  });

  it("rejeita duplicidade por caixa e espaços no cadastro e na edição", async () => {
    const admin = await criarUsuario(Perfil.ADMIN);
    const nome = nomeUnico("duplicada");
    const primeira = await request(app)
      .post("/categorias")
      .set("Authorization", `Bearer ${token(admin)}`)
      .send({ nome: ` ${nome} `, tipo: "AUDIO" });
    const segunda = await request(app)
      .post("/categorias")
      .set("Authorization", `Bearer ${token(admin)}`)
      .send({ nome: nome.toUpperCase(), tipo: "AUDIO" });
    const outra = await request(app)
      .post("/categorias")
      .set("Authorization", `Bearer ${token(admin)}`)
      .send({ nome: nomeUnico("outra"), tipo: "AUDIO" });
    const edicaoDuplicada = await request(app)
      .patch(`/categorias/${outra.body.categoria.idCategoria}`)
      .set("Authorization", `Bearer ${token(admin)}`)
      .send({ nome: ` ${nome.toUpperCase()} ` });

    expect(primeira.status).toBe(201);
    expect(segunda.status).toBe(409);
    expect(segunda.body.erro.codigo).toBe("CATEGORIA_DUPLICADA");
    expect(edicaoDuplicada.status).toBe(409);
    expect(edicaoDuplicada.body.erro.codigo).toBe("CATEGORIA_DUPLICADA");
  });

  it("exclui categoria sem vínculos e impede exclusão com áudio ou ambiente associado", async () => {
    const admin = await criarUsuario(Perfil.ADMIN);
    const usuario = await criarUsuario(Perfil.COMUM);
    const livre = await criarCategoria(nomeUnico("livre"), "AUDIO");
    const categoriaAudio = await criarCategoria(nomeUnico("audio_vinculado"), "AUDIO");
    const categoriaAmbiente = await criarCategoria(nomeUnico("ambiente_vinculado"), "AMBIENTE");
    const audio = await criarAudioBanco(usuario.id, categoriaAudio.idCategoria);
    const ambiente = await prisma.ambienteSonoro.create({
      data: {
        idUsuario: usuario.id,
        idCategoria: categoriaAmbiente.idCategoria,
        nome: "Ambiente de teste",
        finalidade: Finalidade.SONO,
        origem: "personalizado",
      },
    });
    const header = { Authorization: `Bearer ${token(admin)}` };

    const exclusaoLivre = await request(app).delete(`/categorias/${livre.idCategoria}`).set(header);
    const exclusaoAudio = await request(app).delete(`/categorias/${categoriaAudio.idCategoria}`).set(header);
    const exclusaoAmbiente = await request(app).delete(`/categorias/${categoriaAmbiente.idCategoria}`).set(header);

    expect(exclusaoLivre.status).toBe(200);
    expect(exclusaoAudio.status).toBe(409);
    expect(exclusaoAudio.body.erro.codigo).toBe("CATEGORIA_POSSUI_ASSOCIACOES");
    expect(exclusaoAmbiente.status).toBe(409);
    expect(exclusaoAmbiente.body.erro.codigo).toBe("CATEGORIA_POSSUI_ASSOCIACOES");

    await request(app)
      .patch(`/categorias/${categoriaAudio.idCategoria}`)
      .set(header)
      .send({ nome: nomeUnico("audio_renomeado"), ativa: false });
    await request(app)
      .patch(`/categorias/${categoriaAmbiente.idCategoria}`)
      .set(header)
      .send({ ativa: false });
    const audioPersistido = await prisma.audio.findUnique({ where: { idAudio: audio.idAudio } });
    const ambientePersistido = await prisma.ambienteSonoro.findUnique({
      where: { idAmbienteSonoro: ambiente.idAmbienteSonoro },
    });
    expect(audioPersistido?.idCategoria).toBe(categoriaAudio.idCategoria);
    expect(ambientePersistido?.idCategoria).toBe(categoriaAmbiente.idCategoria);
  });

  it("rejeita categoria inativa ou de tipo incompatível em novos áudios e ambientes", async () => {
    const admin = await criarUsuario(Perfil.ADMIN);
    const comum = await criarUsuario(Perfil.COMUM);
    const audioAtivo = await criarCategoria(nomeUnico("audio_tipo"), "AUDIO");
    const audioInativo = await criarCategoria(nomeUnico("audio_inativo"), "AUDIO", false);
    const ambienteAtivo = await criarCategoria(nomeUnico("ambiente_tipo"), "AMBIENTE");
    const metadata = {
      titulo: "Novo áudio",
      tituloOriginal: "New audio",
      fonte: "Teste",
      licenca: "CC0",
    };

    await expect(criarAudio(admin.id, { ...metadata, idCategoria: ambienteAtivo.idCategoria }))
      .rejects.toMatchObject({ codigo: "CATEGORIA_TIPO_INVALIDO" });
    await expect(criarAudio(admin.id, { ...metadata, idCategoria: audioInativo.idCategoria }))
      .rejects.toMatchObject({ codigo: "CATEGORIA_INATIVA" });

    const audio = await criarAudioBanco(comum.id, audioAtivo.idCategoria);
    const dadosAmbiente = {
      nome: "Novo ambiente",
      finalidade: Finalidade.SONO,
      audios: [{ idAudio: audio.idAudio, volume: 50 }],
    };
    await expect(criarAmbienteSonoro(comum.id, {
      ...dadosAmbiente,
      idCategoria: audioAtivo.idCategoria,
    })).rejects.toMatchObject({ codigo: "CATEGORIA_TIPO_INVALIDO" });

    const ambienteInativo = await criarCategoria(nomeUnico("ambiente_inativo"), "AMBIENTE", false);
    await expect(criarAmbienteSonoro(comum.id, {
      ...dadosAmbiente,
      idCategoria: ambienteInativo.idCategoria,
    })).rejects.toMatchObject({ codigo: "CATEGORIA_INATIVA" });

    const criado = await criarAmbienteSonoro(comum.id, {
      ...dadosAmbiente,
      idCategoria: (await criarCategoria(nomeUnico("ambiente_valido"), "AMBIENTE")).idCategoria,
    });
    expect(criado.idCategoria).toBeTruthy();
  });
});
