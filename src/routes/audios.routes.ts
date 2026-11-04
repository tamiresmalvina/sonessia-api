import { Router } from "express";
import { Perfil } from "../../generated/prisma/enums.js";
import {
  atualizarAudio,
  criarAudio,
  excluirAudio,
  listarAudios,
  obterAudio,
  substituirArquivoAudio,
} from "../controllers/audio.controller.js";
import { autenticar } from "../middlewares/autenticacao.middleware.js";
import { exigirPerfil } from "../middlewares/autorizacao.middleware.js";
import { receberAudio } from "../middlewares/audio.middleware.js";
import { validarOrigemMutacao } from "../middlewares/origem.middleware.js";
import { validarCorpo } from "../middlewares/validacao.middleware.js";
import { schemaAtualizarAudio } from "../schemas/audio.schema.js";

const rotasAudios = Router();
const protegerAdmin = [autenticar, exigirPerfil(Perfil.ADMIN)];

rotasAudios.post("/", validarOrigemMutacao, ...protegerAdmin, receberAudio, criarAudio);
rotasAudios.get("/", listarAudios);
rotasAudios.get("/:idAudio", obterAudio);
rotasAudios.patch("/:idAudio", validarOrigemMutacao, ...protegerAdmin, validarCorpo(schemaAtualizarAudio), atualizarAudio);
rotasAudios.put("/:idAudio/arquivo", validarOrigemMutacao, ...protegerAdmin, receberAudio, substituirArquivoAudio);
rotasAudios.delete("/:idAudio", validarOrigemMutacao, ...protegerAdmin, excluirAudio);

export { rotasAudios };
