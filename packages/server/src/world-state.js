import { PlayerState } from "./player-state.js";

export class WorldState {
  constructor() {
    this.tick = 0;
    this.players = new Map();
    this.recentCollisions = [];
  }

  incrementTick() {
    this.tick += 1;
    return this.tick;
  }

  simulateTick(dtSeconds, config) {
    this.incrementTick();
    this.recentCollisions = [];
    const previousPositionsById = new Map();
    for (const player of this.players.values()) {
      previousPositionsById.set(player.playerId, {
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
      });
      player.simulateTick(dtSeconds, config);
      this.resolveLevelCollisions(player, config);
    }
    this.resolvePlayerCollisions(config, previousPositionsById);
    return this.tick;
  }

  createPlayer(playerId) {
    const player = PlayerState.createInitial(playerId);
    this.players.set(playerId, player);
    return player;
  }

  getPlayer(playerId) {
    return this.players.get(playerId);
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    this.players.delete(playerId);
    return player;
  }

  getPlayerCount() {
    return this.players.size;
  }

  createSnapshot() {
    return {
      tick: this.tick,
      players: Array.from(this.players.values()),
    };
  }

  resolvePlayerCollisions(config, previousPositionsById = new Map()) {
    const players = Array.from(this.players.values());
    if (players.length < 2) {
      return;
    }

    const radius = config.playerCollisionRadius ?? 0.75;
    const minDistance = radius * 2;
    const minDistanceSq = minDistance * minDistance;
    const restitution = clamp01(config.playerCollisionRestitution ?? 0.9);
    const iterations = Math.max(1, Math.floor(config.playerCollisionIterations ?? 2));
    const tiny = 1e-8;

    for (let pass = 0; pass < iterations; pass += 1) {
      for (let i = 0; i < players.length - 1; i += 1) {
        const a = players[i];
        for (let j = i + 1; j < players.length; j += 1) {
          const b = players[j];

          const dx = b.position.x - a.position.x;
          const dy = 0;
          const dz = b.position.z - a.position.z;
          const distanceSq = dx * dx + dy * dy + dz * dz;
          if (distanceSq >= minDistanceSq) {
            continue;
          }

          let nx;
          let ny;
          let nz;
          let distance = Math.sqrt(distanceSq);
          if (distance <= tiny) {
            const rvx = b.velocity.x - a.velocity.x;
            const rvy = 0;
            const rvz = b.velocity.z - a.velocity.z;
            const relativeLen = Math.hypot(rvx, rvy, rvz);
            if (relativeLen > tiny) {
              nx = rvx / relativeLen;
              ny = rvy / relativeLen;
              nz = rvz / relativeLen;
            } else {
              nx = 1;
              ny = 0;
              nz = 0;
            }
            distance = 0;
          } else {
            nx = dx / distance;
            ny = dy / distance;
            nz = dz / distance;
          }

          const penetration = minDistance - distance;
          if (penetration > 0) {
            const separation = penetration * 0.5;
            a.position.x -= nx * separation;
            a.position.y -= ny * separation;
            a.position.z -= nz * separation;
            b.position.x += nx * separation;
            b.position.y += ny * separation;
            b.position.z += nz * separation;
          }

          const previousA = previousPositionsById.get(a.playerId);
          const previousB = previousPositionsById.get(b.playerId);
          const previousDx = previousA && previousB ? previousB.x - previousA.x : 0;
          const previousDy = 0;
          const previousDz = previousA && previousB ? previousB.z - previousA.z : 0;
          const previousDistance =
            previousA && previousB
              ? Math.hypot(previousDx, previousDy, previousDz)
              : Number.POSITIVE_INFINITY;
          const movedCloserThisTick = Number.isFinite(previousDistance) && previousDistance > distance;

          let rvx = b.velocity.x - a.velocity.x;
          let rvy = 0;
          let rvz = b.velocity.z - a.velocity.z;
          let closingVelocity = rvx * nx + rvy * ny + rvz * nz;
          if (closingVelocity >= 0 && movedCloserThisTick && previousDistance > tiny) {
            nx = previousDx / previousDistance;
            ny = previousDy / previousDistance;
            nz = previousDz / previousDistance;
            rvx = b.velocity.x - a.velocity.x;
            rvy = 0;
            rvz = b.velocity.z - a.velocity.z;
            closingVelocity = rvx * nx + rvy * ny + rvz * nz;
          }

          if (closingVelocity < 0) {
            const impulseMagnitude = (-(1 + restitution) * closingVelocity) / 2;
            const impulseX = nx * impulseMagnitude;
            const impulseY = ny * impulseMagnitude;
            const impulseZ = nz * impulseMagnitude;
            a.velocity.x -= impulseX;
            a.velocity.y -= impulseY * 0.05;
            a.velocity.z -= impulseZ;
            b.velocity.x += impulseX;
            b.velocity.y += impulseY * 0.05;
            b.velocity.z += impulseZ;

            if (pass === 0 && impulseMagnitude > 0.08) {
              this.recentCollisions.push({
                x: (a.position.x + b.position.x) * 0.5,
                y: (a.position.y + b.position.y) * 0.5,
                z: (a.position.z + b.position.z) * 0.5,
                intensity: impulseMagnitude,
              });
            }
          }

          a.enforceWorldBounds(config);
          b.enforceWorldBounds(config);
          enforceGroundContact(a, config);
          enforceGroundContact(b, config);
        }
      }
    }
  }

  resolveLevelCollisions(player, config) {
    const obstacles = Array.isArray(config.levelObstacles) ? config.levelObstacles : [];
    if (obstacles.length === 0) {
      return;
    }

    const playerRadius = config.playerCollisionRadius ?? 0.75;
    const tiny = 1e-8;

    for (const obstacle of obstacles) {
      if (!obstacle || typeof obstacle !== "object") {
        continue;
      }
      const obstacleHeight = Math.max(0, Number(obstacle.height) || 0);
      const obstacleBaseY = typeof config.groundHeightAt === "function"
        ? config.groundHeightAt(Number(obstacle.x) || 0, Number(obstacle.z) || 0)
        : config.groundY;
      if (player.position.y > obstacleBaseY + obstacleHeight + playerRadius * 1.1) {
        continue;
      }

      const kind = typeof obstacle.kind === "string" ? obstacle.kind : "";
      if (kind === "wall") {
        resolveWallCollision(player, obstacle, playerRadius, tiny);
      } else {
        resolveRoundObstacleCollision(player, obstacle, playerRadius, tiny);
      }
    }

    player.enforceWorldBounds(config);
    enforceGroundContact(player, config);
  }
}

function resolveRoundObstacleCollision(player, obstacle, playerRadius, tiny) {
  const obstacleRadius = Math.max(0, Number(obstacle.radius) || 0);
  if (obstacleRadius <= 0) {
    return;
  }

  const dx = player.position.x - (Number(obstacle.x) || 0);
  const dz = player.position.z - (Number(obstacle.z) || 0);
  const distanceSq = dx * dx + dz * dz;
  const minDistance = obstacleRadius + playerRadius;
  if (distanceSq >= minDistance * minDistance) {
    return;
  }

  let nx = dx;
  let nz = dz;
  let distance = Math.sqrt(distanceSq);
  if (distance <= tiny) {
    nx = 1;
    nz = 0;
    distance = 0;
  } else {
    nx /= distance;
    nz /= distance;
  }

  const penetration = minDistance - distance;
  player.position.x += nx * penetration;
  player.position.z += nz * penetration;

  const normalVelocity = player.velocity.x * nx + player.velocity.z * nz;
  if (normalVelocity < 0) {
    player.velocity.x -= nx * normalVelocity;
    player.velocity.z -= nz * normalVelocity;
  }
}

function resolveWallCollision(player, obstacle, playerRadius, tiny) {
  const ox = Number(obstacle.x) || 0;
  const oz = Number(obstacle.z) || 0;
  const halfWidth = Math.max(0, (Number(obstacle.width) || 0) * 0.5);
  const halfDepth = Math.max(0, (Number(obstacle.depth) || 0) * 0.5);
  if (halfWidth <= 0 || halfDepth <= 0) {
    return;
  }

  const yaw = Number(obstacle.yaw) || 0;
  const cosYaw = Math.cos(-yaw);
  const sinYaw = Math.sin(-yaw);
  const relX = player.position.x - ox;
  const relZ = player.position.z - oz;
  const localX = relX * cosYaw - relZ * sinYaw;
  const localZ = relX * sinYaw + relZ * cosYaw;

  const nearestX = clamp(localX, -halfWidth, halfWidth);
  const nearestZ = clamp(localZ, -halfDepth, halfDepth);
  const deltaX = localX - nearestX;
  const deltaZ = localZ - nearestZ;
  const distanceSq = deltaX * deltaX + deltaZ * deltaZ;
  if (distanceSq >= playerRadius * playerRadius) {
    return;
  }

  let normalX = deltaX;
  let normalZ = deltaZ;
  let penetration;
  const distance = Math.sqrt(distanceSq);

  if (distance > tiny) {
    normalX /= distance;
    normalZ /= distance;
    penetration = playerRadius - distance;
  } else {
    const overlapX = halfWidth + playerRadius - Math.abs(localX);
    const overlapZ = halfDepth + playerRadius - Math.abs(localZ);
    if (overlapX < overlapZ) {
      normalX = localX >= 0 ? 1 : -1;
      normalZ = 0;
      penetration = overlapX;
    } else {
      normalX = 0;
      normalZ = localZ >= 0 ? 1 : -1;
      penetration = overlapZ;
    }
  }

  const worldNormalX = normalX * Math.cos(yaw) - normalZ * Math.sin(yaw);
  const worldNormalZ = normalX * Math.sin(yaw) + normalZ * Math.cos(yaw);
  player.position.x += worldNormalX * penetration;
  player.position.z += worldNormalZ * penetration;

  const normalVelocity = player.velocity.x * worldNormalX + player.velocity.z * worldNormalZ;
  if (normalVelocity < 0) {
    player.velocity.x -= worldNormalX * normalVelocity;
    player.velocity.z -= worldNormalZ * normalVelocity;
  }
}

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function enforceGroundContact(player, config) {
  const groundY = typeof config.groundHeightAt === "function"
    ? config.groundHeightAt(player.position.x, player.position.z)
    : config.groundY;
  if (player.position.y <= groundY) {
    player.position.y = groundY;
    if (player.velocity.y < 0) {
      player.velocity.y = 0;
    }
    player.onGround = true;
    return;
  }

  player.onGround = false;
}
