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
4. Cada pistoleiro se esconde atrás de uma parede, com **6 posições**: lado esquerdo ou direito, em cima, no meio ou embaixo.
5. Na tela do duelo, seu pistoleiro aparece encostado na sua parede (em primeiro plano) e a parede do rival fica ao fundo. Em segredo, você escolhe **primeiro onde aparecer** e **depois onde o tiro vai chegar**. Cada tiro que acerta tira vida do rival.
6. Há **30 segundos** por rodada. Quem não escolher a tempo aparece em **Em cima · Esquerda** e atira em **Em cima · Esquerda**.
7. A **1ª rodada** é só com 1 tiro para todo mundo.
8. Da **2ª rodada em diante**, cada jogador recebe **1 de ouro**, mais **1 de ouro por acerto** na rodada anterior. O ouro **não acumula**: o que sobrar se perde.
9. Antes do duelo, a **Mesa de Pôquer** aparece por cima do jogo com 3 cartas, e é obrigatório comprar **pelo menos uma**. Se o tempo acabar sem compra, o jogo compra o Valete.

   | Carta | Custo | Efeito | Duração |
   |-------|-------|--------|---------|
   | **K♥** Rei de Copas | 1 | +1 de dano nos seus tiros | só nesta rodada |
   | **J♦** Valete de Ouros | 1 | 1 tiro extra | só nesta rodada |
   | **A♠** Ás de Espadas | 3 | +1 de dano nos seus tiros | permanente (acumula) |

10. Com tiro extra, você escolhe o **1º e o 2º tiro**, que podem ir no **mesmo lugar**. Os tiros saem em ordem: primeiro os dois 1º tiros juntos, depois os 2º. Quem morre no 1º disparo não faz o 2º. Para juntar 3 de ouro e comprar o Ás, é preciso acertar os 2 tiros.
11. Com número ímpar de vivos, um jogador enfrenta um **fantasma** (o último eliminado). O fantasma dá 1 tiro ao acaso e não perde vida.
12. Quem chega a 0 é eliminado. Quem cai na mesma rodada divide a colocação. O último de pé vence; se todos os restantes caírem juntos, é empate.

Quem recarrega a página ou perde a conexão volta para a mesma sala automaticamente. Quem clica em "Sair" no meio da partida é eliminado.

## Arquivos

- `index.html`: telas (início, saguão, partida, fim de jogo).
- `style.css`: visual de fliperama (letreiros com lâmpadas), cena do duelo em rua de faroeste estilo quadrinhos e layout responsivo.
- `game.js`: cliente: conexão com o servidor, placar, loja de cartas, escolha secreta, animação da revelação, sons (Web Audio API) e desenhos em SVG (pistoleiros, paredes, cidade e cartas de pôquer).
- `server.js`: servidor: arquivos estáticos, WebSocket próprio, salas, pareamento em rodízio, ouro e cartas, resolução dos tiros e eliminações.
