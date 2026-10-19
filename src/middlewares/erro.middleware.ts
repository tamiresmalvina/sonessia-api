import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors/app.error.js";

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

  // Erros inesperados: log sem detalhes sensíveis e 500 genérico para o cliente
  const mensagemErro = erro instanceof Error ? erro.message : "Erro desconhecido";
  console.error(`[ERRO_INTERNO_INESPERADO]: ${mensagemErro}`);

  res.status(500).json({
    erro: {
      codigo: "ERRO_INTERNO",
      mensagem: "Ocorreu um erro interno no servidor.",
      detalhes: [],
    },
  });
}
