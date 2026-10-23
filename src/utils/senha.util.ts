import * as argon2 from "argon2";

export async function gerarHashSenha(senha: string): Promise<string> {
  return argon2.hash(senha, {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MiB conforme recomendação OWASP
    timeCost: 2,       // 2 iterações
    parallelism: 1,    // 1 thread
    raw: false,
  });
}

// Hash fictício Argon2id válido (m=19456, p=1, t=2) para mitigar timing attacks quando o usuário não for encontrado
export const HASH_FICTICIO_ARGON2ID =
  "$argon2id$v=19$m=19456,p=1,t=2$9ck+VIE3p0KiOmdu8/H/zg$1dXKSMvrpLDqWs1eguLqNB0XKGsXChydm+afsvZTJsA";

export async function verificarSenha(hash: string, senha: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, senha);
  } catch {
    return false;
  }
}
