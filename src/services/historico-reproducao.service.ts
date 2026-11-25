import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../errors/app.error.js";
import { ORIGEM_PERSONALIZADO, ORIGEM_PRECONFIGURADO, dtoAmbiente } from "./ambiente-sonoro.service.js";
import { schemaRegistrarReproducao, type EntradaRegistrarReproducao } from "../schemas/historico-reproducao.schema.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIAS_RETENCAO = 90;
const LIMITE_HISTORICO = 20;

const incluirAmbiente = {
  categoria: true,
  audios: {
    include: {
      audio: {
        include: { categoria: true },
      },
    },
    orderBy: { audio: { titulo: "asc" } },
  },
} satisfies Prisma.AmbienteSonoroInclude;

function dataLimiteRetencao(agora: Date): Date {
  return new Date(agora.getTime() - DIAS_RETENCAO * 24 * 60 * 60 * 1000);
}

function validarIdAmbiente(idAmbienteSonoro: string): void {
  if (!UUID_REGEX.test(idAmbienteSonoro)) {
    throw new AppError(400, "ID_AMBIENTE_INVALIDO", "O identificador do ambiente sonoro é inválido.");
  }
}

function dtoHistorico(
  ambiente: Prisma.AmbienteSonoroGetPayload<{ include: typeof incluirAmbiente }>,
  ultimaReproducao: Date,
) {
  return {
    ...dtoAmbiente(ambiente),
    ultimaReproducao,
  };
}

export async function registrarReproducao(
  idUsuario: string,
  dadosBrutos: unknown,
  agora = new Date(),
) {
  const dados: EntradaRegistrarReproducao = schemaRegistrarReproducao.parse(dadosBrutos);
  validarIdAmbiente(dados.idAmbienteSonoro);

  return prisma.$transaction(async (tx) => {
    // Serializa registros simultâneos do mesmo usuário para preservar o limite de 20.
    await tx.$queryRaw`SELECT id FROM "Usuario" WHERE id = ${idUsuario}::uuid FOR UPDATE`;

    const ambiente = await tx.ambienteSonoro.findFirst({
      where: {
        idAmbienteSonoro: dados.idAmbienteSonoro,
        OR: [
          { origem: ORIGEM_PERSONALIZADO, idUsuario },
          { origem: ORIGEM_PRECONFIGURADO, publicado: true },
        ],
      },
      select: { idAmbienteSonoro: true },
    });

    if (!ambiente) {
      throw new AppError(404, "AMBIENTE_NAO_ENCONTRADO", "Ambiente sonoro não encontrado.");
    }

    const historico = await tx.historicoReproducaoAmbiente.upsert({
      where: {
        idUsuario_idAmbienteSonoro: {
          idUsuario,
          idAmbienteSonoro: dados.idAmbienteSonoro,
        },
      },
      create: {
        idUsuario,
        idAmbienteSonoro: dados.idAmbienteSonoro,
        ultimaReproducao: agora,
        atualizadoEm: agora,
      },
      update: {
        ultimaReproducao: agora,
        atualizadoEm: agora,
      },
      select: {
        id: true,
        idAmbienteSonoro: true,
        ultimaReproducao: true,
      },
    });

    const limite = dataLimiteRetencao(agora);
    await tx.historicoReproducaoAmbiente.deleteMany({
      where: { idUsuario, ultimaReproducao: { lte: limite } },
    });

    const maisRecentes = await tx.historicoReproducaoAmbiente.findMany({
      where: { idUsuario },
      orderBy: [{ ultimaReproducao: "desc" }, { id: "asc" }],
      take: LIMITE_HISTORICO,
      select: { id: true },
    });
    await tx.historicoReproducaoAmbiente.deleteMany({
      where: {
        idUsuario,
        id: { notIn: maisRecentes.map((registro) => registro.id) },
      },
    });

    return {
      mensagem: "Reprodução registrada com sucesso.",
      historico: {
        id: historico.id,
        idAmbienteSonoro: historico.idAmbienteSonoro,
        ultimaReproducao: historico.ultimaReproducao,
      },
    };
  });
}

export async function listarReproducoesRecentes(idUsuario: string, agora = new Date()) {
  const historicos = await prisma.historicoReproducaoAmbiente.findMany({
    where: {
      idUsuario,
      ultimaReproducao: { gt: dataLimiteRetencao(agora) },
      ambienteSonoro: {
        OR: [
          { origem: ORIGEM_PERSONALIZADO, idUsuario },
          { origem: ORIGEM_PRECONFIGURADO, publicado: true },
        ],
      },
    },
    include: {
      ambienteSonoro: { include: incluirAmbiente },
    },
    orderBy: [{ ultimaReproducao: "desc" }, { id: "asc" }],
    take: LIMITE_HISTORICO,
  });

  return historicos.map(({ ambienteSonoro, ultimaReproducao }) =>
    dtoHistorico(ambienteSonoro, ultimaReproducao),
  );
}
