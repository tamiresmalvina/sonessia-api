import { ambiente } from "./config/ambiente.js";
import { app } from "./app.js";
import { prisma } from "../lib/prisma.js";

async function iniciarServidor(): Promise<void> {
  try {
    const porta = ambiente.PORT;

    const servidor = app.listen(porta, () => {
      console.log(`Servidor rodando na porta ${porta} [ambiente: ${ambiente.NODE_ENV}]`);
    });

    const encerrar = async (sinal: string): Promise<void> => {
      console.log(`\nRecebido sinal ${sinal}. Encerrando o servidor de forma graciosa...`);
      servidor.close(async () => {
        try {
          await prisma.$disconnect();
          console.log("Conexões encerradas com sucesso.");
          process.exit(0);
        } catch (erroDesconexao) {
          console.error("Erro ao desconectar do banco de dados:", erroDesconexao);
          process.exit(1);
        }
      });
    };

    process.on("SIGINT", () => void encerrar("SIGINT"));
    process.on("SIGTERM", () => void encerrar("SIGTERM"));
  } catch (erro) {
    console.error("Falha fatal na inicialização do servidor:", erro);
    process.exit(1);
  }
}

void iniciarServidor();
