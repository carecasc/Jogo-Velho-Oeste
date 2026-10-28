/* =====================================================================
 *  DUELO NO VELHO OESTE — cliente (navegador)
 *  Até 8 jogadores online, cada um no seu aparelho. O servidor (server.js)
 *  decide pareamentos, resolve os tiros e mantém a vida de todos; aqui
 *  ficam a interface, as animações e os sons.
 *
 *  Organização do arquivo:
 *    1. Dados fixos (regras, personagens)
 *    2. Estado do cliente
 *    3. Utilidades
 *    4. Áudio (Web Audio API)
 *    5. Arte em SVG (retratos, fantasma, mira)
 *    6. Rede (WebSocket + reconexão)
 *    7. Telas: início e saguão
 *    8. Partida: placar e escolha secreta
 *    9. Revelação animada do duelo
 *   10. Resultados e fim de jogo
 *   11. Inicialização
 * ===================================================================== */
'use strict';

/* =====================================================================
 * 1. DADOS FIXOS
 * ===================================================================== */

const START_HP = 5;
const MAX_PLAYERS = 8;

/* Barraca: 2 colunas x 3 linhas. Índice = linha * 2 + coluna. */
const ROWS = ['Em cima', 'Meio', 'Embaixo'];
const COLS = ['Esquerda', 'Direita'];
const SLOT_COUNT = ROWS.length * COLS.length;

/* Personagens: apenas visuais (todos seguem as mesmas regras). */
const CHARACTERS = [
  {
    id: 'xerife', name: 'Wyatt Ferro', role: 'Xerife',
    quote: 'Nesta cidade, a lei sou eu.',
    look: { skin: '#e0ac7e', hair: '#6b4226', hairStyle: 'short', facial: 'mustache', brows: 'normal',
            hat: 'cowboy', hatColor: '#c9a26b', hatBand: '#5a3519',
            coat: '#7a5230', shirt: '#e9dcc0', scarf: '#9e2a1f', badge: true },
  },
  {
    id: 'foradalei', name: 'Jack Cascavel', role: 'Fora da Lei',
    quote: 'Seu ouro ou sua vida. De preferência os dois.',
    look: { skin: '#d39b72', hair: '#1f1510', hairStyle: 'short', facial: 'none', brows: 'angry',
            hat: 'cowboy', hatColor: '#231a16', hatBand: '#7a1f1f',
            coat: '#2f2a28', shirt: '#5a4a3c', mask: '#a3242b' },
  },
  {
    id: 'cacador', name: 'Silas Caolho', role: 'Caçador de Recompensas',
    quote: 'Vivo ou morto. Morto pesa menos.',
    look: { skin: '#b8835a', hair: '#3a2616', hairStyle: 'short', facial: 'stubble', brows: 'angry',
            hat: 'cowboy', hatColor: '#5b4632', hatBand: '#2a1d12',
            coat: '#8f6b3a', accent: '#c43d2b', poncho: true, cigar: true, eyepatch: true },
  },
  {
    id: 'pistoleira', name: 'Rosa Calamidade', role: 'Pistoleira',
    quote: 'Saco a arma antes de você piscar.',
    look: { skin: '#f0c39b', hair: '#b0412a', hairStyle: 'long', facial: 'none', brows: 'raised', lips: true,
            hat: 'cowboy', hatColor: '#7b2d26', hatBand: '#e8b64a', feather: '#f3e2bd',
            coat: '#5a3a22', shirt: '#f3e2bd', scarf: '#2f6f73' },
  },
  {
    id: 'garimpeiro', name: 'Zé Pepita', role: 'Velho Garimpeiro',
    quote: 'Achei ouro... e chumbo pra você.',
    look: { skin: '#e5b48e', hair: '#ebe5d9', hairStyle: 'short', facial: 'beard', brows: 'raised',
            hat: 'battered', hatColor: '#8a7458', hatBand: '#5a4a36',
            coat: '#6b5a3e', shirt: '#a33b2a' },
  },
  {
    id: 'pregador', name: 'Padre Ezequiel', role: 'O Pregador',
    quote: 'Reze, forasteiro. Vai precisar.',
    look: { skin: '#c99572', hair: '#8a857c', hairStyle: 'short', facial: 'none', brows: 'normal',
            hat: 'flat', hatColor: '#1c1a1a', hatBand: '#3a3533',
            coat: '#1f1d1c', shirt: '#1f1d1c', collar: true },
  },
  {
    id: 'kid', name: 'Billy Relâmpago', role: 'Pistoleiro Novato',
    quote: 'Sou o mais rápido do Oeste... dizem.',
    look: { skin: '#f2c7a0', hair: '#c98a3a', hairStyle: 'short', facial: 'none', brows: 'raised', freckles: true,
            hat: 'cowboy', hatColor: '#e3d3b0', hatBand: '#3a6b8a',
            coat: '#3a6b8a', shirt: '#f3e2bd', scarf: '#e0a030' },
  },
  {
    id: 'dama', name: 'Lady Ás', role: 'Jogadora de Pôquer',
    quote: 'Tenho um ás na manga e outro no tambor.',
    look: { skin: '#8d5a3b', hair: '#24140c', hairStyle: 'long', facial: 'none', brows: 'raised', lips: true,
            hat: 'bowler', hatColor: '#3a2a40', hatBand: '#9e2a1f',
            coat: '#5a2a4a', shirt: '#f3e2bd', scarf: '#e8b64a' },
  },
];

/* =====================================================================
 * 2. ESTADO DO CLIENTE
 * ===================================================================== */

const client = {
  view: null,            // último estado recebido do servidor
  me: null,              // meu id
  offset: 0,             // diferença entre o relógio do servidor e o local
  screen: 'screen-home',
  choice: { pos: null, target: null },   // escolha em andamento (local)
  choiceRound: 0,
  freshSlot: null,       // casa recém-marcada (só ela anima)
  autoSent: false,       // envio automático no fim do tempo
  lastChooseView: null,  // estado antes da revelação (vida "antiga")
  animatedRound: 0,
  animating: false,
  defeatRound: null,
  overShownFor: null,
  lastTick: null,
};

/* =====================================================================
 * 3. UTILIDADES
 * ===================================================================== */

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getChar(id) {
  return CHARACTERS.find((c) => c.id === id);
}

function posName(i) {
  return `${ROWS[Math.floor(i / 2)]} · ${COLS[i % 2]}`;
}

function escapeHTML(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function show(id, visible) {
  $(id).hidden = !visible;
}

function serverNow() {
  return Date.now() + client.offset;
}

/* Armazenamento que não quebra quando o navegador bloqueia. */
const store = {
  get(area, key) {
    try { return window[area].getItem(key); } catch (e) { return null; }
  },
  set(area, key, value) {
    try { window[area].setItem(key, value); } catch (e) { /* ignora */ }
  },
  remove(area, key) {
    try { window[area].removeItem(key); } catch (e) { /* ignora */ }
  },
};

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

/* =====================================================================
 * 4. ÁUDIO — sons sintetizados com Web Audio API
 * ===================================================================== */

const Sound = (() => {
  let ctx = null;
  let master = null;
  let noise = null;
  let muted = store.get('localStorage', 'duelo-mudo') === '1';

  function audio() {
    if (muted) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function noiseBuffer(c) {
    if (!noise) {
      const len = Math.floor(c.sampleRate * 1.5);
      noise = c.createBuffer(1, len, c.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return noise;
  }

  /* Rajada de ruído filtrado (tiros, impactos, poeira). */
  function burst(c, { freq, endFreq = 200, dur, gain, type = 'lowpass' }) {
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
    return g;
  }

  /* Tom simples com envelope. */
  function tone(c, { freq, endFreq, dur, gain = 0.2, type = 'sine', at = 0 }) {
    const t = c.currentTime + at;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  return {
    get muted() { return muted; },

    toggleMute() {
      muted = !muted;
      store.set('localStorage', 'duelo-mudo', muted ? '1' : '0');
      if (master) master.gain.value = muted ? 0 : 0.55;
      return muted;
    },

    unlock() { audio(); },

    /* Estampido de espingarda de pressão de estande, com eco curto. */
    shot() {
      const c = audio(); if (!c) return;
      const g = burst(c, { freq: 4200, endFreq: 260, dur: 0.32, gain: 0.9 });
      tone(c, { freq: 220, endFreq: 55, dur: 0.22, gain: 0.7 });
      const delay = c.createDelay();
      delay.delayTime.value = 0.17;
      const fb = c.createGain();
      fb.gain.value = 0.25;
      g.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(master);
      setTimeout(() => { try { g.disconnect(delay); } catch (e) { /* ok */ } }, 2000);
    },

    /* "Plim!" de alvo de lata derrubado. */
    ding() {
      const c = audio(); if (!c) return;
      tone(c, { freq: 1318, dur: 0.9, gain: 0.18, type: 'sine' });
      tone(c, { freq: 1975, dur: 0.7, gain: 0.1, type: 'sine', at: 0.01 });
      tone(c, { freq: 2637, dur: 0.4, gain: 0.05, type: 'triangle', at: 0.02 });
    },

    ricochet() {
      const c = audio(); if (!c) return;
      tone(c, { freq: 2600 + Math.random() * 800, endFreq: 700, dur: 0.4, gain: 0.08, at: 0.05 });
    },

    pop() {
      const c = audio(); if (!c) return;
      tone(c, { freq: 300, endFreq: 900, dur: 0.12, gain: 0.12, type: 'square' });
    },

    click() {
      const c = audio(); if (!c) return;
      tone(c, { freq: 900, endFreq: 500, dur: 0.06, gain: 0.08, type: 'square' });
    },

    tick() {
      const c = audio(); if (!c) return;
      tone(c, { freq: 1200, dur: 0.05, gain: 0.07, type: 'square' });
    },

    error() {
      const c = audio(); if (!c) return;
      tone(c, { freq: 180, dur: 0.18, gain: 0.12, type: 'sawtooth' });
    },

    /* Fanfarra de fliperama. */
    victory() {
      const c = audio(); if (!c) return;
      const notes = [[523, 0.12], [659, 0.12], [784, 0.12], [1046, 0.3], [784, 0.12], [1046, 0.6]];
      let at = 0;
      notes.forEach(([f, d]) => {
        tone(c, { freq: f, dur: d + 0.08, gain: 0.14, type: 'square', at });
        tone(c, { freq: f / 2, dur: d + 0.08, gain: 0.08, type: 'triangle', at });
        at += d;
      });
    },

    /* Melodia triste de "game over". */
    defeat() {
      const c = audio(); if (!c) return;
      [392, 370, 349, 262].forEach((f, i) => tone(c, { freq: f, dur: 0.4, gain: 0.12, type: 'square', at: i * 0.32 }));
    },
  };
})();

/* =====================================================================
 * 5. ARTE EM SVG
 * ===================================================================== */

function starPoints(cx, cy, outer, inner) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

/* Contorno escuro estilo história em quadrinhos. */
const OUTLINE = '#22140a';
const INK = `stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"`;

/* Retrato (busto) como SVG completo. */
function portraitSVG(look) {
  return `<svg class="portrait" viewBox="0 0 120 150" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${portraitInner(look)}</svg>`;
}

/* Desenho do busto (sem a tag <svg>), em coordenadas 120 x 150.
 * Reaproveitado no corpo inteiro e no pistoleiro espiando da parede. */
function portraitInner(look) {
  const L = look;
  const shade = 'rgba(0,0,0,.22)';
  let s = '';

  // Cabelo comprido (atrás da cabeça)
  if (L.hairStyle === 'long') {
    s += `<path d="M34 58 C24 92 28 120 36 136 L84 136 C92 120 96 92 86 58 Z" fill="${L.hair}"/>`;
  }

  // Pescoço
  s += `<rect x="51" y="88" width="18" height="24" fill="${L.skin}"/><rect x="51" y="88" width="18" height="24" fill="${shade}"/>`;

  // Tronco: poncho ou casaco com camisa
  if (L.poncho) {
    s += `<path d="M2 150 L22 112 Q60 98 98 112 L118 150 Z" fill="${L.coat}" ${INK}/>`;
    let zig = 'M16 126';
    for (let x = 16, down = true; x < 104; x += 8, down = !down) zig += ` L${x + 8} ${down ? 132 : 126}`;
    s += `<path d="${zig}" fill="none" stroke="${L.accent}" stroke-width="3"/>`;
    s += `<path d="M10 140 L110 140" stroke="${L.accent}" stroke-width="4"/>`;
    s += '<path d="M10 145 L110 145" stroke="#f3e2bd" stroke-width="2"/>';
  } else {
    s += `<path d="M8 150 C12 120 32 108 60 106 C88 108 108 120 112 150 Z" fill="${L.coat}" ${INK}/>`;
    s += `<path d="M47 107 L60 136 L73 107 Z" fill="${L.shirt}"/>`;
    s += `<path d="M47 107 L60 136 L54 150 L40 113 Z M73 107 L60 136 L66 150 L80 113 Z" fill="${shade}"/>`;
  }
  if (L.collar) s += '<rect x="55" y="105" width="10" height="7" rx="1" fill="#f4f1ea"/>';
  if (L.scarf) s += `<path d="M45 103 Q60 112 75 103 L67 122 L60 117 L53 122 Z" fill="${L.scarf}"/>`;
  if (L.badge) {
    s += `<polygon points="${starPoints(86, 128, 10, 4.2)}" fill="#e8b64a" stroke="#8a5a1a" stroke-width="1.2"/>`;
    s += '<circle cx="86" cy="128" r="2" fill="#8a5a1a"/>';
  }

  // Orelhas e cabeça
  s += `<ellipse cx="38" cy="75" rx="4" ry="6" fill="${L.skin}" ${INK}/><ellipse cx="82" cy="75" rx="4" ry="6" fill="${L.skin}" ${INK}/>`;
  s += `<ellipse cx="60" cy="72" rx="22" ry="26" fill="${L.skin}" ${INK}/>`;

  // Cabelo ao lado do rosto
  if (L.hairStyle === 'long') {
    s += `<path d="M37 56 Q34 82 42 96 L44 60 Z M83 56 Q86 82 78 96 L76 60 Z" fill="${L.hair}"/>`;
  } else {
    s += `<path d="M38 58 L43 58 L43 80 L39 77 Z M82 58 L77 58 L77 80 L81 77 Z" fill="${L.hair}"/>`;
  }

  // Barba / barba por fazer
  if (L.facial === 'beard') {
    s += `<path d="M38 74 C37 104 50 122 60 124 C70 122 83 104 82 74 C78 90 72 95 60 95 C48 95 42 90 38 74 Z" fill="${L.hair}"/>`;
  } else if (L.facial === 'stubble') {
    s += '<path d="M40 80 C42 100 52 108 60 108 C68 108 78 100 80 80 C74 92 68 96 60 96 C52 96 46 92 40 80 Z" fill="rgba(40,25,15,.35)"/>';
  }

  // Sombra do chapéu no rosto
  s += '<ellipse cx="60" cy="61" rx="21" ry="5" fill="rgba(0,0,0,.25)"/>';

  // Olhos
  s += '<ellipse cx="51" cy="73" rx="2.6" ry="2.3" fill="#1d120a"/><ellipse cx="69" cy="73" rx="2.6" ry="2.3" fill="#1d120a"/>';
  if (L.lips) s += '<path d="M47 71 L45 69 M73 71 L75 69" stroke="#1d120a" stroke-width="1.2"/>';

  // Sardas
  if (L.freckles) {
    s += '<g fill="#b8693a" opacity=".7"><circle cx="46" cy="80" r="1"/><circle cx="49" cy="82" r="1"/><circle cx="44" cy="83" r="1"/><circle cx="74" cy="80" r="1"/><circle cx="71" cy="82" r="1"/><circle cx="76" cy="83" r="1"/></g>';
  }

  // Sobrancelhas (dão a "atitude" do personagem)
  const browColor = L.hairStyle === 'long' ? L.hair : '#2a1a0e';
  const brows = {
    angry:  'M45 65 L56 69 M75 65 L64 69',
    raised: 'M45 67 Q50 63 56 66 M75 67 Q70 63 64 66',
    normal: 'M45 67 L56 67 M75 67 L64 67',
  }[L.brows || 'normal'];
  s += `<path d="${brows}" stroke="${browColor}" stroke-width="2.4" stroke-linecap="round" fill="none"/>`;

  // Tapa-olho
  if (L.eyepatch) {
    s += '<path d="M38 64 L82 80" stroke="#111" stroke-width="1.6"/>';
    s += '<ellipse cx="51" cy="73" rx="6" ry="5" fill="#141010"/>';
  }

  // Nariz
  s += '<path d="M60 74 Q64 83 58 85" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.8" stroke-linecap="round"/>';

  // Boca
  if (L.lips) {
    s += '<path d="M54 92 Q60 97 66 92 Q60 94 54 92 Z" fill="#a8323a" stroke="#7a1f27" stroke-width="1"/>';
  } else {
    s += '<path d="M54 93 Q60 95 66 93" stroke="#4a2a1a" stroke-width="1.8" fill="none" stroke-linecap="round"/>';
  }

  // Bigode
  if (L.facial === 'mustache' || L.facial === 'beard') {
    s += `<path d="M46 91 Q53 83 60 87 Q67 83 74 91 Q67 89 60 90.5 Q53 89 46 91 Z" fill="${L.hair}" stroke="rgba(0,0,0,.2)" stroke-width=".6"/>`;
  }

  // Charuto com fumaça
  if (L.cigar) {
    s += '<rect x="64" y="91" width="16" height="3.6" rx="1.2" fill="#6b3f1f"/>';
    s += '<circle cx="80.5" cy="92.8" r="2" fill="#ff7a2a"/>';
    s += '<path class="smoke" d="M83 89 q4 -5 0 -10 q-4 -5 1 -10" stroke="rgba(240,240,240,.65)" fill="none" stroke-width="1.6"/>';
  }

  // Bandana cobrindo o rosto
  if (L.mask) {
    s += `<path d="M36 80 L84 80 L81 97 Q60 115 39 97 Z" fill="${L.mask}"/>`;
    s += '<g fill="#f3e2bd" opacity=".85"><circle cx="46" cy="87" r="1.3"/><circle cx="56" cy="92" r="1.3"/><circle cx="66" cy="88" r="1.3"/><circle cx="74" cy="92" r="1.3"/><circle cx="60" cy="102" r="1.3"/><circle cx="50" cy="97" r="1.3"/><circle cx="70" cy="98" r="1.3"/></g>';
  }

  // Chapéu
  if (L.hat === 'flat') {
    s += `<rect x="40" y="34" width="40" height="26" rx="3" fill="${L.hatColor}" ${INK}/>`;
    s += `<rect x="40" y="52" width="40" height="6" fill="${L.hatBand}"/>`;
    s += `<ellipse cx="60" cy="60" rx="46" ry="6.5" fill="${L.hatColor}" ${INK}/>`;
    s += '<ellipse cx="60" cy="58.5" rx="44" ry="3" fill="rgba(255,255,255,.07)"/>';
  } else if (L.hat === 'bowler') {
    s += `<path d="M40 60 C38 30 82 30 80 60 Z" fill="${L.hatColor}" ${INK}/>`;
    s += `<rect x="40" y="52" width="40" height="7" fill="${L.hatBand}"/>`;
    s += '<path d="M50 38 Q56 33 64 34" stroke="rgba(255,255,255,.18)" stroke-width="3" fill="none" stroke-linecap="round"/>';
    s += `<path d="M30 60 Q60 52 90 60 Q86 66 60 65 Q34 66 30 60 Z" fill="${L.hatColor}" ${INK}/>`;
    s += '<path d="M80 54 C90 46 94 40 96 34 C90 40 86 46 78 52 Z" fill="#e8b64a"/>';
  } else if (L.hat === 'battered') {
    s += `<path d="M38 61 C36 42 42 28 56 31 C62 24 77 28 82 37 C84 45 83 53 82 61 Z" fill="${L.hatColor}" ${INK}/>`;
    s += `<path d="M38 54 L82 54 L82 60 L38 60 Z" fill="${L.hatBand}"/>`;
    s += '<rect x="63" y="38" width="9" height="8" fill="#a8896a" transform="rotate(12 67 42)"/>';
    s += '<path d="M64 38 l2 2 m2 -2 l2 2 m-6 4 l2 2" stroke="#3a2c1e" stroke-width=".8"/>';
    s += `<path d="M12 63 Q20 56 60 57 Q100 56 108 66 Q100 71 60 68 Q20 69 12 63 Z" fill="${L.hatColor}" ${INK}/>`;
    s += '<circle cx="48" cy="40" r="1.6" fill="#2a1d12"/>';
  } else {
    // Chapéu de caubói clássico (copa amassada + aba curvada)
    s += `<path d="M38 60 C36 36 44 22 52 26 Q60 31 68 26 C76 22 84 36 82 60 Z" fill="${L.hatColor}" ${INK}/>`;
    s += '<path d="M52 26 Q60 31 68 26 Q62 40 60 44 Q58 40 52 26 Z" fill="rgba(0,0,0,.2)"/>';
    s += `<path d="M38 52 L82 52 L82 60 L38 60 Z" fill="${L.hatBand}"/>`;
    if (L.feather) s += `<path d="M78 54 C90 44 96 30 92 22 C88 34 82 44 76 52 Z" fill="${L.feather}" stroke="rgba(0,0,0,.25)" stroke-width=".8"/>`;
    s += `<path d="M8 51 Q18 67 60 67 Q102 67 112 51 Q96 60 60 59 Q24 60 8 51 Z" fill="${L.hatColor}" ${INK}/>`;
    s += '<path d="M8 51 Q18 67 60 67 Q102 67 112 51 Q100 64 60 64 Q20 64 8 51 Z" fill="rgba(0,0,0,.25)"/>';
  }

  return s;
}

/* Fantasma genérico (lençol com chapéu) para quando ninguém foi eliminado ainda. */
const GHOST_INNER =
  `<path d="M28 150 L28 84 C28 40 92 40 92 84 L92 150 L82 140 L72 150 L60 140 L48 150 L38 140 Z" fill="#e6efff" ${INK}/>` +
  '<ellipse cx="49" cy="84" rx="5" ry="7" fill="#1b1024"/><ellipse cx="71" cy="84" rx="5" ry="7" fill="#1b1024"/>' +
  '<ellipse cx="60" cy="104" rx="6" ry="8" fill="#1b1024"/>' +
  `<path d="M40 56 C38 34 46 24 54 28 Q60 32 66 28 C74 24 82 34 80 56 Z" fill="#3a3346" ${INK}/>` +
  `<path d="M14 52 Q22 64 60 64 Q98 64 106 52 Q92 59 60 58 Q28 59 14 52 Z" fill="#3a3346" ${INK}/>`;
const GHOST_SVG = `<svg class="portrait" viewBox="0 0 120 150" aria-hidden="true">${GHOST_INNER}</svg>`;

const CROSSHAIR_SVG =
  '<svg class="crosshair" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="13" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="20" cy="20" r="2.5" fill="currentColor"/><path d="M20 1 V11 M20 29 V39 M1 20 H11 M29 20 H39" stroke="currentColor" stroke-width="3"/></svg>';

const ICON_SOUND_ON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9 H7 L12 4 V20 L7 15 H3 Z" fill="currentColor"/><path d="M15.5 8.5 Q18 12 15.5 15.5 M18 6 Q22 12 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_SOUND_OFF =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9 H7 L12 4 V20 L7 15 H3 Z" fill="currentColor"/><path d="M16 9 L22 15 M22 9 L16 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

/* Retrato de um jogador ou do fantasma. who: { charId, ghost } */
function figureArt(who) {
  if (who.ghost && !who.charId) return GHOST_SVG;
  return portraitSVG(getChar(who.charId).look);
}

/* Medalhão redondo com anéis de alvo (placar, saguão, resultados). */
function badgeHTML(who, extra = '') {
  return `<span class="badge ${who.ghost ? 'ghosty' : ''} ${extra}">${figureArt(who)}</span>`;
}

/* Alvo recortado em madeira, preso numa haste (estilo estande de tiro). */
function cutoutHTML(who, extra = '') {
  return `<span class="cutout ${who.ghost ? 'ghosty' : ''} ${extra}"><span class="cutout-face">${figureArt(who)}</span></span>`;
}

/* Lâmpadas de vida. */
function bulbsHTML(hp) {
  let html = `<span class="bulbs" aria-label="Vida ${hp} de ${START_HP}">`;
  for (let i = 0; i < START_HP; i++) html += `<span class="bulb ${i < hp ? 'on' : ''}"></span>`;
  return html + '</span>';
}

/* Revólver (cano, tambor e cabo), desenhado apontando para a esquerda. */
const REVOLVER_LEFT =
  `<g ${INK}><rect x="-46" y="91" width="28" height="5" rx="1" fill="#9aa0a8"/>` +
  '<rect x="-24" y="87" width="11" height="11" rx="3" fill="#6b7076"/>' +
  '<path d="M-15 92 L-5 92 L-1 109 L-10 111 Z" fill="#6a3d1c"/></g>';

/* Pistoleiro inteiro encostado na parede, segurando o revólver (120 x 300). */
function fullBodySVG(who) {
  const L = getChar(who.charId).look;
  const pants = L.pants || '#3b302a';
  const vest = L.vest || '#2e2420';
  let s = '<svg class="portrait" viewBox="0 0 120 300" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">';
  // Pernas e botas
  s += `<path d="M42 208 L40 286 L58 286 L60 228 L62 286 L80 286 L78 208 Z" fill="${pants}" ${INK}/>`;
  s += `<path d="M36 282 L58 282 L59 298 L28 298 Q29 287 36 282 Z M62 282 L84 282 Q91 287 92 298 L61 298 Z" fill="#3a2414" ${INK}/>`;
  // Casaco longo, colete, cinto e coldre
  s += `<path d="M10 140 L4 258 L42 262 L46 214 L74 214 L78 262 L116 258 L110 140 Z" fill="${L.coat}" ${INK}/>`;
  s += '<path d="M24 170 L30 236 M96 170 L90 236" stroke="rgba(0,0,0,.25)" stroke-width="2" fill="none"/>';
  s += `<path d="M44 140 L44 212 L76 212 L76 140 Z" fill="${vest}" ${INK}/>`;
  s += '<g fill="#c9a24a"><circle cx="60" cy="170" r="1.8"/><circle cx="60" cy="184" r="1.8"/><circle cx="60" cy="198" r="1.8"/></g>';
  s += `<rect x="42" y="204" width="36" height="9" fill="#5a3519" ${INK}/>`;
  s += '<rect x="56" y="203" width="9" height="11" rx="1" fill="none" stroke="#e8b64a" stroke-width="2"/>';
  s += `<path d="M80 210 L93 210 L95 250 L84 252 Z" fill="#7a4a26" ${INK}/>`;
  s += `<path d="M82 200 L91 200 L91 212 L82 212 Z" fill="#5a3519" ${INK}/>`;
  // Busto (cabeça, chapéu, ombros)
  s += portraitInner(L);
  // Braços dobrados segurando o revólver junto ao peito
  s += `<path d="M14 126 Q2 172 18 192 Q38 198 60 172 L54 160 Q38 176 30 174 Q26 154 28 130 Z" fill="${L.coat}" ${INK}/>`;
  s += `<path d="M106 126 Q118 172 102 190 Q84 196 64 174 L70 162 Q84 176 92 172 Q94 152 92 130 Z" fill="${L.coat}" ${INK}/>`;
  // Revólver com o cabo nas mãos e o cano apontado para cima
  s += `<g transform="translate(62 162) rotate(120) translate(6 -100)">${REVOLVER_LEFT}</g>`;
  s += `<ellipse cx="57" cy="166" rx="8" ry="7" fill="${L.skin}" ${INK}/><ellipse cx="66" cy="162" rx="8" ry="7" fill="${L.skin}" ${INK}/>`;
  s += '</svg>';
  return s;
}

/* Pistoleiro espiando pela lateral da parede, com o braço e o revólver
 * esticados para fora. Desenhado olhando para a esquerda; a CSS espelha
 * quando ele aparece do lado direito. viewBox: -48 0 168 150. */
function peekSVG(who) {
  let s = '<svg class="portrait" viewBox="-48 0 168 150" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">';
  if (who.ghost && !who.charId) return s + GHOST_INNER + '</svg>';
  const L = getChar(who.charId).look;
  s += `<path d="M34 112 L-10 90 L-14 103 L30 128 Z" fill="${L.coat}" ${INK}/>`;
  s += REVOLVER_LEFT;
  s += `<circle cx="-11" cy="97" r="7" fill="${L.skin}" ${INK}/>`;
  s += portraitInner(L);
  return s + '</svg>';
}

/* Cenário: rua de cidade de faroeste ao entardecer (estilo quadrinhos). */
const TOWN_SVG = `
<svg viewBox="0 0 400 250" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="town-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#bcd9dc"/><stop offset=".55" stop-color="#f6e6bc"/><stop offset="1" stop-color="#f3cf92"/>
    </linearGradient>
    <linearGradient id="town-ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e8c48e"/><stop offset="1" stop-color="#c98f52"/>
    </linearGradient>
  </defs>
  <rect width="400" height="250" fill="url(#town-sky)"/>
  <circle cx="230" cy="96" r="46" fill="#fff6dc" opacity=".55"/>
  <g stroke="#4a3220" stroke-width="1.4" stroke-linejoin="round">
    <!-- prédios da esquerda -->
    <path d="M-10 46 L30 46 L30 38 L66 38 L66 152 L-10 152 Z" fill="#cdb08a"/>
    <path d="M66 74 L118 74 L118 64 L140 64 L140 152 L66 152 Z" fill="#d9bf98"/>
    <path d="M140 102 L170 102 L170 96 L182 96 L182 152 L140 152 Z" fill="#e3cfae"/>
    <path d="M-10 108 L74 102 L74 108 L-10 114 Z" fill="#a8845a"/>
    <path d="M66 118 L146 114 L146 119 L66 123 Z" fill="#b8956a"/>
    <g fill="#6b4a30">
      <rect x="6" y="58" width="10" height="16"/><rect x="34" y="58" width="10" height="16"/>
      <rect x="80" y="84" width="9" height="14"/><rect x="100" y="84" width="9" height="14"/><rect x="124" y="84" width="9" height="14"/>
      <rect x="150" y="110" width="6" height="9"/><rect x="164" y="110" width="6" height="9"/>
      <rect x="20" y="124" width="14" height="28"/><rect x="96" y="128" width="12" height="24"/>
    </g>
    <path d="M6 114 L6 152 M44 111 L44 152 M74 122 L74 152 M110 120 L110 152 M140 118 L140 152" fill="none"/>
    <!-- prédios da direita -->
    <path d="M222 100 L236 100 L236 94 L268 94 L268 152 L222 152 Z" fill="#e3cfae"/>
    <path d="M268 66 L300 66 L300 56 L340 56 L340 152 L268 152 Z" fill="#d9bf98"/>
    <path d="M340 30 L410 30 L410 152 L340 152 Z" fill="#cdb08a"/>
    <path d="M262 116 L346 112 L346 118 L262 122 Z" fill="#b8956a"/>
    <rect x="282" y="72" width="44" height="12" fill="#7a2a1c"/>
    <g fill="#6b4a30">
      <rect x="230" y="108" width="7" height="10"/><rect x="250" y="108" width="7" height="10"/>
      <rect x="280" y="92" width="9" height="14"/><rect x="306" y="92" width="9" height="14"/>
      <rect x="354" y="44" width="11" height="17"/><rect x="380" y="44" width="11" height="17"/>
      <rect x="354" y="82" width="11" height="17"/><rect x="380" y="82" width="11" height="17"/>
      <rect x="296" y="126" width="14" height="26"/><rect x="364" y="122" width="16" height="30"/>
    </g>
    <path d="M268 121 L268 152 M300 119 L300 152 M340 117 L340 152" fill="none"/>
    <!-- poste de amarrar cavalos e barril -->
    <path d="M150 140 L150 156 M196 140 L196 156 M146 142 L200 142" stroke-width="2.2" fill="none"/>
    <path d="M206 142 L220 142 L222 158 L204 158 Z" fill="#9a6a3a"/>
  </g>
  <text x="304" y="81.5" font-family="Rye, Georgia, serif" font-size="9" text-anchor="middle" fill="#f6e7c4">SALOON</text>
  <!-- rua de terra -->
  <path d="M-10 150 L410 150 L410 260 L-10 260 Z" fill="url(#town-ground)"/>
  <path d="M-10 150 L410 150" stroke="#9a6a3a" stroke-width="1.2"/>
  <g stroke="#c08850" stroke-width="1.6" stroke-linecap="round" fill="none" opacity=".8">
    <path d="M196 156 L120 250"/><path d="M214 156 L300 250"/>
    <path d="M40 176 L70 174"/><path d="M300 170 L338 172"/><path d="M150 210 L190 208"/><path d="M250 228 L296 226"/><path d="M20 230 L60 232"/>
  </g>
</svg>`;

/* =====================================================================
 * 6. REDE — WebSocket com reconexão automática
 * ===================================================================== */

const session = {
  load() {
    try { return JSON.parse(store.get('sessionStorage', 'duelo-sessao')); } catch (e) { return null; }
  },
  save(data) { store.set('sessionStorage', 'duelo-sessao', JSON.stringify(data)); },
  clear() { store.remove('sessionStorage', 'duelo-sessao'); },
};

const Net = (() => {
  let ws = null;
  let retry = 0;
  const queue = [];

  function url() {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  function connect() {
    ws = new WebSocket(url());
    ws.onopen = () => {
      retry = 0;
      setNetStatus(null);
      const s = session.load();
      if (s) ws.send(JSON.stringify({ t: 'rejoin', code: s.code, id: s.id, token: s.token }));
      while (queue.length) ws.send(JSON.stringify(queue.shift()));
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      onServerMessage(msg);
    };
    ws.onclose = () => {
      ws = null;
      setNetStatus('Sem conexão com o servidor. Reconectando…');
      setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
    };
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    else queue.push(obj);
  }

  return { connect, send };
})();

function setNetStatus(text) {
  const el = $('net-status');
  el.hidden = !text;
  if (text) el.textContent = text;
}

function onServerMessage(msg) {
  switch (msg.t) {
    case 'joined':
      session.save({ code: msg.code, id: msg.id, token: msg.token });
      client.me = msg.id;
      history.replaceState(null, '', `?sala=${msg.code}`);
      break;
    case 'state':
      handleState(msg);
      break;
    case 'error':
      Sound.error();
      toast(msg.msg);
      break;
    case 'rejoin-failed':
      session.clear();
      if (client.view) toast('A sala não existe mais.');
      goHome();
      break;
    case 'left':
      session.clear();
      goHome();
      break;
  }
}

function handleState(v) {
  client.offset = v.now - Date.now();
  client.view = v;
  client.me = v.you;
  if (v.phase === 'choose') {
    client.lastChooseView = v;
    if (client.choiceRound !== v.round) {
      client.choiceRound = v.round;
      client.choice = { pos: null, target: null };
      client.freshSlot = null;
      client.autoSent = false;
      client.choiceDirty = true;
    }
  }
  render();
}

function goHome() {
  client.view = null;
  client.animating = false;
  history.replaceState(null, '', location.pathname);
  showScreen('screen-home');
}

/* =====================================================================
 * 7. TELAS: INÍCIO E SAGUÃO
 * ===================================================================== */

function showScreen(id) {
  if (client.screen === id) return;
  client.screen = id;
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  window.scrollTo(0, 0);
}

function me() {
  return client.view && client.view.players.find((p) => p.id === client.me);
}

function playerById(id) {
  return client.view.players.find((p) => p.id === id);
}

function render() {
  const v = client.view;
  if (!v) return;
  if (v.phase === 'lobby') {
    renderLobby();
    showScreen('screen-lobby');
  } else if (v.phase === 'over') {
    renderOver();
    showScreen('screen-over');
  } else {
    showScreen('screen-game');
    renderGame();
  }
}

function readName() {
  const name = $('input-name').value.trim();
  if (!name) {
    Sound.error();
    toast('Digite seu nome de pistoleiro.');
    $('input-name').focus();
    return null;
  }
  store.set('localStorage', 'duelo-nome', name);
  return name;
}

function createRoom() {
  Sound.unlock();
  const name = readName();
  if (!name) return;
  Sound.click();
  Net.send({ t: 'create', name });
}

function joinRoom() {
  Sound.unlock();
  const name = readName();
  if (!name) return;
  const code = $('input-code').value.trim().toUpperCase();
  if (code.length !== 4) {
    Sound.error();
    toast('O código da sala tem 4 letras.');
    $('input-code').focus();
    return;
  }
  Sound.click();
  Net.send({ t: 'join', code, name });
}

function leaveRoom() {
  Sound.click();
  Net.send({ t: 'leave' });
}

function renderLobby() {
  const v = client.view;
  const host = playerById(v.hostId);
  const amHost = v.hostId === client.me;
  $('lobby-code').textContent = v.code;
  $('lobby-count').textContent = `${v.players.length}/${MAX_PLAYERS}`;

  let list = v.players.map((p) => {
    const ch = getChar(p.charId);
    const tags = [
      p.id === v.hostId ? '<span class="tag tag-host">Anfitrião</span>' : '',
      p.id === client.me ? '<span class="tag tag-me">Você</span>' : '',
      !p.connected ? '<span class="tag tag-off">Reconectando…</span>' : '',
    ].join('');
    return `<li class="lobby-player">${badgeHTML(p)}<span class="lp-text"><b>${escapeHTML(p.name)}</b><small>${ch.name} · ${ch.role}</small><span class="lp-tags">${tags}</span></span></li>`;
  }).join('');
  for (let i = v.players.length; i < MAX_PLAYERS; i++) list += '<li class="lobby-player empty">Lugar vago…</li>';
  $('lobby-players').innerHTML = list;

  $('char-grid').innerHTML = CHARACTERS.map((c) => {
    const owner = v.players.find((p) => p.charId === c.id);
    const mine = owner && owner.id === client.me;
    const taken = owner && !mine;
    return `
      <button type="button" class="char-btn ${mine ? 'selected' : ''} ${taken ? 'taken' : ''}" data-char="${c.id}"
              ${taken ? 'disabled' : ''} aria-pressed="${!!mine}"
              aria-label="${c.name}, ${c.role}${taken ? `, escolhido por ${escapeHTML(owner.name)}` : ''}">
        <span class="char-stage">${cutoutHTML({ charId: c.id })}</span>
        <span class="char-plate"><b>${c.name}</b><small>${c.role}</small></span>
        <span class="char-quote">“${c.quote}”</span>
        ${taken ? `<span class="char-owner">${escapeHTML(owner.name)}</span>` : ''}
      </button>`;
  }).join('');

  const connected = v.players.filter((p) => p.connected).length;
  $('btn-start').hidden = !amHost;
  $('btn-start').classList.toggle('not-ready', connected < 2);
  $('lobby-wait').textContent = amHost
    ? (connected < 2 ? 'Espere pelo menos mais 1 pistoleiro entrar.' : `${connected} pistoleiros prontos para o duelo.`)
    : `Aguardando ${host ? escapeHTML(host.name) : 'o anfitrião'} começar a partida…`;
}

function onCharClick(e) {
  const btn = e.target.closest('.char-btn');
  if (!btn || btn.disabled) return;
  Sound.click();
  Net.send({ t: 'pick', charId: btn.dataset.char });
}

function startGame() {
  const connected = client.view.players.filter((p) => p.connected).length;
  if (connected < 2) {
    Sound.error();
    toast('São necessários pelo menos 2 pistoleiros.');
    return;
  }
  Sound.click();
  Net.send({ t: 'start' });
}

function copyLink() {
  const link = `${location.origin}${location.pathname}?sala=${client.view.code}`;
  const done = () => toast('Link copiado! Mande para a turma.');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(link).then(done, () => window.prompt('Copie o link:', link));
  } else {
    window.prompt('Copie o link:', link);
  }
}

/* =====================================================================
 * 8. PARTIDA: PLACAR E ESCOLHA SECRETA
 * ===================================================================== */

/* Meu duelo na rodada atual (dos pareamentos ou dos resultados). */
function myPairing() {
  const v = client.view;
  return v.pairings.find((pr) => pr.a === client.me || pr.b === client.me) || null;
}

/* Quem eu enfrento: jogador real ou fantasma. */
function opponentOf(pr) {
  if (!pr) return null;
  const oppId = pr.a === client.me ? pr.b : pr.a;
  if (oppId) {
    const p = playerById(oppId);
    return { id: p.id, name: p.name, charId: p.charId, ghost: false };
  }
  return { id: null, name: pr.ghost.name, charId: pr.ghost.charId, ghost: true };
}

/* Durante a animação, o placar mostra a vida de antes dos tiros. */
function displayPlayers() {
  const v = client.view;
  const snap = client.lastChooseView;
  if (client.animating && snap && snap.round === v.round) {
    return v.players.map((p) => {
      const old = snap.players.find((o) => o.id === p.id);
      return old ? { ...p, hp: old.hp, alive: old.alive, place: old.place } : p;
    });
  }
  return v.players;
}

function renderLeaderboard() {
  const v = client.view;
  const pr = myPairing();
  const oppId = pr ? (pr.a === client.me ? pr.b : pr.a) : null;
  const players = displayPlayers().slice().sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive) return b.hp - a.hp || a.name.localeCompare(b.name);
    return a.place - b.place;
  });

  $('leaderboard').innerHTML = players.map((p) => {
    const cls = [
      p.id === client.me ? 'me' : '',
      p.id === oppId ? 'opp' : '',
      p.alive ? '' : 'dead',
      !p.connected && !p.left ? 'offline' : '',
    ].join(' ');
    let status = '';
    if (!p.alive) status = `<span class="lb-place">${p.place}º</span>`;
    else if (v.phase === 'choose' && p.submitted) status = '<span class="lb-ready" title="Já atirou">✓</span>';
    else if (p.id === oppId) status = '<span class="lb-vs">VS</span>';
    return `
      <li class="lb-item ${cls}">
        ${badgeHTML(p)}
        <span class="lb-info">
          <span class="lb-name">${escapeHTML(p.name)}${p.id === client.me ? ' <small>(você)</small>' : ''}</span>
          ${bulbsHTML(p.hp)}
        </span>
        ${status}
      </li>`;
  }).join('');
}

function renderGame() {
  const v = client.view;
  const self = me();
  $('round-num').textContent = v.round;
  renderLeaderboard();

  const pr = myPairing();
  const opp = opponentOf(pr);
  $('duel-label').innerHTML = opp
    ? `Você <span class="vs">VS</span> ${escapeHTML(opp.name)}`
    : `<span class="muted">${v.pairings.length} ${v.pairings.length === 1 ? 'duelo' : 'duelos'} nesta rodada</span>`;

  if (v.phase === 'choose') {
    client.animating = false;
    show('arena', false);
    show('results-panel', false);
    if (!self || !self.alive || !pr) {
      showCenter('spectate-panel');
      renderSpectate();
    } else if (self.submitted) {
      showCenter('wait-panel');
      renderWait();
    } else {
      const wasHidden = $('choice-panel').hidden;
      showCenter('choice-panel');
      if (wasHidden || client.choiceDirty) renderChoice();
    }
  } else if (v.phase === 'reveal') {
    if (client.animatedRound !== v.round) {
      client.animatedRound = v.round;
      const duel = v.results.duels.find((d) => d.a.id === client.me || d.b.id === client.me);
      if (duel) runReveal(duel);
      else showResults();
    } else if (!client.animating) {
      showResults();
    }
  }
}

/* Mostra só um dos painéis do centro. */
function showCenter(id) {
  ['choice-panel', 'wait-panel', 'spectate-panel', 'arena', 'results-panel'].forEach((p) => show(p, p === id));
}

/* ---------- Cena do duelo ----------
 * Em primeiro plano, à esquerda, a parede do jogador com o pistoleiro dele;
 * ao fundo, à direita, a parede do rival. As 6 posições ficam nas laterais
 * de cada parede (esquerda/direita x em cima/meio/embaixo). */

/* Centro de cada posição, em % da área da parede. */
const SPOT_X = [14, 86];
const SPOT_Y_MINE = [22, 48, 74];
const SPOT_Y_ENEMY = [20, 50, 80];

function spotStyle(i, ys) {
  return `left:${SPOT_X[i % 2]}%;top:${ys[Math.floor(i / 2)]}%`;
}

/* Pistoleiro espiando por um lado da parede. */
function peekHTML(who, i, ys, extra = '') {
  const side = i % 2 === 0 ? 'side-left' : 'side-right';
  return `<div class="peek ${side} ${who.ghost ? 'ghosty' : ''} ${extra}" style="${spotStyle(i, ys)}">${peekSVG(who)}</div>`;
}

/* Monta a cena. mode 'choose': botões para escolher; 'reveal': só desenho. */
function sceneHTML({ mode, self, opp, pos = null, target = null, oppPos = null }) {
  const choosing = mode === 'choose';
  let mine = '';
  let enemy = '';
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (choosing) {
      const own = pos === i;
      const tgt = target === i;
      mine += `<button type="button" class="spot own ${own ? 'selected' : ''}" style="${spotStyle(i, SPOT_Y_MINE)}"
                 data-own-slot="${i}" aria-pressed="${own}" aria-label="Aparecer em ${posName(i)}"></button>`;
      enemy += `<button type="button" class="spot target ${tgt ? 'selected' : ''} ${pos === null ? 'locked' : ''}" style="${spotStyle(i, SPOT_Y_ENEMY)}"
                  data-target-slot="${i}" aria-pressed="${tgt}" aria-label="Atirar em ${posName(i)}">${tgt ? CROSSHAIR_SVG : ''}</button>`;
    } else {
      // Marcadores invisíveis que servem de mira para os efeitos
      mine += `<span class="spot-anchor" style="${spotStyle(i, SPOT_Y_MINE)}"></span>`;
      enemy += `<span class="spot-anchor" style="${spotStyle(i, SPOT_Y_ENEMY)}"></span>`;
    }
  }
  const myPeek = pos !== null ? peekHTML(self, pos, SPOT_Y_MINE, choosing ? 'out' : '') : '';
  const idle = !choosing || pos === null ? `<div class="idle">${fullBodySVG(self)}</div>` : '';
  const oppPeek = oppPos !== null ? peekHTML(opp, oppPos, SPOT_Y_ENEMY) : '';
  return `
    <div class="scene-bg">${TOWN_SVG.replace(/town-/g, `${mode}-town-`)}</div>
    <div class="wall-area enemy-area">
      ${oppPeek}
      <div class="plank-wall far"></div>
      <div class="wall-name">${escapeHTML(opp.name)}</div>
      ${enemy}
    </div>
    <div class="wall-area my-area">
      ${myPeek}
      <div class="plank-wall near"></div>
      ${idle}
      ${mine}
    </div>`;
}

function renderChoice() {
  client.choiceDirty = false;
  const self = { ...me(), ghost: false };
  const opp = opponentOf(myPairing());
  const c = client.choice;

  // Mantém o foco do teclado na mesma posição depois de redesenhar
  const active = document.activeElement;
  const key = active && active.dataset && (active.dataset.ownSlot !== undefined
    ? `[data-own-slot="${active.dataset.ownSlot}"]`
    : active.dataset.targetSlot !== undefined ? `[data-target-slot="${active.dataset.targetSlot}"]` : '');

  const scene = $('choice-scene');
  scene.innerHTML = sceneHTML({ mode: 'choose', self, opp, pos: c.pos, target: c.target });
  scene.classList.toggle('step-1', c.pos === null);
  scene.classList.toggle('step-2', c.pos !== null && c.target === null);
  if (client.freshSlot === 'own') scene.querySelector('.peek').classList.add('fresh');
  if (client.freshSlot === 'target') {
    const t = scene.querySelector('.spot.target.selected');
    if (t) t.classList.add('fresh');
  }
  client.freshSlot = null;

  $('choice-step').innerHTML = c.pos === null
    ? '<span class="step-n">1</span><span>Escolha onde o seu pistoleiro vai aparecer na <b>sua parede</b>.</span>'
    : c.target === null
      ? `<span class="step-n">2</span><span>Agora escolha onde o tiro vai chegar na parede de <b>${escapeHTML(opp.name)}</b>, ao fundo.</span>`
      : '<span class="step-n">✓</span><span>Tudo pronto! Você pode trocar as escolhas ou atirar.</span>';

  const missing = [];
  if (c.pos === null) missing.push('onde aparecer');
  if (c.target === null) missing.push('onde atirar');
  const status = $('choice-status');
  status.classList.remove('error');
  status.classList.toggle('ok', missing.length === 0);
  status.textContent = missing.length
    ? (c.pos === null ? '' : `Você aparece em ${posName(c.pos)}.`)
    : `Você aparece em ${posName(c.pos)} e atira em ${posName(c.target)}.`;
  $('btn-confirm').classList.toggle('not-ready', missing.length > 0);
  $('btn-confirm').setAttribute('aria-disabled', String(missing.length > 0));

  if (key) {
    const el = scene.querySelector(key);
    if (el) el.focus({ preventScroll: true });
  }
}

/* Primeiro a posição do pistoleiro; só depois o destino do tiro. */
function onChoiceClick(e) {
  if (!client.view || client.view.phase !== 'choose') return;
  const own = e.target.closest('[data-own-slot]');
  const target = e.target.closest('[data-target-slot]');
  if (own) {
    client.choice.pos = Number(own.dataset.ownSlot);
    client.freshSlot = 'own';
  } else if (target) {
    if (client.choice.pos === null) {
      flashStatus('Primeiro escolha onde o seu pistoleiro vai aparecer.');
      return;
    }
    const slot = Number(target.dataset.targetSlot);
    client.choice.target = client.choice.target === slot ? null : slot;
    client.freshSlot = 'target';
  } else {
    return;
  }
  Sound.click();
  renderChoice();
}

function flashStatus(msg) {
  const status = $('choice-status');
  status.textContent = msg;
  status.classList.remove('ok', 'error');
  void status.offsetWidth;
  status.classList.add('error');
  Sound.error();
}

function confirmChoice() {
  const c = client.choice;
  if (c.pos === null || c.target === null) {
    flashStatus(`Ainda não dá para atirar. Escolha ${c.pos === null ? 'onde o seu pistoleiro aparece' : 'onde o tiro vai chegar'}.`);
    return;
  }
  Sound.unlock();
  Sound.click();
  Net.send({ t: 'choice', pos: c.pos, target: c.target });
}

function renderWait() {
  const v = client.view;
  const alive = v.players.filter((p) => p.alive);
  const done = alive.filter((p) => p.submitted).length;
  $('wait-text').textContent = `Aguardando os outros pistoleiros (${done}/${alive.length} prontos)…`;
  const m = v.mine || client.choice;
  $('wait-mine').innerHTML = m && m.pos !== null && m.pos !== undefined
    ? `Você aparece em <b>${posName(m.pos)}</b> e atira em <b>${posName(m.target)}</b>.`
    : '';
}

function pairLabel(pr) {
  const a = playerById(pr.a);
  const b = pr.b ? playerById(pr.b) : { ...pr.ghost, ghost: true };
  return `<li class="pair">${badgeHTML(a)}<b>${escapeHTML(a.name)}</b><span class="vs">VS</span><b>${escapeHTML(b.name)}</b>${badgeHTML(b)}</li>`;
}

function renderSpectate() {
  const self = me();
  $('spectate-text').textContent = self && self.place
    ? `Você terminou em ${self.place}º lugar. Acompanhe os duelos desta rodada:`
    : 'Acompanhe os duelos desta rodada:';
  $('spectate-pairs').innerHTML = client.view.pairings.map(pairLabel).join('');
}

/* Relógio da rodada (atualizado várias vezes por segundo). */
function updateTimer() {
  const v = client.view;
  if (!v || (v.phase !== 'choose' && v.phase !== 'reveal')) return;
  const left = Math.max(0, Math.ceil((v.deadline - serverNow()) / 1000));
  const timer = $('timer');

  if (v.phase === 'choose') {
    timer.textContent = left;
    const self = me();
    const playing = self && self.alive && !self.submitted && myPairing();
    timer.parentElement.classList.toggle('urgent', left <= 5 && !!playing);
    if (playing && left <= 5 && left > 0 && client.lastTick !== left) {
      client.lastTick = left;
      Sound.tick();
    }
    // No último segundo, envia o que já foi escolhido (o resto é sorteado)
    const c = client.choice;
    if (playing && left <= 1 && !client.autoSent && (c.pos !== null || c.target !== null)) {
      client.autoSent = true;
      Net.send({ t: 'choice', pos: c.pos, target: c.target, timeout: true });
    }
  } else {
    timer.textContent = '--';
    timer.parentElement.classList.remove('urgent');
    const ending = v.players.filter((p) => p.alive).length <= 1;
    $('results-next').textContent = `${ending ? 'Resultado final' : 'Próxima rodada'} em ${left}s…`;
  }
}

/* =====================================================================
 * 9. REVELAÇÃO ANIMADA DO DUELO
 * ===================================================================== */

/* Marcador de uma posição na cena da revelação. */
function anchorOf(area, pos) {
  return $('arena-scene').querySelector(`.${area}`).querySelectorAll('.spot-anchor')[pos];
}

async function banner(text, ms = 700, cls = '') {
  const b = $('arena-banner');
  b.className = `arena-banner show ${cls}`;
  b.textContent = text;
  await sleep(ms);
  b.className = 'arena-banner';
}

function centerIn(el, base) {
  const r = el.getBoundingClientRect();
  const b = base.getBoundingClientRect();
  return { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height / 2, w: r.width, h: r.height };
}

function fx(className, x, y, life = 900, text = '') {
  const el = document.createElement('div');
  el.className = `fx ${className}`;
  // Letreiros de acerto não podem sair da tela
  if (text) x = Math.min(Math.max(x, 70), $('arena').clientWidth - 70);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  if (text) el.textContent = text;
  $('fx-layer').appendChild(el);
  setTimeout(() => el.remove(), life);
  return el;
}

/* Lascas de madeira e poeira quando a bala passa raspando a parede. */
function splinters(x, y, scale = 1) {
  for (let i = 0; i < 8; i++) {
    const p = fx(i % 2 ? 'spark' : 'dust', x, y, 800);
    const ang = Math.random() * Math.PI * 2;
    const dist = (12 + Math.random() * 22) * scale;
    p.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(ang) * dist}px`);
  }
}

/* Buraco de bala na borda da parede, ao lado da posição errada. */
function bulletHole(area, pos, ys) {
  const hole = document.createElement('span');
  hole.className = 'hole';
  const edge = pos % 2 === 0 ? 'calc(var(--wall-l) + 6px)' : 'calc(100% - var(--wall-l) - 6px)';
  hole.style.left = edge;
  hole.style.top = `${ys[Math.floor(pos / 2)] + (Math.random() - 0.5) * 8}%`;
  $('arena-scene').querySelector(`.${area}`).appendChild(hole);
}

/* Um disparo: do revólver de quem atira até a posição escolhida. */
function fireShot(fromArea, toArea, shooter) {
  const arena = $('arena');
  const fig = $('arena-scene').querySelector(`.${fromArea} .peek`);
  const r = fig.getBoundingClientRect();
  const b = arena.getBoundingClientRect();
  const left = fig.classList.contains('side-left');
  // Ponta do cano: borda de fora da figura, na altura da mão
  const from = { x: (left ? r.left : r.right) - b.left, y: r.top - b.top + r.height * 0.63 };
  const to = centerIn(anchorOf(toArea, shooter.target), arena);
  const tx = to.x + (Math.random() - 0.5) * 10;
  const ty = to.y + (Math.random() - 0.5) * 10;

  fx('muzzle', from.x, from.y, 260);
  const dx = tx - from.x;
  const dy = ty - from.y;
  const tracer = fx('tracer', from.x, from.y, 420);
  tracer.style.width = `${Math.hypot(dx, dy)}px`;
  const rot = `rotate(${Math.atan2(dy, dx)}rad)`;
  tracer.animate(
    [{ transform: `${rot} scaleX(0)`, opacity: 1 }, { transform: `${rot} scaleX(1)`, opacity: 1, offset: 0.5 }, { transform: `${rot} scaleX(1)`, opacity: 0 }],
    { duration: 360, easing: 'ease-out', fill: 'forwards' }
  );

  setTimeout(() => {
    const far = toArea === 'enemy-area';
    if (shooter.hit) {
      const victim = $('arena-scene').querySelector(`.${toArea} .peek`);
      victim.classList.add(far ? 'knocked' : 'hurt');
      fx('hit-burst', to.x, to.y - (far ? 26 : 50), 1300, far ? 'ACERTOU! −1' : 'AI! −1');
      Sound.ding();
    } else {
      bulletHole(toArea, shooter.target, far ? SPOT_Y_ENEMY : SPOT_Y_MINE);
      splinters(tx, ty, far ? 0.6 : 1.1);
      if (Math.random() < 0.6) Sound.ricochet();
    }
  }, 180);
}

/* Sequência da revelação do meu duelo. */
async function runReveal(duel) {
  client.animating = true;
  const v = client.view;
  const round = v.round;
  const mineSide = duel.a.id === client.me ? duel.a : duel.b;
  const oppSide = duel.a.id === client.me ? duel.b : duel.a;
  const self = { ...me(), ghost: false };
  const opp = oppSide.id
    ? { ...playerById(oppSide.id), ghost: false }
    : { name: oppSide.ghost.name, charId: oppSide.ghost.charId, ghost: true };

  renderLeaderboard();
  showCenter('arena');
  $('fx-layer').innerHTML = '';
  const scene = $('arena-scene');
  scene.innerHTML = sceneHTML({ mode: 'reveal', self, opp, pos: mineSide.pos, oppPos: oppSide.pos });
  $('arena').scrollIntoView({ behavior: 'smooth', block: 'center' });

  await sleep(300);
  await banner(`Rodada ${round}`, 700);
  await banner('FOGO!', 450, 'fire');

  // Os dois saem de trás da parede ao mesmo tempo
  scene.querySelector('.idle').classList.add('gone');
  scene.querySelectorAll('.peek').forEach((p) => p.classList.add('out'));
  Sound.pop();
  await sleep(750);

  // Disparos simultâneos
  fireShot('my-area', 'enemy-area', mineSide);
  fireShot('enemy-area', 'my-area', oppSide);
  Sound.shot();
  await sleep(1100);

  if (!mineSide.hit && !oppSide.hit) await banner('Os dois erraram!', 900, 'small');
  else if (mineSide.hit && oppSide.hit) await banner('Acerto duplo!', 900, 'small');
  await sleep(900);

  if (client.view.round !== round) return; // a rodada já mudou (reconexão lenta)
  client.animating = false;
  renderLeaderboard();
  showResults();
}

/* =====================================================================
 * 10. RESULTADOS E FIM DE JOGO
 * ===================================================================== */

function showResults() {
  const v = client.view;
  const r = v.results;
  if (!r) return;
  showCenter('results-panel');
  renderLeaderboard();
  $('results-title').textContent = `Resultados da rodada ${r.round}`;

  // Frase sobre o meu duelo
  const duel = r.duels.find((d) => d.a.id === client.me || d.b.id === client.me);
  const self = me();
  let text = '';
  if (duel) {
    const mine = duel.a.id === client.me ? duel.a : duel.b;
    const opp = duel.a.id === client.me ? duel.b : duel.a;
    const oppName = escapeHTML(opp.id ? playerById(opp.id).name : opp.ghost.name);
    if (mine.hit && opp.hit) text = `Você acertou ${oppName} e também foi atingido!`;
    else if (mine.hit) text = opp.id ? `Você acertou ${oppName}! −1 de vida para o rival.` : `Você acertou ${oppName}, mas fantasmas não sangram.`;
    else if (opp.hit) text = `${oppName} te acertou. Você perdeu 1 de vida.`;
    else text = 'Ninguém acertou no seu duelo.';
    if (mine.auto) text += ' (Seu tempo acabou: parte da jogada foi sorteada.)';
  }
  if (self && r.eliminated.includes(self.id)) {
    text += ` <b>Você foi eliminado em ${self.place}º lugar.</b>`;
    if (client.defeatRound !== r.round) {
      client.defeatRound = r.round;
      Sound.defeat();
    }
  }
  $('results-me').innerHTML = text;
  $('results-me').hidden = !text;

  // Lista de todos os duelos
  const sideHTML = (s) => {
    const who = s.id ? playerById(s.id) : { ...s.ghost, ghost: true };
    return `<span class="side">${badgeHTML(who)}<b>${escapeHTML(who.name)}</b><span class="res ${s.hit ? 'hit' : 'miss'}">${s.hit ? 'acertou' : 'errou'}</span></span>`;
  };
  let list = r.duels.map((d) => `<li class="duel-line">${sideHTML(d.a)}<span class="vs">VS</span>${sideHTML(d.b)}</li>`).join('');
  list += r.eliminated.map((id) => {
    const p = playerById(id);
    return `<li class="elim-line">✖ ${escapeHTML(p.name)} foi eliminado — ${p.place}º lugar</li>`;
  }).join('');
  $('results-list').innerHTML = list;
  updateTimer();
}

function renderOver() {
  const v = client.view;
  const amHost = v.hostId === client.me;
  const winners = v.players.filter((p) => p.place === 1);
  const self = me();

  $('over-top').textContent = winners.length === 1 ? '★ Campeão ★' : '★ Empate ★';
  $('over-title').textContent = winners.length === 1
    ? `${winners[0].name} venceu!`
    : winners.length > 1 ? 'Ninguém ficou de pé!' : 'Fim de jogo';
  $('over-winners').innerHTML = winners.map((w) => `
    <div class="winner">
      <div class="winner-stage">${cutoutHTML(w, 'up')}</div>
      <div class="char-plate"><b>${escapeHTML(w.name)}</b><small>${getChar(w.charId).name}</small></div>
    </div>`).join('');

  const sorted = v.players.slice().sort((a, b) => (a.place || 99) - (b.place || 99));
  $('over-list').innerHTML = sorted.map((p) => `
    <li class="over-item ${p.id === client.me ? 'me' : ''}">
      <span class="over-place">${p.place ? `${p.place}º` : '–'}</span>
      ${badgeHTML(p)}
      <b>${escapeHTML(p.name)}</b>
      <small>${getChar(p.charId).name}${p.left ? ' · abandonou' : ''}</small>
    </li>`).join('');

  $('btn-again').hidden = !amHost;
  const host = playerById(v.hostId);
  $('over-wait').textContent = amHost ? '' : `Aguardando ${host ? host.name : 'o anfitrião'} começar outra partida…`;

  if (client.overShownFor !== v.code + v.round) {
    client.overShownFor = v.code + v.round;
    if (self && self.place === 1) Sound.victory();
    else Sound.defeat();
  }
}

/* =====================================================================
 * 11. INICIALIZAÇÃO
 * ===================================================================== */

function renderMuteButton() {
  const btn = $('btn-mute');
  btn.innerHTML = Sound.muted ? ICON_SOUND_OFF : ICON_SOUND_ON;
  btn.setAttribute('aria-label', Sound.muted ? 'Ligar som' : 'Desligar som');
  btn.classList.toggle('off', Sound.muted);
}

function init() {
  renderMuteButton();

  // Nome salvo e código vindo do link (?sala=ABCD)
  $('input-name').value = store.get('localStorage', 'duelo-nome') || '';
  const code = new URLSearchParams(location.search).get('sala');
  if (code) $('input-code').value = code.toUpperCase().slice(0, 4);

  $('btn-mute').addEventListener('click', () => {
    Sound.toggleMute();
    renderMuteButton();
    Sound.click();
  });
  $('btn-create').addEventListener('click', createRoom);
  $('btn-join').addEventListener('click', joinRoom);
  $('input-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  $('input-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  $('input-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ($('input-code').value.length === 4 ? joinRoom : createRoom)();
  });

  $('char-grid').addEventListener('click', onCharClick);
  $('btn-copy').addEventListener('click', copyLink);
  $('btn-start').addEventListener('click', startGame);
  $('btn-leave-lobby').addEventListener('click', leaveRoom);
  $('btn-leave-game').addEventListener('click', leaveRoom);
  $('btn-leave-over').addEventListener('click', leaveRoom);
  $('btn-again').addEventListener('click', () => { Sound.click(); Net.send({ t: 'again' }); });

  $('choice-scene').addEventListener('click', onChoiceClick);
  $('btn-confirm').addEventListener('click', confirmChoice);

  setInterval(updateTimer, 250);

  if (location.protocol === 'file:') {
    setNetStatus('Este jogo é online: rode "node server.js" e abra http://localhost:3000');
    return;
  }
  Net.connect();
}

document.addEventListener('DOMContentLoaded', init);
