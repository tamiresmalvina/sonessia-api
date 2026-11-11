import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { CategoriaAudio, Finalidade, Perfil } from "../generated/prisma/enums.js";
import { emitirTokenAcesso } from "../src/utils/jwt.util.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Ambientes sonoros pré-configurados e catálogo público (US02 e US08)", () => {
  const prefixoTeste = "test_precfg_";

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
      const ambientes = await prisma.ambienteSonoro.findMany({
        where: { idUsuario: { in: idsUsuarios } },
        select: { idAmbienteSonoro: true },
      });
      const idsAmbientes = ambientes.map((a) => a.idAmbienteSonoro);

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
        nome: perfil === Perfil.ADMIN ? "Admin Teste" : "Comum Teste",
        email: `${prefixoTeste}${randomUUID()}@teste.com`,
        senha: "hash-de-teste",
        dataNascimento: new Date("1992-03-20T00:00:00.000Z"),
        perfil,
        emailVerificado: true,
      },
    });
  }

  function token(usuario: { id: string; versaoToken: number }) {
    return emitirTokenAcesso({ sub: usuario.id, versaoToken: usuario.versaoToken });
  }

  async function criarAudio(idUsuario: string, titulo: string, categoria: CategoriaAudio = CategoriaAudio.NATUREZA) {
    return prisma.audio.create({
      data: {
        idUsuario,
        titulo,
        tituloOriginal: `${titulo} Original`,
        categoria,
        descricao: `Descrição de ${titulo}`,
        arquivo: `https://res.cloudinary.com/cloud-falso/video/upload/sonessia/audios/${randomUUID()}.mp3`,
        arquivoPublicId: `sonessia/audios/${randomUUID()}`,
        fonte: "Domínio público",
        licenca: "CC0",
      },
    });
  }

  describe("Cadastro e autorização de ambientes pré-configurados (ADMIN)", () => {
    it("permite que ADMIN cadastre ambiente pré-configurado com composição e volumes", async () => {
      const admin = await criarUsuario(Perfil.ADMIN);
      const audio1 = await criarAudio(admin.id, "Chuva leve");
      const audio2 = await criarAudio(admin.id, "Passarinhos ao fundo");

      const resposta = await request(app)
        .post("/ambientes-sonoros/pre-configurados")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({
          nome: "Refúgio da Manhã",
          descricao: "Ambiente pré-configurado para foco e estudo",
          finalidade: "ESTUDO",
          publicado: true,
          audios: [
            { idAudio: audio1.idAudio, volume: 60 },
            { idAudio: audio2.idAudio, volume: 40 },
          ],
        });

      expect(resposta.status).toBe(201);
      expect(resposta.body.mensagem).toBe("Ambiente sonoro pré-configurado criado com sucesso.");
      const ambiente = resposta.body.ambiente;
      expect(ambiente).toHaveProperty("idAmbienteSonoro");
      expect(ambiente.nome).toBe("Refúgio da Manhã");
      expect(ambiente.finalidade).toBe("ESTUDO");
      expect(ambiente.origem).toBe("preconfigurado");
      expect(ambiente.publicado).toBe(true);
      expect(ambiente.audios).toHaveLength(2);

      // Volumes preservados na resposta e no banco
      expect(ambiente.audios[0].volume).toBe(60);
      expect(ambiente.audios[1].volume).toBe(40);

      // Não vaza informações sensíveis
      expect(ambiente).not.toHaveProperty("idUsuario");
      expect(ambiente.audios[0]).not.toHaveProperty("arquivoPublicId");
      expect(ambiente.audios[0]).not.toHaveProperty("idUsuario");
    });

    it("bloqueia usuário comum ao tentar cadastrar ambiente pré-configurado com HTTP 403", async () => {
      const comum = await criarUsuario(Perfil.COMUM);
      const audio = await criarAudio(comum.id, "Chuva");

      const resposta = await request(app)
        .post("/ambientes-sonoros/pre-configurados")
        .set("Authorization", `Bearer ${token(comum)}`)
        .send({
          nome: "Tentativa de Admin",
          finalidade: "CONCENTRACAO",
          audios: [{ idAudio: audio.idAudio, volume: 50 }],
        });

      expect(resposta.status).toBe(403);
      expect(resposta.body.erro.codigo).toBe("ACESSO_NEGADO");
    });

    it("bloqueia usuário não autenticado ao tentar cadastrar com HTTP 401", async () => {
      const resposta = await request(app)
        .post("/ambientes-sonoros/pre-configurados")
        .send({
          nome: "Sem Token",
          finalidade: "CONCENTRACAO",
          audios: [{ idAudio: randomUUID(), volume: 50 }],
        });

      expect(resposta.status).toBe(401);
      expect(resposta.body.erro.codigo).toBe("NAO_AUTENTICADO");
    });

    it("rejeita cadastro com áudio inexistente", async () => {
      const admin = await criarUsuario(Perfil.ADMIN);
      const idInexistente = randomUUID();

      const resposta = await request(app)
        .post("/ambientes-sonoros/pre-configurados")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({
          nome: "Ambiente com Áudio Fantasma",
          finalidade: "RELAXAMENTO",
          audios: [{ idAudio: idInexistente, volume: 50 }],
        });

      expect(resposta.status).toBe(404);
      expect(resposta.body.erro.codigo).toBe("AUDIO_NAO_ENCONTRADO");
    });

    it("rejeita cadastro com áudio duplicado ou volumes fora do limite (0 a 100)", async () => {
      const admin = await criarUsuario(Perfil.ADMIN);
      const audio = await criarAudio(admin.id, "Riacho");

      const duplicado = await request(app)
        .post("/ambientes-sonoros/pre-configurados")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({
          nome: "Duplicado",
          finalidade: "RELAXAMENTO",
          audios: [
            { idAudio: audio.idAudio, volume: 30 },
            { idAudio: audio.idAudio, volume: 70 },
          ],
        });

      const volumeAcima = await request(app)
        .post("/ambientes-sonoros/pre-configurados")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({
          nome: "Volume Inválido",
          finalidade: "RELAXAMENTO",
          audios: [{ idAudio: audio.idAudio, volume: 150 }],
        });

      expect(duplicado.status).toBe(400);
      expect(duplicado.body.erro.codigo).toBe("DADOS_INVALIDOS");
      expect(volumeAcima.status).toBe(400);
      expect(volumeAcima.body.erro.codigo).toBe("DADOS_INVALIDOS");
    });
  });

  describe("Edição e publicação/despublicação por ADMIN", () => {
    it("permite que ADMIN edite metadados e composição de ambiente pré-configurado", async () => {
      const admin = await criarUsuario(Perfil.ADMIN);
      const audio1 = await criarAudio(admin.id, "Ondas");
      const audio2 = await criarAudio(admin.id, "Gaivotas");

      const criacao = await request(app)
        .post("/ambientes-sonoros/pre-configurados")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({
          nome: "Praia Deserta",
          descricao: "Sons do litoral",
          finalidade: "RELAXAMENTO",
          audios: [{ idAudio: audio1.idAudio, volume: 50 }],
        });

      const idAmbiente = criacao.body.ambiente.idAmbienteSonoro;

      const edicao = await request(app)
        .patch(`/ambientes-sonoros/pre-configurados/${idAmbiente}`)
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({
          nome: "Praia Tropical",
          descricao: "Sons de praia com gaivotas",
          finalidade: "MEDITACAO",
          audios: [
            { idAudio: audio1.idAudio, volume: 70 },
            { idAudio: audio2.idAudio, volume: 30 },
          ],
        });

      expect(edicao.status).toBe(200);
      expect(edicao.body.ambiente.nome).toBe("Praia Tropical");
      expect(edicao.body.ambiente.finalidade).toBe("MEDITACAO");
      expect(edicao.body.ambiente.audios).toHaveLength(2);
    });

    it("permite que ADMIN publique e despublique ambiente pré-configurado", async () => {
      const admin = await criarUsuario(Perfil.ADMIN);
      const audio = await criarAudio(admin.id, "Fogueira");

      const criacao = await request(app)
        .post("/ambientes-sonoros/pre-configurados")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({
          nome: "Acampamento Noturno",
          finalidade: "SONO",
          publicado: false,
          audios: [{ idAudio: audio.idAudio, volume: 45 }],
        });

      const idAmbiente = criacao.body.ambiente.idAmbienteSonoro;
      expect(criacao.body.ambiente.publicado).toBe(false);

      // Publica
      const publicacao = await request(app)
        .patch(`/ambientes-sonoros/pre-configurados/${idAmbiente}/publicacao`)
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({ publicado: true });

      expect(publicacao.status).toBe(200);
      expect(publicacao.body.mensagem).toBe("Ambiente sonoro publicado com sucesso.");
      expect(publicacao.body.ambiente.publicado).toBe(true);

      // Despublica
      const despublicacao = await request(app)
        .patch(`/ambientes-sonoros/pre-configurados/${idAmbiente}/publicacao`)
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({ publicado: false });

      expect(despublicacao.status).toBe(200);
      expect(despublicacao.body.mensagem).toBe("Ambiente sonoro despublicado com sucesso.");
      expect(despublicacao.body.ambiente.publicado).toBe(false);

      // Confirma que os dados foram preservados no banco
      const ambienteBanco = await prisma.ambienteSonoro.findUnique({
        where: { idAmbienteSonoro: idAmbiente },
      });
      expect(ambienteBanco).not.toBeNull();
      expect(ambienteBanco?.nome).toBe("Acampamento Noturno");
      expect(ambienteBanco?.publicado).toBe(false);
    });

    it("bloqueia usuário comum ao tentar editar, publicar ou excluir ambiente pré-configurado", async () => {
      const admin = await criarUsuario(Perfil.ADMIN);
      const comum = await criarUsuario(Perfil.COMUM);
      const audio = await criarAudio(admin.id, "Floresta");

      const criacao = await request(app)
        .post("/ambientes-sonoros/pre-configurados")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({
          nome: "Floresta Densa",
          finalidade: "MEDITACAO",
          publicado: true,
          audios: [{ idAudio: audio.idAudio, volume: 50 }],
        });

      const idAmbiente = criacao.body.ambiente.idAmbienteSonoro;

      const tentativaEdicao = await request(app)
        .patch(`/ambientes-sonoros/pre-configurados/${idAmbiente}`)
        .set("Authorization", `Bearer ${token(comum)}`)
        .send({ nome: "Tentando Editar" });

      const tentativaPublicacao = await request(app)
        .patch(`/ambientes-sonoros/pre-configurados/${idAmbiente}/publicacao`)
        .set("Authorization", `Bearer ${token(comum)}`)
        .send({ publicado: false });

      const tentativaExclusao = await request(app)
        .delete(`/ambientes-sonoros/pre-configurados/${idAmbiente}`)
        .set("Authorization", `Bearer ${token(comum)}`);

      expect(tentativaEdicao.status).toBe(403);
      expect(tentativaPublicacao.status).toBe(403);
      expect(tentativaExclusao.status).toBe(403);
    });
  });

  describe("Consultas públicas de ambientes pré-configurados (US08 / US14)", () => {
    it("permite que usuário não autenticado consulte listagem de ambientes publicados", async () => {
      const admin = await criarUsuario(Perfil.ADMIN);
      const audio = await criarAudio(admin.id, "Chuva no teto");

      // Cria 1 publicado
      await request(app)
        .post("/ambientes-sonoros/pre-configurados")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({
          nome: "Chuva Zen",
          finalidade: "RELAXAMENTO",
          publicado: true,
          audios: [{ idAudio: audio.idAudio, volume: 50 }],
        });

      // Cria 1 despublicado
      await request(app)
        .post("/ambientes-sonoros/pre-configurados")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({
          nome: "Chuva Tempestuosa Rascunho",
          finalidade: "RELAXAMENTO",
          publicado: false,
          audios: [{ idAudio: audio.idAudio, volume: 80 }],
        });

      // Consulta pública sem token
      const listagemPublica = await request(app).get("/ambientes-sonoros/publicos");

      expect(listagemPublica.status).toBe(200);
      const nomes = listagemPublica.body.ambientes.map((a: { nome: string }) => a.nome);
      expect(nomes).toContain("Chuva Zen");
      expect(nomes).not.toContain("Chuva Tempestuosa Rascunho");
    });

    it("não exibe ambientes personalizados de usuários no catálogo público", async () => {
      const comum = await criarUsuario(Perfil.COMUM);
      const audio = await criarAudio(comum.id, "Ruído rosa");

      // Cria ambiente personalizado
      await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(comum)}`)
        .send({
          nome: "Ambiente Secreto de Comum",
          finalidade: "CONCENTRACAO",
          audios: [{ idAudio: audio.idAudio, volume: 40 }],
        });

      // Consulta pública sem token
      const listagemPublica = await request(app).get("/ambientes-sonoros/publicos");

      expect(listagemPublica.status).toBe(200);
      const nomes = listagemPublica.body.ambientes.map((a: { nome: string }) => a.nome);
      expect(nomes).not.toContain("Ambiente Secreto de Comum");
    });

    it("permite consulta individual pública de ambiente publicado e bloqueia despublicado com HTTP 404", async () => {
      const admin = await criarUsuario(Perfil.ADMIN);
      const audio = await criarAudio(admin.id, "Vento Suave");

      // 1 publicado
      const criacaoPublicado = await request(app)
        .post("/ambientes-sonoros/pre-configurados")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({
          nome: "Brisa Marítima Publicada",
          finalidade: "MEDITACAO",
          publicado: true,
          audios: [{ idAudio: audio.idAudio, volume: 55 }],
        });
      const idPublicado = criacaoPublicado.body.ambiente.idAmbienteSonoro;

      // 1 despublicado
      const criacaoDespublicado = await request(app)
        .post("/ambientes-sonoros/pre-configurados")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({
          nome: "Brisa Oculta",
          finalidade: "MEDITACAO",
          publicado: false,
          audios: [{ idAudio: audio.idAudio, volume: 55 }],
        });
      const idDespublicado = criacaoDespublicado.body.ambiente.idAmbienteSonoro;

      // Consulta pública do publicado (sem token)
      const consultaPublicada = await request(app).get(`/ambientes-sonoros/publicos/${idPublicado}`);
      expect(consultaPublicada.status).toBe(200);
      expect(consultaPublicada.body.ambiente.nome).toBe("Brisa Marítima Publicada");
      expect(consultaPublicada.body.ambiente.audios).toHaveLength(1);
      expect(consultaPublicada.body.ambiente.audios[0].arquivo).toMatch(/^https:\/\//);

      // Consulta pública do despublicado (sem token) -> deve retornar 404
      const consultaDespublicada = await request(app).get(`/ambientes-sonoros/publicos/${idDespublicado}`);
      expect(consultaDespublicada.status).toBe(404);
      expect(consultaDespublicada.body.erro.codigo).toBe("AMBIENTE_NAO_ENCONTRADO");
    });

    it("filtra ambientes públicos por finalidade corretamente", async () => {
      const admin = await criarUsuario(Perfil.ADMIN);
      const audio = await criarAudio(admin.id, "Som harmônico");

      await request(app)
        .post("/ambientes-sonoros/pre-configurados")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({
          nome: "Ambiente Estudo Alpha",
          finalidade: "ESTUDO",
          publicado: true,
          audios: [{ idAudio: audio.idAudio, volume: 50 }],
        });

      await request(app)
        .post("/ambientes-sonoros/pre-configurados")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({
          nome: "Ambiente Sono Delta",
          finalidade: "SONO",
          publicado: true,
          audios: [{ idAudio: audio.idAudio, volume: 50 }],
        });

      const filtroEstudo = await request(app).get("/ambientes-sonoros/publicos?finalidade=ESTUDO");
      const filtroSono = await request(app).get("/ambientes-sonoros/publicos?finalidade=SONO");

      expect(filtroEstudo.status).toBe(200);
      expect(filtroEstudo.body.ambientes.every((a: { finalidade: string }) => a.finalidade === "ESTUDO")).toBe(true);
      expect(filtroEstudo.body.ambientes.some((a: { nome: string }) => a.nome === "Ambiente Estudo Alpha")).toBe(true);

      expect(filtroSono.status).toBe(200);
      expect(filtroSono.body.ambientes.every((a: { finalidade: string }) => a.finalidade === "SONO")).toBe(true);
      expect(filtroSono.body.ambientes.some((a: { nome: string }) => a.nome === "Ambiente Sono Delta")).toBe(true);
    });

    it("rejeita filtro de finalidade inválida com HTTP 400 DADOS_INVALIDOS", async () => {
      const resposta = await request(app).get("/ambientes-sonoros/publicos?finalidade=FINALIDADE_FAKE");
      expect(resposta.status).toBe(400);
      expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");
    });

    it("disponibiliza consulta pública de finalidades disponíveis", async () => {
      const resposta = await request(app).get("/ambientes-sonoros/publicos/finalidades");
      expect(resposta.status).toBe(200);
      expect(resposta.body.finalidades).toEqual(expect.arrayContaining([
        "CONCENTRACAO",
        "ESTUDO",
        "MEDITACAO",
        "RELAXAMENTO",
        "SONO",
        "TRABALHO",
      ]));
    });
  });

  describe("Exclusão e preservação de integridade", () => {
    it("ADMIN exclui ambiente pré-configurado sem excluir os áudios do catálogo", async () => {
      const admin = await criarUsuario(Perfil.ADMIN);
      const audio = await criarAudio(admin.id, "Som para Não Excluir");

      const criacao = await request(app)
        .post("/ambientes-sonoros/pre-configurados")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({
          nome: "Ambiente que será excluído",
          finalidade: "TRABALHO",
          publicado: true,
          audios: [{ idAudio: audio.idAudio, volume: 50 }],
        });

      const idAmbiente = criacao.body.ambiente.idAmbienteSonoro;

      const exclusao = await request(app)
        .delete(`/ambientes-sonoros/pre-configurados/${idAmbiente}`)
        .set("Authorization", `Bearer ${token(admin)}`);

      expect(exclusao.status).toBe(200);
      expect(exclusao.body.mensagem).toBe("Ambiente sonoro pré-configurado excluído com sucesso.");

      // Ambiente foi removido
      const ambienteBanco = await prisma.ambienteSonoro.findUnique({
        where: { idAmbienteSonoro: idAmbiente },
      });
      expect(ambienteBanco).toBeNull();

      // Áudio base do catálogo NÃO foi excluído
      const audioBanco = await prisma.audio.findUnique({
        where: { idAudio: audio.idAudio },
      });
      expect(audioBanco).not.toBeNull();
    });

    it("trata relações com coleções sem violar restrições do banco de dados", async () => {
      const admin = await criarUsuario(Perfil.ADMIN);
      const audio = await criarAudio(admin.id, "Áudio em Coleção");

      const criacao = await request(app)
        .post("/ambientes-sonoros/pre-configurados")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({
          nome: "Ambiente Pré em Coleção",
          finalidade: "ESTUDO",
          publicado: true,
          audios: [{ idAudio: audio.idAudio, volume: 60 }],
        });

      const idAmbiente = criacao.body.ambiente.idAmbienteSonoro;

      const colecao = await prisma.colecao.create({
        data: {
          idUsuario: admin.id,
          nome: "Coleção de Ambientes Pré",
        },
      });

      await prisma.colecaoAmbienteSonoro.create({
        data: {
          idColecao: colecao.idColecao,
          idAmbienteSonoro: idAmbiente,
        },
      });

      const exclusao = await request(app)
        .delete(`/ambientes-sonoros/pre-configurados/${idAmbiente}`)
        .set("Authorization", `Bearer ${token(admin)}`);

      expect(exclusao.status).toBe(200);

      // Associação intermediária foi limpa
      const relacaoColecao = await prisma.colecaoAmbienteSonoro.count({
        where: { idAmbienteSonoro: idAmbiente },
      });
      expect(relacaoColecao).toBe(0);

      // A coleção continua existindo
      const colecaoBanco = await prisma.colecao.findUnique({
        where: { idColecao: colecao.idColecao },
      });
      expect(colecaoBanco).not.toBeNull();

      // Limpeza da coleção criada
      await prisma.colecao.delete({ where: { idColecao: colecao.idColecao } });
    });
  });

  describe("Compatibilidade com alias de rota /ambientes", () => {
    it("permite acessar rotas públicas e administrativas usando o alias /ambientes", async () => {
      const admin = await criarUsuario(Perfil.ADMIN);
      const audio = await criarAudio(admin.id, "Chuva no Alias");

      const criacao = await request(app)
        .post("/ambientes/pre-configurados")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({
          nome: "Ambiente Via Alias",
          finalidade: "RELAXAMENTO",
          publicado: true,
          audios: [{ idAudio: audio.idAudio, volume: 75 }],
        });

      expect(criacao.status).toBe(201);
      const idAmbiente = criacao.body.ambiente.idAmbienteSonoro;

      const listagemPublica = await request(app).get("/ambientes/publicos");
      expect(listagemPublica.status).toBe(200);
      expect(listagemPublica.body.ambientes.some((a: { nome: string }) => a.nome === "Ambiente Via Alias")).toBe(true);

      const consultaPublica = await request(app).get(`/ambientes/publicos/${idAmbiente}`);
      expect(consultaPublica.status).toBe(200);
      expect(consultaPublica.body.ambiente.nome).toBe("Ambiente Via Alias");
    });
  });
});

