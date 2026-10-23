import { describe, it, expect, afterEach, beforeAll } from "vitest";
import request from "supertest";
import express from "express";
import { prisma } from "../lib/prisma.js";
import { Perfil } from "../generated/prisma/enums.js";
import { autenticar } from "../src/middlewares/autenticacao.middleware.js";
import { exigirPerfil } from "../src/middlewares/autorizacao.middleware.js";
import { tratadorDeErros } from "../src/middlewares/erro.middleware.js";
import { gerarHashSenha } from "../src/utils/senha.util.js";
import { emitirTokenAcesso } from "../src/utils/jwt.util.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Autorização RBAC — Middleware exigirPerfil", () => {
  describe("Testes Unitários (Isolados com Injeção de req.usuario)", () => {
    function criarAppTesteUnitario() {
      const app = express();
      app.use(express.json());

      // Middleware de simulação para injeção controlada de req.usuario nos testes unitários
      app.use("/unitario", (req, _res, next) => {
        const perfilHeader = req.headers["x-test-usuario-perfil"];
        if (perfilHeader === "ADMIN") {
          req.usuario = {
            id: "user-admin-uuid",
            nome: "Usuário Admin Teste",
            email: "admin@teste.com",
            perfil: Perfil.ADMIN,
            emailVerificado: true,
            versaoToken: 1,
            senhaAlteradaEm: null,
          };
        } else if (perfilHeader === "COMUM") {
          req.usuario = {
            id: "user-comum-uuid",
            nome: "Usuário Comum Teste",
            email: "comum@teste.com",
            perfil: Perfil.COMUM,
            emailVerificado: true,
            versaoToken: 1,
            senhaAlteradaEm: null,
          };
        }
        next();
      });

      // Rota sem usuário autenticado anexado
      app.get("/sem-usuario", exigirPerfil(Perfil.ADMIN), (_req, res) => {
        res.status(200).json({ ok: true });
      });

      // Rota restrita a administradores
      app.all("/unitario/admin", exigirPerfil(Perfil.ADMIN), (req, res) => {
        res.status(200).json({
          mensagem: "Acesso administrativo permitido.",
          perfil: req.usuario?.perfil,
        });
      });

      // Rota que aceita ambos os perfis (COMUM e ADMIN)
      app.get("/unitario/ambos", exigirPerfil(Perfil.COMUM, Perfil.ADMIN), (req, res) => {
        res.status(200).json({
          mensagem: "Acesso concedido.",
          perfil: req.usuario?.perfil,
        });
      });

      app.use(tratadorDeErros);
      return app;
    }

    const appUnitario = criarAppTesteUnitario();

    it("retorna HTTP 401 NAO_AUTENTICADO quando req.usuario não está definido", async () => {
      const resposta = await request(appUnitario).get("/sem-usuario");

      expect(resposta.status).toBe(401);
      expect(resposta.body).toEqual({
        erro: {
          codigo: "NAO_AUTENTICADO",
          mensagem: "Usuário não autenticado.",
          detalhes: [],
        },
      });
    });

    it("bloqueia usuário COMUM em rota exclusiva de ADMIN com HTTP 403 ACESSO_NEGADO", async () => {
      const resposta = await request(appUnitario)
        .get("/unitario/admin")
        .set("x-test-usuario-perfil", "COMUM");

      expect(resposta.status).toBe(403);
      expect(resposta.body).toEqual({
        erro: {
          codigo: "ACESSO_NEGADO",
          mensagem: "Acesso restrito. Seu perfil não possui permissão para acessar este recurso.",
          detalhes: [],
        },
      });
    });

    it("permite usuário ADMIN em rota exclusiva de ADMIN com HTTP 200", async () => {
      const resposta = await request(appUnitario)
        .get("/unitario/admin")
        .set("x-test-usuario-perfil", "ADMIN");

      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual({
        mensagem: "Acesso administrativo permitido.",
        perfil: "ADMIN",
      });
    });

    it("permite usuário COMUM quando a rota aceita explicitamente COMUM e ADMIN", async () => {
      const resposta = await request(appUnitario)
        .get("/unitario/ambos")
        .set("x-test-usuario-perfil", "COMUM");

      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual({
        mensagem: "Acesso concedido.",
        perfil: "COMUM",
      });
    });

    it("permite usuário ADMIN quando a rota aceita explicitamente COMUM e ADMIN", async () => {
      const resposta = await request(appUnitario)
        .get("/unitario/ambos")
        .set("x-test-usuario-perfil", "ADMIN");

      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual({
        mensagem: "Acesso concedido.",
        perfil: "ADMIN",
      });
    });

    it("ignora completamente manipulações do cliente em query, cabeçalhos ou body para elevar privilégio", async () => {
      const resposta = await request(appUnitario)
        .post("/unitario/admin?perfil=ADMIN&role=ADMIN")
        .set("x-test-usuario-perfil", "COMUM")
        .set("X-Perfil", "ADMIN")
        .set("X-Role", "ADMIN")
        .send({
          perfil: "ADMIN",
          role: "ADMIN",
          is_admin: true,
        });

      // Permanece barrado com 403 porque req.usuario.perfil é COMUM
      expect(resposta.status).toBe(403);
      expect(resposta.body.erro.codigo).toBe("ACESSO_NEGADO");
    });
  });

  describe("Testes de Integração com autenticar e Banco de Dados", () => {
    const prefixoTeste = "test_rbac_";

    beforeAll(async () => {
      await garantirBancoTestesIsolado();
    });

    afterEach(async () => {
      // Remove exclusivamente usuários criados durante esta suíte de testes
      await prisma.usuario.deleteMany({
        where: { email: { startsWith: prefixoTeste } },
      });
    });

    function criarAppIntegracao() {
      const app = express();
      app.use(express.json());

      // Pipeline completo de rotas protegidas por autenticar e exigirPerfil
      app.get(
        "/protegida/admin",
        autenticar,
        exigirPerfil(Perfil.ADMIN),
        (req, res) => {
          res.status(200).json({
            mensagem: "Acesso administrativo autorizado.",
            usuario: {
              id: req.usuario?.id,
              nome: req.usuario?.nome,
              perfil: req.usuario?.perfil,
            },
          });
        }
      );

      app.get(
        "/protegida/ambos",
        autenticar,
        exigirPerfil(Perfil.COMUM, Perfil.ADMIN),
        (req, res) => {
          res.status(200).json({
            mensagem: "Acesso geral autorizado.",
            usuario: {
              id: req.usuario?.id,
              perfil: req.usuario?.perfil,
            },
          });
        }
      );

      app.use(tratadorDeErros);
      return app;
    }

    const appIntegracao = criarAppIntegracao();

    async function criarUsuarioNoBanco(opcoes?: { perfil?: Perfil }) {
      const email = `${prefixoTeste}${Date.now()}_${Math.random().toString(36).substring(2, 8)}@teste.com`;
      const senhaHash = await gerarHashSenha("SenhaValida@123");

      return prisma.usuario.create({
        data: {
          nome: "Usuário Teste RBAC",
          email,
          senha: senhaHash,
          dataNascimento: new Date("1992-04-15"),
          emailVerificado: true,
          perfil: opcoes?.perfil ?? Perfil.COMUM,
        },
      });
    }

    it("bloqueia usuário COMUM com JWT real em rota restrita a ADMIN com HTTP 403 ACESSO_NEGADO", async () => {
      const usuario = await criarUsuarioNoBanco({ perfil: Perfil.COMUM });
      const token = emitirTokenAcesso({ sub: usuario.id, versaoToken: usuario.versaoToken });

      const resposta = await request(appIntegracao)
        .get("/protegida/admin")
        .set("Authorization", `Bearer ${token}`);

      expect(resposta.status).toBe(403);
      expect(resposta.body.erro.codigo).toBe("ACESSO_NEGADO");
    });

    it("autoriza usuário ADMIN com JWT real em rota restrita a ADMIN com HTTP 200", async () => {
      const usuario = await criarUsuarioNoBanco({ perfil: Perfil.ADMIN });
      const token = emitirTokenAcesso({ sub: usuario.id, versaoToken: usuario.versaoToken });

      const resposta = await request(appIntegracao)
        .get("/protegida/admin")
        .set("Authorization", `Bearer ${token}`);

      expect(resposta.status).toBe(200);
      expect(resposta.body.mensagem).toBe("Acesso administrativo autorizado.");
      expect(resposta.body.usuario.perfil).toBe("ADMIN");
    });

    it("autoriza usuário COMUM em rota configurada para aceitar COMUM e ADMIN", async () => {
      const usuario = await criarUsuarioNoBanco({ perfil: Perfil.COMUM });
      const token = emitirTokenAcesso({ sub: usuario.id, versaoToken: usuario.versaoToken });

      const resposta = await request(appIntegracao)
        .get("/protegida/ambos")
        .set("Authorization", `Bearer ${token}`);

      expect(resposta.status).toBe(200);
      expect(resposta.body.mensagem).toBe("Acesso geral autorizado.");
      expect(resposta.body.usuario.perfil).toBe("COMUM");
    });

    it("promoção de perfil no banco é refletida imediatamente com o MESMO JWT sem nova emissão", async () => {
      // 1. Cria usuário inicialmente como COMUM
      const usuario = await criarUsuarioNoBanco({ perfil: Perfil.COMUM });
      const tokenOriginal = emitirTokenAcesso({ sub: usuario.id, versaoToken: usuario.versaoToken });

      // 2. Tenta acessar a rota ADMIN com o token: deve ser bloqueado
      const respostaAntes = await request(appIntegracao)
        .get("/protegida/admin")
        .set("Authorization", `Bearer ${tokenOriginal}`);
      expect(respostaAntes.status).toBe(403);
      expect(respostaAntes.body.erro.codigo).toBe("ACESSO_NEGADO");

      // 3. Promove o usuário diretamente no banco de dados para ADMIN
      await prisma.usuario.update({
        where: { id: usuario.id },
        data: { perfil: Perfil.ADMIN },
      });

      // 4. Reenvia a requisição utilizando EXATAMENTE o mesmo token JWT original (sem reemissão)
      const respostaDepois = await request(appIntegracao)
        .get("/protegida/admin")
        .set("Authorization", `Bearer ${tokenOriginal}`);

      // 5. O acesso agora DEVE ser concedido porque autenticar busca o perfil atualizado do banco
      expect(respostaDepois.status).toBe(200);
      expect(respostaDepois.body.mensagem).toBe("Acesso administrativo autorizado.");
      expect(respostaDepois.body.usuario.perfil).toBe("ADMIN");
    });

    it("rebaixamento de perfil no banco é refletido imediatamente com o MESMO JWT revogando o acesso a rota ADMIN", async () => {
      // 1. Cria usuário inicialmente como ADMIN
      const usuario = await criarUsuarioNoBanco({ perfil: Perfil.ADMIN });
      const tokenOriginal = emitirTokenAcesso({ sub: usuario.id, versaoToken: usuario.versaoToken });

      // 2. Acessa a rota ADMIN com o token: autorizado com HTTP 200
      const respostaAntes = await request(appIntegracao)
        .get("/protegida/admin")
        .set("Authorization", `Bearer ${tokenOriginal}`);
      expect(respostaAntes.status).toBe(200);
      expect(respostaAntes.body.usuario.perfil).toBe("ADMIN");

      // 3. Rebaixa o perfil do usuário para COMUM no banco de dados
      await prisma.usuario.update({
        where: { id: usuario.id },
        data: { perfil: Perfil.COMUM },
      });

      // 4. Reenvia a requisição utilizando o MESMO token JWT original
      const respostaDepois = await request(appIntegracao)
        .get("/protegida/admin")
        .set("Authorization", `Bearer ${tokenOriginal}`);

      // 5. O acesso agora DEVE ser bloqueado imediatamente
      expect(respostaDepois.status).toBe(403);
      expect(respostaDepois.body.erro.codigo).toBe("ACESSO_NEGADO");
    });

    it("rejeita requisições sem token na rota protegida com HTTP 401 NAO_AUTENTICADO", async () => {
      const resposta = await request(appIntegracao).get("/protegida/admin");

      expect(resposta.status).toBe(401);
      expect(resposta.body.erro.codigo).toBe("NAO_AUTENTICADO");
    });
  });
});
