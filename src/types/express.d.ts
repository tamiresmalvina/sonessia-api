import type { Perfil } from "../../generated/prisma/enums.js";

export interface UsuarioAutenticado {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  emailVerificado: boolean;
  versaoToken: number;
  senhaAlteradaEm: Date | null;
}

declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioAutenticado;
    }
  }
}
