import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import {
  enviarEmailVerificacao,
  enviarEmailRecuperacaoSenha,
  definirInterceptadorEmailTeste,
  definirForcarExecucaoEtherealEmTestes,
  definirTransportadorCustomizado,
  resetarTransportadorEthereal,
  obterTransportador,
} from "../src/utils/email.util.js";
import { ambiente, validarAmbiente } from "../src/config/ambiente.js";

describe("Envio de E-mail — Provedor Ethereal e Validações de Transporte", () => {
  let ambienteOriginalProvider: typeof ambiente.EMAIL_PROVIDER;

  beforeEach(() => {
    ambienteOriginalProvider = ambiente.EMAIL_PROVIDER;
    (ambiente as Record<string, unknown>).EMAIL_PROVIDER = "ethereal";
    definirInterceptadorEmailTeste(null);
    definirTransportadorCustomizado(null);
    resetarTransportadorEthereal();
    definirForcarExecucaoEtherealEmTestes(true);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    (ambiente as Record<string, unknown>).EMAIL_PROVIDER = ambienteOriginalProvider;
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

describe("Envio de E-mail — Provedor Mailpit e Regras de Seleção/Bloqueio", () => {
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

  it("mantém ethereal como provedor padrão quando EMAIL_PROVIDER não for definido", () => {
    const baseValida = {
      NODE_ENV: "development",
      PORT: "3000",
      DATABASE_URL: "postgresql://localhost:5432/sonessia",
      JWT_ACCESS_SECRET: "chave-secreta-forte-para-testes-123456",
      JWT_ISSUER: "sonessia-api",
      JWT_AUDIENCE: "sonessia-web",
      ACCESS_TOKEN_TTL: "15m",
      REFRESH_TOKEN_TTL_DAYS: "7",
    };

    const config = validarAmbiente(baseValida);
    expect(config.EMAIL_PROVIDER).toBe("ethereal");
    expect(config.MAILPIT_HOST).toBe("localhost");
    expect(config.MAILPIT_PORT).toBe(1025);
  });

  it("valida que o schema aceita somente 'ethereal' ou 'mailpit' como provedores de e-mail", () => {
    const baseValida = {
      NODE_ENV: "development",
      PORT: "3000",
      DATABASE_URL: "postgresql://localhost:5432/sonessia",
      JWT_ACCESS_SECRET: "chave-secreta-forte-para-testes-123456",
      JWT_ISSUER: "sonessia-api",
      JWT_AUDIENCE: "sonessia-web",
      ACCESS_TOKEN_TTL: "15m",
      REFRESH_TOKEN_TTL_DAYS: "7",
    };

    const configEthereal = validarAmbiente({ ...baseValida, EMAIL_PROVIDER: "ethereal" });
    expect(configEthereal.EMAIL_PROVIDER).toBe("ethereal");

    const configMailpit = validarAmbiente({ ...baseValida, EMAIL_PROVIDER: "mailpit" });
    expect(configMailpit.EMAIL_PROVIDER).toBe("mailpit");

    expect(() => validarAmbiente({ ...baseValida, EMAIL_PROVIDER: "sendgrid" })).toThrowError(/EMAIL_PROVIDER/);
  });

  it("inicializa o transporte Mailpit com host localhost, porta 1025 e sem TLS por padrão", async () => {
    const spyCreateTransport = vi.spyOn(nodemailer, "createTransport");
    const spyCreateAccount = vi.spyOn(nodemailer, "createTestAccount");

    const ambienteOriginalProvider = ambiente.EMAIL_PROVIDER;
    const ambienteOriginalHost = ambiente.MAILPIT_HOST;
    const ambienteOriginalPort = ambiente.MAILPIT_PORT;

    try {
      (ambiente as Record<string, unknown>).EMAIL_PROVIDER = "mailpit";
      (ambiente as Record<string, unknown>).MAILPIT_HOST = "localhost";
      (ambiente as Record<string, unknown>).MAILPIT_PORT = 1025;

      const transportador = await obterTransportador();

      expect(spyCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "localhost",
          port: 1025,
          secure: false,
          ignoreTLS: true,
        })
      );
      expect(spyCreateAccount).not.toHaveBeenCalled();
      expect(transportador).toBeDefined();
    } finally {
      (ambiente as Record<string, unknown>).EMAIL_PROVIDER = ambienteOriginalProvider;
      (ambiente as Record<string, unknown>).MAILPIT_HOST = ambienteOriginalHost;
      (ambiente as Record<string, unknown>).MAILPIT_PORT = ambienteOriginalPort;
    }
  });

  it("respeita configurações customizadas de MAILPIT_HOST e MAILPIT_PORT", async () => {
    const spyCreateTransport = vi.spyOn(nodemailer, "createTransport");
    const ambienteOriginalProvider = ambiente.EMAIL_PROVIDER;
    const ambienteOriginalHost = ambiente.MAILPIT_HOST;
    const ambienteOriginalPort = ambiente.MAILPIT_PORT;

    try {
      (ambiente as Record<string, unknown>).EMAIL_PROVIDER = "mailpit";
      (ambiente as Record<string, unknown>).MAILPIT_HOST = "mailpit.custom.internal";
      (ambiente as Record<string, unknown>).MAILPIT_PORT = 2025;

      await obterTransportador();

      expect(spyCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "mailpit.custom.internal",
          port: 2025,
          secure: false,
          ignoreTLS: true,
        })
      );
    } finally {
      (ambiente as Record<string, unknown>).EMAIL_PROVIDER = ambienteOriginalProvider;
      (ambiente as Record<string, unknown>).MAILPIT_HOST = ambienteOriginalHost;
      (ambiente as Record<string, unknown>).MAILPIT_PORT = ambienteOriginalPort;
    }
  });

  it("garante que o Mailpit não seja usado em produção para envio de código de verificação", async () => {
    const spyCreateTransport = vi.spyOn(nodemailer, "createTransport");
    const ambienteOriginalNodeEnv = ambiente.NODE_ENV;
    const ambienteOriginalProvider = ambiente.EMAIL_PROVIDER;

    try {
      (ambiente as Record<string, unknown>).NODE_ENV = "production";
      (ambiente as Record<string, unknown>).EMAIL_PROVIDER = "mailpit";

      const resultado = await enviarEmailVerificacao({
        destinatario: "usuario@producao.com",
        nome: "Usuario Producao",
        codigo: "123456",
      });

      expect(resultado.sucesso).toBe(false);
      expect(resultado.status).toBe("FALHA_ENVIO");
      expect(resultado.motivo).toBe("MAILPIT_NAO_PERMITIDO_EM_PRODUCAO");
      expect(spyCreateTransport).not.toHaveBeenCalled();
    } finally {
      (ambiente as Record<string, unknown>).NODE_ENV = ambienteOriginalNodeEnv;
      (ambiente as Record<string, unknown>).EMAIL_PROVIDER = ambienteOriginalProvider;
    }
  });

  it("garante que o Mailpit não seja usado em produção para recuperação de senha", async () => {
    const spyCreateTransport = vi.spyOn(nodemailer, "createTransport");
    const ambienteOriginalNodeEnv = ambiente.NODE_ENV;
    const ambienteOriginalProvider = ambiente.EMAIL_PROVIDER;

    try {
      (ambiente as Record<string, unknown>).NODE_ENV = "production";
      (ambiente as Record<string, unknown>).EMAIL_PROVIDER = "mailpit";

      const resultado = await enviarEmailRecuperacaoSenha({
        destinatario: "usuario@producao.com",
        nome: "Usuario Producao",
        token: "token-recuperacao-123",
      });

      expect(resultado.sucesso).toBe(false);
      expect(resultado.status).toBe("FALHA_ENVIO");
      expect(resultado.motivo).toBe("MAILPIT_NAO_PERMITIDO_EM_PRODUCAO");
      expect(spyCreateTransport).not.toHaveBeenCalled();
    } finally {
      (ambiente as Record<string, unknown>).NODE_ENV = ambienteOriginalNodeEnv;
      (ambiente as Record<string, unknown>).EMAIL_PROVIDER = ambienteOriginalProvider;
    }
  });

  it("permite o uso de transportador legítimo customizado em ambiente de produção", async () => {
    const mockTransportador = {
      options: {},
      sendMail: vi.fn().mockResolvedValue({
        messageId: "prod-msg-123",
        accepted: ["cliente@producao.com"],
        rejected: [],
        response: "250 Message accepted",
      }),
    } as unknown as Transporter;

    const ambienteOriginalNodeEnv = ambiente.NODE_ENV;

    try {
      (ambiente as Record<string, unknown>).NODE_ENV = "production";
      definirTransportadorCustomizado(mockTransportador);

      const resultado = await enviarEmailVerificacao({
        destinatario: "cliente@producao.com",
        nome: "Cliente Producao",
        codigo: "654321",
      });

      expect(resultado.sucesso).toBe(true);
      expect(resultado.status).toBe("ENVIADO");
      expect(resultado.mensagemId).toBe("prod-msg-123");
      expect(mockTransportador.sendMail).toHaveBeenCalled();
    } finally {
      (ambiente as Record<string, unknown>).NODE_ENV = ambienteOriginalNodeEnv;
    }
  });

  it("trata falha de conexão (ECONNREFUSED) do Mailpit com o fluxo padrão FALHA_ENVIO/ERRO_DISPARO_SMTP", async () => {
    const mockTransportador = {
      options: {},
      sendMail: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:1025")),
    } as unknown as Transporter;

    const ambienteOriginalProvider = ambiente.EMAIL_PROVIDER;

    try {
      (ambiente as Record<string, unknown>).EMAIL_PROVIDER = "mailpit";
      definirTransportadorCustomizado(mockTransportador);

      const resultado = await enviarEmailVerificacao({
        destinatario: "usuario@teste.com",
        nome: "Usuario Teste",
        codigo: "123456",
      });

      expect(resultado.sucesso).toBe(false);
      expect(resultado.status).toBe("FALHA_ENVIO");
      expect(resultado.motivo).toBe("ERRO_DISPARO_SMTP");
    } finally {
      (ambiente as Record<string, unknown>).EMAIL_PROVIDER = ambienteOriginalProvider;
    }
  });

  it("trata timeout do servidor Mailpit classificando como INCERTO/TIMEOUT_RESPOSTA_SERVIDOR", async () => {
    const mockTransportador = {
      options: {},
      sendMail: vi.fn().mockRejectedValue(new Error("ETIMEDOUT: Connection timed out")),
    } as unknown as Transporter;

    const ambienteOriginalProvider = ambiente.EMAIL_PROVIDER;

    try {
      (ambiente as Record<string, unknown>).EMAIL_PROVIDER = "mailpit";
      definirTransportadorCustomizado(mockTransportador);

      const resultado = await enviarEmailVerificacao({
        destinatario: "usuario@teste.com",
        nome: "Usuario Teste",
        codigo: "123456",
      });

      expect(resultado.sucesso).toBe(false);
      expect(resultado.status).toBe("INCERTO");
      expect(resultado.motivo).toBe("TIMEOUT_RESPOSTA_SERVIDOR");
    } finally {
      (ambiente as Record<string, unknown>).EMAIL_PROVIDER = ambienteOriginalProvider;
    }
  });

  it("envia e-mail de verificação com sucesso quando o Mailpit aceita com resposta 250 OK", async () => {
    const mockTransportador = {
      options: {},
      sendMail: vi.fn().mockResolvedValue({
        messageId: "mailpit-msg-456",
        accepted: ["usuario@teste.com"],
        rejected: [],
        response: "250 2.0.0 Ok: queued",
      }),
    } as unknown as Transporter;

    const ambienteOriginalProvider = ambiente.EMAIL_PROVIDER;

    try {
      (ambiente as Record<string, unknown>).EMAIL_PROVIDER = "mailpit";
      definirTransportadorCustomizado(mockTransportador);

      const resultado = await enviarEmailVerificacao({
        destinatario: "usuario@teste.com",
        nome: "Usuario Teste",
        codigo: "654321",
      });

      expect(resultado.sucesso).toBe(true);
      expect(resultado.status).toBe("ENVIADO");
      expect(resultado.mensagemId).toBe("mailpit-msg-456");
      expect(resultado.previewUrl).toBeUndefined();
    } finally {
      (ambiente as Record<string, unknown>).EMAIL_PROVIDER = ambienteOriginalProvider;
    }
  });

  it("envia e-mail de recuperação de senha com sucesso através do Mailpit", async () => {
    const mockTransportador = {
      options: {},
      sendMail: vi.fn().mockResolvedValue({
        messageId: "mailpit-recup-789",
        accepted: ["usuario@teste.com"],
        rejected: [],
        response: "250 2.0.0 Ok: queued",
      }),
    } as unknown as Transporter;

    const ambienteOriginalProvider = ambiente.EMAIL_PROVIDER;

    try {
      (ambiente as Record<string, unknown>).EMAIL_PROVIDER = "mailpit";
      definirTransportadorCustomizado(mockTransportador);

      const resultado = await enviarEmailRecuperacaoSenha({
        destinatario: "usuario@teste.com",
        nome: "Usuario Recuperacao",
        token: "token-123456",
      });

      expect(resultado.sucesso).toBe(true);
      expect(resultado.status).toBe("ENVIADO");
      expect(resultado.mensagemId).toBe("mailpit-recup-789");
      expect(resultado.previewUrl).toBeUndefined();
    } finally {
      (ambiente as Record<string, unknown>).EMAIL_PROVIDER = ambienteOriginalProvider;
    }
  });
});

