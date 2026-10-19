import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";

export function validarCorpo(schema: ZodSchema) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const dadosValidados = await schema.parseAsync(req.body);
      req.body = dadosValidados;
      next();
    } catch (erro) {
      next(erro);
    }
  };
}
