import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { ambiente } from "../config/ambiente.js";

export interface ParametrosEnvioCodigo {
  destinatario: string;
  nome: string;
  codigo: string;
}

export type StatusEnvioEmail = "ENVIADO" | "FALHA_ENVIO" | "INCERTO";

export interface ResultadoEnvioEmail {
  sucesso: boolean;
  status?: StatusEnvioEmail;
  mensagemId?: string | undefined;
  previewUrl?: string | undefined;
  motivo?: string | undefined;
}

// Handler customizado permitindo injeção/mock para testes automatizados
let transportadorCustomizado: Transporter | null = null;
let interceptadorTeste: ((parametros: ParametrosEnvioCodigo) => Promise<ResultadoEnvioEmail>) | null = null;
let forcarExecucaoEtherealEmTestes = false;

export function definirInterceptadorEmailTeste(
  fn: ((parametros: ParametrosEnvioCodigo) => Promise<ResultadoEnvioEmail>) | null
): void {
  interceptadorTeste = fn;
}

export function definirForcarExecucaoEtherealEmTestes(forcar: boolean): void {
  forcarExecucaoEtherealEmTestes = forcar;
}

export function resetarTransportadorEthereal(): void {
  transportadorCustomizado = null;
}

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function definirTransportadorCustomizado(t: Transporter | null): void {
  transportadorCustomizado = t;
}

async function obterTransportador(): Promise<Transporter> {
  if (transportadorCustomizado) {
    return transportadorCustomizado;
  }

  if (ambiente.NODE_ENV === "production") {
    throw new Error(
      "O provedor Ethereal não é permitido em ambiente de produção. Configure um transporte de e-mail de produção."
    );
  }

  // Ethereal como único provedor de desenvolvimento
  const contaTeste = await nodemailer.createTestAccount();
  transportadorCustomizado = nodemailer.createTransport({
    host: contaTeste.smtp.host,
    port: contaTeste.smtp.port,
    secure: contaTeste.smtp.secure,
    auth: {
      user: contaTeste.user,
      pass: contaTeste.pass,
    },
  });

  return transportadorCustomizado;
}

export async function enviarEmailVerificacao(
  parametros: ParametrosEnvioCodigo
): Promise<ResultadoEnvioEmail> {
  // Se houver interceptador de teste configurado
  if (interceptadorTeste) {
    return await interceptadorTeste(parametros);
  }

  // Em ambiente de teste sem forçar execução do provedor Ethereal, simula sucesso sem chamadas de rede
  if (ambiente.NODE_ENV === "test" && !forcarExecucaoEtherealEmTestes) {
    return {
      sucesso: true,
      status: "ENVIADO",
      mensagemId: "mock-test-id",
    };
  }

  // Em ambiente de produção, impede expressamente o uso do Ethereal
  if (ambiente.NODE_ENV === "production" && !transportadorCustomizado) {
    console.error("[ERRO_EMAIL_PRODUCAO]: O provedor Ethereal não é permitido em ambiente de produção.");
    return {
      sucesso: false,
      status: "FALHA_ENVIO",
      motivo: "ETHEREAL_NAO_PERMITIDO_EM_PRODUCAO",
    };
  }

  let transportador: Transporter;
  try {
    transportador = await obterTransportador();
  } catch (erro) {
    console.error(
      "[ERRO_ETHEREAL_CONTA]: Não foi possível inicializar a conta Ethereal.",
      erro instanceof Error ? erro.message : erro
    );
    return {
      sucesso: false,
      status: "FALHA_ENVIO",
      motivo: "FALHA_INICIALIZACAO_ETHEREAL",
    };
  }

  // Rejeição estrita de jsonTransport: nunca deve ser considerado envio bem-sucedido
  const opcoesTransportador = (transportador as unknown as { options?: { jsonTransport?: boolean } }).options;
  if (opcoesTransportador?.jsonTransport) {
    return {
      sucesso: false,
      status: "FALHA_ENVIO",
      motivo: "TRANSPORTE_JSON_NAO_PERMITIDO",
    };
  }

  try {
    const nomeHtml = escaparHtml(parametros.nome);

    const info = await transportador.sendMail({
      from: '"Sonessia" <nao-responda@sonessia.com>',
      to: parametros.destinatario,
      subject: "Código de Verificação de E-mail — Sonessia",
      text: `Olá, ${parametros.nome}!\n\nSeu código de verificação é: ${parametros.codigo}\n\nEste código expira em 15 minutos.\nSe você não solicitou este código, por favor ignore este e-mail.`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2>Confirmação de E-mail — Sonessia</h2>
          <p>Olá, <strong>${nomeHtml}</strong>!</p>
          <p>Seu código de confirmação é:</p>
          <div style="background-color: #f4f4f5; padding: 15px; font-size: 24px; font-weight: bold; letter-spacing: 4px; text-align: center; border-radius: 8px;">
            ${parametros.codigo}
          </div>
          <p style="color: #71717a; font-size: 14px; margin-top: 15px;">
            Este código é válido por 15 minutos e de uso único.<br>
            Se você não realizou este cadastro, desconsidere esta mensagem.
          </p>
        </div>
      `,
    });

    // Se o destinatário foi explicitamente rejeitado pelo servidor SMTP
    if (info.rejected && info.rejected.length > 0) {
      return {
        sucesso: false,
        status: "FALHA_ENVIO",
        mensagemId: info.messageId,
        motivo: "DESTINATARIO_REJEITADO",
      };
    }

    // Se não há confirmação de aceite pelo servidor SMTP
    const destinatarioAceito =
      Array.isArray(info.accepted) &&
      info.accepted.some((dest) =>
        typeof dest === "string"
          ? dest.toLowerCase() === parametros.destinatario.toLowerCase()
          : (dest as { address?: string }).address?.toLowerCase() === parametros.destinatario.toLowerCase()
      );

    if (!destinatarioAceito) {
      return {
        sucesso: false,
        status: "INCERTO",
        mensagemId: info.messageId,
        motivo: "RESPOSTA_SMTP_SEM_CONFIRMACAO_DESTINATARIO",
      };
    }

    // Exige confirmação positiva explícita do servidor SMTP (resposta iniciando com 250)
    if (typeof info.response !== "string" || !info.response.trim().startsWith("250")) {
      return {
        sucesso: false,
        status: "INCERTO",
        mensagemId: info.messageId,
        motivo: "RESPOSTA_SMTP_NAO_POSITIVA",
      };
    }

    const urlTeste = nodemailer.getTestMessageUrl(info);
    const previewUrl = urlTeste ? urlTeste : undefined;

    if (previewUrl && ambiente.NODE_ENV === "development") {
      console.log(`[E-mail Ethereal enviado]: Pré-visualização disponível em: ${previewUrl}`);
    }

    return {
      sucesso: true,
      status: "ENVIADO",
      mensagemId: info.messageId,
      previewUrl,
    };
  } catch (erro) {
    const mensagemErro = erro instanceof Error ? erro.message : String(erro);
    console.error("[ERRO_ENVIO_EMAIL]: Falha ao disparar o e-mail pelo Ethereal.", mensagemErro);

    // Se o erro ocorreu durante o diálogo após conexão iniciada, o resultado pode ser incerto
    const ehTimeout = /timeout|timed out|ETIMEDOUT|ESOCKET/i.test(mensagemErro);
    return {
      sucesso: false,
      status: ehTimeout ? "INCERTO" : "FALHA_ENVIO",
      motivo: ehTimeout ? "TIMEOUT_RESPOSTA_SERVIDOR" : "ERRO_DISPARO_SMTP",
    };
  }
}
