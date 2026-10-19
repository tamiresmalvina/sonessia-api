import type { Request, Response, NextFunction } from "express";
import * as servicoAutenticacao from "../services/autenticacao.service.js";

export async function cadastrar(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const resultado = await servicoAutenticacao.cadastrarUsuario(req.body);
    res.status(201).json(resultado);
  } catch (erro) {
    next(erro);
  }
}

export async function verificarEmail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const resultado = await servicoAutenticacao.verificarEmail(req.body);
    res.status(200).json(resultado);
  } catch (erro) {
    next(erro);
  }
}

export async function reenviarCodigo(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const resultado = await servicoAutenticacao.reenviarCodigoVerificacao(req.body);
    res.status(200).json(resultado);
  } catch (erro) {
    next(erro);
  }
}
