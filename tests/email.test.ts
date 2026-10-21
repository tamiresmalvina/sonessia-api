import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import {
  enviarEmailVerificacao,
  definirInterceptadorEmailTeste,
  definirForcarExecucaoEtherealEmTestes,
  definirTransportadorCustomizado,
  resetarTransportadorEthereal,
} from "../src/utils/email.util.js";
import { ambiente } from "../src/config/ambiente.js";

describe("Envio de E-mail — Provedor Ethereal e Validações de Transporte", () => {
  beforeEach(() => {
    definirInterceptadorEmailTeste(null);
    definirTransportadorCustomizado(null);
    resetarTransportadorEthereal();
    definirForcarExecucaoEtherealEmTestes(true);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    definirInterceptadorEmailTeste(null);
    definirTransportadorCustomizado(null);
    resetarTransportadorEthereal();
    definirForcarExecucaoEtherealEmTestes(false);
    vi.restoreAllMocks();
  });

  it("retorna falha quando a criação da conta Ethereal falha sem conexão externa", async () => {
    vi.spyOn(nodemailer, "createTestAccount").mockRejectedValue(
      new Error("ENOTFOUND ethereal.email")
    );

    const resultado = await enviarEmailVerificacao({
      destinatario: "usuario@teste.com",
      nome: "Usuario Teste",
      codigo: "123456",
    });

    expect(resultado.sucesso).toBe(false);
    expect(resultado.status).toBe("FALHA_ENVIO");
    expect(resultado.motivo).toBe("FALHA_INICIALIZACAO_ETHEREAL");
  });

  it("rejeita expressamente jsonTransport como envio bem-sucedido", async () => {
    // Simula um transportador configurado com jsonTransport
    const transportadorJson = {
      options: { jsonTransport: true },
      sendMail: vi.fn().mockResolvedValue({
        messageId: "json-mock-id",
      }),
    } as unknown as Transporter;

    definirTransportadorCustomizado(transportadorJson);

    const resultado = await enviarEmailVerificacao({
      destinatario: "usuario@teste.com",
      nome: "Usuario Teste",
      codigo: "123456",
    });

    expect(resultado.sucesso).toBe(false);
    expect(resultado.status).toBe("FALHA_ENVIO");
    expect(resultado.motivo).toBe("TRANSPORTE_JSON_NAO_PERMITIDO");
    expect(transportadorJson.sendMail).not.toHaveBeenCalled();
  });

  it("retorna falha quando o envio SMTP dispara um erro de conexão", async () => {
    const transportadorMock = {
      options: {},
      sendMail: vi.fn().mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:587")),
    } as unknown as Transporter;

    definirTransportadorCustomizado(transportadorMock);

    const resultado = await enviarEmailVerificacao({
      destinatario: "usuario@teste.com",
      nome: "Usuario Teste",
      codigo: "123456",
    });

    expect(resultado.sucesso).toBe(false);
    expect(resultado.status).toBe("FALHA_ENVIO");
    expect(resultado.motivo).toBe("ERRO_DISPARO_SMTP");
  });

  it("classifica como INCERTO quando ocorre timeout durante resposta do servidor", async () => {
    const transportadorMock = {
      options: {},
      sendMail: vi.fn().mockRejectedValue(new Error("Connection timed out waiting for server response")),
    } as unknown as Transporter;

    definirTransportadorCustomizado(transportadorMock);

    const resultado = await enviarEmailVerificacao({
      destinatario: "usuario@teste.com",
      nome: "Usuario Teste",
      codigo: "123456",
    });

    expect(resultado.sucesso).toBe(false);
    expect(resultado.status).toBe("INCERTO");
    expect(resultado.motivo).toBe("TIMEOUT_RESPOSTA_SERVIDOR");
  });

  it("retorna falha quando o destinatário é explicitamente rejeitado pelo servidor SMTP", async () => {
    const transportadorMock = {
      options: {},
      sendMail: vi.fn().mockResolvedValue({
        messageId: "msg-id-123",
        accepted: [],
        rejected: ["usuario@teste.com"],
        response: "550 5.1.1 User unknown",
      }),
    } as unknown as Transporter;

    definirTransportadorCustomizado(transportadorMock);

    const resultado = await enviarEmailVerificacao({
      destinatario: "usuario@teste.com",
      nome: "Usuario Teste",
      codigo: "123456",
    });

    expect(resultado.sucesso).toBe(false);
    expect(resultado.status).toBe("FALHA_ENVIO");
    expect(resultado.motivo).toBe("DESTINATARIO_REJEITADO");
  });

  it("classifica como INCERTO quando o servidor SMTP não retorna confirmação positiva (não 250)", async () => {
    const transportadorMock = {
      options: {},
      sendMail: vi.fn().mockResolvedValue({
        messageId: "msg-id-123",
        accepted: ["usuario@teste.com"],
        rejected: [],
        response: "451 Temporary local problem",
      }),
    } as unknown as Transporter;

    definirTransportadorCustomizado(transportadorMock);

    const resultado = await enviarEmailVerificacao({
      destinatario: "usuario@teste.com",
      nome: "Usuario Teste",
      codigo: "123456",
    });

    expect(resultado.sucesso).toBe(false);
    expect(resultado.status).toBe("INCERTO");
    expect(resultado.motivo).toBe("RESPOSTA_SMTP_NAO_POSITIVA");
  });

  it("retorna sucesso quando o servidor Ethereal aceita a mensagem com resposta 250 OK", async () => {
    const transportadorMock = {
      options: {},
      sendMail: vi.fn().mockResolvedValue({
        messageId: "<test-id@ethereal.email>",
        accepted: ["usuario@teste.com"],
        rejected: [],
        response: "250 2.0.0 Ok: queued",
      }),
    } as unknown as Transporter;

    vi.spyOn(nodemailer, "getTestMessageUrl").mockReturnValue(
      "https://ethereal.email/message/test-id"
    );

    definirTransportadorCustomizado(transportadorMock);

    const resultado = await enviarEmailVerificacao({
      destinatario: "usuario@teste.com",
      nome: "Maria",
      codigo: "654321",
    });

    expect(resultado.sucesso).toBe(true);
    expect(resultado.status).toBe("ENVIADO");
    expect(resultado.mensagemId).toBe("<test-id@ethereal.email>");
    expect(resultado.previewUrl).toBe("https://ethereal.email/message/test-id");
  });

  it("preserva o mecanismo de interceptação de testes", async () => {
    let parametrosRecebidos: { destinatario: string; codigo: string } | null = null;

    definirInterceptadorEmailTeste(async (params) => {
      parametrosRecebidos = {
        destinatario: params.destinatario,
        codigo: params.codigo,
      };
      return {
        sucesso: true,
        status: "ENVIADO",
        mensagemId: "interceptor-id",
      };
    });

    const resultado = await enviarEmailVerificacao({
      destinatario: "interceptor@teste.com",
      nome: "Teste Interceptado",
      codigo: "999888",
    });

    expect(resultado.sucesso).toBe(true);
    expect(resultado.mensagemId).toBe("interceptor-id");
    expect(parametrosRecebidos).toEqual({
      destinatario: "interceptor@teste.com",
      codigo: "999888",
    });
  });

  it("classifica como INCERTO quando a resposta SMTP é ausente ou inconclusiva", async () => {
    const transportadorMock = {
      options: {},
      sendMail: vi.fn().mockResolvedValue({
        messageId: "msg-id-123",
        accepted: ["usuario@teste.com"],
        rejected: [],
        response: undefined,
      }),
    } as unknown as Transporter;

    definirTransportadorCustomizado(transportadorMock);

    const resultado = await enviarEmailVerificacao({
      destinatario: "usuario@teste.com",
      nome: "Usuario Teste",
      codigo: "123456",
    });

    expect(resultado.sucesso).toBe(false);
    expect(resultado.status).toBe("INCERTO");
    expect(resultado.motivo).toBe("RESPOSTA_SMTP_NAO_POSITIVA");
  });

  it("garante que o Ethereal não seja usado acidentalmente em produção", async () => {
    const spyCreateAccount = vi.spyOn(nodemailer, "createTestAccount");
    const ambienteOriginal = ambiente.NODE_ENV;
    try {
      (ambiente as { NODE_ENV: string }).NODE_ENV = "production";

      const resultado = await enviarEmailVerificacao({
        destinatario: "usuario@producao.com",
        nome: "Usuario Producao",
        codigo: "123456",
      });

      expect(resultado.sucesso).toBe(false);
      expect(resultado.status).toBe("FALHA_ENVIO");
      expect(resultado.motivo).toBe("ETHEREAL_NAO_PERMITIDO_EM_PRODUCAO");
      expect(spyCreateAccount).not.toHaveBeenCalled();
    } finally {
      (ambiente as { NODE_ENV: string }).NODE_ENV = ambienteOriginal;
    }
  });

  it("escapa o nome do usuário antes de inseri-lo no HTML do e-mail", async () => {
    let htmlEnviado = "";
    const transportadorMock = {
      options: {},
      sendMail: vi.fn().mockImplementation((mailOptions: { html: string }) => {
        htmlEnviado = mailOptions.html;
        return Promise.resolve({
          messageId: "<test-id@ethereal.email>",
          accepted: ["usuario@teste.com"],
          rejected: [],
          response: "250 2.0.0 Ok: queued",
        });
      }),
    } as unknown as Transporter;

    definirTransportadorCustomizado(transportadorMock);

    const resultado = await enviarEmailVerificacao({
      destinatario: "usuario@teste.com",
      nome: "<script>alert('xss')</script> & João \"Silva\"",
      codigo: "654321",
    });

    expect(resultado.sucesso).toBe(true);
    expect(htmlEnviado).not.toContain("<script>");
    expect(htmlEnviado).toContain("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt; &amp; João &quot;Silva&quot;");
  });
});
