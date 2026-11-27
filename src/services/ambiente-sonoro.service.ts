import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { randomUUID } from "node:crypto";
import { AppError } from "../errors/app.error.js";
import { exigirCategoriaAtiva } from "./categoria.service.js";
import { obterInstanciaCloudinary } from "../config/cloudinary.js";
import { validarImagem } from "./foto-perfil.service.js";
import type { ArquivoImagemAmbienteRecebido } from "../middlewares/ambiente-imagem.middleware.js";
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
  idCategoria?: string;
  descricao: string | null;
  categoria?: {
    idCategoria?: string;
    nome: string;
  } | string | null;
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

export interface ColecaoAssocBanco {
  colecao: {
    idColecao: string;
    nome: string;
  };
}

export interface AmbienteBanco {
  idAmbienteSonoro: string;
  idUsuario?: string;
  idCategoria?: string | null;
  categoria?: {
    idCategoria: string;
    nome: string;
  } | null;
  nome: string;
  descricao: string | null;
  origem: string;
  publicado: boolean;
  imagem: string | null;
  imagemPublicId?: string | null;
  autorImagem: string | null;
  tituloOriginalImagem: string | null;
  fonteImagem: string | null;
  licencaImagem: string | null;
  dataCriacao: Date;
  audios: ItemComposicaoBanco[];
  colecoes?: ColecaoAssocBanco[];
}

export function dtoComposicaoAudio(item: ItemComposicaoBanco) {
  const nomeCategoria =
    typeof item.audio.categoria === "object" && item.audio.categoria !== null
      ? item.audio.categoria.nome
      : (typeof item.audio.categoria === "string" ? item.audio.categoria : "");

  const metadadosPublicosAudio = {
    idAudio: item.audio.idAudio,
    idCategoria: item.audio.idCategoria,
    descricao: item.audio.descricao,
    categoria: nomeCategoria,
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
    categoria: nomeCategoria,
    arquivo: item.audio.arquivo,
    descricao: item.audio.descricao,
    fonte: item.audio.fonte,
    licenca: item.audio.licenca,
    audio: metadadosPublicosAudio,
  };
}

export function dtoAmbiente(ambiente: AmbienteBanco) {
  return {
    idAmbienteSonoro: ambiente.idAmbienteSonoro,
    idCategoria: ambiente.idCategoria ?? null,
    categoria: ambiente.categoria?.nome ?? null,
    nome: ambiente.nome,
    descricao: ambiente.descricao,
    origem: ambiente.origem,
    publicado: ambiente.publicado,
    imagem: ambiente.imagem,
    autorImagem: ambiente.autorImagem,
    tituloOriginalImagem: ambiente.tituloOriginalImagem,
    fonteImagem: ambiente.fonteImagem,
    licencaImagem: ambiente.licencaImagem,
    dataCriacao: ambiente.dataCriacao,
    audios: ambiente.audios.map(dtoComposicaoAudio),
    ...(ambiente.colecoes
      ? {
          colecoes: ambiente.colecoes.map((c) => ({
            idColecao: c.colecao.idColecao,
            nome: c.colecao.nome,
          })),
        }
      : {}),
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

export async function criarAmbienteSonoro(
  idUsuario: string,
  dadosBrutos: unknown,
  arquivoImagem?: ArquivoImagemAmbienteRecebido,
) {
  const dados: EntradaCriarAmbienteSonoro = schemaCriarAmbienteSonoro.parse(dadosBrutos);
  await exigirCategoriaAtiva(dados.idCategoria, "AMBIENTE");
  await verificarAudiosExistentes(dados.audios);

  let imagemRemota: { imagem: string; imagemPublicId: string } | null = null;
  if (arquivoImagem) {
    imagemRemota = await enviarImagemAmbiente(arquivoImagem);
  }

  let ambienteCriado;
  try {
    ambienteCriado = await prisma.$transaction(async (tx) => {
      const ambiente = await tx.ambienteSonoro.create({
        data: {
          idUsuario,
          nome: dados.nome,
          descricao: dados.descricao ?? null,
          origem: ORIGEM_PERSONALIZADO,
          idCategoria: dados.idCategoria,
          publicado: false,
          imagem: imagemRemota?.imagem ?? null,
          imagemPublicId: imagemRemota?.imagemPublicId ?? null,
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
          categoria: true,
          audios: {
            include: {
              audio: {
                include: {
                  categoria: true,
                },
              },
            },
            orderBy: {
              audio: { titulo: "asc" },
            },
          },
        },
      });

      return resultado;
    });
  } catch (erro) {
    if (imagemRemota) await compensarImagemAmbiente(imagemRemota.imagemPublicId);
    throw erro;
  }

  return dtoAmbiente(ambienteCriado);
}

export async function listarAmbientesSonoros(
  idUsuario: string,
  opcoes?: { semColecao?: boolean }
) {
  const where: Prisma.AmbienteSonoroWhereInput = {
    idUsuario,
    origem: ORIGEM_PERSONALIZADO,
  };

  if (opcoes?.semColecao === true) {
    where.colecoes = {
      none: {},
    };
  }

  const ambientes = await prisma.ambienteSonoro.findMany({
    where,
    include: {
      categoria: true,
      audios: {
        include: {
          audio: {
            include: {
              categoria: true,
            },
          },
        },
        orderBy: {
          audio: { titulo: "asc" },
        },
      },
      colecoes: {
        include: {
          colecao: {
            select: {
              idColecao: true,
              nome: true,
            },
          },
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
      categoria: true,
      audios: {
        include: {
          audio: {
            include: {
              categoria: true,
            },
          },
        },
        orderBy: {
          audio: { titulo: "asc" },
        },
      },
      colecoes: {
        include: {
          colecao: {
            select: {
              idColecao: true,
              nome: true,
            },
          },
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
  if (dados.idCategoria) await exigirCategoriaAtiva(dados.idCategoria, "AMBIENTE");

  const ambienteAtualizado = await prisma.$transaction(async (tx) => {
    const alteracao: Prisma.AmbienteSonoroUpdateInput = {};
    if (dados.nome !== undefined) alteracao.nome = dados.nome;
    if (dados.descricao !== undefined) alteracao.descricao = dados.descricao;
    if (dados.idCategoria !== undefined) alteracao.categoria = { connect: { idCategoria: dados.idCategoria } };

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
        categoria: true,
        audios: {
          include: {
            audio: {
              include: {
                categoria: true,
              },
            },
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
    select: { idAmbienteSonoro: true, imagemPublicId: true },
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

  if (ambienteExistente.imagemPublicId) {
    await removerImagemAmbiente(ambienteExistente.imagemPublicId).catch(() => undefined);
  }
}

/* ========================================================================= */
/* AMBIENTES PRÉ-CONFIGURADOS (US02 - Gestão Administrativa)                 */
/* ========================================================================= */

function composicaoNormalizada(audios: ItemComposicaoAudio[]): Array<[string, number]> {
  return audios
    .map((item) => [item.idAudio.toLowerCase(), item.volume] as [string, number])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
}

function composicoesIguais(
  primeira: ItemComposicaoBanco[] | ItemComposicaoAudio[],
  segunda: ItemComposicaoBanco[] | ItemComposicaoAudio[],
): boolean {
  if (primeira.length !== segunda.length) return false;
  const normalizadaPrimeira = composicaoNormalizada(
    primeira.map((item) => ({ idAudio: item.idAudio, volume: item.volume })),
  );
  const normalizadaSegunda = composicaoNormalizada(
    segunda.map((item) => ({ idAudio: item.idAudio, volume: item.volume })),
  );
  return JSON.stringify(normalizadaPrimeira) === JSON.stringify(normalizadaSegunda);
}

async function verificarAmbienteDuplicado(
  nome: string,
  audios: ItemComposicaoAudio[],
  idIgnorado?: string,
): Promise<void> {
  const candidatos = await prisma.ambienteSonoro.findMany({
    where: {
      origem: ORIGEM_PRECONFIGURADO,
      nome: nome,
      ...(idIgnorado ? { idAmbienteSonoro: { not: idIgnorado } } : {}),
    },
    include: {
      audios: true,
    },
  });

  if (candidatos.some((ambiente) => composicoesIguais(ambiente.audios, audios))) {
    throw new AppError(
      409,
      "AMBIENTE_PRE_CONFIGURADO_DUPLICADO",
      "Já existe um ambiente pronto com este nome e esta composição de áudios e volumes.",
    );
  }
}

async function enviarImagemAmbiente(
  arquivo: ArquivoImagemAmbienteRecebido,
): Promise<{ imagem: string; imagemPublicId: string }> {
  const tipoConteudo = validarImagem(arquivo.conteudo, arquivo.tipoConteudo);
  const cloudinary = obterInstanciaCloudinary();
  const publicId = `sonessia/ambientes/${randomUUID()}`;
  try {
    const resposta: unknown = await cloudinary.uploader.upload(
      `data:${tipoConteudo};base64,${arquivo.conteudo.toString("base64")}`,
      {
        public_id: publicId,
        resource_type: "image",
        type: "upload",
        allowed_formats: ["jpg", "png", "webp"],
        overwrite: false,
        unique_filename: false,
        use_filename: false,
        timeout: 15_000,
      },
    );
    if (
      typeof resposta !== "object" ||
      resposta === null ||
      !("secure_url" in resposta) ||
      typeof resposta.secure_url !== "string" ||
      !resposta.secure_url.startsWith("https://")
    ) {
      throw new AppError(502, "RESPOSTA_CLOUDINARY_INVALIDA", "O Cloudinary não confirmou uma imagem válida.");
    }
    return { imagem: resposta.secure_url, imagemPublicId: publicId };
  } catch (erro) {
    if (erro instanceof AppError) throw erro;
    throw new AppError(502, "FALHA_CLOUDINARY", "Não foi possível armazenar a imagem do ambiente.");
  }
}

async function removerImagemAmbiente(publicId: string): Promise<boolean> {
  const cloudinary = obterInstanciaCloudinary();
  try {
    const resposta: unknown = await cloudinary.api.delete_resources([publicId], {
      resource_type: "image",
      type: "upload",
      invalidate: true,
      timeout: 15_000,
    });
    if (typeof resposta !== "object" || resposta === null || !("deleted" in resposta)) {
      throw new AppError(502, "FALHA_REMOCAO_CLOUDINARY", "Não foi possível confirmar a remoção da imagem.");
    }
    const deleted = (resposta as { deleted: Record<string, unknown> }).deleted;
    return deleted[publicId] === "deleted" || deleted[publicId] === "not_found";
  } catch (erro) {
    if (erro instanceof AppError) throw erro;
    throw new AppError(502, "FALHA_REMOCAO_CLOUDINARY", "Não foi possível remover a imagem do ambiente.");
  }
}

async function compensarImagemAmbiente(publicId: string): Promise<void> {
  await removerImagemAmbiente(publicId).catch(() => undefined);
}

export async function criarAmbientePreConfigurado(
  idAdmin: string,
  dadosBrutos: unknown,
  arquivoImagem?: ArquivoImagemAmbienteRecebido,
) {
  const dados: EntradaCriarAmbientePreConfigurado = schemaCriarAmbientePreConfigurado.parse(dadosBrutos);
  await exigirCategoriaAtiva(dados.idCategoria, "AMBIENTE");
  await verificarAudiosExistentes(dados.audios);
  await verificarAmbienteDuplicado(dados.nome, dados.audios);

  let imagemRemota: { imagem: string; imagemPublicId: string } | null = null;
  if (arquivoImagem) {
    imagemRemota = await enviarImagemAmbiente(arquivoImagem);
  }

  let ambienteCriado;
  try {
    ambienteCriado = await prisma.$transaction(async (tx) => {
      const ambiente = await tx.ambienteSonoro.create({
        data: {
          idUsuario: idAdmin,
          nome: dados.nome,
          descricao: dados.descricao ?? null,
          origem: ORIGEM_PRECONFIGURADO,
          idCategoria: dados.idCategoria,
          publicado: dados.publicado ?? false,
          imagem: imagemRemota?.imagem ?? dados.imagem ?? null,
          imagemPublicId: imagemRemota?.imagemPublicId ?? null,
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
          categoria: true,
          audios: {
            include: {
              audio: {
                include: {
                  categoria: true,
                },
              },
            },
            orderBy: {
              audio: { titulo: "asc" },
            },
          },
        },
      });

      return resultado;
    });
  } catch (erro) {
    if (imagemRemota) await compensarImagemAmbiente(imagemRemota.imagemPublicId);
    throw erro;
  }

  return dtoAmbiente(ambienteCriado);
}

export async function listarAmbientesPreConfigurados(filtros?: {
  idCategoria?: string | undefined;
  publicado?: boolean | undefined;
}) {
  const where: Prisma.AmbienteSonoroWhereInput = {
    origem: ORIGEM_PRECONFIGURADO,
  };

  if (filtros?.idCategoria !== undefined) where.idCategoria = filtros.idCategoria;
  if (filtros?.publicado !== undefined) {
    where.publicado = filtros.publicado;
  }

  const ambientes = await prisma.ambienteSonoro.findMany({
    where,
    include: {
      categoria: true,
      audios: {
        include: {
          audio: {
            include: {
              categoria: true,
            },
          },
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
      categoria: true,
      audios: {
        include: {
          audio: {
            include: {
              categoria: true,
            },
          },
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
  dadosBrutos: unknown,
  arquivoImagem?: ArquivoImagemAmbienteRecebido,
) {
  validarId(idAmbienteSonoro);
  const dados: EntradaAtualizarAmbientePreConfigurado = schemaAtualizarAmbientePreConfigurado.parse(dadosBrutos);

  const ambienteExistente = await prisma.ambienteSonoro.findFirst({
    where: {
      idAmbienteSonoro,
      origem: ORIGEM_PRECONFIGURADO,
    },
    include: { audios: true },
  });

  if (!ambienteExistente) {
    throw new AppError(404, "AMBIENTE_NAO_ENCONTRADO", "Ambiente sonoro pré-configurado não encontrado.");
  }

  if (dados.audios !== undefined) {
    await verificarAudiosExistentes(dados.audios);
  }
  if (dados.idCategoria) await exigirCategoriaAtiva(dados.idCategoria, "AMBIENTE");

  const nomeFinal = dados.nome ?? ambienteExistente.nome;
  const audiosFinal = dados.audios ?? ambienteExistente.audios.map((item) => ({
    idAudio: item.idAudio,
    volume: item.volume,
  }));
  await verificarAmbienteDuplicado(nomeFinal, audiosFinal, idAmbienteSonoro);

  let imagemRemota: { imagem: string; imagemPublicId: string } | null = null;
  if (arquivoImagem) {
    imagemRemota = await enviarImagemAmbiente(arquivoImagem);
  }

  let ambienteAtualizado;
  try {
    ambienteAtualizado = await prisma.$transaction(async (tx) => {
      const alteracao: Prisma.AmbienteSonoroUpdateInput = {};
      if (dados.nome !== undefined) alteracao.nome = dados.nome;
      if (dados.descricao !== undefined) alteracao.descricao = dados.descricao;
      if (dados.idCategoria !== undefined) alteracao.categoria = { connect: { idCategoria: dados.idCategoria } };
      if (dados.publicado !== undefined) alteracao.publicado = dados.publicado;
      if (imagemRemota) {
        alteracao.imagem = imagemRemota.imagem;
        alteracao.imagemPublicId = imagemRemota.imagemPublicId;
      } else if (dados.imagem !== undefined) {
        alteracao.imagem = dados.imagem;
        if (dados.imagem === null) alteracao.imagemPublicId = null;
      }
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

      return tx.ambienteSonoro.findUniqueOrThrow({
        where: { idAmbienteSonoro },
        include: {
          categoria: true,
          audios: {
            include: {
              audio: {
                include: {
                  categoria: true,
                },
              },
            },
            orderBy: {
              audio: { titulo: "asc" },
            },
          },
        },
      });
    });
  } catch (erro) {
    if (imagemRemota) await compensarImagemAmbiente(imagemRemota.imagemPublicId);
    throw erro;
  }

  const publicIdAntigo = ambienteExistente.imagemPublicId;
  if (
    publicIdAntigo &&
    (
      (imagemRemota && publicIdAntigo !== imagemRemota.imagemPublicId) ||
      dados.imagem === null
    )
  ) {
    await removerImagemAmbiente(publicIdAntigo).catch(() => undefined);
  }

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
    include: { audios: true },
  });

  if (!ambienteExistente) {
    throw new AppError(404, "AMBIENTE_NAO_ENCONTRADO", "Ambiente sonoro pré-configurado não encontrado.");
  }

  if (publicado) {
    await verificarAmbienteDuplicado(
      ambienteExistente.nome,
      ambienteExistente.audios.map((item) => ({
        idAudio: item.idAudio,
        volume: item.volume,
      })),
      idAmbienteSonoro,
    );
  }

  const ambienteAtualizado = await prisma.ambienteSonoro.update({
    where: { idAmbienteSonoro },
    data: { publicado },
    include: {
      categoria: true,
      audios: {
        include: {
          audio: {
            include: {
              categoria: true,
            },
          },
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
    select: { idAmbienteSonoro: true, imagemPublicId: true },
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

export async function listarAmbientesPublicos(idCategoria?: string) {
  const where: Prisma.AmbienteSonoroWhereInput = {
    origem: ORIGEM_PRECONFIGURADO,
    publicado: true,
  };

  if (idCategoria !== undefined) where.idCategoria = idCategoria;

  const ambientes = await prisma.ambienteSonoro.findMany({
    where,
    include: {
      categoria: true,
      audios: {
        include: {
          audio: {
            include: {
              categoria: true,
            },
          },
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
      categoria: true,
      audios: {
        include: {
          audio: {
            include: {
              categoria: true,
            },
          },
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
