import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { obterInstanciaCloudinary } from "../config/cloudinary.js";
import { AppError } from "../errors/app.error.js";
import { TAMANHO_MAXIMO_FOTO_PERFIL } from "../utils/foto-perfil.util.js";

const PASTA_FOTOS_PERFIL = "sonessia/perfis";
const DIMENSAO_MAXIMA_FOTO = 4096;
const TOTAL_MAXIMO_PIXELS = 16_000_000;
const TEMPO_LIMITE_CLOUDINARY_MS = 15_000;
const TEMPO_LIMITE_LEITURA_MS = 10_000;

const TIPOS_CONTEUDO = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

type TipoConteudoImagem = keyof typeof TIPOS_CONTEUDO;

interface DimensoesImagem {
  largura: number;
  altura: number;
}

export interface EntradaFotoPerfil {
  idUsuario: string;
  conteudo: Buffer;
  tipoConteudo: string;
}

export interface ResultadoAtualizacaoFotoPerfil {
  caminhoFoto: string;
  limpezaRemotaPendente: boolean;
}

export interface ResultadoRemocaoFotoPerfil {
  removida: boolean;
  limpezaRemotaPendente: boolean;
}

export interface ImagemPerfilPrivada {
  conteudo: Buffer;
  tipoConteudo: TipoConteudoImagem;
}

function lerUint24LittleEndian(conteudo: Buffer, deslocamento: number): number {
  return (
    conteudo[deslocamento]! |
    (conteudo[deslocamento + 1]! << 8) |
    (conteudo[deslocamento + 2]! << 16)
  );
}

function obterDimensoesPng(conteudo: Buffer): DimensoesImagem | null {
  if (
    conteudo.length < 33 ||
    !conteudo.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    conteudo.readUInt32BE(8) !== 13 ||
    conteudo.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return null;
  }

  return {
    largura: conteudo.readUInt32BE(16),
    altura: conteudo.readUInt32BE(20),
  };
}

function obterDimensoesJpeg(conteudo: Buffer): DimensoesImagem | null {
  if (
    conteudo.length < 4 ||
    conteudo[0] !== 0xff ||
    conteudo[1] !== 0xd8
  ) {
    return null;
  }

  const marcadoresComDimensoes = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let deslocamento = 2;

  while (deslocamento + 3 < conteudo.length) {
    if (conteudo[deslocamento] !== 0xff) {
      return null;
    }

    while (conteudo[deslocamento] === 0xff) {
      deslocamento += 1;
    }

    const marcador = conteudo[deslocamento]!;
    deslocamento += 1;

    if (marcador === 0xda || marcador === 0xd9) {
      return null;
    }

    if (
      marcador === 0x01 ||
      (marcador >= 0xd0 && marcador <= 0xd7)
    ) {
      continue;
    }

    if (deslocamento + 2 > conteudo.length) {
      return null;
    }

    const tamanhoSegmento = conteudo.readUInt16BE(deslocamento);
    if (
      tamanhoSegmento < 2 ||
      deslocamento + tamanhoSegmento > conteudo.length
    ) {
      return null;
    }

    if (marcadoresComDimensoes.has(marcador)) {
      if (tamanhoSegmento < 7) {
        return null;
      }

      return {
        altura: conteudo.readUInt16BE(deslocamento + 3),
        largura: conteudo.readUInt16BE(deslocamento + 5),
      };
    }

    deslocamento += tamanhoSegmento;
  }

  return null;
}

function obterDimensoesWebp(conteudo: Buffer): DimensoesImagem | null {
  if (
    conteudo.length < 20 ||
    conteudo.toString("ascii", 0, 4) !== "RIFF" ||
    conteudo.toString("ascii", 8, 12) !== "WEBP" ||
    conteudo.readUInt32LE(4) + 8 > conteudo.length
  ) {
    return null;
  }

  const tipoBloco = conteudo.toString("ascii", 12, 16);
  const tamanhoBloco = conteudo.readUInt32LE(16);

  if (tamanhoBloco + 20 > conteudo.length) {
    return null;
  }

  if (tipoBloco === "VP8X" && tamanhoBloco >= 10) {
    return {
      largura: lerUint24LittleEndian(conteudo, 24) + 1,
      altura: lerUint24LittleEndian(conteudo, 27) + 1,
    };
  }

  if (
    tipoBloco === "VP8 " &&
    tamanhoBloco >= 10 &&
    conteudo[23] === 0x9d &&
    conteudo[24] === 0x01 &&
    conteudo[25] === 0x2a
  ) {
    return {
      largura: conteudo.readUInt16LE(26) & 0x3fff,
      altura: conteudo.readUInt16LE(28) & 0x3fff,
    };
  }

  if (
    tipoBloco === "VP8L" &&
    tamanhoBloco >= 5 &&
    conteudo[20] === 0x2f
  ) {
    const byteUm = conteudo[21]!;
    const byteDois = conteudo[22]!;
    const byteTres = conteudo[23]!;
    const byteQuatro = conteudo[24]!;

    return {
      largura: 1 + byteUm + ((byteDois & 0x3f) << 8),
      altura:
        1 +
        (byteDois >> 6) +
        (byteTres << 2) +
        ((byteQuatro & 0x0f) << 10),
    };
  }

  return null;
}

function detectarImagem(
  conteudo: Buffer
): { tipoConteudo: TipoConteudoImagem; dimensoes: DimensoesImagem } | null {
  const dimensoesPng = obterDimensoesPng(conteudo);
  if (dimensoesPng) {
    return {
      tipoConteudo: "image/png",
      dimensoes: dimensoesPng,
    };
  }

  const dimensoesJpeg = obterDimensoesJpeg(conteudo);
  if (dimensoesJpeg) {
    return {
      tipoConteudo: "image/jpeg",
      dimensoes: dimensoesJpeg,
    };
  }

  const dimensoesWebp = obterDimensoesWebp(conteudo);
  if (dimensoesWebp) {
    return {
      tipoConteudo: "image/webp",
      dimensoes: dimensoesWebp,
    };
  }

  return null;
}

function validarImagem(
  conteudo: Buffer,
  tipoDeclarado?: string
): TipoConteudoImagem {
  if (
    tipoDeclarado !== undefined &&
    !Object.hasOwn(TIPOS_CONTEUDO, tipoDeclarado)
  ) {
    throw new AppError(
      415,
      "FORMATO_IMAGEM_NAO_SUPORTADO",
      "Envie a foto em JPEG, PNG ou WebP."
    );
  }

  if (!conteudo.length) {
    throw new AppError(400, "IMAGEM_VAZIA", "Envie um arquivo de imagem não vazio.");
  }

  if (conteudo.length > TAMANHO_MAXIMO_FOTO_PERFIL) {
    throw new AppError(
      413,
      "FOTO_PERFIL_MUITO_GRANDE",
      "A foto de perfil não pode exceder 5 MB."
    );
  }

  const imagemDetectada = detectarImagem(conteudo);
  if (!imagemDetectada || (tipoDeclarado && imagemDetectada.tipoConteudo !== tipoDeclarado)) {
    throw new AppError(
      400,
      "IMAGEM_INVALIDA",
      "O conteúdo enviado não corresponde a uma imagem JPEG, PNG ou WebP válida."
    );
  }

  const { largura, altura } = imagemDetectada.dimensoes;
  if (
    largura <= 0 ||
    altura <= 0 ||
    largura > DIMENSAO_MAXIMA_FOTO ||
    altura > DIMENSAO_MAXIMA_FOTO ||
    largura * altura > TOTAL_MAXIMO_PIXELS
  ) {
    throw new AppError(
      400,
      "DIMENSOES_IMAGEM_INVALIDAS",
      "A imagem deve ter até 4096 pixels por lado e no máximo 16 megapixels."
    );
  }

  return imagemDetectada.tipoConteudo;
}

function criarDataUri(conteudo: Buffer, tipoConteudo: TipoConteudoImagem): string {
  return `data:${tipoConteudo};base64,${conteudo.toString("base64")}`;
}

function verificarRespostaCloudinary(
  resposta: unknown,
  publicIdEsperado: string
): asserts resposta is {
  public_id: string;
  resource_type: string;
  type: string;
  format: string;
  width: number;
  height: number;
} {
  if (
    typeof resposta !== "object" ||
    resposta === null ||
    !("public_id" in resposta) ||
    !("resource_type" in resposta) ||
    !("type" in resposta) ||
    !("format" in resposta) ||
    !("width" in resposta) ||
    !("height" in resposta) ||
    resposta.public_id !== publicIdEsperado ||
    resposta.resource_type !== "image" ||
    resposta.type !== "authenticated" ||
    typeof resposta.format !== "string" ||
    !["jpg", "png", "webp"].includes(resposta.format) ||
    typeof resposta.width !== "number" ||
    typeof resposta.height !== "number" ||
    resposta.width <= 0 ||
    resposta.height <= 0 ||
    resposta.width > DIMENSAO_MAXIMA_FOTO ||
    resposta.height > DIMENSAO_MAXIMA_FOTO ||
    resposta.width * resposta.height > TOTAL_MAXIMO_PIXELS
  ) {
    throw new AppError(
      502,
      "RESPOSTA_CLOUDINARY_INVALIDA",
      "O armazenamento não confirmou uma foto privada válida."
    );
  }
}

function respostaIndicaImagemInvalida(erro: unknown): boolean {
  return (
    typeof erro === "object" &&
    erro !== null &&
    "http_code" in erro &&
    erro.http_code === 400
  );
}

async function enviarImagemCloudinary(
  publicId: string,
  conteudo: Buffer,
  tipoConteudo: TipoConteudoImagem
): Promise<void> {
  const cloudinary = obterInstanciaCloudinary();

  try {
    const resposta: unknown = await cloudinary.uploader.upload(
      criarDataUri(conteudo, tipoConteudo),
      {
        public_id: publicId,
        resource_type: "image",
        type: "authenticated",
        allowed_formats: Object.values(TIPOS_CONTEUDO),
        overwrite: false,
        unique_filename: false,
        use_filename: false,
        transformation: [
          { width: DIMENSAO_MAXIMA_FOTO, height: DIMENSAO_MAXIMA_FOTO, crop: "limit" },
        ],
        timeout: TEMPO_LIMITE_CLOUDINARY_MS,
      }
    );

    try {
      verificarRespostaCloudinary(resposta, publicId);
    } catch (erro) {
      await compensarUpload(publicId);
      throw erro;
    }
  } catch (erro) {
    if (erro instanceof AppError) {
      throw erro;
    }
    if (respostaIndicaImagemInvalida(erro)) {
      throw new AppError(
        400,
        "IMAGEM_INVALIDA",
        "O Cloudinary não conseguiu decodificar o arquivo como imagem válida."
      );
    }
    throw new AppError(
      502,
      "FALHA_CLOUDINARY",
      "Não foi possível armazenar a foto de perfil."
    );
  }
}

export async function excluirRecursoFotoPerfil(publicId: string): Promise<void> {
  const cloudinary = obterInstanciaCloudinary();
  const resposta: unknown = await cloudinary.api.delete_resources([publicId], {
    resource_type: "image",
    type: "authenticated",
    invalidate: true,
    timeout: TEMPO_LIMITE_CLOUDINARY_MS,
  });

  if (!ehRegistro(resposta) || !ehRegistro(resposta.deleted)) {
    throw new AppError(
      502,
      "FALHA_REMOCAO_CLOUDINARY",
      "Não foi possível confirmar a remoção da foto no armazenamento."
    );
  }

  const resultadoRemocao = resposta.deleted[publicId];
  if (
    resultadoRemocao !== "deleted" &&
    resultadoRemocao !== "not found" &&
    resultadoRemocao !== "not_found"
  ) {
    throw new AppError(
      502,
      "FALHA_REMOCAO_CLOUDINARY",
      "Não foi possível confirmar a remoção da foto no armazenamento."
    );
  }

  function ehRegistro(valor: unknown): valor is Record<string, unknown> {
    return typeof valor === "object" && valor !== null && !Array.isArray(valor);
  }
}

async function compensarUpload(publicId: string): Promise<void> {
  try {
    await excluirRecursoFotoPerfil(publicId);
  } catch {
    console.error(
      "[FOTO_PERFIL_ORFA]: Não foi possível remover um upload compensatório do Cloudinary."
    );
  }
}

export async function atualizarFotoPerfil(
  entrada: EntradaFotoPerfil
): Promise<ResultadoAtualizacaoFotoPerfil> {
  const tipoConteudo = validarImagem(entrada.conteudo, entrada.tipoConteudo);
  const usuario = await prisma.usuario.findUnique({
    where: { id: entrada.idUsuario },
    select: { fotoPerfilPublicId: true },
  });

  if (!usuario) {
    throw new AppError(404, "USUARIO_NAO_ENCONTRADO", "Usuário não encontrado.");
  }

  const novoPublicId = `${PASTA_FOTOS_PERFIL}/${randomUUID()}`;
  await enviarImagemCloudinary(novoPublicId, entrada.conteudo, tipoConteudo);

  let atualizacao;
  try {
    atualizacao = await prisma.usuario.updateMany({
      where: {
        id: entrada.idUsuario,
        fotoPerfilPublicId: usuario.fotoPerfilPublicId,
        exclusaoDefinitivaEm: null,
      },
      data: { fotoPerfilPublicId: novoPublicId },
    });
  } catch (erro) {
    await compensarUpload(novoPublicId);
    throw erro;
  }

  if (atualizacao.count !== 1) {
    await compensarUpload(novoPublicId);
    throw new AppError(
      409,
      "FOTO_PERFIL_ALTERADA_CONCORRENTEMENTE",
      "A foto de perfil foi alterada por outra requisição. Tente novamente."
    );
  }

  let limpezaRemotaPendente = false;
  if (usuario.fotoPerfilPublicId) {
    try {
      await excluirRecursoFotoPerfil(usuario.fotoPerfilPublicId);
    } catch {
      limpezaRemotaPendente = true;
      console.error(
        "[FOTO_PERFIL_ORFA]: A foto anterior permaneceu no Cloudinary após uma substituição."
      );
    }
  }

  return {
    caminhoFoto: "/autenticacao/eu/foto-perfil",
    limpezaRemotaPendente,
  };
}

export async function removerFotoPerfil(
  idUsuario: string
): Promise<ResultadoRemocaoFotoPerfil> {
  const usuario = await prisma.usuario.findUnique({
    where: { id: idUsuario },
    select: { fotoPerfilPublicId: true },
  });

  if (!usuario) {
    throw new AppError(404, "USUARIO_NAO_ENCONTRADO", "Usuário não encontrado.");
  }

  if (!usuario.fotoPerfilPublicId) {
    return { removida: false, limpezaRemotaPendente: false };
  }

  const atualizacao = await prisma.usuario.updateMany({
    where: {
      id: idUsuario,
      fotoPerfilPublicId: usuario.fotoPerfilPublicId,
      exclusaoDefinitivaEm: null,
    },
    data: { fotoPerfilPublicId: null },
  });

  if (atualizacao.count !== 1) {
    throw new AppError(
      409,
      "FOTO_PERFIL_ALTERADA_CONCORRENTEMENTE",
      "A foto de perfil foi alterada por outra requisição. Tente novamente."
    );
  }

  try {
    await excluirRecursoFotoPerfil(usuario.fotoPerfilPublicId);
    return { removida: true, limpezaRemotaPendente: false };
  } catch {
    console.error(
      "[FOTO_PERFIL_ORFA]: A foto foi removida da conta, mas permaneceu no Cloudinary."
    );
    return { removida: true, limpezaRemotaPendente: true };
  }
}

async function lerRespostaLimitada(
  resposta: Response
): Promise<Buffer> {
  const tamanhoDeclarado = Number(resposta.headers.get("content-length") ?? 0);
  if (tamanhoDeclarado > TAMANHO_MAXIMO_FOTO_PERFIL) {
    throw new AppError(
      502,
      "RESPOSTA_CLOUDINARY_MUITO_GRANDE",
      "A imagem retornada pelo armazenamento excedeu o limite permitido."
    );
  }

  if (!resposta.body) {
    throw new AppError(
      502,
      "RESPOSTA_CLOUDINARY_INVALIDA",
      "O armazenamento retornou uma imagem vazia."
    );
  }

  const leitor = resposta.body.getReader();
  const partes: Buffer[] = [];
  let tamanhoTotal = 0;

  try {
    while (true) {
      const { done, value } = await leitor.read();
      if (done) {
        break;
      }

      tamanhoTotal += value.byteLength;
      if (tamanhoTotal > TAMANHO_MAXIMO_FOTO_PERFIL) {
        await leitor.cancel();
        throw new AppError(
          502,
          "RESPOSTA_CLOUDINARY_MUITO_GRANDE",
          "A imagem retornada pelo armazenamento excedeu o limite permitido."
        );
      }
      partes.push(Buffer.from(value));
    }
  } finally {
    leitor.releaseLock();
  }

  return Buffer.concat(partes, tamanhoTotal);
}

export async function obterFotoPerfilPrivada(
  idUsuario: string
): Promise<ImagemPerfilPrivada> {
  const usuario = await prisma.usuario.findUnique({
    where: { id: idUsuario },
    select: { fotoPerfilPublicId: true },
  });

  if (!usuario?.fotoPerfilPublicId) {
    throw new AppError(
      404,
      "FOTO_PERFIL_NAO_ENCONTRADA",
      "O usuário não possui foto de perfil."
    );
  }

  const cloudinary = obterInstanciaCloudinary();
  const urlEntrega = cloudinary.utils.url(usuario.fotoPerfilPublicId, {
    resource_type: "image",
    type: "authenticated",
    secure: true,
    sign_url: true,
  });

  let origem: URL;
  try {
    origem = new URL(urlEntrega);
  } catch {
    throw new AppError(
      502,
      "URL_CLOUDINARY_INVALIDA",
      "Não foi possível preparar a leitura da foto."
    );
  }

  if (origem.protocol !== "https:" || origem.hostname !== "res.cloudinary.com") {
    throw new AppError(
      502,
      "URL_CLOUDINARY_INVALIDA",
      "Não foi possível preparar a leitura da foto."
    );
  }

  const controlador = new AbortController();
  const temporizador = setTimeout(
    () => controlador.abort(),
    TEMPO_LIMITE_LEITURA_MS
  );

  try {
    const resposta = await fetch(urlEntrega, {
      method: "GET",
      redirect: "error",
      signal: controlador.signal,
    });

    if (resposta.status === 404) {
      throw new AppError(
        404,
        "FOTO_PERFIL_NAO_ENCONTRADA",
        "A foto de perfil não está disponível."
      );
    }

    if (!resposta.ok) {
      throw new AppError(
        502,
        "FALHA_LEITURA_CLOUDINARY",
        "Não foi possível obter a foto de perfil."
      );
    }

    const tipoDeclarado = resposta.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim();
    const conteudo = await lerRespostaLimitada(resposta);
    let tipoConteudo: TipoConteudoImagem;
    try {
      tipoConteudo = validarImagem(conteudo, tipoDeclarado);
    } catch {
      throw new AppError(
        502,
        "RESPOSTA_CLOUDINARY_INVALIDA",
        "O armazenamento retornou um conteúdo de imagem inválido."
      );
    }

    return { conteudo, tipoConteudo };
  } catch (erro) {
    if (erro instanceof AppError) {
      throw erro;
    }
    throw new AppError(
      502,
      "FALHA_LEITURA_CLOUDINARY",
      "Não foi possível obter a foto de perfil."
    );
  } finally {
    clearTimeout(temporizador);
  }
}
