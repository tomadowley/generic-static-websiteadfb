const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d", { alpha: false });
const overlay = document.querySelector("#overlay");
const startButton = document.querySelector("#startButton");

const TWO_PI = Math.PI * 2;
const FOV = Math.PI / 3;
const WALL_HEIGHT = 520;
const MOVE_SPEED = 3.25;
const TURN_SPEED = 2.65;
const CELL = 64;
const ENEMY_RADIUS = 0.32;
const PLAYER_RADIUS = 0.2;
const MAX_DEPTH = 18;

const TILE = {
  EMPTY: 0,
  STONE: 1,
  TECH: 2,
  DOOR: 3,
  LOCKED: 4,
  EXIT: 5,
};

const textures = [
  null,
  { base: "#6f4035", dark: "#2b1816", light: "#b46f58", line: "#3c211d" },
  { base: "#304350", dark: "#142027", light: "#6f98a4", line: "#1d2c33" },
  { base: "#7a4c21", dark: "#2a170b", light: "#d49c43", line: "#553215" },
  { base: "#7d1816", dark: "#2b0504", light: "#ff5a42", line: "#4b0d0b" },
  { base: "#21472f", dark: "#0b1f13", light: "#5fd17f", line: "#15301f" },
];

const level = [
  "11111111111111111111",
  "1P000000001000000001",
  "10001111100001111101",
  "10001000101101000101",
  "10000000101001030001",
  "11101110101011011101",
  "10001000001000010001",
  "10111011111101110101",
  "10000010000010000101",
  "10311010111010111001",
  "10001010001010100001",
  "10101011101010111101",
  "10100000001000000001",
  "10111101111111011101",
  "10000001000000010001",
  "10111111011111110101",
  "10000000000000000K51",
  "11111111111111111111",
];

const state = {
  running: false,
  paused: false,
  victory: false,
  gameOver: false,
  audio: null,
  time: 0,
  shake: 0,
  flash: 0,
  message: "Find the red key and reach the green exit.",
  messageTimer: 5,
  showMap: true,
  keys: Object.create(null),
  mouseActive: false,
  player: {
    x: 1.5,
    y: 1.5,
    angle: 0,
    health: 100,
    armor: 25,
    ammo: 42,
    score: 0,
    key: false,
    weaponCooldown: 0,
    bob: 0,
    hurtTimer: 0,
  },
  map: [],
  doors: new Map(),
  enemies: [],
  pickups: [],
  particles: [],
  projectiles: [],
  zBuffer: [],
};

function parseLevel() {
  state.map = level.map((row, y) =>
    [...row].map((char, x) => {
      if (char === "P") {
        state.player.x = x + 0.5;
        state.player.y = y + 0.5;
        return TILE.EMPTY;
      }
      if (char === "E") {
        state.enemies.push(createEnemy(x + 0.5, y + 0.5, "brute"));
        return TILE.EMPTY;
      }
      if (char === "K") {
        state.pickups.push({ x: x + 0.5, y: y + 0.5, type: "key", taken: false });
        return TILE.EMPTY;
      }
      return Number(char);
    })
  );

  [
    [5.5, 2.5, "ammo"], [14.5, 3.5, "health"], [3.5, 4.5, "armor"],
    [17.5, 5.5, "ammo"], [7.5, 8.5, "health"], [15.5, 10.5, "ammo"],
    [2.5, 13.5, "health"], [11.5, 14.5, "armor"], [9.5, 16.5, "ammo"],
  ].forEach(([x, y, type]) => state.pickups.push({ x, y, type, taken: false }));

  [
    [10.5, 4.5, "runner"], [6.5, 6.5, "sentinel"], [13.5, 7.5, "runner"],
    [4.5, 10.5, "sentinel"], [16.5, 12.5, "brute"], [6.5, 15.5, "runner"],
    [13.5, 15.5, "sentinel"],
  ].forEach(([x, y, type]) => state.enemies.push(createEnemy(x, y, type)));
}

function createEnemy(x, y, type) {
  const stats = {
    runner: { health: 42, speed: 1.35, damage: 9, color: "#e14b39", score: 150, ranged: false },
    sentinel: { health: 60, speed: 0.9, damage: 12, color: "#d58b39", score: 220, ranged: true },
    brute: { health: 105, speed: 0.62, damage: 18, color: "#9b2a25", score: 400, ranged: true },
  }[type];

  return {
    x,
    y,
    type,
    health: stats.health,
    maxHealth: stats.health,
    speed: stats.speed,
    damage: stats.damage,
    color: stats.color,
    score: stats.score,
    ranged: stats.ranged,
    state: "idle",
    attackTimer: 0,
    pain: 0,
    dead: false,
  };
}

function ensureAudio() {
  if (state.audio) return state.audio;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  const context = new AudioContext();
  const master = context.createGain();
  master.gain.value = 0.08;
  master.connect(context.destination);
  state.audio = { context, master };
  return state.audio;
}

function playTone(frequency, duration, type = "square", volume = 1, slide = 0) {
  const audio = ensureAudio();
  if (!audio) return;
  const { context, master } = audio;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, frequency + slide), now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(master);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

function playSound(name) {
  const sounds = {
    start: () => { playTone(110, 0.18, "sawtooth", 0.7, 90); playTone(220, 0.28, "square", 0.35, -80); },
    fire: () => { playTone(120, 0.08, "square", 1, -70); playTone(55, 0.12, "sawtooth", 0.65, -25); },
    hit: () => playTone(180, 0.09, "sawtooth", 0.8, -110),
    pickup: () => { playTone(440, 0.08, "triangle", 0.5, 180); playTone(660, 0.1, "triangle", 0.35, 120); },
    door: () => playTone(85, 0.22, "square", 0.55, -20),
    hurt: () => playTone(75, 0.18, "sawtooth", 0.9, -30),
    denied: () => playTone(95, 0.16, "square", 0.45, -8),
    enemyFire: () => playTone(260, 0.12, "sawtooth", 0.45, -90),
    victory: () => { playTone(330, 0.16, "triangle", 0.45, 110); playTone(494, 0.2, "triangle", 0.38, 165); },
  };
  sounds[name]?.();
}

function normalizeAngle(angle) {
  return (angle % TWO_PI + TWO_PI) % TWO_PI;
}

function angleDiff(a, b) {
  let diff = normalizeAngle(a) - normalizeAngle(b);
  if (diff > Math.PI) diff -= TWO_PI;
  if (diff < -Math.PI) diff += TWO_PI;
  return diff;
}

function cellAt(x, y) {
  const row = state.map[Math.floor(y)];
  if (!row) return TILE.STONE;
  return row[Math.floor(x)] ?? TILE.STONE;
}

function isBlocking(x, y) {
  const tile = cellAt(x, y);
  return tile === TILE.STONE || tile === TILE.TECH || tile === TILE.DOOR || tile === TILE.LOCKED;
}

function canMoveTo(x, y) {
  return !isBlocking(x - PLAYER_RADIUS, y - PLAYER_RADIUS) &&
    !isBlocking(x + PLAYER_RADIUS, y - PLAYER_RADIUS) &&
    !isBlocking(x - PLAYER_RADIUS, y + PLAYER_RADIUS) &&
    !isBlocking(x + PLAYER_RADIUS, y + PLAYER_RADIUS);
}

function tryMove(entity, dx, dy) {
  const nx = entity.x + dx;
  const ny = entity.y + dy;
  if (canMoveTo(nx, entity.y)) entity.x = nx;
  if (canMoveTo(entity.x, ny)) entity.y = ny;
}

function castRay(angle) {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  let distance = 0.02;

  while (distance < MAX_DEPTH) {
    const x = state.player.x + cos * distance;
    const y = state.player.y + sin * distance;
    const tile = cellAt(x, y);

    if (tile !== TILE.EMPTY) {
      const cellX = Math.floor(x);
      const cellY = Math.floor(y);
      const localX = x - cellX;
      const localY = y - cellY;
      const side = Math.min(localX, 1 - localX) < Math.min(localY, 1 - localY) ? "x" : "y";
      const offset = side === "x" ? localY : localX;
      return { distance, tile, side, offset, x, y, cellX, cellY };
    }
    distance += 0.018 + distance * 0.002;
  }

  return { distance: MAX_DEPTH, tile: TILE.STONE, side: "x", offset: 0, x: 0, y: 0, cellX: 0, cellY: 0 };
}

function hasLineOfSight(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.hypot(dx, dy);
  const steps = Math.ceil(distance * 12);
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (isBlocking(x1 + dx * t, y1 + dy * t)) return false;
  }
  return true;
}

function drawTextureColumn(x, top, height, hit, shade) {
  const texture = textures[hit.tile];
  const width = canvas.width / state.zBuffer.length + 1;
  const stripe = Math.floor(hit.offset * 8);
  const mortar = stripe === 0 || stripe === 7 || Math.floor((top + height) / 17) % 5 === 0;
  const brightness = hit.side === "x" ? shade * 0.82 : shade;

  ctx.fillStyle = mortar ? texture.line : shadeColor(texture.base, brightness);
  ctx.fillRect(x, top, width, height);

  ctx.fillStyle = shadeColor(texture.dark, brightness);
  for (let y = top; y < top + height; y += Math.max(7, height / 9)) {
    ctx.fillRect(x, y, width, Math.max(1, height / 42));
  }

  if (stripe % 3 === 1) {
    ctx.fillStyle = shadeColor(texture.light, brightness * 0.88);
    ctx.fillRect(x + width * 0.18, top, Math.max(1, width * 0.14), height);
  }
}

function shadeColor(hex, amount) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const scale = Math.max(0.12, Math.min(1.35, amount));
  return `rgb(${Math.round(r * scale)}, ${Math.round(g * scale)}, ${Math.round(b * scale)})`;
}

function drawWorld() {
  const width = canvas.width;
  const height = canvas.height;
  const columns = Math.floor(width / 2);
  const columnWidth = width / columns;
  state.zBuffer.length = columns;

  const wobble = Math.sin(state.player.bob) * 5 + (Math.random() - 0.5) * state.shake;
  const horizon = height * 0.48 + wobble;

  const ceiling = ctx.createLinearGradient(0, 0, 0, horizon);
  ceiling.addColorStop(0, "#170e13");
  ceiling.addColorStop(1, "#2b1720");
  ctx.fillStyle = ceiling;
  ctx.fillRect(0, 0, width, horizon);

  const floor = ctx.createLinearGradient(0, horizon, 0, height);
  floor.addColorStop(0, "#3a2118");
  floor.addColorStop(1, "#090606");
  ctx.fillStyle = floor;
  ctx.fillRect(0, horizon, width, height - horizon);

  for (let x = 0; x < columns; x += 1) {
    const cameraX = x / columns - 0.5;
    const rayAngle = state.player.angle + cameraX * FOV;
    const hit = castRay(rayAngle);
    const corrected = hit.distance * Math.cos(rayAngle - state.player.angle);
    const wallHeight = Math.min(height * 1.9, WALL_HEIGHT / Math.max(0.001, corrected));
    const top = horizon - wallHeight / 2;
    const shade = Math.max(0.22, 1 - corrected / 13);

    state.zBuffer[x] = corrected;
    drawTextureColumn(x * columnWidth, top, wallHeight, hit, shade);
  }

  drawFloorGrid(horizon);
  drawSprites();
  drawWeapon();
  drawHud();
  drawMessage();
  if (state.showMap) drawMap();
  if (state.flash > 0) drawDamageFlash();
  if (state.gameOver || state.victory || state.paused) drawEndState();
}

function drawFloorGrid(horizon) {
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#8e3c2c";
  ctx.lineWidth = 1;
  for (let y = horizon + 20; y < canvas.height; y += 24) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y + (y - horizon) * 0.08);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSprites() {
  const sprites = [
    ...state.pickups.filter((item) => !item.taken).map((item) => ({ ...item, spriteType: "pickup" })),
    ...state.enemies.filter((enemy) => !enemy.dead).map((enemy) => ({ ...enemy, spriteType: "enemy" })),
    ...state.projectiles.map((projectile) => ({ ...projectile, spriteType: "projectile" })),
    ...state.particles.map((particle) => ({ ...particle, spriteType: "particle" })),
  ].sort((a, b) => distanceTo(b) - distanceTo(a));

  for (const sprite of sprites) {
    const dx = sprite.x - state.player.x;
    const dy = sprite.y - state.player.y;
    const distance = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const relative = angleDiff(angle, state.player.angle);
    if (Math.abs(relative) > FOV * 0.72 || distance < 0.1) continue;

    const screenX = (0.5 + relative / FOV) * canvas.width;
    const size = Math.min(canvas.height * 1.2, canvas.height / distance);
    const top = canvas.height * 0.5 - size * 0.45 + Math.sin(state.time * 5 + sprite.x) * 4;
    const zIndex = Math.floor(screenX / (canvas.width / state.zBuffer.length));
    if (state.zBuffer[zIndex] && distance > state.zBuffer[zIndex] + 0.15) continue;

    if (sprite.spriteType === "enemy") drawEnemySprite(sprite, screenX, top, size, distance);
    if (sprite.spriteType === "pickup") drawPickupSprite(sprite, screenX, top, size * 0.45, distance);
    if (sprite.spriteType === "projectile") drawProjectileSprite(sprite, screenX, top, size * 0.25, distance);
    if (sprite.spriteType === "particle") drawParticleSprite(sprite, screenX, top, size * 0.12, distance);
  }
}

function distanceTo(entity) {
  return Math.hypot(entity.x - state.player.x, entity.y - state.player.y);
}

function drawEnemySprite(enemy, x, y, size, distance) {
  const shade = Math.max(0.32, 1 - distance / 13);
  const w = size * 0.48;
  const h = size * 0.74;
  const painOffset = enemy.pain > 0 ? Math.sin(state.time * 55) * 8 : 0;
  ctx.save();
  ctx.translate(x + painOffset, y);
  ctx.globalAlpha = Math.max(0.35, shade);
  ctx.fillStyle = shadeColor(enemy.color, shade);
  ctx.fillRect(-w * 0.28, h * 0.2, w * 0.56, h * 0.58);
  ctx.fillRect(-w * 0.38, h * 0.35, w * 0.18, h * 0.5);
  ctx.fillRect(w * 0.2, h * 0.35, w * 0.18, h * 0.5);
  ctx.fillStyle = shadeColor("#6b1712", shade);
  ctx.fillRect(-w * 0.23, h * 0.03, w * 0.46, h * 0.24);
  ctx.fillStyle = "#ffd166";
  ctx.fillRect(-w * 0.13, h * 0.1, w * 0.08, h * 0.05);
  ctx.fillRect(w * 0.05, h * 0.1, w * 0.08, h * 0.05);
  ctx.fillStyle = "#20100f";
  ctx.fillRect(-w * 0.2, h * 0.48, w * 0.4, h * 0.07);

  const healthWidth = w * 0.58 * (enemy.health / enemy.maxHealth);
  ctx.globalAlpha = 0.78;
  ctx.fillStyle = "#140706";
  ctx.fillRect(-w * 0.29, -8, w * 0.58, 4);
  ctx.fillStyle = "#ff3d2e";
  ctx.fillRect(-w * 0.29, -8, healthWidth, 4);
  ctx.restore();
}

function drawPickupSprite(item, x, y, size, distance) {
  const bob = Math.sin(state.time * 5 + item.x) * 6;
  const alpha = Math.max(0.42, 1 - distance / 12);
  const colors = {
    ammo: ["#d4a04c", "#5a3712"],
    health: ["#f4f1e9", "#b01c18"],
    armor: ["#65c985", "#16341f"],
    key: ["#ff3d2e", "#5b0b09"],
  }[item.type];

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y + bob);
  ctx.fillStyle = colors[1];
  ctx.fillRect(-size * 0.45, size * 0.1, size * 0.9, size * 0.45);
  ctx.fillStyle = colors[0];
  ctx.fillRect(-size * 0.32, 0, size * 0.64, size * 0.36);
  if (item.type === "health") {
    ctx.fillStyle = colors[1];
    ctx.fillRect(-size * 0.08, size * 0.04, size * 0.16, size * 0.28);
    ctx.fillRect(-size * 0.22, size * 0.14, size * 0.44, size * 0.09);
  }
  if (item.type === "key") {
    ctx.fillStyle = "#ffd166";
    ctx.fillRect(-size * 0.05, -size * 0.2, size * 0.1, size * 0.75);
    ctx.fillRect(-size * 0.05, size * 0.38, size * 0.35, size * 0.1);
  }
  ctx.restore();
}

function drawParticleSprite(particle, x, y, size, distance) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, particle.life) * Math.max(0.25, 1 - distance / 8);
  ctx.fillStyle = particle.color;
  ctx.fillRect(x - size, y - size, size * 2, size * 2);
  ctx.restore();
}

function drawProjectileSprite(projectile, x, y, size, distance) {
  const pulse = 0.75 + Math.sin(state.time * 18) * 0.25;
  ctx.save();
  ctx.globalAlpha = Math.max(0.45, 1 - distance / 10);
  ctx.fillStyle = "#ff3d2e";
  ctx.fillRect(x - size * pulse, y + size * 0.8 - size * pulse, size * 2 * pulse, size * 2 * pulse);
  ctx.fillStyle = "#ffd166";
  ctx.fillRect(x - size * 0.34, y + size * 0.8 - size * 0.34, size * 0.68, size * 0.68);
  ctx.restore();
}

function drawWeapon() {
  const player = state.player;
  const sway = Math.sin(player.bob) * 16;
  const recoil = player.weaponCooldown > 0.22 ? Math.sin(player.weaponCooldown * 28) * 28 : 0;
  const x = canvas.width * 0.5 + sway;
  const y = canvas.height - 112 + recoil;

  ctx.fillStyle = "#1a1010";
  ctx.fillRect(x - 74, y + 38, 148, 74);
  ctx.fillStyle = "#3b2926";
  ctx.fillRect(x - 52, y + 8, 104, 86);
  ctx.fillStyle = "#6d5950";
  ctx.fillRect(x - 24, y - 12, 48, 76);
  ctx.fillStyle = "#1b1716";
  ctx.fillRect(x - 13, y - 48, 26, 58);
  ctx.fillStyle = "#c0a183";
  ctx.fillRect(x - 7, y - 57, 14, 12);
  if (player.weaponCooldown > 0.28) {
    ctx.fillStyle = "#ffd166";
    ctx.fillRect(x - 24, y - 82, 48, 28);
    ctx.fillStyle = "#ff3d2e";
    ctx.fillRect(x - 14, y - 96, 28, 18);
  }

  ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
  ctx.fillRect(canvas.width / 2 - 8, canvas.height / 2, 16, 2);
  ctx.fillRect(canvas.width / 2, canvas.height / 2 - 8, 2, 16);
}

function drawHud() {
  const { health, armor, ammo, score, key } = state.player;
  const hudHeight = 68;
  ctx.fillStyle = "rgba(19, 9, 8, 0.88)";
  ctx.fillRect(0, canvas.height - hudHeight, canvas.width, hudHeight);
  ctx.fillStyle = "#4b211d";
  ctx.fillRect(0, canvas.height - hudHeight, canvas.width, 4);

  drawHudValue(26, "Health", Math.max(0, Math.round(health)), "#ff3d2e");
  drawHudValue(178, "Armor", Math.round(armor), "#65c985");
  drawHudValue(330, "Ammo", ammo, "#ffb23e");
  drawHudValue(482, "Score", score, "#f8eee8");

  ctx.fillStyle = key ? "#ff3d2e" : "#3a2422";
  ctx.fillRect(canvas.width - 126, canvas.height - 51, 40, 28);
  ctx.fillStyle = key ? "#ffd166" : "#78514a";
  ctx.font = "700 14px ui-sans-serif, system-ui";
  ctx.fillText("KEY", canvas.width - 78, canvas.height - 31);
}

function drawHudValue(x, label, value, color) {
  ctx.font = "700 13px ui-sans-serif, system-ui";
  ctx.fillStyle = "#b79d92";
  ctx.fillText(label.toUpperCase(), x, canvas.height - 43);
  ctx.font = "700 28px ui-sans-serif, system-ui";
  ctx.fillStyle = color;
  ctx.fillText(String(value), x, canvas.height - 14);
}

function drawMessage() {
  if (state.messageTimer <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, state.messageTimer);
  ctx.fillStyle = "rgba(11, 5, 5, 0.78)";
  ctx.fillRect(canvas.width * 0.24, 18, canvas.width * 0.52, 36);
  ctx.fillStyle = "#f8eee8";
  ctx.font = "700 16px ui-sans-serif, system-ui";
  ctx.textAlign = "center";
  ctx.fillText(state.message, canvas.width / 2, 41);
  ctx.restore();
}

function drawMap() {
  const scale = 7;
  const ox = 18;
  const oy = 18;
  ctx.save();
  ctx.globalAlpha = 0.84;
  ctx.fillStyle = "rgba(8, 5, 5, 0.76)";
  ctx.fillRect(ox - 6, oy - 6, state.map[0].length * scale + 12, state.map.length * scale + 12);

  state.map.forEach((row, y) => {
    row.forEach((tile, x) => {
      if (tile !== TILE.EMPTY) {
        ctx.fillStyle = tile === TILE.EXIT ? "#5fd17f" : tile === TILE.LOCKED ? "#ff3d2e" : "#6f4035";
        ctx.fillRect(ox + x * scale, oy + y * scale, scale - 1, scale - 1);
      }
    });
  });

  state.pickups.filter((item) => !item.taken).forEach((item) => {
    ctx.fillStyle = item.type === "key" ? "#ff3d2e" : "#ffb23e";
    ctx.fillRect(ox + item.x * scale - 2, oy + item.y * scale - 2, 3, 3);
  });

  state.enemies.filter((enemy) => !enemy.dead).forEach((enemy) => {
    ctx.fillStyle = "#d2382d";
    ctx.fillRect(ox + enemy.x * scale - 2, oy + enemy.y * scale - 2, 4, 4);
  });

  ctx.fillStyle = "#f8eee8";
  ctx.beginPath();
  ctx.arc(ox + state.player.x * scale, oy + state.player.y * scale, 3.5, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = "#f8eee8";
  ctx.beginPath();
  ctx.moveTo(ox + state.player.x * scale, oy + state.player.y * scale);
  ctx.lineTo(ox + (state.player.x + Math.cos(state.player.angle) * 1.1) * scale, oy + (state.player.y + Math.sin(state.player.angle) * 1.1) * scale);
  ctx.stroke();
  ctx.restore();
}

function drawDamageFlash() {
  ctx.save();
  ctx.globalAlpha = state.flash;
  ctx.fillStyle = "#d51616";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function drawEndState() {
  const title = state.victory ? "Gate activated" : state.gameOver ? "Signal lost" : "Paused";
  const subtitle = state.victory
    ? `Mission cleared. Final score: ${state.player.score}`
    : state.gameOver
      ? "Press start mission to reboot the simulation."
      : "Press P to resume.";

  ctx.save();
  ctx.fillStyle = "rgba(5, 3, 3, 0.78)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ff3d2e";
  ctx.font = "700 54px ui-sans-serif, system-ui";
  ctx.fillText(title.toUpperCase(), canvas.width / 2, canvas.height * 0.42);
  ctx.fillStyle = "#f8eee8";
  ctx.font = "700 18px ui-sans-serif, system-ui";
  ctx.fillText(subtitle, canvas.width / 2, canvas.height * 0.5);
  ctx.restore();
}

function update(dt) {
  if (!state.running || state.paused || state.gameOver || state.victory) return;

  const player = state.player;
  state.time += dt;
  state.shake = Math.max(0, state.shake - dt * 18);
  state.flash = Math.max(0, state.flash - dt * 2.8);
  state.messageTimer = Math.max(0, state.messageTimer - dt);
  player.weaponCooldown = Math.max(0, player.weaponCooldown - dt);
  player.hurtTimer = Math.max(0, player.hurtTimer - dt);

  const forward = Number(state.keys.KeyW || state.keys.ArrowUp) - Number(state.keys.KeyS || state.keys.ArrowDown);
  const strafe = Number(state.keys.KeyD) - Number(state.keys.KeyA);
  const turn = Number(state.keys.ArrowRight) - Number(state.keys.ArrowLeft);
  player.angle = normalizeAngle(player.angle + turn * TURN_SPEED * dt);

  if (forward || strafe) {
    const speed = MOVE_SPEED * dt;
    const sin = Math.sin(player.angle);
    const cos = Math.cos(player.angle);
    tryMove(player, (cos * forward - sin * strafe) * speed, (sin * forward + cos * strafe) * speed);
    player.bob += dt * 12 * Math.min(1, Math.abs(forward) + Math.abs(strafe));
  } else {
    player.bob += dt * 2;
  }

  updatePickups();
  updateEnemies(dt);
  updateProjectiles(dt);
  updateParticles(dt);
}

function updatePickups() {
  for (const item of state.pickups) {
    if (item.taken || distanceTo(item) > 0.55) continue;
    item.taken = true;
    if (item.type === "health") {
      state.player.health = Math.min(100, state.player.health + 28);
      playSound("pickup");
      announce("Med kit recovered.");
    }
    if (item.type === "armor") {
      state.player.armor = Math.min(100, state.player.armor + 34);
      playSound("pickup");
      announce("Composite armor equipped.");
    }
    if (item.type === "ammo") {
      state.player.ammo += 18;
      playSound("pickup");
      announce("Pulse rounds loaded.");
    }
    if (item.type === "key") {
      state.player.key = true;
      state.player.score += 500;
      playSound("pickup");
      announce("Red key acquired. Find the exit.");
    }
  }
}

function updateEnemies(dt) {
  for (const enemy of state.enemies) {
    if (enemy.dead) continue;
    enemy.pain = Math.max(0, enemy.pain - dt);
    enemy.attackTimer = Math.max(0, enemy.attackTimer - dt);

    const dx = state.player.x - enemy.x;
    const dy = state.player.y - enemy.y;
    const distance = Math.hypot(dx, dy);
    const seesPlayer = distance < 8 && hasLineOfSight(enemy.x, enemy.y, state.player.x, state.player.y);

    if (seesPlayer) enemy.state = "chase";
    if (enemy.state === "chase" && (!enemy.ranged || distance > 3.2) && distance > ENEMY_RADIUS + 0.35) {
      const step = enemy.speed * dt;
      tryMove(enemy, (dx / distance) * step, (dy / distance) * step);
    }

    if (enemy.ranged && seesPlayer && distance < 6.8 && distance > 1.25 && enemy.attackTimer <= 0) {
      enemy.attackTimer = enemy.type === "brute" ? 1.65 : 1.25;
      fireEnemyProjectile(enemy, dx / distance, dy / distance);
      continue;
    }

    if (distance < 0.75 && enemy.attackTimer <= 0) {
      enemy.attackTimer = enemy.type === "runner" ? 0.78 : 1.1;
      damagePlayer(enemy.damage);
    }
  }
}

function fireEnemyProjectile(enemy, dx, dy) {
  playSound("enemyFire");
  state.projectiles.push({
    x: enemy.x + dx * 0.38,
    y: enemy.y + dy * 0.38,
    dx,
    dy,
    speed: enemy.type === "brute" ? 3.1 : 3.7,
    damage: enemy.type === "brute" ? 16 : 11,
    life: 2.6,
  });
}

function updateProjectiles(dt) {
  for (const projectile of state.projectiles) {
    projectile.life -= dt;
    projectile.x += projectile.dx * projectile.speed * dt;
    projectile.y += projectile.dy * projectile.speed * dt;

    if (isBlocking(projectile.x, projectile.y)) {
      projectile.life = 0;
      spawnHitParticles(projectile.x, projectile.y, "#ffb23e");
      continue;
    }

    if (distanceTo(projectile) < 0.35) {
      projectile.life = 0;
      damagePlayer(projectile.damage);
      spawnHitParticles(projectile.x, projectile.y, "#ff3d2e");
    }
  }
  state.projectiles = state.projectiles.filter((projectile) => projectile.life > 0);
}

function updateParticles(dt) {
  for (const particle of state.particles) {
    particle.life -= dt * 1.8;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
  }
  state.particles = state.particles.filter((particle) => particle.life > 0);
}

function damagePlayer(amount) {
  if (state.player.hurtTimer > 0) return;
  state.player.hurtTimer = 0.28;
  const armorBlock = Math.min(state.player.armor, amount * 0.55);
  state.player.armor -= armorBlock;
  state.player.health -= amount - armorBlock;
  state.flash = 0.38;
  state.shake = 7;
  playSound("hurt");
  announce("Hostile contact.");
  if (state.player.health <= 0) {
    state.player.health = 0;
    state.gameOver = true;
    overlay.classList.remove("hidden");
  }
}

function fireWeapon() {
  if (!state.running || state.paused || state.gameOver || state.victory) return;
  const player = state.player;
  if (player.weaponCooldown > 0) return;
  if (player.ammo <= 0) {
    announce("No pulse rounds.");
    playSound("denied");
    player.weaponCooldown = 0.18;
    return;
  }

  player.ammo -= 1;
  player.weaponCooldown = 0.36;
  state.shake = 3;
  playSound("fire");
  spawnMuzzleParticles();

  let target = null;
  let bestDistance = Infinity;
  for (const enemy of state.enemies) {
    if (enemy.dead) continue;
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const distance = Math.hypot(dx, dy);
    const diff = Math.abs(angleDiff(Math.atan2(dy, dx), player.angle));
    if (diff < 0.11 + 0.04 / Math.max(distance, 1) && distance < bestDistance && hasLineOfSight(player.x, player.y, enemy.x, enemy.y)) {
      target = enemy;
      bestDistance = distance;
    }
  }

  if (!target) return;
  const damage = Math.round(28 + Math.random() * 18);
  target.health -= damage;
  target.pain = 0.18;
  target.state = "chase";
  playSound("hit");
  spawnHitParticles(target.x, target.y, target.color);
  if (target.health <= 0) {
    target.dead = true;
    player.score += target.score;
    announce("Target neutralized.");
  }
}

function spawnMuzzleParticles() {
  for (let i = 0; i < 5; i += 1) {
    state.particles.push({
      x: state.player.x + Math.cos(state.player.angle) * 0.5,
      y: state.player.y + Math.sin(state.player.angle) * 0.5,
      vx: (Math.random() - 0.5) * 0.8,
      vy: (Math.random() - 0.5) * 0.8,
      life: 0.28 + Math.random() * 0.2,
      color: i % 2 ? "#ffd166" : "#ff3d2e",
    });
  }
}

function spawnHitParticles(x, y, color) {
  for (let i = 0; i < 10; i += 1) {
    state.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 1.4,
      vy: (Math.random() - 0.5) * 1.4,
      life: 0.45 + Math.random() * 0.25,
      color,
    });
  }
}

function useAction() {
  if (!state.running || state.gameOver || state.victory) return;
  const tx = Math.floor(state.player.x + Math.cos(state.player.angle) * 0.85);
  const ty = Math.floor(state.player.y + Math.sin(state.player.angle) * 0.85);
  const tile = state.map[ty]?.[tx];

  if (tile === TILE.DOOR) {
    state.map[ty][tx] = TILE.EMPTY;
    playSound("door");
    announce("Bulkhead opened.");
    return;
  }

  if (tile === TILE.LOCKED) {
    if (state.player.key) {
      state.map[ty][tx] = TILE.EMPTY;
      state.player.score += 750;
      playSound("door");
      announce("Red seal disengaged.");
    } else {
      playSound("denied");
      announce("Red key required.");
    }
    return;
  }

  if (tile === TILE.EXIT) {
    const enemiesRemaining = state.enemies.some((enemy) => !enemy.dead);
    if (enemiesRemaining) {
      announce("Exit locked while hostiles remain.");
      return;
    }
    state.victory = true;
    state.player.score += Math.round(state.player.health * 12 + state.player.ammo * 8);
    playSound("victory");
    overlay.classList.remove("hidden");
  }
}

function announce(message) {
  state.message = message;
  state.messageTimer = 2.4;
}

function resetGame() {
  state.running = true;
  state.paused = false;
  state.victory = false;
  state.gameOver = false;
  state.time = 0;
  state.shake = 0;
  state.flash = 0;
  state.message = "Find the red key and reach the green exit.";
  state.messageTimer = 4;
  state.enemies = [];
  state.pickups = [];
  state.particles = [];
  state.projectiles = [];
  state.player = {
    x: 1.5,
    y: 1.5,
    angle: 0,
    health: 100,
    armor: 25,
    ammo: 42,
    score: 0,
    key: false,
    weaponCooldown: 0,
    bob: 0,
    hurtTimer: 0,
  };
  parseLevel();
  playSound("start");
  overlay.classList.add("hidden");
  canvas.focus();
}

function gameLoop(timestamp) {
  const previous = state.lastFrame ?? timestamp;
  const dt = Math.min(0.05, (timestamp - previous) / 1000);
  state.lastFrame = timestamp;
  update(dt);
  drawWorld();
  requestAnimationFrame(gameLoop);
}

function bindEvents() {
  startButton.addEventListener("click", () => {
    resetGame();
    canvas.requestPointerLock?.();
  });

  window.addEventListener("keydown", (event) => {
    state.keys[event.code] = true;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
      event.preventDefault();
    }
    if (event.code === "Space") fireWeapon();
    if (event.code === "KeyE") useAction();
    if (event.code === "KeyM") state.showMap = !state.showMap;
    if (event.code === "KeyP") state.paused = !state.paused;
  });

  window.addEventListener("keyup", (event) => {
    state.keys[event.code] = false;
  });

  canvas.addEventListener("click", () => {
    if (!state.running || state.gameOver || state.victory) {
      resetGame();
      return;
    }
    fireWeapon();
    canvas.requestPointerLock?.();
  });

  document.addEventListener("pointerlockchange", () => {
    state.mouseActive = document.pointerLockElement === canvas;
  });

  document.addEventListener("mousemove", (event) => {
    if (state.mouseActive && state.running && !state.paused) {
      state.player.angle = normalizeAngle(state.player.angle + event.movementX * 0.0023);
    }
  });
}

parseLevel();
bindEvents();
drawWorld();
requestAnimationFrame(gameLoop);
