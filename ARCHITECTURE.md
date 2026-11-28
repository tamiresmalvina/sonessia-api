# Arquitetura atual — Sonessia

Atualizado em 27/11/2026 a partir do código presente nos worktrees. Backend e frontend são repositórios Git independentes. Os painéis Render, Neon e Vercel não foram inspecionados; a existência de serviços/contas e suas configurações externas não é confirmada por este documento.

## Visão geral

O Sonessia possui um frontend React/JavaScript/Vite que chama diretamente a API Express. A infraestrutura planejada é Vercel Free para o frontend, Render Free para a API e Neon Free para PostgreSQL, sem domínio próprio e sem proxy/BFF.

```text
Navegador
  ├── Vercel: SPA React + Vite (BrowserRouter)
  └── HTTPS direto, CORS com credentials
        └── Render: API Express/TypeScript
              ├── Prisma 7 + @prisma/adapter-pg → PostgreSQL (Neon planejado)
              ├── Cloudinary → mídia
              └── transporte de e-mail configurável
```

No frontend, `VITE_API_URL` escolhe a API; sem ela, o código usa `http://localhost:3000`. A URL de produção precisa ser definida no ambiente de build do frontend. O cliente comum está em `src/services/api.js`; a API aplica CORS para a origem exata de `FRONTEND_ORIGIN` e permite credentials. Requisições sem `Origin` são aceitas por CORS para clientes não navegador; rotas sensíveis verificam origem no middleware próprio.

## Stack, estrutura e comandos

### Backend (`sonessia-api`)

- Node.js 24, TypeScript, Express 5, PostgreSQL e Prisma 7 com `@prisma/adapter-pg`.
- `src/app.ts`: Express, Helmet, CORS, parsers, rotas e `/status`.
- `src/index.ts`: porta, inicialização do servidor e encerramento gracioso.
- `src/routes`, `controllers`, `services`, `schemas`, `middlewares`, `config` e `utils`: composição HTTP, regras de negócio, validação e integrações.
- `lib/prisma.ts`, `prisma/schema.prisma`, `prisma/migrations/` e `prisma7.config.ts`: acesso ao banco, schema, histórico de migrações e configuração Prisma.
- `tests/`: Vitest/Supertest; parte da suíte usa PostgreSQL de teste.
- Scripts reais: `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`, `npm start`, `npm run prisma:generate`, `npm run prisma:status`, `npm run seed`. O build gera Prisma Client e compila; start não aplica migrations. Não há script lint no backend.

### Frontend (`sonessia-frontend`)

- React, JavaScript, Vite, React Router, Tailwind CSS 4 e ESLint.
- `src/pages`, `components`, `layouts`, `routes`, `contexts`, `services`, `hooks`, `utils` e `styles` organizam interface, estado, chamadas HTTP e reprodução.
- `vite.config.js` habilita os plugins React e Tailwind. O build padrão Vite vai para `dist/`; `BrowserRouter` trata navegação SPA. `vercel.json` encaminha rotas profundas para `index.html` no host Vercel.
- Scripts reais: `npm run dev`, `npm test` (Node test runner), `npm run lint`, `npm run build`, `npm run preview`.
- A regra de rewrite está no repositório do frontend; confirmar navegação direta e refresh das rotas no deploy.

## Funcionalidades e integrações

O backend implementa cadastro e verificação de e-mail, login/sessões, recuperação e redefinição de senha, alterações de dados/e-mail, exclusão e reativação de conta, catálogo de áudio, ambientes sonoros personalizados e pré-configurados, categorias, coleções, histórico de reprodução e fotos de perfil. O frontend implementa rotas de usuário e administração, player/mixagem, controles de volume, tema, temporizador e chamadas dos serviços correspondentes. O estado de funcionamento coberto por testes deve ser consultado em `TASKS.md` e nos testes atuais; esta lista não implica validação de serviços hospedados.

Cloudinary recebe mídia de áudio e imagem; o código não depende de disco local persistente. Upload de áudio aceita até 50 MiB e é processado em memória; fotos de perfil aceitam até 5 MiB. Tamanho e concorrência de upload precisam ser observados nas instâncias pequenas do Render Free.

## Autenticação, cookies e origem

1. Cadastro cria conta não verificada; confirmação e recuperação de senha usam códigos/tokens enviados por e-mail.
2. Login retorna access token JWT no JSON e define refresh token opaco em cookie HttpOnly. O backend armazena hash do refresh, valida a sessão e rotaciona o token ao renovar.
3. O frontend armazena o access token em `localStorage` quando “lembrar-me” está ativo e em `sessionStorage` caso contrário. Ele é acessível a JavaScript; qualquer XSS que execute no site pode expô-lo.
4. Em chamadas autenticadas que retornam `401`, `src/services/api.js` tenta renovar pelo endpoint existente. O refresh usa `credentials: "include"`; chamadas concorrentes na aba compartilham uma única renovação, e abas do mesmo navegador coordenam a rotação com Web Locks quando disponível. Após sucesso, o cliente atualiza o token no mesmo armazenamento e repete a chamada no máximo uma vez. Sem Web Locks, a coordenação fica limitada à aba. Se a renovação falhar (ou o retry continuar em `401`), a sessão local é limpa e o frontend navega para `/login`.
5. Corpos reutilizáveis, inclusive JSON, Blob e FormData, podem ser repetidos. Corpos em stream não são repetidos automaticamente. O cliente preserva o cabeçalho Authorization com o token novo.
6. Logout limpa a sessão local em qualquer resultado. O backend encerra a sessão correspondente quando recebe o refresh cookie; sem o cookie, a sessão remota específica não pode ser identificada por esse fluxo e pode permanecer ativa até expirar ou ser invalidada por outra regra.

Opções de cookie em `src/utils/cookie.util.ts`:

| Ambiente | SameSite | Secure | HttpOnly | Path |
|---|---|---|---|---|
| development/test | `Lax` | não | sim | `/autenticacao` |
| production | `None` | sim | sim | `/autenticacao` |

Não se define `Domain`; o cookie permanece host-only no domínio da API. Criação, rotação e limpeza usam a mesma configuração de escopo.

`SameSite=None; Secure` torna o cookie elegível para requests cross-site em contextos compatíveis, mas não garante que o navegador aceite/enviará cookies de terceiros. Safari, modos privados, configurações de privacidade e extensões podem bloquear o refresh entre `*.vercel.app` e `*.onrender.com`. CORS e `credentials: include` não anulam essa política. Login pode funcionar com o access token e a renovação falhar mais tarde; é obrigatório testar navegadores reais após deploy. Consulte [a referência de cookies da MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies).

O CORS permite somente a origem exata configurada em `FRONTEND_ORIGIN` e habilita credentials. `validarOrigemMutacao` rejeita origem ausente ou diferente em produção nas rotas de login, renovação, logout e outras mutações protegidas conforme a composição das rotas. As demais rotas usam Bearer para autorização; CORS não substitui autenticação/controle de acesso.

## Banco de dados, Prisma e Neon

O schema Prisma usa PostgreSQL e o gerador Prisma 7. O runtime instancia `PrismaPg` usando `DATABASE_URL`; `prisma7.config.ts` também obtém URL do banco por essa configuração. No estado atual visível não há uma variável separada `DATABASE_URL_UNPOOLED` para migrations.

Neon é o destino planejado, mas nenhuma conexão a uma conta/projeto Neon é comprovada pelo repositório. Antes de production, confirmar compatibilidade real com Neon e estratégia: URL pooled para runtime e URL direta para operações de migration quando exigido pela ferramenta/configuração ([guia Prisma do Neon](https://neon.com/docs/guides/prisma)). O processo precisa testar em branch/banco isolado, revisar migrations e assegurar backup/rollback antes da primeira migração. `npm run build` gera o client, mas não aplica migrations. Evite `migrate dev`, `db push`, `migrate reset` e seed no banco de produção.

Variáveis relacionadas no código e exemplo:

| Variável | Uso |
|---|---|
| `NODE_ENV`, `PORT` | Ambiente e porta HTTP; Render fornece `PORT`. |
| `DATABASE_URL` | PostgreSQL para runtime/configuração Prisma atual. |
| `JWT_ACCESS_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE` | Assinatura e validação de JWT. |
| `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS` | Expiração de tokens; têm padrões validados. |
| `TRUST_PROXY_MODE` | `direct` ou `render`; padrão `direct`. |
| `FRONTEND_ORIGIN` | Origem exata para CORS e validação de origem. |
| `EMAIL_PROVIDER`, `EMAIL_FROM` | Seleção do transporte e remetente. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Gmail SMTP quando selecionado. |
| `MAILPIT_HOST`, `MAILPIT_PORT` | Transporte Mailpit local. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Credenciais de mídia. |
| `TEST_DATABASE_URL`, `PRISMA_TEST` | Seleção/isolamento de banco de teste em utilitários/configuração quando aplicável. |

O `.env.example` contém nomes e placeholders; nunca copie secrets reais para documentação. Não há evidência local de valores configurados nos painéis externos.

## E-mail

O transporte é selecionado por `EMAIL_PROVIDER`: Ethereal, Mailpit ou Gmail SMTP. Mailpit/Ethereal destinam-se a desenvolvimento/testes; Gmail SMTP está implementado e foi testado localmente conforme o histórico informado. A senha de Gmail deve ser uma senha de aplicativo, nunca a senha normal.

O provedor real para hospedagem ainda está pendente. O Gmail atual usa SMTP/587 e Render Free bloqueia SMTP convencional nessa porta. A próxima decisão é selecionar um provedor de envio por API HTTPS com opção gratuita adequada e sem domínio próprio. A troca futura deve ficar isolada no transporte, preservando templates, tokens, links e fluxos de negócio. Não há fallback automático entre provedores.

## Hospedagem planejada e limitações

### Render Free

Scripts compatíveis: build `npm run build`, start `npm start`, porta via `PORT`; endpoint `/status` retorna `{ "status": "ok" }`. Esse health check confirma somente resposta HTTP, não conexão com Neon ou Cloudinary. Não há arquivo `render.yaml` no repositório e criação/configuração de serviço não pode ser confirmada aqui.

Render Free suspende serviços após inatividade, tem cold start, recursos reduzidos, filesystem efêmero, pode reiniciar instâncias e não oferece escala horizontal nesse plano. A documentação do [Render Free](https://render.com/docs/free) recomenda não usar esse plano para aplicações de produção. A aplicação usa Cloudinary para mídia, mitigando dependência de disco persistente, mas uploads em memória e e-mails continuam sujeitos aos limites do plano. Render Free bloqueia SMTP convencional nas portas 25, 465 e 587 ([política SMTP](https://render.com/articles/can-i-send-email-over-smtp-from-render)). `TRUST_PROXY_MODE=render` deve ser definido no painel e o IP/header validado no serviço real.

### Vercel Free

Build esperado `npm run build`, saída padrão `dist`, variável `VITE_API_URL` com URL da API. O frontend usa `BrowserRouter`; validar deep links/refresh. Não existe configuração de deployment versionada neste repositório. Vercel Hobby é voltado a uso pessoal/não comercial ([plano Hobby](https://vercel.com/docs/plans/hobby)); confirmar compatibilidade com a finalidade do projeto.

### Neon Free

Banco PostgreSQL planejado. Confirmar pooler, conexão direta para migrations, quotas atuais, comportamento de suspensão e backup/PITR na conta antes de publicar. Não existe configuração local que prove criação do projeto Neon.

## Segurança e pendências de produção

- Helmet está aplicado na API. CSP está desativada no backend porque ele serve JSON e mídia, não HTML; CSP do frontend ainda requer avaliação. HSTS só é enviado em produção, sem `includeSubDomains` ou `preload`; COEP/CORP permanecem desativados.
- Trust proxy do Express fica desligado; o utilitário de IP usa a estratégia explícita do modo selecionado. Rate limits usam armazenamento em memória: reinicializações limpam contadores e múltiplas instâncias não compartilham limites.
- Access token fica em armazenamento acessível a JavaScript. Revisar risco de XSS e política CSP no frontend.
- Upload de áudio até 50 MiB pode pressionar memória sob concorrência em instância pequena.
- O lock local contém `effect@3.20.0` como dependência de `prisma@7.10.1 > @prisma/config@7.10.1`. O advisory oficial `GHSA-7589-6fvf-x4pw` classifica o problema como Moderate, afeta `effect <=3.22.0` e corrige em `3.22.1`; a auditoria npm não pôde ser atualizada nesta sessão por falha de rede. A exploração descrita requer `Schema.TemplateLiteral` com múltiplos spans de string em dados não confiáveis; não foi confirmado que o Sonessia invoque esse caminho. Resolver com versão Prisma compatível ou aceitar formalmente o risco antes do deploy; não aplicar override sem análise.
- O frontend local resolve `minimatch@11.0.9`, acima da versão corrigida `11.0.1` do advisory `GHSA-g3hv-75wg-m249`. O npm audit atual não pôde consultar o registry nesta sessão, então a árvore completa não foi revalidada por advisories.
- A arquitetura não deve ser declarada pronta para produção até advisory, e-mail hospedado, Neon, serviços externos, cookies nos navegadores e fluxos end-to-end serem validados.

## Estado recente de validação

Na revisão pré-GitHub em 27/11/2026: backend 455 testes aprovados, typecheck e build aprovados; frontend 90 testes, lint e build aprovados; `git diff --check` aprovado nos dois repositórios. O build do frontend emitiu aviso de chunk acima de 500 kB. O npm audit não conseguiu consultar o registry nesta sessão; veja o advisory local descrito acima.
