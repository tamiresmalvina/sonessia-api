import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import {
  enviarEmailVerificacao,
  enviarEmailRecuperacaoSenha,
  enviarEmailSolicitacaoExclusaoConta,
  enviarEmailConfirmacaoReativacaoConta,
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
  let provedorOriginal: typeof ambiente.EMAIL_PROVIDER;

  beforeEach(() => {
    provedorOriginal = ambiente.EMAIL_PROVIDER;
    (ambiente as Record<string, unknown>).EMAIL_PROVIDER = "mailpit";
    definirInterceptadorEmailTeste(null);
    definirTransportadorCustomizado(null);
    resetarTransportadorEthereal();
    definirForcarExecucaoEtherealEmTestes(true);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    (ambiente as Record<string, unknown>).EMAIL_PROVIDER = provedorOriginal;
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

  it("valida os provedores Ethereal, Mailpit e Gmail", () => {
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

    const configGmail = validarAmbiente({
      ...baseValida,
      EMAIL_PROVIDER: "gmail",
      EMAIL_FROM: "sonessia.teste@gmail.com",
      SMTP_USER: "sonessia.teste@gmail.com",
      SMTP_PASS: "abcdefghijklmnop",
    });
    expect(configGmail.EMAIL_PROVIDER).toBe("gmail");
    expect(configGmail.SMTP_HOST).toBe("smtp.gmail.com");
    expect(configGmail.SMTP_PORT).toBe(587);

    expect(() => validarAmbiente({ ...baseValida, EMAIL_PROVIDER: "sendgrid" })).toThrowError(/EMAIL_PROVIDER/);
  });

  it.each([
    ["EMAIL_FROM", undefined],
    ["EMAIL_FROM", "remetente-invalido"],
    ["SMTP_USER", undefined],
    ["SMTP_USER", "usuario-invalido"],
    ["SMTP_PASS", undefined],
    ["SMTP_PASS", "curta"],
    ["SMTP_HOST", "smtp.example.net"],
    ["SMTP_PORT", "465"],
  ])("rejeita configuração Gmail inválida em %s sem expor valores", (campo, valor) => {
    const dados = {
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://localhost:5432/sonessia",
      JWT_ACCESS_SECRET: "chave-secreta-forte-para-testes-123456",
      JWT_ISSUER: "sonessia-api",
      JWT_AUDIENCE: "sonessia-web",
      ACCESS_TOKEN_TTL: "15m",
      REFRESH_TOKEN_TTL_DAYS: "7",
      EMAIL_PROVIDER: "gmail",
      EMAIL_FROM: "sonessia.teste@gmail.com",
      SMTP_USER: "sonessia.teste@gmail.com",
      SMTP_PASS: "abcdefghijklmnop",
      [campo]: valor,
    };
    expect(() => validarAmbiente(dados)).toThrowError(new RegExp(campo));
  });

  it("exige host, porta, remetente e credenciais Gmail explícitos e válidos", () => {
    const dados = {
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://localhost:5432/sonessia",
      JWT_ACCESS_SECRET: "chave-secreta-forte-para-testes-123456",
      JWT_ISSUER: "sonessia-api",
      JWT_AUDIENCE: "sonessia-web",
      ACCESS_TOKEN_TTL: "15m",
      REFRESH_TOKEN_TTL_DAYS: "7",
      EMAIL_PROVIDER: "gmail",
    };
    expect(() => validarAmbiente(dados)).toThrowError(/EMAIL_FROM.*SMTP_USER.*SMTP_PASS/);
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

  it("envia confirmação de exclusão com data persistida e link de navegação ao frontend", async () => {
    const enviarMensagem = vi.fn().mockResolvedValue({
      messageId: "exclusao-id", accepted: ["usuario@teste.com"], rejected: [], response: "250 queued",
    });
    const transportador = {
      options: {},
      sendMail: enviarMensagem,
    } as unknown as Transporter;
    const origemAnterior = ambiente.FRONTEND_ORIGIN;
    try {
      (ambiente as Record<string, unknown>).FRONTEND_ORIGIN = "https://sonessia.teste/";
      definirTransportadorCustomizado(transportador);
      const data = new Date("2026-12-27T14:30:00.000Z");
      const resultado = await enviarEmailSolicitacaoExclusaoConta({
        destinatario: "usuario@teste.com", nome: "Pessoa", exclusaoDefinitivaEm: data,
      });
      expect(resultado.sucesso).toBe(true);
      const mensagem = enviarMensagem.mock.calls[0]?.[0] as { text: string; html: string };
      expect(mensagem.text).toContain(data.toISOString());
      expect(mensagem.html).toContain("27 de dezembro de 2026");
      expect(mensagem.html).toContain("https://sonessia.teste/login?recuperarConta=1");
      expect(mensagem.html).toContain("não altera o estado da conta");
    } finally {
      (ambiente as Record<string, unknown>).FRONTEND_ORIGIN = origemAnterior;
    }
  });

  it("envia e-mail de confirmação da reativação", async () => {
    const enviarMensagem = vi.fn().mockResolvedValue({
      messageId: "reativacao-id", accepted: ["usuario@teste.com"], rejected: [], response: "250 queued",
    });
    const transportador = {
      options: {},
      sendMail: enviarMensagem,
    } as unknown as Transporter;
    definirTransportadorCustomizado(transportador);
    const resultado = await enviarEmailConfirmacaoReativacaoConta({
      destinatario: "usuario@teste.com", nome: "Pessoa",
    });
    expect(resultado.sucesso).toBe(true);
    const mensagem = enviarMensagem.mock.calls[0]?.[0] as { text: string; html: string };
    expect(mensagem.text).toContain("solicitação de exclusão foi cancelada");
    expect(mensagem.html).toContain("entre em contato com o suporte");
  });
});

describe("Envio de E-mail — Gmail SMTP", () => {
  const camposAmbiente = ["NODE_ENV", "EMAIL_PROVIDER", "EMAIL_FROM", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"] as const;
  let valoresOriginais: Record<string, unknown>;

  beforeEach(() => {
    valoresOriginais = Object.fromEntries(camposAmbiente.map((campo) => [campo, ambiente[campo]]));
    (ambiente as Record<string, unknown>).NODE_ENV = "development";
    (ambiente as Record<string, unknown>).EMAIL_PROVIDER = "gmail";
    (ambiente as Record<string, unknown>).EMAIL_FROM = "sonessia.teste@gmail.com";
    (ambiente as Record<string, unknown>).SMTP_HOST = "smtp.gmail.com";
    (ambiente as Record<string, unknown>).SMTP_PORT = 587;
    (ambiente as Record<string, unknown>).SMTP_USER = "sonessia.teste@gmail.com";
    (ambiente as Record<string, unknown>).SMTP_PASS = "abcd efgh ijkl mnop";
    definirInterceptadorEmailTeste(null);
    definirTransportadorCustomizado(null);
    resetarTransportadorEthereal();
    definirForcarExecucaoEtherealEmTestes(true);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    for (const campo of camposAmbiente) {
      (ambiente as Record<string, unknown>)[campo] = valoresOriginais[campo];
    }
    definirInterceptadorEmailTeste(null);
    definirTransportadorCustomizado(null);
    resetarTransportadorEthereal();
    definirForcarExecucaoEtherealEmTestes(false);
    vi.restoreAllMocks();
  });

  it("cria o transporte Gmail com smtp.gmail.com, porta 587, STARTTLS e auth", async () => {
    const transporte = { options: {}, sendMail: vi.fn() } as unknown as Transporter;
    const criarTransporte = vi.spyOn(nodemailer, "createTransport").mockReturnValue(transporte);
    const criarContaEthereal = vi.spyOn(nodemailer, "createTestAccount");

    await obterTransportador();

    expect(criarTransporte).toHaveBeenCalledWith({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "sonessia.teste@gmail.com", pass: "abcdefghijklmnop" },
    });
    expect(criarContaEthereal).not.toHaveBeenCalled();
  });

  it("usa EMAIL_FROM no envio e permite Gmail SMTP em produção", async () => {
    (ambiente as Record<string, unknown>).NODE_ENV = "production";
    const enviarMensagem = vi.fn().mockResolvedValue({
      messageId: "gmail-mock-id",
      accepted: ["destinatario@teste.com"],
      rejected: [],
      response: "250 2.0.0 queued",
    });
    definirTransportadorCustomizado({ options: {}, sendMail: enviarMensagem } as unknown as Transporter);

    const resultado = await enviarEmailVerificacao({
      destinatario: "destinatario@teste.com",
      nome: "Pessoa",
      codigo: "123456",
    });

    expect(resultado.sucesso).toBe(true);
    expect(enviarMensagem.mock.calls[0]?.[0]).toMatchObject({
      from: '"Sonessia" <sonessia.teste@gmail.com>',
      to: "destinatario@teste.com",
    });
  });

  it("trata falha de conexão sem expor a senha SMTP em resultado ou logs", async () => {
    (ambiente as Record<string, unknown>).NODE_ENV = "production";
    const senha = "abcd efgh ijkl mnop";
    const erro = `ECONNREFUSED; credencial ${senha}`;
    const enviarMensagem = vi.fn().mockRejectedValue(new Error(erro));
    const registrarErro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    definirTransportadorCustomizado({ options: {}, sendMail: enviarMensagem } as unknown as Transporter);

    const resultado = await enviarEmailVerificacao({
      destinatario: "destinatario@teste.com",
      nome: "Pessoa",
      codigo: "123456",
    });

    expect(resultado.sucesso).toBe(false);
    expect(JSON.stringify(resultado)).not.toContain(senha);
    expect(JSON.stringify(registrarErro.mock.calls)).not.toContain(senha);
  });

  it("trata falha de envio SMTP sem incluir a senha em mensagens de erro", async () => {
    (ambiente as Record<string, unknown>).NODE_ENV = "production";
    const enviarMensagem = vi.fn().mockRejectedValue(new Error("SMTP authentication failed"));
    definirTransportadorCustomizado({ options: {}, sendMail: enviarMensagem } as unknown as Transporter);

    const resultado = await enviarEmailVerificacao({
      destinatario: "destinatario@teste.com",
      nome: "Pessoa",
      codigo: "123456",
    });

    expect(resultado.sucesso).toBe(false);
    expect(resultado.motivo).toBe("ERRO_DISPARO_SMTP");
    expect(JSON.stringify(resultado)).not.toContain("abcdefghijklmnop");
  });

  it("não tenta enviar por Gmail durante testes automatizados", async () => {
    (ambiente as Record<string, unknown>).NODE_ENV = "test";
    const enviarMensagem = vi.fn();
    definirTransportadorCustomizado({ options: {}, sendMail: enviarMensagem } as unknown as Transporter);

    const resultado = await enviarEmailVerificacao({
      destinatario: "destinatario@teste.com",
      nome: "Pessoa",
      codigo: "123456",
    });

    expect(resultado.sucesso).toBe(true);
    expect(enviarMensagem).not.toHaveBeenCalled();
  });
});

