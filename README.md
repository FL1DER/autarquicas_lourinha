
Aplicação web para acompanhar resultados autárquicos.

Inclui frontend (HTML/CSS/JS) e servidor Node.js com APIs e backoffice.

--------------------------------------------------

REQUISITOS

\- Node.js v18 ou superior

\- npm

--------------------------------------------------

COMO INICIAR

1\. Instalar dependências:
	npm install

2\. Iniciar o servidor:
	npm start

3\. Abrir no navegador:
	http://localhost:3000 e http://localhost:3000/backoffice

--------------------------------------------------

ENDPOINTS

 /                 → página principal
 /api/snapshot     → último estado de resultados
 /api/stream       → atualizações em tempo real (SSE)
 /backoffice       → painel de gestão local
 /api/freguesias   → dados de freguesias
 /api/mesas        → dados de mesas de voto
 /api/resultados   → resultados detalhados
