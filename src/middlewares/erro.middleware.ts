import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors/app.error.js";
import { ambiente } from "../config/ambiente.js";

export interface FormatoErroResposta {
  erro: {
    codigo: string;
    mensagem: string;
    detalhes: unknown[];
  };
}

export function tratadorDeErros(
  erro: unknown,
  _req: Request,
  res: Response<FormatoErroResposta>,
  _next: NextFunction
): void {
  // Erros operacionais conhecidos da aplicação
  if (erro instanceof AppError) {
    res.status(erro.statusCode).json({
      erro: {
        codigo: erro.codigo,
        mensagem: erro.message,
        detalhes: erro.detalhes,
      },
    });
    return;
  }

  // Erros de validação do Zod
  if (erro instanceof ZodError) {
    const detalhes = erro.issues.map((issue) => ({
      campo: issue.path.join("."),
      mensagem: issue.message,
    }));

    res.status(400).json({
      erro: {
        codigo: "DADOS_INVALIDOS",
        mensagem: "Os dados fornecidos são inválidos.",
        detalhes,
      },
    });
    return;
  }

  // Erros de restrição de unicidade do banco de dados (Prisma P2002)
  if (
    typeof erro === "object" &&
    erro !== null &&
    "code" in erro &&
    (erro as { code?: unknown }).code === "P2002"
  ) {
    res.status(409).json({
      erro: {
        codigo: "CONFLITO_CADASTRO",
        mensagem: "Já existe um registro com os dados informados.",
        detalhes: [],
      },
    });
    return;
  }

  // Erros inesperados: evita registrar mensagens brutas em produção e retorna 500 genérico para o cliente
  if (ambiente.NODE_ENV === "production") {
    console.error("[ERRO_INTERNO_INESPERADO]: Ocorreu um erro interno não tratado.");
  } else {
    const mensagemErro = erro instanceof Error ? erro.message : "Erro desconhecido";
    console.error(`[ERRO_INTERNO_INESPERADO]: ${mensagemErro}`);
  }

  res.status(500).json({
    erro: {
      codigo: "ERRO_INTERNO",
      mensagem: "Ocorreu um erro interno no servidor.",
      detalhes: [],
    },
  });
}
