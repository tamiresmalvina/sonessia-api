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

export async function verificarSenha(hash: string, senha: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, senha);
  } catch {
    return false;
  }
}
