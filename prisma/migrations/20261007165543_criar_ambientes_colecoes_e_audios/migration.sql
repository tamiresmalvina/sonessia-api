/*
  Warnings:

  - The primary key for the `Usuario` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Changed the type of `id` on the `Usuario` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "Finalidade" AS ENUM ('ESTUDO', 'RELAXAMENTO', 'SONO', 'MEDITACAO', 'CONCENTRACAO', 'TRABALHO');

-- CreateEnum
CREATE TYPE "CategoriaAudio" AS ENUM ('NATUREZA', 'AMBIENTE', 'INSTRUMENTAL', 'RUIDO');

-- AlterTable
ALTER TABLE "Usuario" DROP CONSTRAINT "Usuario_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id");

-- CreateTable
CREATE TABLE "Colecao" (
    "idColecao" UUID NOT NULL,
    "idUsuario" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,

    CONSTRAINT "Colecao_pkey" PRIMARY KEY ("idColecao")
);

-- CreateTable
CREATE TABLE "AmbienteSonoro" (
    "idAmbienteSonoro" UUID NOT NULL,
    "idUsuario" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "finalidade" "Finalidade" NOT NULL,
    "origem" TEXT NOT NULL,
    "imagem" TEXT,
    "autorImagem" TEXT,
    "tituloOriginalImagem" TEXT,
    "fonteImagem" TEXT,
    "licencaImagem" TEXT,
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmbienteSonoro_pkey" PRIMARY KEY ("idAmbienteSonoro")
);

-- CreateTable
CREATE TABLE "Audio" (
    "idAudio" UUID NOT NULL,
    "idUsuario" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "categoria" "CategoriaAudio" NOT NULL,
    "arquivo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "tituloOriginal" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "licenca" TEXT NOT NULL,

    CONSTRAINT "Audio_pkey" PRIMARY KEY ("idAudio")
);

-- CreateTable
CREATE TABLE "ColecaoAmbienteSonoro" (
    "idColecao" UUID NOT NULL,
    "idAmbienteSonoro" UUID NOT NULL,

    CONSTRAINT "ColecaoAmbienteSonoro_pkey" PRIMARY KEY ("idColecao","idAmbienteSonoro")
);

-- CreateTable
CREATE TABLE "AmbienteSonoroAudio" (
    "idAmbienteSonoro" UUID NOT NULL,
    "idAudio" UUID NOT NULL,
    "volume" INTEGER NOT NULL,

    CONSTRAINT "AmbienteSonoroAudio_pkey" PRIMARY KEY ("idAmbienteSonoro","idAudio")
);

-- AddForeignKey
ALTER TABLE "Colecao" ADD CONSTRAINT "Colecao_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbienteSonoro" ADD CONSTRAINT "AmbienteSonoro_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audio" ADD CONSTRAINT "Audio_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ColecaoAmbienteSonoro" ADD CONSTRAINT "ColecaoAmbienteSonoro_idColecao_fkey" FOREIGN KEY ("idColecao") REFERENCES "Colecao"("idColecao") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ColecaoAmbienteSonoro" ADD CONSTRAINT "ColecaoAmbienteSonoro_idAmbienteSonoro_fkey" FOREIGN KEY ("idAmbienteSonoro") REFERENCES "AmbienteSonoro"("idAmbienteSonoro") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbienteSonoroAudio" ADD CONSTRAINT "AmbienteSonoroAudio_idAmbienteSonoro_fkey" FOREIGN KEY ("idAmbienteSonoro") REFERENCES "AmbienteSonoro"("idAmbienteSonoro") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbienteSonoroAudio" ADD CONSTRAINT "AmbienteSonoroAudio_idAudio_fkey" FOREIGN KEY ("idAudio") REFERENCES "Audio"("idAudio") ON DELETE RESTRICT ON UPDATE CASCADE;
