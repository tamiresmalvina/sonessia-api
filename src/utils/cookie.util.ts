import type { Response, CookieOptions } from "express";
import { ambiente } from "../config/ambiente.js";

export const NOME_COOKIE_REFRESH = "refreshToken";

export function obterOpcoesCookieRefresh(persistente = true): CookieOptions {
  const opcoes: CookieOptions = {
    httpOnly: true,
    secure: ambiente.NODE_ENV === "production",
    sameSite: "lax",
    path: "/autenticacao",
  };

  if (persistente) {
    opcoes.maxAge = ambiente.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  }

  return opcoes;
}

export function definirCookieRefresh(
  res: Response,
  refreshToken: string,
  persistente = true
): void {
  res.cookie(NOME_COOKIE_REFRESH, refreshToken, obterOpcoesCookieRefresh(persistente));
}

export function limparCookieRefresh(res: Response): void {
  res.clearCookie(NOME_COOKIE_REFRESH, {
    httpOnly: true,
    secure: ambiente.NODE_ENV === "production",
    sameSite: "lax",
    path: "/autenticacao",
  });
}
