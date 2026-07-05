// FabPhysics — Virtual Fab 상태 전이 순수 함수 모듈 (UMD-lite, 브라우저/Node 겸용)
//
// Phase 0: 기존 Fab_simulator.html의 동작을 그대로 보존한 채 구조만 분리했다.
// 알려진 물리 갭(G1~G4)의 "잘못된" 동작도 의도적으로 유지한다 — characterization
// 테스트(tests/fab_characterization.test.js)가 이 동작을 고정하고 있으며,
// Phase 1의 각 교정 PR에서 해당 테스트와 함께 교체된다.
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
  const FURNACE_RATE = 0.5;          // nm/min — 기존 동작: 선형 고정 성장률
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

  // TODO(REVIEW): G1 특성 보존 — 열산화가 '증착'으로 구현되어 있다.
  // 표면 재질과 무관하게 성장하고, Si를 소모하지 않으며, 성장률이 선형 고정.
  // Phase 1-1에서 Deal-Grove(노출 Si에서만 성장, Si 0.44x 소모)로 교정한다.
  function oxidizeFurnace(wafer, timeMin) {
    const grown = timeMin * FURNACE_RATE;
    return { wafer: deposit(wafer, 'SiO2', grown), grown: grown };
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
    oxidizeFurnace: oxidizeFurnace,
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
