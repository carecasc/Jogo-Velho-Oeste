# Duelo no Velho Oeste

Estande de tiro de faroeste **online para 2 a 8 jogadores**, cada um no seu aparelho. É feito com HTML, CSS e JavaScript puro, e o servidor é Node.js sem nenhuma dependência.

## Como rodar

Você precisa do [Node.js](https://nodejs.org) 18 ou mais novo.

```bash
npm start          # ou: node server.js
```

Depois abra **http://localhost:3000**. Abrir o `index.html` direto (duplo clique) não funciona, porque o jogo precisa do servidor.

### Jogando com outras pessoas

- **Mesma rede Wi-Fi:** descubra o IP do computador que roda o servidor (ex.: `192.168.0.10`). Os outros abrem `http://192.168.0.10:3000` no celular ou no PC.
- **Pela internet:** publique a pasta em qualquer serviço que rode Node.js (Render, Railway, Fly.io etc.) com o comando `npm start`. O servidor usa a porta da variável `PORT`. Para um teste rápido, um túnel como `cloudflared tunnel --url http://localhost:3000` ou `ngrok http 3000` também serve.

Quem cria a sala recebe um **código de 4 letras** e um link para compartilhar. Quem abre o link já entra com o código preenchido.

## Regras

1. Cada jogador escolhe um pistoleiro entre 8. A diferença é só visual.
2. Todos começam com **5 de vida** (as lâmpadas do placar).
3. A cada rodada os vivos são sorteados em **duelos 1 contra 1**. O rodízio evita repetir o adversário das últimas rodadas.
4. Cada barraca tem **6 posições**: esquerda ou direita, em cima, no meio ou embaixo.
5. Em segredo, cada um escolhe **onde aparecer** na própria barraca e **onde atirar** na barraca do rival. É **1 disparo**, que tira **1 de vida** se acertar onde o rival apareceu. Os dois podem se acertar na mesma rodada.
6. Há **30 segundos** para escolher. O que ficar sem escolha é sorteado.
7. Com número ímpar de vivos, um jogador enfrenta um **fantasma** (o último eliminado). O fantasma atira, mas não perde vida.
8. Quem chega a 0 é eliminado. Quem cai na mesma rodada divide a colocação. O último de pé vence; se todos os restantes caírem juntos, é empate.

Quem recarrega a página ou perde a conexão volta para a mesma sala automaticamente. Quem clica em "Sair" no meio da partida é eliminado.

## Arquivos

- `index.html`: telas (início, saguão, partida, fim de jogo).
- `style.css`: visual de estande de tiro de quermesse (letreiros com lâmpadas, toldo listrado, alvos de madeira) e layout responsivo.
- `game.js`: cliente: conexão com o servidor, placar, escolha secreta, animação da revelação, sons (Web Audio API) e retratos em SVG.
- `server.js`: servidor: arquivos estáticos, WebSocket próprio, salas, pareamento em rodízio, resolução dos tiros e eliminações.
