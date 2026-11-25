import { Router } from "express";
import { registrarReproducao, listarReproducoesRecentes } from "../controllers/historico-reproducao.controller.js";
import { autenticar } from "../middlewares/autenticacao.middleware.js";
import { validarOrigemMutacao } from "../middlewares/origem.middleware.js";
import { validarCorpo } from "../middlewares/validacao.middleware.js";
import { schemaRegistrarReproducao } from "../schemas/historico-reproducao.schema.js";

const rotasHistoricoReproducao = Router();

rotasHistoricoReproducao.post(
  "/",
  validarOrigemMutacao,
  autenticar,
  validarCorpo(schemaRegistrarReproducao),
  registrarReproducao,
);

rotasHistoricoReproducao.get("/recentes", autenticar, listarReproducoesRecentes);

export { rotasHistoricoReproducao };
