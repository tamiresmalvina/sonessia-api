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

  // Verifica unicidade do e-mail
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

  // Criação atômica do usuário (com COMUM e emailVerificado = false) e do registro de código
  const novoUsuario = await prisma.$transaction(async (tx) => {
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

  // Envio do e-mail FORA da transação de banco de dados
  const resultadoEnvio = await enviarEmailVerificacao({
    destinatario: novoUsuario.email,
    nome: novoUsuario.nome,
    codigo: codigoPlano,
  });

  if (!resultadoEnvio.sucesso) {
    // A conta está salva e segura no banco, mas sinalizamos a falha no transporte de e-mail
    throw new AppError(
      502,
      "FALHA_ENVIO_EMAIL",
      "A conta foi criada com sucesso, mas ocorreu uma falha ao enviar o e-mail de confirmação. Solicite o reenvio do código para ativá-la."
    );
  }

  return {
    mensagem: "Cadastro realizado com sucesso. Enviamos um código de verificação para o seu e-mail.",
    usuario: novoUsuario,
  };
}

export async function verificarEmail(dados: EntradaVerificarEmail): Promise<{ mensagem: string }> {
  const emailNormalizado = dados.email.toLowerCase().trim();

  const usuario = await prisma.usuario.findUnique({
    where: { email: emailNormalizado },
  });

  if (!usuario) {
    throw new AppError(400, "CODIGO_INVALIDO", "Código de verificação inválido ou expirado.");
  }

  if (usuario.emailVerificado) {
    throw new AppError(400, "EMAIL_JA_VERIFICADO", "Esta conta já foi verificada anteriormente.");
  }

  // Busca o código ativo mais recente
  const codigoRegistro = await prisma.codigoVerificacaoEmail.findFirst({
    where: {
      idUsuario: usuario.id,
      usado: false,
    },
    orderBy: { criadoEm: "desc" },
  });

  if (!codigoRegistro) {
    throw new AppError(
      400,
      "CODIGO_INVALIDO",
      "Nenhum código ativo encontrado para este usuário. Solicite um novo código."
    );
  }

  // Verifica se o código expirou
  if (codigoRegistro.expiraEm < new Date()) {
    throw new AppError(
      400,
      "CODIGO_EXPIRADO",
      "O código de verificação expirou. Solicite um novo código."
    );
  }

  // Verifica se o limite de tentativas já foi atingido
  if (codigoRegistro.tentativas >= MAX_TENTATIVAS_CODIGO) {
    throw new AppError(
      400,
      "LIMITE_TENTATIVAS_EXCEDIDO",
      "Limite de tentativas excedido. Solicite um novo código."
    );
  }

  // Compara o código informado com o hash armazenado
  const codigoCorreto = compararCodigoHash(dados.codigo, codigoRegistro.codigoHash);

  if (!codigoCorreto) {
    const novasTentativas = codigoRegistro.tentativas + 1;
    const deveInvalidar = novasTentativas >= MAX_TENTATIVAS_CODIGO;

    await prisma.codigoVerificacaoEmail.update({
      where: { id: codigoRegistro.id },
      data: {
        tentativas: { increment: 1 },
        usado: deveInvalidar ? true : false,
      },
    });

    if (deveInvalidar) {
      throw new AppError(
        400,
        "LIMITE_TENTATIVAS_EXCEDIDO",
        "Limite de tentativas excedido para este código. Solicite um novo código."
      );
    }

    throw new AppError(400, "CODIGO_INCORRETO", "Código de verificação incorreto.");
  }

  // Se o código for correto: consome o código atomicamente e ativa a conta em transação
  await prisma.$transaction(async (tx) => {
    // Operação atômica que garante que apenas uma requisição consuma o código
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
      throw new AppError(
        400,
        "CODIGO_INVALIDO",
        "O código de verificação já foi consumido por outra requisição ou expirou."
      );
    }

    await tx.usuario.update({
      where: { id: usuario.id },
      data: {
        emailVerificado: true,
      },
    });
  });

  return {
    mensagem: "E-mail verificado com sucesso. Sua conta agora está ativa.",
  };
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

  // Verifica o intervalo mínimo de 60 segundos entre reenvios
  const ultimoCodigo = await prisma.codigoVerificacaoEmail.findFirst({
    where: { idUsuario: usuario.id },
    orderBy: { criadoEm: "desc" },
  });

  if (ultimoCodigo) {
    const tempoDecorridoMs = Date.now() - ultimoCodigo.criadoEm.getTime();
    if (tempoDecorridoMs < INTERVALO_REENVIO_MS) {
      const segundosRestantes = Math.ceil((INTERVALO_REENVIO_MS - tempoDecorridoMs) / 1000);
      throw new AppError(
        429,
        "INTERVALO_REENVIO",
        `Aguarde ${segundosRestantes} segundos antes de solicitar um novo código de verificação.`
      );
    }
  }

  const codigoNovo = gerarCodigoNumerico();
  const hashNovo = gerarHashCodigo(codigoNovo);
  const dataExpiracao = new Date(Date.now() + DURACAO_CODIGO_MS);

  // Invalida códigos anteriores e cria o novo registro em transação
  await prisma.$transaction(async (tx) => {
    // Re-checa dentro da transação para proteção contra requisições concorrentes
    const codigoRecente = await tx.codigoVerificacaoEmail.findFirst({
      where: { idUsuario: usuario.id },
      orderBy: { criadoEm: "desc" },
    });

    if (codigoRecente && (Date.now() - codigoRecente.criadoEm.getTime()) < INTERVALO_REENVIO_MS) {
      throw new AppError(
        429,
        "INTERVALO_REENVIO",
        "Aguarde 60 segundos antes de solicitar um novo código de verificação."
      );
    }

    await tx.codigoVerificacaoEmail.updateMany({
      where: {
        idUsuario: usuario.id,
        usado: false,
      },
      data: {
        usado: true,
      },
    });

    await tx.codigoVerificacaoEmail.create({
      data: {
        idUsuario: usuario.id,
        codigoHash: hashNovo,
        expiraEm: dataExpiracao,
        tentativas: 0,
        usado: false,
      },
    });
  });

  // Envio do e-mail fora da transação
  const resultadoEnvio = await enviarEmailVerificacao({
    destinatario: usuario.email,
    nome: usuario.nome,
    codigo: codigoNovo,
  });

  if (!resultadoEnvio.sucesso) {
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
