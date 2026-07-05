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

// --- F1. 열산화 물리 (Phase 1-1에서 G1 characterization을 교체) ---
// 기대값 출처: PHYSICS_REVIEW 1.1 (Deal-Grove, 1000°C 대표 파라미터, REVIEW)

test('F1a (T1): dry 1000°C 60min bare Si → ~69nm 성장, Si 소모 = 0.44×', () => {
  const r = Fab.oxidize(Fab.createWafer(500), { mode: 'dry', timeMin: 60 });
  for (const c of Fab.COLS) {
    const res = r.results[c];
    assert.ok(Math.abs(res.grown - 69) / 69 < 0.05, `grown=${res.grown}`);
    assert.ok(Math.abs(res.consumed - 0.44 * res.grown) < 0.5);
    assert.ok(Math.abs(totalOf(r.wafer, c, 'Si') - (500 - res.consumed)) < 1e-9);
    assert.ok(Math.abs(totalOf(r.wafer, c, 'SiO2') - res.grown) < 1e-9);
  }
});

test('F1b (T2): wet 1000°C 60min → ~435nm 성장', () => {
  const r = Fab.oxidize(Fab.createWafer(500), { mode: 'wet', timeMin: 60 });
  assert.ok(Math.abs(r.results.C.grown - 435) / 435 < 0.05, `grown=${r.results.C.grown}`);
});

test('F1c (T3): 기존 산화막 50nm 위 wet 30min 추가 성장 < bare Si 성장 (둔화)', () => {
  const bare = Fab.oxidize(Fab.createWafer(500), { mode: 'wet', timeMin: 30 });
  let w = Fab.deposit(Fab.createWafer(500), 'SiO2', 50);
  const preOx = Fab.oxidize(w, { mode: 'wet', timeMin: 30 });
  assert.ok(bare.results.C.grown > 250); // ~282nm 부근
  assert.ok(preOx.results.C.grown < bare.results.C.grown);
  assert.ok(preOx.results.C.grown > 0);
  // 기존 산화막은 소모되지 않고 그 위에 누적
  assert.ok(Math.abs(totalOf(preOx.wafer, 'C', 'SiO2') - (50 + preOx.results.C.grown)) < 1e-9);
});

test('F1d (T4): 최상층 Al/PR → 성장 0 + 사유 반환', () => {
  const onAl = Fab.oxidize(Fab.deposit(Fab.createWafer(200), 'Al', 100), { mode: 'dry', timeMin: 60 });
  assert.strictEqual(onAl.results.C.grown, 0);
  assert.ok(onAl.results.C.reason);
  const onPR = Fab.oxidize(Fab.spinCoatPR(Fab.createWafer(200)), { mode: 'dry', timeMin: 60 });
  assert.strictEqual(onPR.results.C.grown, 0);
});

test('F1e: 컬럼별 독립 — C만 Si 노출이면 C만 산화 (마스크된 L/R은 불변)', () => {
  // G2와 달리 산화는 새 모델에서 처음부터 컬럼별로 올바르게 동작해야 한다
  let w = Fab.deposit(Fab.createWafer(500), 'SiNx', 100); // 산화 배리어
  w = patterned(w, 'dark');
  w = Fab.normalize(Fab.dryEtch(w, 'SiNx', 100)); // C만 Si 노출
  const r = Fab.oxidize(w, { mode: 'dry', timeMin: 60 });
  assert.ok(r.results.C.grown > 0);
  assert.strictEqual(r.results.L.grown, 0);
  assert.strictEqual(r.results.R.grown, 0);
  assert.strictEqual(totalOf(r.wafer, 'L', 'SiO2'), 0);
});

test('F1g: 이력 무중복 — 두꺼운 기존 산화막 위 time=0 → 성장 0 (τ/τ_eq 중복 가산 회귀)', () => {
  // 브라우저 검증에서 발견: dry τ(0.37h)가 τ_eq에 매번 합산되면 time=0
  // 반복 실행으로도 산화막이 계속 자란다. max(τ, τ_eq)로 수정 후 고정.
  let w = Fab.deposit(Fab.createWafer(500), 'SiO2', 100);
  const r = Fab.oxidize(w, { mode: 'dry', timeMin: 0 });
  assert.strictEqual(r.results.C.grown, 0);
  // 아주 짧은 시간의 반복도 순수 시간 합과 같아야 함 (τ 중복 없음)
  const once = Fab.oxidize(w, { mode: 'dry', timeMin: 60 }).results.C.grown;
  let w2 = Fab.oxidize(w, { mode: 'dry', timeMin: 30 }).wafer;
  const twice = Fab.oxidize(w2, { mode: 'dry', timeMin: 30 });
  const total2 = (100 + once);
  const totalSplit = totalOf(twice.wafer, 'C', 'SiO2');
  assert.ok(Math.abs(totalSplit - total2) < 0.01, `split=${totalSplit} vs once=${total2}`);
});

test('F1f: Poly-Si도 산화되며, 소모돼도 하부 재질은 침범하지 않음', () => {
  let w = Fab.deposit(Fab.createWafer(200), 'Al', 50);
  w = Fab.deposit(w, 'Poly-Si', 10); // 얇은 Poly — wet 60min이면 요구 소모량 > 10nm
  const r = Fab.oxidize(w, { mode: 'wet', timeMin: 60 });
  assert.ok(Math.abs(r.results.C.consumed - 10) < 1e-9); // Poly 전량 소모에서 정지
  assert.ok(Math.abs(r.results.C.grown - 10 / 0.44) < 1e-6);
  assert.strictEqual(totalOf(r.wafer, 'C', 'Al'), 50); // 하부 Al 불변
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

// --- F5. RIE 유한 선택비 (Phase 1-2에서 G4 characterization을 교체) ---
// 기대값 출처: PHYSICS_REVIEW 1.4 (선택비 테이블은 전부 REVIEW)

test('F5a (T8): oxide 200nm RIE 20% over-etch → 하부 Si 손실 ≈ 5nm (±20%)', () => {
  let w = Fab.deposit(Fab.createWafer(200), 'SiO2', 200);
  w = Fab.dryEtch(w, 'SiO2', 240); // 240nm = 20% over-etch
  assert.strictEqual(totalOf(w, 'C', 'SiO2'), 0);
  const siLoss = 200 - totalOf(w, 'C', 'Si'); // 기대 40/8 = 5nm
  assert.ok(Math.abs(siLoss - 5) / 5 <= 0.2, `siLoss=${siLoss}`);
});

test('F5a2: 정확히 타깃 두께만 식각하면 하부 손실 0', () => {
  let w = Fab.deposit(Fab.createWafer(200), 'SiO2', 200);
  w = Fab.dryEtch(w, 'SiO2', 200);
  assert.strictEqual(totalOf(w, 'C', 'Si'), 200);
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

test('F6b: DRIE가 Poly-Si도 식각 (Bosch는 Si 계열 전체 — Phase 1-2에서 쿼크 교정)', () => {
  // Phase 0의 startsWith('Si') 매칭이 Poly-Si를 제외하던 비의도 동작을 교정.
  let w = Fab.deposit(Fab.createWafer(200), 'Poly-Si', 100);
  const r = Fab.deepEtch(w, 60); // 180nm: Poly 100 관통 → Si 80 식각
  assert.strictEqual(totalOf(r.wafer, 'C', 'Poly-Si'), 0);
  assert.strictEqual(totalOf(r.wafer, 'C', 'Si'), 120);
});

test('F6c: 최상층 SiO2는 DRIE 게이트에서 차단 (startsWith 관통 쿼크 교정)', () => {
  let w = Fab.deposit(Fab.createWafer(200), 'SiO2', 50);
  const r = Fab.deepEtch(w, 30);
  assert.strictEqual(totalOf(r.wafer, 'C', 'SiO2'), 50); // 불변
  assert.strictEqual(totalOf(r.wafer, 'C', 'Si'), 200);
});

test('F6d: DRIE가 SiO2에 착지하면 50:1로 소모 (Bosch 선택비)', () => {
  // Si 200 / SiO2 50 / Si 200(기판): 위 Si 관통 후 잔여가 SiO2를 /50로 소모
  let w = Fab.deposit(Fab.createWafer(200), 'SiO2', 50);
  w = Fab.deposit(w, 'Si', 90);
  const r = Fab.deepEtch(w, 60); // 180nm: Si 90 관통, 잔여 90 → SiO2 손실 90/50 = 1.8nm
  const oxLoss = 50 - totalOf(r.wafer, 'C', 'SiO2');
  assert.ok(Math.abs(oxLoss - 1.8) < 0.01, `oxLoss=${oxLoss}`);
  assert.strictEqual(totalOf(r.wafer, 'C', 'Si'), 200); // 산화막 아래 기판 불변
});

// --- F7. Wet etch: 수직 전량 제거 + 등방성 언더컷 annotation (Phase 1-2) ---

test('F7a: BOE → 노출된 SiO2 800nm 전량 제거, Si 무손실 (고선택비 근사)', () => {
  let w = Fab.deposit(Fab.createWafer(200), 'SiO2', 800);
  const r = Fab.wetEtch(w, 'BOE');
  assert.strictEqual(r.target, 'SiO2');
  assert.strictEqual(totalOf(r.wafer, 'C', 'SiO2'), 0);
  assert.strictEqual(totalOf(r.wafer, 'C', 'Si'), 200);
  assert.strictEqual(r.undercuts.length, 0); // 전 컬럼 개구 — 언더컷 없음
});

test('F7b: PAN은 Al만 — SiO2 노출 시 손실 0 (PHYSICS_REVIEW 1.4 백테스트)', () => {
  let w = Fab.deposit(Fab.createWafer(200), 'SiO2', 100);
  const r = Fab.wetEtch(w, 'PAN');
  assert.strictEqual(totalOf(r.wafer, 'C', 'SiO2'), 100);
  assert.strictEqual(r.undercuts.length, 0);
});

test('F7c (T9): BOE로 C의 SiO2 100nm 제거 → L/R 마스크 아래 undercut ≈ 100nm 기록', () => {
  let w = Fab.deposit(Fab.createWafer(200), 'SiO2', 100);
  w = patterned(w, 'dark'); // C만 SiO2 노출, L/R은 PR 마스크
  const r = Fab.wetEtch(w, 'BOE');
  assert.strictEqual(totalOf(r.wafer, 'C', 'SiO2'), 0);
  // 두께 배열은 불변 (재료 회계 원칙)
  assert.strictEqual(totalOf(r.wafer, 'L', 'SiO2'), 100);
  assert.strictEqual(totalOf(r.wafer, 'R', 'SiO2'), 100);
  // 언더컷은 annotation으로: 개구부(C)를 향한 면에 ≈ 식각 깊이
  const lOx = r.wafer.cols.L.find(l => l.mat === 'SiO2');
  const rOx = r.wafer.cols.R.find(l => l.mat === 'SiO2');
  assert.ok(Math.abs(lOx.uc.R - 100) / 100 <= 0.1, `L.uc.R=${lOx.uc.R}`);
  assert.ok(Math.abs(rOx.uc.L - 100) / 100 <= 0.1, `R.uc.L=${rOx.uc.L}`);
  assert.strictEqual(r.undercuts.length, 2);
});

test('F7d: 언더컷 annotation은 normalize/후속 공정에서 보존된다', () => {
  let w = Fab.deposit(Fab.createWafer(200), 'SiO2', 100);
  w = patterned(w, 'dark');
  w = Fab.wetEtch(w, 'BOE').wafer;
  w = Fab.normalize(Fab.ash(w));
  w = Fab.deposit(w, 'SiNx', 30);
  const lOx = w.cols.L.find(l => l.mat === 'SiO2');
  assert.ok(lOx.uc && lOx.uc.R > 90);
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
  Fab.oxidize(w, { mode: 'dry', timeMin: 60 });
  Fab.spinCoatPR(w);
  Fab.dryEtch(w, 'Si', 50);
  Fab.implant(w, 'n');
  assert.strictEqual(JSON.stringify(w), snapshot);
});
