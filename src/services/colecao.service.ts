import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { type Finalidade } from "../../generated/prisma/enums.js";
import { AppError } from "../errors/app.error.js";
import {
  schemaCriarColecao,
  schemaAtualizarColecao,
  schemaAdicionarAmbienteColecao,
  type EntradaCriarColecao,
  type EntradaAtualizarColecao,
  type EntradaAdicionarAmbienteColecao,
} from "../schemas/colecao.schema.js";
import {
  ORIGEM_PERSONALIZADO,
  dtoAmbiente,
  type AmbienteBanco,
} from "./ambiente-sonoro.service.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validarId(id: string, recurso: "colecao" | "ambiente" = "colecao"): void {
  if (!UUID_REGEX.test(id)) {
    if (recurso === "ambiente") {
      throw new AppError(400, "ID_AMBIENTE_INVALIDO", "O identificador do ambiente sonoro é inválido.");
    }
    throw new AppError(400, "ID_COLECAO_INVALIDO", "O identificador da coleção é inválido.");
  }
}

interface ColecaoComAmbientesBanco {
  idColecao: string;
  nome: string;
  descricao: string | null;
  ambientesSonoros?: Array<{
    ambienteSonoro: AmbienteBanco;
  }>;
}

interface ColecaoResumoBanco {
  idColecao: string;
  nome: string;
  descricao: string | null;
  ambientesSonoros?: Array<{
    ambienteSonoro: {
      idAmbienteSonoro: string;
      nome: string;
      finalidade: Finalidade;
    };
  }>;
}

function dtoColecao(colecao: ColecaoComAmbientesBanco) {
  const ambientes = colecao.ambientesSonoros
    ? colecao.ambientesSonoros.map((assoc) => dtoAmbiente(assoc.ambienteSonoro))
    : [];

  return {
    idColecao: colecao.idColecao,
    nome: colecao.nome,
    descricao: colecao.descricao,
    quantidadeAmbientes: ambientes.length,
    ambientes,
  };
}

function dtoColecaoResumo(colecao: ColecaoResumoBanco) {
  const ambientes = colecao.ambientesSonoros
    ? colecao.ambientesSonoros.map((assoc) => ({
        idAmbienteSonoro: assoc.ambienteSonoro.idAmbienteSonoro,
        nome: assoc.ambienteSonoro.nome,
        finalidade: assoc.ambienteSonoro.finalidade,
      }))
    : [];

  return {
    idColecao: colecao.idColecao,
    nome: colecao.nome,
    descricao: colecao.descricao,
    quantidadeAmbientes: ambientes.length,
    ambientes,
  };
}

export async function criarColecao(idUsuario: string, dadosBrutos: unknown) {
  const dados: EntradaCriarColecao = schemaCriarColecao.parse(dadosBrutos);

  const colecao = await prisma.colecao.create({
    data: {
      idUsuario,
      nome: dados.nome,
      descricao: dados.descricao ?? null,
    },
    include: {
      ambientesSonoros: {
        include: {
          ambienteSonoro: {
            include: {
              audios: {
                include: {
                  audio: true,
                },
                orderBy: {
                  audio: { titulo: "asc" },
                },
              },
            },
          },
        },
      },
    },
  });

  return dtoColecao(colecao);
}

export async function listarColecoes(idUsuario: string) {
  const colecoes = await prisma.colecao.findMany({
    where: { idUsuario },
    include: {
      ambientesSonoros: {
        include: {
          ambienteSonoro: {
            select: {
              idAmbienteSonoro: true,
              nome: true,
              finalidade: true,
            },
          },
        },
      },
    },
    orderBy: { nome: "asc" },
  });

  return colecoes.map(dtoColecaoResumo);
}

export async function obterColecao(idUsuario: string, idColecao: string) {
  validarId(idColecao, "colecao");

  const colecao = await prisma.colecao.findFirst({
    where: {
      idColecao,
      idUsuario,
    },
    include: {
      ambientesSonoros: {
        include: {
          ambienteSonoro: {
            include: {
              audios: {
                include: {
                  audio: true,
                },
                orderBy: {
                  audio: { titulo: "asc" },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!colecao) {
    throw new AppError(404, "COLECAO_NAO_ENCONTRADA", "Coleção não encontrada.");
  }

  return dtoColecao(colecao);
}

export async function atualizarColecao(
  idUsuario: string,
  idColecao: string,
  dadosBrutos: unknown
) {
  validarId(idColecao, "colecao");
  const dados: EntradaAtualizarColecao = schemaAtualizarColecao.parse(dadosBrutos);

  const existente = await prisma.colecao.findFirst({
    where: {
      idColecao,
      idUsuario,
    },
    select: { idColecao: true },
  });

  if (!existente) {
    throw new AppError(404, "COLECAO_NAO_ENCONTRADA", "Coleção não encontrada.");
  }

  const alteracao: Prisma.ColecaoUpdateInput = {};
  if (dados.nome !== undefined) alteracao.nome = dados.nome;
  if (dados.descricao !== undefined) alteracao.descricao = dados.descricao;

  const colecaoAtualizada = await prisma.colecao.update({
    where: { idColecao },
    data: alteracao,
    include: {
      ambientesSonoros: {
        include: {
          ambienteSonoro: {
            include: {
              audios: {
                include: {
                  audio: true,
                },
                orderBy: {
                  audio: { titulo: "asc" },
                },
              },
            },
          },
        },
      },
    },
  });

  return dtoColecao(colecaoAtualizada);
}

export async function excluirColecao(idUsuario: string, idColecao: string): Promise<void> {
  validarId(idColecao, "colecao");

  const existente = await prisma.colecao.findFirst({
    where: {
      idColecao,
      idUsuario,
    },
    select: { idColecao: true },
  });

  if (!existente) {
    throw new AppError(404, "COLECAO_NAO_ENCONTRADA", "Coleção não encontrada.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.colecaoAmbienteSonoro.deleteMany({
      where: { idColecao },
    });
    await tx.colecao.delete({
      where: { idColecao },
    });
  });
}

export async function adicionarAmbienteColecao(
  idUsuario: string,
  idColecao: string,
  dadosBrutos: unknown
) {
  validarId(idColecao, "colecao");
  const dados: EntradaAdicionarAmbienteColecao = schemaAdicionarAmbienteColecao.parse(dadosBrutos);
  validarId(dados.idAmbienteSonoro, "ambiente");

  const colecao = await prisma.colecao.findFirst({
    where: {
      idColecao,
      idUsuario,
    },
    select: { idColecao: true },
  });

  if (!colecao) {
    throw new AppError(404, "COLECAO_NAO_ENCONTRADA", "Coleção não encontrada.");
  }

  const ambiente = await prisma.ambienteSonoro.findUnique({
    where: { idAmbienteSonoro: dados.idAmbienteSonoro },
    select: {
      idAmbienteSonoro: true,
      idUsuario: true,
      origem: true,
    },
  });

  if (!ambiente) {
    throw new AppError(404, "AMBIENTE_NAO_ENCONTRADO", "Ambiente sonoro não encontrado.");
  }

  if (ambiente.origem !== ORIGEM_PERSONALIZADO) {
    throw new AppError(
      400,
      "AMBIENTE_PRECONFIGURADO_NAO_PERMITIDO",
      "Ambientes sonoros pré-configurados não podem ser adicionados a coleções."
    );
  }

  if (ambiente.idUsuario !== idUsuario) {
    throw new AppError(404, "AMBIENTE_NAO_ENCONTRADO", "Ambiente sonoro não encontrado.");
  }

  const associacaoExistente = await prisma.colecaoAmbienteSonoro.findUnique({
    where: {
      idColecao_idAmbienteSonoro: {
        idColecao,
        idAmbienteSonoro: dados.idAmbienteSonoro,
      },
    },
  });

  if (associacaoExistente) {
    throw new AppError(
      409,
      "AMBIENTE_JA_NA_COLECAO",
      "O ambiente sonoro já pertence a esta coleção."
    );
  }

  await prisma.colecaoAmbienteSonoro.create({
    data: {
      idColecao,
      idAmbienteSonoro: dados.idAmbienteSonoro,
    },
  });

  const colecaoAtualizada = await prisma.colecao.findUniqueOrThrow({
    where: { idColecao },
    include: {
      ambientesSonoros: {
        include: {
          ambienteSonoro: {
            include: {
              audios: {
                include: {
                  audio: true,
                },
                orderBy: {
                  audio: { titulo: "asc" },
                },
              },
            },
          },
        },
      },
    },
  });

  return dtoColecao(colecaoAtualizada);
}

export async function removerAmbienteColecao(
  idUsuario: string,
  idColecao: string,
  idAmbienteSonoro: string
): Promise<void> {
  validarId(idColecao, "colecao");
  validarId(idAmbienteSonoro, "ambiente");

  const colecao = await prisma.colecao.findFirst({
    where: {
      idColecao,
      idUsuario,
    },
    select: { idColecao: true },
  });

  if (!colecao) {
    throw new AppError(404, "COLECAO_NAO_ENCONTRADA", "Coleção não encontrada.");
  }

  const associacao = await prisma.colecaoAmbienteSonoro.findUnique({
    where: {
      idColecao_idAmbienteSonoro: {
        idColecao,
        idAmbienteSonoro,
      },
    },
  });

  if (!associacao) {
    throw new AppError(
      404,
      "AMBIENTE_NAO_ENCONTRADO_NA_COLECAO",
      "O ambiente sonoro não está associado a esta coleção."
    );
  }

  await prisma.colecaoAmbienteSonoro.delete({
    where: {
      idColecao_idAmbienteSonoro: {
        idColecao,
        idAmbienteSonoro,
      },
    },
  });
}
