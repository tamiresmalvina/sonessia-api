import type { NextFunction, Request, Response } from "express";
import * as servicoCategoria from "../services/categoria.service.js";
import { schemaFiltroCategorias } from "../schemas/categoria.schema.js";
import { AppError } from "../errors/app.error.js";

function idCategoria(req: Request): string {
  if (typeof req.params.id !== "string") {
    throw new AppError(400, "ID_CATEGORIA_INVALIDO", "O identificador da categoria é inválido.");
  }
  return req.params.id;
}

export async function listarCategorias(req: Request, res: Response, next: NextFunction) {
  try {
    const filtro = schemaFiltroCategorias.parse(req.query);
    const categorias = await servicoCategoria.listarCategorias(filtro);
    res.status(200).json({ categorias });
  } catch (erro) {
    next(erro);
  }
}

export async function criarCategoria(req: Request, res: Response, next: NextFunction) {
  try {
    const categoria = await servicoCategoria.criarCategoria(req.body);
    res.status(201).json({ mensagem: "Categoria criada com sucesso.", categoria });
  } catch (erro) {
    next(erro);
  }
}

export async function atualizarCategoria(req: Request, res: Response, next: NextFunction) {
  try {
    const categoria = await servicoCategoria.atualizarCategoria(idCategoria(req), req.body);
    res.status(200).json({ mensagem: "Categoria atualizada com sucesso.", categoria });
  } catch (erro) {
    next(erro);
  }
}

export async function excluirCategoria(req: Request, res: Response, next: NextFunction) {
  try {
    await servicoCategoria.excluirCategoria(idCategoria(req));
    res.status(200).json({ mensagem: "Categoria excluída com sucesso." });
  } catch (erro) {
    next(erro);
  }
}
