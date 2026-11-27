import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { Perfil } from "../generated/prisma/enums.js";
import { emitirTokenAcesso } from "../src/utils/jwt.util.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Histórico de reprodução de ambientes", () => {
  const prefixoTeste = "test_hist_rep_";

  beforeAll(async () => {
    await garantirBancoTestesIsolado();
  });

  afterEach(async () => {
    const usuarios = await prisma.usuario.findMany({
      where: { email: { startsWith: prefixoTeste } },
      select: { id: true },
    });
    const idsUsuarios = usuarios.map(({ id }) => id);

    if (idsUsuarios.length === 0) return;

    const ambientes = await prisma.ambienteSonoro.findMany({
      where: { idUsuario: { in: idsUsuarios } },
      select: { idAmbienteSonoro: true },
    });
    const idsAmbientes = ambientes.map(({ idAmbienteSonoro }) => idAmbienteSonoro);

    if (idsAmbientes.length > 0) {
      await prisma.colecaoAmbienteSonoro.deleteMany({ where: { idAmbienteSonoro: { in: idsAmbientes } } });
      await prisma.ambienteSonoroAudio.deleteMany({ where: { idAmbienteSonoro: { in: idsAmbientes } } });
      await prisma.ambienteSonoro.deleteMany({ where: { idAmbienteSonoro: { in: idsAmbientes } } });
    }

    await prisma.ambienteSonoroAudio.deleteMany({ where: { audio: { idUsuario: { in: idsUsuarios } } } });
    await prisma.audio.deleteMany({ where: { idUsuario: { in: idsUsuarios } } });
    await prisma.usuario.deleteMany({ where: { id: { in: idsUsuarios } } });
  });

  async function criarUsuario(perfil: Perfil = Perfil.COMUM) {
    return prisma.usuario.create({
      data: {
        nome: "Usuário de teste",
        email: `${prefixoTeste}${randomUUID()}@teste.com`,
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

  async function criarAmbiente(
    idUsuario: string,
    opcoes: { origem?: string; publicado?: boolean; audio?: boolean } = {},
  ) {
    const ambiente = await prisma.ambienteSonoro.create({
      data: {
        idUsuario,
        nome: `Ambiente ${randomUUID()}`,
        descricao: "Descrição de teste",
        origem: opcoes.origem ?? "personalizado",
        publicado: opcoes.publicado ?? false,
        imagem: "https://exemplo.test/capa.jpg",
      },
    });

    if (opcoes.audio) {
      let categoria = await prisma.categoria.findFirst({ where: { tipo: "AUDIO" } });
      if (!categoria) {
        categoria = await prisma.categoria.create({ data: { nome: `Áudio ${randomUUID()}`, tipo: "AUDIO" } });
      }
      const audio = await prisma.audio.create({
        data: {
          idUsuario,
          idCategoria: categoria.idCategoria,
          titulo: "Chuva",
          tituloOriginal: "Chuva original",
          arquivo: "https://exemplo.test/chuva.mp3",
          fonte: "Teste",
          licenca: "CC0",
        },
      });
      await prisma.ambienteSonoroAudio.create({
        data: { idAmbienteSonoro: ambiente.idAmbienteSonoro, idAudio: audio.idAudio, volume: 65 },
      });
    }

    return ambiente;
  }

  it("exige autenticação e impede registrar ambiente privado de outro usuário", async () => {
    const dono = await criarUsuario();
    const visitante = await criarUsuario();
    const ambiente = await criarAmbiente(dono.id);

    const semAutenticacaoPost = await request(app)
      .post("/historico-reproducoes")
      .send({ idAmbienteSonoro: ambiente.idAmbienteSonoro });
    const semAutenticacaoGet = await request(app).get("/historico-reproducoes/recentes");
    const inacessivel = await request(app)
      .post("/historico-reproducoes")
      .set("Authorization", `Bearer ${token(visitante)}`)
      .send({ idAmbienteSonoro: ambiente.idAmbienteSonoro });

    expect(semAutenticacaoPost.status).toBe(401);
    expect(semAutenticacaoGet.status).toBe(401);
    expect(inacessivel.status).toBe(404);
    expect(await prisma.historicoReproducaoAmbiente.count()).toBe(0);
  });

  it("registra, atualiza o mesmo ambiente sem duplicar e retorna o DTO com áudio e volume", async () => {
    const usuario = await criarUsuario();
    const ambiente = await criarAmbiente(usuario.id, { audio: true });
    const autorizacao = `Bearer ${token(usuario)}`;

    const primeiraResposta = await request(app)
      .post("/historico-reproducoes")
      .set("Authorization", autorizacao)
      .send({ idAmbienteSonoro: ambiente.idAmbienteSonoro });
    const instanteAntigo = new Date(Date.now() - 60_000);
    await prisma.historicoReproducaoAmbiente.update({
      where: { idUsuario_idAmbienteSonoro: { idUsuario: usuario.id, idAmbienteSonoro: ambiente.idAmbienteSonoro } },
      data: { ultimaReproducao: instanteAntigo, atualizadoEm: instanteAntigo },
    });
    const segundaResposta = await request(app)
      .post("/historico-reproducoes")
      .set("Authorization", autorizacao)
      .send({ idAmbienteSonoro: ambiente.idAmbienteSonoro });

    expect(primeiraResposta.status).toBe(200);
    expect(segundaResposta.status).toBe(200);
    expect(segundaResposta.body.historico.idAmbienteSonoro).toBe(ambiente.idAmbienteSonoro);
    expect(new Date(segundaResposta.body.historico.ultimaReproducao).getTime()).toBeGreaterThan(instanteAntigo.getTime());
    expect(await prisma.historicoReproducaoAmbiente.count({ where: { idUsuario: usuario.id } })).toBe(1);

    const consulta = await request(app)
      .get("/historico-reproducoes/recentes")
      .set("Authorization", autorizacao);
    expect(consulta.status).toBe(200);
    expect(consulta.body.ambientes[0]).toMatchObject({
      idAmbienteSonoro: ambiente.idAmbienteSonoro,
      nome: ambiente.nome,
      descricao: ambiente.descricao,
      imagem: ambiente.imagem,
      finalidade: "SONO",
      audios: [expect.objectContaining({ titulo: "Chuva", volume: 65 })],
    });
    expect(consulta.body.ambientes[0].ultimaReproducao).toBeDefined();
  });

  it("aceita ambientes públicos publicados e rejeita os não publicados e IDs inválidos", async () => {
    const usuario = await criarUsuario();
    const admin = await criarUsuario(Perfil.ADMIN);
    const publicado = await criarAmbiente(admin.id, { origem: "preconfigurado", publicado: true });
    const despublicado = await criarAmbiente(admin.id, { origem: "preconfigurado", publicado: false });
    const autorizacao = `Bearer ${token(usuario)}`;

    const permitido = await request(app)
      .post("/historico-reproducoes")
      .set("Authorization", autorizacao)
      .send({ idAmbienteSonoro: publicado.idAmbienteSonoro });
    const bloqueado = await request(app)
      .post("/historico-reproducoes")
      .set("Authorization", autorizacao)
      .send({ idAmbienteSonoro: despublicado.idAmbienteSonoro });
    const invalido = await request(app)
      .post("/historico-reproducoes")
      .set("Authorization", autorizacao)
      .send({ idAmbienteSonoro: "nao-e-uuid" });
    const inexistente = await request(app)
      .post("/historico-reproducoes")
      .set("Authorization", autorizacao)
      .send({ idAmbienteSonoro: randomUUID() });

    expect(permitido.status).toBe(200);
    expect(bloqueado.status).toBe(404);
    expect(invalido.status).toBe(400);
    expect(inexistente.status).toBe(404);
  });

  it("isola a consulta por usuário, ordena e limita a 20 registros", async () => {
    const usuario = await criarUsuario();
    const outroUsuario = await criarUsuario();
    const ambienteOutro = await criarAmbiente(outroUsuario.id);
    const agora = Date.now();
    const ambientes = await Promise.all(
      Array.from({ length: 21 }, () => criarAmbiente(usuario.id)),
    );

    await prisma.historicoReproducaoAmbiente.createMany({
      data: ambientes.map((ambiente, indice) => ({
        idUsuario: usuario.id,
        idAmbienteSonoro: ambiente.idAmbienteSonoro,
        ultimaReproducao: new Date(agora - indice * 60_000),
      })),
    });
    await prisma.historicoReproducaoAmbiente.create({
      data: { idUsuario: outroUsuario.id, idAmbienteSonoro: ambienteOutro.idAmbienteSonoro },
    });

    const consulta = await request(app)
      .get("/historico-reproducoes/recentes")
      .set("Authorization", `Bearer ${token(usuario)}`);

    expect(consulta.status).toBe(200);
    expect(consulta.body.ambientes).toHaveLength(20);
    expect(consulta.body.ambientes[0]?.idAmbienteSonoro).toBe(ambientes[0]?.idAmbienteSonoro);
    expect(consulta.body.ambientes.some((item: { idAmbienteSonoro: string }) =>
      item.idAmbienteSonoro === ambienteOutro.idAmbienteSonoro,
    )).toBe(false);

    const novoAmbiente = await criarAmbiente(usuario.id);
    const registro = await request(app)
      .post("/historico-reproducoes")
      .set("Authorization", `Bearer ${token(usuario)}`)
      .send({ idAmbienteSonoro: novoAmbiente.idAmbienteSonoro });

    expect(registro.status).toBe(200);
    expect(await prisma.historicoReproducaoAmbiente.count({ where: { idUsuario: usuario.id } })).toBe(20);
  });

  it("oculta registros expirados e remove-os ao registrar uma reprodução nova", async () => {
    const usuario = await criarUsuario();
    const expirado = await criarAmbiente(usuario.id);
    const atual = await criarAmbiente(usuario.id);
    const dataExpirada = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);

    await prisma.historicoReproducaoAmbiente.create({
      data: {
        idUsuario: usuario.id,
        idAmbienteSonoro: expirado.idAmbienteSonoro,
        ultimaReproducao: dataExpirada,
        atualizadoEm: dataExpirada,
      },
    });

    const autorizacao = `Bearer ${token(usuario)}`;
    const antes = await request(app).get("/historico-reproducoes/recentes").set("Authorization", autorizacao);
    const registro = await request(app)
      .post("/historico-reproducoes")
      .set("Authorization", autorizacao)
      .send({ idAmbienteSonoro: atual.idAmbienteSonoro });

    expect(antes.body.ambientes).toHaveLength(0);
    expect(registro.status).toBe(200);
    expect(await prisma.historicoReproducaoAmbiente.findUnique({
      where: { idUsuario_idAmbienteSonoro: { idUsuario: usuario.id, idAmbienteSonoro: expirado.idAmbienteSonoro } },
    })).toBeNull();
  });

  it("rejeita campos extras no corpo para não aceitar ID de usuário do cliente", async () => {
    const usuario = await criarUsuario();
    const ambiente = await criarAmbiente(usuario.id);
    const resposta = await request(app)
      .post("/historico-reproducoes")
      .set("Authorization", `Bearer ${token(usuario)}`)
      .send({ idAmbienteSonoro: ambiente.idAmbienteSonoro, idUsuario: randomUUID() });

    expect(resposta.status).toBe(400);
    expect(await prisma.historicoReproducaoAmbiente.count()).toBe(0);
  });
});
