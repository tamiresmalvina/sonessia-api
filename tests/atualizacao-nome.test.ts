import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { Perfil } from "../generated/prisma/enums.js";
import { emitirTokenAcesso } from "../src/utils/jwt.util.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Atualização do próprio nome — PATCH /autenticacao/eu", () => {
  const prefixoTeste = "test_nome_";

  beforeAll(async () => {
    await garantirBancoTestesIsolado();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: prefixoTeste } },
    });
  });

  async function criarUsuarioTeste(perfil: Perfil = Perfil.COMUM) {
    return prisma.usuario.create({
      data: {
        nome: "Nome Original",
        email: `${prefixoTeste}${randomUUID()}@teste.com`,
        senha: "hash-de-teste",
        dataNascimento: new Date("1994-06-20"),
        emailVerificado: true,
        perfil,
      },
    });
  }

  function criarToken(idUsuario: string, versaoToken: number): string {
    return emitirTokenAcesso({ sub: idUsuario, versaoToken });
  }

  it.each([Perfil.COMUM, Perfil.ADMIN])(
    "permite que usuário %s altere o próprio nome",
    async (perfil) => {
      const usuario = await criarUsuarioTeste(perfil);
      const token = criarToken(usuario.id, usuario.versaoToken);

      const resposta = await request(app)
        .patch("/autenticacao/eu")
        .set("Authorization", `Bearer ${token}`)
        .send({ nome: "  Novo Nome  " });

      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual({
        mensagem: "Nome atualizado com sucesso.",
        usuario: {
          id: usuario.id,
          nome: "Novo Nome",
          email: usuario.email,
          perfil,
        },
      });

      const usuarioAtualizado = await prisma.usuario.findUnique({
        where: { id: usuario.id },
      });
      expect(usuarioAtualizado).toEqual({
        ...usuario,
        nome: "Novo Nome",
      });
    }
  );

  it("rejeita a requisição sem autenticação no formato padrão de erro", async () => {
    const resposta = await request(app)
      .patch("/autenticacao/eu")
      .send({ nome: "Novo Nome" });

    expect(resposta.status).toBe(401);
    expect(resposta.body).toEqual({
      erro: {
        codigo: "NAO_AUTENTICADO",
        mensagem: "Token de acesso não fornecido.",
        detalhes: [],
      },
    });
  });

  it.each([
    ["ausente", {}],
    ["vazio", { nome: "" }],
    ["somente espaços", { nome: "   " }],
    ["curto demais", { nome: "A" }],
    ["inválido", { nome: 123 }],
    ["longo demais", { nome: "N".repeat(101) }],
  ])("rejeita nome %s com erro de validação padronizado", async (_caso, corpo) => {
    const usuario = await criarUsuarioTeste();
    const token = criarToken(usuario.id, usuario.versaoToken);

    const resposta = await request(app)
      .patch("/autenticacao/eu")
      .set("Authorization", `Bearer ${token}`)
      .send(corpo);

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");
    expect(resposta.body.erro).toHaveProperty("mensagem");
    expect(Array.isArray(resposta.body.erro.detalhes)).toBe(true);

    const usuarioSemAlteracao = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioSemAlteracao?.nome).toBe(usuario.nome);
  });

  it("rejeita campos extras e protegidos sem alterar dados do usuário", async () => {
    const usuario = await criarUsuarioTeste();
    const token = criarToken(usuario.id, usuario.versaoToken);

    const resposta = await request(app)
      .patch("/autenticacao/eu")
      .set("Authorization", `Bearer ${token}`)
      .send({
        nome: "Nome Alterado Indevidamente",
        id: randomUUID(),
        idUsuario: randomUUID(),
        email: "alterado@teste.com",
        senha: "SenhaForte@123",
        perfil: Perfil.ADMIN,
        dataNascimento: "2000-01-01",
        fotoPerfil: "https://exemplo.com/foto.png",
        versaoToken: 99,
      });

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");

    const usuarioSemAlteracao = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioSemAlteracao).toMatchObject({
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      senha: usuario.senha,
      perfil: Perfil.COMUM,
      dataNascimento: usuario.dataNascimento,
      fotoPerfil: usuario.fotoPerfil,
      versaoToken: usuario.versaoToken,
    });
  });

  it("usa a identidade autenticada e ignora identificadores de terceiros na query", async () => {
    const usuarioAutenticado = await criarUsuarioTeste(Perfil.COMUM);
    const outroUsuario = await criarUsuarioTeste(Perfil.ADMIN);
    const token = criarToken(
      usuarioAutenticado.id,
      usuarioAutenticado.versaoToken
    );

    const resposta = await request(app)
      .patch(`/autenticacao/eu?id=${outroUsuario.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ nome: "Nome do Usuário Autenticado" });

    expect(resposta.status).toBe(200);
    expect(resposta.body.usuario.id).toBe(usuarioAutenticado.id);
    expect(resposta.body.usuario.nome).toBe("Nome do Usuário Autenticado");

    const outroUsuarioSemAlteracao = await prisma.usuario.findUnique({
      where: { id: outroUsuario.id },
    });
    expect(outroUsuarioSemAlteracao?.nome).toBe(outroUsuario.nome);
    expect(outroUsuarioSemAlteracao?.perfil).toBe(Perfil.ADMIN);
  });

  it("não expõe senha, hashes, tokens ou campos internos na resposta", async () => {
    const usuario = await criarUsuarioTeste();
    const token = criarToken(usuario.id, usuario.versaoToken);

    const resposta = await request(app)
      .patch("/autenticacao/eu")
      .set("Authorization", `Bearer ${token}`)
      .send({ nome: "Nome Público" });

    expect(resposta.status).toBe(200);
    expect(resposta.body.usuario).toEqual({
      id: usuario.id,
      nome: "Nome Público",
      email: usuario.email,
      perfil: Perfil.COMUM,
    });
    expect(resposta.body.usuario).not.toHaveProperty("senha");
    expect(resposta.body.usuario).not.toHaveProperty("senhaAlteradaEm");
    expect(resposta.body.usuario).not.toHaveProperty("versaoToken");
    expect(resposta.body.usuario).not.toHaveProperty("tokenHash");
    expect(resposta.body.usuario).not.toHaveProperty("codigoHash");
    expect(resposta.body).not.toHaveProperty("refreshToken");
  });

  it("não executa atualização no banco quando o nome já é igual", async () => {
    const usuario = await criarUsuarioTeste();
    const token = criarToken(usuario.id, usuario.versaoToken);
    const atualizacaoUsuarioSpy = vi.spyOn(prisma.usuario, "update");

    const resposta = await request(app)
      .patch("/autenticacao/eu")
      .set("Authorization", `Bearer ${token}`)
      .send({ nome: usuario.nome });

    expect(resposta.status).toBe(200);
    expect(resposta.body.usuario.nome).toBe(usuario.nome);
    expect(atualizacaoUsuarioSpy).not.toHaveBeenCalled();
  });
});
