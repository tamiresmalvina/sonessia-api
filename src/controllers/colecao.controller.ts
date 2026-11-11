import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app.error.js";
import * as servicoColecao from "../services/colecao.service.js";

function idUsuario(req: Request): string {
  if (!req.usuario) {
    throw new AppError(401, "NAO_AUTENTICADO", "Usuário não autenticado.");
  }
  return req.usuario.id;
}

function idColecao(req: Request): string {
  const { idColecao } = req.params;
  if (typeof idColecao !== "string") {
    throw new AppError(400, "ID_COLECAO_INVALIDO", "O identificador da coleção é inválido.");
  }
  return idColecao;
}

function idAmbienteSonoro(req: Request): string {
  const { idAmbienteSonoro } = req.params;
  if (typeof idAmbienteSonoro !== "string") {
    throw new AppError(400, "ID_AMBIENTE_INVALIDO", "O identificador do ambiente sonoro é inválido.");
  }
  return idAmbienteSonoro;
}

export async function criarColecao(req: Request, res: Response, next: NextFunction) {
  try {
    const colecao = await servicoColecao.criarColecao(idUsuario(req), req.body);
    res.status(201).json({
      mensagem: "Coleção criada com sucesso.",
      colecao,
    });
  } catch (erro) {
    next(erro);
  }
}

export async function listarColecoes(req: Request, res: Response, next: NextFunction) {
  try {
    const colecoes = await servicoColecao.listarColecoes(idUsuario(req));
    res.status(200).json({ colecoes });
  } catch (erro) {
    next(erro);
  }
}

export async function obterColecao(req: Request, res: Response, next: NextFunction) {
  try {
    const colecao = await servicoColecao.obterColecao(idUsuario(req), idColecao(req));
    res.status(200).json({ colecao });
  } catch (erro) {
    next(erro);
  }
}

export async function atualizarColecao(req: Request, res: Response, next: NextFunction) {
  try {
    const colecao = await servicoColecao.atualizarColecao(
      idUsuario(req),
      idColecao(req),
      req.body
    );
    res.status(200).json({
      mensagem: "Coleção atualizada com sucesso.",
      colecao,
    });
  } catch (erro) {
    next(erro);
  }
}

export async function excluirColecao(req: Request, res: Response, next: NextFunction) {
  try {
    await servicoColecao.excluirColecao(idUsuario(req), idColecao(req));
    res.status(200).json({
      mensagem: "Coleção excluída com sucesso.",
    });
  } catch (erro) {
    next(erro);
  }
}

export async function adicionarAmbienteColecao(req: Request, res: Response, next: NextFunction) {
  try {
    const colecao = await servicoColecao.adicionarAmbienteColecao(
      idUsuario(req),
      idColecao(req),
      req.body
    );
    res.status(201).json({
      mensagem: "Ambiente sonoro adicionado à coleção com sucesso.",
      colecao,
    });
  } catch (erro) {
    next(erro);
  }
}

export async function removerAmbienteColecao(req: Request, res: Response, next: NextFunction) {
  try {
    await servicoColecao.removerAmbienteColecao(
      idUsuario(req),
      idColecao(req),
      idAmbienteSonoro(req)
    );
    res.status(200).json({
      mensagem: "Ambiente sonoro removido da coleção com sucesso.",
    });
  } catch (erro) {
    next(erro);
  }
}

