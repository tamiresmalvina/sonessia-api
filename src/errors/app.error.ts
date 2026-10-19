export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly codigo: string,
    message: string,
    public readonly detalhes: unknown[] = []
  ) {
    super(message);
    this.name = "AppError";
  }
}
