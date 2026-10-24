import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  schemaAtualizarDataNascimento,
  schemaCadastro,
} from "../src/schemas/autenticacao.schema.js";

describe("Validação da data de nascimento no cadastro", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function validarDataNascimento(dataNascimento: string) {
    return schemaCadastro.safeParse({
      nome: "Usuário de Teste",
      email: "usuario@teste.com",
      senha: "SenhaForte@123",
      dataNascimento,
    });
  }

  function validarDataNascimentoAtualizada(dataNascimento: string) {
    return schemaAtualizarDataNascimento.safeParse({ dataNascimento });
  }

  it.each([
    ["dia inexistente em ano não bissexto", "2023-02-29"],
    ["dia inexistente em ano bissexto", "2024-02-30"],
    ["ano secular não bissexto", "1900-02-29"],
    ["mês fora do intervalo", "2000-13-01"],
    ["dia fora do intervalo", "2000-04-31"],
    ["formato fora do padrão", "2000-2-01"],
    ["texto não interpretável", "não-é-uma-data"],
  ])("rejeita %s", (_caso, dataNascimento) => {
    const resultado = validarDataNascimento(dataNascimento);

    expect(resultado.success).toBe(false);
  });

  it("rejeita uma data anterior a 1900-01-01", () => {
    const resultado = validarDataNascimento("1899-12-31");

    expect(resultado.success).toBe(false);
  });

  it("aceita o limite mínimo 1900-01-01", () => {
    const resultado = validarDataNascimento("1900-01-01");

    expect(resultado.success).toBe(true);
  });

  it("rejeita datas futuras sem impor rejeição independente para o ano atual", () => {
    const resultado = validarDataNascimento("2026-10-25");

    expect(resultado.success).toBe(false);
  });

  it("rejeita a data de hoje pela regra de idade mínima", () => {
    const resultado = validarDataNascimento("2026-10-24");

    expect(resultado.success).toBe(false);
  });

  it("rejeita quem ainda não completou 16 anos", () => {
    const resultado = validarDataNascimento("2011-10-24");

    expect(resultado.success).toBe(false);
  });

  it("aceita quem completa 16 anos hoje", () => {
    const resultado = validarDataNascimento("2010-10-24");

    expect(resultado.success).toBe(true);
  });

  it("rejeita quem completa 16 anos amanhã", () => {
    const resultado = validarDataNascimento("2010-10-25");

    expect(resultado.success).toBe(false);
  });

  it("aceita quem completou 16 anos ontem", () => {
    const resultado = validarDataNascimento("2010-10-23");

    expect(resultado.success).toBe(true);
  });

  it("aceita 29 de fevereiro em um ano bissexto e preserva a data civil em UTC", () => {
    const resultado = validarDataNascimento("2000-02-29");

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.dataNascimento.toISOString()).toBe(
        "2000-02-29T00:00:00.000Z"
      );
    }
  });

  it("considera 1º de março como aniversário em ano não bissexto", () => {
    vi.setSystemTime(new Date("2100-02-28T12:00:00.000Z"));
    expect(validarDataNascimento("2084-02-29").success).toBe(false);

    vi.setSystemTime(new Date("2100-03-01T12:00:00.000Z"));
    const resultado = validarDataNascimento("2084-02-29");

    expect(resultado.success).toBe(true);
  });

  it.each([
    ["dia inexistente", "2001-02-29"],
    ["data futura", "2026-10-25"],
    ["data anterior ao limite", "1899-12-31"],
    ["idade inferior a 16 anos", "2011-10-24"],
  ])("rejeita na atualização %s", (_caso, dataNascimento) => {
    expect(validarDataNascimentoAtualizada(dataNascimento).success).toBe(false);
  });

  it("aceita na atualização quem completa 16 anos hoje e retorna meia-noite UTC", () => {
    const resultado = validarDataNascimentoAtualizada("2010-10-24");

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.dataNascimento.toISOString()).toBe(
        "2010-10-24T00:00:00.000Z"
      );
    }
  });

  it("rejeita na atualização quem completa 16 anos amanhã e aceita quem completou ontem", () => {
    expect(
      validarDataNascimentoAtualizada("2010-10-25").success
    ).toBe(false);
    expect(
      validarDataNascimentoAtualizada("2010-10-23").success
    ).toBe(true);
  });

  it("considera 1º de março como aniversário de 29 de fevereiro na atualização", () => {
    vi.setSystemTime(new Date("2100-02-28T12:00:00.000Z"));
    expect(
      validarDataNascimentoAtualizada("2084-02-29").success
    ).toBe(false);

    vi.setSystemTime(new Date("2100-03-01T12:00:00.000Z"));
    expect(
      validarDataNascimentoAtualizada("2084-02-29").success
    ).toBe(true);
  });
});
