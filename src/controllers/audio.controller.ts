import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app.error.js";
import * as servicoAudio from "../services/audio.service.js";

function idUsuario(req: Request): string {
  if (!req.usuario) throw new AppError(401, "NAO_AUTENTICADO", "Usuário não autenticado.");
  return req.usuario.id;
}

function idAudio(req: Request): string {
  if (typeof req.params.idAudio !== "string") {
    throw new AppError(400, "ID_AUDIO_INVALIDO", "O identificador do áudio é inválido.");
  }
  return req.params.idAudio;
}

export async function criarAudio(req: Request, res: Response, next: NextFunction) {
  try {
    const audio = await servicoAudio.criarAudio(idUsuario(req), req.metadadosAudio, req.arquivoAudio);
    res.status(201).json({ mensagem: "Áudio cadastrado com sucesso.", audio });
  } catch (erro) { next(erro); }
}

export async function listarAudios(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ audios: await servicoAudio.listarAudios() });
  } catch (erro) { next(erro); }
}

export async function obterAudio(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ audio: await servicoAudio.obterAudio(idAudio(req)) });
  } catch (erro) { next(erro); }
}

export async function atualizarAudio(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({
      mensagem: "Áudio atualizado com sucesso.",
      audio: await servicoAudio.atualizarAudio(idAudio(req), req.body),
    });
  } catch (erro) { next(erro); }
}

export async function substituirArquivoAudio(req: Request, res: Response, next: NextFunction) {
  try {
    const resultado = await servicoAudio.substituirArquivoAudio(idAudio(req), req.arquivoAudio);
    res.status(200).json({ mensagem: "Arquivo do áudio substituído com sucesso.", audio: resultado.audio, limpezaRemotaPendente: resultado.limpezaRemotaPendente });
  } catch (erro) { next(erro); }
}

export async function excluirAudio(req: Request, res: Response, next: NextFunction) {
  try {
    const resultado = await servicoAudio.excluirAudio(idAudio(req));
    res.status(resultado.limpezaRemotaPendente ? 202 : 200).json({
      mensagem: resultado.limpezaRemotaPendente ? "Áudio removido; a limpeza remota está pendente." : "Áudio excluído com sucesso.",
      limpezaRemotaPendente: resultado.limpezaRemotaPendente,
    });
  } catch (erro) { next(erro); }
}
