# TASKS.md — Sonessia API

> Checklist de implementação baseado nas User Stories do projeto. Marque `[x]` somente quando a tarefa estiver implementada e verificada. As tarefas de autenticação, cadastro e alteração de dados do usuário foram consideradas concluídas conforme informado pelo responsável pelo projeto; confirme os testes existentes antes de marcar subtarefas específicas como verificadas.

## Regras de acompanhamento

- [ ] Ao concluir uma tarefa, marque sua caixa como `[x]`.
- [ ] Não marque uma tarefa como concluída apenas porque parte dela existe; verifique implementação e testes.
- [ ] Atualize este arquivo conforme o escopo evoluir.
- [ ] As User Stories US10, US11 e US12 estão classificadas como **Won’t Have** e foram integralmente omitidas deste checklist.
- [ ] A implementação de testes, ferramentas e infraestrutura deve respeitar o que já está configurado no repositório; não adicionar dependências sem aprovação explícita.

## Estado inicial conhecido

- [x] Cadastro de usuário (implementação informada como concluída; validar testes).
- [x] Autenticação de usuário (implementação informada como concluída; validar testes).
- [x] Alteração de dados do usuário (implementação informada como concluída; validar testes).

---

## US01 — Gerenciar áudios do catálogo

**Prioridade:** Must Have

- [x] Definir/modelar os dados do áudio (titulo, tituloOriginal, categoria e demais campos necessários).
- [x] Validar os dados recebidos ao cadastrar um áudio.
- [x] Implementar cadastro de áudio para administrador autorizado.
- [x] Implementar consulta/listagem de áudios cadastrados.
- [ ] Organizar/filtrar os áudios por categoria.
- [x] Implementar consulta dos detalhes de um áudio, incluindo sua categoria.
- [x] Implementar edição dos dados de um áudio existente.
- [ ] Implementar desativação/remoção de áudio, distinguindo os efeitos de cada ação.
- [ ] Garantir que áudios removidos ou desativados não sejam oferecidos no catálogo público.
- [x] Proteger operações administrativas por autenticação e autorização.
- [x] Testar validação, permissões, cadastro, listagem, edição e remoção de áudio.

## US02 — Criar e disponibilizar ambientes sonoros pré-configurados

**Prioridade:** Should Have

- [x] Definir/modelar ambiente sonoro pré-configurado (nome, descrição, finalidade e estado de disponibilidade).
- [x] Definir/modelar a relação entre ambiente e os áudios que o compõem.
- [x] Permitir selecionar e adicionar áudios à composição de um ambiente.
- [x] Permitir configurar o volume individual de cada áudio da composição.
- [x] Validar os dados e a composição informados ao criar um ambiente.
- [x] Associar o ambiente a uma finalidade disponível.
- [x] Implementar criação e edição de ambientes pré-configurados.
- [x] Implementar disponibilização/publicação e impedir que ambientes não publicados apareçam para usuários.
- [x] Listar ambientes publicados por finalidade.
- [x] Retornar a composição e os volumes configurados para reprodução.
- [x] Proteger gerenciamento de ambientes para administradores autorizados.
- [x] Testar composição, volumes individuais, finalidade, publicação e acesso público.

## US03 — Consultar catálogo gratuito de áudios

**Prioridade:** Must Have

- [x] Disponibilizar endpoint público para consultar os áudios disponíveis gratuitamente.
- [ ] Retornar categorias dos áudios no catálogo.
- [ ] Incluir a categoria nos dados de cada áudio retornado.
- [ ] Garantir que somente áudios ativos e disponíveis sejam listados.
- [ ] Permitir obter os dados necessários para selecionar um áudio para uma composição.
- [ ] Testar catálogo público, categorias e exclusão de áudios indisponíveis.

## US04 — Combinar sons e controlar suas reproduções

**Prioridade:** Must Have

- [ ] Definir o formato de uma composição sonora temporária, sem exigir persistência.
- [ ] Permitir que o cliente envie/monte uma composição com dois ou mais áudios.
- [ ] Representar o volume individual de cada áudio na composição.
- [ ] Validar que os áudios selecionados existem e estão disponíveis.
- [ ] Permitir adicionar e remover áudios individualmente da composição no fluxo suportado pela API.
- [ ] Fornecer os dados necessários para que o cliente reproduza os sons simultaneamente e de forma contínua.
- [ ] Permitir utilizar uma composição sem salvá-la.
- [ ] Testar composição com múltiplos sons, volumes e áudios inválidos/indisponíveis.

> Observação: a reprodução simultânea, contínua e os controles em tempo real normalmente pertencem ao cliente (frontend/player). A API deve fornecer os metadados, URLs/fontes autorizadas e configurações necessárias; confirmar a divisão de responsabilidades na arquitetura.

## US05 — Criar conta e salvar ambientes sonoros personalizados

**Prioridade:** Must Have

- [x] Implementar cadastro de usuário (informado como concluído).
- [x] Validar os dados de cadastro (parte da funcionalidade de cadastro; confirmar cobertura de testes).
- [x] Disponibilizar perfil após cadastro/autenticação (confirmar endpoint de consulta de perfil).
- [x] Definir/modelar ambientes sonoros personalizados salvos pelo usuário.
- [x] Implementar salvamento de uma composição com nome escolhido pelo usuário.
- [x] Associar cada ambiente salvo ao usuário autenticado.
- [x] Implementar listagem dos ambientes salvos pelo usuário autenticado.
- [x] Implementar consulta de um ambiente salvo pertencente ao usuário.
- [x] Garantir que um usuário não consiga consultar ou alterar ambientes salvos de outro usuário.
- [x] Testar salvar, listar, consultar e isolamento entre usuários.

## US06 — Organizar ambientes salvos em coleções

**Prioridade:** Should Have

- [ ] Definir/modelar coleções pertencentes a um usuário.
- [ ] Permitir criar coleção com nome.
- [ ] Permitir adicionar ambientes salvos a uma coleção.
- [ ] Implementar consulta de uma coleção com seus ambientes associados.
- [ ] Permitir remover um ambiente da coleção sem excluir o ambiente salvo.
- [ ] Disponibilizar listagem geral dos ambientes salvos, inclusive os que não pertencem a coleção.
- [ ] Permitir acessar individualmente os ambientes associados a uma coleção.
- [ ] Garantir isolamento das coleções e ambientes por usuário.
- [ ] Testar criação, associação, remoção da coleção sem exclusão e ambientes sem coleção.

## US07 — Configurar temporizador e pausas entre sessões

**Prioridade:** Should Have

- [ ] Definir o contrato da API para duração da sessão, pausa opcional e comportamento ao terminar.
- [ ] Definir se o temporizador será controlado pelo cliente ou pelo servidor e documentar essa decisão.
- [ ] Se houver estado no servidor, implementar criação/configuração de temporizador por usuário/sessão.
- [ ] Se houver estado no servidor, retornar o tempo restante da sessão ou pausa.
- [ ] Implementar cancelamento do temporizador caso seja responsabilidade da API.
- [ ] Testar limites de duração, pausa, término e cancelamento, conforme a arquitetura definida.

> Observação: contagem regressiva e interrupção efetiva do áudio costumam ser responsabilidade do frontend/player. Evite implementar um temporizador no backend sem definir antes se o servidor realmente precisa manter esse estado.

## US08 — Consultar ambientes prontos por finalidade

**Prioridade:** Should Have

- [x] Disponibilizar consulta pública de finalidades disponíveis.
- [x] Disponibilizar listagem de ambientes publicados agrupados/filtráveis por finalidade.
- [x] Permitir consultar ambientes de uma finalidade específica.
- [x] Retornar detalhes básicos do ambiente (nome, descrição e sons componentes).
- [x] Retornar os volumes configurados para cada áudio do ambiente.
- [x] Garantir que ambientes não publicados ou indisponíveis não apareçam na consulta pública.
- [x] Testar consulta por finalidade, detalhes e composição do ambiente.

## US09 — Alternar tema claro/escuro

**Prioridade:** Could Have

- [ ] Confirmar se a preferência de tema será gerenciada pelo frontend ou persistida pela API.
- [ ] Se for responsabilidade da API, definir/modelar preferência de tema do usuário.
- [ ] Se for responsabilidade da API, implementar leitura e atualização da preferência de tema.
- [ ] Garantir que a atualização da preferência não altere estado de reprodução de áudio.
- [ ] Testar persistência da preferência, se aplicável.

> Observação: tema visual e sua aplicação à interface são normalmente responsabilidade do frontend. A API só precisa participar se houver requisito explícito de persistir a preferência entre dispositivos/sessões.

## US13 — Compartilhar ambientes sonoros salvos

**Prioridade:** Could Have

- [ ] Definir o modelo de compartilhamento e as regras de acesso ao ambiente compartilhado.
- [ ] Definir como será gerado um link ou identificador de acesso compartilhável.
- [ ] Implementar geração/ativação de compartilhamento para um ambiente salvo.
- [ ] Implementar acesso público ou controlado ao ambiente compartilhado, conforme as regras definidas.
- [ ] Retornar detalhes do ambiente compartilhado e sua composição.
- [ ] Permitir reproduzir o ambiente compartilhado usando os sons e volumes originais.
- [ ] Validar que somente o proprietário pode criar ou alterar o compartilhamento.
- [ ] Testar geração de link, acesso de terceiros e permissões do proprietário.

## US14 — Usar recursos básicos sem criar conta

**Prioridade:** Must Have

- [ ] Permitir consulta pública do catálogo sem autenticação.
- [ ] Permitir obter os dados necessários para montar uma composição sem autenticação.
- [ ] Garantir que operações de leitura pública não exijam token JWT.
- [x] Permitir consultar ambientes pré-configurados publicados sem autenticação.
- [x] Garantir que os dados necessários à reprodução de ambientes públicos estejam acessíveis sem autenticação.
- [ ] Exigir autenticação para salvar uma composição no perfil.
- [ ] Exigir autenticação para criar coleções e usar outras funcionalidades de armazenamento pessoal.
- [ ] Retornar resposta de autenticação clara e consistente ao tentar salvar sem estar autenticado.
- [ ] Testar os fluxos públicos e confirmar que operações pessoais continuam protegidas.

---

## Revisão de incongruências e decisões pendentes

- [ ] **US01 — “remover ou desativar”:** definir se remoção significa exclusão física ou lógica. A história indica efeitos distintos (“conforme a ação realizada”), então os critérios devem esclarecer a diferença.
- [ ] **US02 e US08 — ambientes pré-configurados:** US02 descreve a administração/publicação e US08 a descoberta por finalidade; são complementares, mas convém padronizar o termo “finalidade” e definir se ela é uma entidade cadastrável ou uma lista fixa.
- [ ] **US03 e US01 — categorias:** US03 cita exemplos de categorias, mas “e outros ambientes sonoros cadastrados” deixa a lista aberta. Definir se categorias são fixas ou administráveis.
- [ ] **US04 — reprodução na API:** reprodução simultânea, contínua, ajuste de volume em tempo real e remoção durante a execução são principalmente comportamentos do frontend/player. Definir quais contratos a API precisa fornecer, em vez de atribuir toda a reprodução ao backend.
- [ ] **US05 — cadastro versus salvar ambientes:** US05 combina criação de conta com salvamento/consulta de ambientes. Como cadastro/autenticação já foram implementados, separar a parte de gestão dos ambientes em tarefas próprias evita tratar a US inteira como concluída.
- [ ] **US07 — temporizador:** não está claro se o temporizador deve continuar funcionando com a aba fechada, em vários dispositivos ou apenas durante a reprodução no cliente. Essa decisão determina se o backend precisa armazenar/gerenciar sessões.
- [ ] **US09 — tema claro/escuro:** alternância e aplicação visual são responsabilidades típicas do frontend; decidir se a API precisa persistir a preferência do usuário.
- [ ] **US13 — compartilhamento:** definir se o link é público, revogável, expira ou exige autenticação, e o que acontece se o proprietário editar ou excluir o ambiente.
- [ ] **US14 — usuário anônimo:** explicitar se composições anônimas precisam sobreviver a atualização de página/dispositivo. A história só exige uso sem conta e solicitação de autenticação ao salvar.

## Fora do escopo deste arquivo

As histórias abaixo foram classificadas como **Won’t Have** e foram completamente ignoradas, conforme solicitado:

- US10 — Área comunitária, curtidas e favoritos de combinações compartilhadas.
- US11 — Download e uso offline de áudios/combinações.
- US12 — Reprodução individual de músicas fora de ambientes sonoros.
