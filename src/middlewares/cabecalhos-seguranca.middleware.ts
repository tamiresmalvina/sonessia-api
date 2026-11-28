import helmet, { type HelmetOptions } from "helmet";

const HSTS_MAX_AGE_SEGUNDOS = 60 * 60 * 24 * 180;

export function criarMiddlewareCabecalhosSeguranca(producao: boolean) {
  const opcoes: HelmetOptions = {
    // A API não entrega HTML; CSP deve ser definida pelo servidor do frontend.
    contentSecurityPolicy: false,
    // O acesso cross-origin a recursos da API é controlado pelo CORS existente.
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
    // HSTS só é enviado em produção; o navegador recebe HTTPS terminado no proxy.
    strictTransportSecurity: producao
      ? {
          maxAge: HSTS_MAX_AGE_SEGUNDOS,
          includeSubDomains: false,
          preload: false,
        }
      : false,
  };

  return helmet(opcoes);
}
