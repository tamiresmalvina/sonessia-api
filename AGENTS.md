# AGENTS.md — Manual de Trabalho dos Agentes de Codificação

## 1. Objetivo e autoridade deste documento

Este documento define as regras permanentes que todos os agentes de codificação devem seguir ao trabalhar no **Sonessia API**.

O objetivo é manter o projeto seguro, consistente, organizado, tipado, testável e fácil de manter, evitando decisões arbitrárias, alterações desnecessárias e regressões.

### Regras fundamentais

1. Inspecione o código existente antes de propor ou implementar alterações.
2. Respeite a arquitetura, as tecnologias e os padrões já adotados no projeto.
3. Não invente arquivos, funções, endpoints, tabelas, campos, dependências ou funcionalidades.
4. Não implemente funcionalidades além do escopo solicitado sem autorização.
5. Não execute operações destrutivas ou de alto risco sem autorização explícita.
6. Priorize segurança, integridade dos dados, legibilidade e manutenção.
7. Valide as entradas antes de utilizá-las em operações sensíveis.
8. Teste as alterações e informe honestamente o que foi ou não validado.
9. Prefira mudanças pequenas, localizadas e reversíveis.
10. Quando houver dúvida relevante, explique as alternativas e peça esclarecimento antes de tomar uma decisão irreversível.

Estas regras são obrigatórias. Conveniência, rapidez ou preferência pessoal não justificam ignorá-las.

---

## 2. Contexto e limites do projeto

O Sonessia API é o backend do projeto Sonessia.

O agente deve confirmar o estado real do repositório antes de assumir detalhes sobre implementação, versões, funcionalidades ou estrutura.

### Tecnologias e ferramentas

O Sonessia API já utiliza as seguintes tecnologias e ferramentas:

- **Node.js** — ambiente de execução.
- **TypeScript** — linguagem de programação.
- **Express** — framework HTTP para construção da API.
- **PostgreSQL** — banco de dados relacional.
- **Prisma ORM** — acesso ao banco de dados, modelagem e migrations.
- **Zod** — validação de dados.
- **JWT** — autenticação baseada em tokens.
- **Argon2id** — hash seguro de senhas.
- **Ethereal Email** — serviço de e-mail de teste, utilizado para verificar o envio de mensagens durante o desenvolvimento.
- **Mailpit** — ferramenta local para interceptar e inspecionar e-mails durante os testes.
- **Insomnia** — ferramenta para realizar e documentar testes manuais dos endpoints da API.
- **Vitest e Supertest** — ferramentas de testes automatizados, conforme a configuração existente no projeto.

Essa lista representa a base tecnológica conhecida do projeto. O agente deve preservar essas tecnologias e não substituí-las por preferência pessoal.

Antes de utilizar ou modificar qualquer ferramenta, consulte o `package.json`, os arquivos de configuração e a implementação existente para confirmar as versões instaladas, os recursos disponíveis e a forma como cada tecnologia está sendo utilizada.

#### Inclusão de novas tecnologias

Sempre que uma nova tecnologia, biblioteca, framework, serviço ou ferramenta for **aprovada, instalada e efetivamente incorporada ao projeto**, o agente responsável pela implementação deve atualizar esta seção do `AGENTS.md`, incluindo:

- O nome da tecnologia ou ferramenta.
- Sua finalidade no projeto.
- Seu papel na arquitetura ou no fluxo de desenvolvimento, quando relevante.

A atualização deve ocorrer como parte da tarefa que introduziu a tecnologia, para que a documentação permaneça sincronizada com o código.

Não adicione tecnologias apenas porque foram sugeridas, discutidas ou consideradas como alternativas. A inclusão deve refletir uma adoção real no projeto.

Antes de introduzir uma nova dependência ou tecnologia, o agente deve verificar se os recursos existentes já resolvem o problema. A instalação ou alteração de dependências exige autorização explícita, conforme as regras deste documento.

#### Limites de escopo

- Trabalhe no backend, salvo solicitação explícita em contrário.
- Não modifique o frontend nem outro repositório por iniciativa própria.
- Não substitua tecnologias adotadas por preferências pessoais.
- Não introduza bibliotecas quando a funcionalidade puder ser implementada de forma segura com os recursos disponíveis.
- Não crie uma estrutura complexa para resolver um problema simples.
- Não transforme uma tarefa pontual em uma refatoração ampla.
- Não atualize versões ou configurações de ferramentas sem avaliar os impactos e obter a autorização necessária.

---

## 3. Inspeção obrigatória antes de codificar

Antes de modificar qualquer arquivo, o agente deve compreender o contexto relevante da implementação.

### Inspecione, conforme a tarefa

- Estrutura atual de diretórios.
- `package.json` e scripts disponíveis.
- Configuração do TypeScript.
- Configuração do ESLint ou de outras ferramentas de qualidade, se existentes.
- Configuração do Prisma e do banco de dados.
- Variáveis de ambiente necessárias, sem revelar seus valores.
- Rotas, controllers, services, schemas, middlewares e utilitários relacionados.
- Modelos Prisma e migrations existentes.
- Tratamento de erros.
- Autenticação e autorização já implementadas.
- Testes existentes e seus padrões.
- Documentação relevante disponível.

### Regras de inspeção

1. Procure implementações existentes antes de criar novas.
2. Verifique como arquivos semelhantes foram organizados.
3. Reutilize padrões existentes quando forem adequados e seguros.
4. Não presuma que um arquivo existe apenas porque foi mencionado em uma conversa.
5. Não afirme que um comando, teste ou funcionalidade funciona sem evidência.
6. Se o repositório estiver inconsistente ou incompleto, identifique a limitação antes de prosseguir.
7. Não substitua uma implementação existente sem compreender suas dependências e seus efeitos.

A análise deve ser proporcional à tarefa. Alterações simples exigem inspeção direcionada; mudanças estruturais exigem uma análise mais ampla.

---

## 4. Processo de trabalho

Toda tarefa deve seguir um processo controlado.

### Etapa 1 — Entender

- Identifique o objetivo solicitado.
- Determine quais arquivos e componentes são relevantes.
- Identifique as regras de negócio envolvidas.
- Verifique os riscos de segurança, compatibilidade e integridade dos dados.
- Identifique dúvidas que possam alterar significativamente a implementação.

### Etapa 2 — Planejar

Antes de uma alteração relevante, apresente um plano conciso contendo:

- O que será alterado.
- Quais arquivos serão afetados.
- Como a alteração será implementada.
- Quais testes serão executados.
- Quais riscos ou decisões precisam de autorização.

Para tarefas triviais, um plano separado não é necessário, desde que o escopo esteja claro.

### Etapa 3 — Implementar

- Altere somente o necessário.
- Siga os padrões existentes.
- Mantenha responsabilidades bem definidas.
- Evite duplicação e abstrações prematuras.
- Não esconda falhas com tipos permissivos, `catch` vazios ou valores padrão arbitrários.
- Não remova validações ou controles de segurança para facilitar a implementação.

### Etapa 4 — Validar

Execute os testes e verificações compatíveis com a tarefa e com o ambiente disponível.

Sempre que aplicável, verifique:

- Compilação e verificação de tipos.
- Lint.
- Testes automatizados.
- Comportamento esperado do endpoint.
- Cenários de erro.
- Autenticação e autorização.
- Compatibilidade com os fluxos existentes.
- Efeitos sobre o banco de dados.

### Etapa 5 — Relatar

Ao terminar, informe:

1. O que foi implementado.
2. Quais arquivos foram criados ou modificados.
3. Quais verificações foram executadas.
4. Quais verificações passaram ou falharam.
5. O que não pôde ser validado.
6. Quais riscos, pendências ou decisões continuam em aberto.

Nunca declare uma tarefa concluída apenas porque o código foi escrito.

---

## 5. Autorização para operações de risco

O agente pode inspecionar o projeto e propor mudanças, mas não deve executar operações de risco sem autorização explícita.

A autorização deve ser específica para a operação. Uma autorização genérica para implementar uma funcionalidade não autoriza ações destrutivas.

### Operações que exigem autorização prévia

- Instalar, remover ou atualizar dependências.
- Alterar versões importantes de ferramentas.
- Modificar configurações sensíveis do projeto.
- Apagar arquivos existentes.
- Renomear ou reorganizar diretórios existentes de forma significativa.
- Renomear ou remover campos de banco de dados.
- Executar migrations com possíveis perdas de dados.
- Executar comandos de reset, limpeza ou exclusão de banco de dados.
- Alterar dados reais ou ambientes compartilhados.
- Modificar arquivos `.env` reais.
- Executar operações Git que alterem o histórico ou descartem trabalho.
- Criar commits ou realizar push, salvo quando solicitado.
- Alterar credenciais, segredos ou permissões de serviços externos.

### Como solicitar autorização

Antes de executar uma operação de risco, explique:

1. O comando ou a mudança pretendida.
2. Por que ela é necessária.
3. Quais são os riscos.
4. Quais dados, arquivos ou configurações podem ser afetados.
5. Se existe uma alternativa mais segura.

Não interprete silêncio como autorização.

### Comandos Git

Não execute por iniciativa própria comandos como:

- `git reset --hard`
- `git clean -fd`
- `git push --force`
- `git rebase` que reescreva histórico compartilhado
- comandos de checkout ou restauração que descartem alterações locais

Antes de operar no Git, verifique o estado do repositório e preserve alterações preexistentes do usuário.

Nunca descarte trabalho não relacionado à tarefa.

---

## 6. Arquitetura e separação de responsabilidades

A implementação deve respeitar a separação de responsabilidades já adotada no projeto.

Como convenção geral, utilize o seguinte fluxo quando compatível com a estrutura existente:

**Rotas → Middlewares → Controllers → Services → Prisma**

A organização definitiva deve ser confirmada no código real e poderá ser detalhada posteriormente em `ARCHITECTURE.md`.

### 6.1. Rotas

As rotas devem:

- Declarar os endpoints HTTP.
- Associar métodos, caminhos e handlers.
- Aplicar os middlewares necessários.
- Aplicar autenticação, autorização e validação no ponto adequado.
- Manter uma organização previsível.

Não coloque regras de negócio complexas diretamente nos arquivos de rotas.

### 6.2. Middlewares

Os middlewares devem tratar responsabilidades transversais, como:

- Autenticação.
- Autorização quando apropriado.
- Validação compartilhada, quando justificada.
- Tratamento de erros.
- Limitação de requisições.
- Controles de segurança.

Não duplique verificações de autenticação de maneira inconsistente entre endpoints.

### 6.3. Controllers

Os controllers devem:

- Receber e interpretar a requisição HTTP.
- Obter os dados já validados.
- Acionar os services adequados.
- Definir status HTTP e formato da resposta.
- Encaminhar erros para o mecanismo de tratamento estabelecido.

Os controllers não devem conter regras de negócio complexas nem concentrar consultas Prisma extensas.

### 6.4. Services

Os services devem:

- Implementar regras de negócio.
- Coordenar operações relacionadas.
- Realizar acesso ao banco por meio da instância Prisma compartilhada.
- Aplicar regras de integridade e autorização que dependam do contexto de negócio.
- Coordenar transações quando necessário.

Services não devem depender diretamente de `req` ou `res` do Express.

Não mova toda operação para um service genérico sem necessidade. Mantenha cada responsabilidade clara.

### 6.5. Validação

Utilize Zod para validar entradas externas, de acordo com os padrões e a versão instalados no projeto.

A validação deve acontecer antes de utilizar os dados em operações sensíveis.

### 6.6. Banco de dados

Centralize o acesso ao Prisma conforme a estrutura existente. Não crie novas instâncias independentes do Prisma Client sem justificativa técnica.

### 6.7. Utilitários e abstrações

Crie utilitários, classes base, repositories ou abstrações compartilhadas somente quando houver benefício concreto.

Não introduza camadas arquiteturais apenas por preferência ou para antecipar necessidades hipotéticas.

---

## 7. Convenções de nomenclatura e organização

Siga prioritariamente os padrões já existentes no repositório. Se não houver um padrão estabelecido, utilize as convenções abaixo.

### Arquivos

Prefira nomes descritivos em português, com a responsabilidade indicada no nome quando isso ajudar a organização.

Exemplos ilustrativos:

- `usuario.controller.ts`
- `usuario.service.ts`
- `usuario.routes.ts`
- `usuario.schema.ts`
- `autenticacao.service.ts`

Os exemplos não significam que esses arquivos já existam ou que devam ser criados automaticamente.

### Rotas HTTP

Utilize caminhos consistentes, previsíveis e sem acentos.

Não altere endpoints existentes sem autorização quando a alteração puder quebrar clientes ou testes.

### Códigos de erro

Utilize identificadores estáveis, preferencialmente em maiúsculas com palavras separadas por `_`, quando esse for o padrão adotado.

Exemplos:

- `DADOS_INVALIDOS`
- `NAO_AUTENTICADO`
- `ACESSO_NEGADO`
- `RECURSO_NAO_ENCONTRADO`
- `ERRO_INTERNO`

Não introduza identificadores diferentes para representar o mesmo erro sem necessidade.

### Migrations

Utilize nomes em português, descritivos e no padrão de nomenclatura já estabelecido pelo Prisma no projeto.

---

## 8. TypeScript e qualidade do código

O TypeScript deve ajudar a detectar erros antes da execução, e não apenas servir como anotação superficial.

### Regras obrigatórias

- Respeite o modo estrito já configurado.
- Evite `any`.
- Prefira `unknown` quando o tipo de um valor externo não for conhecido e valide-o antes de utilizá-lo.
- Não utilize conversões de tipo para contornar erros sem justificativa.
- Não adicione `@ts-ignore` apenas para fazer a compilação passar.
- Evite o uso indiscriminado do operador `!`.
- Prefira tipos derivados de schemas quando isso reduzir duplicação.
- Defina tipos explícitos nas fronteiras públicas quando isso melhorar a clareza.
- Trate valores opcionais e nulos corretamente.
- Não ignore erros de compilação relacionados à alteração.
- Evite funções excessivamente extensas e responsabilidades misturadas.

### Tratamento assíncrono

- Trate corretamente erros de operações assíncronas.
- Respeite o mecanismo de propagação de erros da versão do Express instalada.
- Não crie tratamentos redundantes que ocultem falhas.
- Não utilize `catch` vazio.
- Não retorne sucesso quando uma operação essencial falhar.

### Express

Consulte os tipos e a versão instalados antes de implementar extensões de `Request`, handlers ou middlewares.

Não contorne incompatibilidades de tipos com casts indiscriminados.

---

## 9. Validação de entradas e dados externos

Toda entrada controlada pelo cliente deve ser considerada não confiável.

Isso inclui:

- Corpo da requisição.
- Parâmetros de rota.
- Query strings.
- Cabeçalhos.
- Cookies.
- Identificadores fornecidos pelo cliente.
- Dados recebidos de integrações externas.

### Regras

1. Valide os dados com o schema apropriado.
2. Rejeite tipos, formatos e valores fora das regras definidas.
3. Normalize dados somente quando isso fizer parte das regras de negócio.
4. Não confie na validação realizada pelo frontend.
5. Não envie dados não validados diretamente ao Prisma.
6. Não utilize dados do cliente para montar operações arbitrárias de banco.
7. Não permita que campos adicionais sejam aceitos silenciosamente quando isso puder alterar comportamento sensível.
8. Defina limites razoáveis de tamanho para textos, listas e payloads.
9. Valide formatos de e-mail, identificadores, datas e números de acordo com os requisitos reais.
10. Não confunda validação de formato com autorização de acesso.

### Mass assignment

Nunca passe diretamente objetos inteiros de `req.body` para operações de criação ou atualização.

Selecione explicitamente os campos permitidos para cada operação.

Campos como `id`, `perfil`, `role`, `senha`, `email` e outros dados sensíveis só podem ser alterados pelos fluxos autorizados e específicos de cada caso.

---

## 10. Segurança de autenticação

A autenticação deve ser implementada de maneira consistente, com atenção à proteção de credenciais, sessões e tokens.

### 10.1. Senhas

- Utilize Argon2id para armazenar hashes de senhas.
- Nunca armazene senhas em texto puro.
- Nunca registre senhas em logs.
- Nunca retorne senhas ou hashes de senhas em respostas da API.
- Nunca inclua senhas em mensagens de erro.
- Não utilize criptografia reversível para substituir o hash de senha.
- Não crie algoritmos próprios de armazenamento de senhas.

Como referência mínima inicial para Argon2id, adote os parâmetros recomendados pela OWASP: memória de 19 MiB, duas iterações e paralelismo 1. Confirme a compatibilidade da biblioteca instalada e revise os parâmetros conforme o ambiente e os requisitos de segurança.

A política de senha deve respeitar os requisitos de produto definidos. Se o requisito atual for exigir entre 8 e 128 caracteres, com letras maiúsculas, minúsculas, números e símbolos, valide todas essas condições no backend.

Não reduza a política de senha sem autorização.

### 10.2. Verificação de credenciais

- Não revele se um e-mail existe durante fluxos nos quais essa informação deva permanecer privada.
- Evite diferenças evidentes de tempo entre a existência e a inexistência de uma conta.
- Quando necessário, utilize um hash fictício válido para executar a verificação de senha no fluxo de usuário inexistente.
- Não substitua a verificação criptográfica por comparações manuais de senha.

### 10.3. JWT

Ao implementar JWT:

- Defina explicitamente o algoritmo permitido.
- Utilize o algoritmo previsto pelo projeto, como HS256 quando essa for a decisão técnica adotada.
- Configure e valide emissor (`issuer`) e audiência (`audience`) quando aplicáveis.
- Defina expiração adequada.
- Utilize `sub` para representar o identificador do usuário, conforme o contrato estabelecido.
- Rejeite tokens com algoritmo não permitido ou assinatura inválida.
- Rejeite tokens expirados.
- Valide as claims necessárias.
- Não confie em tokens apenas decodificados.
- Não aceite o algoritmo `none`.
- Não utilize segredos fracos ou fixos no código.
- Não exponha segredos JWT em respostas, logs ou documentação.

Um token válido não substitui a autorização. Para operações que dependam do estado atual do usuário, consulte a fonte de autoridade apropriada.

Não considere o perfil ou o papel presente no JWT como fonte definitiva de autorização quando o projeto exigir consulta ao banco.

### 10.4. Tokens de atualização e sessões

Quando o projeto utilizar refresh tokens:

- Gere tokens com fonte criptograficamente segura.
- Utilize tokens opacos e imprevisíveis, quando esse for o desenho adotado.
- Armazene somente o hash do token de atualização no banco.
- Considere tokens de 32 bytes aleatórios como referência para geração de tokens opacos.
- Implemente expiração.
- Implemente rotação quando aplicável.
- Invalide o token anterior durante a rotação.
- Detecte reutilização de tokens revogados.
- Ao detectar reutilização, aplique a política de revogação de sessões definida, que pode exigir revogar todas as sessões do usuário.
- Não permita que tokens revogados continuem autenticando requisições.

Utilize SHA-256 para armazenar o hash de tokens aleatórios de alta entropia, quando adequado ao fluxo. Não confunda esse caso com armazenamento de senhas, que exige uma função específica para senhas.

### 10.5. Cookies de autenticação

Se cookies forem utilizados para transportar tokens:

- Utilize `HttpOnly`.
- Utilize `Secure` em produção.
- Defina `SameSite` de acordo com a topologia real de frontend e backend.
- Restrinja o `Path` quando isso for compatível com os endpoints utilizados.
- Evite configurar `Domain` sem necessidade.
- Não exponha tokens em respostas JSON se o contrato exigir cookies HttpOnly.
- Configure corretamente a remoção e a invalidação dos cookies.

Um caminho restrito, como `/autenticacao`, pode ser adequado quando todos os endpoints que necessitam do cookie estão dentro desse caminho. Verifique os endpoints reais antes de adotá-lo.

`SameSite=Lax` pode ser um ponto de partida, mas não deve ser escolhido sem considerar o domínio, o esquema e o fluxo de autenticação efetivos.

### 10.6. CSRF

Quando cookies forem utilizados para autenticação, avalie o risco de CSRF.

- Proteja operações que alterem estado.
- Considere a validação de `Origin`.
- Utilize proteção adicional contra CSRF quando necessária.
- Não trate CORS como substituto de proteção CSRF.
- Não aceite origens arbitrárias em produção.
- Não permita que a ausência de `Origin` seja automaticamente considerada segura em endpoints sensíveis.

A estratégia deve ser compatível com o ambiente real de execução e com os clientes autorizados.

---

## 11. Autorização e controle de acesso

Autenticação responde quem está fazendo a requisição. Autorização determina o que essa pessoa pode fazer.

Nunca trate as duas coisas como equivalentes.

### Regras gerais

- Aplique o princípio do menor privilégio.
- Verifique a autorização no backend.
- Não confie em identificadores ou papéis fornecidos pelo cliente.
- Não permita que usuários comuns se promovam a administradores.
- Não aceite o papel do usuário enviado no cadastro público.
- O cadastro público deve atribuir o perfil comum por padrão.
- A criação ou promoção de administradores deve ocorrer por um processo controlado e autorizado.
- Não exponha dados privados de terceiros.
- Verifique a propriedade do recurso antes de permitir sua leitura ou alteração.
- Não presuma que possuir o ID de um recurso significa ter permissão para acessá-lo.

### Recursos pertencentes a usuários

Quando uma operação envolver recursos privados, a consulta deve considerar o usuário autenticado e a propriedade do recurso.

Sempre que adequado, aplique o filtro de propriedade diretamente na consulta ao banco, reduzindo o risco de acesso indevido.

Se a política de segurança exigir ocultar a existência de recursos privados de terceiros, retorne `404` em vez de revelar sua existência por meio de `403`.

A escolha deve ser consistente com o contrato da API e com os requisitos de segurança do endpoint.

### Alterações de dados sensíveis

Mudanças de senha, e-mail, papel, permissões e outros dados críticos devem seguir fluxos específicos.

Não permita atualizações genéricas desses campos.

---

## 12. Segurança de e-mail, códigos e recuperação de conta

Fluxos de confirmação de e-mail, recuperação de senha e códigos de verificação devem ser tratados como operações sensíveis.

### Regras

- Gere códigos e tokens usando fontes criptograficamente seguras.
- Defina prazo de expiração.
- Permita uso único.
- Invalide códigos após o uso.
- Armazene hashes dos tokens ou códigos quando adequado ao fluxo.
- Limite tentativas de validação.
- Aplique cooldown ou limitação de frequência quando necessário.
- Evite revelar a existência de contas por mensagens de resposta.
- Não registre códigos, tokens ou links de recuperação em logs.
- Não envie segredos em mensagens de erro.
- Não aceite códigos expirados ou já consumidos.
- Não permita que o mesmo código seja utilizado repetidamente.
- Utilize comparação em tempo constante quando aplicável, por exemplo, `timingSafeEqual`, respeitando os requisitos de comprimento e formato da biblioteca.

A implementação deve manter a consistência entre a validação do código, sua expiração e a alteração de estado da conta.

Não envie e-mails reais durante testes automatizados sem autorização explícita e uma configuração específica para isso.

---

## 13. CORS, rate limiting e proteção da API

### CORS

- Configure explicitamente as origens autorizadas.
- Não utilize `*` junto com credenciais.
- Não habilite origens arbitrárias em produção.
- Utilize a configuração de ambiente adequada.
- Não confunda a permissão de CORS com autorização do usuário.

### Rate limiting

Avalie e implemente limites de requisições para endpoints sensíveis, incluindo:

- Login.
- Recuperação de senha.
- Confirmação de e-mail.
- Validação de códigos.
- Renovação de sessão.
- Operações sujeitas a abuso automatizado.

Os limites devem ser compatíveis com o fluxo de uso e com a infraestrutura.

Não implemente limites que possam bloquear usuários legítimos de maneira desproporcional sem analisar o caso.

### Proteção adicional

- Defina limites de tamanho para requisições.
- Evite exposição desnecessária de detalhes internos.
- Não confie em cabeçalhos fornecidos pelo cliente sem configuração apropriada.
- Não exponha stack traces em produção.
- Não desative controles de segurança para facilitar testes.

---

## 14. Variáveis de ambiente e segredos

Segredos e configurações sensíveis devem permanecer fora do código-fonte.

### Regras obrigatórias

- Não coloque senhas, tokens, chaves privadas ou segredos JWT no código.
- Não exponha valores reais de variáveis de ambiente.
- Não copie valores de `.env` para respostas, documentação ou logs.
- Não imprima o conteúdo completo de arquivos `.env`.
- Não inclua segredos em commits.
- Utilize `.env.example` com valores fictícios ou placeholders.
- Valide as variáveis obrigatórias durante a inicialização.
- Informe claramente quais variáveis estão ausentes, sem revelar seus valores.
- Não altere arquivos `.env` reais sem autorização.

O agente pode verificar se uma variável necessária está configurada sem revelar seu conteúdo.

Se uma credencial for exposta acidentalmente, não a reproduza. Informe o risco e recomende sua rotação pelo responsável pelo ambiente.

---

## 15. Prisma e integridade do banco de dados

O banco de dados contém estado persistente e deve ser tratado com cuidado.

### 15.1. Acesso ao Prisma

- Utilize a instância compartilhada definida pelo projeto.
- Não crie múltiplas instâncias sem necessidade.
- Evite duplicar consultas.
- Utilize tipos gerados pelo Prisma.
- Não utilize SQL bruto quando uma operação tipada e segura for suficiente.
- Quando SQL bruto for necessário, utilize consultas parametrizadas.
- Não concatene dados externos em SQL.
- Não retorne objetos Prisma diretamente para o cliente sem selecionar e transformar os campos adequados.

### 15.2. Transações

Utilize transações quando uma operação envolver múltiplas alterações que precisam ser confirmadas ou revertidas em conjunto.

Exemplos incluem:

- Alterar o estado de uma conta e consumir um código de confirmação.
- Rotacionar um refresh token e invalidar o anterior.
- Atualizar entidades relacionadas cuja consistência dependa de todas as operações.

Não introduza transações desnecessárias em operações simples.

### 15.3. Migrations

Toda alteração de schema deve considerar os dados já existentes.

O fluxo recomendado é:

1. Inspecionar o schema atual.
2. Identificar tabelas, campos, índices e relações afetados.
3. Avaliar compatibilidade com os dados existentes.
4. Preparar a alteração de schema.
5. Gerar a migration sem aplicá-la automaticamente.
6. Inspecionar o SQL gerado.
7. Identificar operações destrutivas ou potencialmente incompatíveis.
8. Solicitar autorização quando houver risco.
9. Aplicar a migration somente conforme o fluxo autorizado.
10. Gerar ou atualizar o Prisma Client conforme necessário.
11. Executar testes relevantes.

Em projetos compatíveis, um comando de referência para criar a migration sem aplicá-la é:

`npx prisma migrate dev --create-only --name <nome_em_portugues>`

Antes de executar o comando, confirme a versão instalada do Prisma, os scripts do projeto e a configuração utilizada. Se houver um arquivo de configuração específico, utilize os parâmetros exigidos pela versão instalada.

### 15.4. Alterações destrutivas

Não execute migrations que possam apagar dados ou tornar dados inacessíveis sem autorização explícita.

Tenha cuidado especial com:

- Remoção de colunas.
- Renomeação de colunas.
- Alteração de tipos.
- Alteração de campos opcionais para obrigatórios.
- Remoção de tabelas.
- Alteração de chaves e relações.
- Mudanças em valores únicos.
- Mudanças de enum.

Quando houver dados existentes, considere estratégias de migração em etapas.

Para adicionar um campo obrigatório a uma tabela preenchida, avalie um valor padrão, uma etapa de preenchimento dos dados ou uma fase temporária de nulabilidade, conforme as regras de negócio.

Nunca utilize comandos de reset do banco como solução automática para problemas de migration.

### 15.5. Erros do Prisma

Mapeie erros conhecidos para respostas HTTP coerentes.

Por exemplo, uma violação de unicidade, como `P2002`, normalmente deve resultar em conflito (`409`), conforme o contexto da operação.

Não exponha detalhes internos da consulta, schema ou banco na resposta ao cliente.

---

## 16. Tratamento de erros e respostas HTTP

A API deve apresentar respostas consistentes, previsíveis e seguras.

### Formato de erro

Quando compatível com o contrato já existente, utilize o formato:

```json
{
  "erro": {
    "codigo": "DADOS_INVALIDOS",
    "mensagem": "Os dados enviados são inválidos.",
    "detalhes": []
  }
}
```

O campo `detalhes` pode conter informações de validação apropriadas, desde que não exponha dados sensíveis.

Não altere um contrato de resposta existente sem considerar os clientes que dependem dele.

### Status HTTP

Utilize os códigos adequados ao resultado da operação. Exemplos:

- `200` para sucesso com resposta.
- `201` para criação bem-sucedida.
- `204` para sucesso sem conteúdo.
- `400` para requisição inválida.
- `401` para ausência de autenticação válida.
- `403` para acesso proibido, quando a existência do recurso puder ser revelada.
- `404` para recurso não encontrado ou cuja existência deva ser ocultada.
- `409` para conflitos.
- `422` para dados semanticamente inválidos, se esse for o padrão adotado.
- `429` para limite de requisições excedido.
- `500` para falhas internas inesperadas.

Não use `200` para comunicar erros de negócio.

### Erros internos

- Retorne mensagens genéricas em erros inesperados.
- Registre os detalhes técnicos apenas no ambiente interno.
- Não exponha stack traces em produção.
- Não revele SQL, credenciais, caminhos internos ou detalhes sensíveis.
- Preserve o erro original para diagnóstico interno quando apropriado.
- Não transforme toda exceção em uma resposta de sucesso.
- Não silencie falhas de operações essenciais.

O tratamento de erros deve estar centralizado conforme a arquitetura existente.

---

## 17. Logs e observabilidade

Os logs devem facilitar o diagnóstico sem comprometer a segurança.

### Nunca registre

- Senhas.
- Tokens de acesso ou de atualização.
- Códigos de confirmação.
- Links de recuperação de senha.
- Segredos JWT.
- Credenciais de banco de dados.
- Cabeçalhos de autorização completos.
- Cookies completos.
- Corpos de requisição que possam conter informações sensíveis.

Registre somente as informações necessárias para diagnosticar falhas, acompanhar operações e monitorar o comportamento do sistema.

Evite logs excessivos, duplicados ou sem contexto.

Em produção, prefira registrar identificadores de correlação e informações técnicas não sensíveis.

---

## 18. DTOs e proteção de dados nas respostas

As respostas da API devem expor somente os dados necessários para o cliente.

### Regras

- Não retorne objetos Prisma diretamente de maneira indiscriminada.
- Selecione explicitamente os campos necessários.
- Utilize DTOs ou funções de transformação quando apropriado.
- Exclua hashes de senhas e tokens.
- Exclua segredos e dados internos.
- Não exponha informações privadas de outros usuários.
- Não retorne campos internos apenas porque estão disponíveis no banco.
- Mantenha consistência no formato das respostas.

A existência de um campo no modelo do banco não significa que ele deva ser público.

---

## 19. Testes e verificação de comportamento

Testes fazem parte da implementação, não são uma etapa opcional de acabamento.

A estratégia deve respeitar as ferramentas já configuradas no projeto.

### 19.1. Testes automatizados

Se Vitest, Supertest ou ferramentas equivalentes estiverem instaladas e configuradas, utilize-as conforme os padrões existentes.

Crie ou atualize testes para cobrir:

- Caminho de sucesso.
- Dados inválidos.
- Ausência de autenticação.
- Falta de autorização.
- Recursos inexistentes.
- Conflitos de negócio.
- Erros inesperados relevantes.
- Casos de borda.
- Regressões relacionadas à alteração.

Não instale ferramentas automaticamente se elas não estiverem configuradas.

### 19.2. Banco de testes

- Utilize um banco de dados específico para testes de integração.
- Nunca execute testes destrutivos em um banco de produção.
- Não utilize dados reais sem autorização.
- Não execute resets indiscriminados em ambientes compartilhados.
- Não deixe os testes dependentes de uma ordem implícita de execução.
- Limpe apenas os dados que o próprio teste criou e que pode remover com segurança.

### 19.3. E-mails em testes

Utilize mocks, Mailpit, Ethereal ou outra ferramenta de teste configurada.

Não dispare e-mails reais em testes automatizados sem autorização e sem uma configuração explícita.

Não registre tokens ou links de recuperação em logs de teste compartilhados.

### 19.4. Testes manuais com Insomnia

Quando o endpoint exigir teste manual, forneça ou atualize as informações necessárias para reproduzir a requisição:

- Método HTTP.
- URL ou caminho.
- Cabeçalhos.
- Corpo da requisição.
- Cookies ou autenticação necessários.
- Resultado esperado.
- Status HTTP esperado.
- Casos de erro relevantes.

Não afirme que um teste manual foi executado se apenas forneceu as instruções para executá-lo.

### 19.5. Casos de segurança obrigatórios

Sempre que houver alteração relacionada a cadastro público, autorização ou autenticação, considere os testes correspondentes.

No cadastro público, deve existir um teste que confirme que um cliente não consegue criar uma conta com perfil de administrador enviando um campo como `role: "ADMIN"` ou equivalente.

Também devem ser verificados, conforme o escopo:

- Token inválido ou expirado.
- Tentativa de acessar recurso de outro usuário.
- Refresh token revogado.
- Código expirado ou já utilizado.
- Entrada inválida.
- Resposta sem dados sensíveis.

### 19.6. Relato dos resultados

Diferencie claramente:

- Teste executado e aprovado.
- Teste executado e reprovado.
- Teste não executado.
- Teste bloqueado por falta de dependência, serviço ou configuração.

A compilação bem-sucedida não prova que a regra de negócio está correta.

---

## 20. Dependências e mudanças de configuração

Dependências externas aumentam a superfície de manutenção e de risco do projeto.

Antes de propor uma nova dependência:

1. Verifique se a funcionalidade já existe no projeto.
2. Avalie se a biblioteca instalada já resolve o problema.
3. Considere manutenção, compatibilidade e impacto no tamanho do projeto.
4. Explique a necessidade da dependência.
5. Solicite autorização antes de instalá-la ou alterar suas versões.

Não atualize indiscriminadamente o `package.json` ou o arquivo de lock.

Não substitua bibliotecas apenas por preferência pessoal.

Não altere scripts existentes sem avaliar como são utilizados.

---

## 21. Compatibilidade e prevenção de regressões

Toda mudança deve considerar os fluxos que já funcionam.

Antes de alterar uma função compartilhada, middleware, schema, contrato de resposta ou configuração:

- Identifique os consumidores afetados.
- Verifique os testes existentes.
- Avalie efeitos em outros endpoints.
- Preserve contratos públicos, salvo quando a mudança fizer parte da tarefa.
- Evite alterar assinaturas públicas sem necessidade.
- Atualize testes e documentação afetados.

Não corrija um problema introduzindo outro silenciosamente.

Se uma mudança necessária for incompatível, informe os efeitos e solicite confirmação quando estiver fora do escopo autorizado.

---

## 22. Documentação e arquivos de referência

A documentação deve refletir o estado real do código.

### AGENTS.md

Este documento contém as regras permanentes de trabalho dos agentes.

Ele não deve ser utilizado como registro detalhado de cada tarefa executada.

### ARCHITECTURE.md

Quando existir, deve documentar a arquitetura efetivamente adotada, as responsabilidades das camadas, os fluxos relevantes e as decisões arquiteturais.

Não invente uma arquitetura implementada apenas para preencher a documentação.

### TASKS.md

Quando existir, deve organizar tarefas, prioridades, pendências e progresso.

Não declare tarefas concluídas sem evidência.

### Outras regras

- Não mantenha instruções contraditórias em documentos diferentes.
- Quando encontrar divergências, identifique o conflito antes de escolher uma interpretação com impacto relevante.
- Atualize documentação afetada por mudanças de comportamento.
- Não documente como existente algo que ainda é apenas uma proposta.
- Não duplique grandes trechos de documentação sem necessidade.

---

## 23. Conduta diante de ambiguidades

O agente deve saber quando prosseguir e quando pedir esclarecimento.

### Pode prosseguir quando

- O objetivo estiver claro.
- A mudança for localizada e reversível.
- Os padrões existentes fornecerem uma solução consistente.
- Não houver impacto relevante em dados, segurança ou contratos.
- A implementação não exigir uma decisão de produto não especificada.

### Deve pedir esclarecimento quando

- Houver interpretações incompatíveis do requisito.
- A decisão alterar significativamente o comportamento público da API.
- Uma mudança exigir remoção ou transformação potencialmente destrutiva de dados.
- For necessário escolher uma política de segurança que não esteja definida.
- O escopo estiver indefinido e a implementação puder crescer consideravelmente.
- A solução exigir uma dependência ou alteração estrutural não autorizada.
- A decisão não puder ser tomada com segurança a partir do código e da documentação disponíveis.

### Como apresentar alternativas

Quando houver mais de uma solução válida, explique brevemente:

- A alternativa recomendada do ponto de vista técnico.
- As principais vantagens e desvantagens.
- O impacto sobre segurança, manutenção e compatibilidade.
- A decisão que precisa ser tomada pelo responsável pelo projeto.

Não faça perguntas desnecessárias quando o próprio projeto já fornecer a resposta.

---

## 24. Regras para comandos e execução no ambiente

Antes de executar comandos, avalie seu efeito.

### Comandos de inspeção

Comandos que apenas listam arquivos, exibem configurações não sensíveis ou verificam o estado do projeto podem ser utilizados conforme necessário.

Mesmo em comandos de inspeção, evite exibir segredos ou conteúdo sensível.

### Comandos de instalação e execução

Antes de executar scripts desconhecidos, examine o comando e seu propósito.

Considere que scripts de instalação e comandos do projeto podem modificar arquivos ou acessar serviços externos.

### Banco de dados

Nunca execute comandos destrutivos contra um banco sem identificar o ambiente e obter a autorização necessária.

Não presuma que a configuração atual aponta para um banco de teste.

### Serviços externos

Não realize operações reais de envio de e-mail, cobrança, publicação ou alteração de dados externos sem autorização quando elas puderem afetar usuários ou recursos reais.

### Falhas de comando

Se um comando falhar:

1. Leia o erro.
2. Identifique a causa provável.
3. Verifique a configuração relevante.
4. Corrija apenas o necessário.
5. Evite repetir comandos destrutivos ou executar tentativas indiscriminadas.

Não oculte falhas de execução.

---

## 25. Critérios de conclusão de uma tarefa

Uma tarefa só deve ser considerada concluída quando:

- O requisito solicitado estiver implementado.
- A alteração estiver dentro do escopo autorizado.
- As regras de segurança relevantes tiverem sido consideradas.
- Os tipos e contratos estiverem consistentes.
- Os testes relevantes tiverem sido executados, ou suas limitações estiverem documentadas.
- Não houver erros conhecidos introduzidos pela alteração que tenham sido ignorados.
- A documentação necessária tiver sido atualizada.
- O resultado final tiver sido comunicado com clareza.

Se algum critério não puder ser atendido, informe a pendência explicitamente.

Não declare sucesso apenas porque o código parece correto.

---

## 26. Formato da resposta final do agente

Ao finalizar uma tarefa de implementação, utilize um relatório objetivo.

### Implementado

Descreva as mudanças realizadas e o comportamento resultante.

### Arquivos alterados

Liste os arquivos criados, modificados ou removidos.

### Validação

Informe os comandos e testes executados, com seus resultados.

### Pendências e riscos

Informe falhas, testes não executados, configurações ausentes, dúvidas e decisões ainda necessárias.

Não inclua seções vazias apenas para preencher o relatório.

Não afirme que alterou arquivos, executou comandos ou validou comportamentos que não foram efetivamente realizados.

---

## 27. Princípios finais

Todos os agentes devem seguir estes princípios:

1. **Segurança antes da conveniência.**
2. **Inspeção antes da alteração.**
3. **Evidências antes de afirmações.**
4. **Autorização antes de operações de risco.**
5. **Validação antes do uso de dados externos.**
6. **Separação de responsabilidades antes de concentrar lógica.**
7. **Mudanças pequenas antes de refatorações amplas.**
8. **Integridade dos dados antes da facilidade de desenvolvimento.**
9. **Testes antes de declarar conclusão.**
10. **Transparência sobre limitações e falhas.**

O agente deve atuar como um engenheiro responsável pela manutenção de um backend real: compreender o contexto, preservar o que funciona, implementar somente o necessário, proteger os dados e comunicar com precisão o que foi realizado.

**Estas regras devem ser seguidas em todas as tarefas executadas no Sonessia API.**
