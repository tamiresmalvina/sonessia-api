import express, { type NextFunction, type Request, type Response } from "express";
import { AppError } from "../errors/app.error.js";

export const TAMANHO_MAXIMO_IMAGEM_AMBIENTE = 5 * 1024 * 1024;

export interface ArquivoImagemAmbienteRecebido {
  conteudo: Buffer;
  tipoConteudo: string;
}

declare global {
  namespace Express {
    interface Request {
      metadadosAmbiente?: Record<string, unknown>;
      arquivoImagemAmbiente?: ArquivoImagemAmbienteRecebido;
    }
  }
}

const analisarCorpo = express.raw({
  type: "multipart/form-data",
  limit: TAMANHO_MAXIMO_IMAGEM_AMBIENTE + 1024 * 1024,
});

function cabecalhoParametro(cabecalho: string, parametro: string): string | undefined {
  const correspondencia = cabecalho.match(new RegExp(`${parametro}="([^"]*)"`, "i"));
  return correspondencia?.[1];
}

export function receberImagemAmbiente(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    next();
    return;
  }

  analisarCorpo(req, res, (erro: unknown) => {
    if (erro) {
      next(new AppError(
        413,
        "IMAGEM_AMBIENTE_MUITO_GRANDE",
        "A imagem do ambiente não pode exceder 5 MB.",
      ));
      return;
    }

    const correspondenciaBoundary = /boundary=(?:\"([^\"]+)\"|([^;]+))/i.exec(contentType);
    const boundary = correspondenciaBoundary?.[1] ?? correspondenciaBoundary?.[2]?.trim();
    if (!boundary || !Buffer.isBuffer(req.body)) {
      next(new AppError(400, "CORPO_IMAGEM_AMBIENTE_INVALIDO", "O upload multipart é inválido."));
      return;
    }

    const marcador = Buffer.from(`--${boundary}`);
    const partes = req.body.toString("latin1").split(marcador.toString("latin1")).slice(1);
    let metadados: Record<string, unknown> | undefined;
    let arquivo: ArquivoImagemAmbienteRecebido | undefined;

    for (const parte of partes) {
      if (!parte.startsWith("\r\n")) continue;
      const texto = parte.slice(2).replace(/\r\n--$/, "");
      const fimCabecalho = texto.indexOf("\r\n\r\n");
      if (fimCabecalho < 0) continue;
      const cabecalho = texto.slice(0, fimCabecalho);
      const conteudoTexto = texto.slice(fimCabecalho + 4).replace(/\r\n$/, "");
      const conteudo = Buffer.from(conteudoTexto, "latin1");
      const cabecalhoConteudo = cabecalho
        .split("\r\n")
        .find((linha) => /^content-disposition:/i.test(linha));
      if (!cabecalhoConteudo) continue;

      const nome = cabecalhoParametro(cabecalhoConteudo, "name");
      const nomeArquivo = cabecalhoParametro(cabecalhoConteudo, "filename");
      if (nome === "metadados") {
        try {
          metadados = JSON.parse(conteudo.toString("utf8"));
        } catch {
          next(new AppError(
            400,
            "METADADOS_AMBIENTE_INVALIDOS",
            "Os metadados do ambiente devem ser JSON válido.",
          ));
          return;
        }
      } else if (nome === "imagem" && nomeArquivo !== undefined) {
        const tipo = cabecalho
          .split("\r\n")
          .find((linha) => /^content-type:/i.test(linha))
          ?.split(":")
          .slice(1)
          .join(":")
          .trim();
        arquivo = { conteudo, tipoConteudo: tipo ?? "" };
      }
    }

    if (metadados === undefined) {
      next(new AppError(
        400,
        "METADADOS_AMBIENTE_OBRIGATORIOS",
        "Envie os metadados do ambiente no campo multipart \"metadados\".",
      ));
      return;
    }

    req.metadadosAmbiente = metadados;
    req.body = metadados;
    if (arquivo) req.arquivoImagemAmbiente = arquivo;
    next();
  });
}
