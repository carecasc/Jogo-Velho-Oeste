/* =====================================================================
 *  DUELO NO VELHO OESTE
 *  Jogo hot-seat para 2 jogadores. JavaScript puro, sem dependências.
 *
 *  Organização do arquivo:
 *    1. Dados fixos (regras, armas, personagens)
 *    2. Estado do jogo
 *    3. Utilidades
 *    4. Áudio (Web Audio API)
 *    5. Arte em SVG (retratos, armas, mira)
 *    6. Renderização de cards
 *    7. Fluxo: telas e seleção de personagem
 *    8. Fluxo: escolhas secretas da rodada
 *    9. Lógica da rodada (resolução de dano e vitória)
 *   10. Revelação animada
 *   11. Resumo e tela de vitória
 *   12. Inicialização
 * ===================================================================== */
'use strict';

/* =====================================================================
 * 1. DADOS FIXOS
 * ===================================================================== */

const MAX_HP = 10;

/* Grade da parede: 2 colunas x 3 linhas. Índice = linha * 2 + coluna. */
const ROWS = ['Em cima', 'Meio', 'Embaixo'];
const COLS = ['Esquerda', 'Direita'];
const SLOT_COUNT = ROWS.length * COLS.length;

const WEAPONS = {
  revolver:   { id: 'revolver',   name: 'Revólver',   damage: 1,  shots: 3 },
  rifle:      { id: 'rifle',      name: 'Rifle',      damage: 5,  shots: 2 },
  espingarda: { id: 'espingarda', name: 'Espingarda', damage: 10, shots: 1 },
};
const WEAPON_ORDER = ['revolver', 'rifle', 'espingarda'];

/* Personagens: apenas visuais (todos seguem as mesmas regras).
 * "look" descreve como o retrato SVG é montado. */
const CHARACTERS = [
  {
    id: 'xerife', name: 'Wyatt Ferro', role: 'Xerife',
    quote: 'Nesta cidade, a lei sou eu.',
    bg: 'linear-gradient(180deg, #f6c177 0%, #e07a3f 70%, #b5482b 100%)',
    look: { skin: '#e0ac7e', hair: '#6b4226', hairStyle: 'short', facial: 'mustache', brows: 'normal',
            hat: 'cowboy', hatColor: '#c9a26b', hatBand: '#5a3519',
            coat: '#7a5230', shirt: '#e9dcc0', scarf: '#9e2a1f', badge: true },
  },
  {
    id: 'foradalei', name: 'Jack Cascavel', role: 'Fora da Lei',
    quote: 'Seu ouro ou sua vida. De preferência os dois.',
    bg: 'linear-gradient(180deg, #5a2a3a 0%, #a8433a 60%, #e07a3f 100%)',
    look: { skin: '#d39b72', hair: '#1f1510', hairStyle: 'short', facial: 'none', brows: 'angry',
            hat: 'cowboy', hatColor: '#231a16', hatBand: '#7a1f1f',
            coat: '#2f2a28', shirt: '#5a4a3c', mask: '#a3242b' },
  },
  {
    id: 'cacador', name: 'Silas Caolho', role: 'Caçador de Recompensas',
    quote: 'Vivo ou morto. Morto pesa menos.',
    bg: 'linear-gradient(180deg, #e9b85c 0%, #c27a3a 60%, #7a4a26 100%)',
    look: { skin: '#b8835a', hair: '#3a2616', hairStyle: 'short', facial: 'stubble', brows: 'angry',
            hat: 'cowboy', hatColor: '#5b4632', hatBand: '#2a1d12',
            coat: '#8f6b3a', accent: '#c43d2b', poncho: true, cigar: true, eyepatch: true },
  },
  {
    id: 'pistoleira', name: 'Rosa Calamidade', role: 'Pistoleira',
    quote: 'Saco a arma antes de você piscar.',
    bg: 'linear-gradient(180deg, #f2a65a 0%, #d9663f 60%, #8e2f2a 100%)',
    look: { skin: '#f0c39b', hair: '#b0412a', hairStyle: 'long', facial: 'none', brows: 'raised', lips: true,
            hat: 'cowboy', hatColor: '#7b2d26', hatBand: '#e8b64a', feather: '#f3e2bd',
            coat: '#5a3a22', shirt: '#f3e2bd', scarf: '#2f6f73' },
  },
  {
    id: 'garimpeiro', name: 'Zé Pepita', role: 'Velho Garimpeiro',
    quote: 'Achei ouro... e chumbo pra você.',
    bg: 'linear-gradient(180deg, #e3cc93 0%, #b88a4a 60%, #6e4a26 100%)',
    look: { skin: '#e5b48e', hair: '#ebe5d9', hairStyle: 'short', facial: 'beard', brows: 'raised',
            hat: 'battered', hatColor: '#8a7458', hatBand: '#5a4a36',
            coat: '#6b5a3e', shirt: '#a33b2a' },
  },
  {
    id: 'pregador', name: 'Padre Ezequiel', role: 'O Pregador',
    quote: 'Reze, forasteiro. Vai precisar.',
    bg: 'linear-gradient(180deg, #7a4b6b 0%, #c4553a 65%, #f0a25a 100%)',
    look: { skin: '#c99572', hair: '#8a857c', hairStyle: 'short', facial: 'none', brows: 'normal',
            hat: 'flat', hatColor: '#1c1a1a', hatBand: '#3a3533',
            coat: '#1f1d1c', shirt: '#1f1d1c', collar: true },
  },
];

/* =====================================================================
 * 2. ESTADO DO JOGO
 * ===================================================================== */

function emptyChoice() {
  return { pos: null, weapon: null, targets: [] };
}

function newPlayer() {
  return { charId: null, hp: MAX_HP, choice: emptyChoice() };
}

const state = {
  phase: 'title',      // title | select | pass | choose | ready | reveal | summary | victory
  round: 1,
  current: 0,          // jogador fazendo as escolhas secretas
  selecting: 0,        // jogador escolhendo personagem
  pendingChar: null,   // card marcado (ainda não confirmado) na seleção
  players: [newPlayer(), newPlayer()],
  lastResults: null,   // resultado da última rodada
  outcome: null,       // null | 0 | 1 (vencedor) | 'draw'
  freshSlot: null,     // casa recém-marcada (só ela anima ao redesenhar)
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

function plural(n, one, many) {
  return n === 1 ? one : many;
}

/* Lê/grava preferências sem quebrar quando o storage está bloqueado. */
const prefs = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* ignora */ }
  },
};

/* =====================================================================
 * 4. ÁUDIO — sons sintetizados com Web Audio API (nenhum arquivo externo)
 * ===================================================================== */

const Sound = (() => {
  let ctx = null;
  let master = null;
  let noise = null;
  let muted = prefs.get('duelo-mudo', '0') === '1';

  /* Cria (ou retoma) o contexto de áudio. Precisa de um gesto do usuário. */
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

  /* Buffer de ruído branco reaproveitado em tiros e poeira. */
  function noiseBuffer(c) {
    if (!noise) {
      const len = Math.floor(c.sampleRate * 1.5);
      noise = c.createBuffer(1, len, c.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return noise;
  }

  /* Rajada de ruído filtrado com envelope (base dos tiros e impactos). */
  function burst(c, { freq, endFreq = 200, dur, gain, type = 'lowpass', at = 0 }) {
    const t = c.currentTime + at;
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

  /* Tom simples com envelope (melodias, ricochete, cliques). */
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

  const SHOT_PROFILE = {
    revolver:   { freq: 3800, dur: 0.32, gain: 0.9, thump: 110, echo: 0.25 },
    rifle:      { freq: 5200, dur: 0.55, gain: 1.0, thump: 80,  echo: 0.4 },
    espingarda: { freq: 2000, dur: 0.9,  gain: 1.3, thump: 55,  echo: 0.3 },
  };

  return {
    get muted() { return muted; },

    toggleMute() {
      muted = !muted;
      prefs.set('duelo-mudo', muted ? '1' : '0');
      if (master) master.gain.value = muted ? 0 : 0.55;
      return muted;
    },

    /* Chamado em cliques para liberar o áudio nos navegadores móveis. */
    unlock() { audio(); },

    shot(weaponId) {
      const c = audio(); if (!c) return;
      const p = SHOT_PROFILE[weaponId] || SHOT_PROFILE.revolver;
      const g = burst(c, { freq: p.freq, endFreq: 250, dur: p.dur, gain: p.gain });
      tone(c, { freq: p.thump * 2, endFreq: p.thump * 0.5, dur: 0.25, gain: 0.8 });
      // Eco do cânion
      const delay = c.createDelay();
      delay.delayTime.value = 0.19;
      const fb = c.createGain();
      fb.gain.value = p.echo;
      g.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(master);
      setTimeout(() => { try { g.disconnect(delay); } catch (e) { /* ok */ } }, 2500);
    },

    ricochet() {
      const c = audio(); if (!c) return;
      tone(c, { freq: 2600 + Math.random() * 800, endFreq: 700, dur: 0.4, gain: 0.08, type: 'sine', at: 0.05 });
    },

    hit() {
      const c = audio(); if (!c) return;
      burst(c, { freq: 600, endFreq: 80, dur: 0.25, gain: 1.0 });
      tone(c, { freq: 160, endFreq: 60, dur: 0.3, gain: 0.5, type: 'triangle' });
    },

    dust() {
      const c = audio(); if (!c) return;
      burst(c, { freq: 900, endFreq: 3000, dur: 0.3, gain: 0.12, type: 'bandpass' });
    },

    click() {
      const c = audio(); if (!c) return;
      tone(c, { freq: 900, endFreq: 500, dur: 0.06, gain: 0.08, type: 'square' });
    },

    error() {
      const c = audio(); if (!c) return;
      tone(c, { freq: 180, dur: 0.18, gain: 0.12, type: 'sawtooth' });
    },

    victory() {
      const c = audio(); if (!c) return;
      // Fanfarra de faroeste: G C E G ... E G
      const notes = [[392, 0.18], [523, 0.18], [659, 0.18], [784, 0.42], [659, 0.18], [784, 0.8]];
      let at = 0;
      notes.forEach(([f, d]) => {
        tone(c, { freq: f, dur: d + 0.1, gain: 0.16, type: 'square', at });
        tone(c, { freq: f / 2, dur: d + 0.1, gain: 0.1, type: 'triangle', at });
        at += d;
      });
    },

    draw() {
      const c = audio(); if (!c) return;
      const notes = [392, 370, 349, 262];
      notes.forEach((f, i) => tone(c, { freq: f, dur: 0.45, gain: 0.14, type: 'sawtooth', at: i * 0.4 }));
    },
  };
})();

/* =====================================================================
 * 5. ARTE EM SVG
 * ===================================================================== */

/* Estrela de xerife (5 pontas). */
function starPoints(cx, cy, outer, inner) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

/* Monta o retrato (busto) de um personagem a partir da descrição "look". */
function portraitSVG(look) {
  const L = look;
  const shade = 'rgba(0,0,0,.22)';
  let s = '<svg class="portrait" viewBox="0 0 120 150" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">';

  // Cabelo comprido (fica atrás da cabeça)
  if (L.hairStyle === 'long') {
    s += `<path d="M34 58 C24 92 28 120 36 136 L84 136 C92 120 96 92 86 58 Z" fill="${L.hair}"/>`;
  }

  // Pescoço
  s += `<rect x="51" y="88" width="18" height="24" fill="${L.skin}"/><rect x="51" y="88" width="18" height="24" fill="${shade}"/>`;

  // Tronco: poncho ou casaco com camisa
  if (L.poncho) {
    s += `<path d="M2 150 L22 112 Q60 98 98 112 L118 150 Z" fill="${L.coat}"/>`;
    let zig = 'M16 126';
    for (let x = 16, down = true; x < 104; x += 8, down = !down) zig += ` L${x + 8} ${down ? 132 : 126}`;
    s += `<path d="${zig}" fill="none" stroke="${L.accent}" stroke-width="3"/>`;
    s += `<path d="M10 140 L110 140" stroke="${L.accent}" stroke-width="4"/>`;
    s += `<path d="M10 145 L110 145" stroke="#f3e2bd" stroke-width="2"/>`;
  } else {
    s += `<path d="M8 150 C12 120 32 108 60 106 C88 108 108 120 112 150 Z" fill="${L.coat}"/>`;
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
  s += `<ellipse cx="38" cy="75" rx="4" ry="6" fill="${L.skin}"/><ellipse cx="82" cy="75" rx="4" ry="6" fill="${L.skin}"/>`;
  s += `<ellipse cx="60" cy="72" rx="22" ry="26" fill="${L.skin}"/>`;

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
    s += `<rect x="40" y="34" width="40" height="26" rx="3" fill="${L.hatColor}"/>`;
    s += `<rect x="40" y="52" width="40" height="6" fill="${L.hatBand}"/>`;
    s += `<ellipse cx="60" cy="60" rx="46" ry="6.5" fill="${L.hatColor}"/>`;
    s += '<ellipse cx="60" cy="58.5" rx="44" ry="3" fill="rgba(255,255,255,.07)"/>';
  } else if (L.hat === 'battered') {
    s += `<path d="M38 61 C36 42 42 28 56 31 C62 24 77 28 82 37 C84 45 83 53 82 61 Z" fill="${L.hatColor}"/>`;
    s += `<path d="M38 54 L82 54 L82 60 L38 60 Z" fill="${L.hatBand}"/>`;
    s += '<rect x="63" y="38" width="9" height="8" fill="#a8896a" transform="rotate(12 67 42)"/>';
    s += '<path d="M64 38 l2 2 m2 -2 l2 2 m-6 4 l2 2" stroke="#3a2c1e" stroke-width=".8"/>';
    s += `<path d="M12 63 Q20 56 60 57 Q100 56 108 66 Q100 71 60 68 Q20 69 12 63 Z" fill="${L.hatColor}"/>`;
    s += '<circle cx="48" cy="40" r="1.6" fill="#2a1d12"/>';
  } else {
    // Chapéu de caubói clássico (copa amassada + aba curvada)
    s += `<path d="M38 60 C36 36 44 22 52 26 Q60 31 68 26 C76 22 84 36 82 60 Z" fill="${L.hatColor}"/>`;
    s += '<path d="M52 26 Q60 31 68 26 Q62 40 60 44 Q58 40 52 26 Z" fill="rgba(0,0,0,.2)"/>';
    s += `<path d="M38 52 L82 52 L82 60 L38 60 Z" fill="${L.hatBand}"/>`;
    if (L.feather) s += `<path d="M78 54 C90 44 96 30 92 22 C88 34 82 44 76 52 Z" fill="${L.feather}" stroke="rgba(0,0,0,.25)" stroke-width=".8"/>`;
    s += `<path d="M8 51 Q18 67 60 67 Q102 67 112 51 Q96 60 60 59 Q24 60 8 51 Z" fill="${L.hatColor}"/>`;
    s += '<path d="M8 51 Q18 67 60 67 Q102 67 112 51 Q100 64 60 64 Q20 64 8 51 Z" fill="rgba(0,0,0,.25)"/>';
  }

  s += '</svg>';
  return s;
}

/* Ícones das armas (silhuetas simples). */
const WEAPON_ICONS = {
  revolver:
    '<svg viewBox="0 0 100 50" aria-hidden="true"><path d="M8 14 H58 V20 H8 Z"/><rect x="40" y="10" width="22" height="16" rx="5"/><path d="M60 12 H72 L76 20 L66 22 Z"/><path d="M58 22 L72 22 L84 46 L70 48 L62 30 Z"/><path d="M50 26 Q50 36 58 34" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
  rifle:
    '<svg viewBox="0 0 100 50" aria-hidden="true"><path d="M2 18 H62 V22 H2 Z"/><path d="M10 23 H56 V26 H10 Z"/><path d="M56 16 H70 V28 H56 Z"/><path d="M70 17 L98 22 L98 36 L70 28 Z"/><path d="M60 28 Q60 38 68 36" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
  espingarda:
    '<svg viewBox="0 0 100 50" aria-hidden="true"><path d="M2 15 H58 V20 H2 Z"/><path d="M2 21 H58 V26 H2 Z"/><path d="M56 14 H70 V29 H56 Z"/><path d="M70 15 L98 22 L98 40 L70 30 Z"/><path d="M60 29 Q60 39 68 37" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
};

const CROSSHAIR_SVG =
  '<svg class="crosshair" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="13" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="20" cy="20" r="2.5" fill="currentColor"/><path d="M20 1 V11 M20 29 V39 M1 20 H11 M29 20 H39" stroke="currentColor" stroke-width="3"/></svg>';

const ICON_SOUND_ON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9 H7 L12 4 V20 L7 15 H3 Z" fill="currentColor"/><path d="M15.5 8.5 Q18 12 15.5 15.5 M18 6 Q22 12 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_SOUND_OFF =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9 H7 L12 4 V20 L7 15 H3 Z" fill="currentColor"/><path d="M16 9 L22 15 M22 9 L16 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

/* =====================================================================
 * 6. RENDERIZAÇÃO DE CARDS
 * ===================================================================== */

/* HTML de um card colecionável. opts: { player, hp } */
function cardHTML(char, opts = {}) {
  const hp = opts.hp ?? MAX_HP;
  const tag = opts.player != null ? `<div class="card-player">Jogador ${opts.player + 1}</div>` : '';
  return `
    <div class="card" data-char="${char.id}" style="--hp:${hp}">
      ${tag}
      <div class="card-inner">
        <div class="card-name">${char.name}</div>
        <div class="card-art" style="background:${char.bg}">${portraitSVG(char.look)}</div>
        <div class="card-role">${char.role}</div>
        <div class="card-life" aria-label="Vida ${hp} de ${MAX_HP}">
          <span class="life-icon" aria-hidden="true">♥</span>
          <div class="life-bar"><div class="life-fill"></div></div>
          <span class="life-num">${hp}</span>
        </div>
        <p class="card-quote">“${char.quote}”</p>
      </div>
    </div>`;
}

/* Desenha os cards dos dois jogadores nas laterais da partida. */
function renderSides() {
  state.players.forEach((pl, i) => {
    $(`side-${i}`).innerHTML = cardHTML(getChar(pl.charId), { player: i, hp: pl.hp });
    updateLife(i);
  });
}

/* Atualiza a barra de vida de um jogador; opcionalmente anima o dano. */
function updateLife(i, damage = 0) {
  const card = $(`side-${i}`).querySelector('.card');
  if (!card) return;
  const hp = state.players[i].hp;
  card.style.setProperty('--hp', hp);
  card.querySelector('.life-num').textContent = hp;
  card.querySelector('.card-life').setAttribute('aria-label', `Vida ${hp} de ${MAX_HP}`);
  card.classList.toggle('low', hp > 0 && hp <= 3);
  card.classList.toggle('dead', hp <= 0);

  if (damage > 0) {
    card.classList.remove('shake');
    void card.offsetWidth; // reinicia a animação
    card.classList.add('shake');
    const f = document.createElement('div');
    f.className = 'dmg-float';
    f.textContent = `-${damage}`;
    card.appendChild(f);
    setTimeout(() => f.remove(), 1400);
  }
}

/* =====================================================================
 * 7. FLUXO: TELAS E SELEÇÃO DE PERSONAGEM
 * ===================================================================== */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  window.scrollTo(0, 0);
}

function showOverlay(id) {
  $(id).classList.add('active');
  const btn = $(id).querySelector('button');
  if (btn) setTimeout(() => btn.focus(), 50);
}

function hideOverlay(id) {
  $(id).classList.remove('active');
}

function startSelection() {
  state.players = [newPlayer(), newPlayer()];
  state.selecting = 0;
  state.pendingChar = null;
  state.phase = 'select';
  renderSelect();
  showScreen('screen-select');
}

function renderSelect() {
  const p = state.selecting;
  const other = state.players[1 - p].charId;
  $('select-title').textContent = `Jogador ${p + 1}, escolha seu pistoleiro`;
  $('select-hint').textContent = p === 0
    ? 'Toque em um card e confirme.'
    : 'O Jogador 2 escolhe agora. Personagens já escolhidos ficam bloqueados.';
  $('select-error').textContent = '';
  $('btn-select-back').textContent = p === 0 ? 'Voltar' : 'Voltar ao Jogador 1';

  $('char-grid').innerHTML = CHARACTERS.map((c) => {
    const taken = c.id === other && p === 1;
    const selected = state.pendingChar === c.id;
    return `
      <button type="button" role="listitem" class="card-btn ${selected ? 'selected' : ''} ${taken ? 'taken' : ''}"
              data-char="${c.id}" ${taken ? 'disabled' : ''}
              aria-pressed="${selected}" aria-label="${c.name}, ${c.role}${taken ? ' (já escolhido)' : ''}">
        ${cardHTML(c)}
        ${taken ? '<span class="stamp">J1</span>' : ''}
      </button>`;
  }).join('');
}

function onCharClick(e) {
  const btn = e.target.closest('.card-btn');
  if (!btn || btn.disabled) return;
  Sound.click();
  state.pendingChar = btn.dataset.char;
  renderSelect();
  const again = $('char-grid').querySelector(`[data-char="${state.pendingChar}"]`);
  if (again) again.focus();
}

function confirmSelection() {
  if (!state.pendingChar) {
    $('select-error').textContent = 'Escolha um personagem antes de confirmar.';
    Sound.error();
    return;
  }
  Sound.click();
  state.players[state.selecting].charId = state.pendingChar;
  state.pendingChar = null;
  if (state.selecting === 0) {
    state.selecting = 1;
    renderSelect();
    window.scrollTo(0, 0);
  } else {
    startMatch();
  }
}

function selectionBack() {
  if (state.selecting === 1) {
    state.selecting = 0;
    state.pendingChar = state.players[0].charId;
    state.players[0].charId = null;
    renderSelect();
  } else {
    state.phase = 'title';
    showScreen('screen-title');
  }
}

/* Começa (ou recomeça) uma partida com os personagens já escolhidos. */
function startMatch() {
  state.players.forEach((pl) => { pl.hp = MAX_HP; pl.choice = emptyChoice(); });
  state.round = 1;
  state.outcome = null;
  renderSides();
  showScreen('screen-game');
  beginRound();
}

/* =====================================================================
 * 8. FLUXO: ESCOLHAS SECRETAS DA RODADA
 * ===================================================================== */

function beginRound() {
  state.players.forEach((pl) => { pl.choice = emptyChoice(); });
  state.current = 0;
  $('round-num').textContent = state.round;
  showPass(0);
}

/* Tela de passagem: esconde tudo e pede para o outro jogador não olhar. */
function showPass(p) {
  state.phase = 'pass';
  state.current = p;
  clearChoicePanel();
  $('pass-round').textContent = `Rodada ${state.round}`;
  $('pass-title').textContent = `Vez do Jogador ${p + 1}`;
  $('pass-warning').textContent = `O Jogador ${2 - p} não pode olhar!`;
  const ch = getChar(state.players[p].charId);
  $('pass-portrait').innerHTML = `<div class="pass-art" style="background:${ch.bg}">${portraitSVG(ch.look)}</div><div class="pass-name">${ch.name}</div>`;
  showOverlay('overlay-pass');
}

function startChoice() {
  Sound.unlock();
  Sound.click();
  hideOverlay('overlay-pass');
  state.phase = 'choose';
  showCenter('choice');
  $('phase-label').textContent = `Jogador ${state.current + 1} escolhendo…`;
  renderChoice();
  window.scrollTo(0, 0);
}

/* Alterna o centro da tela entre painel de escolha e arena. */
function showCenter(which) {
  $('choice-panel').hidden = which !== 'choice';
  $('arena').hidden = which !== 'arena';
}

/* Apaga as escolhas da tela para não vazar nada na troca de jogador. */
function clearChoicePanel() {
  $('weapon-list').innerHTML = '';
  $('walls-row').innerHTML = '';
  $('choice-status').textContent = '';
}

/* Lista o que falta para a jogada ser válida. */
function validateChoice(c) {
  const missing = [];
  if (!c.weapon) missing.push('escolher uma arma');
  if (c.pos === null) missing.push('escolher onde vai aparecer');
  if (!c.weapon) {
    missing.push('marcar os alvos');
  } else {
    const need = WEAPONS[c.weapon].shots - c.targets.length;
    if (need > 0) missing.push(`marcar mais ${need} ${plural(need, 'alvo', 'alvos')}`);
  }
  return missing;
}

function wallSlotsHTML(kind, choice, char) {
  let html = '';
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (kind === 'own') {
      const sel = choice.pos === i;
      const fresh = sel && state.freshSlot === `own-${i}` ? 'fresh' : '';
      html += `<button type="button" class="slot ${sel ? 'selected' : ''} ${fresh}" data-own-slot="${i}"
                 aria-pressed="${sel}" aria-label="Aparecer em ${posName(i)}">
                 ${sel ? `<span class="slot-fig">${portraitSVG(char.look)}</span>` : '<span class="slot-hint">?</span>'}
               </button>`;
    } else {
      const order = choice.targets.indexOf(i);
      const sel = order !== -1;
      const locked = !choice.weapon;
      const fresh = sel && state.freshSlot === `target-${i}` ? 'fresh' : '';
      html += `<button type="button" class="slot target ${sel ? 'selected' : ''} ${locked ? 'locked' : ''} ${fresh}" data-target-slot="${i}"
                 aria-pressed="${sel}" aria-label="Atirar em ${posName(i)}">
                 ${sel ? `${CROSSHAIR_SVG}<span class="slot-order">${order + 1}</span>` : ''}
               </button>`;
    }
  }
  return html;
}

/* Desenha o painel de escolhas do jogador atual. */
function renderChoice() {
  const p = state.current;
  const me = state.players[p];
  const enemy = state.players[1 - p];
  const ch = getChar(me.charId);
  const c = me.choice;

  // Lembra o foco para restaurá-lo depois de redesenhar
  const active = document.activeElement;
  const focusKey = active && active.dataset
    ? Object.keys(active.dataset).map((k) => `[data-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}="${active.dataset[k]}"]`).join('')
    : '';

  $('choice-title').textContent = `Jogador ${p + 1} — ${ch.name}`;

  // Armas
  $('weapon-list').innerHTML = WEAPON_ORDER.map((id) => {
    const w = WEAPONS[id];
    const sel = c.weapon === id;
    return `<button type="button" class="weapon-btn ${sel ? 'selected' : ''}" data-weapon="${id}" aria-pressed="${sel}">
              <span class="w-icon">${WEAPON_ICONS[id]}</span>
              <span class="w-name">${w.name}</span>
              <span class="w-stats"><b>${w.damage}</b> de dano · <b>${w.shots}</b> ${plural(w.shots, 'alvo', 'alvos')}</span>
            </button>`;
  }).join('');

  // Paredes: mesma disposição da arena (J1 à esquerda, J2 à direita)
  const shots = c.weapon ? WEAPONS[c.weapon].shots : 0;
  const ownBox = `
    <div class="wall-box own">
      <h3><span class="step-n">2</span> Onde você aparece</h3>
      <div class="wall-caption">Sua parede</div>
      <div class="wall pick-wall">${wallSlotsHTML('own', c, ch)}</div>
      <p class="wall-note">${c.pos !== null ? posName(c.pos) : 'Escolha 1 posição'}</p>
    </div>`;
  const enemyBox = `
    <div class="wall-box enemy">
      <h3><span class="step-n">3</span> Onde atirar <span class="counter ${c.weapon && c.targets.length === shots ? 'done' : ''}">${c.targets.length}/${shots || '–'}</span></h3>
      <div class="wall-caption">Parede de ${getChar(enemy.charId).name}</div>
      <div class="wall pick-wall">${wallSlotsHTML('enemy', c, ch)}</div>
      <p class="wall-note">${c.weapon ? `Marque ${shots} ${plural(shots, 'posição', 'posições')}` : 'Escolha a arma primeiro'}</p>
    </div>`;
  $('walls-row').innerHTML = p === 0 ? ownBox + enemyBox : enemyBox + ownBox;
  state.freshSlot = null;

  // Situação da jogada
  const missing = validateChoice(c);
  const status = $('choice-status');
  status.classList.remove('error');
  status.textContent = missing.length ? `Falta: ${missing.join(', ')}.` : 'Tudo pronto! Confirme sua jogada.';
  status.classList.toggle('ok', missing.length === 0);
  $('btn-confirm').classList.toggle('not-ready', missing.length > 0);
  $('btn-confirm').setAttribute('aria-disabled', String(missing.length > 0));

  if (focusKey) {
    const el = $('choice-panel').querySelector(focusKey);
    if (el) el.focus();
  }
}

/* Cliques dentro do painel de escolha (delegação de eventos). */
function onChoiceClick(e) {
  if (state.phase !== 'choose') return;
  const c = state.players[state.current].choice;
  const weaponBtn = e.target.closest('[data-weapon]');
  const ownBtn = e.target.closest('[data-own-slot]');
  const targetBtn = e.target.closest('[data-target-slot]');

  if (weaponBtn) {
    c.weapon = weaponBtn.dataset.weapon;
    // Se a nova arma tem menos tiros, mantém só os primeiros alvos
    c.targets = c.targets.slice(0, WEAPONS[c.weapon].shots);
    Sound.click();
  } else if (ownBtn) {
    c.pos = Number(ownBtn.dataset.ownSlot);
    state.freshSlot = `own-${c.pos}`;
    Sound.click();
  } else if (targetBtn) {
    if (!c.weapon) {
      flashStatus('Escolha a arma primeiro — ela define quantos alvos você pode marcar.');
      return;
    }
    const slot = Number(targetBtn.dataset.targetSlot);
    const idx = c.targets.indexOf(slot);
    const max = WEAPONS[c.weapon].shots;
    if (idx !== -1) {
      c.targets.splice(idx, 1);
    } else if (c.targets.length < max) {
      c.targets.push(slot);
      state.freshSlot = `target-${slot}`;
    } else {
      flashStatus(`${WEAPONS[c.weapon].name} só permite ${max} ${plural(max, 'alvo', 'alvos')}. Desmarque um antes.`);
      return;
    }
    Sound.click();
  } else {
    return;
  }
  renderChoice();
}

/* Mostra um aviso de erro na linha de status. */
function flashStatus(msg) {
  const status = $('choice-status');
  status.textContent = msg;
  status.classList.remove('ok', 'error');
  void status.offsetWidth;
  status.classList.add('error');
  Sound.error();
}

function confirmChoice() {
  if (state.phase !== 'choose') return;
  const missing = validateChoice(state.players[state.current].choice);
  if (missing.length) {
    flashStatus(`Ainda não dá para confirmar. Falta: ${missing.join(', ')}.`);
    return;
  }
  Sound.click();
  if (state.current === 0) {
    showPass(1);
  } else {
    state.phase = 'ready';
    clearChoicePanel();
    $('phase-label').textContent = 'Prontos para o duelo';
    showOverlay('overlay-ready');
  }
}

/* =====================================================================
 * 9. LÓGICA DA RODADA
 * ===================================================================== */

/* Calcula o resultado dos disparos de cada jogador (sem alterar o estado). */
function resolveRound(players) {
  return players.map((shooter, i) => {
    const target = players[1 - i];
    const weapon = WEAPONS[shooter.choice.weapon];
    const hit = shooter.choice.targets.includes(target.choice.pos);
    return { hit, damage: hit ? weapon.damage : 0 };
  });
}

/* Aplica o dano simultaneamente e retorna o desfecho da partida. */
function applyResults(results) {
  state.players[1].hp = Math.max(0, state.players[1].hp - results[0].damage);
  state.players[0].hp = Math.max(0, state.players[0].hp - results[1].damage);
  return checkOutcome();
}

/* null = continua; 0/1 = índice do vencedor; 'draw' = empate. */
function checkOutcome() {
  const dead = state.players.map((pl) => pl.hp <= 0);
  if (dead[0] && dead[1]) return 'draw';
  if (dead[0]) return 1;
  if (dead[1]) return 0;
  return null;
}

/* =====================================================================
 * 10. REVELAÇÃO ANIMADA
 * ===================================================================== */

function arenaSlot(player, pos) {
  return $(`arena-wall-${player}`).children[pos];
}

/* Monta as paredes vazias da arena com os pistoleiros escondidos. */
function buildArena() {
  $('fx-layer').innerHTML = '';
  state.players.forEach((pl, i) => {
    const ch = getChar(pl.charId);
    let html = '';
    for (let s = 0; s < SLOT_COUNT; s++) {
      html += `<div class="arena-slot">${s === pl.choice.pos ? `<div class="figure">${portraitSVG(ch.look)}</div>` : ''}</div>`;
    }
    $(`arena-wall-${i}`).innerHTML = html;
    const w = WEAPONS[pl.choice.weapon];
    $(`arena-label-${i}`).innerHTML = `J${i + 1} · ${ch.name}<span>${w.name}</span>`;
  });
  const tw = $('arena').querySelector('.tumbleweed');
  tw.classList.remove('roll');
  void tw.offsetWidth;
  tw.classList.add('roll');
}

async function banner(text, ms = 700, cls = '') {
  const b = $('arena-banner');
  b.className = `arena-banner show ${cls}`;
  b.textContent = text;
  await sleep(ms);
  b.className = 'arena-banner';
}

/* Posição do centro de um elemento relativa à arena. */
function centerIn(el, base) {
  const r = el.getBoundingClientRect();
  const b = base.getBoundingClientRect();
  return { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height / 2, w: r.width, h: r.height };
}

function fx(className, x, y, life = 900, text = '') {
  const el = document.createElement('div');
  el.className = `fx ${className}`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  if (text) el.textContent = text;
  $('fx-layer').appendChild(el);
  setTimeout(() => el.remove(), life);
  return el;
}

/* Nuvem de poeira: algumas partículas espalhando. */
function dustPuff(x, y, count = 6, size = 1) {
  for (let i = 0; i < count; i++) {
    const p = fx('dust', x, y, 900);
    const ang = Math.random() * Math.PI * 2;
    const dist = (14 + Math.random() * 22) * size;
    p.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(ang) * dist - 10}px`);
    p.style.setProperty('--s', (0.6 + Math.random() * 0.8) * size);
  }
}

/* Marca de bala dentro de um buraco da parede (coordenadas da arena). */
function bulletHole(slotEl, x, y, hit) {
  const arena = $('arena');
  const c = centerIn(slotEl, arena);
  const hole = document.createElement('div');
  hole.className = `hole ${hit ? 'hole-hit' : ''}`;
  hole.style.left = `${((x - (c.x - c.w / 2)) / c.w) * 100}%`;
  hole.style.top = `${((y - (c.y - c.h / 2)) / c.h) * 100}%`;
  slotEl.appendChild(hole);
}

/* Um disparo: clarão, rastro da bala e efeito de acerto ou erro. */
function fireShot(shooterIdx, targetPos) {
  const arena = $('arena');
  const shooter = state.players[shooterIdx];
  const victim = state.players[1 - shooterIdx];
  const weapon = shooter.choice.weapon;
  const dir = shooterIdx === 0 ? 1 : -1;

  const from = centerIn(arenaSlot(shooterIdx, shooter.choice.pos), arena);
  from.x += dir * from.w * 0.42;
  const targetEl = arenaSlot(1 - shooterIdx, targetPos);
  const to = centerIn(targetEl, arena);
  const isHit = targetPos === victim.choice.pos;
  const pellets = weapon === 'espingarda' ? 5 : 1;

  // Clarão na boca do cano
  const flash = fx(`muzzle muzzle-${weapon}`, from.x, from.y, 260);
  flash.style.setProperty('--dir', dir);

  for (let k = 0; k < pellets; k++) {
    const tx = to.x + (Math.random() - 0.5) * to.w * (pellets > 1 ? 0.7 : 0.35);
    const ty = to.y + (Math.random() - 0.5) * to.h * (pellets > 1 ? 0.7 : 0.35);
    // Rastro da bala
    const dx = tx - from.x;
    const dy = ty - from.y;
    const tracer = fx(`tracer tracer-${weapon}`, from.x, from.y, 400);
    tracer.style.width = `${Math.hypot(dx, dy)}px`;
    const rot = `rotate(${Math.atan2(dy, dx)}rad)`;
    tracer.animate(
      [{ transform: `${rot} scaleX(0)`, opacity: 1 }, { transform: `${rot} scaleX(1)`, opacity: 1, offset: 0.5 }, { transform: `${rot} scaleX(1)`, opacity: 0 }],
      { duration: 340, easing: 'ease-out', fill: 'forwards' }
    );
    setTimeout(() => bulletHole(targetEl, tx, ty, isHit), 170);
    if (!isHit) setTimeout(() => dustPuff(tx, ty, pellets > 1 ? 3 : 6), 170);
  }

  Sound.shot(weapon);
  targetEl.classList.add('shot');

  setTimeout(() => {
    if (isHit) {
      targetEl.classList.add('hit');
      const fig = targetEl.querySelector('.figure');
      if (fig) {
        fig.classList.remove('struck');
        void fig.offsetWidth;
        fig.classList.add('struck');
      }
      fx('hit-burst', to.x, to.y - to.h * 0.2, 1100, 'ACERTOU!');
      Sound.hit();
    } else if (Math.random() < 0.6) {
      Sound.ricochet();
    }
  }, 170);
}

/* Sequência completa da revelação simultânea. */
async function runReveal() {
  hideOverlay('overlay-ready');
  Sound.unlock();
  state.phase = 'reveal';
  showCenter('arena');
  $('phase-label').textContent = 'Revelação!';
  buildArena();
  window.scrollTo({ top: $('arena').getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });

  await sleep(400);
  await banner('Preparar…', 650);
  await banner('FOGO!', 500, 'fire');

  // Os dois pistoleiros saem de trás da parede ao mesmo tempo
  state.players.forEach((pl, i) => {
    const slot = arenaSlot(i, pl.choice.pos);
    slot.querySelector('.figure').classList.add('up');
    const c = centerIn(slot, $('arena'));
    dustPuff(c.x, c.y + c.h * 0.45, 5, 0.8);
  });
  Sound.dust();
  await sleep(750);

  // Disparos simultâneos: o i-ésimo tiro de cada jogador sai junto
  const maxShots = Math.max(...state.players.map((pl) => pl.choice.targets.length));
  for (let i = 0; i < maxShots; i++) {
    state.players.forEach((pl, p) => {
      if (pl.choice.targets[i] !== undefined) fireShot(p, pl.choice.targets[i]);
    });
    await sleep(750);
  }

  // Resultado e dano
  const results = resolveRound(state.players);
  state.lastResults = results;
  state.outcome = applyResults(results);
  results.forEach((r, shooter) => updateLife(1 - shooter, r.damage));
  if (!results[0].hit && !results[1].hit) await banner('Ninguém acertou!', 900, 'small');

  // Quem caiu, cai
  state.players.forEach((pl, i) => {
    if (pl.hp <= 0) arenaSlot(i, pl.choice.pos).querySelector('.figure').classList.add('down');
  });
  await sleep(1100);

  showSummary(results);
}

/* =====================================================================
 * 11. RESUMO DA RODADA E TELA DE VITÓRIA
 * ===================================================================== */

function showSummary(results) {
  state.phase = 'summary';
  $('summary-title').textContent = `Resumo da Rodada ${state.round}`;
  $('summary-body').innerHTML = state.players.map((pl, i) => {
    const ch = getChar(pl.charId);
    const w = WEAPONS[pl.choice.weapon];
    const r = results[i];
    const enemyName = getChar(state.players[1 - i].charId).name;
    return `
      <div class="sum-player ${r.hit ? 'hit' : 'miss'}">
        <div class="sum-head">
          <div class="sum-art" style="background:${ch.bg}">${portraitSVG(ch.look)}</div>
          <div><div class="sum-tag">Jogador ${i + 1}</div><div class="sum-name">${ch.name}</div></div>
        </div>
        <ul>
          <li>Apareceu em: <b>${posName(pl.choice.pos)}</b></li>
          <li>Arma: <b>${w.name}</b></li>
          <li>Atirou em: <b>${pl.choice.targets.map(posName).join('; ')}</b></li>
        </ul>
        <div class="sum-result">${r.hit ? `Acertou ${enemyName}! <b>${r.damage}</b> de dano` : 'Errou todos os tiros'}</div>
        <div class="sum-hp">Vida: <b>${pl.hp}</b>/${MAX_HP}</div>
      </div>`;
  }).join('');
  $('btn-next').textContent = state.outcome === null ? 'Próxima rodada' : 'Ver resultado';
  showOverlay('overlay-summary');
}

function nextFromSummary() {
  Sound.click();
  hideOverlay('overlay-summary');
  if (state.outcome === null) {
    state.round += 1;
    beginRound();
  } else {
    showVictory();
  }
}

function showVictory() {
  state.phase = 'victory';
  const out = state.outcome;
  const cards = $('victory-cards');
  if (out === 'draw') {
    $('victory-top').textContent = 'EMPATE';
    $('victory-title').textContent = 'Os dois caíram juntos!';
    $('victory-text').textContent = 'Nenhum pistoleiro saiu de pé. O deserto guarda os dois.';
    cards.innerHTML = state.players.map((pl, i) => cardHTML(getChar(pl.charId), { player: i, hp: 0 })).join('');
    cards.classList.add('draw');
    Sound.draw();
  } else {
    const winner = state.players[out];
    const ch = getChar(winner.charId);
    $('victory-top').textContent = 'VENCEDOR';
    $('victory-title').textContent = `Jogador ${out + 1} venceu!`;
    $('victory-text').textContent = `${ch.name} venceu o duelo em ${state.round} ${plural(state.round, 'rodada', 'rodadas')} com ${winner.hp} de vida. “${ch.quote}”`;
    cards.innerHTML = cardHTML(ch, { player: out, hp: winner.hp });
    cards.classList.remove('draw');
    Sound.victory();
  }
  showScreen('screen-victory');
  setTimeout(() => $('btn-rematch').focus(), 50);
}

/* =====================================================================
 * 12. INICIALIZAÇÃO
 * ===================================================================== */

function renderMuteButton() {
  const btn = $('btn-mute');
  btn.innerHTML = Sound.muted ? ICON_SOUND_OFF : ICON_SOUND_ON;
  btn.setAttribute('aria-label', Sound.muted ? 'Ligar som' : 'Desligar som');
  btn.classList.toggle('off', Sound.muted);
}

function init() {
  renderMuteButton();

  $('btn-mute').addEventListener('click', () => {
    Sound.toggleMute();
    renderMuteButton();
    Sound.click();
  });

  $('btn-start').addEventListener('click', () => {
    Sound.unlock();
    Sound.click();
    startSelection();
  });

  $('char-grid').addEventListener('click', onCharClick);
  $('btn-select-confirm').addEventListener('click', confirmSelection);
  $('btn-select-back').addEventListener('click', () => { Sound.click(); selectionBack(); });

  $('btn-pass').addEventListener('click', startChoice);
  $('choice-panel').addEventListener('click', onChoiceClick);
  $('btn-confirm').addEventListener('click', confirmChoice);
  $('btn-reveal').addEventListener('click', runReveal);
  $('btn-next').addEventListener('click', nextFromSummary);

  $('btn-rematch').addEventListener('click', () => { Sound.click(); startMatch(); });
  $('btn-newchars').addEventListener('click', () => { Sound.click(); startSelection(); });
}

document.addEventListener('DOMContentLoaded', init);
