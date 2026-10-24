import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/app.error.js";
import {
  atualizarFotoPerfil as atualizarFotoPerfilServico,
  obterFotoPerfilPrivada,
  removerFotoPerfil as removerFotoPerfilServico,
} from "../services/foto-perfil.service.js";

function obterIdUsuario(req: Request): string {
  if (!req.usuario) {
    throw new AppError(401, "NAO_AUTENTICADO", "Usuário não autenticado.");
  }

  return req.usuario.id;
}

function obterTipoConteudo(req: Request): string {
  return req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() ?? "";
}

export async function atualizarFotoPerfil(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const conteudo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const resultado = await atualizarFotoPerfilServico({
      idUsuario: obterIdUsuario(req),
      conteudo,
      tipoConteudo: obterTipoConteudo(req),
    });

    res.status(resultado.limpezaRemotaPendente ? 202 : 200).json({
      mensagem: resultado.limpezaRemotaPendente
        ? "Foto atualizada; a limpeza remota anterior está pendente."
        : "Foto de perfil atualizada com sucesso.",
      fotoPerfil: resultado.caminhoFoto,
      limpezaRemotaPendente: resultado.limpezaRemotaPendente,
    });
  } catch (erro) {
    next(erro);
  }
}

export async function obterFotoPerfil(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.set({
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
    Vary: "Authorization",
  });

  try {
    const imagem = await obterFotoPerfilPrivada(obterIdUsuario(req));

    res
      .status(200)
      .set({
        "Content-Type": imagem.tipoConteudo,
        "X-Content-Type-Options": "nosniff",
      })
      .send(imagem.conteudo);
  } catch (erro) {
    next(erro);
  }
}

export async function removerFotoPerfil(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const resultado = await removerFotoPerfilServico(obterIdUsuario(req));

    res.status(resultado.limpezaRemotaPendente ? 202 : 200).json({
      mensagem: resultado.limpezaRemotaPendente
        ? "Foto removida da conta; a limpeza remota está pendente."
        : "Foto de perfil removida com sucesso.",
      fotoPerfil: null,
      limpezaRemotaPendente: resultado.limpezaRemotaPendente,
      removida: resultado.removida,
    });
  } catch (erro) {
    next(erro);
  }
}
