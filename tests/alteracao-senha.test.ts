import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { Perfil, StatusSessao } from "../generated/prisma/enums.js";
import { emitirTokenAcesso } from "../src/utils/jwt.util.js";
import { gerarHashSenha, verificarSenha } from "../src/utils/senha.util.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Alteração da própria senha — PATCH /autenticacao/eu/senha", () => {
  const prefixoTeste = "test_alteracao_senha_";
  const idsUsuariosCriados = new Set<string>();
  const senhaAtual = "SenhaAtual@123";
  const novaSenha = "NovaSenhaForte@456";

  beforeAll(async () => {
    await garantirBancoTestesIsolado();
  });

  afterEach(async () => {
    if (idsUsuariosCriados.size > 0) {
      const ids = Array.from(idsUsuariosCriados);
      idsUsuariosCriados.clear();
      await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    }
  });

  async function criarAdministrador() {
    const usuario = await prisma.usuario.create({
      data: {
        nome: "Administrador Teste",
        email: `${prefixoTeste}${randomUUID()}@teste.com`,
        senha: await gerarHashSenha(senhaAtual),
        dataNascimento: new Date("1990-01-01"),
        emailVerificado: true,
        perfil: Perfil.ADMIN,
      },
    });
    idsUsuariosCriados.add(usuario.id);
    return usuario;
  }

  function criarToken(idUsuario: string, versaoToken: number): string {
    return emitirTokenAcesso({ sub: idUsuario, versaoToken });
  }

  function requisitarAlteracao(
    token: string,
    corpo: Record<string, unknown> = {
      senhaAtual,
      novaSenha,
      confirmarNovaSenha: novaSenha,
    }
  ) {
    return request(app)
      .patch("/autenticacao/eu/senha")
      .set("Authorization", `Bearer ${token}`)
      .send(corpo);
  }

  it("altera a senha, incrementa a versão e revoga todas as sessões ativas", async () => {
    const usuario = await criarAdministrador();
    const tokenAcessoAntigo = criarToken(usuario.id, usuario.versaoToken);
    const sessoesAtivas = await Promise.all(
      [1, 2].map((n) =>
        prisma.sessao.create({
          data: {
            idUsuario: usuario.id,
            tokenHash: `sessao-alteracao-senha-${n}-${randomUUID()}`,
            status: StatusSessao.ATIVA,
            expiraEm: new Date(Date.now() + 60_000),
          },
        })
      )
    );
    const sessaoEncerrada = await prisma.sessao.create({
      data: {
        idUsuario: usuario.id,
        tokenHash: `sessao-encerrada-${randomUUID()}`,
        status: StatusSessao.ENCERRADA,
        expiraEm: new Date(Date.now() + 60_000),
      },
    });

    const resposta = await requisitarAlteracao(tokenAcessoAntigo);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      mensagem: "Senha alterada com sucesso. Faça login novamente.",
    });

    const usuarioAtualizado = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioAtualizado).not.toBeNull();
    expect(usuarioAtualizado!.senha).not.toBe(novaSenha);
    expect(await verificarSenha(usuarioAtualizado!.senha, novaSenha)).toBe(true);
    expect(usuarioAtualizado!.versaoToken).toBe(usuario.versaoToken + 1);
    expect(usuarioAtualizado!.senhaAlteradaEm).toBeInstanceOf(Date);

    const sessoesAtualizadas = await Promise.all([
      ...sessoesAtivas.map(({ id }) =>
        prisma.sessao.findUnique({ where: { id } })
      ),
      prisma.sessao.findUnique({ where: { id: sessaoEncerrada.id } }),
    ]);
    expect(sessoesAtualizadas.slice(0, 2).map((sessao) => sessao?.status)).toEqual([
      StatusSessao.REVOGADA,
      StatusSessao.REVOGADA,
    ]);
    expect(sessoesAtualizadas[2]?.status).toBe(StatusSessao.ENCERRADA);

    const respostaTokenAntigo = await request(app)
      .get("/autenticacao/eu")
      .set("Authorization", `Bearer ${tokenAcessoAntigo}`);
    expect(respostaTokenAntigo.status).toBe(401);
    expect(respostaTokenAntigo.body.erro.codigo).toBe("TOKEN_INVALIDO");
  });

  it("rejeita senha atual incorreta sem alterar a senha", async () => {
    const usuario = await criarAdministrador();
    const resposta = await requisitarAlteracao(
      criarToken(usuario.id, usuario.versaoToken),
      { senhaAtual: "SenhaErrada@123", novaSenha, confirmarNovaSenha: novaSenha }
    );

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("SENHA_ATUAL_INVALIDA");
    const usuarioAtualizado = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioAtualizado?.senha).toBe(usuario.senha);
  });

  it("rejeita nova senha fora dos critérios de segurança", async () => {
    const usuario = await criarAdministrador();
    const resposta = await requisitarAlteracao(
      criarToken(usuario.id, usuario.versaoToken),
      { senhaAtual, novaSenha: "fraca", confirmarNovaSenha: "fraca" }
    );

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");
  });

  it("rejeita confirmação diferente da nova senha", async () => {
    const usuario = await criarAdministrador();
    const resposta = await requisitarAlteracao(
      criarToken(usuario.id, usuario.versaoToken),
      {
        senhaAtual,
        novaSenha,
        confirmarNovaSenha: "OutraSenhaForte@789",
      }
    );

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("DADOS_INVALIDOS");
  });

  it("rejeita nova senha igual à senha atual", async () => {
    const usuario = await criarAdministrador();
    const resposta = await requisitarAlteracao(
      criarToken(usuario.id, usuario.versaoToken),
      {
        senhaAtual,
        novaSenha: senhaAtual,
        confirmarNovaSenha: senhaAtual,
      }
    );

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("NOVA_SENHA_IGUAL_ATUAL");
  });

  it("rejeita requisição sem autenticação", async () => {
    const resposta = await request(app)
      .patch("/autenticacao/eu/senha")
      .send({ senhaAtual, novaSenha, confirmarNovaSenha: novaSenha });

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("NAO_AUTENTICADO");
  });
});
