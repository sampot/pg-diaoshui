/**
 * 釣水球 — 介面與互動（Canvas 渲染、拖曳／鍵盤控制）。
 * 水球沿水面漂動，玩家移動釣竿、按住「沉下」讓紙圈套頸撈起。
 */
import {
  newGame,
  update,
  moveRod,
  hookTip,
  canCatch,
  W,
  WATER_Y,
  ROD_Y,
  MAX_DEPTH,
  GAME_TIME,
  TARGET,
} from "./game.js";
import { DiaoshuiAudio } from "./audio.js";

const audio = new DiaoshuiAudio();

const els = {
  time: document.getElementById("time"),
  caught: document.getElementById("caught"),
  target: document.getElementById("target"),
  misses: document.getElementById("misses"),
  best: document.getElementById("best"),
  status: document.getElementById("status"),
  canvas: document.getElementById("game"),
  btnDown: document.getElementById("btn-down"),
  btnStart: document.getElementById("btn-start"),
  btnMute: document.getElementById("btn-mute"),
};

const BEST_KEY = "pg-diaoshui-best";

let state = null;
let phase = "idle"; // idle | playing | over
let running = false;
let raf = 0;
let lastTs = 0;
let best = 0;
let dragging = false;
let sinking = false;

const ctx = els.canvas.getContext("2d");

function setStatus(msg, tone = "") {
  els.status.textContent = msg;
  els.status.dataset.tone = tone;
}

function syncHud() {
  if (!state) return;
  els.time.textContent = String(Math.ceil(state.time));
  els.caught.textContent = String(state.caughtCount);
  els.target.textContent = String(state.target);
  els.misses.textContent = String(state.misses);
}

async function loadBest() {
  try {
    const res = await fetch(`/api/kv/${BEST_KEY}`);
    if (res.ok) {
      const t = (await res.text()).trim();
      if (/^\d+$/.test(t)) {
        best = Number(t);
        els.best.textContent = String(best);
        return;
      }
    }
  } catch {
    /* 無 KV */
  }
  els.best.textContent = "0";
}

async function saveBest() {
  els.best.textContent = String(best);
  try {
    await fetch(`/api/kv/${BEST_KEY}`, { method: "PUT", body: String(best) });
  } catch {
    /* 無 KV */
  }
}

function startGame() {
  audio.unlock();
  audio.select();
  state = newGame();
  phase = "playing";
  running = true;
  sinking = false;
  els.btnDown.setAttribute("aria-pressed", "false");
  els.btnStart.textContent = "重新開始";
  syncHud();
  setStatus("左右移動釣竿，按住「沉下」套頸撈起！");
  lastTs = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}

function tick(ts) {
  if (!running || !state) return;
  const dt = Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;

  const dir = 0; // 拖曳與按鈕控制經由 moveRod 直接定位 x
  const events = update(state, dt, dir, sinking);
  for (const ev of events) {
    if (ev.type === "hook") {
      audio.hook();
      setStatus("套中了！收竿…", "ok");
    } else if (ev.type === "catch") {
      audio.catch();
      setStatus(ev.message, "ok");
    } else if (ev.type === "miss") {
      audio.miss();
      setStatus(ev.message, "warn");
    } else if (ev.type === "end") {
      onEnd(ev.won);
    }
  }
  syncHud();
  render();
  if (running) raf = requestAnimationFrame(tick);
}

function onEnd(won) {
  running = false;
  phase = "over";
  cancelAnimationFrame(raf);
  if (won) {
    const caught = state.caughtCount;
    if (caught > best) {
      best = caught;
      saveBest();
    }
    setStatus(`過關！釣到 ${state.caughtCount} 顆。`, "ok");
    audio.win();
  } else {
    setStatus(`時間到！釣到 ${state.caughtCount}/${state.target} 顆。`, "warn");
    audio.miss();
  }
  els.btnStart.textContent = "再玩一次";
}

function render() {
  ctx.clearRect(0, 0, W, ctx.canvas.height);
  const H = ctx.canvas.height;

  // 水
  ctx.fillStyle = "rgba(27,106,138,0.5)";
  ctx.fillRect(0, WATER_Y, W, H - WATER_Y);

  // 釣竿
  ctx.strokeStyle = "#5b3a1e";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(state.rodX, ROD_Y);
  ctx.lineTo(hookTip(state).x, hookTip(state).y);
  ctx.stroke();

  // 紙圈（鉤）
  const hook = hookTip(state);
  ctx.strokeStyle = "#f8f4ec";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(hook.x, hook.y, 6, 0, Math.PI * 2);
  ctx.stroke();

  // 水球
  for (const b of state.balloons) {
    if (b.gone) continue;
    const inx = b.x < 0 || b.x > W;
    if (inx) continue;
    ctx.fillStyle = b.caught ? "#ff8a5c" : "#ff5c7a";
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 2;
    ctx.stroke();
    // 高光
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.25, 0, Math.PI * 2);
    ctx.fill();
    // 頸部小結
    ctx.fillStyle = "#d84315";
    ctx.fillRect(b.x - 2, b.y - b.r + 2, 4, 5);
  }
}

/* --- 控制 --- */
function toWorldX(clientX) {
  const rect = els.canvas.getBoundingClientRect();
  const scale = W / rect.width;
  return (clientX - rect.left) * scale;
}

els.canvas.addEventListener("pointerdown", (e) => {
  if (phase !== "playing") return;
  dragging = true;
  els.canvas.setPointerCapture(e.pointerId);
  moveRod(state, toWorldX(e.clientX));
});
els.canvas.addEventListener("pointermove", (e) => {
  if (!dragging || phase !== "playing") return;
  moveRod(state, toWorldX(e.clientX));
});
els.canvas.addEventListener("pointerup", () => {
  dragging = false;
});

els.btnDown.addEventListener("pointerdown", () => {
  if (phase !== "playing") return;
  sinking = true;
  els.btnDown.setAttribute("aria-pressed", "true");
});
els.btnDown.addEventListener("pointerup", () => {
  sinking = false;
  els.btnDown.setAttribute("aria-pressed", "false");
});
els.btnDown.addEventListener("pointerleave", () => {
  sinking = false;
  els.btnDown.setAttribute("aria-pressed", "false");
});

els.btnStart.addEventListener("click", startGame);
els.btnMute.addEventListener("click", () => {
  const on = audio.enabled;
  audio.setEnabled(!on);
  els.btnMute.setAttribute("aria-pressed", String(!on));
  els.btnMute.textContent = on ? "音效" : "靜音";
});

/* 鍵盤：左右移動 */
window.addEventListener("keydown", (e) => {
  if (phase !== "playing" || !state) return;
  if (e.key === "ArrowLeft") moveRod(state, state.rodX - 12);
  else if (e.key === "ArrowRight") moveRod(state, state.rodX + 12);
});

init();
async function init() {
  await loadBest();
  state = newGame();
  syncHud();
  render();
}
