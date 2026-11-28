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
  reordenarAmbientesColecao,
} from "../controllers/colecao.controller.js";
import { autenticar } from "../middlewares/autenticacao.middleware.js";
import { limiteOperacaoAutenticada } from "../middlewares/rate-limit.middleware.js";
import { exigirPerfil } from "../middlewares/autorizacao.middleware.js";
import { validarOrigemMutacao } from "../middlewares/origem.middleware.js";
import { validarCorpo } from "../middlewares/validacao.middleware.js";
import {
  schemaAdicionarAmbienteColecao,
  schemaAtualizarColecao,
  schemaCriarColecao,
  schemaReordenarAmbientesColecao,
} from "../schemas/colecao.schema.js";

const rotasColecoes = Router();
const protegerComum = [autenticar, exigirPerfil(Perfil.COMUM)];

rotasColecoes.post(
  "/",
  limiteOperacaoAutenticada,
  validarOrigemMutacao,
  ...protegerComum,
  validarCorpo(schemaCriarColecao),
  criarColecao
);

rotasColecoes.get("/", ...protegerComum, listarColecoes);

rotasColecoes.get("/:idColecao", ...protegerComum, obterColecao);

rotasColecoes.patch(
  "/:idColecao",
  limiteOperacaoAutenticada,
  validarOrigemMutacao,
  ...protegerComum,
  validarCorpo(schemaAtualizarColecao),
  atualizarColecao
);

rotasColecoes.put(
  "/:idColecao",
  limiteOperacaoAutenticada,
  validarOrigemMutacao,
  ...protegerComum,
  validarCorpo(schemaAtualizarColecao),
  atualizarColecao
);

rotasColecoes.delete(
  "/:idColecao",
  limiteOperacaoAutenticada,
  validarOrigemMutacao,
  ...protegerComum,
  excluirColecao
);

rotasColecoes.post(
  "/:idColecao/ambientes",
  limiteOperacaoAutenticada,
  validarOrigemMutacao,
  ...protegerComum,
  validarCorpo(schemaAdicionarAmbienteColecao),
  adicionarAmbienteColecao
);

rotasColecoes.put(
  "/:idColecao/ambientes/ordem",
  limiteOperacaoAutenticada,
  validarOrigemMutacao,
  ...protegerComum,
  validarCorpo(schemaReordenarAmbientesColecao),
  reordenarAmbientesColecao
);

rotasColecoes.delete(
  "/:idColecao/ambientes/:idAmbienteSonoro",
  limiteOperacaoAutenticada,
  validarOrigemMutacao,
  ...protegerComum,
  removerAmbienteColecao
);

export { rotasColecoes };

