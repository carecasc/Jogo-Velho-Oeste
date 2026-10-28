# Duelo no Velho Oeste

Jogo de duelo para **2 jogadores no mesmo dispositivo** (hot-seat), feito com HTML, CSS e JavaScript puro, sem dependências.

## Como rodar

Abra o `index.html` direto no navegador (duplo clique). Não precisa de build nem de servidor.

Se preferir usar um servidor local:

```bash
python3 -m http.server 8000
# depois acesse http://localhost:8000
```

As fontes vêm do Google Fonts. Sem internet, o jogo usa fontes de reserva e continua funcionando.

## Regras

1. Cada jogador escolhe um pistoleiro (6 opções). Todos seguem as mesmas regras; a diferença é só visual.
2. Os dois começam com **10 de vida**, cada um escondido atrás da sua parede.
3. A parede tem **6 posições**: Esquerda ou Direita, combinada com Em cima, Meio ou Embaixo.
4. A cada rodada, um jogador por vez escolhe **em segredo**, enquanto o outro não olha:
   - a **arma**;
   - **onde vai aparecer** na própria parede;
   - **onde vai atirar** na parede do adversário.

   | Arma       | Dano | Alvos |
   |------------|------|-------|
   | Revólver   | 1    | 3     |
   | Rifle      | 5    | 2     |
   | Espingarda | 10   | 1     |

5. As escolhas são reveladas ao mesmo tempo. Um jogador só causa dano se um dos alvos dele for a posição onde o adversário apareceu.
6. Quem chegar a 0 de vida perde. Se os dois chegarem a 0 na mesma rodada, é **empate**.

Não dá para confirmar a jogada sem escolher posição, arma e o número certo de alvos. O som pode ser ligado ou desligado no botão do canto superior direito.

## Arquivos

- `index.html`: estrutura das telas (início, seleção, partida, passagem de vez, resumo, vitória).
- `style.css`: tema de faroeste, cards, arena, animações e layout responsivo.
- `game.js`: dados, estado, áudio (Web Audio API), arte em SVG, fluxo das rodadas, resolução de dano e animação da revelação.
