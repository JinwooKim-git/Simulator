// FabPhysics — Virtual Fab 상태 전이 순수 함수 모듈 (UMD-lite, 브라우저/Node 겸용)
//
// Phase 0에서 구조 분리, Phase 1에서 물리를 순차 교정 중.
// 교정 완료: G1 열산화(Deal-Grove) — Phase 1-1.
// 잔여 갭(G2~G4)은 characterization 테스트가 현재 동작을 고정하고 있으며,
// 각 교정 PR에서 물리 기대값 테스트로 교체된다.
//
// 데이터 모델 (b): 컬럼별 완전 독립 스택 (2026-07-05 소유자 승인)
//   wafer = {
//     cols: { L: [{mat, thk}, ...], C: [...], R: [...] },  // 각 배열은 bottom → top
//     pendingExposure: null | 'center' | 'edges'
//   }
// 모든 함수는 입력 wafer를 변경하지 않고 새 wafer를 반환한다. Canvas/DOM 접근 금지.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FabPhysics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLS = ['L', 'C', 'R'];

  const WET_TARGETS = { BOE: 'SiO2', PAN: 'Al' };
  const WET_ETCH_AMOUNT = 1000;      // 기존 동작: 노출된 타깃을 사실상 전량 제거
  const DEEP_ETCH_RATE = 3;          // nm/sec — 기존 동작: depth = time * 3
  const PR_COAT_MARGIN = 60;         // planarization: 최고 높이 + 60nm

  function cloneWafer(wafer) {
    const cols = {};
    COLS.forEach(function (c) {
      cols[c] = wafer.cols[c].map(function (l) { return { mat: l.mat, thk: l.thk }; });
    });
    return { cols: cols, pendingExposure: wafer.pendingExposure || null };
  }

  function createWafer(substrateThk) {
    const thk = (substrateThk === undefined) ? 200 : substrateThk;
    const cols = {};
    COLS.forEach(function (c) { cols[c] = [{ mat: 'Si', thk: thk }]; });
    return { cols: cols, pendingExposure: null };
  }

  function columnHeight(colStack) {
    return colStack.reduce(function (s, l) { return s + l.thk; }, 0);
  }

  function heights(wafer) {
    const h = {};
    COLS.forEach(function (c) { h[c] = columnHeight(wafer.cols[c]); });
    return h;
  }

  // 컬럼별 최상단 노출 재질 (thk > 0인 최상층). 없으면 null.
  function topExposed(wafer) {
    const res = {};
    COLS.forEach(function (c) {
      res[c] = null;
      const stack = wafer.cols[c];
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].thk > 0) { res[c] = stack[i].mat; break; }
      }
    });
    return res;
  }

  // 두께 0이 된 레이어 제거 (기존 cleanEmptyLayers에 대응)
  function normalize(wafer) {
    const w = cloneWafer(wafer);
    COLS.forEach(function (c) {
      w.cols[c] = w.cols[c].filter(function (l) { return l.thk > 0; });
    });
    return w;
  }

  // --- 증착 ---

  // TODO(REVIEW): G3 특성 보존 — 모든 증착 장비가 단차와 무관하게 전 컬럼 균일 증착.
  // Phase 1-3에서 장비별 step coverage 계수를 도입한다.
  function deposit(wafer, mat, thk) {
    const w = cloneWafer(wafer);
    COLS.forEach(function (c) { w.cols[c].push({ mat: mat, thk: thk }); });
    return w;
  }

  // --- 열산화 (Phase 1-1, G1 교정: PHYSICS_REVIEW 1.1) ---
  //
  // Deal-Grove 선형–포물선 모델: x² + A·x = B·(t + τ).
  // 기존 산화막 x₀는 등가 시간 τ_eq = (x₀² + A·x₀)/B 로 반영 → 두꺼울수록 둔화.
  // 성장은 노출된 Si 계열 표면(또는 그 위가 SiO2뿐인 Si)에서만 일어나고,
  // Si 소모량 = 0.44 × 성장 산화막 두께 (몰밀도비 2.2×10²²/5.0×10²² ≈ 0.44)
  // → 표면은 0.56·Δx 만큼만 상승한다.
  const OXIDATION = {
    // TODO(REVIEW): 1000°C 교과서 대표값 (Deal & Grove 1965; Jaeger/Campbell 수준).
    // A[µm], B[µm²/h], tau[h]. dry의 τ=0.37h는 초기 급속 성장 구간 보정 —
    // 짧은 dry 산화도 즉시 ~23nm 등가에서 시작하는 근사가 된다 (승인 필요).
    dry: { A: 0.165, B: 0.0117, tau: 0.37 },
    wet: { A: 0.226, B: 0.287, tau: 0 },
    SI_CONSUMPTION_RATIO: 0.44
  };

  // TODO(REVIEW): 도핑된 Si(Si-n/Si-p)도 산화 대상에 포함 (물리적으로 타당하나
  // PHYSICS_REVIEW 1.1은 "Si 및 Poly-Si"만 명시 — 확인 요청).
  const OXIDIZABLE = ['Si', 'Si-n', 'Si-p', 'Poly-Si'];

  // 총 산화막 두께 [nm]: 시각 t_h + max(τ, τ_eq(x₀))에서의 Deal-Grove 해.
  // dry의 τ=0.37h는 "등가 초기 산화막 ~23nm"(초기 급속 성장 보정)이므로
  // 기존 산화막의 τ_eq와 합산하지 않고 max를 취한다 — 합산하면 실행할 때마다
  // τ만큼 이력이 중복 가산되어 time=0 반복 실행으로도 산화막이 계속 자란다
  // (브라우저 검증에서 발견된 회계 오류).
  function dealGroveTotal(x0nm, timeH, p) {
    const x0 = x0nm / 1000; // µm
    const tauEq = (x0 * x0 + p.A * x0) / p.B;
    const tEff = timeH + Math.max(p.tau, tauEq);
    const x = (p.A / 2) * (Math.sqrt(1 + (4 * p.B * tEff) / (p.A * p.A)) - 1);
    return x * 1000; // nm
  }

  // 한 컬럼 산화 (제자리 수정 — oxidize()가 클론 후 호출).
  // 반환: { grown, consumed, reason } — reason은 성장 0일 때의 사유.
  function oxidizeColumn(colStack, mode, timeMin) {
    const p = OXIDATION[mode];
    if (!(timeMin > 0)) return { grown: 0, consumed: 0, reason: '시간 0' };
    // 위에서부터: 연속된 SiO2는 기존 산화막(x₀)으로 누적, 그 아래 첫 재질 확인
    let x0 = 0;
    let siIdx = -1;
    for (let i = colStack.length - 1; i >= 0; i--) {
      if (colStack[i].thk <= 0) continue;
      if (colStack[i].mat === 'SiO2') { x0 += colStack[i].thk; continue; }
      siIdx = i;
      break;
    }
    if (siIdx < 0) return { grown: 0, consumed: 0, reason: 'Si 없음' };
    if (OXIDIZABLE.indexOf(colStack[siIdx].mat) < 0) {
      return { grown: 0, consumed: 0, reason: colStack[siIdx].mat + ' 차단' };
    }

    let grown = Math.max(0, dealGroveTotal(x0, timeMin / 60, p) - x0);
    let consumed = OXIDATION.SI_CONSUMPTION_RATIO * grown;
    // Si 레이어가 다 소모되면 그만큼만 성장 (재료 회계 보존)
    if (consumed > colStack[siIdx].thk) {
      consumed = colStack[siIdx].thk;
      grown = consumed / OXIDATION.SI_CONSUMPTION_RATIO;
    }
    colStack[siIdx].thk -= consumed;

    // 새 산화막은 Si 계면에서 생성 — Si 바로 위의 SiO2 레이어에 더하고, 없으면 삽입
    let added = false;
    for (let i = siIdx + 1; i < colStack.length; i++) {
      if (colStack[i].thk <= 0) continue;
      if (colStack[i].mat === 'SiO2') { colStack[i].thk += grown; added = true; }
      break;
    }
    if (!added) colStack.splice(siIdx + 1, 0, { mat: 'SiO2', thk: grown });

    return { grown: grown, consumed: consumed, reason: null };
  }

  // 열산화: mode 'dry' | 'wet', timeMin 분 단위. 컬럼별 독립 적용.
  function oxidize(wafer, params) {
    const mode = (params && params.mode === 'wet') ? 'wet' : 'dry';
    const timeMin = params ? params.timeMin : 0;
    const w = cloneWafer(wafer);
    const results = {};
    COLS.forEach(function (c) { results[c] = oxidizeColumn(w.cols[c], mode, timeMin); });
    return { wafer: w, results: results, mode: mode };
  }

  // --- 리소그래피 ---

  // PR 스핀코팅: 최고 컬럼 높이 + 60nm까지 채움 (planarization — 보존 대상 동작)
  // 새 PR은 미노광 상태 — 이전 노광 상태를 초기화한다 (기존 코드에서 expMask가
  // PR 레이어에 붙어 있어 새 코팅이 항상 미노광이었던 동작을 보존).
  function spinCoatPR(wafer) {
    const w = cloneWafer(wafer);
    w.pendingExposure = null;
    const h = heights(w);
    const maxH = Math.max(h.L, h.C, h.R);
    COLS.forEach(function (c) {
      w.cols[c].push({ mat: 'PR', thk: (maxH - h[c]) + PR_COAT_MARGIN });
    });
    return w;
  }

  // 마스크 극성: dark → center 노출(트렌치/홀), clear → edge 노출(라인/게이트)
  function expose(wafer, maskType) {
    const w = cloneWafer(wafer);
    const hasPR = COLS.some(function (c) {
      return w.cols[c].some(function (l) { return l.mat === 'PR' && l.thk > 0; });
    });
    if (!hasPR) return { wafer: w, exposed: false };
    w.pendingExposure = (maskType === 'dark') ? 'center' : 'edges';
    return { wafer: w, exposed: true };
  }

  // 현상: 노출 지정된 컬럼의 최상단 PR 제거
  function develop(wafer) {
    const w = cloneWafer(wafer);
    const hasPR = COLS.some(function (c) {
      return w.cols[c].some(function (l) { return l.mat === 'PR' && l.thk > 0; });
    });
    if (!w.pendingExposure || !hasPR) return { wafer: w, developed: false };
    const targets = (w.pendingExposure === 'center') ? ['C'] : ['L', 'R'];
    targets.forEach(function (c) {
      const stack = w.cols[c];
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].mat === 'PR' && stack[i].thk > 0) { stack[i].thk = 0; break; }
      }
    });
    return { wafer: w, developed: true };
  }

  // Asher: 모든 PR 제거
  function ash(wafer) {
    const w = cloneWafer(wafer);
    COLS.forEach(function (c) {
      w.cols[c].forEach(function (l) { if (l.mat === 'PR') l.thk = 0; });
    });
    return w;
  }

  // --- 식각 ---

  // 한 컬럼을 위에서부터 식각. matchFn이 false인 재질을 만나면 정지.
  // TODO(REVIEW): G4 특성 보존 — 무한 선택비(다른 재질에서 무조건 정지),
  // over-etch 하부 손실 없음, wet 언더컷 없음. Phase 1-2에서 유한 선택비로 교정.
  function etchColumn(colStack, matchFn, amount) {
    let remaining = amount;
    for (let i = colStack.length - 1; i >= 0 && remaining > 0; i--) {
      if (colStack[i].thk > 0) {
        if (matchFn(colStack[i].mat)) {
          const etched = Math.min(colStack[i].thk, remaining);
          colStack[i].thk -= etched;
          remaining -= etched;
        } else break; // 선택비 정지
      }
    }
  }

  // RIE: 타깃 재질이 노출된 컬럼만, 타깃 재질만 식각
  function dryEtch(wafer, targetMat, amount) {
    const w = cloneWafer(wafer);
    const tops = topExposed(w);
    COLS.forEach(function (c) {
      if (tops[c] === targetMat) {
        etchColumn(w.cols[c], function (m) { return m === targetMat; }, amount);
      }
    });
    return w;
  }

  // TODO(REVIEW): 기존 동작 보존 — 'Si_Deep' 매칭이 startsWith('Si')라서
  // Si/Si-n/Si-p뿐 아니라 SiO2/SiNx까지 관통하고, Poly-Si는 제외된다.
  // 의도된 것인지 소유자 확인 필요 (아마 비의도 — Phase 1에서 재검토).
  function matchesDeepSi(mat) { return mat.indexOf('Si') === 0; }

  // DRIE: 최상층이 Si계('Si'로 시작)인 컬럼만 깊이 식각
  function deepEtch(wafer, timeSec) {
    const w = cloneWafer(wafer);
    const depth = timeSec * DEEP_ETCH_RATE;
    const tops = topExposed(w);
    COLS.forEach(function (c) {
      if (tops[c] && matchesDeepSi(tops[c])) {
        etchColumn(w.cols[c], matchesDeepSi, depth);
      }
    });
    return { wafer: w, depth: depth };
  }

  // Wet: BOE → SiO2, PAN → Al. 노출된 타깃을 전량 제거 (등방성/언더컷 없음 — G4 보존)
  function wetEtch(wafer, etchant) {
    const target = WET_TARGETS[etchant];
    const w = cloneWafer(wafer);
    if (!target) return { wafer: w, target: null };
    const tops = topExposed(w);
    COLS.forEach(function (c) {
      if (tops[c] === target) {
        etchColumn(w.cols[c], function (m) { return m === target; }, WET_ETCH_AMOUNT);
      }
    });
    return { wafer: w, target: target };
  }

  // --- 이온주입 ---

  // TODO(REVIEW): G2 버그를 의도적으로 재현 (Phase 0 characterization).
  // 기존 코드는 mat이 레이어 전역 속성이라, 한 컬럼만 노출돼도 모든 컬럼의
  // 최하단 Si 레이어가 도핑되었다. 새 모델에서 그 관찰 동작을 그대로 보존:
  // "한 컬럼이라도 Si가 노출되면, 마스크로 가린 컬럼 포함 전 컬럼의 최하단
  // Si 레이어를 도핑". Phase 1-4에서 노출 컬럼만 도핑하도록 교정하고
  // 이 주석과 테스트 F8을 함께 교체한다. 도핑 깊이 개념도 그때 도입.
  function implant(wafer, dopant) {
    const w = cloneWafer(wafer);
    const newSi = (dopant === 'n') ? 'Si-n' : 'Si-p';
    const tops = topExposed(w);
    const anyExposed = COLS.some(function (c) { return tops[c] === 'Si'; });
    if (anyExposed) {
      COLS.forEach(function (c) {
        const stack = w.cols[c];
        for (let i = 0; i < stack.length; i++) {
          if (stack[i].mat === 'Si' && stack[i].thk > 0) { stack[i].mat = newSi; break; }
        }
      });
    }
    return { wafer: w, doped: anyExposed, mat: newSi };
  }

  return {
    COLS: COLS,
    createWafer: createWafer,
    cloneWafer: cloneWafer,
    heights: heights,
    topExposed: topExposed,
    normalize: normalize,
    deposit: deposit,
    OXIDATION: OXIDATION,
    oxidize: oxidize,
    spinCoatPR: spinCoatPR,
    expose: expose,
    develop: develop,
    ash: ash,
    dryEtch: dryEtch,
    deepEtch: deepEtch,
    wetEtch: wetEtch,
    implant: implant
  };
});
