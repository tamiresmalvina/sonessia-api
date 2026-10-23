import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../errors/app.error.js";
import { verificarTokenAcesso } from "../utils/jwt.util.js";

/**
 * Middleware de autenticação reutilizável para proteger rotas privadas.
 *
 * 1. Extrai o Bearer token do cabeçalho Authorization.
 * 2. Valida algoritmo HS256, assinatura, issuer, audience e expiração.
 * 3. Busca o usuário atualizado no banco de dados a partir do sub do token.
 * 4. Valida elegibilidade (emailVerificado) e anexa req.usuario para as próximas etapas.
 */
export async function autenticar(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new AppError(401, "NAO_AUTENTICADO", "Token de acesso não fornecido.");
    }

    const partes = authHeader.split(" ");
    if (partes.length !== 2 || partes[0] !== "Bearer" || !partes[1]) {
      throw new AppError(
        401,
        "TOKEN_INVALIDO",
        "Formato de cabeçalho de autorização inválido. Use: Bearer <token>."
      );
    }

    const token = partes[1].trim();

    let payload: jwt.JwtPayload;
    try {
      payload = verificarTokenAcesso(token);
    } catch (erro) {
      if (erro instanceof jwt.TokenExpiredError) {
        throw new AppError(401, "TOKEN_EXPIRADO", "Token de acesso expirado.");
      }
      throw new AppError(401, "TOKEN_INVALIDO", "Token de acesso inválido.");
    }

    const idUsuario = payload.sub;
    if (!idUsuario || typeof idUsuario !== "string") {
      throw new AppError(401, "TOKEN_INVALIDO", "Token de acesso inválido.");
    }

    // Carrega o usuário atual do banco de dados (o perfil NUNCA é lido do token)
    const usuario = await prisma.usuario.findUnique({
      where: { id: idUsuario },
      select: {
        id: true,
        nome: true,
        email: true,
        perfil: true,
        emailVerificado: true,
        versaoToken: true,
        senhaAlteradaEm: true,
      },
    });

    if (!usuario) {
      throw new AppError(401, "USUARIO_NAO_ENCONTRADO", "Usuário autenticado não encontrado.");
    }

    if (!usuario.emailVerificado) {
      throw new AppError(
        403,
        "EMAIL_NAO_VERIFICADO",
        "Conta com e-mail não verificado."
      );
    }

    // Validação estrita da versão do token:
    // Rejeita tokens sem o claim versaoToken (legados emitidos antes da mudança)
    // ou com versão divergente da versão atual vigente no banco
    if (
      typeof payload.versaoToken !== "number" ||
      payload.versaoToken !== usuario.versaoToken
    ) {
      throw new AppError(
        401,
        "TOKEN_INVALIDO",
        "Sessão invalidada por alteração de credenciais. Faça login novamente."
      );
    }

    req.usuario = usuario;
    next();
  } catch (erro) {
    next(erro);
  }
}
