import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { Finalidade, type CategoriaAudio } from "../../generated/prisma/enums.js";
import { AppError } from "../errors/app.error.js";
import {
  schemaCriarAmbienteSonoro,
  schemaAtualizarAmbienteSonoro,
  schemaCriarAmbientePreConfigurado,
  schemaAtualizarAmbientePreConfigurado,
  type EntradaAtualizarAmbienteSonoro,
  type EntradaCriarAmbienteSonoro,
  type EntradaCriarAmbientePreConfigurado,
  type EntradaAtualizarAmbientePreConfigurado,
  type ItemComposicaoAudio,
} from "../schemas/ambiente-sonoro.schema.js";

export const ORIGEM_PERSONALIZADO = "personalizado";
export const ORIGEM_PRECONFIGURADO = "preconfigurado";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validarId(id: string, campo = "ambiente"): void {
  if (!UUID_REGEX.test(id)) {
    if (campo === "audio") {
      throw new AppError(400, "ID_AUDIO_INVALIDO", "O identificador do áudio é inválido.");
    }
    throw new AppError(400, "ID_AMBIENTE_INVALIDO", "O identificador do ambiente sonoro é inválido.");
  }
}

interface AudioBanco {
  idAudio: string;
  descricao: string | null;
  categoria: CategoriaAudio;
  arquivo: string;
  arquivoPublicId?: string | null;
  titulo: string;
  tituloOriginal: string;
  fonte: string;
  licenca: string;
  idUsuario?: string;
}

interface ItemComposicaoBanco {
  idAmbienteSonoro?: string;
  idAudio: string;
  volume: number;
  audio: AudioBanco;
}

interface AmbienteBanco {
  idAmbienteSonoro: string;
  idUsuario?: string;
  nome: string;
  descricao: string | null;
  finalidade: Finalidade;
  origem: string;
  publicado: boolean;
  imagem: string | null;
  autorImagem: string | null;
  tituloOriginalImagem: string | null;
  fonteImagem: string | null;
  licencaImagem: string | null;
  dataCriacao: Date;
  audios: ItemComposicaoBanco[];
}

function dtoComposicaoAudio(item: ItemComposicaoBanco) {
  const metadadosPublicosAudio = {
    idAudio: item.audio.idAudio,
    descricao: item.audio.descricao,
    categoria: item.audio.categoria,
    arquivo: item.audio.arquivo,
    titulo: item.audio.titulo,
    tituloOriginal: item.audio.tituloOriginal,
    fonte: item.audio.fonte,
    licenca: item.audio.licenca,
  };

  return {
    idAudio: item.audio.idAudio,
    volume: item.volume,
    titulo: item.audio.titulo,
    tituloOriginal: item.audio.tituloOriginal,
    categoria: item.audio.categoria,
    arquivo: item.audio.arquivo,
    descricao: item.audio.descricao,
    fonte: item.audio.fonte,
    licenca: item.audio.licenca,
    audio: metadadosPublicosAudio,
  };
}

function dtoAmbiente(ambiente: AmbienteBanco) {
  return {
    idAmbienteSonoro: ambiente.idAmbienteSonoro,
    nome: ambiente.nome,
    descricao: ambiente.descricao,
    finalidade: ambiente.finalidade,
    origem: ambiente.origem,
    publicado: ambiente.publicado,
    imagem: ambiente.imagem,
    autorImagem: ambiente.autorImagem,
    tituloOriginalImagem: ambiente.tituloOriginalImagem,
    fonteImagem: ambiente.fonteImagem,
    licencaImagem: ambiente.licencaImagem,
    dataCriacao: ambiente.dataCriacao,
    audios: ambiente.audios.map(dtoComposicaoAudio),
  };
}

async function verificarAudiosExistentes(itens: ItemComposicaoAudio[]): Promise<void> {
  const idsAudios = [...new Set(itens.map((item) => item.idAudio))];
  const audiosEncontrados = await prisma.audio.findMany({
    where: { idAudio: { in: idsAudios } },
    select: { idAudio: true },
  });

  if (audiosEncontrados.length !== idsAudios.length) {
    throw new AppError(404, "AUDIO_NAO_ENCONTRADO", "Um ou mais áudios informados não foram encontrados no catálogo.");
  }
}

/* ========================================================================= */
/* AMBIENTES PERSONALIZADOS (US05 - Privados, exclusivos do usuário)         */
/* ========================================================================= */

export async function criarAmbienteSonoro(idUsuario: string, dadosBrutos: unknown) {
  const dados: EntradaCriarAmbienteSonoro = schemaCriarAmbienteSonoro.parse(dadosBrutos);
  await verificarAudiosExistentes(dados.audios);

  const ambienteCriado = await prisma.$transaction(async (tx) => {
    const ambiente = await tx.ambienteSonoro.create({
      data: {
        idUsuario,
        nome: dados.nome,
        descricao: dados.descricao ?? null,
        finalidade: dados.finalidade,
        origem: ORIGEM_PERSONALIZADO,
        publicado: false,
      },
    });

    await tx.ambienteSonoroAudio.createMany({
      data: dados.audios.map((item) => ({
        idAmbienteSonoro: ambiente.idAmbienteSonoro,
        idAudio: item.idAudio,
        volume: item.volume,
      })),
    });

    const resultado = await tx.ambienteSonoro.findUniqueOrThrow({
      where: { idAmbienteSonoro: ambiente.idAmbienteSonoro },
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
    });

    return resultado;
  });

  return dtoAmbiente(ambienteCriado);
}

export async function listarAmbientesSonoros(idUsuario: string) {
  const ambientes = await prisma.ambienteSonoro.findMany({
    where: {
      idUsuario,
      origem: ORIGEM_PERSONALIZADO,
    },
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
    orderBy: { dataCriacao: "desc" },
  });

  return ambientes.map(dtoAmbiente);
}

export async function obterAmbienteSonoro(idUsuario: string, idAmbienteSonoro: string) {
  validarId(idAmbienteSonoro);

  const ambiente = await prisma.ambienteSonoro.findFirst({
    where: {
      idAmbienteSonoro,
      idUsuario,
      origem: ORIGEM_PERSONALIZADO,
    },
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
  });

  if (!ambiente) {
    throw new AppError(404, "AMBIENTE_NAO_ENCONTRADO", "Ambiente sonoro não encontrado.");
  }

  return dtoAmbiente(ambiente);
}

export async function atualizarAmbienteSonoro(
  idUsuario: string,
  idAmbienteSonoro: string,
  dadosBrutos: unknown
) {
  validarId(idAmbienteSonoro);
  const dados: EntradaAtualizarAmbienteSonoro = schemaAtualizarAmbienteSonoro.parse(dadosBrutos);

  const ambienteExistente = await prisma.ambienteSonoro.findFirst({
    where: {
      idAmbienteSonoro,
      idUsuario,
      origem: ORIGEM_PERSONALIZADO,
    },
    select: { idAmbienteSonoro: true },
  });

  if (!ambienteExistente) {
    throw new AppError(404, "AMBIENTE_NAO_ENCONTRADO", "Ambiente sonoro não encontrado.");
  }

  if (dados.audios !== undefined) {
    await verificarAudiosExistentes(dados.audios);
  }

  const ambienteAtualizado = await prisma.$transaction(async (tx) => {
    const alteracao: Prisma.AmbienteSonoroUpdateInput = {};
    if (dados.nome !== undefined) alteracao.nome = dados.nome;
    if (dados.descricao !== undefined) alteracao.descricao = dados.descricao;
    if (dados.finalidade !== undefined) alteracao.finalidade = dados.finalidade;

    if (Object.keys(alteracao).length > 0) {
      await tx.ambienteSonoro.update({
        where: { idAmbienteSonoro },
        data: alteracao,
      });
    }

    if (dados.audios !== undefined) {
      await tx.ambienteSonoroAudio.deleteMany({
        where: { idAmbienteSonoro },
      });

      await tx.ambienteSonoroAudio.createMany({
        data: dados.audios.map((item) => ({
          idAmbienteSonoro,
          idAudio: item.idAudio,
          volume: item.volume,
        })),
      });
    }

    const resultado = await tx.ambienteSonoro.findUniqueOrThrow({
      where: { idAmbienteSonoro },
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
    });

    return resultado;
  });

  return dtoAmbiente(ambienteAtualizado);
}

export async function excluirAmbienteSonoro(idUsuario: string, idAmbienteSonoro: string) {
  validarId(idAmbienteSonoro);

  const ambienteExistente = await prisma.ambienteSonoro.findFirst({
    where: {
      idAmbienteSonoro,
      idUsuario,
      origem: ORIGEM_PERSONALIZADO,
    },
    select: { idAmbienteSonoro: true },
  });

  if (!ambienteExistente) {
    throw new AppError(404, "AMBIENTE_NAO_ENCONTRADO", "Ambiente sonoro não encontrado.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.colecaoAmbienteSonoro.deleteMany({
      where: { idAmbienteSonoro },
    });
    await tx.ambienteSonoroAudio.deleteMany({
      where: { idAmbienteSonoro },
    });
    await tx.ambienteSonoro.delete({
      where: { idAmbienteSonoro },
    });
  });
}

/* ========================================================================= */
/* AMBIENTES PRÉ-CONFIGURADOS (US02 - Gestão Administrativa)                 */
/* ========================================================================= */

export async function criarAmbientePreConfigurado(idAdmin: string, dadosBrutos: unknown) {
  const dados: EntradaCriarAmbientePreConfigurado = schemaCriarAmbientePreConfigurado.parse(dadosBrutos);
  await verificarAudiosExistentes(dados.audios);

  const ambienteCriado = await prisma.$transaction(async (tx) => {
    const ambiente = await tx.ambienteSonoro.create({
      data: {
        idUsuario: idAdmin,
        nome: dados.nome,
        descricao: dados.descricao ?? null,
        finalidade: dados.finalidade,
        origem: ORIGEM_PRECONFIGURADO,
        publicado: dados.publicado ?? false,
        imagem: dados.imagem ?? null,
        autorImagem: dados.autorImagem ?? null,
        tituloOriginalImagem: dados.tituloOriginalImagem ?? null,
        fonteImagem: dados.fonteImagem ?? null,
        licencaImagem: dados.licencaImagem ?? null,
      },
    });

    await tx.ambienteSonoroAudio.createMany({
      data: dados.audios.map((item) => ({
        idAmbienteSonoro: ambiente.idAmbienteSonoro,
        idAudio: item.idAudio,
        volume: item.volume,
      })),
    });

    const resultado = await tx.ambienteSonoro.findUniqueOrThrow({
      where: { idAmbienteSonoro: ambiente.idAmbienteSonoro },
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
    });

    return resultado;
  });

  return dtoAmbiente(ambienteCriado);
}

export async function listarAmbientesPreConfigurados(filtros?: {
  finalidade?: Finalidade | undefined;
  publicado?: boolean | undefined;
}) {
  const where: Prisma.AmbienteSonoroWhereInput = {
    origem: ORIGEM_PRECONFIGURADO,
  };

  if (filtros?.finalidade !== undefined) {
    where.finalidade = filtros.finalidade;
  }
  if (filtros?.publicado !== undefined) {
    where.publicado = filtros.publicado;
  }

  const ambientes = await prisma.ambienteSonoro.findMany({
    where,
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
    orderBy: { nome: "asc" },
  });

  return ambientes.map(dtoAmbiente);
}

export async function obterAmbientePreConfigurado(idAmbienteSonoro: string) {
  validarId(idAmbienteSonoro);

  const ambiente = await prisma.ambienteSonoro.findFirst({
    where: {
      idAmbienteSonoro,
      origem: ORIGEM_PRECONFIGURADO,
    },
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
  });

  if (!ambiente) {
    throw new AppError(404, "AMBIENTE_NAO_ENCONTRADO", "Ambiente sonoro pré-configurado não encontrado.");
  }

  return dtoAmbiente(ambiente);
}

export async function atualizarAmbientePreConfigurado(
  idAmbienteSonoro: string,
  dadosBrutos: unknown
) {
  validarId(idAmbienteSonoro);
  const dados: EntradaAtualizarAmbientePreConfigurado = schemaAtualizarAmbientePreConfigurado.parse(dadosBrutos);

  const ambienteExistente = await prisma.ambienteSonoro.findFirst({
    where: {
      idAmbienteSonoro,
      origem: ORIGEM_PRECONFIGURADO,
    },
    select: { idAmbienteSonoro: true },
  });

  if (!ambienteExistente) {
    throw new AppError(404, "AMBIENTE_NAO_ENCONTRADO", "Ambiente sonoro pré-configurado não encontrado.");
  }

  if (dados.audios !== undefined) {
    await verificarAudiosExistentes(dados.audios);
  }

  const ambienteAtualizado = await prisma.$transaction(async (tx) => {
    const alteracao: Prisma.AmbienteSonoroUpdateInput = {};
    if (dados.nome !== undefined) alteracao.nome = dados.nome;
    if (dados.descricao !== undefined) alteracao.descricao = dados.descricao;
    if (dados.finalidade !== undefined) alteracao.finalidade = dados.finalidade;
    if (dados.publicado !== undefined) alteracao.publicado = dados.publicado;
    if (dados.imagem !== undefined) alteracao.imagem = dados.imagem;
    if (dados.autorImagem !== undefined) alteracao.autorImagem = dados.autorImagem;
    if (dados.tituloOriginalImagem !== undefined) alteracao.tituloOriginalImagem = dados.tituloOriginalImagem;
    if (dados.fonteImagem !== undefined) alteracao.fonteImagem = dados.fonteImagem;
    if (dados.licencaImagem !== undefined) alteracao.licencaImagem = dados.licencaImagem;

    if (Object.keys(alteracao).length > 0) {
      await tx.ambienteSonoro.update({
        where: { idAmbienteSonoro },
        data: alteracao,
      });
    }

    if (dados.audios !== undefined) {
      await tx.ambienteSonoroAudio.deleteMany({
        where: { idAmbienteSonoro },
      });

      await tx.ambienteSonoroAudio.createMany({
        data: dados.audios.map((item) => ({
          idAmbienteSonoro,
          idAudio: item.idAudio,
          volume: item.volume,
        })),
      });
    }

    const resultado = await tx.ambienteSonoro.findUniqueOrThrow({
      where: { idAmbienteSonoro },
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
    });

    return resultado;
  });

  return dtoAmbiente(ambienteAtualizado);
}

export async function alterarPublicacaoAmbientePreConfigurado(
  idAmbienteSonoro: string,
  publicado: boolean
) {
  validarId(idAmbienteSonoro);

  const ambienteExistente = await prisma.ambienteSonoro.findFirst({
    where: {
      idAmbienteSonoro,
      origem: ORIGEM_PRECONFIGURADO,
    },
    select: { idAmbienteSonoro: true },
  });

  if (!ambienteExistente) {
    throw new AppError(404, "AMBIENTE_NAO_ENCONTRADO", "Ambiente sonoro pré-configurado não encontrado.");
  }

  const ambienteAtualizado = await prisma.ambienteSonoro.update({
    where: { idAmbienteSonoro },
    data: { publicado },
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
  });

  return dtoAmbiente(ambienteAtualizado);
}

export async function excluirAmbientePreConfigurado(idAmbienteSonoro: string) {
  validarId(idAmbienteSonoro);

  const ambienteExistente = await prisma.ambienteSonoro.findFirst({
    where: {
      idAmbienteSonoro,
      origem: ORIGEM_PRECONFIGURADO,
    },
    select: { idAmbienteSonoro: true },
  });

  if (!ambienteExistente) {
    throw new AppError(404, "AMBIENTE_NAO_ENCONTRADO", "Ambiente sonoro pré-configurado não encontrado.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.colecaoAmbienteSonoro.deleteMany({
      where: { idAmbienteSonoro },
    });
    await tx.ambienteSonoroAudio.deleteMany({
      where: { idAmbienteSonoro },
    });
    await tx.ambienteSonoro.delete({
      where: { idAmbienteSonoro },
    });
  });
}

/* ========================================================================= */
/* CONSULTAS PÚBLICAS (US08 / US14 - Catálogo público sem autenticação)       */
/* ========================================================================= */

export async function listarAmbientesPublicos(filtroFinalidade?: Finalidade) {
  const where: Prisma.AmbienteSonoroWhereInput = {
    origem: ORIGEM_PRECONFIGURADO,
    publicado: true,
  };

  if (filtroFinalidade !== undefined) {
    where.finalidade = filtroFinalidade;
  }

  const ambientes = await prisma.ambienteSonoro.findMany({
    where,
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
    orderBy: { nome: "asc" },
  });

  return ambientes.map(dtoAmbiente);
}

export async function obterAmbientePublico(idAmbienteSonoro: string) {
  validarId(idAmbienteSonoro);

  const ambiente = await prisma.ambienteSonoro.findFirst({
    where: {
      idAmbienteSonoro,
      origem: ORIGEM_PRECONFIGURADO,
      publicado: true,
    },
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
  });

  if (!ambiente) {
    throw new AppError(404, "AMBIENTE_NAO_ENCONTRADO", "Ambiente sonoro publicado não encontrado.");
  }

  return dtoAmbiente(ambiente);
}

export function listarFinalidadesDisponiveis(): Finalidade[] {
  return Object.values(Finalidade);
}
