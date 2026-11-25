import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app.error.js";
import * as servicoHistoricoReproducao from "../services/historico-reproducao.service.js";

function idUsuario(req: Request): string {
  if (!req.usuario) {
    throw new AppError(401, "NAO_AUTENTICADO", "Usuário não autenticado.");
  }
  return req.usuario.id;
}

export async function registrarReproducao(req: Request, res: Response, next: NextFunction) {
  try {
    const resultado = await servicoHistoricoReproducao.registrarReproducao(idUsuario(req), req.body);
    res.status(200).json(resultado);
  } catch (erro) {
    next(erro);
  }
}

export async function listarReproducoesRecentes(req: Request, res: Response, next: NextFunction) {
  try {
    const ambientes = await servicoHistoricoReproducao.listarReproducoesRecentes(idUsuario(req));
    res.status(200).json({ ambientes });
  } catch (erro) {
    next(erro);
  }
}
