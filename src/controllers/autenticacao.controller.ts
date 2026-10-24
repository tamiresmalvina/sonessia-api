import type { Request, Response, NextFunction } from "express";
import * as servicoAutenticacao from "../services/autenticacao.service.js";
import {
  definirCookieRefresh,
  limparCookieRefresh,
  NOME_COOKIE_REFRESH,
} from "../utils/cookie.util.js";
import { validarTokenParaLogout } from "../utils/jwt.util.js";
import { AppError } from "../errors/app.error.js";
import {
  reativarConta as reativarContaServico,
  solicitarExclusaoConta as solicitarExclusaoContaServico,
} from "../services/exclusao-conta.service.js";

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

export async function login(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  let idSessaoCriada: string | null = null;
  try {
    const resultado = await servicoAutenticacao.autenticarUsuario(req.body);
    idSessaoCriada = resultado.idSessao;

    definirCookieRefresh(res, resultado.refreshToken);

    res.status(200).json({
      mensagem: "Login realizado com sucesso.",
      tokenAcesso: resultado.tokenAcesso,
      usuario: resultado.usuario,
    });
  } catch (erro) {
    if (idSessaoCriada) {
      await servicoAutenticacao.limparSessaoFalha(idSessaoCriada);
    }
    next(erro);
  }
}

export async function renovarSessao(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const refreshToken = req.cookies?.[NOME_COOKIE_REFRESH];

    if (
      !refreshToken ||
      typeof refreshToken !== "string" ||
      refreshToken.trim().length !== 64 ||
      !/^[0-9a-fA-F]{64}$/.test(refreshToken.trim())
    ) {
      limparCookieRefresh(res);
      throw new AppError(
        401,
        "TOKEN_ATUALIZACAO_INVALIDO",
        "Token de atualização ausente ou inválido."
      );
    }

    const resultado = await servicoAutenticacao.renovarSessao(refreshToken.trim());

    // Atualiza o cookie com o novo token de atualização gerado na rotação
    definirCookieRefresh(res, resultado.novoRefreshToken);

    res.status(200).json({
      mensagem: "Sessão renovada com sucesso.",
      tokenAcesso: resultado.tokenAcesso,
      usuario: resultado.usuario,
    });
  } catch (erro) {
    // Limpa o cookie apenas em erros comprovados de invalidação da sessão, sem limpar em falhas internas/temporárias
    const codigosInvalidantes = [
      "REUTILIZACAO_DETECTADA",
      "SESSAO_EXPIRADA",
      "SESSAO_INVALIDA",
      "TOKEN_ATUALIZACAO_INVALIDO",
      "EMAIL_NAO_VERIFICADO",
      "CONTA_EXCLUSAO_PENDENTE",
    ];

    if (erro instanceof AppError && codigosInvalidantes.includes(erro.codigo)) {
      limparCookieRefresh(res);
    }

    next(erro);
  }
}

export async function obterUsuarioAtual(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.usuario) {
      throw new AppError(401, "NAO_AUTENTICADO", "Usuário não autenticado.");
    }

    res.status(200).json({
      usuario: {
        id: req.usuario.id,
        nome: req.usuario.nome,
        email: req.usuario.email,
        perfil: req.usuario.perfil,
        fotoPerfil: req.usuario.fotoPerfilPublicId
          ? "/autenticacao/eu/foto-perfil"
          : null,
      },
    });
  } catch (erro) {
    next(erro);
  }
}

export async function atualizarNome(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.usuario) {
      throw new AppError(401, "NAO_AUTENTICADO", "Usuário não autenticado.");
    }

    const usuario = await servicoAutenticacao.atualizarNomeUsuario(
      req.usuario,
      req.body
    );

    res.status(200).json({
      mensagem: "Nome atualizado com sucesso.",
      usuario,
    });
  } catch (erro) {
    next(erro);
  }
}

export async function atualizarDataNascimento(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.usuario) {
      throw new AppError(401, "NAO_AUTENTICADO", "Usuário não autenticado.");
    }

    const usuario = await servicoAutenticacao.atualizarDataNascimentoUsuario(
      req.usuario.id,
      req.body
    );

    res.status(200).json({
      mensagem: "Data de nascimento atualizada com sucesso.",
      usuario,
    });
  } catch (erro) {
    next(erro);
  }
}

export async function solicitarAlteracaoEmail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.usuario) {
      throw new AppError(401, "NAO_AUTENTICADO", "Usuário não autenticado.");
    }

    const resultado = await servicoAutenticacao.solicitarAlteracaoEmail({
      idUsuario: req.usuario.id,
      dados: req.body,
    });

    res.status(202).json(resultado);
  } catch (erro) {
    next(erro);
  }
}

export async function confirmarEmailAtual(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.usuario) {
      throw new AppError(401, "NAO_AUTENTICADO", "Usuário não autenticado.");
    }

    const resultado = await servicoAutenticacao.confirmarEmailAtual({
      idUsuario: req.usuario.id,
      ...req.body,
    });

    res.status(200).json(resultado);
  } catch (erro) {
    next(erro);
  }
}

export async function confirmarNovoEmail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.usuario) {
      throw new AppError(401, "NAO_AUTENTICADO", "Usuário não autenticado.");
    }

    const resultado = await servicoAutenticacao.confirmarNovoEmail({
      idUsuario: req.usuario.id,
      ...req.body,
    });

    res.status(200).json(resultado);
  } catch (erro) {
    next(erro);
  }
}

export async function logout(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 1. Validação cruzada do cabeçalho Authorization se fornecido
    let idUsuarioAutenticado: string | undefined;
    const authHeader = req.headers.authorization;

    if (authHeader) {
      const partes = authHeader.split(" ");
      if (partes.length !== 2 || partes[0] !== "Bearer" || !partes[1]) {
        throw new AppError(401, "TOKEN_INVALIDO", "Token de acesso fornecido é inválido.");
      }
      const token = partes[1].trim();
      const resultadoValidacao = validarTokenParaLogout(token);
      idUsuarioAutenticado = resultadoValidacao.idUsuario;
    }

    // 2. Extração do cookie refreshToken
    const refreshToken = req.cookies?.[NOME_COOKIE_REFRESH];
    let tokenLimpo: string | undefined;

    if (typeof refreshToken === "string" && /^[0-9a-fA-F]{64}$/.test(refreshToken.trim())) {
      tokenLimpo = refreshToken.trim();
    }

    // 3. Executa encerramento da sessão no banco
    await servicoAutenticacao.encerrarSessaoLogout({
      refreshTokenPlano: tokenLimpo,
      idUsuarioAutenticado,
    });

    // 4. Limpa o cookie sempre em caso de logout bem-sucedido ou idempotente
    limparCookieRefresh(res);

    res.status(200).json({
      mensagem: "Logout realizado com sucesso.",
    });
  } catch (erro) {
    next(erro);
  }
}

export async function solicitarRecuperacaoSenha(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const resultado = await servicoAutenticacao.solicitarRecuperacaoSenha(req.body);
    res.status(200).json(resultado);
  } catch (erro) {
    next(erro);
  }
}

export async function redefinirSenha(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const resultado = await servicoAutenticacao.redefinirSenha(req.body);
    res.status(200).json(resultado);
  } catch (erro) {
    next(erro);
  }
}

export async function solicitarExclusaoConta(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.usuario) {
      throw new AppError(401, "NAO_AUTENTICADO", "Usuário não autenticado.");
    }

    const resultado = await solicitarExclusaoContaServico(
      req.usuario.id,
      req.body
    );
    limparCookieRefresh(res);
    res.status(202).json({
      mensagem:
        "A conta está pendente de exclusão. Você pode reativá-la em até 30 dias.",
      exclusaoDefinitivaEm: resultado.exclusaoDefinitivaEm.toISOString(),
    });
  } catch (erro) {
    next(erro);
  }
}

export async function reativarConta(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const resultado = await reativarContaServico(req.body);
    res.status(200).json(resultado);
  } catch (erro) {
    next(erro);
  }
}
