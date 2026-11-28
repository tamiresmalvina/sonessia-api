# Cabeçalhos de segurança HTTP

A API aplica Helmet às respostas. CSP fica desativada nesta aplicação porque ela
serve JSON e imagens, não documentos HTML com scripts ou estilos. A política de
conteúdo deve ser definida no host do frontend, que controla os documentos HTML.
COEP e CORP também ficam desativados para evitar restrições em chamadas e recursos
cross-origin; o CORS da API continua autorizando somente a origem configurada.

HSTS é enviado somente quando `NODE_ENV=production`, com validade de 180 dias.
Não inclui subdomínios nem solicita preload. No Render, TLS termina no proxy e o
navegador recebe a resposta HTTPS; o backend mantém `trust proxy` desativado.
Confirme no deploy que o domínio público da API é servido exclusivamente por HTTPS.
