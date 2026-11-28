import { isIP } from "node:net";
import type { Request } from "express";
import { ambiente } from "../config/ambiente.js";

/**
 * Resolve o IP sem confiar em X-Forwarded-For. No Render, CF-Connecting-IP
 * é aceito somente no modo explicitamente configurado e com formato de IP.
 */
export function obterIpCliente(req: Request): string {
  if (ambiente.TRUST_PROXY_MODE === "render") {
    const ipCloudflare = req.get("cf-connecting-ip")?.trim();
    if (ipCloudflare && isIP(ipCloudflare)) return ipCloudflare;
  }

  const ipDireto = req.socket.remoteAddress;
  return ipDireto && isIP(ipDireto) ? ipDireto : "unknown";
}
