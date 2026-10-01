# Football app

Fluxo: país > liga (todas as divisões que a API tiver) > time > próximo jogo real,
com probabilidades de vitória, gols, ambas marcam, placares, escanteios e últimos 5 jogos.

## Correr no computador
1. `npm install`
2. Copiar `.env.example` para `.env` e colocar a chave da API-Football
3. `npm run dev` e abrir http://localhost:3000

## Publicar no Render (acesso pelo telemóvel)
1. Criar uma conta no GitHub e um repositório novo (privado). Enviar esta pasta.
   O `.gitignore` já impede o envio do `.env`.
2. Em render.com: **New > Blueprint**, escolher o repositório. Ele lê o `render.yaml`.
3. Quando pedir `API_FOOTBALL_KEY`, colar a chave (fica só no Render).
4. Aguardar o deploy. O endereço `https://football-app-xxxx.onrender.com` abre o app.

No Railway é parecido: **New Project > Deploy from GitHub**, e em Variables
adicionar `API_FOOTBALL_KEY`. O comando de arranque é `npm start`.

## Notas
- Requer Node 20 ou superior.
- No plano gratuito do Render o serviço adormece após alguns minutos sem uso;
  o primeiro acesso depois disso demora cerca de um minuto.
- Planos gratuitos da API-Football podem não permitir a temporada 2026 nem o
  parâmetro `next`. Se aparecer erro de plano, ele é mostrado no ecrã.
- Cada análise usa vários pedidos da API (previsão, últimos jogos, escanteios).
  Há cache em memória. Para poupar quota use `/api/match/ID?corners=0`.
- Nunca ponha a chave no código nem no GitHub.
