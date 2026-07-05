// Fab characterization tests — Phase 0
//
// 목적: 리팩토링(물리 함수 분리 + 컬럼별 독립 스택 모델)이 기존 Fab_simulator.html의
// 관찰 가능한 동작을 바꾸지 않았음을 고정한다. 알려진 물리 갭 G1~G4와 G2 버그의
// "잘못된" 동작도 의도적으로 그대로 고정한다 (PHYSICS_REVIEW §3의 2단계 원칙).
// Phase 1의 각 교정 PR에서 해당 테스트를 물리 기대값(T1~T10)으로 교체한다.
const test = require('node:test');
const assert = require('node:assert');
const Fab = require('../js/fab_physics.js');

// 헬퍼: 일반적 패터닝 플로우 — PR 코팅 → 노광 → 현상 → normalize
function patterned(wafer, maskType) {
  let w = Fab.spinCoatPR(wafer);
  w = Fab.expose(w, maskType).wafer;
  w = Fab.develop(w).wafer;
  return Fab.normalize(w);
}

function totalOf(wafer, col, mat) {
  return wafer.cols[col].filter(l => l.mat === mat)
    .reduce((s, l) => s + l.thk, 0);
}

// --- F1. G1 특성: furnace는 표면 재질 무관 SiO2 '증착' (time × 0.5 nm) ---

test('F1a: furnace 60min → 모든 컬럼에 SiO2 30nm (bare Si 위)', () => {
  const r = Fab.oxidizeFurnace(Fab.createWafer(200), 60);
  assert.strictEqual(r.grown, 30);
  for (const c of Fab.COLS) {
    const top = r.wafer.cols[c][r.wafer.cols[c].length - 1];
    assert.strictEqual(top.mat, 'SiO2');
    assert.strictEqual(top.thk, 30);
  }
});

test('F1b: G1 고정 — Al 위에서도 산화막이 자라고 Si를 소모하지 않음', () => {
  let w = Fab.deposit(Fab.createWafer(200), 'Al', 100);
  const r = Fab.oxidizeFurnace(w, 60);
  assert.strictEqual(totalOf(r.wafer, 'C', 'SiO2'), 30); // 잘못된 동작을 그대로 고정
  assert.strictEqual(totalOf(r.wafer, 'C', 'Si'), 200);  // Si 소모 없음
});

// --- F2. G3 특성: 모든 증착이 단차와 무관하게 전 컬럼 균일 ---

test('F2: 단차 있는 웨이퍼에도 증착은 전 컬럼 동일 두께', () => {
  let w = Fab.deposit(Fab.createWafer(200), 'SiO2', 100);
  w = patterned(w, 'dark');            // C 개구
  w = Fab.normalize(Fab.dryEtch(w, 'SiO2', 100)); // C에 100nm 단차
  w = Fab.ash(w);
  w = Fab.normalize(w);
  w = Fab.deposit(w, 'SiNx', 50);
  for (const c of Fab.COLS) assert.strictEqual(totalOf(w, c, 'SiNx'), 50);
});

// --- F3. PR 스핀코팅 planarization: 최고 높이 + 60nm (보존 대상) ---

test('F3: 단차 위 PR 코팅 후 세 컬럼 높이 동일 = maxH + 60', () => {
  let w = Fab.deposit(Fab.createWafer(200), 'SiO2', 100);
  w = patterned(w, 'dark');
  w = Fab.normalize(Fab.dryEtch(w, 'SiO2', 100));
  w = Fab.ash(w);
  w = Fab.normalize(w); // L/R: 300, C: 200
  w = Fab.spinCoatPR(w);
  const h = Fab.heights(w);
  assert.strictEqual(h.L, 360);
  assert.strictEqual(h.C, 360);
  assert.strictEqual(h.R, 360);
  assert.strictEqual(totalOf(w, 'C', 'PR'), 160); // (300-200)+60
});

// --- F4. 마스크 극성: dark → center 노출, clear → edges 노출 (보존 대상) ---

test('F4a: dark 마스크 현상 → C의 PR만 제거', () => {
  const w = patterned(Fab.createWafer(200), 'dark');
  const tops = Fab.topExposed(w);
  assert.strictEqual(tops.C, 'Si');
  assert.strictEqual(tops.L, 'PR');
  assert.strictEqual(tops.R, 'PR');
});

test('F4b: clear 마스크 현상 → L/R의 PR 제거', () => {
  const w = patterned(Fab.createWafer(200), 'clear');
  const tops = Fab.topExposed(w);
  assert.strictEqual(tops.C, 'PR');
  assert.strictEqual(tops.L, 'Si');
  assert.strictEqual(tops.R, 'Si');
});

test('F4c: 노광 없이 현상 → developed=false, 스택 불변', () => {
  const w = Fab.spinCoatPR(Fab.createWafer(200));
  const r = Fab.develop(w);
  assert.strictEqual(r.developed, false);
  assert.strictEqual(totalOf(r.wafer, 'C', 'PR'), 60);
});

test('F4d: PR 없이 노광 → exposed=false', () => {
  const r = Fab.expose(Fab.createWafer(200), 'dark');
  assert.strictEqual(r.exposed, false);
});

test('F4e: 리소 1회 완료 후 재코팅한 새 PR은 미노광 — 즉시 develop하면 실패', () => {
  // 회귀 테스트: 브라우저 구동 검증에서 발견 — 노광 상태가 웨이퍼 전역에 남아
  // 새 PR이 노광 없이 현상되는 편차가 있었다. 기존 코드는 expMask가 PR 레이어에
  // 붙어 있어 새 코팅이 항상 미노광이었다.
  let w = patterned(Fab.createWafer(200), 'dark'); // 1차 리소
  w = Fab.normalize(Fab.ash(w));
  w = Fab.spinCoatPR(w);                            // 재코팅 (노광 안 함)
  const r = Fab.develop(w);
  assert.strictEqual(r.developed, false);
  assert.strictEqual(totalOf(r.wafer, 'C', 'PR'), 60); // PR 그대로
});

// --- F5. G4 특성: RIE 무한 선택비 — 다른 재질에서 무조건 정지, 하부 손실 0 ---

test('F5a: SiO2 50nm 위 RIE(SiO2, 100nm) → SiO2만 제거, Si 무손실', () => {
  let w = Fab.deposit(Fab.createWafer(200), 'SiO2', 50);
  w = Fab.dryEtch(w, 'SiO2', 100); // 50nm over-etch
  assert.strictEqual(totalOf(w, 'C', 'SiO2'), 0);
  assert.strictEqual(totalOf(w, 'C', 'Si'), 200); // over-etch 손실 없음 (G4 고정)
});

test('F5b: 타깃이 노출되지 않은 컬럼은 식각되지 않음', () => {
  let w = Fab.deposit(Fab.createWafer(200), 'SiO2', 100);
  w = Fab.deposit(w, 'Al', 50); // 최상층 Al → SiO2는 미노출
  w = Fab.dryEtch(w, 'SiO2', 100);
  assert.strictEqual(totalOf(w, 'C', 'SiO2'), 100);
});

// --- F6. DRIE: startsWith('Si') 매칭 (기존 동작 그대로 — 쿼크 포함) ---

test('F6a: bare Si에 DRIE 60sec → 각 컬럼 180nm 식각', () => {
  const r = Fab.deepEtch(Fab.createWafer(500), 60);
  assert.strictEqual(r.depth, 180);
  for (const c of Fab.COLS) assert.strictEqual(totalOf(r.wafer, c, 'Si'), 320);
});

test('F6b: 최상층 Poly-Si → DRIE가 식각하지 않음 (startsWith 매칭의 기존 동작)', () => {
  let w = Fab.deposit(Fab.createWafer(200), 'Poly-Si', 100);
  const r = Fab.deepEtch(w, 60);
  assert.strictEqual(totalOf(r.wafer, 'C', 'Poly-Si'), 100);
  assert.strictEqual(totalOf(r.wafer, 'C', 'Si'), 200);
});

test('F6c: 기존 쿼크 고정 — 최상층 SiO2도 startsWith("Si")라 DRIE가 관통', () => {
  // TODO(REVIEW): 비의도적 동작으로 보임. Phase 1에서 Si 계열 정의 재검토.
  let w = Fab.deposit(Fab.createWafer(200), 'SiO2', 50);
  const r = Fab.deepEtch(w, 30); // 90nm: SiO2 50 관통 후 Si 40 식각
  assert.strictEqual(totalOf(r.wafer, 'C', 'SiO2'), 0);
  assert.strictEqual(totalOf(r.wafer, 'C', 'Si'), 160);
});

// --- F7. Wet etch: 노출 타깃 전량 제거, 언더컷 없음 (G4 고정) ---

test('F7a: BOE → 노출된 SiO2 800nm 전량 제거, Si 무손실', () => {
  let w = Fab.deposit(Fab.createWafer(200), 'SiO2', 800);
  const r = Fab.wetEtch(w, 'BOE');
  assert.strictEqual(r.target, 'SiO2');
  assert.strictEqual(totalOf(r.wafer, 'C', 'SiO2'), 0);
  assert.strictEqual(totalOf(r.wafer, 'C', 'Si'), 200);
});

test('F7b: PAN은 Al만 — SiO2 최상층이면 아무것도 제거하지 않음', () => {
  let w = Fab.deposit(Fab.createWafer(200), 'SiO2', 100);
  const r = Fab.wetEtch(w, 'PAN');
  assert.strictEqual(totalOf(r.wafer, 'C', 'SiO2'), 100);
});

test('F7c: PR로 가린 컬럼의 SiO2는 BOE에서 보호됨 (언더컷 없음 — G4 고정)', () => {
  let w = Fab.deposit(Fab.createWafer(200), 'SiO2', 100);
  w = patterned(w, 'dark'); // C만 SiO2 노출
  const r = Fab.wetEtch(w, 'BOE');
  assert.strictEqual(totalOf(r.wafer, 'C', 'SiO2'), 0);
  assert.strictEqual(totalOf(r.wafer, 'L', 'SiO2'), 100); // 언더컷 없음
  assert.strictEqual(totalOf(r.wafer, 'R', 'SiO2'), 100);
});

// --- F8. G2 버그 특성 고정: 한 컬럼만 노출돼도 전 컬럼 도핑 ---

test('F8a: G2 고정 — C만 노출 implant 시 마스크로 가린 L/R까지 Si-n으로', () => {
  // TODO(REVIEW): 버그를 그대로 고정한 테스트. Phase 1-4에서
  // "가린 컬럼은 도핑되지 않는다"로 교체한다.
  const w = patterned(Fab.createWafer(200), 'dark'); // C 노출, L/R은 PR
  const r = Fab.implant(w, 'n');
  assert.strictEqual(r.doped, true);
  assert.strictEqual(r.wafer.cols.C[0].mat, 'Si-n');
  assert.strictEqual(r.wafer.cols.L[0].mat, 'Si-n'); // 버그: 가린 컬럼도 도핑됨
  assert.strictEqual(r.wafer.cols.R[0].mat, 'Si-n');
});

test('F8b: Si가 어느 컬럼에도 노출되지 않으면 도핑 없음', () => {
  const w = Fab.deposit(Fab.createWafer(200), 'SiO2', 50);
  const r = Fab.implant(w, 'p');
  assert.strictEqual(r.doped, false);
  assert.strictEqual(r.wafer.cols.C[0].mat, 'Si');
});

// --- F9. Asher + normalize ---

test('F9: asher가 모든 PR 제거, normalize가 빈 레이어 정리', () => {
  let w = Fab.spinCoatPR(Fab.createWafer(200));
  w = Fab.normalize(Fab.ash(w));
  for (const c of Fab.COLS) {
    assert.strictEqual(w.cols[c].length, 1);
    assert.strictEqual(w.cols[c][0].mat, 'Si');
  }
});

// --- F10. topExposed 컬럼별 판정 ---

test('F10: 식각으로 컬럼별 최상층이 달라지면 topExposed가 이를 반영', () => {
  let w = Fab.deposit(Fab.createWafer(200), 'SiO2', 100);
  w = patterned(w, 'dark');
  w = Fab.normalize(Fab.dryEtch(w, 'SiO2', 100));
  const tops = Fab.topExposed(w);
  assert.strictEqual(tops.C, 'Si');   // 개구부: SiO2 관통 → Si 노출
  assert.strictEqual(tops.L, 'PR');
  assert.strictEqual(tops.R, 'PR');
});

// --- 순수성: 입력 wafer 불변 ---

test('P1: 함수는 입력 wafer를 변경하지 않는다', () => {
  const w = Fab.createWafer(200);
  const snapshot = JSON.stringify(w);
  Fab.deposit(w, 'SiO2', 50);
  Fab.oxidizeFurnace(w, 60);
  Fab.spinCoatPR(w);
  Fab.dryEtch(w, 'Si', 50);
  Fab.implant(w, 'n');
  assert.strictEqual(JSON.stringify(w), snapshot);
});
