/**
 * pg-diaoshui — 釣水球（夜市紙鉤）純函式邏輯。
 *
 * 一根釣竿垂下釣線，線端有個小紙圈（鉤）。水面上漂著一排水球（氣球）。
 * 玩家左右移動釣竿，點「下沉」讓紙圈套住水球頸部，撈起即得分。
 * 釣太用力（下沉太深）或紙圈破掉而沒撈到 → miss（紙圈耗損）。計時制（60 秒），
 * 時間內釣到 N 顆過關。
 *
 * 本模組以簡單幾何模擬：水球沿 x 漂動、釣竿左右移動、下沉判定＝釣線末端與
 * 水球頸部在幾何上夠近即「套中」。純函式、不碰 DOM。
 */

export const W = 360; // 邏輯寬
export const WATER_Y = 150; // 水面（水球中心高度）
export const ROD_Y = 40; // 釣竿（釣線起點）高度
export const LINE_SPEED = 260; // 下沉／上收速度（px/s）
export const MAX_DEPTH = 130; // 釣線最長（超出即破圈 miss）
export const CATCH_RANGE = 14; // 套中判定距離
export const ROD_SPEED = 320; // 釣竿水平移動速度
export const BALLOON_SPEED = 46; // 水球漂流速度
export const GAME_TIME = 60; // 秒
export const TARGET = 8; // 過關所需顆數
export const ROD_R = 16; // 釣竿（鉤）半徑

/** 建立新局。 */
export function newGame({ time = GAME_TIME, target = TARGET, count = 10 } = {}) {
  const balloons = [];
  const spacing = W / (count + 1);
  for (let i = 0; i < count; i++) {
    balloons.push({
      x: spacing * (i + 1) + jitter(i),
      y: WATER_Y,
      r: 22,
      dir: i % 2 === 0 ? 1 : -1,
      caught: false,
      gone: false,
    });
  }
  return {
    balloons,
    rodX: W / 2,
    rodY: ROD_Y,
    depth: 0, // 0 = 釣線收起
    sinking: false,
    caughtBalloon: null, // 目前鉤住的水球
    time,
    target,
    caughtCount: 0,
    misses: 0,
    over: false,
    won: false,
    message: "",
  };
}

function jitter(i) {
  return ((i % 3) - 1) * 6;
}

/** 更新：dt 秒。移動釣竿（-1..1）、下沉開關。回傳事件陣列。 */
export function update(state, dt, rodDir = 0, sinking = state.sinking) {
  const events = [];

  // 釣竿橫移
  state.rodX = clamp(state.rodX + rodDir * ROD_SPEED * dt, ROD_R, W - ROD_R);

  // 水球漂
  for (const b of state.balloons) {
    if (b.gone || state.caughtBalloon === b) continue;
    b.x += b.dir * BALLOON_SPEED * dt;
    if (b.x < b.r) {
      b.x = b.r;
      b.dir = 1;
    } else if (b.x > W - b.r) {
      b.x = W - b.r;
      b.dir = -1;
    }
  }

  if (!state.over) {
    if (state.caughtBalloon) {
      // 已套中 → 收竿上捲，把水球帶離水面
      state.depth = Math.max(0, state.depth - LINE_SPEED * dt);
      state.rodY = ROD_Y + state.depth;
      const b = state.caughtBalloon;
      b.y = state.rodY - 10;
      if (state.depth <= 1) {
        b.y = WATER_Y;
        b.gone = true;
        state.caughtCount += 1;
        state.caughtBalloon = null;
        events.push({ type: "catch", balloon: b, message: "+1！" });
        progressCheck(state, events);
      }
    } else if (sinking) {
      state.depth += LINE_SPEED * dt;
      state.rodY = ROD_Y + Math.min(state.depth, MAX_DEPTH);
      if (state.depth >= MAX_DEPTH) {
        state.misses += 1;
        state.depth = 0;
        state.rodY = ROD_Y;
        events.push({ type: "miss", reason: "depth", message: "釣太深，紙圈破了！" });
      } else {
        const near = nearestCaughtNear(state, hookTip(state));
        if (near) {
          near.caught = true;
          state.caughtBalloon = near;
          events.push({ type: "hook", balloon: near, message: "套中了！收竿..." });
        }
      }
    } else if (state.depth > 0) {
      // 未按下沉也無釣獲 → 線自然回縮
      state.depth = Math.max(0, state.depth - LINE_SPEED * dt);
      state.rodY = ROD_Y + state.depth;
    }
  }

  // 計時
  if (!state.over) {
    state.time -= dt;
    if (state.time <= 0) {
      state.time = 0;
      state.over = true;
      const pass = state.caughtCount >= state.target;
      state.won = pass;
      events.push({ type: "end", won: pass, message: pass ? "過關！" : "時間到！" });
    }
  }

  return events;
}

/** 釣線末端（鉤）位置。 */
export function hookTip(state) {
  return { x: state.rodX, y: state.rodY };
}

function nearestCaughtNear(state, hook) {
  for (const b of state.balloons) {
    if (b.gone || b.caught) continue;
    if (Math.hypot(b.x - hook.x, b.y - hook.y) < CATCH_RANGE + b.r) {
      return b;
    }
  }
  return null;
}

function progressCheck(state, events) {
  if (state.caughtCount >= state.target) {
    state.over = true;
    state.won = true;
    events.push({ type: "end", won: true, message: "過關！" });
  }
}

/** 移動釣竿（供 UI）。 */
export function moveRod(state, rodX) {
  state.rodX = clamp(rodX, ROD_R, W - ROD_R);
}

/** 判定某位置是否「可套中」（供測試）。 */
export function canCatch(state, rodX, rodY) {
  const hook = { x: rodX, y: rodY };
  for (const b of state.balloons) {
    if (b.gone || b.caught) continue;
    if (Math.hypot(b.x - hook.x, b.y - hook.y) < CATCH_RANGE + b.r) return b;
  }
  return null;
}

/** 計算仍在水上的水球數（未流逝）。 */
export function remainingBalloons(state) {
  return state.balloons.filter((b) => !b.gone).length;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
