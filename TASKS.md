# Planejamento de preparação e publicação — Sonessia

Este plano acompanha a preparação dos dois repositórios independentes: `sonessia-api` e `sonessia-frontend`. Atualizado em 27/11/2026 a partir do código e dos resultados de validação registrados na conversa de trabalho. Não representa configuração dos painéis externos. Os critérios de produto preservados no fim do documento são referência de User Stories; o status de preparação para publicação está nas fases acima.

## Legenda

- **Concluído:** código/documentação presentes e validação registrada.
- **Pendente:** trabalho necessário ainda não realizado ou sem evidência suficiente.
- **Bloqueado/decisão:** depende de decisão técnica, serviço externo, navegador ou confirmação do responsável.
- **Não verificável aqui:** depende de painel/conta externa que não está no repositório.

Não marque serviços hospedados como criados ou configurados apenas porque o código os suporta. Atualize estados somente com evidência verificável. Mantenha alterações locais preexistentes e não faça deploy, migrations remotas, commit ou push sem autorização específica.

## Fase 1 — Preparação do código e segurança

### Concluído

- [x] Validar variáveis de ambiente, exigir `NODE_ENV`, reforçar configuração JWT e validar `FRONTEND_ORIGIN` e TTLs.
- [x] Configurar os modos `direct`/`render` para seleção de IP e documentar rate limiting em memória.
- [x] Aplicar Helmet e cabeçalhos de segurança na API; HSTS somente em produção. CSP permanece fora da API JSON.
- [x] Implementar configuração de e-mail Ethereal, Mailpit e Gmail SMTP, preservando templates e fluxos atuais.
- [x] Registrar que Gmail SMTP foi testado localmente com sucesso, conforme resultado informado na etapa anterior. Isso não valida envio pelo Render Free.
- [x] Atualizar dependências do frontend para resolver o advisory anteriormente reportado de ESLint/minimatch; a árvore instalada resolve `minimatch@11.0.9`, acima da versão corrigida `11.0.1`.
- [x] Executar auditorias de dependências nas etapas anteriores. Nesta revisão, `npm audit` não conseguiu consultar o registry; backend mantém o advisory Effect/Prisma descrito abaixo e a árvore completa de ambos aguarda nova consulta online.
- [x] Auditar segurança pré-deploy e registrar limitações de autenticação cross-site, planos gratuitos, pooling e dependências.
- [x] Configurar o cookie refresh de produção com `SameSite=None; Secure; HttpOnly`, mantendo `Lax` em desenvolvimento/testes.
- [x] Implementar renovação automática após `401`, single-flight na aba e coordenação entre abas via Web Locks quando disponível, uma única repetição e limpeza/redirecionamento quando a renovação falha.
- [x] Preservar o modo atual de armazenamento do access token (`localStorage`/`sessionStorage`) e repetição de corpos suportados, incluindo Blob e FormData.
- [x] Registrar validação da etapa de autenticação: backend 455 testes, typecheck e build aprovados; frontend 89 testes, lint e build aprovados; `git diff --check` aprovado nos dois repositórios. O build frontend ainda informa chunk acima de 500 kB.

### Pendências de segurança e compatibilidade

- [ ] **Pendente de decisão — Prisma/Effect (Moderate):** o lock contém `effect@3.20.0` em `prisma@7.10.1 > @prisma/config@7.10.1`. O advisory oficial `GHSA-7589-6fvf-x4pw` afeta `effect <=3.22.0`, corrigido em `3.22.1`; npm audit não pôde consultar o registry nesta sessão. A exploração exige uso de `Schema.TemplateLiteral` com múltiplos spans e entrada não confiável, não confirmado no código Sonessia. Avaliar atualização oficial compatível do Prisma ou aceitar formalmente o risco; sem downgrade/override não validado.
- [ ] **Alta — cookies cross-site:** testar login, refresh, logout e restauração em Chrome, Firefox, Safari e dispositivos móveis. `SameSite=None; Secure` não supera bloqueio de cookies de terceiros em todos os navegadores.
- [ ] **Média — CSP do frontend:** avaliar e implementar política no host/documento frontend, considerando os recursos realmente utilizados.
- [ ] **Média — rate limiting:** manter limitação de memória documentada; reavaliar se houver mais de uma instância ou necessidade de proteção distribuída.
- [ ] **Média — uploads:** validar carga e memória com uploads próximos aos limites, especialmente áudio de até 50 MiB processado em memória.
- [x] Revisar os diffs dos dois repositórios, separar arquivos de aplicação/documentação relacionados e preservar o trabalho local; comandos de commit ficam preparados para execução manual.
- [x] Revisar `.gitignore`, status e arquivos candidatos ao commit. `.env` está ignorado em ambos os repositórios; a varredura documental não encontrou padrões comuns de segredo. Fazer a última conferência local antes de `git add`; nunca registrar valores secretos.

## Fase 2 — Serviços, configuração e decisões técnicas

- [ ] **Bloqueado por decisão — e-mail de produção:** escolher um provedor que ofereça envio por API HTTPS, opção gratuita adequada, sem exigir domínio próprio. Render Free bloqueia SMTP convencional; Gmail SMTP na porta 587 não é utilizável nesse plano.
- [ ] Implementar somente o transporte do provedor escolhido, preservando templates, contratos e fluxos atuais de confirmação, recuperação, alteração de e-mail e notificações; criar mocks/testes sem envio real.
- [ ] **Não verificável aqui — Neon:** confirmar no painel se o projeto Neon foi criado e definir branch, região, limites, pooling e backup. Nenhum estado de conta pode ser confirmado apenas pelos arquivos locais.
- [ ] Confirmar a estratégia de conexão para Prisma 7: URL pooled para runtime e conexão direta para migrations, se aplicável à configuração efetiva do Prisma/Neon. Hoje `DATABASE_URL` é a configuração visível comum; não há variável separada de URL direta no exemplo.
- [ ] Planejar a primeira migration em banco vazio/staging, revisar SQL e procedimento de backup/rollback. Não executar migration remota nesta fase documental.
- [ ] **Não verificável aqui — Render:** confirmar se o serviço foi criado e configurar build `npm run build`, start `npm start`, health check `/status`, `PORT` e secrets no painel.
- [ ] Configurar `TRUST_PROXY_MODE=render` no ambiente Render e validar em staging o cabeçalho de IP usado pela implementação; o padrão do código é `direct` e `.env.example` local mantém `direct`.
- [ ] Configurar `FRONTEND_ORIGIN` com a origem publicada exata e validar preflight/CORS com credentials.
- [ ] Configurar o provedor HTTPS de e-mail quando escolhido; não manter Ethereal/Mailpit como transporte de produção.
- [ ] **Não verificável aqui — Vercel:** confirmar no painel configuração do projeto estático, build `npm run build`, diretório `dist` e variável pública `VITE_API_URL` apontando para a API. O repositório contém `vercel.json` com fallback SPA para `index.html`.
- [ ] Verificar comportamento de refresh de rotas do `BrowserRouter` no domínio Vercel publicado.

## Fase 3 — Preparar release

- [ ] Completar revisão final de segurança, arquivos ignorados e secrets sem expor valores.
- [ ] Revisar alterações locais, separar o escopo por repositório e obter aprovação da versão final.
- [ ] Preparar commits separados de backend e frontend **somente após autorização explícita**.
- [ ] Fazer push para os repositórios GitHub **somente após autorização explícita**.
- [ ] Confirmar que os commits de release contêm todos os arquivos necessários e não contêm secrets.

## Fase 4 — Deploy e verificação publicada

- [ ] Publicar backend no Render após configuração e autorização.
- [ ] Publicar frontend na Vercel após backend e `VITE_API_URL` estarem definidos.
- [ ] Confirmar URLs públicas, `FRONTEND_ORIGIN`, HTTPS, CORS, headers e trust proxy.
- [ ] Confirmar que `/status` responde. A rota atual verifica processo HTTP, não a disponibilidade do Neon.
- [ ] Executar testes end-to-end: cadastro, verificação de e-mail, login, restauração, refresh após expiração, logout/revogação, recuperação de senha, requests autenticadas, uploads de áudio/imagem e cold start.
- [ ] Repetir fluxos de cookies em Chrome, Firefox, Safari e navegadores móveis com e sem bloqueio de cookies de terceiros.
- [ ] Validar logs sem secrets, comportamento após reinicialização, limites de recursos e erros externos.
- [ ] Registrar plano de rollback, backups e procedimentos de recuperação antes de abrir ao público.

## Limitações conhecidas dos planos gratuitos

- Render Free suspende serviço após inatividade, pode levar cerca de um minuto para voltar, pode reiniciar e declara o plano inadequado para aplicações de produção. O filesystem é efêmero; uploads da aplicação vão ao Cloudinary, não ao disco local.
- Render Free bloqueia tráfego SMTP convencional nas portas 25, 465 e 587.
- Rate limits locais não compartilham estado; reinícios limpam contadores.
- Cookies cross-site podem ser bloqueados por políticas do navegador mesmo com `SameSite=None; Secure`.
- Vercel Hobby é destinado a uso pessoal/não comercial; confirmar elegibilidade para a finalidade do projeto.
- Neon Free tem cotas de computação, armazenamento e tráfego; confirmar limites atuais no painel antes da publicação.

## Registro da última validação

Na revisão pré-GitHub em 27/11/2026: backend 455 testes aprovados, typecheck e build aprovados; frontend 90 testes aprovados, lint e build aprovados; `git diff --check` aprovado em ambos. O build frontend reportou chunk acima de 500 kB. `npm audit` não concluiu porque o registry não respondeu nesta sessão; o status local de Effect/Prisma está detalhado na pendência. Nenhum deploy ou migration remota foi realizado.

## Critérios de produto — referência

As User Stories abaixo preservam os critérios funcionais anteriormente mantidos neste arquivo. As caixas de status foram removidas: esta seção registra requisitos e não afirma que estejam concluídos nem que bloqueiem o deploy. As prioridades Must/Should/Could são prioridades originais do produto, não a ordem das fases de release acima. US10, US11 e US12 permanecem classificadas como Won’t Have no backlog original. Consulte código, testes e escopo aprovado antes de abrir uma tarefa de produto.

## US01 — Gerenciar áudios do catálogo

**Prioridade:** Must Have

- Definir/modelar os dados do áudio (titulo, tituloOriginal, categoria e demais campos necessários).
- Validar os dados recebidos ao cadastrar um áudio.
- Implementar cadastro de áudio para administrador autorizado.
- Implementar consulta/listagem de áudios cadastrados.
- Organizar/filtrar os áudios por categoria.
- Implementar consulta dos detalhes de um áudio, incluindo sua categoria.
- Implementar edição dos dados de um áudio existente.
- Implementar desativação/remoção de áudio, distinguindo os efeitos de cada ação.
- Garantir que áudios removidos ou desativados não sejam oferecidos no catálogo público.
- Proteger operações administrativas por autenticação e autorização.
- Testar validação, permissões, cadastro, listagem, edição e remoção de áudio.

## US02 — Criar e disponibilizar ambientes sonoros pré-configurados

**Prioridade:** Should Have

- Definir/modelar ambiente sonoro pré-configurado (nome, descrição, categoria dinâmica e estado de disponibilidade).
- Definir/modelar a relação entre ambiente e os áudios que o compõem.
- Permitir selecionar e adicionar áudios à composição de um ambiente.
- Permitir configurar o volume individual de cada áudio da composição.
- Validar os dados e a composição informados ao criar um ambiente.
- Associar o ambiente a uma categoria dinâmica ativa do tipo `AMBIENTE`.
- Implementar criação e edição de ambientes pré-configurados.
- Implementar disponibilização/publicação e impedir que ambientes não publicados apareçam para usuários.
- Listar ambientes publicados por categoria dinâmica.
- Retornar a composição e os volumes configurados para reprodução.
- Proteger gerenciamento de ambientes para administradores autorizados.
- Testar composição, volumes individuais, categoria, publicação e acesso público.

## US03 — Consultar catálogo gratuito de áudios

**Prioridade:** Must Have

- Disponibilizar endpoint público para consultar os áudios disponíveis gratuitamente.
- Retornar categorias dos áudios no catálogo.
- Incluir a categoria nos dados de cada áudio retornado.
- Garantir que somente áudios ativos e disponíveis sejam listados.
- Permitir obter os dados necessários para selecionar um áudio para uma composição.
- Testar catálogo público, categorias e exclusão de áudios indisponíveis.

## US04 — Combinar sons e controlar suas reproduções

**Prioridade:** Must Have

- Definir o formato de uma composição sonora temporária, sem exigir persistência.
- Permitir que o cliente envie/monte uma composição com dois ou mais áudios.
- Representar o volume individual de cada áudio na composição.
- Validar que os áudios selecionados existem e estão disponíveis.
- Permitir adicionar e remover áudios individualmente da composição no fluxo suportado pela API.
- Fornecer os dados necessários para que o cliente reproduza os sons simultaneamente e de forma contínua.
- Permitir utilizar uma composição sem salvá-la.
- Testar composição com múltiplos sons, volumes e áudios inválidos/indisponíveis.

> Observação: a reprodução simultânea, contínua e os controles em tempo real normalmente pertencem ao cliente (frontend/player). A API deve fornecer os metadados, URLs/fontes autorizadas e configurações necessárias; confirmar a divisão de responsabilidades na arquitetura.

## US05 — Criar conta e salvar ambientes sonoros personalizados

**Prioridade:** Must Have

- Implementar cadastro de usuário (informado como concluído).
- Validar os dados de cadastro (parte da funcionalidade de cadastro; confirmar cobertura de testes).
- Disponibilizar perfil após cadastro/autenticação (confirmar endpoint de consulta de perfil).
- Definir/modelar ambientes sonoros personalizados salvos pelo usuário.
- Implementar salvamento de uma composição com nome escolhido pelo usuário.
- Associar cada ambiente salvo ao usuário autenticado.
- Implementar listagem dos ambientes salvos pelo usuário autenticado.
- Implementar consulta de um ambiente salvo pertencente ao usuário.
- Garantir que um usuário não consiga consultar ou alterar ambientes salvos de outro usuário.
- Testar salvar, listar, consultar e isolamento entre usuários.

## US06 — Organizar ambientes salvos em coleções

**Prioridade:** Should Have

- Definir/modelar coleções pertencentes a um usuário.
- Permitir criar coleção com nome.
- Permitir adicionar ambientes salvos a uma coleção.
- Implementar consulta de uma coleção com seus ambientes associados.
- Permitir remover um ambiente da coleção sem excluir o ambiente salvo.
- Disponibilizar listagem geral dos ambientes salvos, inclusive os que não pertencem a coleção.
- Permitir acessar individualmente os ambientes associados a uma coleção.
- Garantir isolamento das coleções e ambientes por usuário.
- Testar criação, associação, remoção da coleção sem exclusão e ambientes sem coleção.

## US07 — Configurar temporizador e pausas entre sessões

**Prioridade:** Should Have

- Definir o contrato da API para duração da sessão, pausa opcional e comportamento ao terminar.
- Definir se o temporizador será controlado pelo cliente ou pelo servidor e documentar essa decisão.
- Se houver estado no servidor, implementar criação/configuração de temporizador por usuário/sessão.
- Se houver estado no servidor, retornar o tempo restante da sessão ou pausa.
- Implementar cancelamento do temporizador caso seja responsabilidade da API.
- Testar limites de duração, pausa, término e cancelamento, conforme a arquitetura definida.

> Observação: contagem regressiva e interrupção efetiva do áudio costumam ser responsabilidade do frontend/player. Evite implementar um temporizador no backend sem definir antes se o servidor realmente precisa manter esse estado.

## US08 — Consultar ambientes prontos por categoria dinâmica

**Prioridade:** Should Have

- Disponibilizar listagem de ambientes publicados filtráveis por categoria dinâmica.
- Permitir consultar ambientes de uma categoria específica.
- Retornar detalhes básicos do ambiente (nome, descrição e sons componentes).
- Retornar os volumes configurados para cada áudio do ambiente.
- Garantir que ambientes não publicados ou indisponíveis não apareçam na consulta pública.
- Testar consulta por categoria, detalhes e composição do ambiente.

## US09 — Alternar tema claro/escuro

**Prioridade:** Could Have

- Confirmar se a preferência de tema será gerenciada pelo frontend ou persistida pela API.
- Se for responsabilidade da API, definir/modelar preferência de tema do usuário.
- Se for responsabilidade da API, implementar leitura e atualização da preferência de tema.
- Garantir que a atualização da preferência não altere estado de reprodução de áudio.
- Testar persistência da preferência, se aplicável.

> Observação: tema visual e sua aplicação à interface são normalmente responsabilidade do frontend. A API só precisa participar se houver requisito explícito de persistir a preferência entre dispositivos/sessões.

## US13 — Compartilhar ambientes sonoros salvos

**Prioridade:** Could Have

- Definir o modelo de compartilhamento e as regras de acesso ao ambiente compartilhado.
- Definir como será gerado um link ou identificador de acesso compartilhável.
- Implementar geração/ativação de compartilhamento para um ambiente salvo.
- Implementar acesso público ou controlado ao ambiente compartilhado, conforme as regras definidas.
- Retornar detalhes do ambiente compartilhado e sua composição.
- Permitir reproduzir o ambiente compartilhado usando os sons e volumes originais.
- Validar que somente o proprietário pode criar ou alterar o compartilhamento.
- Testar geração de link, acesso de terceiros e permissões do proprietário.

## US14 — Usar recursos básicos sem criar conta

**Prioridade:** Must Have

- Permitir consulta pública do catálogo sem autenticação.
- Permitir obter os dados necessários para montar uma composição sem autenticação.
- Garantir que operações de leitura pública não exijam token JWT.
- Permitir consultar ambientes pré-configurados publicados sem autenticação.
- Garantir que os dados necessários à reprodução de ambientes públicos estejam acessíveis sem autenticação.
- Exigir autenticação para salvar uma composição no perfil.
- Exigir autenticação para criar coleções e usar outras funcionalidades de armazenamento pessoal.
- Retornar resposta de autenticação clara e consistente ao tentar salvar sem estar autenticado.
- Testar os fluxos públicos e confirmar que operações pessoais continuam protegidas.
