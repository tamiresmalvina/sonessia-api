import rateLimit from "express-rate-limit";
import { ambiente } from "../config/ambiente.js";

const respostaPadraoRateLimit = {
  erro: {
    codigo: "MUITAS_REQUISICOES",
    mensagem: "Muitas tentativas. Tente novamente mais tarde.",
    detalhes: [],
  },
};

export const limiteCadastro = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => ambiente.NODE_ENV === "test",
  handler: (_req, res) => {
    res.status(429).json(respostaPadraoRateLimit);
  },
});

export const limiteVerificacao = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => ambiente.NODE_ENV === "test",
  handler: (_req, res) => {
    res.status(429).json(respostaPadraoRateLimit);
  },
});

export const limiteReenvio = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => ambiente.NODE_ENV === "test",
  handler: (_req, res) => {
    res.status(429).json(respostaPadraoRateLimit);
  },
});

export const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => ambiente.NODE_ENV === "test",
  handler: (_req, res) => {
    res.status(429).json(respostaPadraoRateLimit);
  },
});

export const limiteRenovacaoSessao = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => ambiente.NODE_ENV === "test",
  handler: (_req, res) => {
    res.status(429).json(respostaPadraoRateLimit);
  },
});

export const limiteSolicitacaoRecuperacao = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => ambiente.NODE_ENV === "test",
  handler: (_req, res) => {
    res.status(429).json(respostaPadraoRateLimit);
  },
});

export const limiteRedefinicaoSenha = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => ambiente.NODE_ENV === "test",
  handler: (_req, res) => {
    res.status(429).json(respostaPadraoRateLimit);
  },
});

