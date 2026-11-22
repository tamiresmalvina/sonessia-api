import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../errors/app.error.js";
import {
  schemaAtualizarCategoria,
  schemaCriarCategoria,
  schemaIdCategoria,
  type FiltroCategorias,
} from "../schemas/categoria.schema.js";

type TipoCategoria = "AUDIO" | "AMBIENTE";

function erroPrismaComCodigo(erro: unknown, codigo: string): boolean {
  return typeof erro === "object" && erro !== null && "code" in erro &&
    (erro as { code?: unknown }).code === codigo;
}

function categoriaDuplicada(): AppError {
  return new AppError(409, "CATEGORIA_DUPLICADA", "Já existe uma categoria com esse nome para este tipo.");
}

async function validarNomeDisponivel(nome: string, tipo: TipoCategoria, idIgnorado?: string): Promise<void> {
  const existentes = await prisma.categoria.findMany({
    where: { tipo },
    select: { idCategoria: true, nome: true },
  });
  const chaveNormalizada = nome.trim().toLowerCase();
  const duplicada = existentes.some((categoria) =>
    categoria.idCategoria !== idIgnorado &&
    categoria.nome.trim().toLowerCase() === chaveNormalizada
  );
  if (duplicada) throw categoriaDuplicada();
}

export async function exigirCategoriaAtiva(idCategoria: string, tipoEsperado: TipoCategoria): Promise<string> {
  const id = schemaIdCategoria.parse(idCategoria);
  const categoria = await prisma.categoria.findUnique({ where: { idCategoria: id } });

  if (!categoria) {
    throw new AppError(404, "CATEGORIA_NAO_ENCONTRADA", "Categoria não encontrada.");
  }
  if (categoria.tipo !== tipoEsperado) {
    throw new AppError(400, "CATEGORIA_TIPO_INVALIDO", `A categoria deve ser do tipo ${tipoEsperado}.`);
  }
  if (!categoria.ativa) {
    throw new AppError(409, "CATEGORIA_INATIVA", "Uma categoria inativa não pode ser utilizada em novos cadastros.");
  }

  return categoria.idCategoria;
}

export async function listarCategorias(filtro: FiltroCategorias) {
  return prisma.categoria.findMany({
    where: {
      tipo: filtro.tipo,
      ...(filtro.incluirInativas ? {} : { ativa: true }),
    },
    orderBy: [{ nome: "asc" }, { idCategoria: "asc" }],
  });
}

export async function criarCategoria(dadosBrutos: unknown) {
  const dados = schemaCriarCategoria.parse(dadosBrutos);
  await validarNomeDisponivel(dados.nome, dados.tipo);

  try {
    return await prisma.categoria.create({ data: dados });
  } catch (erro) {
    if (erroPrismaComCodigo(erro, "P2002")) throw categoriaDuplicada();
    throw erro;
  }
}

export async function atualizarCategoria(idCategoriaBruto: string, dadosBrutos: unknown) {
  const idCategoria = schemaIdCategoria.parse(idCategoriaBruto);
  const dados = schemaAtualizarCategoria.parse(dadosBrutos);
  const existente = await prisma.categoria.findUnique({ where: { idCategoria } });

  if (!existente) {
    throw new AppError(404, "CATEGORIA_NAO_ENCONTRADA", "Categoria não encontrada.");
  }
  if (dados.nome !== undefined) {
    await validarNomeDisponivel(dados.nome, existente.tipo, idCategoria);
  }

  const alteracao: Prisma.CategoriaUpdateInput = {};
  if (dados.nome !== undefined) alteracao.nome = dados.nome;
  if (dados.ativa !== undefined) alteracao.ativa = dados.ativa;

  try {
    return await prisma.categoria.update({ where: { idCategoria }, data: alteracao });
  } catch (erro) {
    if (erroPrismaComCodigo(erro, "P2002")) throw categoriaDuplicada();
    throw erro;
  }
}

export async function excluirCategoria(idCategoriaBruto: string): Promise<void> {
  const idCategoria = schemaIdCategoria.parse(idCategoriaBruto);
  const categoria = await prisma.categoria.findUnique({ where: { idCategoria } });
  if (!categoria) {
    throw new AppError(404, "CATEGORIA_NAO_ENCONTRADA", "Categoria não encontrada.");
  }

  const [quantidadeAudios, quantidadeAmbientes] = await Promise.all([
    prisma.audio.count({ where: { idCategoria } }),
    prisma.ambienteSonoro.count({ where: { idCategoria } }),
  ]);
  if (quantidadeAudios > 0 || quantidadeAmbientes > 0) {
    throw new AppError(
      409,
      "CATEGORIA_POSSUI_ASSOCIACOES",
      "A categoria está vinculada a áudios ou ambientes sonoros e não pode ser excluída."
    );
  }

  try {
    await prisma.categoria.delete({ where: { idCategoria } });
  } catch (erro) {
    if (erroPrismaComCodigo(erro, "P2003")) {
      throw new AppError(
        409,
        "CATEGORIA_POSSUI_ASSOCIACOES",
        "A categoria está vinculada a áudios ou ambientes sonoros e não pode ser excluída."
      );
    }
    throw erro;
  }
}
