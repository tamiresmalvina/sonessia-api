import { Router } from "express";
import * as controladorAutenticacao from "../controllers/autenticacao.controller.js";
import { validarCorpo } from "../middlewares/validacao.middleware.js";
import { validarOrigemMutacao } from "../middlewares/origem.middleware.js";
import { autenticar } from "../middlewares/autenticacao.middleware.js";
import {
  limiteCadastro,
  limiteVerificacao,
  limiteReenvio,
  limiteLogin,
  limiteRenovacaoSessao,
  limiteSolicitacaoRecuperacao,
  limiteRedefinicaoSenha,
} from "../middlewares/rate-limit.middleware.js";
import {
  schemaCadastro,
  schemaVerificarEmail,
  schemaReenviarCodigo,
  schemaLogin,
  schemaSolicitarRecuperacaoSenha,
  schemaRedefinirSenha,
} from "../schemas/autenticacao.schema.js";

const rotasAutenticacao = Router();

rotasAutenticacao.post(
  "/cadastro",
  limiteCadastro,
  validarCorpo(schemaCadastro),
  controladorAutenticacao.cadastrar
);

rotasAutenticacao.post(
  "/verificar-email",
  limiteVerificacao,
  validarCorpo(schemaVerificarEmail),
  controladorAutenticacao.verificarEmail
);

rotasAutenticacao.post(
  "/reenviar-codigo",
  limiteReenvio,
  validarCorpo(schemaReenviarCodigo),
  controladorAutenticacao.reenviarCodigo
);

rotasAutenticacao.post(
  "/login",
  limiteLogin,
  validarOrigemMutacao,
  validarCorpo(schemaLogin),
  controladorAutenticacao.login
);

rotasAutenticacao.post(
  "/renovar-sessao",
  limiteRenovacaoSessao,
  validarOrigemMutacao,
  controladorAutenticacao.renovarSessao
);

rotasAutenticacao.get(
  "/eu",
  autenticar,
  controladorAutenticacao.obterUsuarioAtual
);

rotasAutenticacao.post(
  "/logout",
  validarOrigemMutacao,
  controladorAutenticacao.logout
);

rotasAutenticacao.post(
  "/recuperar-senha",
  limiteSolicitacaoRecuperacao,
  validarCorpo(schemaSolicitarRecuperacaoSenha),
  controladorAutenticacao.solicitarRecuperacaoSenha
);

rotasAutenticacao.post(
  "/redefinir-senha",
  limiteRedefinicaoSenha,
  validarCorpo(schemaRedefinirSenha),
  controladorAutenticacao.redefinirSenha
);

export { rotasAutenticacao };
