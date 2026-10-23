import type { Response, CookieOptions } from "express";
import { ambiente } from "../config/ambiente.js";

export const NOME_COOKIE_REFRESH = "refreshToken";

export function obterOpcoesCookieRefresh(): CookieOptions {
  return {
    httpOnly: true,
    secure: ambiente.NODE_ENV === "production",
    sameSite: "lax",
    path: "/autenticacao",
    maxAge: ambiente.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

export function definirCookieRefresh(res: Response, refreshToken: string): void {
  res.cookie(NOME_COOKIE_REFRESH, refreshToken, obterOpcoesCookieRefresh());
}

export function limparCookieRefresh(res: Response): void {
  res.clearCookie(NOME_COOKIE_REFRESH, {
    httpOnly: true,
    secure: ambiente.NODE_ENV === "production",
    sameSite: "lax",
    path: "/autenticacao",
  });
}
