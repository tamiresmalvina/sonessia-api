# Instruções para agentes — Sonessia API

## Escopo e contexto

Este repositório Git contém somente o backend da Sonessia. O frontend React/Vite está em outro repositório (`sonessia-frontend`). Confirme sempre o estado e os scripts no repositório em que estiver trabalhando; não presuma que alterações locais do outro repositório foram publicadas.

Stack atual confirmada: Node.js 24 (compatibilidade declarada em `.node-version` e `package.json`), TypeScript, Express 5, PostgreSQL, Prisma 7 com `@prisma/adapter-pg`, Zod, JWT, Argon2id, Nodemailer e Cloudinary. Testes usam Vitest, Supertest e PostgreSQL de teste.

Estrutura principal: `src/routes`, `src/controllers`, `src/services`, `src/schemas`, `src/middlewares`, `src/config`, `src/utils`; Prisma em `prisma/`, cliente compartilhado em `lib/prisma.ts`, testes em `tests/` e configuração em `prisma7.config.ts`.

## Como trabalhar

- Inspecione `git status`, o diff e os arquivos diretamente relacionados antes de editar. Preserve todas as modificações e arquivos não rastreados preexistentes; não os reverta nem os reformate sem necessidade.
- Para tarefas significativas, apresente um plano curto com arquivos, abordagem, validação e riscos; depois prossiga quando a tarefa já autorizar a implementação.
- Faça mudanças completas, agrupadas e dentro do escopo. Reutilize as abstrações e contratos atuais; não altere regras de negócio sem solicitação.
- Ao concluir, informe arquivos alterados, resumo, verificações executadas e seus resultados, falhas, limitações e pendências.

## Segurança e dados

- Considere corpo, query, parâmetros, cabeçalhos e cookies como entrada não confiável. Use schemas Zod e autorização no backend; nunca confie apenas em validação ou proteção do frontend.
- Preserve JWT, sessões, rotação de refresh tokens, validação de origem, CORS restrito, cookies e rate limiting. Não enfraqueça controles para contornar falhas de integração.
- Segredos ficam em variáveis protegidas, nunca no código, exemplos, testes, logs ou respostas. Ao inspecionar configuração local, reporte nomes e presença das variáveis, jamais seus valores.
- Não use consultas SQL inseguras com dados do cliente. Aplique controle de propriedade nas consultas de recursos de usuário.
- Verifique autorização, limites, assinatura/tipo e tratamento de erros em uploads. O armazenamento de mídia usa Cloudinary; não introduza persistência local sem solicitação.
- Migrations, seeds e utilitários de teste devem ser apontados ao banco correto. Não execute migrations remotas, `db push`, reset ou seed em produção sem autorização explícita e plano confirmado.
- `TRUST_PROXY_MODE` aceita `direct` e `render`; seu padrão é `direct`. O código Express não confia genericamente em `X-Forwarded-For`; confirme no código atual antes de mudar essa estratégia. Em Render, a configuração e o cabeçalho de IP devem ser validados no ambiente hospedado.
- O refresh cookie é `SameSite=Lax` fora de produção e `SameSite=None; Secure; HttpOnly` em produção. Políticas de cookies de terceiros podem impedir o refresh cross-site; não prometa compatibilidade universal.
- Os rate limits usam memória local e não compartilham contadores entre instâncias. Não os apresente como defesa distribuída.

## E-mail e serviços externos

O transporte atual permite Ethereal, Mailpit e Gmail SMTP por configuração. Não envie e-mail real durante testes sem autorização. Render Free bloqueia SMTP convencional nas portas 25, 465 e 587; a escolha de um transporte HTTPS para produção continua pendente. Não invente um provedor nem altere templates ou fluxos de negócio ao trocar transporte.

Cloudinary e SMTP dependem de credenciais externas. Nunca exponha esses valores nem inclua-os em mensagens de erro.

## Comandos deste repositório

Execute somente os comandos adequados ao escopo e ambiente:

- `npm test` — suíte Vitest/Supertest; testes de integração podem usar PostgreSQL local de teste.
- `npm run typecheck` — verificação TypeScript sem emissão.
- `npm run build` — gera Prisma Client e compila TypeScript para `dist/`.
- `npm start` — inicia a build compilada; não executa migrations.
- `npm run prisma:generate` — gera Prisma Client.
- `npm run prisma:status` — consulta o estado das migrations no banco apontado pela configuração; confirme a URL antes de executar.

Não existe script de lint no `package.json` atual. Não rode testes que possam atingir serviços reais; confirme o isolamento do banco de testes antes de executar a suíte.

## Git, deploy e ações externas

- Não faça deploy, commit ou push sem solicitação/autorização explícita para aquela ação.
- Não instale, remova ou atualize dependências fora do pedido.
- Não altere `.env` real, banco remoto, serviços externos ou configurações de hospedagem sem autorização.
- Não execute comandos destrutivos, restaurações ou operações Git que descartem trabalho.
- Backend e frontend são repositórios independentes: revise e valide cada um separadamente.

## Planejamento e documentação

- `ARCHITECTURE.md` descreve a implementação atual e as limitações conhecidas.
- `TASKS.md` é o plano de preparação e publicação; diferencie trabalho concluído, pendente, bloqueado e não verificável no workspace.
- `docs/cabecalhos-seguranca.md` registra a decisão sobre cabeçalhos HTTP.
- Não marque criação/configuração de Neon, Render ou Vercel como concluída com base apenas no código. Confirme a evidência no repositório ou identifique a dependência de verificação externa.
- Mantenha a documentação sem segredos e sincronizada com o código efetivamente presente, inclusive alterações locais não commitadas.
