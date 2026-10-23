import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

function obterUrlConexao(): string {
  if (process.env.NODE_ENV === "test") {
    if (process.env.TEST_DATABASE_URL) {
      return process.env.TEST_DATABASE_URL;
    }
    const urlOriginal = process.env.DATABASE_URL || "";
    if (urlOriginal.includes("/sonessia?")) {
      return urlOriginal.replace("/sonessia?", "/sonessia_test?");
    }
    if (urlOriginal.endsWith("/sonessia")) {
      return urlOriginal.replace(/\/sonessia$/, "/sonessia_test");
    }
  }
  return `${process.env.DATABASE_URL}`;
}

const connectionString = obterUrlConexao();

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

export { prisma };
