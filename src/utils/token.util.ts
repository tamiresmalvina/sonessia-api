import crypto from "node:crypto";
import { ambiente } from "../config/ambiente.js";

export function gerarRefreshToken(): string {
  // Gera 32 bytes criptograficamente aleatórios em string hexadecimal (64 caracteres)
  return crypto.randomBytes(32).toString("hex");
}

export function gerarHashToken(token: string): string {
  // Hash SHA-256 criptográfico para armazenamento seguro do token de atualização
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function calcularExpiracaoSessao(): Date {
  const duracaoMs = ambiente.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + duracaoMs);
}

export const DURACAO_TOKEN_RECUPERACAO_MS = 15 * 60 * 1000; // 15 minutos

export function gerarTokenRecuperacao(): string {
  // Gera 32 bytes criptograficamente aleatórios em string hexadecimal (64 caracteres)
  return crypto.randomBytes(32).toString("hex");
}

