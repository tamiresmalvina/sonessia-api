import { prisma } from "../lib/prisma.js";
import argon2 from "argon2";

async function main() {
  const senhaHash = await argon2.hash("123456");

  await prisma.usuario.createMany({
    data: [
      {
        nome: "Usuário Teste",
        email: "usuario@teste.com",
        senha: senhaHash,
        dataNascimento: new Date("2000-01-01"),
        perfil: "COMUM",
      },
      {
        nome: "Administrador Teste",
        email: "admin@teste.com",
        senha: senhaHash,
        dataNascimento: new Date("1990-01-01"),
        perfil: "ADMIN",
      },
    ],
  });

  console.log("Usuários de teste criados com sucesso.");
}

main()
  .catch((erro) => {
    console.error("Erro ao executar o seed:", erro);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
