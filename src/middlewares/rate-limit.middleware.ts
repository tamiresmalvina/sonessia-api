import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { ambiente } from "../config/ambiente.js";
import { obterIpCliente } from "../utils/ip-cliente.util.js";

const respostaPadraoRateLimit = {
  erro: {
    codigo: "MUITAS_REQUISICOES",
    mensagem: "Muitas tentativas. Tente novamente mais tarde.",
    detalhes: [],
  },
};

const JANELA_RATE_LIMIT_MS = 15 * 60 * 1000;

export function chaveRateLimitPorIp(req: Parameters<typeof obterIpCliente>[0]): string {
  const ip = obterIpCliente(req);
  return ip === "unknown" ? ip : ipKeyGenerator(ip);
}

function criarLimitador(limite: number) {
  return rateLimit({
    windowMs: JANELA_RATE_LIMIT_MS,
    limit: limite,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: chaveRateLimitPorIp,
    skip: () => ambiente.NODE_ENV === "test",
    handler: (_req, res) => {
      res.status(429).json(respostaPadraoRateLimit);
    },
  });
}

export const limiteCadastro = criarLimitador(10);
export const limiteVerificacao = criarLimitador(15);
export const limiteReenvio = criarLimitador(5);
export const limiteSolicitarAlteracaoEmail = criarLimitador(5);
export const limiteConfirmarAlteracaoEmail = criarLimitador(10);
export const limiteReenviarCodigoAlteracaoEmail = criarLimitador(6);
export const limiteCancelarAlteracaoEmail = criarLimitador(5);
export const limiteExclusaoConta = criarLimitador(5);
export const limiteReativacaoConta = criarLimitador(5);
export const limiteLogin = criarLimitador(10);
export const limiteLogout = criarLimitador(30);
export const limiteRenovacaoSessao = criarLimitador(30);
export const limiteOperacaoAutenticada = criarLimitador(300);
export const limiteSolicitacaoRecuperacao = criarLimitador(5);
export const limiteRedefinicaoSenha = criarLimitador(10);
export const limiteAlteracaoSenha = criarLimitador(5);
export const limiteUploadFotoPerfil = criarLimitador(10);
export const limiteVisualizacaoFotoPerfil = criarLimitador(60);
export const limiteRemocaoFotoPerfil = criarLimitador(10);

// Limite geral para mutações administrativas e limite mais restrito para uploads
// que podem gerar custos externos de armazenamento/processamento.
export const limiteOperacaoAdministrativa = criarLimitador(60);
export const limiteUploadConteudo = criarLimitador(10);
