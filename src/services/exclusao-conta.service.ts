import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { Perfil, StatusSessao } from "../../generated/prisma/enums.js";
import { AppError } from "../errors/app.error.js";
import { excluirRecursoFotoPerfil } from "./foto-perfil.service.js";
import {
  HASH_FICTICIO_ARGON2ID,
  verificarSenha,
} from "../utils/senha.util.js";
import type {
  EntradaReativarConta,
  EntradaSolicitarExclusaoConta,
} from "../schemas/autenticacao.schema.js";

const DURACAO_PENDENCIA_EXCLUSAO_MS = 30 * 24 * 60 * 60 * 1000;
const DURACAO_LEASE_PURGA_MS = 5 * 60 * 1000;
const INTERVALO_PURGA_MS = 60 * 1000;
const LIMITE_CONTAS_POR_CICLO = 20;

const MENSAGEM_REATIVACAO_NEUTRA =
  "Se os dados corresponderem a uma conta pendente e elegível, a solicitação será processada.";

export interface ResultadoSolicitacaoExclusao {
  exclusaoDefinitivaEm: Date;
}

export interface ResultadoCicloPurga {
  encontradas: number;
  excluidas: number;
  pendentes: number;
}

export async function solicitarExclusaoConta(
  idUsuario: string,
  dados: EntradaSolicitarExclusaoConta,
  agora = new Date()
): Promise<ResultadoSolicitacaoExclusao> {
  const usuarioAntes = await prisma.usuario.findUnique({
    where: { id: idUsuario },
    select: {
      senha: true,
      perfil: true,
    },
  });

  if (!usuarioAntes) {
    throw new AppError(404, "USUARIO_NAO_ENCONTRADO", "Usuário não encontrado.");
  }

  if (usuarioAntes.perfil !== Perfil.COMUM) {
    throw new AppError(
      403,
      "EXCLUSAO_ADMIN_NAO_PERMITIDA",
      "Contas de administrador não podem ser excluídas por este fluxo."
    );
  }

  if (!(await verificarSenha(usuarioAntes.senha, dados.senhaAtual))) {
    throw new AppError(401, "SENHA_ATUAL_INVALIDA", "A senha atual está incorreta.");
  }

  const resultado = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Usuario" WHERE id = ${idUsuario}::uuid FOR UPDATE`;
    const usuarioAtual = await tx.usuario.findUnique({
      where: { id: idUsuario },
      select: {
        senha: true,
        perfil: true,
        exclusaoDefinitivaEm: true,
      },
    });

    if (!usuarioAtual) {
      throw new AppError(404, "USUARIO_NAO_ENCONTRADO", "Usuário não encontrado.");
    }
    if (usuarioAtual.perfil !== Perfil.COMUM) {
      throw new AppError(
        403,
        "EXCLUSAO_ADMIN_NAO_PERMITIDA",
        "Contas de administrador não podem ser excluídas por este fluxo."
      );
    }
    if (usuarioAtual.senha !== usuarioAntes.senha) {
      throw new AppError(
        401,
        "SENHA_ATUAL_INVALIDA",
        "A senha foi alterada durante a solicitação. Faça login novamente."
      );
    }
    if (usuarioAtual.exclusaoDefinitivaEm) {
      throw new AppError(
        409,
        "EXCLUSAO_JA_SOLICITADA",
        "A conta já está pendente de exclusão."
      );
    }

    const exclusaoDefinitivaEm = new Date(
      agora.getTime() + DURACAO_PENDENCIA_EXCLUSAO_MS
    );

    await tx.usuario.update({
      where: { id: idUsuario },
      data: {
        exclusaoSolicitadaEm: agora,
        exclusaoDefinitivaEm,
        exclusaoProcessamentoAte: null,
        exclusaoProcessamentoToken: null,
        versaoToken: { increment: 1 },
      },
    });
    await tx.sessao.updateMany({
      where: { idUsuario },
      data: { status: StatusSessao.REVOGADA },
    });
    await tx.codigoVerificacaoEmail.updateMany({
      where: { idUsuario, usado: false },
      data: { usado: true },
    });
    await tx.tokenRecuperacaoSenha.updateMany({
      where: { idUsuario, usado: false },
      data: { usado: true },
    });
    await tx.alteracaoEmail.updateMany({
      where: {
        idUsuario,
        concluidaEm: null,
        invalidadaEm: null,
      },
      data: {
        tokenEmailAtualHash: null,
        tokenEmailNovoHash: null,
        invalidadaEm: agora,
      },
    });

    return { exclusaoDefinitivaEm };
  });

  return resultado;
}

export async function reativarConta(
  dados: EntradaReativarConta,
  agora = new Date()
): Promise<{ mensagem: string }> {
  const usuario = await prisma.usuario.findUnique({
    where: { email: dados.email },
    select: {
      id: true,
      senha: true,
      perfil: true,
      emailVerificado: true,
      exclusaoDefinitivaEm: true,
    },
  });
  const senhaCorreta = await verificarSenha(
    usuario?.senha ?? HASH_FICTICIO_ARGON2ID,
    dados.senha
  );

  if (
    !usuario ||
    !senhaCorreta ||
    usuario.perfil !== Perfil.COMUM ||
    !usuario.emailVerificado ||
    !usuario.exclusaoDefinitivaEm ||
    usuario.exclusaoDefinitivaEm <= agora
  ) {
    return { mensagem: MENSAGEM_REATIVACAO_NEUTRA };
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Usuario" WHERE id = ${usuario.id}::uuid FOR UPDATE`;
    const usuarioAtual = await tx.usuario.findUnique({
      where: { id: usuario.id },
      select: {
        senha: true,
        perfil: true,
        emailVerificado: true,
        exclusaoDefinitivaEm: true,
      },
    });

    if (
      !usuarioAtual ||
      usuarioAtual.senha !== usuario.senha ||
      usuarioAtual.perfil !== Perfil.COMUM ||
      !usuarioAtual.emailVerificado ||
      !usuarioAtual.exclusaoDefinitivaEm ||
      usuarioAtual.exclusaoDefinitivaEm <= agora
    ) {
      return;
    }

    await tx.usuario.update({
      where: { id: usuario.id },
      data: {
        exclusaoSolicitadaEm: null,
        exclusaoDefinitivaEm: null,
        exclusaoProcessamentoAte: null,
        exclusaoProcessamentoToken: null,
        versaoToken: { increment: 1 },
      },
    });
    await tx.sessao.updateMany({
      where: { idUsuario: usuario.id },
      data: { status: StatusSessao.REVOGADA },
    });
  });

  return { mensagem: MENSAGEM_REATIVACAO_NEUTRA };
}

async function excluirDadosDaConta(idUsuario: string, tokenProcessamento: string, agora: Date): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "Usuario"
      WHERE id = ${idUsuario}::uuid
        AND "exclusaoProcessamentoToken" = ${tokenProcessamento}::uuid
      FOR UPDATE
    `;

    const usuario = await tx.usuario.findUnique({
      where: { id: idUsuario },
      select: {
        perfil: true,
        exclusaoDefinitivaEm: true,
        exclusaoProcessamentoToken: true,
      },
    });
    if (
      !usuario ||
      usuario.perfil !== Perfil.COMUM ||
      !usuario.exclusaoDefinitivaEm ||
      usuario.exclusaoDefinitivaEm > agora ||
      usuario.exclusaoProcessamentoToken !== tokenProcessamento
    ) {
      return false;
    }

    const [colecoes, ambientesSonoros, audios] = await Promise.all([
      tx.colecao.findMany({
        where: { idUsuario },
        select: { idColecao: true },
      }),
      tx.ambienteSonoro.findMany({
        where: { idUsuario },
        select: { idAmbienteSonoro: true },
      }),
      tx.audio.findMany({
        where: { idUsuario },
        select: { idAudio: true },
      }),
    ]);

    const idsColecoes = colecoes.map((colecao) => colecao.idColecao);
    const idsAmbientes = ambientesSonoros.map(
      (ambiente) => ambiente.idAmbienteSonoro
    );
    const idsAudios = audios.map((audio) => audio.idAudio);

    const filtrosAssociacoesColecao = [];
    if (idsColecoes.length) {
      filtrosAssociacoesColecao.push({ idColecao: { in: idsColecoes } });
    }
    if (idsAmbientes.length) {
      filtrosAssociacoesColecao.push({
        idAmbienteSonoro: { in: idsAmbientes },
      });
    }
    if (filtrosAssociacoesColecao.length) {
      await tx.colecaoAmbienteSonoro.deleteMany({
        where: { OR: filtrosAssociacoesColecao },
      });
    }

    const filtrosAssociacoesAudio = [];
    if (idsAmbientes.length) {
      filtrosAssociacoesAudio.push({
        idAmbienteSonoro: { in: idsAmbientes },
      });
    }
    if (idsAudios.length) {
      filtrosAssociacoesAudio.push({ idAudio: { in: idsAudios } });
    }
    if (filtrosAssociacoesAudio.length) {
      await tx.ambienteSonoroAudio.deleteMany({
        where: { OR: filtrosAssociacoesAudio },
      });
    }

    if (idsColecoes.length) {
      await tx.colecao.deleteMany({ where: { idUsuario } });
    }
    if (idsAmbientes.length) {
      await tx.ambienteSonoro.deleteMany({ where: { idUsuario } });
    }
    if (idsAudios.length) {
      await tx.audio.deleteMany({ where: { idUsuario } });
    }

    const exclusao = await tx.usuario.deleteMany({
      where: {
        id: idUsuario,
        perfil: Perfil.COMUM,
        exclusaoDefinitivaEm: { lte: agora },
        exclusaoProcessamentoToken: tokenProcessamento,
      },
    });
    return exclusao.count === 1;
  });
}

async function liberarLease(idUsuario: string, tokenProcessamento: string): Promise<void> {
  try {
    await prisma.usuario.updateMany({
      where: {
        id: idUsuario,
        exclusaoProcessamentoToken: tokenProcessamento,
      },
      data: {
        exclusaoProcessamentoAte: null,
        exclusaoProcessamentoToken: null,
      },
    });
  } catch {
    console.error(
      "[PURGA_CONTA]: Não foi possível liberar a lease; haverá nova tentativa após sua expiração."
    );
  }
}

export async function processarContasExpiradas(
  agora = new Date()
): Promise<ResultadoCicloPurga> {
  const candidatas = await prisma.usuario.findMany({
    where: {
      perfil: Perfil.COMUM,
      exclusaoDefinitivaEm: { lte: agora },
      OR: [
        { exclusaoProcessamentoAte: null },
        { exclusaoProcessamentoAte: { lte: agora } },
      ],
    },
    orderBy: { exclusaoDefinitivaEm: "asc" },
    take: LIMITE_CONTAS_POR_CICLO,
    select: {
      id: true,
      fotoPerfilPublicId: true,
    },
  });

  let excluidas = 0;
  let pendentes = 0;

  for (const candidata of candidatas) {
    const tokenProcessamento = randomUUID();
    const lease = await prisma.usuario.updateMany({
      where: {
        id: candidata.id,
        perfil: Perfil.COMUM,
        exclusaoDefinitivaEm: { lte: agora },
        OR: [
          { exclusaoProcessamentoAte: null },
          { exclusaoProcessamentoAte: { lte: agora } },
        ],
      },
      data: {
        exclusaoProcessamentoAte: new Date(
          agora.getTime() + DURACAO_LEASE_PURGA_MS
        ),
        exclusaoProcessamentoToken: tokenProcessamento,
      },
    });
    if (lease.count !== 1) {
      continue;
    }

    try {
      if (candidata.fotoPerfilPublicId) {
        await excluirRecursoFotoPerfil(candidata.fotoPerfilPublicId);
      }

      const excluida = await excluirDadosDaConta(
        candidata.id,
        tokenProcessamento,
        agora
      );
      if (excluida) {
        excluidas += 1;
      } else {
        await liberarLease(candidata.id, tokenProcessamento);
      }
    } catch {
      pendentes += 1;
      await liberarLease(candidata.id, tokenProcessamento);
      console.error(
        "[PURGA_CONTA]: Uma conta expirou, mas uma etapa falhou; a remoção será tentada novamente."
      );
    }
  }

  return {
    encontradas: candidatas.length,
    excluidas,
    pendentes,
  };
}

let temporizadorPurga: NodeJS.Timeout | null = null;
let cicloPurgaEmExecucao = false;

export function iniciarRotinaPurgaContas(): void {
  if (temporizadorPurga || process.env.NODE_ENV === "test") {
    return;
  }

  const executarCiclo = async (): Promise<void> => {
    if (cicloPurgaEmExecucao) {
      return;
    }
    cicloPurgaEmExecucao = true;
    try {
      await processarContasExpiradas();
    } catch {
      console.error(
        "[PURGA_CONTA]: Não foi possível consultar a fila; a rotina tentará novamente."
      );
    } finally {
      cicloPurgaEmExecucao = false;
    }
  };

  temporizadorPurga = setInterval(() => {
    void executarCiclo();
  }, INTERVALO_PURGA_MS);
  temporizadorPurga.unref();
  void executarCiclo();
}
