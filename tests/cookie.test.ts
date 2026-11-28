import { afterEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { ambiente } from "../src/config/ambiente.js";
import {
  definirCookieRefresh,
  limparCookieRefresh,
  obterOpcoesCookieRefresh,
} from "../src/utils/cookie.util.js";

describe("cookie de refresh", () => {
  const nodeEnvOriginal = ambiente.NODE_ENV;

  afterEach(() => {
    (ambiente as { NODE_ENV: string }).NODE_ENV = nodeEnvOriginal;
  });

  it("usa SameSite=None, Secure e HttpOnly em produção", () => {
    (ambiente as { NODE_ENV: string }).NODE_ENV = "production";

    expect(obterOpcoesCookieRefresh()).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/autenticacao",
    });
  });

  it("mantém SameSite=Lax e Secure desligado em testes/desenvolvimento", () => {
    (ambiente as { NODE_ENV: string }).NODE_ENV = "test";

    expect(obterOpcoesCookieRefresh()).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/autenticacao",
    });
  });

  it("usa as mesmas opções de escopo ao criar e remover o cookie", () => {
    (ambiente as { NODE_ENV: string }).NODE_ENV = "production";
    const cookie = vi.fn();
    const clearCookie = vi.fn();
    const res = {
      cookie,
      clearCookie,
    } as unknown as Response;

    definirCookieRefresh(res, "refresh-teste");
    limparCookieRefresh(res);

    expect(cookie).toHaveBeenCalledWith(
      "refreshToken",
      "refresh-teste",
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/autenticacao",
      }),
    );
    expect(clearCookie).toHaveBeenCalledWith(
      "refreshToken",
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/autenticacao",
      }),
    );
    expect(clearCookie.mock.calls[0]?.[1]).not.toHaveProperty("maxAge");
  });
});
