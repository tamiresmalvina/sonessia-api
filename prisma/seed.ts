import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import argon2 from "argon2";

async function main(): Promise<void> {
  const senhaDev = process.env.SEED_DEV_PASSWORD;

  if (!senhaDev) {
    throw new Error(
      "A variável de ambiente SEED_DEV_PASSWORD é obrigatória para executar o seed de desenvolvimento e não foi definida."
    );
  }

  if (senhaDev.length < 10) {
    throw new Error(
      "A senha de desenvolvimento informada em SEED_DEV_PASSWORD deve possuir no mínimo 10 caracteres."
    );
  }

  const emailUsuarioTeste = "usuario@teste.com";

  // Verifica se o usuário já existe para não sobrescrever dados ou senhas existentes
  const usuarioExistente = await prisma.usuario.findUnique({
    where: { email: emailUsuarioTeste },
  });

  if (usuarioExistente) {
    console.log(
      `O usuário de teste (${emailUsuarioTeste}) já existe no banco. Dados e senha preservados.`
    );
    return;
  }

  const senhaHash = await argon2.hash(senhaDev, {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
  });

  await prisma.usuario.create({
    data: {
      nome: "Usuário Teste",
      email: emailUsuarioTeste,
      senha: senhaHash,
      dataNascimento: new Date("2000-01-01"),
      perfil: "COMUM",
      emailVerificado: true,
    },
  });

  console.log(`Usuário de teste comum (${emailUsuarioTeste}) criado com sucesso.`);
}

main()
  .catch((erro: unknown) => {
    console.error("Erro ao executar o seed:", erro instanceof Error ? erro.message : erro);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
