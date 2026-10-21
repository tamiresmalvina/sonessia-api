import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { definirInterceptadorEmailTeste } from "../src/utils/email.util.js";
import { reenviarCodigoVerificacao } from "../src/services/autenticacao.service.js";

describe("Fluxo de Verificação e Reenvio de Código", () => {
  const prefixoTeste = "test_verif_";
  let ultimoCodigoCapturado = "";

  beforeEach(() => {
    ultimoCodigoCapturado = "";
    definirInterceptadorEmailTeste(async (params) => {
      ultimoCodigoCapturado = params.codigo;
      return { sucesso: true, mensagemId: "mock-test-id" };
    });
  });

  afterEach(async () => {
    definirInterceptadorEmailTeste(null);
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: prefixoTeste } },
    });
  });

  async function cadastrarUsuarioTeste(sufixo: string) {
    const email = `${prefixoTeste}${sufixo}_${Date.now()}@teste.com`;
    const resposta = await request(app).post("/autenticacao/cadastro").send({
      nome: "Usuario Teste Verificacao",
      email,
      senha: "SenhaSeguraForte@123",
      dataNascimento: "1993-08-20",
    });

    return { email, codigo: ultimoCodigoCapturado, resposta };
  }

  describe("POST /autenticacao/verificar-email", () => {
    it("código correto verifica a conta com sucesso", async () => {
      const { email, codigo } = await cadastrarUsuarioTeste("sucesso");

      const resposta = await request(app)
        .post("/autenticacao/verificar-email")
        .send({ email, codigo });

      expect(resposta.status).toBe(200);
      expect(resposta.body.mensagem).toContain("verificado com sucesso");

      const usuarioBanco = await prisma.usuario.findUnique({
        where: { email },
      });
      expect(usuarioBanco?.emailVerificado).toBe(true);

      const codigoBanco = await prisma.codigoVerificacaoEmail.findFirst({
        where: { usuario: { email } },
      });
      expect(codigoBanco?.usado).toBe(true);
    });

    it("código incorreto incrementa tentativas", async () => {
      const { email } = await cadastrarUsuarioTeste("erro_tentativa");

      const resposta = await request(app)
        .post("/autenticacao/verificar-email")
        .send({ email, codigo: "000000" });

      expect(resposta.status).toBe(400);
      expect(resposta.body.erro.codigo).toBe("CODIGO_INCORRETO");

      const codigoBanco = await prisma.codigoVerificacaoEmail.findFirst({
        where: { usuario: { email } },
      });
      expect(codigoBanco?.tentativas).toBe(1);
      expect(codigoBanco?.usado).toBe(false);
    });

    it("quinta tentativa incorreta invalida o código", async () => {
      const { email } = await cadastrarUsuarioTeste("limite_tentativas");

      // Executa 4 tentativas incorretas
      for (let i = 1; i <= 4; i++) {
        const res = await request(app)
          .post("/autenticacao/verificar-email")
          .send({ email, codigo: "111111" });
        expect(res.status).toBe(400);
        expect(res.body.erro.codigo).toBe("CODIGO_INCORRETO");
      }

      // Quinta tentativa incorreta: atinge o limite e invalida
      const quintaResposta = await request(app)
        .post("/autenticacao/verificar-email")
        .send({ email, codigo: "111111" });

      expect(quintaResposta.status).toBe(400);
      expect(quintaResposta.body.erro.codigo).toBe(
        "LIMITE_TENTATIVAS_EXCEDIDO",
      );

      const codigoBanco = await prisma.codigoVerificacaoEmail.findFirst({
        where: { usuario: { email } },
      });
      expect(codigoBanco?.tentativas).toBe(5);
      expect(codigoBanco?.usado).toBe(true); // Marcado como usado/invalido
    });

    it("código expirado é rejeitado com HTTP 400", async () => {
      const { email, codigo } = await cadastrarUsuarioTeste("expirado");

      // Força expiração no banco para simular o tempo decorrido
      await prisma.codigoVerificacaoEmail.updateMany({
        where: { usuario: { email } },
        data: { expiraEm: new Date(Date.now() - 1000) },
      });

      const resposta = await request(app)
        .post("/autenticacao/verificar-email")
        .send({ email, codigo });

      expect(resposta.status).toBe(400);
      expect(resposta.body.erro.codigo).toBe("CODIGO_EXPIRADO");

      const usuarioBanco = await prisma.usuario.findUnique({
        where: { email },
      });
      expect(usuarioBanco?.emailVerificado).toBe(false);
    });

    it("código consumido não pode ser reutilizado", async () => {
      const { email, codigo } = await cadastrarUsuarioTeste("reuso");

      // Primeiro consumo: sucesso
      const primeira = await request(app)
        .post("/autenticacao/verificar-email")
        .send({ email, codigo });
      expect(primeira.status).toBe(200);

      // Segundo consumo: deve ser rejeitado
      const segunda = await request(app)
        .post("/autenticacao/verificar-email")
        .send({ email, codigo });
      expect(segunda.status).toBe(400);
    });

    it("requisições concorrentes não consomem o mesmo código simultaneamente", async () => {
      const { email, codigo } = await cadastrarUsuarioTeste("concorrencia");

      // Dispara 5 requisições de verificação exatamente ao mesmo tempo com o mesmo código
      const promessas = Array.from({ length: 5 }).map(() =>
        request(app)
          .post("/autenticacao/verificar-email")
          .send({ email, codigo }),
      );

      const resultados = await Promise.all(promessas);

      // Exatamente UMA requisição deve ter sucesso (200) e as demais devem falhar (400)
      const sucessos = resultados.filter((r) => r.status === 200);
      const falhas = resultados.filter((r) => r.status === 400);

      expect(sucessos.length).toBe(1);
      expect(falhas.length).toBe(4);
    });

    it("tentativas simultâneas de verificação não ultrapassam o limite de cinco tentativas", async () => {
      const { email } = await cadastrarUsuarioTeste("tentativas_concorrentes");

      // Dispara 8 requisições simultâneas com código incorreto
      const promessas = Array.from({ length: 8 }).map(() =>
        request(app)
          .post("/autenticacao/verificar-email")
          .send({ email, codigo: "000000" }),
      );

      const resultados = await Promise.all(promessas);

      // Todas devem falhar com 400 (seja CODIGO_INCORRETO ou LIMITE_TENTATIVAS_EXCEDIDO)
      for (const res of resultados) {
        expect(res.status).toBe(400);
      }

      // No banco de dados, o número total de tentativas NUNCA pode exceder 5
      const codigoBanco = await prisma.codigoVerificacaoEmail.findFirst({
        where: { usuario: { email } },
        orderBy: { criadoEm: "desc" },
      });

      expect(codigoBanco).not.toBeNull();
      expect(codigoBanco?.tentativas).toBe(5);
      expect(codigoBanco?.usado).toBe(true);
    });

    it("garante que apenas um código válido exista por usuário e códigos anteriores invalidados sejam rejeitados", async () => {
      const { email, codigo: primeiroCodigo } =
        await cadastrarUsuarioTeste("unico_valido");

      // Avança a data para contornar o cooldown e permitir reenvio
      await prisma.codigoVerificacaoEmail.updateMany({
        where: { usuario: { email } },
        data: { criadoEm: new Date(Date.now() - 70 * 1000) },
      });

      await request(app).post("/autenticacao/reenviar-codigo").send({ email });

      const segundoCodigo = ultimoCodigoCapturado;
      expect(segundoCodigo).not.toBe(primeiroCodigo);

      // O primeiro código foi invalidado e não pode ser aceito
      const resPrimeiro = await request(app)
        .post("/autenticacao/verificar-email")
        .send({ email, codigo: primeiroCodigo });

      expect(resPrimeiro.status).toBe(400);

      // Apenas o segundo código funciona para verificar a conta
      const resSegundo = await request(app)
        .post("/autenticacao/verificar-email")
        .send({ email, codigo: segundoCodigo });

      expect(resSegundo.status).toBe(200);

      const usuarioBanco = await prisma.usuario.findUnique({
        where: { email },
      });
      expect(usuarioBanco?.emailVerificado).toBe(true);
    });
  });

  describe("POST /autenticacao/reenviar-codigo", () => {
    it("reenvio antes de 60 segundos é limitado com HTTP 429", async () => {
      const { email } = await cadastrarUsuarioTeste("cooldown");

      // Tenta reenviar imediatamente (< 60 segundos após o cadastro)
      const resposta = await request(app)
        .post("/autenticacao/reenviar-codigo")
        .send({ email });

      expect(resposta.status).toBe(429);
      expect(resposta.body.erro.codigo).toBe("INTERVALO_REENVIO");
    });

    it("reenvio válido invalida o código anterior e gera um novo código funcional", async () => {
      const { email, codigo: primeiroCodigo } =
        await cadastrarUsuarioTeste("reenvio_valido");

      // Simula passagem de tempo de 65 segundos no código anterior
      await prisma.codigoVerificacaoEmail.updateMany({
        where: { usuario: { email } },
        data: { criadoEm: new Date(Date.now() - 65 * 1000) },
      });

      const respostaReenvio = await request(app)
        .post("/autenticacao/reenviar-codigo")
        .send({ email });

      expect(respostaReenvio.status).toBe(200);
      expect(respostaReenvio.body.mensagem).toContain("reenviado com sucesso");

      const segundoCodigo = ultimoCodigoCapturado;
      expect(segundoCodigo).not.toBe(primeiroCodigo);

      // Tentar usar o código antigo deve falhar pois foi invalidado
      const tentativaCodigoAntigo = await request(app)
        .post("/autenticacao/verificar-email")
        .send({ email, codigo: primeiroCodigo });
      expect(tentativaCodigoAntigo.status).toBe(400);

      // Usar o novo código deve verificar com sucesso
      const tentativaCodigoNovo = await request(app)
        .post("/autenticacao/verificar-email")
        .send({ email, codigo: segundoCodigo });
      expect(tentativaCodigoNovo.status).toBe(200);
    });

    it("conta já verificada não recebe novo código", async () => {
      const { email, codigo } = await cadastrarUsuarioTeste("ja_verificada");

      // Verifica a conta
      await request(app)
        .post("/autenticacao/verificar-email")
        .send({ email, codigo });

      // Avança a data para contornar o cooldown
      await prisma.codigoVerificacaoEmail.updateMany({
        where: { usuario: { email } },
        data: { criadoEm: new Date(Date.now() - 70 * 1000) },
      });

      // Tenta reenviar para conta já verificada
      const respostaReenvio = await request(app)
        .post("/autenticacao/reenviar-codigo")
        .send({ email });

      expect(respostaReenvio.status).toBe(400);
      expect(respostaReenvio.body.erro.codigo).toBe("EMAIL_JA_VERIFICADO");
    });

    it("chamadas concorrentes de reenvio não contornam o limite de 60 segundos", async () => {
      const { email } = await cadastrarUsuarioTeste("concorrencia_reenvio");

      // Simula passagem de tempo inicial para permitir o primeiro reenvio
      await prisma.codigoVerificacaoEmail.updateMany({
        where: { usuario: { email } },
        data: { criadoEm: new Date(Date.now() - 70 * 1000) },
      });

      // Dispara 4 requisições de reenvio simultâneas
      const promessas = Array.from({ length: 4 }).map(() =>
        request(app).post("/autenticacao/reenviar-codigo").send({ email }),
      );

      const resultados = await Promise.all(promessas);

      // Exatamente UMA requisição deve ter sucesso (200) e as demais devem ser barradas pelo intervalo (429)
      const sucessos = resultados.filter((r) => r.status === 200);
      const limitados = resultados.filter((r) => r.status === 429);

      expect(sucessos.length).toBe(1);
      expect(limitados.length).toBe(3);
    });

    it("interrompe reenvio dentro da transação se a conta já foi verificada após o bloqueio", async () => {
      const { email } = await cadastrarUsuarioTeste("corrida_transacao");

      await prisma.codigoVerificacaoEmail.updateMany({
        where: { usuario: { email } },
        data: { criadoEm: new Date(Date.now() - 70 * 1000) },
      });

      const usuarioAntes = await prisma.usuario.findUnique({
        where: { email },
      });
      expect(usuarioAntes).not.toBeNull();

      let interceptadorEnvioChamado = false;
      definirInterceptadorEmailTeste(async () => {
        interceptadorEnvioChamado = true;
        return { sucesso: true, mensagemId: "mock" };
      });

      // Simula que a primeira consulta (fora da transação) viu emailVerificado = false
      const findUniqueOriginal = prisma.usuario.findUnique.bind(prisma.usuario);
      vi.spyOn(prisma.usuario, "findUnique").mockImplementationOnce((async (
        args: any,
      ) => {
        const u = await findUniqueOriginal(args);
        return (u ? { ...u, emailVerificado: false } : null) as any;
      }) as any);

      // Atualiza o usuário no banco como já verificado
      await prisma.usuario.update({
        where: { id: usuarioAntes!.id },
        data: { emailVerificado: true },
      });

      const contagemCodigosAntes = await prisma.codigoVerificacaoEmail.count({
        where: { idUsuario: usuarioAntes!.id },
      });

      await expect(reenviarCodigoVerificacao({ email })).rejects.toMatchObject({
        statusCode: 400,
        codigo: "EMAIL_JA_VERIFICADO",
      });

      const contagemCodigosDepois = await prisma.codigoVerificacaoEmail.count({
        where: { idUsuario: usuarioAntes!.id },
      });

      // Não cria novo código nem envia e-mail
      expect(contagemCodigosDepois).toBe(contagemCodigosAntes);
      expect(interceptadorEnvioChamado).toBe(false);
    });
  });
});
