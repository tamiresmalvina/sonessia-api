import type { NextFunction, Request, Response } from "express";
import { Finalidade } from "../../generated/prisma/enums.js";
import { AppError } from "../errors/app.error.js";
import * as servicoAmbienteSonoro from "../services/ambiente-sonoro.service.js";
import {
  schemaFiltroAmbientesPublicos,
  schemaFiltroAmbientesSonoros,
} from "../schemas/ambiente-sonoro.schema.js";

function idUsuario(req: Request): string {
  if (!req.usuario) {
    throw new AppError(401, "NAO_AUTENTICADO", "Usuário não autenticado.");
  }
  return req.usuario.id;
}

function idAmbienteSonoro(req: Request): string {
  const { idAmbienteSonoro } = req.params;
  if (typeof idAmbienteSonoro !== "string") {
    throw new AppError(400, "ID_AMBIENTE_INVALIDO", "O identificador do ambiente sonoro é inválido.");
  }
  return idAmbienteSonoro;
}

/* ========================================================================= */
/* AMBIENTES PERSONALIZADOS (US05)                                           */
/* ========================================================================= */

export async function criarAmbienteSonoro(req: Request, res: Response, next: NextFunction) {
  try {
    const ambiente = await servicoAmbienteSonoro.criarAmbienteSonoro(idUsuario(req), req.body);
    res.status(201).json({
      mensagem: "Ambiente sonoro criado com sucesso.",
      ambiente,
    });
  } catch (erro) {
    next(erro);
  }
}

export async function listarAmbientesSonoros(req: Request, res: Response, next: NextFunction) {
  try {
    const filtro = schemaFiltroAmbientesSonoros.parse(req.query);
    const opcoes: { semColecao?: boolean } = {};
    if (filtro.semColecao !== undefined) {
      opcoes.semColecao = filtro.semColecao;
    }
    const ambientes = await servicoAmbienteSonoro.listarAmbientesSonoros(idUsuario(req), opcoes);
    res.status(200).json({ ambientes });
  } catch (erro) {
    next(erro);
  }
}

export async function obterAmbienteSonoro(req: Request, res: Response, next: NextFunction) {
  try {
    const ambiente = await servicoAmbienteSonoro.obterAmbienteSonoro(
      idUsuario(req),
      idAmbienteSonoro(req)
    );
    res.status(200).json({ ambiente });
  } catch (erro) {
    next(erro);
  }
}

export async function atualizarAmbienteSonoro(req: Request, res: Response, next: NextFunction) {
  try {
    const ambiente = await servicoAmbienteSonoro.atualizarAmbienteSonoro(
      idUsuario(req),
      idAmbienteSonoro(req),
      req.body
    );
    res.status(200).json({
      mensagem: "Ambiente sonoro atualizado com sucesso.",
      ambiente,
    });
  } catch (erro) {
    next(erro);
  }
}

export async function excluirAmbienteSonoro(req: Request, res: Response, next: NextFunction) {
  try {
    await servicoAmbienteSonoro.excluirAmbienteSonoro(idUsuario(req), idAmbienteSonoro(req));
    res.status(200).json({
      mensagem: "Ambiente sonoro excluído com sucesso.",
    });
  } catch (erro) {
    next(erro);
  }
}

/* ========================================================================= */
/* AMBIENTES PRÉ-CONFIGURADOS (ADMIN - US02)                                 */
/* ========================================================================= */

export async function criarAmbientePreConfigurado(req: Request, res: Response, next: NextFunction) {
  try {
    const ambiente = await servicoAmbienteSonoro.criarAmbientePreConfigurado(
      idUsuario(req),
      req.body
    );
    res.status(201).json({
      mensagem: "Ambiente sonoro pré-configurado criado com sucesso.",
      ambiente,
    });
  } catch (erro) {
    next(erro);
  }
}

export async function listarAmbientesPreConfigurados(req: Request, res: Response, next: NextFunction) {
  try {
    let finalidade: Finalidade | undefined;
    if (typeof req.query.finalidade === "string") {
      finalidade = schemaFiltroAmbientesPublicos.parse({ finalidade: req.query.finalidade }).finalidade;
    }

    let publicado: boolean | undefined;
    if (req.query.publicado === "true") publicado = true;
    if (req.query.publicado === "false") publicado = false;

    const filtros: { finalidade?: Finalidade; publicado?: boolean } = {};
    if (finalidade !== undefined) filtros.finalidade = finalidade;
    if (publicado !== undefined) filtros.publicado = publicado;

    const ambientes = await servicoAmbienteSonoro.listarAmbientesPreConfigurados(filtros);
    res.status(200).json({ ambientes });
  } catch (erro) {
    next(erro);
  }
}

export async function obterAmbientePreConfigurado(req: Request, res: Response, next: NextFunction) {
  try {
    const ambiente = await servicoAmbienteSonoro.obterAmbientePreConfigurado(idAmbienteSonoro(req));
    res.status(200).json({ ambiente });
  } catch (erro) {
    next(erro);
  }
}

export async function atualizarAmbientePreConfigurado(req: Request, res: Response, next: NextFunction) {
  try {
    const ambiente = await servicoAmbienteSonoro.atualizarAmbientePreConfigurado(
      idAmbienteSonoro(req),
      req.body
    );
    res.status(200).json({
      mensagem: "Ambiente sonoro pré-configurado atualizado com sucesso.",
      ambiente,
    });
  } catch (erro) {
    next(erro);
  }
}

export async function alterarPublicacaoAmbientePreConfigurado(req: Request, res: Response, next: NextFunction) {
  try {
    const { publicado } = req.body as { publicado: boolean };
    const ambiente = await servicoAmbienteSonoro.alterarPublicacaoAmbientePreConfigurado(
      idAmbienteSonoro(req),
      publicado
    );
    res.status(200).json({
      mensagem: ambiente.publicado
        ? "Ambiente sonoro publicado com sucesso."
        : "Ambiente sonoro despublicado com sucesso.",
      ambiente,
    });
  } catch (erro) {
    next(erro);
  }
}

export async function excluirAmbientePreConfigurado(req: Request, res: Response, next: NextFunction) {
  try {
    await servicoAmbienteSonoro.excluirAmbientePreConfigurado(idAmbienteSonoro(req));
    res.status(200).json({
      mensagem: "Ambiente sonoro pré-configurado excluído com sucesso.",
    });
  } catch (erro) {
    next(erro);
  }
}

/* ========================================================================= */
/* CONSULTAS PÚBLICAS (US08 / US14)                                          */
/* ========================================================================= */

export async function listarAmbientesPublicos(req: Request, res: Response, next: NextFunction) {
  try {
    let finalidade: Finalidade | undefined;
    if (typeof req.query.finalidade === "string") {
      finalidade = schemaFiltroAmbientesPublicos.parse({ finalidade: req.query.finalidade }).finalidade;
    }
    const ambientes = await servicoAmbienteSonoro.listarAmbientesPublicos(finalidade);
    res.status(200).json({ ambientes });
  } catch (erro) {
    next(erro);
  }
}

export async function obterAmbientePublico(req: Request, res: Response, next: NextFunction) {
  try {
    const ambiente = await servicoAmbienteSonoro.obterAmbientePublico(idAmbienteSonoro(req));
    res.status(200).json({ ambiente });
  } catch (erro) {
    next(erro);
  }
}

export async function listarFinalidadesDisponiveis(_req: Request, res: Response, next: NextFunction) {
  try {
    const finalidades = servicoAmbienteSonoro.listarFinalidadesDisponiveis();
    res.status(200).json({ finalidades });
  } catch (erro) {
    next(erro);
  }
}
