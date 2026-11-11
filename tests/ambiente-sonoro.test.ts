import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { CategoriaAudio, Finalidade, Perfil } from "../generated/prisma/enums.js";
import { emitirTokenAcesso } from "../src/utils/jwt.util.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Gerenciamento de ambientes sonoros e composição com áudios", () => {
  const prefixoTeste = "test_amb_";

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
        nome: "Usuário Teste Ambiente",
        email: `${prefixoTeste}${randomUUID()}@teste.com`,
        senha: "hash-de-teste",
        dataNascimento: new Date("1995-05-15T00:00:00.000Z"),
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

  describe("Autenticação e bloqueios de acesso", () => {
    it("bloqueia operações sem autenticação com HTTP 401", async () => {
      const idInexistente = randomUUID();

      const criacao = await request(app).post("/ambientes-sonoros").send({
        nome: "Foco Matinal",
        finalidade: Finalidade.CONCENTRACAO,
        audios: [{ idAudio: idInexistente, volume: 50 }],
      });
      const listagem = await request(app).get("/ambientes-sonoros");
      const consulta = await request(app).get(`/ambientes-sonoros/${idInexistente}`);
      const edicao = await request(app).patch(`/ambientes-sonoros/${idInexistente}`).send({ nome: "Novo" });
      const exclusao = await request(app).delete(`/ambientes-sonoros/${idInexistente}`);

      expect(criacao.status).toBe(401);
      expect(criacao.body.erro.codigo).toBe("NAO_AUTENTICADO");
      expect(listagem.status).toBe(401);
      expect(consulta.status).toBe(401);
      expect(edicao.status).toBe(401);
      expect(exclusao.status).toBe(401);
    });
  });

  describe("Criação de ambiente sonoro e armazenamento de volumes", () => {
    it("cria ambiente com um áudio e armazena o volume individual corretamente", async () => {
      const usuario = await criarUsuario();
      const audioChuva = await criarAudio(usuario.id, "Chuva suave");

      const resposta = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Chuva para dormir",
          descricao: "Ambiente tranquilo de chuva",
          finalidade: "SONO",
          audios: [
            {
              idAudio: audioChuva.idAudio,
              volume: 65,
            },
          ],
        });

      expect(resposta.status).toBe(201);
      expect(resposta.body.mensagem).toBe("Ambiente sonoro criado com sucesso.");
      const ambiente = resposta.body.ambiente;
      expect(ambiente).toHaveProperty("idAmbienteSonoro");
      expect(ambiente.nome).toBe("Chuva para dormir");
      expect(ambiente.descricao).toBe("Ambiente tranquilo de chuva");
      expect(ambiente.finalidade).toBe("SONO");
      expect(ambiente.origem).toBe("personalizado");

      // Não deve vazar informações internas
      expect(ambiente).not.toHaveProperty("idUsuario");

      // Verifica composição e volume retornado
      expect(ambiente.audios).toHaveLength(1);
      expect(ambiente.audios[0].idAudio).toBe(audioChuva.idAudio);
      expect(ambiente.audios[0].volume).toBe(65);
      expect(ambiente.audios[0].titulo).toBe("Chuva suave");
      expect(ambiente.audios[0].arquivo).toBe(audioChuva.arquivo);
      expect(ambiente.audios[0]).not.toHaveProperty("arquivoPublicId");
      expect(ambiente.audios[0]).not.toHaveProperty("idUsuario");

      // Verifica no banco de dados se o volume está exclusivamente em AmbienteSonoroAudio
      const relacaoBanco = await prisma.ambienteSonoroAudio.findUnique({
        where: {
          idAmbienteSonoro_idAudio: {
            idAmbienteSonoro: ambiente.idAmbienteSonoro,
            idAudio: audioChuva.idAudio,
          },
        },
      });
      expect(relacaoBanco).not.toBeNull();
      expect(relacaoBanco?.volume).toBe(65);
    });

    it("cria ambiente com vários áudios e volumes distintos", async () => {
      const usuario = await criarUsuario();
      const audioChuva = await criarAudio(usuario.id, "Chuva");
      const audioTrovao = await criarAudio(usuario.id, "Trovão distante");
      const audioVento = await criarAudio(usuario.id, "Vento na janela");

      const resposta = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Tempestade Noturna",
          finalidade: "RELAXAMENTO",
          audios: [
            { idAudio: audioChuva.idAudio, volume: 80 },
            { idAudio: audioTrovao.idAudio, volume: 40 },
            { idAudio: audioVento.idAudio, volume: 25 },
          ],
        });

      expect(resposta.status).toBe(201);
      const ambiente = resposta.body.ambiente;
      expect(ambiente.audios).toHaveLength(3);

      const volumesMap = new Map(ambiente.audios.map((a: { idAudio: string; volume: number }) => [a.idAudio, a.volume]));
      expect(volumesMap.get(audioChuva.idAudio)).toBe(80);
      expect(volumesMap.get(audioTrovao.idAudio)).toBe(40);
      expect(volumesMap.get(audioVento.idAudio)).toBe(25);
    });

    it("reutiliza o mesmo áudio em ambientes diferentes com volumes diferentes", async () => {
      const usuarioA = await criarUsuario();
      const usuarioB = await criarUsuario();
      const audioCompartilhado = await criarAudio(usuarioA.id, "Chuva florestal");

      // Ambiente A com volume 50
      const respA = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuarioA)}`)
        .send({
          nome: "Ambiente A",
          finalidade: "ESTUDO",
          audios: [{ idAudio: audioCompartilhado.idAudio, volume: 50 }],
        });

      // Ambiente B com volume 80
      const respB = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuarioB)}`)
        .send({
          nome: "Ambiente B",
          finalidade: "MEDITACAO",
          audios: [{ idAudio: audioCompartilhado.idAudio, volume: 80 }],
        });

      expect(respA.status).toBe(201);
      expect(respB.status).toBe(201);

      const idAmbienteA = respA.body.ambiente.idAmbienteSonoro;
      const idAmbienteB = respB.body.ambiente.idAmbienteSonoro;

      const relA = await prisma.ambienteSonoroAudio.findUnique({
        where: {
          idAmbienteSonoro_idAudio: {
            idAmbienteSonoro: idAmbienteA,
            idAudio: audioCompartilhado.idAudio,
          },
        },
      });
      const relB = await prisma.ambienteSonoroAudio.findUnique({
        where: {
          idAmbienteSonoro_idAudio: {
            idAmbienteSonoro: idAmbienteB,
            idAudio: audioCompartilhado.idAudio,
          },
        },
      });

      expect(relA?.volume).toBe(50);
      expect(relB?.volume).toBe(80);

      // O áudio base permanece intacto
      const audioBanco = await prisma.audio.findUnique({
        where: { idAudio: audioCompartilhado.idAudio },
      });
      expect(audioBanco).not.toBeNull();
      expect(audioBanco?.titulo).toBe("Chuva florestal");
    });
  });

  describe("Validações de composição e dados", () => {
    it("rejeita áudio inexistente", async () => {
      const usuario = await criarUsuario();
      const idInexistente = randomUUID();

      const resposta = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Ambiente Inválido",
          finalidade: "ESTUDO",
          audios: [{ idAudio: idInexistente, volume: 50 }],
        });

      expect(resposta.status).toBe(404);
      expect(resposta.body.erro.codigo).toBe("AUDIO_NAO_ENCONTRADO");
    });

    it("rejeita áudio duplicado na mesma composição", async () => {
      const usuario = await criarUsuario();
      const audio = await criarAudio(usuario.id, "Som de pássaros");

      const resposta = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Ambiente com Duplicados",
          finalidade: "RELAXAMENTO",
          audios: [
            { idAudio: audio.idAudio, volume: 50 },
            { idAudio: audio.idAudio, volume: 75 },
          ],
        });

      expect(resposta.status).toBe(400);
      expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");
      expect(JSON.stringify(resposta.body.erro.detalhes)).toContain("duplicado");
    });

    it("rejeita volumes inválidos (menor que 0, maior que 100 ou não inteiro)", async () => {
      const usuario = await criarUsuario();
      const audio = await criarAudio(usuario.id, "Riacho");

      const volumeNegativo = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Volume Negativo",
          finalidade: "CONCENTRACAO",
          audios: [{ idAudio: audio.idAudio, volume: -1 }],
        });

      const volumeMaior100 = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Volume Acima",
          finalidade: "CONCENTRACAO",
          audios: [{ idAudio: audio.idAudio, volume: 101 }],
        });

      const volumeFracionado = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Volume Fracionado",
          finalidade: "CONCENTRACAO",
          audios: [{ idAudio: audio.idAudio, volume: 55.5 }],
        });

      expect(volumeNegativo.status).toBe(400);
      expect(volumeNegativo.body.erro.codigo).toBe("DADOS_INVALIDOS");

      expect(volumeMaior100.status).toBe(400);
      expect(volumeMaior100.body.erro.codigo).toBe("DADOS_INVALIDOS");

      expect(volumeFracionado.status).toBe(400);
      expect(volumeFracionado.body.erro.codigo).toBe("DADOS_INVALIDOS");
    });

    it("rejeita composição vazia", async () => {
      const usuario = await criarUsuario();

      const resposta = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Sem Áudios",
          finalidade: "TRABALHO",
          audios: [],
        });

      expect(resposta.status).toBe(400);
      expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");
    });

    it("rejeita finalidade fora do enum Finalidade", async () => {
      const usuario = await criarUsuario();
      const audio = await criarAudio(usuario.id, "Fogueira");

      const resposta = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Finalidade Inválida",
          finalidade: "FINALIDADE_INEXISTENTE",
          audios: [{ idAudio: audio.idAudio, volume: 50 }],
        });

      expect(resposta.status).toBe(400);
      expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");
    });

    it("rejeita campos adicionais não autorizados (ex.: idUsuario no body)", async () => {
      const usuario = await criarUsuario();
      const outroUsuario = await criarUsuario();
      const audio = await criarAudio(usuario.id, "Ruído branco");

      const resposta = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Tentando forjar proprietário",
          finalidade: "CONCENTRACAO",
          idUsuario: outroUsuario.id,
          audios: [{ idAudio: audio.idAudio, volume: 50 }],
        });

      expect(resposta.status).toBe(400);
      expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");
    });
  });

  describe("Consulta e listagem com isolamento entre usuários", () => {
    it("lista somente os ambientes pertencentes ao usuário autenticado", async () => {
      const usuarioA = await criarUsuario();
      const usuarioB = await criarUsuario();
      const audio = await criarAudio(usuarioA.id, "Ondas");

      // Cria 2 ambientes para usuarioA
      await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuarioA)}`)
        .send({
          nome: "Ambiente A1",
          finalidade: "ESTUDO",
          audios: [{ idAudio: audio.idAudio, volume: 40 }],
        });

      await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuarioA)}`)
        .send({
          nome: "Ambiente A2",
          finalidade: "RELAXAMENTO",
          audios: [{ idAudio: audio.idAudio, volume: 60 }],
        });

      // Cria 1 ambiente para usuarioB
      await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuarioB)}`)
        .send({
          nome: "Ambiente B1",
          finalidade: "SONO",
          audios: [{ idAudio: audio.idAudio, volume: 80 }],
        });

      const listagemA = await request(app)
        .get("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuarioA)}`);

      const listagemB = await request(app)
        .get("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuarioB)}`);

      expect(listagemA.status).toBe(200);
      expect(listagemA.body.ambientes).toHaveLength(2);
      expect(listagemA.body.ambientes.map((a: { nome: string }) => a.nome)).toEqual(
        expect.arrayContaining(["Ambiente A1", "Ambiente A2"])
      );

      expect(listagemB.status).toBe(200);
      expect(listagemB.body.ambientes).toHaveLength(1);
      expect(listagemB.body.ambientes[0].nome).toBe("Ambiente B1");
    });

    it("permite consulta individual de um ambiente do próprio usuário e inclui metadados e URLs", async () => {
      const usuario = await criarUsuario();
      const audio = await criarAudio(usuario.id, "Floresta tropical");

      const criacao = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Ambiente Detalhado",
          descricao: "Descrição completa do ambiente",
          finalidade: "MEDITACAO",
          audios: [{ idAudio: audio.idAudio, volume: 45 }],
        });

      const idAmbiente = criacao.body.ambiente.idAmbienteSonoro;

      const consulta = await request(app)
        .get(`/ambientes-sonoros/${idAmbiente}`)
        .set("Authorization", `Bearer ${token(usuario)}`);

      expect(consulta.status).toBe(200);
      expect(consulta.body.ambiente.idAmbienteSonoro).toBe(idAmbiente);
      expect(consulta.body.ambiente.nome).toBe("Ambiente Detalhado");
      expect(consulta.body.ambiente.audios).toHaveLength(1);
      expect(consulta.body.ambiente.audios[0]).toMatchObject({
        idAudio: audio.idAudio,
        volume: 45,
        titulo: "Floresta tropical",
        arquivo: audio.arquivo,
      });
      expect(consulta.body.ambiente.audios[0].arquivo).toMatch(/^https:\/\//);
      expect(consulta.body.ambiente.audios[0]).not.toHaveProperty("arquivoPublicId");
      expect(consulta.body.ambiente.audios[0]).not.toHaveProperty("idUsuario");
    });

    it("bloqueia acesso a ambiente de outro usuário com HTTP 404 (ocultando existência)", async () => {
      const usuarioA = await criarUsuario();
      const usuarioB = await criarUsuario();
      const audio = await criarAudio(usuarioA.id, "Chuva suave");

      const criacaoA = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuarioA)}`)
        .send({
          nome: "Ambiente Privado de A",
          finalidade: "ESTUDO",
          audios: [{ idAudio: audio.idAudio, volume: 50 }],
        });

      const idAmbienteA = criacaoA.body.ambiente.idAmbienteSonoro;

      const tentativaB = await request(app)
        .get(`/ambientes-sonoros/${idAmbienteA}`)
        .set("Authorization", `Bearer ${token(usuarioB)}`);

      expect(tentativaB.status).toBe(404);
      expect(tentativaB.body.erro.codigo).toBe("AMBIENTE_NAO_ENCONTRADO");
    });

    it("valida formato do ID de ambiente e retorna 404 para ID inexistente", async () => {
      const usuario = await criarUsuario();

      const respostaInvalido = await request(app)
        .get("/ambientes-sonoros/id-invalido")
        .set("Authorization", `Bearer ${token(usuario)}`);

      const respostaInexistente = await request(app)
        .get(`/ambientes-sonoros/${randomUUID()}`)
        .set("Authorization", `Bearer ${token(usuario)}`);

      expect(respostaInvalido.status).toBe(400);
      expect(respostaInvalido.body.erro.codigo).toBe("ID_AMBIENTE_INVALIDO");

      expect(respostaInexistente.status).toBe(404);
      expect(respostaInexistente.body.erro.codigo).toBe("AMBIENTE_NAO_ENCONTRADO");
    });
  });

  describe("Edição de ambiente e alteração da composição", () => {
    it("edita metadados sem alterar a composição existente", async () => {
      const usuario = await criarUsuario();
      const audio = await criarAudio(usuario.id, "Café movimentado");

      const criacao = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Cafeteria Original",
          descricao: "Sons de cafeteria",
          finalidade: "TRABALHO",
          audios: [{ idAudio: audio.idAudio, volume: 70 }],
        });

      const idAmbiente = criacao.body.ambiente.idAmbienteSonoro;

      const atualizacao = await request(app)
        .patch(`/ambientes-sonoros/${idAmbiente}`)
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Cafeteria Noturna",
          descricao: "Sons calmos de cafeteria à noite",
          finalidade: "CONCENTRACAO",
        });

      expect(atualizacao.status).toBe(200);
      expect(atualizacao.body.mensagem).toBe("Ambiente sonoro atualizado com sucesso.");
      expect(atualizacao.body.ambiente.nome).toBe("Cafeteria Noturna");
      expect(atualizacao.body.ambiente.descricao).toBe("Sons calmos de cafeteria à noite");
      expect(atualizacao.body.ambiente.finalidade).toBe("CONCENTRACAO");
      expect(atualizacao.body.ambiente.audios).toHaveLength(1);
      expect(atualizacao.body.ambiente.audios[0].volume).toBe(70);
    });

    it("altera a composição e os volumes em transação", async () => {
      const usuario = await criarUsuario();
      const audio1 = await criarAudio(usuario.id, "Chuva");
      const audio2 = await criarAudio(usuario.id, "Vento");
      const audio3 = await criarAudio(usuario.id, "Lareira");

      const criacao = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Cabana",
          finalidade: "RELAXAMENTO",
          audios: [
            { idAudio: audio1.idAudio, volume: 50 },
            { idAudio: audio2.idAudio, volume: 30 },
          ],
        });

      const idAmbiente = criacao.body.ambiente.idAmbienteSonoro;

      // Substitui a composição por audio2 com volume 60 e audio3 com volume 90
      const atualizacao = await request(app)
        .patch(`/ambientes-sonoros/${idAmbiente}`)
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          audios: [
            { idAudio: audio2.idAudio, volume: 60 },
            { idAudio: audio3.idAudio, volume: 90 },
          ],
        });

      expect(atualizacao.status).toBe(200);
      const ambienteAtualizado = atualizacao.body.ambiente;
      expect(ambienteAtualizado.audios).toHaveLength(2);

      const volumesMap = new Map(ambienteAtualizado.audios.map((a: { idAudio: string; volume: number }) => [a.idAudio, a.volume]));
      expect(volumesMap.has(audio1.idAudio)).toBe(false);
      expect(volumesMap.get(audio2.idAudio)).toBe(60);
      expect(volumesMap.get(audio3.idAudio)).toBe(90);

      // Confirma no banco de dados
      const relacaoAudio1 = await prisma.ambienteSonoroAudio.findUnique({
        where: {
          idAmbienteSonoro_idAudio: {
            idAmbienteSonoro: idAmbiente,
            idAudio: audio1.idAudio,
          },
        },
      });
      expect(relacaoAudio1).toBeNull();
    });

    it("bloqueia edição de ambiente de outro usuário", async () => {
      const usuarioA = await criarUsuario();
      const usuarioB = await criarUsuario();
      const audio = await criarAudio(usuarioA.id, "Piano suave");

      const criacaoA = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuarioA)}`)
        .send({
          nome: "Ambiente do A",
          finalidade: "ESTUDO",
          audios: [{ idAudio: audio.idAudio, volume: 50 }],
        });

      const idAmbiente = criacaoA.body.ambiente.idAmbienteSonoro;

      const tentativaEdicaoB = await request(app)
        .patch(`/ambientes-sonoros/${idAmbiente}`)
        .set("Authorization", `Bearer ${token(usuarioB)}`)
        .send({ nome: "Ambiente Hackeado" });

      expect(tentativaEdicaoB.status).toBe(404);
      expect(tentativaEdicaoB.body.erro.codigo).toBe("AMBIENTE_NAO_ENCONTRADO");

      // Confirma que não foi alterado
      const ambienteNoBanco = await prisma.ambienteSonoro.findUnique({
        where: { idAmbienteSonoro: idAmbiente },
      });
      expect(ambienteNoBanco?.nome).toBe("Ambiente do A");
    });

    it("rejeita atualização sem campos informados", async () => {
      const usuario = await criarUsuario();
      const audio = await criarAudio(usuario.id, "Som ambiente");

      const criacao = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Original",
          finalidade: "ESTUDO",
          audios: [{ idAudio: audio.idAudio, volume: 50 }],
        });

      const idAmbiente = criacao.body.ambiente.idAmbienteSonoro;

      const atualizacaoVazia = await request(app)
        .patch(`/ambientes-sonoros/${idAmbiente}`)
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({});

      expect(atualizacaoVazia.status).toBe(400);
      expect(atualizacaoVazia.body.erro.codigo).toBe("DADOS_INVALIDOS");
      expect(JSON.stringify(atualizacaoVazia.body.erro.detalhes)).toContain("Informe ao menos um campo para atualizar");
    });
  });

  describe("Exclusão de ambiente sonoro", () => {
    it("exclui o ambiente sem excluir os áudios associados do catálogo", async () => {
      const usuario = await criarUsuario();
      const audio1 = await criarAudio(usuario.id, "Chuva na serra");
      const audio2 = await criarAudio(usuario.id, "Passarinhos");

      const criacao = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Ambiente para Excluir",
          finalidade: "RELAXAMENTO",
          audios: [
            { idAudio: audio1.idAudio, volume: 50 },
            { idAudio: audio2.idAudio, volume: 70 },
          ],
        });

      const idAmbiente = criacao.body.ambiente.idAmbienteSonoro;

      const exclusao = await request(app)
        .delete(`/ambientes-sonoros/${idAmbiente}`)
        .set("Authorization", `Bearer ${token(usuario)}`);

      expect(exclusao.status).toBe(200);
      expect(exclusao.body.mensagem).toBe("Ambiente sonoro excluído com sucesso.");

      // Confirma que o ambiente foi excluído
      const ambienteNoBanco = await prisma.ambienteSonoro.findUnique({
        where: { idAmbienteSonoro: idAmbiente },
      });
      expect(ambienteNoBanco).toBeNull();

      // Confirma que as associações foram removidas
      const associacoes = await prisma.ambienteSonoroAudio.findMany({
        where: { idAmbienteSonoro: idAmbiente },
      });
      expect(associacoes).toHaveLength(0);

      // IMPORTANTE: Confirma que os áudios do catálogo NÃO foram excluídos
      const audio1NoBanco = await prisma.audio.findUnique({
        where: { idAudio: audio1.idAudio },
      });
      const audio2NoBanco = await prisma.audio.findUnique({
        where: { idAudio: audio2.idAudio },
      });
      expect(audio1NoBanco).not.toBeNull();
      expect(audio2NoBanco).not.toBeNull();
    });

    it("exclui ambiente associado a coleções sem excluir a coleção nem os áudios", async () => {
      const usuario = await criarUsuario();
      const audio = await criarAudio(usuario.id, "Rio na floresta");

      const criacao = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Ambiente em Coleção",
          finalidade: "ESTUDO",
          audios: [{ idAudio: audio.idAudio, volume: 50 }],
        });

      const idAmbiente = criacao.body.ambiente.idAmbienteSonoro;

      const colecao = await prisma.colecao.create({
        data: {
          idUsuario: usuario.id,
          nome: "Coleção de Foco",
          descricao: "Minha coleção de estudo",
        },
      });

      await prisma.colecaoAmbienteSonoro.create({
        data: {
          idColecao: colecao.idColecao,
          idAmbienteSonoro: idAmbiente,
        },
      });

      const exclusao = await request(app)
        .delete(`/ambientes-sonoros/${idAmbiente}`)
        .set("Authorization", `Bearer ${token(usuario)}`);

      expect(exclusao.status).toBe(200);

      // Relações em ColecaoAmbienteSonoro e AmbienteSonoroAudio foram limpas
      const associacoesColecao = await prisma.colecaoAmbienteSonoro.count({
        where: { idAmbienteSonoro: idAmbiente },
      });
      const associacoesAudio = await prisma.ambienteSonoroAudio.count({
        where: { idAmbienteSonoro: idAmbiente },
      });
      expect(associacoesColecao).toBe(0);
      expect(associacoesAudio).toBe(0);

      // A Coleção e o Áudio continuam existindo
      const colecaoNoBanco = await prisma.colecao.findUnique({
        where: { idColecao: colecao.idColecao },
      });
      const audioNoBanco = await prisma.audio.findUnique({
        where: { idAudio: audio.idAudio },
      });
      expect(colecaoNoBanco).not.toBeNull();
      expect(audioNoBanco).not.toBeNull();

      // Limpeza da coleção de teste criada
      await prisma.colecao.delete({ where: { idColecao: colecao.idColecao } });
    });

    it("bloqueia exclusão de ambiente pertencente a outro usuário", async () => {
      const usuarioA = await criarUsuario();
      const usuarioB = await criarUsuario();
      const audio = await criarAudio(usuarioA.id, "Música zen");

      const criacaoA = await request(app)
        .post("/ambientes-sonoros")
        .set("Authorization", `Bearer ${token(usuarioA)}`)
        .send({
          nome: "Ambiente Protegido de A",
          finalidade: "MEDITACAO",
          audios: [{ idAudio: audio.idAudio, volume: 50 }],
        });

      const idAmbiente = criacaoA.body.ambiente.idAmbienteSonoro;

      const tentativaExclusaoB = await request(app)
        .delete(`/ambientes-sonoros/${idAmbiente}`)
        .set("Authorization", `Bearer ${token(usuarioB)}`);

      expect(tentativaExclusaoB.status).toBe(404);
      expect(tentativaExclusaoB.body.erro.codigo).toBe("AMBIENTE_NAO_ENCONTRADO");

      // Confirma que continua existindo
      const ambienteAindaExiste = await prisma.ambienteSonoro.findUnique({
        where: { idAmbienteSonoro: idAmbiente },
      });
      expect(ambienteAindaExiste).not.toBeNull();
    });
  });

  describe("Suporte a alias de rota /ambientes", () => {
    it("permite criar, listar e consultar usando o caminho /ambientes", async () => {
      const usuario = await criarUsuario();
      const audio = await criarAudio(usuario.id, "Sons da noite");

      const criacao = await request(app)
        .post("/ambientes")
        .set("Authorization", `Bearer ${token(usuario)}`)
        .send({
          nome: "Noite Serena",
          finalidade: "SONO",
          audios: [{ idAudio: audio.idAudio, volume: 40 }],
        });

      expect(criacao.status).toBe(201);
      const idAmbiente = criacao.body.ambiente.idAmbienteSonoro;

      const listagem = await request(app)
        .get("/ambientes")
        .set("Authorization", `Bearer ${token(usuario)}`);
      expect(listagem.status).toBe(200);
      expect(listagem.body.ambientes).toHaveLength(1);

      const consulta = await request(app)
        .get(`/ambientes/${idAmbiente}`)
        .set("Authorization", `Bearer ${token(usuario)}`);
      expect(consulta.status).toBe(200);
      expect(consulta.body.ambiente.nome).toBe("Noite Serena");
    });
  });
});
