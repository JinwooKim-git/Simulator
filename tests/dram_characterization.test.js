// DRAM characterization tests — Phase 0
//
// 목적: 물리 분리 + dt 기반 전환이 기존 Dram_simulator.html의 관찰 동작을
// 바꾸지 않았음을 고정한다. G5(Write 상한 없음), L2(무조건 refresh),
// L3(선형 누설)의 동작을 의도적으로 그대로 고정하며, Phase 2 교정 PR에서
// 해당 테스트를 물리 기대값(T11~T16)으로 교체한다.
// 보존 불변식(밴드 부호, 장벽 연속성)은 영구 유지 대상.
const test = require('node:test');
const assert = require('node:assert');
const Dram = require('../js/dram_physics.js');

function run(state, dt, steps) {
  let s = { ...state };
  let mode;
  for (let i = 0; i < steps; i++) {
    const r = Dram.stepCharge(s, dt);
    s.charge = r.charge;
    mode = r.mode;
  }
  return { charge: s.charge, mode };
}

// --- D1. G5 특성 고정: WL이 Vth만 넘으면 BL 레벨까지 무조건 충전 ---

test('D1: WL=1.5, BL=3 장시간 → charge 100 (WL 상한 없음 — G5 고정)', () => {
  // TODO(REVIEW): Phase 2-1에서 min(V_BL, V_WL−Vth) 상한 도입 시
  // 기대값이 16.7%로 교체된다 (PHYSICS_REVIEW T11).
  // 기존 동작: 목표 ±1%(syncBand) 안에 들어오면 정지 → 99~100 사이에서 안정
  const r = run({ wl: 1.5, bl: 3, vTh: 1.0, charge: 0 }, 1 / 60, 600);
  assert.ok(r.charge > 99, `expected > 99, got ${r.charge}`);
  assert.strictEqual(r.mode, 'synced');
});

test('D1b: 충전은 목표(BL 비례)에서 멈춘다 — BL=1.5 → 50%', () => {
  const r = run({ wl: 3, bl: 1.5, vTh: 1.0, charge: 0 }, 1 / 60, 600);
  assert.ok(Math.abs(r.charge - 50) <= 1);
  assert.strictEqual(r.mode, 'synced');
});

// --- D2. 방전: BL이 셀 전압보다 낮으면 목표까지 방전 ---

test('D2: charge 100에서 WL=3, BL=0 → 0까지 방전', () => {
  const r = run({ wl: 3, bl: 0, vTh: 1.0, charge: 100 }, 1 / 60, 600);
  assert.ok(r.charge <= 1);
});

// --- D3. L3 특성 고정: OFF 누설이 선형 1.2 %/s ---

test('D3: WL=0에서 1초 경과 → charge 50 → 48.8 (선형 누설 — L3 고정)', () => {
  const r = Dram.stepCharge({ wl: 0, bl: 0, vTh: 1.0, charge: 50 }, 1.0);
  assert.ok(Math.abs(r.charge - 48.8) < 1e-9);
  assert.strictEqual(r.mode, 'leakage');
});

// --- D4. L2 특성 고정: refresh는 잔량 무관 무조건 100 ---

test('D4: refreshCharge()는 항상 100 (마법 재충전 — L2 고정)', () => {
  // TODO(REVIEW): Phase 2-3에서 read–restore로 재구현 시
  // "charge 40 → refresh → 0 + DATA LOST"로 교체된다 (PHYSICS_REVIEW T14).
  assert.strictEqual(Dram.refreshCharge(), 100);
});

// --- D5. 보존 불변식: WL=Vth에서 장벽 높이 연속 ---

test('D5: barrierRatio가 Vth에서 연속 (양쪽 극한 = 0.2)', () => {
  const vth = 1.0;
  const below = Dram.barrierRatio(vth - 1e-9, vth);
  const at = Dram.barrierRatio(vth, vth);
  assert.ok(Math.abs(below - at) < 1e-6);
  assert.ok(Math.abs(at - 0.2) < 1e-9);
});

test('D5b: 장벽은 WL에 단조 감소', () => {
  let prev = Dram.barrierRatio(0, 1.0);
  for (let wl = 0.1; wl <= 3.0; wl += 0.1) {
    const cur = Dram.barrierRatio(wl, 1.0);
    assert.ok(cur <= prev + 1e-12, `wl=${wl}에서 장벽 증가`);
    prev = cur;
  }
});

// --- D6. 보존 불변식: 충전량 증가 → Source 밴드 아래로 (전위↑ = 전자에너지↓) ---

test('D6: sourceDrop이 charge에 단조 증가 (부호 관계 절대 보존)', () => {
  const lo = Dram.bandOffsets(30, 0).sourceDrop;
  const hi = Dram.bandOffsets(80, 0).sourceDrop;
  assert.ok(hi > lo);
  assert.strictEqual(Dram.bandOffsets(100, 0).sourceDrop, 50);
  assert.strictEqual(Dram.bandOffsets(0, 0).sourceDrop, 0);
});

// --- D7. dt 불변성 (PHYSICS_REVIEW T17): 분할 호출 == 단일 호출 ---

test('D7a: 충전 — dt=0.5 두 번 == dt=1.0 한 번', () => {
  const s = { wl: 3, bl: 3, vTh: 1.0, charge: 0 };
  const split = run(s, 0.5, 2).charge;
  const single = run(s, 1.0, 1).charge;
  assert.ok(Math.abs(split - single) < 1e-9);
});

test('D7b: 누설 — dt=0.5 두 번 == dt=1.0 한 번', () => {
  const s = { wl: 0, bl: 0, vTh: 1.0, charge: 80 };
  const split = run(s, 0.5, 2).charge;
  const single = run(s, 1.0, 1).charge;
  assert.ok(Math.abs(split - single) < 1e-9);
});

test('D7c: 목표 경계에서도 dt 불변 (큰 dt가 목표를 넘지 않음)', () => {
  const s = { wl: 3, bl: 1.5, vTh: 1.0, charge: 45 };
  const split = run(s, 0.25, 4).charge;
  const single = run(s, 1.0, 1).charge;
  assert.ok(Math.abs(split - single) < 1e-9);
  assert.ok(single <= 50 + 1e-9); // 목표 초과 금지
});

// --- D8. 클램프 ---

test('D8: charge는 0 아래로 내려가지 않는다', () => {
  const r = Dram.stepCharge({ wl: 0, bl: 0, vTh: 1.0, charge: 0.5 }, 10);
  assert.strictEqual(r.charge, 0);
});

test('D8b: OFF 상태 문턱 미만 WL에서도 누설 지속 (sub-threshold)', () => {
  const r = Dram.stepCharge({ wl: 0.9, bl: 3, vTh: 1.0, charge: 50 }, 1.0);
  assert.strictEqual(r.mode, 'leakage');
  assert.ok(r.charge < 50);
});
