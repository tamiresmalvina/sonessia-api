import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { Perfil } from "../generated/prisma/enums.js";
import { emitirTokenAcesso } from "../src/utils/jwt.util.js";
import { cloudinary, inicializarCloudinary, resetarConfiguracaoCloudinaryParaTestes } from "../src/config/cloudinary.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("CRUD administrativo de áudios", () => {
  const prefixoTeste = "test_audio_";

  beforeAll(async () => {
    await garantirBancoTestesIsolado();
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
    resetarConfiguracaoCloudinaryParaTestes();
    const usuarios = await prisma.usuario.findMany({
      where: { email: { startsWith: prefixoTeste } },
      select: { id: true },
    });
    const idsUsuarios = usuarios.map((usuario) => usuario.id);
    await prisma.ambienteSonoroAudio.deleteMany({
      where: { audio: { idUsuario: { in: idsUsuarios } } },
    });
    await prisma.audio.deleteMany({
      where: { usuario: { email: { startsWith: prefixoTeste } } },
    });
    await prisma.usuario.deleteMany({ where: { email: { startsWith: prefixoTeste } } });
  });

  async function criarUsuario(perfil: Perfil) {
    return prisma.usuario.create({
      data: {
        nome: "Usuário Audio Teste",
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

  function arquivoMp3() {
    return Buffer.concat([Buffer.from("ID3"), Buffer.alloc(32)]);
  }

  function configurarUpload() {
    return vi.spyOn(cloudinary.uploader, "upload").mockImplementation(async (_arquivo, opcoes) => {
      const opcoesUpload = typeof opcoes === "object" && opcoes !== null
        ? opcoes as Record<string, unknown>
        : {};
      const publicId = typeof opcoesUpload.public_id === "string" ? opcoesUpload.public_id : "";
      return {
        public_id: publicId,
        resource_type: "video",
        type: "upload",
        secure_url: `https://res.cloudinary.com/cloud-falso/video/upload/${publicId}.mp3`,
      } as Awaited<ReturnType<typeof cloudinary.uploader.upload>>;
    });
  }

  function configurarRemocao() {
    return vi.spyOn(cloudinary.api, "delete_resources").mockImplementation(async (ids) => ({
      deleted: Object.fromEntries(ids.map((id) => [id, "deleted"])),
    }));
  }

  function enviarCriacao(tokenAcesso: string) {
    return request(app)
      .post("/audios")
      .set("Authorization", `Bearer ${tokenAcesso}`)
      .field("metadados", JSON.stringify({
        categoria: "NATUREZA",
        titulo: "Chuva da tarde",
        tituloOriginal: "Afternoon rain",
        fonte: "Domínio público",
        licenca: "CC0",
      }))
      .attach("arquivo", arquivoMp3(), { filename: "chuva.mp3", contentType: "audio/mpeg" });
  }

  it("exige autenticação e perfil administrador", async () => {
    const comum = await criarUsuario(Perfil.COMUM);
    const semAutenticacao = await enviarCriacao("");
    const usuarioComum = await enviarCriacao(token(comum));

    expect(semAutenticacao.status).toBe(401);
    expect(usuarioComum.status).toBe(403);
  });

  it("protege todas as operações administrativas além do cadastro", async () => {
    const admin = await criarUsuario(Perfil.ADMIN);
    configurarUpload();
    const criacao = await enviarCriacao(token(admin));
    const idAudio = criacao.body.audio.idAudio;
    const comum = await criarUsuario(Perfil.COMUM);

    const atualizacaoSemToken = await request(app)
      .patch(`/audios/${idAudio}`)
      .send({ titulo: "Novo título" });
    const atualizacaoComComum = await request(app)
      .patch(`/audios/${idAudio}`)
      .set("Authorization", `Bearer ${token(comum)}`)
      .send({ titulo: "Novo título" });
    const substituicaoSemToken = await request(app)
      .put(`/audios/${idAudio}/arquivo`)
      .attach("arquivo", arquivoMp3(), { filename: "chuva.mp3", contentType: "audio/mpeg" });
    const exclusaoSemToken = await request(app).delete(`/audios/${idAudio}`);
    const substituicaoComComum = await request(app)
      .put(`/audios/${idAudio}/arquivo`)
      .set("Authorization", `Bearer ${token(comum)}`)
      .attach("arquivo", arquivoMp3(), { filename: "chuva.mp3", contentType: "audio/mpeg" });
    const exclusaoComComum = await request(app)
      .delete(`/audios/${idAudio}`)
      .set("Authorization", `Bearer ${token(comum)}`);

    expect(atualizacaoSemToken.status).toBe(401);
    expect(atualizacaoComComum.status).toBe(403);
    expect(substituicaoSemToken.status).toBe(401);
    expect(exclusaoSemToken.status).toBe(401);
    expect(substituicaoComComum.status).toBe(403);
    expect(exclusaoComComum.status).toBe(403);
  });

  it("cadastra, lista, consulta, atualiza e exclui um áudio", async () => {
    const admin = await criarUsuario(Perfil.ADMIN);
    configurarUpload();
    configurarRemocao();
    const criacao = await enviarCriacao(token(admin));

    expect(criacao.status).toBe(201);
    expect(criacao.body.audio).not.toHaveProperty("idUsuario");
    expect(criacao.body.audio).not.toHaveProperty("arquivoPublicId");
    const idAudio = criacao.body.audio.idAudio;

    const listagem = await request(app).get("/audios");
    expect(listagem.status).toBe(200);
    expect(listagem.body.audios).toHaveLength(1);
    expect(Object.keys(listagem.body.audios[0]).sort()).toEqual([
      "arquivo",
      "categoria",
      "descricao",
      "fonte",
      "idAudio",
      "licenca",
      "titulo",
      "tituloOriginal",
    ]);
    expect(listagem.body.audios[0]).not.toHaveProperty("arquivoPublicId");
    expect(listagem.body.audios[0]).not.toHaveProperty("idUsuario");
    expect(listagem.body.audios[0].arquivo).toMatch(/^https:\/\//);

    const consulta = await request(app).get(`/audios/${idAudio}`);
    expect(consulta.status).toBe(200);
    expect(consulta.body.audio).toMatchObject({
      idAudio,
      titulo: "Chuva da tarde",
      tituloOriginal: "Afternoon rain",
      categoria: "NATUREZA",
      fonte: "Domínio público",
      licenca: "CC0",
    });
    expect(consulta.body.audio).not.toHaveProperty("arquivoPublicId");
    expect(consulta.body.audio).not.toHaveProperty("idUsuario");
    expect(consulta.body.audio.arquivo).toMatch(/^https:\/\//);

    const atualizacao = await request(app)
      .patch(`/audios/${idAudio}`)
      .set("Authorization", `Bearer ${token(admin)}`)
      .send({ titulo: "Chuva noturna", descricao: "Som suave de chuva" });
    expect(atualizacao.status).toBe(200);
    expect(atualizacao.body.audio.titulo).toBe("Chuva noturna");

    const substituicao = await request(app)
      .put(`/audios/${idAudio}/arquivo`)
      .set("Authorization", `Bearer ${token(admin)}`)
      .attach("arquivo", arquivoMp3(), { filename: "chuva-nova.mp3", contentType: "audio/mpeg" });
    expect(substituicao.status).toBe(200);

    const exclusao = await request(app)
      .delete(`/audios/${idAudio}`)
      .set("Authorization", `Bearer ${token(admin)}`);
    expect(exclusao.status).toBe(200);
    expect(await prisma.audio.count({ where: { idAudio } })).toBe(0);
  });

  it("valida o ID público e retorna 404 para UUID inexistente", async () => {
    const idInvalido = await request(app).get("/audios/id-invalido");
    const idInexistente = await request(app).get(`/audios/${randomUUID()}`);

    expect(idInvalido.status).toBe(400);
    expect(idInvalido.body.erro.codigo).toBe("ID_AUDIO_INVALIDO");
    expect(idInexistente.status).toBe(404);
    expect(idInexistente.body.erro.codigo).toBe("AUDIO_NAO_ENCONTRADO");
  });

  it("rejeita metadados inválidos antes de chamar o Cloudinary", async () => {
    const admin = await criarUsuario(Perfil.ADMIN);
    const upload = vi.spyOn(cloudinary.uploader, "upload");
    const resposta = await request(app)
      .post("/audios")
      .set("Authorization", `Bearer ${token(admin)}`)
      .field("metadados", JSON.stringify({ categoria: "INVALIDA" }))
      .attach("arquivo", arquivoMp3(), { filename: "som.mp3", contentType: "audio/mpeg" });

    expect(resposta.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejeita tipo de arquivo não suportado", async () => {
    const admin = await criarUsuario(Perfil.ADMIN);
    const upload = vi.spyOn(cloudinary.uploader, "upload");
    const resposta = await request(app)
      .post("/audios")
      .set("Authorization", `Bearer ${token(admin)}`)
      .field("metadados", JSON.stringify({
        categoria: "AMBIENTE",
        titulo: "Som",
        tituloOriginal: "Sound",
        fonte: "Teste",
        licenca: "Teste",
      }))
      .attach("arquivo", Buffer.from("não é áudio"), { filename: "som.txt", contentType: "text/plain" });

    expect(resposta.status).toBe(415);
    expect(upload).not.toHaveBeenCalled();
  });
});
