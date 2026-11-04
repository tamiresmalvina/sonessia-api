import express, { type NextFunction, type Request, type Response } from "express";
import { AppError } from "../errors/app.error.js";

export const TAMANHO_MAXIMO_AUDIO = 50 * 1024 * 1024;

export interface ArquivoAudioRecebido {
  conteudo: Buffer;
  tipoConteudo: string;
}

declare global {
  namespace Express {
    interface Request {
      arquivoAudio?: ArquivoAudioRecebido;
      metadadosAudio?: Record<string, unknown>;
    }
  }
}

const analisarCorpo = express.raw({
  type: "multipart/form-data",
  limit: TAMANHO_MAXIMO_AUDIO + 1024 * 1024,
});

function cabecalhoParametro(cabecalho: string, parametro: string): string | undefined {
  const correspondencia = cabecalho.match(new RegExp(`${parametro}="([^"]*)"`, "i"));
  return correspondencia?.[1];
}

export function receberAudio(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  analisarCorpo(req, res, (erro: unknown) => {
    if (erro) {
      next(
        new AppError(
          413,
          "AUDIO_MUITO_GRANDE",
          "O arquivo de áudio excede o limite de 50 MB."
        )
      );
      return;
    }

    const contentType = req.headers["content-type"] ?? "";
    const correspondenciaBoundary = /boundary=(?:\"([^\"]+)\"|([^;]+))/i.exec(contentType);
    const boundary = correspondenciaBoundary?.[1] ?? correspondenciaBoundary?.[2]?.trim();
    if (!boundary || !Buffer.isBuffer(req.body)) {
      next(new AppError(400, "CORPO_AUDIO_INVALIDO", "O upload multipart é inválido."));
      return;
    }

    const marcador = Buffer.from(`--${boundary}`);
    const partes = req.body.toString("latin1").split(marcador.toString("latin1")).slice(1);
    let metadados: Record<string, unknown> | undefined;
    let arquivo: ArquivoAudioRecebido | undefined;

    for (const parte of partes) {
      if (!parte.startsWith("\r\n")) continue;
      const texto = parte.slice(2).replace(/\r\n--$/, "");
      const fimCabecalho = texto.indexOf("\r\n\r\n");
      if (fimCabecalho < 0) continue;
      const cabecalho = texto.slice(0, fimCabecalho);
      let conteudoTexto = texto.slice(fimCabecalho + 4);
      conteudoTexto = conteudoTexto.replace(/\r\n$/, "");
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
          next(new AppError(400, "METADADOS_AUDIO_INVALIDOS", "Os metadados do áudio devem ser JSON válido."));
          return;
        }
      } else if (nome === "arquivo" && nomeArquivo !== undefined) {
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

    if (metadados !== undefined) req.metadadosAudio = metadados;
    if (arquivo !== undefined) req.arquivoAudio = arquivo;
    next();
  });
}
