import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { parse as parseDotenv } from "dotenv";
import { Perfil } from "../generated/prisma/enums.js";
import { schemaCadastro } from "../src/schemas/autenticacao.schema.js";
import { gerarHashSenha } from "../src/utils/senha.util.js";

const ARQUIVO_CONFIGURACAO = resolve(process.cwd(), ".env.production.local");
const CONFIRMACAO_EXIGIDA = "CRIAR ADMINS EM PRODUCAO";

type AdministradorValidado = {
  nome: string;
  email: string;
  senha: string;
  dataNascimento: Date;
};

class ErroSeedAdmin extends Error {}

function exigirVariavel(config: Record<string, string>, chave: string): string {
  const valor = config[chave]?.trim();
  if (!valor) throw new ErroSeedAdmin(`Variável obrigatória ausente ou vazia: ${chave}.`);
  return valor;
}

function validarBancoDeProducao(config: Record<string, string>): string {
  if (config.DATABASE_ENV?.trim().toLowerCase() !== "production") {
    throw new ErroSeedAdmin("DATABASE_ENV deve ser exatamente production no arquivo .env.production.local.");
  }

  const url = exigirVariavel(config, "DATABASE_URL");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ErroSeedAdmin("DATABASE_URL no arquivo .env.production.local não é uma URL válida.");
  }

  const databaseName = parsed.pathname.split("/").filter(Boolean).at(-1)?.toLowerCase() ?? "";
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname.endsWith(".neon.tech") ||
    /(^|[_-])(test|testing|dev|development)([_-]|$)/.test(databaseName)
  ) {
    throw new ErroSeedAdmin("DATABASE_URL não identifica um banco Neon de produção permitido.");
  }

  return url;
}

function validarAdministrador(config: Record<string, string>, prefixo: "ADMIN1" | "ADMIN2"): AdministradorValidado {
  const entrada = {
    nome: exigirVariavel(config, `${prefixo}_NAME`),
    email: exigirVariavel(config, `${prefixo}_EMAIL`),
    senha: exigirVariavel(config, `${prefixo}_PASSWORD`),
    dataNascimento: exigirVariavel(config, `${prefixo}_BIRTH_DATE`),
  };
  const resultado = schemaCadastro.safeParse(entrada);
  if (!resultado.success) {
    const campos = [...new Set(resultado.error.issues.map((issue) => issue.path[0]).filter(Boolean))]
      .map((campo) => {
        if (campo === "nome") return `${prefixo}_NAME`;
        if (campo === "email") return `${prefixo}_EMAIL`;
        if (campo === "senha") return `${prefixo}_PASSWORD`;
        if (campo === "dataNascimento") return `${prefixo}_BIRTH_DATE`;
        return prefixo;
      });
    throw new ErroSeedAdmin(`Dados inválidos em: ${campos.join(", ")}. Verifique as regras de cadastro existentes.`);
  }

  return resultado.data;
}

async function solicitarConfirmacao(): Promise<boolean> {
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const resposta = await terminal.question(`Banco Neon de produção validado. Digite "${CONFIRMACAO_EXIGIDA}" para criar as duas contas: `);
    return resposta.trim() === CONFIRMACAO_EXIGIDA;
  } finally {
    terminal.close();
  }
}

async function main(): Promise<void> {
  let config: Record<string, string>;
  try {
    config = parseDotenv(await readFile(ARQUIVO_CONFIGURACAO, "utf8"));
  } catch {
    throw new ErroSeedAdmin("Não foi possível ler .env.production.local. Nenhuma conexão foi iniciada.");
  }

  const connectionString = validarBancoDeProducao(config);
  const admins = [
    validarAdministrador(config, "ADMIN1"),
    validarAdministrador(config, "ADMIN2"),
  ] as const;

  if (admins[0].email === admins[1].email) {
    throw new ErroSeedAdmin("ADMIN1_EMAIL e ADMIN2_EMAIL precisam ser diferentes.");
  }

  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = connectionString;

  if (!(await solicitarConfirmacao())) {
    console.log("Confirmação não recebida. Nenhuma conexão ou gravação foi realizada.");
    return;
  }

  const senhaHashes = [
    await gerarHashSenha(admins[0].senha),
    await gerarHashSenha(admins[1].senha),
  ] as const;

  // Importação dinâmica garante que a configuração explícita acima preceda a criação do cliente Prisma.
  const [{ PrismaPg }, { PrismaClient }] = await Promise.all([
    import("@prisma/adapter-pg"),
    import("../generated/prisma/client.js"),
  ]);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    await prisma.$transaction(async (tx) => {
      for (const [indice, admin] of admins.entries()) {
        const existente = await tx.usuario.findFirst({
          where: { email: { equals: admin.email, mode: "insensitive" } },
          select: { id: true },
        });
        if (existente) {
          const chave = indice === 0 ? "ADMIN1_EMAIL" : "ADMIN2_EMAIL";
          throw new ErroSeedAdmin(`${chave} já está cadastrado. Nenhuma conta foi criada ou modificada.`);
        }
      }

      for (const [indice, admin] of admins.entries()) {
        await tx.usuario.create({
          data: {
            nome: admin.nome,
            email: admin.email,
            senha: indice === 0 ? senhaHashes[0] : senhaHashes[1],
            dataNascimento: admin.dataNascimento,
            perfil: Perfil.ADMIN,
            emailVerificado: true,
          },
        });
      }
    });
  } catch (erro: unknown) {
    if (erro instanceof ErroSeedAdmin) throw erro;
    if (typeof erro === "object" && erro !== null && "code" in erro && erro.code === "P2002") {
      throw new ErroSeedAdmin("Um dos e-mails foi cadastrado durante a operação. A transação foi revertida; nenhuma conta foi criada.");
    }
    throw new ErroSeedAdmin("Falha ao criar administradores. A transação foi revertida; nenhum dado sensível foi exibido.");
  } finally {
    await prisma.$disconnect();
  }

  console.log("ADMIN1 criado com Perfil.ADMIN e e-mail verificado.");
  console.log("ADMIN2 criado com Perfil.ADMIN e e-mail verificado.");
}

main().catch((erro: unknown) => {
  console.error(erro instanceof ErroSeedAdmin ? erro.message : "Falha no seed de administradores.");
  process.exitCode = 1;
});
