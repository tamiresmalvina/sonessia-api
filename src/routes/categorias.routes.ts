import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { Perfil } from "../../generated/prisma/enums.js";
import {
  atualizarCategoria,
  criarCategoria,
  excluirCategoria,
  listarCategorias,
} from "../controllers/categoria.controller.js";
import { autenticar } from "../middlewares/autenticacao.middleware.js";
import { exigirPerfil } from "../middlewares/autorizacao.middleware.js";
import { validarOrigemMutacao } from "../middlewares/origem.middleware.js";
import { validarCorpo } from "../middlewares/validacao.middleware.js";
import {
  schemaAtualizarCategoria,
  schemaCriarCategoria,
} from "../schemas/categoria.schema.js";

const rotasCategorias = Router();
const protegerAdmin = [autenticar, exigirPerfil(Perfil.ADMIN)];

function exigirAdminParaInativas(req: Request, res: Response, next: NextFunction): void {
  if (req.query.incluirInativas !== "true") {
    next();
    return;
  }

  autenticar(req, res, (erro) => {
    if (erro) {
      next(erro);
      return;
    }
    exigirPerfil(Perfil.ADMIN)(req, res, next);
  });
}

rotasCategorias.get("/", exigirAdminParaInativas, listarCategorias);
rotasCategorias.post(
  "/",
  validarOrigemMutacao,
  ...protegerAdmin,
  validarCorpo(schemaCriarCategoria),
  criarCategoria
);
rotasCategorias.patch(
  "/:id",
  validarOrigemMutacao,
  ...protegerAdmin,
  validarCorpo(schemaAtualizarCategoria),
  atualizarCategoria
);
rotasCategorias.delete("/:id", validarOrigemMutacao, ...protegerAdmin, excluirCategoria);

export { rotasCategorias };
