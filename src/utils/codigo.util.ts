import crypto from "node:crypto";
import { ambiente } from "../config/ambiente.js";

export const DURACAO_CODIGO_MS = 15 * 60 * 1000; // 15 minutos
export const INTERVALO_REENVIO_MS = 60 * 1000;  // 60 segundos
export const MAX_TENTATIVAS_CODIGO = 5;         // 5 tentativas máximas

export function gerarCodigoNumerico(): string {
  // Gera código aleatório criptograficamente seguro de exatamente 6 dígitos (100000 a 999999)
  return crypto.randomInt(100000, 1000000).toString();
}

export function gerarHashCodigo(codigo: string): string {
  // HMAC-SHA256 usando o segredo da aplicação como pepper para proteger contra ataques de dicionário
  return crypto
    .createHmac("sha256", ambiente.JWT_ACCESS_SECRET)
    .update(codigo)
    .digest("hex");
}

export function compararCodigoHash(codigoInformado: string, hashArmazenado: string): boolean {
  try {
    const hashCalculado = gerarHashCodigo(codigoInformado);
    const bufferCalculado = Buffer.from(hashCalculado, "utf8");
    const bufferArmazenado = Buffer.from(hashArmazenado, "utf8");

    if (bufferCalculado.length !== bufferArmazenado.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufferCalculado, bufferArmazenado);
  } catch {
    return false;
  }
}
