import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { Perfil } from "../generated/prisma/enums.js";
import { emitirTokenAcesso } from "../src/utils/jwt.util.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Atualização da própria data de nascimento — PATCH /autenticacao/eu/data-nascimento", () => {
  const prefixoTeste = "test_data_nascimento_";

  beforeAll(async () => {
    await garantirBancoTestesIsolado();
  });

  afterEach(async () => {
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
        dataNascimento: new Date("1994-06-20T00:00:00.000Z"),
        emailVerificado: true,
        perfil,
      },
    });
  }

  function criarToken(idUsuario: string, versaoToken: number): string {
    return emitirTokenAcesso({ sub: idUsuario, versaoToken });
  }

  it.each([Perfil.COMUM, Perfil.ADMIN])(
    "permite que usuário %s atualize a própria data de nascimento",
    async (perfil) => {
      const usuario = await criarUsuarioTeste(perfil);
      const token = criarToken(usuario.id, usuario.versaoToken);

      const resposta = await request(app)
        .patch("/autenticacao/eu/data-nascimento")
        .set("Authorization", `Bearer ${token}`)
        .send({ dataNascimento: "2000-05-20" });

      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual({
        mensagem: "Data de nascimento atualizada com sucesso.",
        usuario: {
          id: usuario.id,
          nome: usuario.nome,
          email: usuario.email,
          perfil,
          dataNascimento: "2000-05-20T00:00:00.000Z",
        },
      });

      const usuarioAtualizado = await prisma.usuario.findUniqueOrThrow({
        where: { id: usuario.id },
      });
      expect(usuarioAtualizado.dataNascimento.toISOString()).toBe(
        "2000-05-20T00:00:00.000Z"
      );
      expect(usuarioAtualizado).toMatchObject({
        nome: usuario.nome,
        email: usuario.email,
        senha: usuario.senha,
        perfil,
        versaoToken: usuario.versaoToken,
        emailVerificado: usuario.emailVerificado,
      });
    }
  );

  it("rejeita a requisição sem autenticação antes de validar o corpo", async () => {
    const resposta = await request(app)
      .patch("/autenticacao/eu/data-nascimento")
      .send({});

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
    ["vazia", { dataNascimento: "" }],
    ["com tipo incorreto", { dataNascimento: 20000101 }],
    ["com formato inválido", { dataNascimento: "20/05/2000" }],
    ["com dia inexistente", { dataNascimento: "2001-02-29" }],
    ["com data futura", { dataNascimento: obterDataFutura() }],
    ["anterior a 1900-01-01", { dataNascimento: "1899-12-31" }],
    ["com menos de 16 anos", { dataNascimento: obterDataHa15Anos() }],
  ])("rejeita data de nascimento %s sem alterar a conta", async (_caso, corpo) => {
    const usuario = await criarUsuarioTeste();
    const token = criarToken(usuario.id, usuario.versaoToken);

    const resposta = await request(app)
      .patch("/autenticacao/eu/data-nascimento")
      .set("Authorization", `Bearer ${token}`)
      .send(corpo);

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");

    const usuarioSemAlteracao = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuario.id },
    });
    expect(usuarioSemAlteracao.dataNascimento).toEqual(usuario.dataNascimento);
  });

  it("rejeita campos adicionais e protegidos sem modificar nenhum campo", async () => {
    const usuario = await criarUsuarioTeste();
    const token = criarToken(usuario.id, usuario.versaoToken);

    const resposta = await request(app)
      .patch("/autenticacao/eu/data-nascimento")
      .set("Authorization", `Bearer ${token}`)
      .send({
        dataNascimento: "2000-05-20",
        id: randomUUID(),
        idUsuario: randomUUID(),
        nome: "Nome Indevido",
        email: "alterado@teste.com",
        senha: "SenhaForte@123",
        perfil: Perfil.ADMIN,
        fotoPerfil: "https://exemplo.com/foto.png",
      });

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");

    const usuarioSemAlteracao = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuario.id },
    });
    expect(usuarioSemAlteracao).toMatchObject({
      nome: usuario.nome,
      email: usuario.email,
      senha: usuario.senha,
      perfil: usuario.perfil,
      dataNascimento: usuario.dataNascimento,
      fotoPerfil: usuario.fotoPerfil,
      versaoToken: usuario.versaoToken,
    });
  });

  it("sempre atualiza o usuário autenticado e não o identificador indicado na query", async () => {
    const usuarioAutenticado = await criarUsuarioTeste();
    const outroUsuario = await criarUsuarioTeste(Perfil.ADMIN);
    const token = criarToken(
      usuarioAutenticado.id,
      usuarioAutenticado.versaoToken
    );

    const resposta = await request(app)
      .patch(
        `/autenticacao/eu/data-nascimento?id=${encodeURIComponent(outroUsuario.id)}`
      )
      .set("Authorization", `Bearer ${token}`)
      .send({ dataNascimento: "2000-05-20" });

    expect(resposta.status).toBe(200);
    expect(resposta.body.usuario.id).toBe(usuarioAutenticado.id);

    const outroUsuarioSemAlteracao = await prisma.usuario.findUniqueOrThrow({
      where: { id: outroUsuario.id },
    });
    expect(outroUsuarioSemAlteracao.dataNascimento).toEqual(
      outroUsuario.dataNascimento
    );
  });

  it("não expõe campos internos e mantém válido o token da sessão atual", async () => {
    const usuario = await criarUsuarioTeste();
    const token = criarToken(usuario.id, usuario.versaoToken);

    const respostaAtualizacao = await request(app)
      .patch("/autenticacao/eu/data-nascimento")
      .set("Authorization", `Bearer ${token}`)
      .send({ dataNascimento: "2000-05-20" });

    expect(respostaAtualizacao.status).toBe(200);
    expect(respostaAtualizacao.body.usuario).not.toHaveProperty("senha");
    expect(respostaAtualizacao.body.usuario).not.toHaveProperty("versaoToken");
    expect(respostaAtualizacao.body.usuario).not.toHaveProperty("tokenHash");
    expect(respostaAtualizacao.body).not.toHaveProperty("refreshToken");

    const respostaComTokenExistente = await request(app)
      .get("/autenticacao/eu")
      .set("Authorization", `Bearer ${token}`);

    expect(respostaComTokenExistente.status).toBe(200);
    expect(respostaComTokenExistente.body.usuario.id).toBe(usuario.id);
  });
});

function obterDataFutura(): string {
  const amanha = new Date();
  amanha.setUTCDate(amanha.getUTCDate() + 1);
  return amanha.toISOString().slice(0, 10);
}

function obterDataHa15Anos(): string {
  const data = new Date();
  data.setUTCFullYear(data.getUTCFullYear() - 15);
  return data.toISOString().slice(0, 10);
}
