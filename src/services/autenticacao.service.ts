import { prisma } from "../../lib/prisma.js";
import { AppError } from "../errors/app.error.js";
import { Perfil } from "../../generated/prisma/enums.js";
import { gerarHashSenha } from "../utils/senha.util.js";
import {
  gerarCodigoNumerico,
  gerarHashCodigo,
  compararCodigoHash,
  DURACAO_CODIGO_MS,
  INTERVALO_REENVIO_MS,
  MAX_TENTATIVAS_CODIGO,
} from "../utils/codigo.util.js";
import { enviarEmailVerificacao } from "../utils/email.util.js";
import type {
  EntradaCadastro,
  EntradaVerificarEmail,
  EntradaReenviarCodigo,
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
