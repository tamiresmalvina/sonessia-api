import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { ambiente } from "./config/ambiente.js";
import { tratadorDeErros } from "./middlewares/erro.middleware.js";
import { rotasAutenticacao } from "./routes/autenticacao.routes.js";

const app = express();

app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: (origin, callback) => {
      // Permite requisições sem header de origem (ex.: Insomnia, Supertest, curl)
      if (!origin) {
        return callback(null, true);
      }

      // Se houver origem do frontend configurada e coincidir com a requisição
      if (ambiente.FRONTEND_ORIGIN && origin === ambiente.FRONTEND_ORIGIN) {
        return callback(null, true);
      }

      // Rejeita origens não autorizadas
      return callback(null, false);
    },
    credentials: true,
  })
);

app.get("/status", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/autenticacao", rotasAutenticacao);

app.use((_req, res) => {
  res.status(404).json({
    erro: {
      codigo: "ROTA_NAO_ENCONTRADA",
      mensagem: "A rota solicitada não foi encontrada.",
      detalhes: [],
    },
  });
});

app.use(tratadorDeErros);

export { app };
export default app;
