import jwt from "jsonwebtoken";
import type { StringValue } from "ms";
import { ambiente } from "../config/ambiente.js";
import { AppError } from "../errors/app.error.js";

export interface DadosPayloadAcesso {
  sub: string;
  versaoToken: number;
}

export function emitirTokenAcesso(dados: DadosPayloadAcesso): string {
  const opcoes: jwt.SignOptions = {
    algorithm: "HS256",
    issuer: ambiente.JWT_ISSUER,
    audience: ambiente.JWT_AUDIENCE,
    expiresIn: ambiente.ACCESS_TOKEN_TTL as StringValue,
  };

  return jwt.sign(
    {
      sub: dados.sub,
      versaoToken: dados.versaoToken,
    },
    ambiente.JWT_ACCESS_SECRET,
    opcoes
  );
}

export function verificarTokenAcesso(token: string): jwt.JwtPayload {
  return jwt.verify(token, ambiente.JWT_ACCESS_SECRET, {
    algorithms: ["HS256"],
    issuer: ambiente.JWT_ISSUER,
    audience: ambiente.JWT_AUDIENCE,
  }) as jwt.JwtPayload;
}

export function validarTokenParaLogout(token: string): { idUsuario?: string | undefined; expirado: boolean } {
  try {
    const payload = jwt.verify(token, ambiente.JWT_ACCESS_SECRET, {
      algorithms: ["HS256"],
      issuer: ambiente.JWT_ISSUER,
      audience: ambiente.JWT_AUDIENCE,
    }) as jwt.JwtPayload;

    return {
      idUsuario: typeof payload.sub === "string" ? payload.sub : undefined,
      expirado: false,
    };
  } catch (erro) {
    if (erro instanceof jwt.TokenExpiredError) {
      const decodificado = jwt.decode(token) as jwt.JwtPayload | null;
      return {
        idUsuario: typeof decodificado?.sub === "string" ? decodificado.sub : undefined,
        expirado: true,
      };
    }
    throw new AppError(401, "TOKEN_INVALIDO", "Token de acesso fornecido é inválido.");
  }
}
