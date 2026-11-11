import { Router } from "express";
import { Perfil } from "../../generated/prisma/enums.js";
import {
  alterarPublicacaoAmbientePreConfigurado,
  atualizarAmbientePreConfigurado,
  atualizarAmbienteSonoro,
  criarAmbientePreConfigurado,
  criarAmbienteSonoro,
  excluirAmbientePreConfigurado,
  excluirAmbienteSonoro,
  listarAmbientesPreConfigurados,
  listarAmbientesPublicos,
  listarAmbientesSonoros,
  listarFinalidadesDisponiveis,
  obterAmbientePreConfigurado,
  obterAmbientePublico,
  obterAmbienteSonoro,
} from "../controllers/ambiente-sonoro.controller.js";
import { autenticar } from "../middlewares/autenticacao.middleware.js";
import { exigirPerfil } from "../middlewares/autorizacao.middleware.js";
import { validarOrigemMutacao } from "../middlewares/origem.middleware.js";
import { validarCorpo } from "../middlewares/validacao.middleware.js";
import {
  schemaAtualizarAmbientePreConfigurado,
  schemaAtualizarAmbienteSonoro,
  schemaCriarAmbientePreConfigurado,
  schemaCriarAmbienteSonoro,
  schemaPublicacaoAmbiente,
} from "../schemas/ambiente-sonoro.schema.js";

const rotasAmbientesSonoros = Router();
const protegerAdmin = [autenticar, exigirPerfil(Perfil.ADMIN)];

/* ========================================================================= */
/* ROTAS PÚBLICAS (US08 / US14 - Sem autenticação obrigatória)               */
/* ========================================================================= */

rotasAmbientesSonoros.get("/publicos/finalidades", listarFinalidadesDisponiveis);
rotasAmbientesSonoros.get("/finalidades", listarFinalidadesDisponiveis);
rotasAmbientesSonoros.get("/publicos", listarAmbientesPublicos);
rotasAmbientesSonoros.get("/publicos/:idAmbienteSonoro", obterAmbientePublico);

/* ========================================================================= */
/* ROTAS ADMINISTRATIVAS - PRÉ-CONFIGURADOS (US02 - Restritas a ADMIN)       */
/* ========================================================================= */

rotasAmbientesSonoros.post(
  "/pre-configurados",
  validarOrigemMutacao,
  ...protegerAdmin,
  validarCorpo(schemaCriarAmbientePreConfigurado),
  criarAmbientePreConfigurado
);

rotasAmbientesSonoros.get(
  "/pre-configurados",
  ...protegerAdmin,
  listarAmbientesPreConfigurados
);

rotasAmbientesSonoros.get(
  "/pre-configurados/:idAmbienteSonoro",
  ...protegerAdmin,
  obterAmbientePreConfigurado
);

rotasAmbientesSonoros.patch(
  "/pre-configurados/:idAmbienteSonoro",
  validarOrigemMutacao,
  ...protegerAdmin,
  validarCorpo(schemaAtualizarAmbientePreConfigurado),
  atualizarAmbientePreConfigurado
);

rotasAmbientesSonoros.put(
  "/pre-configurados/:idAmbienteSonoro",
  validarOrigemMutacao,
  ...protegerAdmin,
  validarCorpo(schemaAtualizarAmbientePreConfigurado),
  atualizarAmbientePreConfigurado
);

rotasAmbientesSonoros.patch(
  "/pre-configurados/:idAmbienteSonoro/publicacao",
  validarOrigemMutacao,
  ...protegerAdmin,
  validarCorpo(schemaPublicacaoAmbiente),
  alterarPublicacaoAmbientePreConfigurado
);

rotasAmbientesSonoros.delete(
  "/pre-configurados/:idAmbienteSonoro",
  validarOrigemMutacao,
  ...protegerAdmin,
  excluirAmbientePreConfigurado
);

/* ========================================================================= */
/* ROTAS DE USUÁRIO - PERSONALIZADOS (US05 - Autenticadas, isolamento)       */
/* ========================================================================= */

rotasAmbientesSonoros.post(
  "/",
  validarOrigemMutacao,
  autenticar,
  validarCorpo(schemaCriarAmbienteSonoro),
  criarAmbienteSonoro
);

rotasAmbientesSonoros.get("/", autenticar, listarAmbientesSonoros);

rotasAmbientesSonoros.get("/:idAmbienteSonoro", autenticar, obterAmbienteSonoro);

rotasAmbientesSonoros.patch(
  "/:idAmbienteSonoro",
  validarOrigemMutacao,
  autenticar,
  validarCorpo(schemaAtualizarAmbienteSonoro),
  atualizarAmbienteSonoro
);

rotasAmbientesSonoros.put(
  "/:idAmbienteSonoro",
  validarOrigemMutacao,
  autenticar,
  validarCorpo(schemaAtualizarAmbienteSonoro),
  atualizarAmbienteSonoro
);

rotasAmbientesSonoros.delete(
  "/:idAmbienteSonoro",
  validarOrigemMutacao,
  autenticar,
  excluirAmbienteSonoro
);

export { rotasAmbientesSonoros };
