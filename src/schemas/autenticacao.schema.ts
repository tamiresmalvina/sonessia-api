import { z } from "zod";

interface DataCivil {
  ano: number;
  mes: number;
  dia: number;
}

function analisarDataCivil(valor: string): DataCivil | null {
  const correspondencia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!correspondencia) {
    return null;
  }

  const [, anoTexto, mesTexto, diaTexto] = correspondencia;
  const ano = Number(anoTexto);
  const mes = Number(mesTexto);
  const dia = Number(diaTexto);
  const dataUtc = new Date(Date.UTC(ano, mes - 1, dia));

  if (
    dataUtc.getUTCFullYear() !== ano ||
    dataUtc.getUTCMonth() + 1 !== mes ||
    dataUtc.getUTCDate() !== dia
  ) {
    return null;
  }

  return { ano, mes, dia };
}

export function criarSchemaDataNascimento(
  mensagemIdadeInsuficiente: string
): z.ZodType<Date, string> {
  return z.string().transform((valor, contexto) => {
    const dataCivil = analisarDataCivil(valor);
    if (!dataCivil) {
      contexto.addIssue({
        code: "custom",
        message: "A data de nascimento deve ser uma data válida no formato AAAA-MM-DD.",
      });
      return z.NEVER;
    }

    if (valor < "1900-01-01") {
      contexto.addIssue({
        code: "custom",
        message: "A data de nascimento não pode ser anterior a 1900-01-01.",
      });
      return z.NEVER;
    }

    const dataAtual = new Date();
    const hojeUtc = dataAtual.toISOString().slice(0, 10);
    if (valor > hojeUtc) {
      contexto.addIssue({
        code: "custom",
        message: "A data de nascimento não pode ser futura.",
      });
      return z.NEVER;
    }

    let idadeCompleta = dataAtual.getUTCFullYear() - dataCivil.ano;
    if (
      dataAtual.getUTCMonth() + 1 < dataCivil.mes ||
      (dataAtual.getUTCMonth() + 1 === dataCivil.mes &&
        dataAtual.getUTCDate() < dataCivil.dia)
    ) {
      idadeCompleta -= 1;
    }

    if (idadeCompleta < 16) {
      contexto.addIssue({
        code: "custom",
        message: mensagemIdadeInsuficiente,
      });
      return z.NEVER;
    }

    return new Date(Date.UTC(dataCivil.ano, dataCivil.mes - 1, dataCivil.dia));
  });
}

export const schemaCadastro = z.preprocess(
  (dados, contexto) => {
    if (typeof dados === "object" && dados !== null) {
      for (const campoFoto of ["fotoPerfil", "fotoPerfilPublicId"] as const) {
        if (Object.prototype.hasOwnProperty.call(dados, campoFoto)) {
          contexto.addIssue({
            code: "custom",
            path: [campoFoto],
            message: "A foto de perfil não pode ser definida durante o cadastro.",
          });
          return z.NEVER;
        }
      }
    }

    return dados;
  },
  z.object({
    nome: z
      .string()
      .trim()
      .min(2, "O nome deve ter no mínimo 2 caracteres.")
      .max(100, "O nome deve ter no máximo 100 caracteres."),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("E-mail em formato inválido.")
      .max(255, "O e-mail deve ter no máximo 255 caracteres."),
    senha: z
      .string()
      .min(8, "A senha deve ter no mínimo 8 caracteres.")
      .max(128, "A senha deve ter no máximo 128 caracteres.")
      .regex(/\p{Lu}/u, "A senha deve conter pelo menos uma letra maiúscula.")
      .regex(/\p{Ll}/u, "A senha deve conter pelo menos uma letra minúscula.")
      .regex(/[0-9]/, "A senha deve conter pelo menos um número.")
      .regex(/[\p{P}\p{S}]/u, "A senha deve conter pelo menos um símbolo."),
    dataNascimento: criarSchemaDataNascimento(
      "É necessário ter completado 16 anos para se cadastrar."
    ),
  })
);

export type EntradaCadastro = z.infer<typeof schemaCadastro>;

export const schemaVerificarEmail = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("E-mail em formato inválido."),
  codigo: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "O código deve conter exatamente 6 dígitos numéricos."),
});

export type EntradaVerificarEmail = z.infer<typeof schemaVerificarEmail>;

export const schemaReenviarCodigo = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("E-mail em formato inválido."),
});

export type EntradaReenviarCodigo = z.infer<typeof schemaReenviarCodigo>;

export const schemaLogin = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("E-mail em formato inválido.")
    .max(255, "O e-mail deve ter no máximo 255 caracteres."),
  senha: z
    .string()
    .min(1, "A senha é obrigatória.")
    .max(128, "A senha deve ter no máximo 128 caracteres."),
});

export type EntradaLogin = z.infer<typeof schemaLogin>;

export const schemaAtualizarNome = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, "O nome deve ter no mínimo 2 caracteres.")
      .max(100, "O nome deve ter no máximo 100 caracteres."),
  })
  .strict();

export type EntradaAtualizarNome = z.infer<typeof schemaAtualizarNome>;

export const schemaAtualizarDataNascimento = z
  .object({
    dataNascimento: criarSchemaDataNascimento(
      "É necessário ter completado 16 anos para atualizar a data de nascimento."
    ),
  })
  .strict();

export type EntradaAtualizarDataNascimento = z.infer<
  typeof schemaAtualizarDataNascimento
>;

export const schemaSolicitarAlteracaoEmail = z
  .object({
    novoEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email("E-mail em formato inválido.")
      .max(255, "O e-mail deve ter no máximo 255 caracteres."),
  })
  .strict();

export type EntradaSolicitarAlteracaoEmail = z.infer<
  typeof schemaSolicitarAlteracaoEmail
>;

export const schemaConfirmarAlteracaoEmail = z
  .object({
    token: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{64}$/, "Token de confirmação em formato inválido."),
  })
  .strict();

export type EntradaConfirmarAlteracaoEmail = z.infer<
  typeof schemaConfirmarAlteracaoEmail
>;

export const schemaSolicitarRecuperacaoSenha = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("E-mail em formato inválido.")
    .max(255, "O e-mail deve ter no máximo 255 caracteres."),
});

export type EntradaSolicitarRecuperacaoSenha = z.infer<typeof schemaSolicitarRecuperacaoSenha>;

export const schemaSenhaForte = z
  .string()
  .min(8, "A senha deve ter no mínimo 8 caracteres.")
  .max(128, "A senha deve ter no máximo 128 caracteres.")
  .regex(/\p{Lu}/u, "A senha deve conter pelo menos uma letra maiúscula.")
  .regex(/\p{Ll}/u, "A senha deve conter pelo menos uma letra minúscula.")
  .regex(/[0-9]/, "A senha deve conter pelo menos um número.")
  .regex(/[\p{P}\p{S}]/u, "A senha deve conter pelo menos um símbolo.");

export const schemaRedefinirSenha = z.object({
  token: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{64}$/, "Token de recuperação em formato inválido."),
  novaSenha: schemaSenhaForte,
});

export type EntradaRedefinirSenha = z.infer<typeof schemaRedefinirSenha>;

export const schemaSolicitarExclusaoConta = z
  .object({
    senhaAtual: z.string().min(1).max(128),
    confirmacao: z.literal("EXCLUIR_CONTA"),
  })
  .strict();

export type EntradaSolicitarExclusaoConta = z.infer<
  typeof schemaSolicitarExclusaoConta
>;

export const schemaReativarConta = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("E-mail em formato inválido.")
      .max(255, "O e-mail deve ter no máximo 255 caracteres."),
    senha: z.string().min(1).max(128),
  })
  .strict();

export type EntradaReativarConta = z.infer<typeof schemaReativarConta>;
