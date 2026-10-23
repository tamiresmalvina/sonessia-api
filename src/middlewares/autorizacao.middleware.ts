import type { Request, Response, NextFunction } from "express";
import { Perfil } from "../../generated/prisma/enums.js";
import { AppError } from "../errors/app.error.js";

/**
 * Factory de middleware para autorização de acesso baseada em perfil (RBAC).
 *
 * Depende do middleware `autenticar` previamente executado no pipeline da rota.
 * Utiliza exclusivamente `req.usuario.perfil`, sem realizar novas consultas ao banco
 * de dados e sem ler perfis de JWT, query, headers ou corpo da requisição.
 */
export function exigirPerfil(...perfisPermitidos: Perfil[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // 1. Verifica se a requisição foi autenticada previamente
    if (!req.usuario) {
      throw new AppError(401, "NAO_AUTENTICADO", "Usuário não autenticado.");
    }

    // 2. Valida se o perfil do usuário autenticado pertence aos perfis permitidos
    if (!perfisPermitidos.includes(req.usuario.perfil)) {
      throw new AppError(
        403,
        "ACESSO_NEGADO",
        "Acesso restrito. Seu perfil não possui permissão para acessar este recurso."
      );
    }

    next();
  };
}
