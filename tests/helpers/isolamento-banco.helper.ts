import { prisma } from "../../lib/prisma.js";
import { ambiente } from "../../src/config/ambiente.js";

export interface DiagnosticoBancoTeste {
  bancoAtual: string;
  usuarioAtual: string;
  enderecoServidor: string | null;
  portaServidor: number | null;
  comprovadamenteIsolado: boolean;
}

/**
 * Validação rigorosa e não contornável do isolamento do banco de dados de testes.
 *
 * Critérios mandatórios:
 * 1. NODE_ENV deve ser estritamente 'test'.
 * 2. Consulta física obrigatória ao PostgreSQL (current_database).
 * 3. O banco de dados conectado deve ser explicitamente um banco de testes (ex: conter 'test' ou 'teste', como 'sonessia_test').
 * 4. O banco de testes deve ser comprovadamente DISTINTO do banco de desenvolvimento ('sonessia') e do administrativo ('postgres').
 * 5. Rejeição sumária se o banco ou URL contiver qualquer menção a produção.
 * 6. Nenhuma variável de autorização (ex: AUTORIZAR_BANCO_TESTE) é aceita para contornar essa verificação.
 *
 * Se qualquer critério falhar, a execução é abortada imediatamente com erro descritivo antes de qualquer mutação.
 */
export async function garantirBancoTestesIsolado(): Promise<DiagnosticoBancoTeste> {
  // 1. Verificação de ambiente
  if (process.env.NODE_ENV !== "test" && ambiente.NODE_ENV !== "test") {
    throw new Error(
      "Isolamento violado: NODE_ENV deve ser obrigatoriamente 'test' para execução de testes."
    );
  }

  // 2. Consulta física direta ao catálogo do PostgreSQL
  const resultado = await prisma.$queryRaw<
    Array<{
      banco: string;
      usuario: string;
      endereco: string | null;
      porta: number | null;
    }>
  >`
    SELECT 
      current_database() AS banco, 
      current_user AS usuario,
      inet_server_addr() AS endereco,
      inet_server_port() AS porta;
  `;

  if (!resultado || resultado.length === 0 || !resultado[0]?.banco) {
    throw new Error("Não foi possível verificar a identidade física do banco de dados conectado.");
  }

  const { banco, usuario, endereco, porta } = resultado[0];
  const bancoLower = banco.toLowerCase().trim();
  const urlLower = (process.env.DATABASE_URL || ambiente.DATABASE_URL || "").toLowerCase();

  // 3. Bloqueio absoluto contra produção
  if (
    urlLower.includes("prod") ||
    bancoLower.includes("prod") ||
    urlLower.includes("production") ||
    bancoLower.includes("production")
  ) {
    throw new Error(
      `ABORTANDO: Conexão detectada como ambiente de PRODUÇÃO ('${banco}'). Testes são estritamente proibidos.`
    );
  }

  // 4. Bloqueio contra bancos não-teste (banco de desenvolvimento 'sonessia' e administrativo 'postgres')
  if (bancoLower === "sonessia") {
    throw new Error(
      "ABORTANDO TESTES: A conexão atual aponta para o banco de desenvolvimento 'sonessia'. " +
      "Testes de integração exigem obrigatoriamente uma conexão com um banco de testes dedicado e isolado (ex: 'sonessia_test'). " +
      "Nenhum dado do desenvolvimento foi alterado."
    );
  }

  if (bancoLower === "postgres") {
    throw new Error(
      "ABORTANDO TESTES: A conexão atual aponta para o banco administrativo 'postgres'. " +
      "Testes de integração exigem obrigatoriamente um banco de testes isolado (ex: 'sonessia_test')."
    );
  }

  // 5. Validação positiva: o banco deve ser explicitamente identificado como teste
  const eBancoTeste = bancoLower.endsWith("_test") || bancoLower.endsWith("_teste") || bancoLower.includes("test");
  if (!eBancoTeste) {
    throw new Error(
      `ABORTANDO TESTES: O banco de dados conectado ('${banco}') não é identificado explicitamente como banco de testes. ` +
      "O nome do banco deve conter 'test' (ex: 'sonessia_test')."
    );
  }

  return {
    bancoAtual: banco,
    usuarioAtual: usuario,
    enderecoServidor: endereco,
    portaServidor: porta,
    comprovadamenteIsolado: true,
  };
}
