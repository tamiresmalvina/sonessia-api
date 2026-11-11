import { Router } from "express";
import { Perfil } from "../../generated/prisma/enums.js";
import {
  adicionarAmbienteColecao,
  atualizarColecao,
  criarColecao,
  excluirColecao,
  listarColecoes,
  obterColecao,
  removerAmbienteColecao,
} from "../controllers/colecao.controller.js";
import { autenticar } from "../middlewares/autenticacao.middleware.js";
import { exigirPerfil } from "../middlewares/autorizacao.middleware.js";
import { validarOrigemMutacao } from "../middlewares/origem.middleware.js";
import { validarCorpo } from "../middlewares/validacao.middleware.js";
import {
  schemaAdicionarAmbienteColecao,
  schemaAtualizarColecao,
  schemaCriarColecao,
} from "../schemas/colecao.schema.js";

const rotasColecoes = Router();
const protegerComum = [autenticar, exigirPerfil(Perfil.COMUM)];

rotasColecoes.post(
  "/",
  validarOrigemMutacao,
  ...protegerComum,
  validarCorpo(schemaCriarColecao),
  criarColecao
);

rotasColecoes.get("/", ...protegerComum, listarColecoes);

rotasColecoes.get("/:idColecao", ...protegerComum, obterColecao);

rotasColecoes.patch(
  "/:idColecao",
  validarOrigemMutacao,
  ...protegerComum,
  validarCorpo(schemaAtualizarColecao),
  atualizarColecao
);

rotasColecoes.put(
  "/:idColecao",
  validarOrigemMutacao,
  ...protegerComum,
  validarCorpo(schemaAtualizarColecao),
  atualizarColecao
);

rotasColecoes.delete(
  "/:idColecao",
  validarOrigemMutacao,
  ...protegerComum,
  excluirColecao
);

rotasColecoes.post(
  "/:idColecao/ambientes",
  validarOrigemMutacao,
  ...protegerComum,
  validarCorpo(schemaAdicionarAmbienteColecao),
  adicionarAmbienteColecao
);

rotasColecoes.delete(
  "/:idColecao/ambientes/:idAmbienteSonoro",
  validarOrigemMutacao,
  ...protegerComum,
  removerAmbienteColecao
);

export { rotasColecoes };

