import { prisma } from "../../lib/prisma.js";

export async function assegurarBancoTesteExiste(): Promise<void> {
  const check = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'sonessia_test') as exists;
  `;

  if (!check[0]?.exists) {
    console.log("[SETUP]: Criando banco de dados de testes isolado 'sonessia_test'...");
    await prisma.$executeRawUnsafe('CREATE DATABASE "sonessia_test"');
    console.log("[SETUP]: Banco 'sonessia_test' criado com sucesso.");
  } else {
    console.log("[SETUP]: Banco 'sonessia_test' já existe.");
  }
}

if (process.argv[1]?.endsWith("setup-banco-teste.ts")) {
  assegurarBancoTesteExiste()
    .then(() => process.exit(0))
    .catch((erro) => {
      console.error("[SETUP_ERRO]:", erro);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
