import type { Request, Response, NextFunction } from "express";
import { ambiente } from "../config/ambiente.js";
import { AppError } from "../errors/app.error.js";

/**
 * Middleware para validar o cabeçalho Origin em rotas que operam com cookies e mutação de estado.
 *
 * Em produção:
 * - A ausência do cabeçalho Origin é estritamente rejeitada (HTTP 403).
 * - A divergência em relação a FRONTEND_ORIGIN (quando configurada) é rejeitada (HTTP 403).
 *
 * Fora de produção:
 * - Se o cabeçalho Origin for enviado e FRONTEND_ORIGIN estiver definido, a divergência é rejeitada.
 * - A ausência é tolerada apenas para clientes de teste manual (ex.: Supertest, Insomnia, curl).
 */
export function validarOrigemMutacao(req: Request, _res: Response, next: NextFunction): void {
  const origin = req.headers.origin;

  if (ambiente.NODE_ENV === "production" && !origin) {
    throw new AppError(403, "ORIGEM_INVALIDA", "Cabeçalho de origem obrigatório em produção.");
  }

  if (origin && ambiente.FRONTEND_ORIGIN && origin !== ambiente.FRONTEND_ORIGIN) {
    throw new AppError(403, "ORIGEM_NAO_AUTORIZADA", "Origem da requisição não autorizada.");
  }

  next();
}
