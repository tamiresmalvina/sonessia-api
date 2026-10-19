import { Router } from "express";
import * as controladorAutenticacao from "../controllers/autenticacao.controller.js";
import { validarCorpo } from "../middlewares/validacao.middleware.js";
import {
  limiteCadastro,
  limiteVerificacao,
  limiteReenvio,
} from "../middlewares/rate-limit.middleware.js";
import {
  schemaCadastro,
  schemaVerificarEmail,
  schemaReenviarCodigo,
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

export { rotasAutenticacao };
