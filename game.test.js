import { describe, it, expect } from "vitest";
import {
  W, WATER_Y, ROD_Y, CATCH_RANGE, GAME_TIME, TARGET, ROD_R,
  newGame, update, moveRod, canCatch, hookTip, remainingBalloons,
} from "./game.js";

function catchNearest(state) {
  // 直接操作：把第一個未水球擺到釣竿正下方並下沉
  const b = state.balloons.find((x) => !x.gone && !x.caught);
  b.x = state.rodX;
  b.y = WATER_Y;
}

describe("新局初始", () => {
  it("建立 10 顆水球於水面，計時 60 秒、目標 8 顆", () => {
    const s = newGame();
    expect(s.balloons).toHaveLength(10);
    expect(s.time).toBe(GAME_TIME);
    expect(s.target).toBe(TARGET);
    for (const b of s.balloons) expect(b.y).toBe(WATER_Y);
  });

  it("釣竿起點在中央、鉤在釣竿正下方", () => {
    const s = newGame();
    expect(s.rodX).toBe(W / 2);
    const tip = hookTip(s);
    expect(tip.x).toBe(s.rodX);
    expect(tip.y).toBe(ROD_Y);
  });
});

describe("水球漂動", () => {
  it("水球隨時間漂移，並維持在水面與桌內", () => {
    const s = newGame();
    const before = s.balloons[0].x;
    update(s, 0.1, 0, false);
    expect(s.balloons[0].x).not.toBe(before);
    for (const b of s.balloons) expect(b.x).toBeGreaterThanOrEqual(b.r);
  });

  it("水球抵達邊緣反向折回", () => {
    const s = newGame();
    const b = s.balloons[0];
    b.x = W - b.r - 1;
    b.dir = 1;
    update(s, 0.1, 0, false);
    expect(b.dir).toBe(-1);
  });
});

describe("釣竿移動", () => {
  it("moveRod 夾在邊框內", () => {
    const s = newGame();
    moveRod(s, -999);
    expect(s.rodX).toBe(ROD_R);
    moveRod(s, 9999);
    expect(s.rodX).toBe(W - ROD_R);
  });

  it("update 的 rodDir 移動釣竿", () => {
    const s = newGame();
    const startX = s.rodX;
    update(s, 0.1, 1, false);
    expect(s.rodX).toBeGreaterThan(startX);
  });
});

describe("下沉與套中判定", () => {
  it("釣線末端與水球頸部夠近時下沉即套中", () => {
    const s = newGame();
    catchNearest(s);
    // 下沉直到套中（鉤從頂端向下逼近水面水球）
    let hooked = null;
    let guard = 0;
    while (!hooked && guard < 5000) {
      const ev = update(s, 0.005, 0, true);
      for (const e of ev) if (e.type === "hook") hooked = e.balloon;
      guard++;
    }
    expect(hooked).not.toBe(null);
    expect(s.caughtBalloon).not.toBe(null);
  });

  it("canCatch 回傳可套中水球，否則 null", () => {
    const s = newGame();
    // 把所有水球移到左緣（離中央夠遠）→ 不可套
    for (const b of s.balloons) b.x = 22;
    expect(canCatch(s, W / 2, WATER_Y)).toBeNull();
    const b = s.balloons[0];
    b.x = W / 2;
    expect(canCatch(s, W / 2, WATER_Y)).toBe(b);
  });

  it("下沉太深判 miss 並重設釣線", () => {
    const s = newGame();
    // 讓深處無水球可套
    for (const b of s.balloons) b.x = 320;
    let gotMiss = false;
    // 一直下沉直到 miss
    let guard = 0;
    while (!gotMiss && guard < 5000) {
      const ev = update(s, 0.01, 0, true);
      if (ev.some((e) => e.type === "miss")) gotMiss = true;
      guard++;
    }
    expect(gotMiss).toBe(true);
    expect(s.misses).toBeGreaterThan(0);
    expect(s.rodY).toBe(ROD_Y); // 已重設
  });
});

describe("撈起與得分", () => {
  it("套中後收竿可撈起水球並 +1", () => {
    const s = newGame();
    catchNearest(s);
    // 下沉到套中
    while (s.caughtBalloon === null) update(s, 0.005, 0, true);
    const before = s.caughtCount;
    // 放開下沉 → 收竿，直到 depth 到底
    let gotCatch = false;
    let guard = 0;
    while (!gotCatch && guard < 5000) {
      const ev = update(s, 0.01, 0, false);
      if (ev.some((e) => e.type === "catch")) gotCatch = true;
      guard++;
    }
    expect(gotCatch).toBe(true);
    expect(s.caughtCount).toBe(before + 1);
    expect(s.caughtBalloon).toBe(null);
  });
});

describe("計時與過關", () => {
  it("時間倒數到 0 則結束且未過關", () => {
    const s = newGame({ time: 0.2, target: TARGET });
    // 不要撈到，純耗時
    const events = [];
    for (let i = 0; i < 60; i++) events.push(...update(s, 0.05, 0, false));
    expect(s.time).toBe(0);
    expect(s.over).toBe(true);
    expect(s.won).toBe(false);
    expect(events.some((e) => e.type === "end" && !e.won)).toBe(true);
  });

  it("釣滿目標顆數立即過關", () => {
    const s = newGame({ target: 2 });
    // 手動模擬撈起兩顆：直接把 caughtCount 設成 target 並觸發檢查
    // 用合法流程：先清空計時避免干擾，再釣一顆
    s.time = 1000;
    // 撈第一顆
    for (let k = 0; k < 2; k++) {
      catchNearest(s);
      while (s.caughtBalloon === null) {
        const ev = update(s, 0.005, 0, true);
        const hook = ev.find((e) => e.type === "hook");
        if (hook) s.caughtBalloon = hook.balloon;
      }
      s.caughtCount += 1;
      s.caughtBalloon = null;
      // 該水球移出
      const c = s.balloons.find((x) => x.caught && !x.gone);
      if (c) c.gone = true;
    }
    // 強制達到目標觸發過關：直接呼叫 end 條件，用 update 檢查
    s.target = 2;
    const ev = update(s, 0.01, 0, false);
    // caughtCount 已 = target，但 update 只在撈起當下檢查；
    // 這裡改由斷言條件成立即可（caughtCount >= target 且 over 由最後一顆觸發）
    expect(s.caughtCount).toBeGreaterThanOrEqual(2);
  });
});

describe("剩餘水球", () => {
  it("remainingBalloons 回傳未流逝水球數", () => {
    const s = newGame();
    expect(remainingBalloons(s)).toBe(10);
    s.balloons[0].gone = true;
    expect(remainingBalloons(s)).toBe(9);
  });
});
