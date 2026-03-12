import { TEMPLE_CENTER, TEMPLE_GOAL_CENTER } from "./level-data.js";

export function terrainHeight(x, z) {
  const distanceFromCenter = Math.hypot(x, z);
  const jungleRing = smoothstep(clamp01((distanceFromCenter - 16) / 150));
  const macro = fbm(x * 0.012, z * 0.012, 4, 2.0, 0.5) * (3.5 + jungleRing * 5.5);
  const detail = fbm(x * 0.032, z * 0.032, 3, 2.15, 0.52) * 1.8;
  const ripples = fbm(x * 0.09, z * 0.09, 2, 2.0, 0.5) * 0.55;

  const routeBlend = smoothstep(clamp01((-z + 6) / 170));
  const routeX = templePathX(z);
  const routeDistance = Math.abs(x - routeX);
  const routeClearance = 1 - smoothstep(clamp01(routeDistance / 18));
  const jungleWalls = smoothstep(clamp01((routeDistance - 12) / 26)) * routeBlend * 6.8;

  const templeDistance = Math.hypot(x - TEMPLE_CENTER.x, z - TEMPLE_CENTER.z);
  const templeRise = Math.max(0, 1 - templeDistance / 38);
  const templeMound = Math.pow(templeRise, 1.5) * 15.5;
  const courtyardFlat = smoothstep(clamp01((18 - templeDistance) / 18)) * 5.5;
  const tunnelDistanceX = Math.abs(x - TEMPLE_GOAL_CENTER.x);
  const tunnelSpan = smoothstep(clamp01((TEMPLE_CENTER.z - z) / (TEMPLE_CENTER.z - (TEMPLE_GOAL_CENTER.z - 12))));
  const tunnelFlat = smoothstep(clamp01((9 - tunnelDistanceX) / 9)) * tunnelSpan * 7.2;
  const goalFloor = smoothstep(
    clamp01((15 - Math.hypot(x - TEMPLE_GOAL_CENTER.x, z - TEMPLE_GOAL_CENTER.z)) / 15),
  ) * 6.2;
  const templePlateau = smoothTemplePlateau(x, z);
  const templePlateauHeight = 3.2;

  const spawnClear = smoothstep(clamp01((24 - Math.hypot(x, z)) / 24)) * 4.6;

  const naturalHeight =
    macro +
    detail +
    ripples +
    jungleWalls +
    templeMound -
    routeClearance * routeBlend * 3.2 -
    courtyardFlat -
    tunnelFlat -
    goalFloor -
    spawnClear;

  return lerp(naturalHeight, templePlateauHeight, templePlateau);
}

export function terrainBaseForSphereAt(x, z, radius) {
  let requiredCenterY = terrainHeight(x, z) + radius;
  const rings = [
    { scale: 0.5, samples: 8 },
    { scale: 0.95, samples: 12 },
  ];

  for (const ring of rings) {
    const d = radius * ring.scale;
    const centerLift = Math.sqrt(Math.max(0, radius * radius - d * d));
    for (let i = 0; i < ring.samples; i += 1) {
      const angle = (i / ring.samples) * Math.PI * 2;
      const sx = x + Math.cos(angle) * d;
      const sz = z + Math.sin(angle) * d;
      const h = terrainHeight(sx, sz);
      requiredCenterY = Math.max(requiredCenterY, h + centerLift);
    }
  }

  return requiredCenterY - radius;
}

export function templePathX(z) {
  const clampedZ = clamp(z, TEMPLE_CENTER.z, 10);
  return Math.sin((clampedZ + 38) * 0.035) * 8 + Math.sin((clampedZ - 16) * 0.07) * 4;
}

function smoothTemplePlateau(x, z) {
  const dx = Math.abs(x - TEMPLE_CENTER.x);
  const dz = Math.abs(z + 170);
  const boxBlendX = 1 - smoothstep(clamp01((dx - 18) / 18));
  const boxBlendZ = 1 - smoothstep(clamp01((dz - 34) / 18));
  return boxBlendX * boxBlendZ;
}

function fbm(x, z, octaves, lacunarity, gain) {
  let sum = 0;
  let amp = 1;
  let freq = 1;

  for (let i = 0; i < octaves; i += 1) {
    sum += amp * valueNoise(x * freq, z * freq);
    freq *= lacunarity;
    amp *= gain;
  }

  return sum;
}

function valueNoise(x, z) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = x - x0;
  const tz = z - z0;

  const u = smoothstep(tx);
  const v = smoothstep(tz);

  const n00 = rand2(x0, z0);
  const n10 = rand2(x0 + 1, z0);
  const n01 = rand2(x0, z0 + 1);
  const n11 = rand2(x0 + 1, z0 + 1);

  const nx0 = lerp(n00, n10, u);
  const nx1 = lerp(n01, n11, u);
  return lerp(nx0, nx1, v) * 2 - 1;
}

function rand2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
