import express, { type Request, type Response, type NextFunction } from "express";
import { AppError } from "../errors/app.error.js";
import { TAMANHO_MAXIMO_FOTO_PERFIL } from "../utils/foto-perfil.util.js";

const analisarCorpoBruto = express.raw({
  type: () => true,
  limit: TAMANHO_MAXIMO_FOTO_PERFIL,
  inflate: false,
});

export function receberFotoPerfil(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const codificacao = req.headers["content-encoding"];
  if (codificacao && codificacao.toLowerCase() !== "identity") {
    next(
      new AppError(
        415,
        "CODIFICACAO_IMAGEM_NAO_SUPORTADA",
        "Envie o arquivo sem compressão HTTP."
      )
    );
    return;
  }

  analisarCorpoBruto(req, res, (erro: unknown) => {
    if (
      typeof erro === "object" &&
      erro !== null &&
      "type" in erro &&
      erro.type === "entity.too.large"
    ) {
      next(
        new AppError(
          413,
          "FOTO_PERFIL_MUITO_GRANDE",
          "A foto de perfil não pode exceder 5 MB."
        )
      );
      return;
    }

    if (
      typeof erro === "object" &&
      erro !== null &&
      "type" in erro &&
      (erro.type === "entity.parse.failed" ||
        erro.type === "request.size.invalid")
    ) {
      next(
        new AppError(
          400,
          "CORPO_IMAGEM_INVALIDO",
          "O corpo da requisição de imagem é inválido."
        )
      );
      return;
    }

    next(erro);
  });
}
