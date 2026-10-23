import "dotenv/config";
import { defineConfig } from "prisma/config";

function obterUrlBanco(): string {
  if (process.env.NODE_ENV === "test" || process.env.PRISMA_TEST === "true") {
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
  return process.env.DATABASE_URL || "";
}

export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },

  datasource: {
    url: obterUrlBanco(),
  },
});
