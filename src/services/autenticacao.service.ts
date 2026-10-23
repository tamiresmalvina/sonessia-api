import { prisma } from "../../lib/prisma.js";
import { AppError } from "../errors/app.error.js";
import { Perfil, StatusSessao } from "../../generated/prisma/enums.js";
import {
  gerarHashSenha,
  verificarSenha,
  HASH_FICTICIO_ARGON2ID,
} from "../utils/senha.util.js";
import { emitirTokenAcesso } from "../utils/jwt.util.js";
import {
  gerarRefreshToken,
  gerarHashToken,
  calcularExpiracaoSessao,
  gerarTokenRecuperacao,
  DURACAO_TOKEN_RECUPERACAO_MS,
} from "../utils/token.util.js";
import {
  gerarCodigoNumerico,
  gerarHashCodigo,
  compararCodigoHash,
  DURACAO_CODIGO_MS,
  INTERVALO_REENVIO_MS,
  MAX_TENTATIVAS_CODIGO,
} from "../utils/codigo.util.js";
import {
  enviarEmailVerificacao,
  enviarEmailRecuperacaoSenha,
} from "../utils/email.util.js";
import type {
  EntradaCadastro,
  EntradaVerificarEmail,
  EntradaReenviarCodigo,
  EntradaLogin,
} from "../schemas/autenticacao.schema.js";

export interface RespostaCadastro {
  mensagem: string;
  usuario: {
    id: string;
    nome: string;
    email: string;
    perfil: string;
    emailVerificado: boolean;
    dataNascimento: Date;
    fotoPerfil: string | null;
  };
}

export async function cadastrarUsuario(dados: EntradaCadastro): Promise<RespostaCadastro> {
  const emailNormalizado = dados.email.toLowerCase().trim();

  // Verifica previamente a unicidade do e-mail
  const usuarioExistente = await prisma.usuario.findUnique({
    where: { email: emailNormalizado },
  });

  if (usuarioExistente) {
    throw new AppError(
      409,
      "CONFLITO_CADASTRO",
      "Já existe uma conta cadastrada com o e-mail informado."
    );
  }

  // Gera o hash seguro da senha com Argon2id
  const senhaHash = await gerarHashSenha(dados.senha);

  // Gera o código de verificação numérico de 6 dígitos e seu hash HMAC-SHA256
  const codigoPlano = gerarCodigoNumerico();
  const hashCodigo = gerarHashCodigo(codigoPlano);
  const dataExpiracaoCodigo = new Date(Date.now() + DURACAO_CODIGO_MS);

  let novoUsuario;
  try {
    // Criação atômica do usuário (com COMUM e emailVerificado = false) e do registro de código
    novoUsuario = await prisma.$transaction(async (tx) => {
      const usuarioCriado = await tx.usuario.create({
        data: {
          nome: dados.nome.trim(),
          email: emailNormalizado,
          senha: senhaHash,
          dataNascimento: dados.dataNascimento,
          fotoPerfil: dados.fotoPerfil ?? null,
          perfil: Perfil.COMUM, // Fixado explicitamente pelo servidor!
          emailVerificado: false,
        },
        select: {
          id: true,
          nome: true,
          email: true,
          perfil: true,
          emailVerificado: true,
          dataNascimento: true,
          fotoPerfil: true,
        },
      });

      await tx.codigoVerificacaoEmail.create({
        data: {
          idUsuario: usuarioCriado.id,
          codigoHash: hashCodigo,
          expiraEm: dataExpiracaoCodigo,
          tentativas: 0,
          usado: false,
        },
      });

      return usuarioCriado;
    });
  } catch (erro: unknown) {
    // Tratamento explícito de concorrência: violação de unicidade (Prisma P2002)
    if (
      typeof erro === "object" &&
      erro !== null &&
      "code" in erro &&
      (erro as { code?: unknown }).code === "P2002"
    ) {
      throw new AppError(
        409,
        "CONFLITO_CADASTRO",
        "Já existe uma conta cadastrada com o e-mail informado."
      );
    }
    throw erro;
  }

  // Envio do e-mail FORA da transação de banco de dados
  const resultadoEnvio = await enviarEmailVerificacao({
    destinatario: novoUsuario.email,
    nome: novoUsuario.nome,
    codigo: codigoPlano,
  });

  if (!resultadoEnvio.sucesso) {
    // Invalida o código cujo envio falhou para não deixar o usuário preso a um código não recebido
    await prisma.codigoVerificacaoEmail.updateMany({
      where: {
        idUsuario: novoUsuario.id,
        usado: false,
      },
      data: {
        usado: true,
      },
    });

    if (resultadoEnvio.status === "INCERTO") {
      throw new AppError(
        502,
        "FALHA_ENVIO_EMAIL",
        "A conta foi criada, mas não foi possível confirmar o envio do e-mail de verificação. Solicite o reenvio do código para ativá-la."
      );
    }

    throw new AppError(
      502,
      "FALHA_ENVIO_EMAIL",
      "A conta foi criada com sucesso, mas ocorreu uma falha ao enviar o e-mail de confirmação. Solicite o reenvio do código para ativá-la."
    );
  }

  return {
    mensagem: "Cadastro realizado com sucesso. Um código de verificação foi encaminhado para o seu e-mail.",
    usuario: novoUsuario,
  };
}

export async function verificarEmail(dados: EntradaVerificarEmail): Promise<{ mensagem: string }> {
  const emailNormalizado = dados.email.toLowerCase().trim();

  // Todo o fluxo de verificação é executado na mesma transação com bloqueio FOR UPDATE
  const resultado = await prisma.$transaction(async (tx) => {
    const usuario = await tx.usuario.findUnique({
      where: { email: emailNormalizado },
    });

    if (!usuario) {
      return { tipo: "USUARIO_NAO_ENCONTRADO" as const };
    }

    if (usuario.emailVerificado) {
      return { tipo: "EMAIL_JA_VERIFICADO" as const };
    }

    // Bloqueia o registro do usuário para serializar todas as tentativas concorrentes
    await tx.$queryRaw`SELECT id FROM "Usuario" WHERE id = ${usuario.id}::uuid FOR UPDATE`;

    // Na mesma transação: busca o código ativo mais recente não consumido
    const codigoRegistro = await tx.codigoVerificacaoEmail.findFirst({
      where: {
        idUsuario: usuario.id,
        usado: false,
      },
      orderBy: { criadoEm: "desc" },
    });

    if (!codigoRegistro) {
      return { tipo: "CODIGO_NAO_ENCONTRADO" as const };
    }

    // Verifica se o código expirou
    if (codigoRegistro.expiraEm < new Date()) {
      return { tipo: "CODIGO_EXPIRADO" as const };
    }

    // Verifica se o limite de tentativas já foi atingido
    if (codigoRegistro.tentativas >= MAX_TENTATIVAS_CODIGO) {
      return { tipo: "LIMITE_EXCEDIDO" as const };
    }

    // Compara o código informado com o hash armazenado
    const codigoCorreto = compararCodigoHash(dados.codigo, codigoRegistro.codigoHash);

    if (!codigoCorreto) {
      const novasTentativas = codigoRegistro.tentativas + 1;
      const deveInvalidar = novasTentativas >= MAX_TENTATIVAS_CODIGO;

      await tx.codigoVerificacaoEmail.update({
        where: { id: codigoRegistro.id },
        data: {
          tentativas: { increment: 1 },
          usado: deveInvalidar ? true : false,
        },
      });

      return {
        tipo: "CODIGO_INCORRETO" as const,
        deveInvalidar,
      };
    }

    // Código correto: consumo condicional e atômico confirmando não utilizado e não expirado
    const consumo = await tx.codigoVerificacaoEmail.updateMany({
      where: {
        id: codigoRegistro.id,
        usado: false,
        tentativas: { lt: MAX_TENTATIVAS_CODIGO },
        expiraEm: { gt: new Date() },
      },
      data: {
        usado: true,
      },
    });

    if (consumo.count === 0) {
      return { tipo: "CODIGO_JA_CONSUMIDO" as const };
    }

    // Alteração de emailVerificado na MESMA transação
    await tx.usuario.update({
      where: { id: usuario.id },
      data: {
        emailVerificado: true,
      },
    });

    return { tipo: "SUCESSO" as const };
  });

  // Tratamento fora da transação com lançamento explícito de AppError
  switch (resultado.tipo) {
    case "USUARIO_NAO_ENCONTRADO":
    case "CODIGO_NAO_ENCONTRADO":
      throw new AppError(400, "CODIGO_INVALIDO", "Código de verificação inválido ou expirado.");
    case "EMAIL_JA_VERIFICADO":
      throw new AppError(400, "EMAIL_JA_VERIFICADO", "Esta conta já foi verificada anteriormente.");
    case "CODIGO_EXPIRADO":
      throw new AppError(400, "CODIGO_EXPIRADO", "O código de verificação expirou. Solicite um novo código.");
    case "LIMITE_EXCEDIDO":
      throw new AppError(400, "LIMITE_TENTATIVAS_EXCEDIDO", "Limite de tentativas excedido. Solicite um novo código.");
    case "CODIGO_INCORRETO":
      if (resultado.deveInvalidar) {
        throw new AppError(
          400,
          "LIMITE_TENTATIVAS_EXCEDIDO",
          "Limite de tentativas excedido para este código. Solicite um novo código."
        );
      }
      throw new AppError(400, "CODIGO_INCORRETO", "Código de verificação incorreto.");
    case "CODIGO_JA_CONSUMIDO":
      throw new AppError(
        400,
        "CODIGO_INVALIDO",
        "O código de verificação já foi consumido por outra requisição ou expirou."
      );
    case "SUCESSO":
      return {
        mensagem: "E-mail verificado com sucesso. Sua conta agora está ativa.",
      };
  }
}

export async function reenviarCodigoVerificacao(
  dados: EntradaReenviarCodigo
): Promise<{ mensagem: string }> {
  const emailNormalizado = dados.email.toLowerCase().trim();

  const usuario = await prisma.usuario.findUnique({
    where: { email: emailNormalizado },
  });

  // Resposta neutra caso a conta não exista, evitando enumeração de usuários
  if (!usuario) {
    return {
      mensagem: "Se a conta informada existir e ainda não estiver verificada, um novo código foi enviado.",
    };
  }

  if (usuario.emailVerificado) {
    throw new AppError(400, "EMAIL_JA_VERIFICADO", "Esta conta já foi verificada anteriormente.");
  }

  const { idCodigo, codigoNovo } = await prisma.$transaction(async (tx) => {
    // 1. Bloqueio no registro do usuário para serializar reenvios concorrentes
    await tx.$queryRaw`SELECT id FROM "Usuario" WHERE id = ${usuario.id}::uuid FOR UPDATE`;

    // Confere novamente o estado atual de emailVerificado sob o bloqueio
    const usuarioAtual = await tx.usuario.findUnique({
      where: { id: usuario.id },
      select: { emailVerificado: true },
    });

    if (usuarioAtual?.emailVerificado) {
      throw new AppError(400, "EMAIL_JA_VERIFICADO", "Esta conta já foi verificada anteriormente.");
    }

    // 2. Verifica se já existe código ativo recente dentro do intervalo de 60 segundos
    const codigoRecente = await tx.codigoVerificacaoEmail.findFirst({
      where: {
        idUsuario: usuario.id,
        usado: false,
      },
      orderBy: { criadoEm: "desc" },
    });

    if (codigoRecente) {
      const tempoDecorridoMs = Date.now() - codigoRecente.criadoEm.getTime();
      if (tempoDecorridoMs < INTERVALO_REENVIO_MS) {
        const segundosRestantes = Math.ceil((INTERVALO_REENVIO_MS - tempoDecorridoMs) / 1000);
        throw new AppError(
          429,
          "INTERVALO_REENVIO",
          `Aguarde ${segundosRestantes} segundos antes de solicitar um novo código de verificação.`
        );
      }
    }

    // 3. Invalida todos os códigos anteriores para garantir que apenas um código válido exista por usuário
    await tx.codigoVerificacaoEmail.updateMany({
      where: {
        idUsuario: usuario.id,
        usado: false,
      },
      data: {
        usado: true,
      },
    });

    const codigo = gerarCodigoNumerico();
    const hash = gerarHashCodigo(codigo);
    const expiracao = new Date(Date.now() + DURACAO_CODIGO_MS);

    // 4. Cria o novo registro ativo
    const novoCodigoRegistro = await tx.codigoVerificacaoEmail.create({
      data: {
        idUsuario: usuario.id,
        codigoHash: hash,
        expiraEm: expiracao,
        tentativas: 0,
        usado: false,
      },
    });

    return {
      idCodigo: novoCodigoRegistro.id,
      codigoNovo: codigo,
    };
  });

  // 5. Envio do e-mail fora da transação
  const resultadoEnvio = await enviarEmailVerificacao({
    destinatario: usuario.email,
    nome: usuario.nome,
    codigo: codigoNovo,
  });

  if (!resultadoEnvio.sucesso) {
    // Invalida o código cujo envio falhou para não prender o usuário
    await prisma.codigoVerificacaoEmail.updateMany({
      where: {
        id: idCodigo,
        usado: false,
      },
      data: {
        usado: true,
      },
    });

    if (resultadoEnvio.status === "INCERTO") {
      throw new AppError(
        502,
        "FALHA_ENVIO_EMAIL",
        "Não foi possível confirmar a entrega do novo código por e-mail. Se não o receber em instantes, solicite o reenvio."
      );
    }

    throw new AppError(
      502,
      "FALHA_ENVIO_EMAIL",
      "O novo código foi gerado, mas ocorreu uma falha ao enviá-lo por e-mail. Tente novamente mais tarde."
    );
  }

  return {
    mensagem: "Código de verificação reenviado com sucesso para o seu e-mail.",
  };
}

export interface RespostaAutenticar {
  tokenAcesso: string;
  refreshToken: string;
  usuario: {
    id: string;
    nome: string;
    email: string;
    perfil: string;
  };
  idSessao: string;
}

export async function autenticarUsuario(dados: EntradaLogin): Promise<RespostaAutenticar> {
  const emailNormalizado = dados.email.toLowerCase().trim();

  const usuario = await prisma.usuario.findUnique({
    where: { email: emailNormalizado },
  });

  // Mitigação de timing attack: executa verificação contra hash fictício quando o e-mail não existe
  if (!usuario) {
    await verificarSenha(HASH_FICTICIO_ARGON2ID, dados.senha);
    throw new AppError(401, "CREDENCIAIS_INVALIDAS", "E-mail ou senha incorretos.");
  }

  // Verifica a senha do usuário existente
  const senhaCorreta = await verificarSenha(usuario.senha, dados.senha);
  if (!senhaCorreta) {
    throw new AppError(401, "CREDENCIAIS_INVALIDAS", "E-mail ou senha incorretos.");
  }

  // Bloqueio obrigatório para contas com e-mail não verificado
  if (!usuario.emailVerificado) {
    throw new AppError(
      403,
      "EMAIL_NAO_VERIFICADO",
      "É necessário confirmar seu e-mail antes de realizar o login."
    );
  }

  // Emissão do token JWT de acesso incluindo versaoToken vigente
  const tokenAcesso = emitirTokenAcesso({
    sub: usuario.id,
    versaoToken: usuario.versaoToken,
  });

  // Geração criptográfica do refresh token e cálculo de hash SHA-256 e expiração
  const refreshToken = gerarRefreshToken();
  const tokenHash = gerarHashToken(refreshToken);
  const expiraEm = calcularExpiracaoSessao();

  // Criação atômica e persistência prévia da sessão ativa antes da entrega da resposta
  const sessao = await prisma.sessao.create({
    data: {
      idUsuario: usuario.id,
      tokenHash,
      status: StatusSessao.ATIVA,
      expiraEm,
    },
  });

  return {
    tokenAcesso,
    refreshToken,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
    },
    idSessao: sessao.id,
  };
}

export async function limparSessaoFalha(idSessao: string): Promise<void> {
  try {
    await prisma.sessao.delete({
      where: { id: idSessao },
    });
  } catch (erro) {
    console.error(`[LIMPEZA_SESSAO_FALHA]: Não foi possível excluir sessão órfã ${idSessao}.`, erro);
  }
}

export interface RespostaRenovarSessao {
  tokenAcesso: string;
  novoRefreshToken: string;
  usuario: {
    id: string;
    nome: string;
    email: string;
    perfil: string;
  };
  idSessao: string;
}

export async function renovarSessao(refreshTokenPlano: string): Promise<RespostaRenovarSessao> {
  const tokenHash = gerarHashToken(refreshTokenPlano);

  // Todo o ciclo de validação, bloqueio pessimista, detecção de reutilização e rotação ocorre na transação
  const resultado = await prisma.$transaction(async (tx) => {
    // 1. Busca a sessão correspondente pelo hash do token
    const sessao = await tx.sessao.findUnique({
      where: { tokenHash },
      include: { usuario: true },
    });

    if (!sessao) {
      return { tipo: "SESSAO_NAO_ENCONTRADA" as const };
    }

    // 2. Bloqueio pessimista para serializar requisições concorrentes sobre a mesma sessão
    await tx.$queryRaw`SELECT id FROM "Sessao" WHERE id = ${sessao.id}::uuid FOR UPDATE`;

    // Reconsulta a sessão sob o bloqueio para garantir o estado mais recente
    const sessaoAtual = await tx.sessao.findUnique({
      where: { id: sessao.id },
      include: { usuario: true },
    });

    if (!sessaoAtual) {
      return { tipo: "SESSAO_NAO_ENCONTRADA" as const };
    }

    // 3. Detecção de reutilização: se o token já foi rotacionado ou revogado, revoga todas as sessões ativas do usuário
    if (
      sessaoAtual.status === StatusSessao.ROTACIONADA ||
      sessaoAtual.status === StatusSessao.REVOGADA
    ) {
      await tx.sessao.updateMany({
        where: {
          idUsuario: sessaoAtual.idUsuario,
          status: StatusSessao.ATIVA,
        },
        data: {
          status: StatusSessao.REVOGADA,
        },
      });
      return { tipo: "REUTILIZACAO_DETECTADA" as const };
    }

    // 4. Sessão voluntariamente encerrada
    if (sessaoAtual.status === StatusSessao.ENCERRADA) {
      return { tipo: "SESSAO_ENCERRADA" as const };
    }

    // 5. Sessão expirada: marca como ENCERRADA e confirma
    if (sessaoAtual.expiraEm < new Date()) {
      await tx.sessao.update({
        where: { id: sessaoAtual.id },
        data: { status: StatusSessao.ENCERRADA },
      });
      return { tipo: "SESSAO_EXPIRADA" as const };
    }

    // 6. Elegibilidade do usuário
    if (!sessaoAtual.usuario.emailVerificado) {
      return { tipo: "EMAIL_NAO_VERIFICADO" as const };
    }

    // 7. Rotação do refresh token: gera novo token aleatório, hash SHA-256 e nova expiração
    const novoRefreshToken = gerarRefreshToken();
    const novoTokenHash = gerarHashToken(novoRefreshToken);
    const novaExpiracao = calcularExpiracaoSessao();

    // Criação da nova sessão ativa
    const novaSessao = await tx.sessao.create({
      data: {
        idUsuario: sessaoAtual.idUsuario,
        tokenHash: novoTokenHash,
        status: StatusSessao.ATIVA,
        expiraEm: novaExpiracao,
      },
    });

    // Invalidação da sessão anterior, vinculando o id da sessão substituta
    await tx.sessao.update({
      where: { id: sessaoAtual.id },
      data: {
        status: StatusSessao.ROTACIONADA,
        substituidaPor: novaSessao.id,
      },
    });

    // Emissão do novo token de acesso JWT com versaoToken vigente
    const tokenAcesso = emitirTokenAcesso({
      sub: sessaoAtual.usuario.id,
      versaoToken: sessaoAtual.usuario.versaoToken,
    });

    return {
      tipo: "SUCESSO" as const,
      tokenAcesso,
      novoRefreshToken,
      usuario: {
        id: sessaoAtual.usuario.id,
        nome: sessaoAtual.usuario.nome,
        email: sessaoAtual.usuario.email,
        perfil: sessaoAtual.usuario.perfil,
      },
      idSessao: novaSessao.id,
    };
  });

  // Tratamento fora da transação: a transação foi confirmada (commit) no banco antes do lançamento do erro
  switch (resultado.tipo) {
    case "REUTILIZACAO_DETECTADA":
      throw new AppError(
        401,
        "REUTILIZACAO_DETECTADA",
        "Tentativa de reutilização de sessão detectada. Todas as sessões ativas foram encerradas por segurança."
      );
    case "SESSAO_EXPIRADA":
      throw new AppError(401, "SESSAO_EXPIRADA", "Sessão expirada. Faça login novamente.");
    case "SESSAO_ENCERRADA":
    case "SESSAO_NAO_ENCONTRADA":
      throw new AppError(401, "SESSAO_INVALIDA", "Sessão inválida ou não encontrada.");
    case "EMAIL_NAO_VERIFICADO":
      throw new AppError(
        403,
        "EMAIL_NAO_VERIFICADO",
        "É necessário confirmar seu e-mail antes de renovar a sessão."
      );
    case "SUCESSO":
      return {
        tokenAcesso: resultado.tokenAcesso,
        novoRefreshToken: resultado.novoRefreshToken,
        usuario: resultado.usuario,
        idSessao: resultado.idSessao,
      };
  }
}

export interface ParametrosLogout {
  refreshTokenPlano?: string | undefined;
  idUsuarioAutenticado?: string | undefined;
}

export async function encerrarSessaoLogout(
  parametros: ParametrosLogout
): Promise<{ encerrou: boolean }> {
  // Se o cookie de refresh token não foi fornecido, o logout é idempotente e nada há a encerrar no banco
  if (!parametros.refreshTokenPlano) {
    return { encerrou: false };
  }

  const tokenHash = gerarHashToken(parametros.refreshTokenPlano);

  // Busca a sessão correspondente no banco de dados
  const sessao = await prisma.sessao.findUnique({
    where: { tokenHash },
  });

  // Se a sessão não existir ou já estiver encerrada/revogada, idempotência
  if (!sessao || sessao.status !== StatusSessao.ATIVA) {
    return { encerrou: false };
  }

  // Validação cruzada: se houver id de usuário autenticado validado, garante que a sessão pertence ao mesmo usuário
  if (
    parametros.idUsuarioAutenticado &&
    sessao.idUsuario !== parametros.idUsuarioAutenticado
  ) {
    throw new AppError(
      403,
      "OPERACAO_NAO_PERMITIDA",
      "A sessão informada não pertence ao usuário autenticado."
    );
  }

  // Encerra estritamente a sessão correspondente ao refresh token
  await prisma.sessao.update({
    where: { id: sessao.id },
    data: {
      status: StatusSessao.ENCERRADA,
    },
  });

  return { encerrou: true };
}

export interface ParametrosSolicitarRecuperacao {
  email: string;
}

export async function solicitarRecuperacaoSenha(
  parametros: ParametrosSolicitarRecuperacao
): Promise<{ mensagem: string }> {
  const emailNormalizado = parametros.email.trim().toLowerCase();

  // 1. Busca o usuário pelo e-mail normalizado
  const usuario = await prisma.usuario.findUnique({
    where: { email: emailNormalizado },
  });

  // Anti-timing e mitigação de enumeração:
  // Se o usuário não existir ou não estiver verificado, executa operação para balancear o tempo
  if (!usuario || !usuario.emailVerificado) {
    await verificarSenha(HASH_FICTICIO_ARGON2ID, "SenhaTemporariaFicticia@123");
    return {
      mensagem:
        "Se o e-mail informado estiver cadastrado e verificado, as instruções para redefinição de senha foram enviadas.",
    };
  }

  // 2. Transação com bloqueio pessimista na linha do Usuario para serializar solicitações da mesma conta
  const resultadoTransacao = await prisma.$transaction(async (tx) => {
    // Lock pessimista na linha do Usuario (ordem invariável 1)
    await tx.$queryRaw`SELECT id FROM "Usuario" WHERE id = ${usuario.id}::uuid FOR UPDATE`;

    // Consulta o último token gerado para verificar cooldown de 60s
    const ultimoToken = await tx.tokenRecuperacaoSenha.findFirst({
      where: { idUsuario: usuario.id },
      orderBy: { criadoEm: "desc" },
    });

    if (
      ultimoToken &&
      Date.now() - ultimoToken.criadoEm.getTime() < 60_000
    ) {
      // Cooldown ativo: comita sem criar nada e sem disparar e-mail
      return { cooldown: true, tokenPlano: null, idToken: null };
    }

    // Invalida tokens anteriores não usados
    await tx.tokenRecuperacaoSenha.updateMany({
      where: {
        idUsuario: usuario.id,
        usado: false,
      },
      data: {
        usado: true,
      },
    });

    // Gera o token de 32 bytes e seu hash SHA-256
    const tokenPlano = gerarTokenRecuperacao();
    const tokenHash = gerarHashToken(tokenPlano);
    const expiraEm = new Date(Date.now() + DURACAO_TOKEN_RECUPERACAO_MS);

    const novoToken = await tx.tokenRecuperacaoSenha.create({
      data: {
        idUsuario: usuario.id,
        tokenHash,
        expiraEm,
        usado: false,
      },
    });

    return {
      cooldown: false,
      tokenPlano,
      idToken: novoToken.id,
    };
  });

  // Se o cooldown estava ativo, retorna a mensagem neutra sem disparar e-mail
  if (resultadoTransacao.cooldown || !resultadoTransacao.tokenPlano || !resultadoTransacao.idToken) {
    return {
      mensagem:
        "Se o e-mail informado estiver cadastrado e verificado, as instruções para redefinição de senha foram enviadas.",
    };
  }

  // 3. Dispara o e-mail de recuperação fora do lock do banco
  const resultadoEnvio = await enviarEmailRecuperacaoSenha({
    destinatario: usuario.email,
    nome: usuario.nome,
    token: resultadoTransacao.tokenPlano,
  });

  // Se houver falha confirmada no envio, invalida o token recém-criado (apenas se ainda não tiver sido consumido)
  if (!resultadoEnvio.sucesso && resultadoEnvio.status === "FALHA_ENVIO") {
    try {
      await prisma.tokenRecuperacaoSenha.updateMany({
        where: {
          id: resultadoTransacao.idToken,
          usado: false,
        },
        data: { usado: true },
      });
    } catch (erroLimpeza) {
      console.error(
        "[LIMPEZA_TOKEN_RECUPERACAO_FALHA]: Não foi possível invalidar token após falha de envio.",
        erroLimpeza
      );
    }
  }

  return {
    mensagem:
      "Se o e-mail informado estiver cadastrado e verificado, as instruções para redefinição de senha foram enviadas.",
  };
}

export interface ParametrosRedefinirSenha {
  token: string;
  novaSenha: string;
}

export async function redefinirSenha(
  parametros: ParametrosRedefinirSenha
): Promise<{ mensagem: string }> {
  const tokenHash = gerarHashToken(parametros.token);

  // Computa o hash Argon2id da nova senha antes da transação (para minimizar a retenção de locks no banco)
  const novoHashSenha = await gerarHashSenha(parametros.novaSenha);

  await prisma.$transaction(async (tx) => {
    // 1. Localiza inicialmente o token pelo hash SHA-256 para obter o idUsuario
    const tokenRegistro = await tx.tokenRecuperacaoSenha.findUnique({
      where: { tokenHash },
      select: { id: true, idUsuario: true },
    });

    if (!tokenRegistro) {
      throw new AppError(400, "TOKEN_INVALIDO", "Token de recuperação inválido ou expirado.");
    }

    // 2. Ordem de bloqueio rigorosa: Usuario PRIMEIRO, depois TokenRecuperacaoSenha
    await tx.$queryRaw`SELECT id FROM "Usuario" WHERE id = ${tokenRegistro.idUsuario}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "TokenRecuperacaoSenha" WHERE id = ${tokenRegistro.id}::uuid FOR UPDATE`;

    // 3. Revalida o token sob bloqueio
    const tokenAtual = await tx.tokenRecuperacaoSenha.findUnique({
      where: { id: tokenRegistro.id },
    });

    if (!tokenAtual || tokenAtual.usado) {
      throw new AppError(400, "TOKEN_INVALIDO", "Token de recuperação inválido ou expirado.");
    }

    if (tokenAtual.expiraEm < new Date()) {
      throw new AppError(400, "TOKEN_EXPIRADO", "Token de recuperação expirado. Solicite uma nova recuperação.");
    }

    // 4. Marca o token como consumido
    await tx.tokenRecuperacaoSenha.update({
      where: { id: tokenAtual.id },
      data: { usado: true },
    });

    // 5. Atualiza a senha, incrementa versaoToken e atualiza senhaAlteradaEm
    await tx.usuario.update({
      where: { id: tokenRegistro.idUsuario },
      data: {
        senha: novoHashSenha,
        versaoToken: { increment: 1 },
        senhaAlteradaEm: new Date(),
      },
    });

    // 6. Revoga todas as sessões ativas do usuário
    await tx.sessao.updateMany({
      where: {
        idUsuario: tokenRegistro.idUsuario,
        status: StatusSessao.ATIVA,
      },
      data: {
        status: StatusSessao.REVOGADA,
      },
    });
  });

  return {
    mensagem: "Senha redefinida com sucesso. Faça login com a nova senha.",
  };
}


