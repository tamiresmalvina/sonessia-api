import { Router } from "express";
import * as controladorAutenticacao from "../controllers/autenticacao.controller.js";
import * as controladorFotoPerfil from "../controllers/foto-perfil.controller.js";
import { validarCorpo } from "../middlewares/validacao.middleware.js";
import { validarOrigemMutacao } from "../middlewares/origem.middleware.js";
import { autenticar } from "../middlewares/autenticacao.middleware.js";
import { receberFotoPerfil } from "../middlewares/foto-perfil.middleware.js";
import {
  limiteCadastro,
  limiteVerificacao,
  limiteReenvio,
  limiteLogin,
  limiteRenovacaoSessao,
  limiteSolicitacaoRecuperacao,
  limiteRedefinicaoSenha,
  limiteSolicitarAlteracaoEmail,
  limiteConfirmarAlteracaoEmail,
  limiteExclusaoConta,
  limiteReativacaoConta,
  limiteUploadFotoPerfil,
  limiteVisualizacaoFotoPerfil,
  limiteRemocaoFotoPerfil,
} from "../middlewares/rate-limit.middleware.js";
import {
  schemaCadastro,
  schemaVerificarEmail,
  schemaReenviarCodigo,
  schemaLogin,
  schemaAtualizarNome,
  schemaAtualizarDataNascimento,
  schemaSolicitarAlteracaoEmail,
  schemaConfirmarAlteracaoEmail,
  schemaSolicitarRecuperacaoSenha,
  schemaRedefinirSenha,
  schemaSolicitarExclusaoConta,
  schemaReativarConta,
} from "../schemas/autenticacao.schema.js";

const rotasAutenticacao = Router();

rotasAutenticacao.post(
  "/reativar-conta",
  limiteReativacaoConta,
  validarOrigemMutacao,
  validarCorpo(schemaReativarConta),
  controladorAutenticacao.reativarConta
);

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

rotasAutenticacao.get(
  "/eu/foto-perfil",
  limiteVisualizacaoFotoPerfil,
  autenticar,
  controladorFotoPerfil.obterFotoPerfil
);

rotasAutenticacao.put(
  "/eu/foto-perfil",
  limiteUploadFotoPerfil,
  validarOrigemMutacao,
  autenticar,
  receberFotoPerfil,
  controladorFotoPerfil.atualizarFotoPerfil
);

rotasAutenticacao.delete(
  "/eu",
  limiteExclusaoConta,
  validarOrigemMutacao,
  autenticar,
  validarCorpo(schemaSolicitarExclusaoConta),
  controladorAutenticacao.solicitarExclusaoConta
);

rotasAutenticacao.delete(
  "/eu/foto-perfil",
  limiteRemocaoFotoPerfil,
  validarOrigemMutacao,
  autenticar,
  controladorFotoPerfil.removerFotoPerfil
);

rotasAutenticacao.patch(
  "/eu",
  validarCorpo(schemaAtualizarNome),
  autenticar,
  controladorAutenticacao.atualizarNome
);

rotasAutenticacao.patch(
  "/eu/data-nascimento",
  autenticar,
  validarCorpo(schemaAtualizarDataNascimento),
  controladorAutenticacao.atualizarDataNascimento
);

rotasAutenticacao.post(
  "/solicitar-alteracao-email",
  limiteSolicitarAlteracaoEmail,
  validarOrigemMutacao,
  validarCorpo(schemaSolicitarAlteracaoEmail),
  autenticar,
  controladorAutenticacao.solicitarAlteracaoEmail
);

rotasAutenticacao.post(
  "/confirmar-email-atual",
  limiteConfirmarAlteracaoEmail,
  validarOrigemMutacao,
  validarCorpo(schemaConfirmarAlteracaoEmail),
  autenticar,
  controladorAutenticacao.confirmarEmailAtual
);

rotasAutenticacao.post(
  "/confirmar-novo-email",
  limiteConfirmarAlteracaoEmail,
  validarOrigemMutacao,
  validarCorpo(schemaConfirmarAlteracaoEmail),
  autenticar,
  controladorAutenticacao.confirmarNovoEmail
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
