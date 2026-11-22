import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { obterInstanciaCloudinary } from "../config/cloudinary.js";
import { AppError } from "../errors/app.error.js";
import { exigirCategoriaAtiva } from "./categoria.service.js";
import { schemaCriarAudio, schemaAtualizarAudio, type EntradaAtualizarAudio } from "../schemas/audio.schema.js";
import { TAMANHO_MAXIMO_AUDIO, type ArquivoAudioRecebido } from "../middlewares/audio.middleware.js";

const TIPOS_AUDIO = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/ogg",
  "audio/aac",
  "audio/mp4",
  "audio/x-m4a",
  "audio/flac",
  "audio/x-flac",
]);

const FORMATOS_CLOUDINARY = ["mp3", "wav", "ogg", "m4a", "aac", "flac"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validarId(id: string): void {
  if (!UUID.test(id)) {
    throw new AppError(400, "ID_AUDIO_INVALIDO", "O identificador do áudio é inválido.");
  }
}

function arquivoPossuiAssinaturaValida(conteudo: Buffer): boolean {
  if (conteudo.length < 12) return false;
  if (conteudo.subarray(0, 4).toString("ascii") === "RIFF" &&
      conteudo.subarray(8, 12).toString("ascii") === "WAVE") return true;
  if (conteudo.subarray(0, 4).toString("ascii") === "OggS") return true;
  if (conteudo.subarray(0, 4).toString("ascii") === "fLaC") return true;
  if (conteudo.subarray(0, 3).toString("ascii") === "ID3") return true;
  if (conteudo[0] === 0xff && (conteudo[1] === 0xfb || conteudo[1] === 0xf3 || conteudo[1] === 0xf2 || conteudo[1] === 0xf9)) return true;
  if (conteudo.subarray(4, 8).toString("ascii") === "ftyp") return true;
  return false;
}

function validarArquivo(arquivo?: ArquivoAudioRecebido): ArquivoAudioRecebido {
  if (!arquivo) {
    throw new AppError(400, "ARQUIVO_AUDIO_OBRIGATORIO", "O arquivo do áudio é obrigatório.");
  }
  const tipo = arquivo.tipoConteudo.split(";")[0]?.trim().toLowerCase();
  if (!tipo) {
    throw new AppError(415, "FORMATO_AUDIO_NAO_SUPORTADO", "O arquivo enviado não é um formato de áudio suportado.");
  }
  if (!TIPOS_AUDIO.has(tipo) || !arquivoPossuiAssinaturaValida(arquivo.conteudo)) {
    throw new AppError(415, "FORMATO_AUDIO_NAO_SUPORTADO", "O arquivo enviado não é um formato de áudio suportado.");
  }
  if (arquivo.conteudo.length === 0 || arquivo.conteudo.length > TAMANHO_MAXIMO_AUDIO) {
    throw new AppError(413, "AUDIO_MUITO_GRANDE", "O arquivo de áudio excede o limite de 50 MB.");
  }
  return { ...arquivo, tipoConteudo: tipo };
}

function ehRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null;
}

async function resolverCategoriaAudio(idCategoria?: string, nomeOuCodigo?: string): Promise<string> {
  if (idCategoria) {
    return exigirCategoriaAtiva(idCategoria, "AUDIO");
  }

  if (nomeOuCodigo) {
    if (UUID.test(nomeOuCodigo)) {
      return exigirCategoriaAtiva(nomeOuCodigo, "AUDIO");
    }

    const mapaNomes: Record<string, string> = {
      NATUREZA: "Natureza",
      AMBIENTE: "Ambiente",
      INSTRUMENTAL: "Instrumental",
      RUIDO: "Ruído",
      RUIDOS: "Ruído",
    };
    const nomeBuscado = mapaNomes[nomeOuCodigo.toUpperCase()] || nomeOuCodigo;

    const cat = await prisma.categoria.findFirst({
      where: {
        tipo: "AUDIO",
        nome: { equals: nomeBuscado, mode: "insensitive" },
      },
    });

    if (!cat) {
      throw new AppError(400, "CATEGORIA_INVALIDA", `Categoria '${nomeOuCodigo}' não encontrada para áudios.`);
    }
    if (!cat.ativa) {
      throw new AppError(409, "CATEGORIA_INATIVA", "Uma categoria inativa não pode ser utilizada em novos áudios.");
    }
    return cat.idCategoria;
  }

  throw new AppError(400, "CATEGORIA_OBRIGATORIA", "A categoria é obrigatória.");
}

function dtoAudio(audio: {
  idAudio: string;
  idUsuario?: string;
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
}) {
  const nomeCategoria =
    typeof audio.categoria === "object" && audio.categoria !== null
      ? audio.categoria.nome
      : (typeof audio.categoria === "string" ? audio.categoria : "");

  return {
    idAudio: audio.idAudio,
    descricao: audio.descricao,
    categoria: nomeCategoria,
    arquivo: audio.arquivo,
    titulo: audio.titulo,
    tituloOriginal: audio.tituloOriginal,
    fonte: audio.fonte,
    licenca: audio.licenca,
  };
}

async function obterAudioExistente(idAudio: string) {
  validarId(idAudio);
  const audio = await prisma.audio.findUnique({
    where: { idAudio },
    include: { categoria: true },
  });
  if (!audio) {
    throw new AppError(404, "AUDIO_NAO_ENCONTRADO", "Áudio não encontrado.");
  }
  return audio;
}

async function enviarCloudinary(arquivo: ArquivoAudioRecebido): Promise<{ arquivo: string; publicId: string }> {
  const cloudinary = obterInstanciaCloudinary();
  const publicId = `sonessia/audios/${randomUUID()}`;
  try {
    const resposta: unknown = await cloudinary.uploader.upload(
      `data:${arquivo.tipoConteudo};base64,${arquivo.conteudo.toString("base64")}`,
      {
        public_id: publicId,
        resource_type: "video",
        type: "upload",
        allowed_formats: FORMATOS_CLOUDINARY,
        overwrite: false,
        unique_filename: false,
        use_filename: false,
        timeout: 60_000,
      }
    );
    if (!ehRegistro(resposta) ||
        resposta.public_id !== publicId ||
        resposta.resource_type !== "video" ||
        resposta.type !== "upload" ||
        typeof resposta.secure_url !== "string" ||
        !resposta.secure_url.startsWith("https://")) {
      await compensarUpload(publicId);
      throw new AppError(502, "RESPOSTA_CLOUDINARY_INVALIDA", "O Cloudinary não confirmou um áudio público válido.");
    }
    return { arquivo: resposta.secure_url, publicId };
  } catch (erro) {
    if (erro instanceof AppError) throw erro;
    throw new AppError(502, "FALHA_CLOUDINARY", "Não foi possível armazenar o arquivo de áudio.");
  }
}

async function compensarUpload(publicId: string): Promise<void> {
  try {
    const cloudinary = obterInstanciaCloudinary();
    await cloudinary.api.delete_resources([publicId], {
      resource_type: "video",
      type: "upload",
      invalidate: true,
      timeout: 60_000,
    });
  } catch {
    throw new AppError(502, "FALHA_REMOCAO_CLOUDINARY", "O upload falhou e o arquivo remoto não pôde ser compensado.");
  }
}

async function removerCloudinary(publicId: string): Promise<boolean> {
  const cloudinary = obterInstanciaCloudinary();
  try {
    const resposta: unknown = await cloudinary.api.delete_resources([publicId], {
      resource_type: "video",
      type: "upload",
      invalidate: true,
      timeout: 60_000,
    });
    if (!ehRegistro(resposta) || !ehRegistro(resposta.deleted)) {
      throw new AppError(502, "FALHA_REMOCAO_CLOUDINARY", "Não foi possível confirmar a remoção do áudio no Cloudinary.");
    }
    const estado = resposta.deleted[publicId];
    return estado === "deleted" || estado === "not_found";
  } catch (erro) {
    if (erro instanceof AppError) throw erro;
    throw new AppError(502, "FALHA_REMOCAO_CLOUDINARY", "Não foi possível remover o arquivo de áudio.");
  }
}

export async function criarAudio(
  idUsuario: string,
  metadadosDesconhecidos: unknown,
  arquivoDesconhecido?: ArquivoAudioRecebido
) {
  const metadados = schemaCriarAudio.parse(metadadosDesconhecidos);
  const idCategoria = await resolverCategoriaAudio(metadados.idCategoria, metadados.categoria);
  const arquivo = validarArquivo(arquivoDesconhecido);
  const remoto = await enviarCloudinary(arquivo);
  try {
    const audio = await prisma.audio.create({
      data: {
        descricao: metadados.descricao ?? null,
        idCategoria,
        titulo: metadados.titulo,
        tituloOriginal: metadados.tituloOriginal,
        fonte: metadados.fonte,
        licenca: metadados.licenca,
        arquivo: remoto.arquivo,
        arquivoPublicId: remoto.publicId,
        idUsuario,
      },
      include: {
        categoria: true,
      },
    });
    return dtoAudio(audio);
  } catch (erro) {
    await compensarUpload(remoto.publicId);
    throw erro;
  }
}

export async function listarAudios() {
  const audios = await prisma.audio.findMany({
    include: { categoria: true },
    orderBy: { titulo: "asc" },
  });
  return audios.map(dtoAudio);
}

export async function obterAudio(idAudio: string) {
  return dtoAudio(await obterAudioExistente(idAudio));
}

export async function atualizarAudio(idAudio: string, dados: unknown) {
  await obterAudioExistente(idAudio);
  const entrada: EntradaAtualizarAudio = schemaAtualizarAudio.parse(dados);
  const alteracao: Prisma.AudioUncheckedUpdateInput = {};
  if (entrada.descricao !== undefined) alteracao.descricao = entrada.descricao;
  if (entrada.idCategoria !== undefined || entrada.categoria !== undefined) {
    alteracao.idCategoria = await resolverCategoriaAudio(entrada.idCategoria, entrada.categoria);
  }
  if (entrada.titulo !== undefined) alteracao.titulo = entrada.titulo;
  if (entrada.tituloOriginal !== undefined) alteracao.tituloOriginal = entrada.tituloOriginal;
  if (entrada.fonte !== undefined) alteracao.fonte = entrada.fonte;
  if (entrada.licenca !== undefined) alteracao.licenca = entrada.licenca;
  const audio = await prisma.audio.update({
    where: { idAudio },
    data: alteracao,
    include: {
      categoria: true,
    },
  });
  return dtoAudio(audio);
}

export async function substituirArquivoAudio(idAudio: string, arquivoDesconhecido?: ArquivoAudioRecebido) {
  const atual = await obterAudioExistente(idAudio);
  const arquivo = validarArquivo(arquivoDesconhecido);
  const novo = await enviarCloudinary(arquivo);
  let audio;
  try {
    audio = await prisma.audio.update({
      where: { idAudio },
      data: { arquivo: novo.arquivo, arquivoPublicId: novo.publicId },
      include: {
        categoria: true,
      },
    });
  } catch (erro) {
    await compensarUpload(novo.publicId);
    throw erro;
  }

  let limpezaRemotaPendente = false;
  if (atual.arquivoPublicId) {
    try {
      await removerCloudinary(atual.arquivoPublicId);
    } catch {
      limpezaRemotaPendente = true;
    }
  }
  return { audio: dtoAudio(audio), limpezaRemotaPendente };
}

export async function excluirAudio(idAudio: string) {
  const audio = await obterAudioExistente(idAudio);
  const associacoes = await prisma.ambienteSonoroAudio.count({ where: { idAudio } });
  if (associacoes > 0) {
    throw new AppError(409, "AUDIO_POSSUI_ASSOCIACOES", "O áudio está associado a um ambiente sonoro e não pode ser excluído.");
  }

  await prisma.audio.delete({ where: { idAudio } });
  let limpezaRemotaPendente = false;
  if (audio.arquivoPublicId) {
    try {
      await removerCloudinary(audio.arquivoPublicId);
    } catch {
      limpezaRemotaPendente = true;
    }
  }
  return { limpezaRemotaPendente };
}
