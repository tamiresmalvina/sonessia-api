import { v2 as cloudinary } from "cloudinary";
import { ambiente } from "./ambiente.js";
import { AppError } from "../errors/app.error.js";

/**
 * Parâmetros opcionais para inicialização ou reconfiguração do Cloudinary.
 */
export interface OpcoesConfiguracaoCloudinary {
  cloud_name?: string;
  api_key?: string;
  api_secret?: string;
}

/**
 * Determina se as credenciais necessárias para operação do Cloudinary
 * estão efetivamente configuradas no SDK.
 */
export function estaConfiguradoCloudinary(): boolean {
  const configSdk = cloudinary.config();
  return Boolean(
    configSdk.cloud_name && configSdk.api_key && configSdk.api_secret
  );
}

/**
 * Inicializa o SDK do Cloudinary v2 de forma centralizada e idempotente.
 * Configura sempre `secure: true` para garantir tráfego criptografado (HTTPS).
 *
 * @param opcoes Credenciais opcionais para sobrepor o ambiente (útil em testes automatizados).
 * @returns Instância do SDK `v2` do Cloudinary.
 */
export function inicializarCloudinary(
  opcoes?: OpcoesConfiguracaoCloudinary
): typeof cloudinary {
  const cloudName = opcoes?.cloud_name ?? ambiente.CLOUDINARY_CLOUD_NAME;
  const apiKey = opcoes?.api_key ?? ambiente.CLOUDINARY_API_KEY;
  const apiSecret = opcoes?.api_secret ?? ambiente.CLOUDINARY_API_SECRET;

  if (cloudName && apiKey && apiSecret) {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
  }

  return cloudinary;
}

// Inicialização automática não-bloqueante: se as variáveis estiverem configuradas no ambiente,
// prepara o SDK; caso contrário, não dispara exceções na simples importação do módulo.
inicializarCloudinary();

/**
 * Obtém a instância configurada do Cloudinary para executar operações.
 * Se as credenciais necessárias não estiverem configuradas, lança um AppError
 * controlado e seguro (HTTP 500, código CLOUDINARY_NAO_CONFIGURADO), impedindo
 * operações remotas com estado inválido e sem expor detalhes sensíveis.
 */
export function obterInstanciaCloudinary(): typeof cloudinary {
  if (!estaConfiguradoCloudinary()) {
    throw new AppError(
      500,
      "CLOUDINARY_NAO_CONFIGURADO",
      "O serviço de armazenamento de imagens não está configurado no ambiente atual."
    );
  }

  return cloudinary;
}

/**
 * Utilitário para redefinir o estado do SDK em testes sem vazar configurações entre cenários.
 */
export function resetarConfiguracaoCloudinaryParaTestes(): void {
  cloudinary.config(true);
}

export { cloudinary };
export default cloudinary;
