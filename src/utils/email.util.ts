import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { ambiente } from "../config/ambiente.js";

export interface ParametrosEnvioCodigo {
  destinatario: string;
  nome: string;
  codigo: string;
}

export interface ResultadoEnvioEmail {
  sucesso: boolean;
  mensagemId?: string | undefined;
  previewUrl?: string | undefined;
}

// Handler customizado permitindo injeção/mock para testes automatizados
let transportadorCustomizado: Transporter | null = null;
let interceptadorTeste: ((parametros: ParametrosEnvioCodigo) => Promise<ResultadoEnvioEmail>) | null = null;

export function definirInterceptadorEmailTeste(
  fn: ((parametros: ParametrosEnvioCodigo) => Promise<ResultadoEnvioEmail>) | null
): void {
  interceptadorTeste = fn;
}

async function obterTransportador(): Promise<Transporter> {
  if (transportadorCustomizado) {
    return transportadorCustomizado;
  }

  // Em desenvolvimento, se o provedor for ethereal ou não configurado
  if (ambiente.EMAIL_PROVIDER === "ethereal" || ambiente.NODE_ENV === "development") {
    try {
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
    } catch {
      // Se não houver conexão externa para Ethereal, cria transporte json/stream para não travar
      transportadorCustomizado = nodemailer.createTransport({
        jsonTransport: true,
      });
      return transportadorCustomizado;
    }
  }

  // Fallback padrão seguro
  transportadorCustomizado = nodemailer.createTransport({
    jsonTransport: true,
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

  // Em ambiente de teste automatizado sem interceptador
  if (ambiente.NODE_ENV === "test") {
    return {
      sucesso: true,
      mensagemId: "mock-test-id",
    };
  }

  try {
    const transportador = await obterTransportador();

    const info = await transportador.sendMail({
      from: '"Sonessia" <nao-responda@sonessia.com>',
      to: parametros.destinatario,
      subject: "Código de Verificação de E-mail — Sonessia",
      text: `Olá, ${parametros.nome}!\n\nSeu código de verificação é: ${parametros.codigo}\n\nEste código expira em 15 minutos.\nSe você não solicitou este código, por favor ignore este e-mail.`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2>Confirmação de E-mail — Sonessia</h2>
          <p>Olá, <strong>${parametros.nome}</strong>!</p>
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

    const urlTeste = nodemailer.getTestMessageUrl(info);
    const previewUrl = urlTeste ? urlTeste : undefined;

    if (previewUrl && ambiente.NODE_ENV === "development") {
      console.log(`[E-mail de desenvolvimento enviado]: Pré-visualização disponível em: ${previewUrl}`);
    }

    return {
      sucesso: true,
      mensagemId: info.messageId,
      previewUrl,
    };
  } catch (erro) {
    console.error("[ERRO_ENVIO_EMAIL]: Não foi possível enviar o e-mail de verificação.", erro instanceof Error ? erro.message : erro);
    return {
      sucesso: false,
    };
  }
}
