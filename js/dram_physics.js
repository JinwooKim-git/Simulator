// DramPhysics — 1T1C DRAM 상태 전이 순수 함수 모듈 (UMD-lite, 브라우저/Node 겸용)
//
// Phase 0: 기존 Dram_simulator.html의 동작을 보존한 채 구조만 분리했다.
// 유일한 의도적 변경은 프레임 기반 → dt(초) 기반 전환 (PHYSICS_REVIEW 2.5, L4):
// 기존 프레임당 상수를 60fps 기준으로 환산했다.
//   충전/방전 0.8 %/frame → 48 %/s, 누설 0.02 %/frame → 1.2 %/s
// TODO(REVIEW): 60fps 환산 기준값 승인 필요.
//
// 알려진 물리 갭(G5, G6, L2, L3)의 동작은 그대로 유지 — characterization
// 테스트(tests/dram_characterization.test.js)가 고정하고 있으며 Phase 2에서 교체.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DramPhysics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    vTh: 1.0,               // V — 기존 코드 유지 (TODO(REVIEW))
    vMax: 3.0,              // V — 슬라이더 스케일
    chargeRatePerSec: 48,   // %/s (= 0.8/frame @60fps)
    leakRatePerSec: 1.2,    // %/s (= 0.02/frame @60fps)
    syncBand: 1             // % — 목표 근방 ±1에서 '안정화' 판정 (기존 동작)
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function isOn(wl, vth) { return wl >= vth; }

  // TODO(REVIEW): G5 특성 보존 — 충전 목표에 WL 상한이 없다 (BL 레벨까지 무조건).
  // Phase 2-1에서 min(V_BL, V_WL − Vth) 상한으로 교정한다.
  function targetCharge(bl) { return (bl / DEFAULTS.vMax) * 100; }

  // 시간 기반 전하 갱신. state: { wl, bl, vTh, charge }, dt: 초.
  // 반환: { charge, mode } — mode ∈ 'leakage' | 'charging' | 'discharging' | 'synced'
  // dt 불변성: 같은 총 시간이면 분할 호출과 단일 호출의 결과가 같다 (테스트 D7).
  function stepCharge(state, dt) {
    const vth = (state.vTh === undefined) ? DEFAULTS.vTh : state.vTh;
    let charge = state.charge;
    let mode;

    if (!isOn(state.wl, vth)) {
      // OFF: sub-threshold leakage — 선형 상수 누설 (L3 특성 보존, Phase 2-3에서 지수/온도 의존으로 교정)
      mode = 'leakage';
      if (charge > 0) charge = Math.max(0, charge - DEFAULTS.leakRatePerSec * dt);
    } else {
      const target = targetCharge(state.bl);
      if (charge < target - DEFAULTS.syncBand) {
        charge = Math.min(target, charge + DEFAULTS.chargeRatePerSec * dt);
        mode = 'charging';
      } else if (charge > target + DEFAULTS.syncBand) {
        charge = Math.max(target, charge - DEFAULTS.chargeRatePerSec * dt);
        mode = 'discharging';
      } else {
        mode = 'synced';
      }
    }

    return { charge: clamp(charge, 0, 100), mode: mode };
  }

  // TODO(REVIEW): L2 특성 보존 — refresh가 잔량과 무관하게 무조건 100% 재충전.
  // Phase 2에서 read(감지)–restore 경로로 재구현하고 임계 미달 시 DATA LOST 처리.
  function refreshCharge() { return 100; }

  // WL–장벽 연속 모델 (보존 대상): Vth 아래 선형 감소, 이상에서 붕괴, Vth에서 연속.
  function barrierRatio(wl, vth) {
    const t = (vth === undefined) ? DEFAULTS.vTh : vth;
    if (wl >= t) return Math.max(0, 0.2 - ((wl - t) / 2.0) * 0.2);
    return 1.0 - (wl / t) * 0.8;
  }

  // 밴드 뷰 오프셋 (px). 보존 불변식: 충전량 증가 → sourceDrop 증가
  // (전위↑ = 전자 에너지↓ = 밴드가 아래로). 이 부호 관계는 절대 깨지 말 것.
  function bandOffsets(charge, bl) {
    return {
      sourceDrop: (charge / 100) * 50,
      drainDrop: bl * 50
    };
  }

  return {
    DEFAULTS: DEFAULTS,
    isOn: isOn,
    targetCharge: targetCharge,
    stepCharge: stepCharge,
    refreshCharge: refreshCharge,
    barrierRatio: barrierRatio,
    bandOffsets: bandOffsets
  };
});
