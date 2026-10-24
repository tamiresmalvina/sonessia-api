import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../lib/prisma.js";
import { cloudinary, inicializarCloudinary, resetarConfiguracaoCloudinaryParaTestes } from "../src/config/cloudinary.js";
import { Perfil } from "../generated/prisma/enums.js";
import { emitirTokenAcesso } from "../src/utils/jwt.util.js";
import { garantirBancoTestesIsolado } from "./helpers/isolamento-banco.helper.js";

describe("Fotos privadas de perfil", () => {
  const prefixoTeste = "test_foto_perfil_";

  beforeAll(async () => {
    await garantirBancoTestesIsolado();
  });

  beforeEach(() => {
    inicializarCloudinary({
      cloud_name: "cloud-falso-testes",
      api_key: "chave-falsa-testes",
      api_secret: "segredo-falso-testes",
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetarConfiguracaoCloudinaryParaTestes();
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: prefixoTeste } },
    });
  });

  async function criarUsuario(perfil: Perfil = Perfil.COMUM, fotoPerfilPublicId: string | null = null) {
    return prisma.usuario.create({
      data: {
        nome: "Usuário Foto Teste",
        email: `${prefixoTeste}${randomUUID()}@teste.com`,
        senha: "hash-de-teste",
        dataNascimento: new Date("1990-01-01T00:00:00.000Z"),
        perfil,
        emailVerificado: true,
        fotoPerfilPublicId,
      },
    });
  }

  function criarToken(idUsuario: string, versaoToken: number): string {
    return emitirTokenAcesso({ sub: idUsuario, versaoToken });
  }

  function ehRegistro(valor: unknown): valor is Record<string, unknown> {
    return typeof valor === "object" && valor !== null && !Array.isArray(valor);
  }

  function obterOpcoesEnvio(envio: { mock: { calls: unknown } }): Record<string, unknown> {
    const chamadas: unknown = envio.mock.calls;
    if (!Array.isArray(chamadas) || !Array.isArray(chamadas[0])) {
      throw new Error("O SDK não registrou uma chamada de upload.");
    }
    const opcoes: unknown = chamadas[0][1];
    if (!ehRegistro(opcoes)) {
      throw new Error("O SDK não recebeu as opções de upload esperadas.");
    }
    return opcoes;
  }

  function criarPng(largura = 1, altura = 1): Buffer {
    const imagem = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(imagem, 0);
    imagem.writeUInt32BE(13, 8);
    imagem.write("IHDR", 12, "ascii");
    imagem.writeUInt32BE(largura, 16);
    imagem.writeUInt32BE(altura, 20);
    imagem[24] = 8;
    imagem[25] = 6;
    return imagem;
  }

  function criarJpeg(largura = 1, altura = 1): Buffer {
    return Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
      (altura >> 8) & 0xff, altura & 0xff,
      (largura >> 8) & 0xff, largura & 0xff,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
      0xff, 0xda,
    ]);
  }

  function criarWebp(largura = 1, altura = 1): Buffer {
    const imagem = Buffer.alloc(30);
    imagem.write("RIFF", 0, "ascii");
    imagem.writeUInt32LE(22, 4);
    imagem.write("WEBP", 8, "ascii");
    imagem.write("VP8X", 12, "ascii");
    imagem.writeUInt32LE(10, 16);
    imagem.writeUIntLE(largura - 1, 24, 3);
    imagem.writeUIntLE(altura - 1, 27, 3);
    return imagem;
  }

  function configurarUploadBemSucedido() {
    return vi
      .spyOn(cloudinary.uploader, "upload")
      .mockImplementation(async (_arquivo, opcoesCallback) => {
        const opcoes: Record<string, unknown> = ehRegistro(opcoesCallback)
          ? opcoesCallback
          : {};
        const publicId =
          typeof opcoes.public_id === "string" ? opcoes.public_id : "";
        return {
          public_id: publicId,
          resource_type: "image",
          type: "authenticated",
          format: "png",
          width: 1,
          height: 1,
        } as Awaited<ReturnType<typeof cloudinary.uploader.upload>>;
      });
  }

  function configurarRemocaoBemSucedida() {
    return vi
      .spyOn(cloudinary.api, "delete_resources")
      .mockImplementation(async (ids) => ({
        deleted: Object.fromEntries(ids.map((id) => [id, "deleted"])),
      }));
  }

  async function enviarFoto(
    token: string,
    imagem: Buffer,
    tipoConteudo: string,
    query = ""
  ) {
    return request(app)
      .put(`/autenticacao/eu/foto-perfil${query}`)
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", tipoConteudo)
      .send(imagem);
  }

  it.each([
    ["JPEG", "image/jpeg", criarJpeg()],
    ["PNG", "image/png", criarPng()],
    ["WebP", "image/webp", criarWebp()],
  ])("aceita upload de imagem %s como recurso authenticated", async (_formato, tipo, imagem) => {
    const usuario = await criarUsuario();
    const token = criarToken(usuario.id, usuario.versaoToken);
    const envio = configurarUploadBemSucedido();
    configurarRemocaoBemSucedida();

    const resposta = await enviarFoto(token, imagem, tipo);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      mensagem: "Foto de perfil atualizada com sucesso.",
      fotoPerfil: "/autenticacao/eu/foto-perfil",
      limpezaRemotaPendente: false,
    });
    expect(envio).toHaveBeenCalledOnce();
    const [dataUri] = envio.mock.calls[0]!;
    const opcoes = obterOpcoesEnvio(envio);
    expect(dataUri).toMatch(new RegExp(`^data:${tipo};base64,`));
    expect(opcoes).toMatchObject({
      resource_type: "image",
      type: "authenticated",
      allowed_formats: ["jpg", "png", "webp"],
      overwrite: false,
    });
    expect(opcoes.public_id).toMatch(/^sonessia\/perfis\/[0-9a-f-]{36}$/i);

    const usuarioAtualizado = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioAtualizado?.fotoPerfilPublicId).toBe(opcoes.public_id);
    expect(usuarioAtualizado?.fotoPerfil).toBeNull();
    expect(JSON.stringify(resposta.body)).not.toContain("public_id");
    expect(JSON.stringify(resposta.body)).not.toContain("cloudinary");
  });

  it("rejeita upload sem autenticação antes de chamar o Cloudinary", async () => {
    const envio = vi.spyOn(cloudinary.uploader, "upload");

    const resposta = await request(app)
      .put("/autenticacao/eu/foto-perfil")
      .set("Content-Type", "image/png")
      .send(criarPng());

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("NAO_AUTENTICADO");
    expect(envio).not.toHaveBeenCalled();
  });

  it.each([
    ["GIF", "image/gif", Buffer.from("GIF89a")],
    ["corpo JSON", "application/json", Buffer.from('{"url":"https://exemplo.com/foto.png"}')],
  ])("rejeita %s como formato de foto", async (_caso, tipo, corpo) => {
    const usuario = await criarUsuario();
    const token = criarToken(usuario.id, usuario.versaoToken);
    const envio = vi.spyOn(cloudinary.uploader, "upload");

    const resposta = await enviarFoto(token, corpo, tipo);

    expect(resposta.status).toBe(415);
    expect(resposta.body.erro.codigo).toBe("FORMATO_IMAGEM_NAO_SUPORTADO");
    expect(envio).not.toHaveBeenCalled();
  });

  it("rejeita corpo maior que 5 MB no parser antes do serviço", async () => {
    const usuario = await criarUsuario();
    const token = criarToken(usuario.id, usuario.versaoToken);
    const envio = vi.spyOn(cloudinary.uploader, "upload");

    const resposta = await enviarFoto(
      token,
      Buffer.alloc(5 * 1024 * 1024 + 1),
      "image/png"
    );

    expect(resposta.status).toBe(413);
    expect(resposta.body.erro.codigo).toBe("FOTO_PERFIL_MUITO_GRANDE");
    expect(envio).not.toHaveBeenCalled();
  });

  it("rejeita conteúdo com extensão/MIME enganoso e dimensões abusivas", async () => {
    const usuario = await criarUsuario();
    const token = criarToken(usuario.id, usuario.versaoToken);
    const envio = vi.spyOn(cloudinary.uploader, "upload");

    const mimeEnganoso = await enviarFoto(token, criarJpeg(), "image/png");
    const pixelsExcessivos = await enviarFoto(
      token,
      criarPng(4096, 4096),
      "image/png"
    );

    expect(mimeEnganoso.status).toBe(400);
    expect(mimeEnganoso.body.erro.codigo).toBe("IMAGEM_INVALIDA");
    expect(pixelsExcessivos.status).toBe(400);
    expect(pixelsExcessivos.body.erro.codigo).toBe("DIMENSOES_IMAGEM_INVALIDAS");
    expect(envio).not.toHaveBeenCalled();
  });

  it("rejeita conteúdo falso, vazio, tipo divergente e dimensão abusiva", async () => {
    const usuario = await criarUsuario();
    const token = criarToken(usuario.id, usuario.versaoToken);
    const envio = vi.spyOn(cloudinary.uploader, "upload");

    const conteudoFalso = await enviarFoto(token, Buffer.from("não é imagem"), "image/png");
    const conteudoVazio = await enviarFoto(token, Buffer.alloc(0), "image/png");
    const tipoDivergente = await enviarFoto(token, criarPng(), "image/jpeg");
    const dimensaoExcessiva = await enviarFoto(
      token,
      criarPng(4097, 1),
      "image/png"
    );

    expect(conteudoFalso.status).toBe(400);
    expect(conteudoFalso.body.erro.codigo).toBe("IMAGEM_INVALIDA");
    expect(conteudoVazio.status).toBe(400);
    expect(conteudoVazio.body.erro.codigo).toBe("IMAGEM_VAZIA");
    expect(tipoDivergente.status).toBe(400);
    expect(dimensaoExcessiva.status).toBe(400);
    expect(envio).not.toHaveBeenCalled();
  });

  it("ignora IDs fornecidos na query e associa o upload somente ao usuário autenticado", async () => {
    const usuarioAutenticado = await criarUsuario();
    const outroUsuario = await criarUsuario();
    const token = criarToken(usuarioAutenticado.id, usuarioAutenticado.versaoToken);
    const envio = configurarUploadBemSucedido();
    configurarRemocaoBemSucedida();

    const resposta = await enviarFoto(
      token,
      criarPng(),
      "image/png",
      `?idUsuario=${outroUsuario.id}&userId=${outroUsuario.id}`
    );

    expect(resposta.status).toBe(200);
    const opcoes = obterOpcoesEnvio(envio);
    const usuarioAtualizado = await prisma.usuario.findUnique({
      where: { id: usuarioAutenticado.id },
    });
    const outroUsuarioSemAlteracao = await prisma.usuario.findUnique({
      where: { id: outroUsuario.id },
    });
    expect(usuarioAtualizado?.fotoPerfilPublicId).toBe(opcoes.public_id);
    expect(outroUsuarioSemAlteracao?.fotoPerfilPublicId).toBeNull();
  });

  it("preserva a foto ativa se o Cloudinary rejeitar ou falhar no upload novo", async () => {
    const publicIdAntigo = "sonessia/perfis/foto-antiga";
    const usuario = await criarUsuario(Perfil.COMUM, publicIdAntigo);
    const token = criarToken(usuario.id, usuario.versaoToken);
    const envio = vi
      .spyOn(cloudinary.uploader, "upload")
      .mockRejectedValue({ http_code: 400 });

    const resposta = await enviarFoto(token, criarPng(), "image/png");

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("IMAGEM_INVALIDA");
    expect(envio).toHaveBeenCalledOnce();
    const usuarioSemMudanca = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioSemMudanca?.fotoPerfilPublicId).toBe(publicIdAntigo);
  });

  it("mapeia timeout de upload e resposta Cloudinary inesperada sem trocar a foto anterior", async () => {
    const publicIdAntigo = "sonessia/perfis/foto-antiga";
    const usuario = await criarUsuario(Perfil.COMUM, publicIdAntigo);
    const token = criarToken(usuario.id, usuario.versaoToken);
    const envio = vi
      .spyOn(cloudinary.uploader, "upload")
      .mockRejectedValueOnce(new Error("timeout de teste"))
      .mockImplementationOnce(async (_arquivo, opcoesCallback) => {
        const opcoes: Record<string, unknown> = ehRegistro(opcoesCallback)
          ? opcoesCallback
          : {};
        return {
          public_id:
            typeof opcoes.public_id === "string" ? opcoes.public_id : "",
          resource_type: "image",
          type: "upload",
          format: "png",
          width: 1,
          height: 1,
        } as Awaited<ReturnType<typeof cloudinary.uploader.upload>>;
      });
    const remocao = configurarRemocaoBemSucedida();

    const falhaTimeout = await enviarFoto(token, criarPng(), "image/png");
    const respostaInvalida = await enviarFoto(token, criarPng(), "image/png");

    expect(falhaTimeout.status).toBe(502);
    expect(falhaTimeout.body.erro.codigo).toBe("FALHA_CLOUDINARY");
    expect(respostaInvalida.status).toBe(502);
    expect(respostaInvalida.body.erro.codigo).toBe(
      "RESPOSTA_CLOUDINARY_INVALIDA"
    );
    expect(remocao).toHaveBeenCalledOnce();
    const usuarioSemMudanca = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioSemMudanca?.fotoPerfilPublicId).toBe(publicIdAntigo);
    expect(envio).toHaveBeenCalledTimes(2);
  });

  it("substitui a foto e remove a referência antiga somente após persistir a nova", async () => {
    const publicIdAntigo = "sonessia/perfis/foto-antiga";
    const usuario = await criarUsuario(Perfil.COMUM, publicIdAntigo);
    const token = criarToken(usuario.id, usuario.versaoToken);
    const envio = configurarUploadBemSucedido();
    const remocao = configurarRemocaoBemSucedida();
    const atualizarBanco = vi.spyOn(prisma.usuario, "updateMany");

    const resposta = await enviarFoto(token, criarWebp(), "image/webp");

    expect(resposta.status).toBe(200);
    expect(atualizarBanco).toHaveBeenCalledOnce();
    const opcoes = obterOpcoesEnvio(envio);
    expect(remocao).toHaveBeenCalledWith(
      [publicIdAntigo],
      expect.objectContaining({ resource_type: "image", type: "authenticated" })
    );
    const usuarioAtualizado = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioAtualizado?.fotoPerfilPublicId).toBe(opcoes.public_id);
  });

  it("compensa o upload novo se a persistência Prisma falhar", async () => {
    const publicIdAntigo = "sonessia/perfis/foto-antiga";
    const usuario = await criarUsuario(Perfil.COMUM, publicIdAntigo);
    const token = criarToken(usuario.id, usuario.versaoToken);
    const envio = configurarUploadBemSucedido();
    const remocao = configurarRemocaoBemSucedida();
    vi.spyOn(prisma.usuario, "updateMany").mockRejectedValueOnce(
      new Error("falha de persistência simulada")
    );

    const resposta = await enviarFoto(token, criarPng(), "image/png");

    expect(resposta.status).toBe(500);
    const opcoes = obterOpcoesEnvio(envio);
    expect(remocao).toHaveBeenCalledWith(
      [opcoes.public_id],
      expect.objectContaining({ resource_type: "image", type: "authenticated" })
    );
    const usuarioSemMudanca = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioSemMudanca?.fotoPerfilPublicId).toBe(publicIdAntigo);
  });

  it("mantém a nova foto ativa e informa limpeza pendente se a remoção antiga falhar", async () => {
    const publicIdAntigo = "sonessia/perfis/foto-antiga";
    const usuario = await criarUsuario(Perfil.COMUM, publicIdAntigo);
    const token = criarToken(usuario.id, usuario.versaoToken);
    const envio = configurarUploadBemSucedido();
    vi.spyOn(cloudinary.api, "delete_resources").mockRejectedValue(
      new Error("falha remota simulada")
    );

    const resposta = await enviarFoto(token, criarPng(), "image/png");

    expect(resposta.status).toBe(202);
    expect(resposta.body.limpezaRemotaPendente).toBe(true);
    expect(JSON.stringify(resposta.body)).not.toContain(publicIdAntigo);
    const opcoes = obterOpcoesEnvio(envio);
    const usuarioAtualizado = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioAtualizado?.fotoPerfilPublicId).toBe(opcoes.public_id);
  });

  it("serve a imagem do usuário autenticado por proxy com cabeçalhos privados", async () => {
    const publicId = "sonessia/perfis/foto-propria";
    const usuario = await criarUsuario(Perfil.COMUM, publicId);
    const token = criarToken(usuario.id, usuario.versaoToken);
    const criarUrlAssinada = vi
      .spyOn(cloudinary.utils, "url")
      .mockReturnValue("https://res.cloudinary.com/cloud-falso/image/authenticated/foto.png");
    const buscarOrigem = vi.fn().mockResolvedValue(
      new Response(Uint8Array.from(criarPng()), {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    );
    vi.stubGlobal("fetch", buscarOrigem);

    const resposta = await request(app)
      .get("/autenticacao/eu/foto-perfil")
      .set("Authorization", `Bearer ${token}`);

    expect(resposta.status).toBe(200);
    expect(resposta.headers["content-type"]).toMatch(/image\/png/);
    expect(resposta.headers["x-content-type-options"]).toBe("nosniff");
    expect(resposta.headers["cache-control"]).toContain("private");
    expect(resposta.headers["cache-control"]).toContain("no-store");
    expect(resposta.headers.pragma).toBe("no-cache");
    expect(criarUrlAssinada).toHaveBeenCalledWith(
      publicId,
      expect.objectContaining({
        resource_type: "image",
        type: "authenticated",
        secure: true,
        sign_url: true,
      })
    );
    expect(buscarOrigem).toHaveBeenCalledWith(
      "https://res.cloudinary.com/cloud-falso/image/authenticated/foto.png",
      expect.objectContaining({ redirect: "error" })
    );
  });

  it("não permite que um ADMIN selecione a foto de outra pessoa por parâmetro", async () => {
    const administrador = await criarUsuario(Perfil.ADMIN);
    const outraPessoa = await criarUsuario(
      Perfil.COMUM,
      "sonessia/perfis/foto-alheia"
    );
    const token = criarToken(administrador.id, administrador.versaoToken);
    const buscarOrigem = vi.fn();
    vi.stubGlobal("fetch", buscarOrigem);

    const resposta = await request(app)
      .get(`/autenticacao/eu/foto-perfil?idUsuario=${outraPessoa.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(resposta.status).toBe(404);
    expect(resposta.body.erro.codigo).toBe("FOTO_PERFIL_NAO_ENCONTRADA");
    expect(buscarOrigem).not.toHaveBeenCalled();
  });

  it("rejeita visualização sem autenticação e usuário sem foto", async () => {
    const semToken = await request(app).get("/autenticacao/eu/foto-perfil");
    const usuario = await criarUsuario();
    const token = criarToken(usuario.id, usuario.versaoToken);
    const semFoto = await request(app)
      .get("/autenticacao/eu/foto-perfil")
      .set("Authorization", `Bearer ${token}`);

    expect(semToken.status).toBe(401);
    expect(semToken.body.erro.codigo).toBe("NAO_AUTENTICADO");
    expect(semFoto.status).toBe(404);
    expect(semFoto.body.erro.codigo).toBe("FOTO_PERFIL_NAO_ENCONTRADA");
    expect(semFoto.headers["cache-control"]).toContain("no-store");
  });

  it("converte falha de rede/timeout no proxy em erro 502 genérico", async () => {
    const usuario = await criarUsuario(
      Perfil.COMUM,
      "sonessia/perfis/foto-com-falha-de-rede"
    );
    const token = criarToken(usuario.id, usuario.versaoToken);
    vi.spyOn(cloudinary.utils, "url").mockReturnValue(
      "https://res.cloudinary.com/cloud-falso/image/authenticated/foto.png"
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout privado")));

    const resposta = await request(app)
      .get("/autenticacao/eu/foto-perfil")
      .set("Authorization", `Bearer ${token}`);

    expect(resposta.status).toBe(502);
    expect(resposta.body.erro.codigo).toBe("FALHA_LEITURA_CLOUDINARY");
    expect(JSON.stringify(resposta.body)).not.toContain("cloud-falso");
    expect(resposta.headers["cache-control"]).toContain("no-store");
  });

  it("mapeia falhas e imagens indisponíveis do Cloudinary sem vazar URLs internas", async () => {
    const usuario = await criarUsuario(
      Perfil.COMUM,
      "sonessia/perfis/foto-indisponivel"
    );
    const token = criarToken(usuario.id, usuario.versaoToken);
    vi.spyOn(cloudinary.utils, "url").mockReturnValue(
      "https://res.cloudinary.com/cloud-falso/image/authenticated/foto.png"
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    const resposta = await request(app)
      .get("/autenticacao/eu/foto-perfil")
      .set("Authorization", `Bearer ${token}`);

    expect(resposta.status).toBe(404);
    expect(resposta.body.erro.codigo).toBe("FOTO_PERFIL_NAO_ENCONTRADA");
    expect(JSON.stringify(resposta.body)).not.toContain("cloudinary.com");
  });

  it("rejeita tipo de conteúdo inesperado retornado pelo Cloudinary como falha upstream", async () => {
    const usuario = await criarUsuario(
      Perfil.COMUM,
      "sonessia/perfis/foto-tipo-invalido"
    );
    const token = criarToken(usuario.id, usuario.versaoToken);
    vi.spyOn(cloudinary.utils, "url").mockReturnValue(
      "https://res.cloudinary.com/cloud-falso/image/authenticated/foto"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("conteúdo não permitido", {
          status: 200,
          headers: { "content-type": "text/html" },
        })
      )
    );

    const resposta = await request(app)
      .get("/autenticacao/eu/foto-perfil")
      .set("Authorization", `Bearer ${token}`);

    expect(resposta.status).toBe(502);
    expect(resposta.body.erro.codigo).toBe("RESPOSTA_CLOUDINARY_INVALIDA");
  });

  it("remove a foto própria, usa type authenticated e é idempotente", async () => {
    const publicId = "sonessia/perfis/foto-para-remover";
    const usuario = await criarUsuario(Perfil.COMUM, publicId);
    const token = criarToken(usuario.id, usuario.versaoToken);
    const remocao = configurarRemocaoBemSucedida();

    const primeiraResposta = await request(app)
      .delete("/autenticacao/eu/foto-perfil")
      .set("Authorization", `Bearer ${token}`);
    const segundaResposta = await request(app)
      .delete("/autenticacao/eu/foto-perfil")
      .set("Authorization", `Bearer ${token}`);

    expect(primeiraResposta.status).toBe(200);
    expect(primeiraResposta.body).toMatchObject({
      fotoPerfil: null,
      removida: true,
      limpezaRemotaPendente: false,
    });
    expect(segundaResposta.status).toBe(200);
    expect(segundaResposta.body.removida).toBe(false);
    expect(remocao).toHaveBeenCalledOnce();
    expect(remocao).toHaveBeenCalledWith(
      [publicId],
      expect.objectContaining({ resource_type: "image", type: "authenticated" })
    );
    const usuarioAtualizado = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioAtualizado?.fotoPerfilPublicId).toBeNull();
  });

  it("rejeita remoção sem autenticação", async () => {
    const remocao = vi.spyOn(cloudinary.api, "delete_resources");

    const resposta = await request(app).delete("/autenticacao/eu/foto-perfil");

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro.codigo).toBe("NAO_AUTENTICADO");
    expect(remocao).not.toHaveBeenCalled();
  });

  it("remove a referência do banco e informa limpeza pendente se Cloudinary falhar", async () => {
    const publicId = "sonessia/perfis/foto-para-remover";
    const usuario = await criarUsuario(Perfil.COMUM, publicId);
    const token = criarToken(usuario.id, usuario.versaoToken);
    vi.spyOn(cloudinary.api, "delete_resources").mockRejectedValue(
      new Error("falha remota simulada")
    );

    const resposta = await request(app)
      .delete("/autenticacao/eu/foto-perfil")
      .set("Authorization", `Bearer ${token}`);

    expect(resposta.status).toBe(202);
    expect(resposta.body.limpezaRemotaPendente).toBe(true);
    expect(resposta.body.fotoPerfil).toBeNull();
    const usuarioAtualizado = await prisma.usuario.findUnique({
      where: { id: usuario.id },
    });
    expect(usuarioAtualizado?.fotoPerfilPublicId).toBeNull();
  });

  it("não permite que remoção de ADMIN afete a foto de outro usuário por query", async () => {
    const administrador = await criarUsuario(Perfil.ADMIN);
    const outroUsuario = await criarUsuario(
      Perfil.COMUM,
      "sonessia/perfis/foto-de-terceiro"
    );
    const token = criarToken(administrador.id, administrador.versaoToken);
    const remocao = vi.spyOn(cloudinary.api, "delete_resources");

    const resposta = await request(app)
      .delete(`/autenticacao/eu/foto-perfil?idUsuario=${outroUsuario.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body.removida).toBe(false);
    expect(remocao).not.toHaveBeenCalled();
    const fotoOutroUsuario = await prisma.usuario.findUnique({
      where: { id: outroUsuario.id },
    });
    expect(fotoOutroUsuario?.fotoPerfilPublicId).toBe(
      "sonessia/perfis/foto-de-terceiro"
    );
  });
});
