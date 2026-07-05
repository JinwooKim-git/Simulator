# CLAUDE.md — Semiconductor Educational Simulator

이 파일은 저장소의 단일 기준 문서다. Claude Code는 매 세션 시작 시 이 파일을 숙지하고,
여기 정의된 역할 분담·워크플로우·로드맵에 따라 작업한다.
(작성: 2026-07-04, claude.ai 대화에서 코드 전수 분석 후 인수인계용으로 생성.
저장소 상태가 이 스냅샷과 달라졌을 수 있으므로 첫 세션에서 현재 코드를 반드시 재확인할 것.)

---

## 1. 프로젝트 정체성

- **무엇**: 반도체 소자(DRAM 1T1C)와 공정(Virtual Fab)의 핵심 개념을 직접 조작하며
  체득하기 위한 인터랙티브 교육 모델. 순수 HTML/JS/Canvas.
- **목적**: (1) 전공 개념의 인과관계를 "변수를 바꾸면 결과가 어떻게 되는가"로 체득,
  (2) 물리 검증·교정 이력(커밋, 테스트)이 그대로 남는 엔지니어링 포트폴리오.
- **아닌 것**: TCAD류 정량 시뮬레이터가 아니다. 정량 예측이 아니라
  **정성적 인과관계와 스케일 감각**이 목표다. 문서·주석·커밋에서 이 선을 넘는
  표현(정밀 예측, 산업급 정확도 등)을 쓰지 않는다.
- **소유자(리뷰어)**: 김진우 — 나노에너지공학 + 반도체융합 전공.
  모든 물리 기준값의 최종 판정자.

## 2. 역할 분담 (절대 원칙)

| 역할 | Claude Code | 소유자 |
|---|---|---|
| 구현·리팩토링 | O | 방향 결정 |
| 자동 테스트 작성·실행 | O | 기준값 승인 |
| 커밋·브랜치·PR 생성 | O | PR 리뷰·머지 |
| 물리 기준값 확정 | **X** | **O** |
| 교육 효과·사용감 판단 | X | O |

**AI 자기검증의 한계를 인지할 것**: Claude가 만든 물리를 Claude가 검증하면 같은
오류를 공유할 수 있다. 물리 기준값·수식·계수가 조금이라도 불확실하면 확정하지 말고,
코드에 `// TODO(REVIEW): ...` 주석을 남기고 PR 설명의 [리뷰 요청 포인트]에
질문으로 올린다. 소유자의 승인이 곧 그 값의 확정이다.

## 3. 워크플로우 규칙

1. **main 직접 커밋/푸시 금지.** 모든 작업은 feature 브랜치 → PR → 소유자 리뷰 후 머지.
2. 브랜치 네이밍: `phase0/...`, `fab/...`, `dram/...`, `docs/...`
3. **커밋 메시지**: Conventional Commits, 영어. 물리 변경은 근거를 한 줄로 포함.
   - 예: `fix(fab): thermal oxidation consumes Si (x_Si ≈ 0.44·x_ox, Deal-Grove)`
   - 예: `feat(dram): cap write level at min(V_BL, V_WL − Vth)`
   - 예: `test(fab): add regression test for masked implant (G2)`
4. **모든 물리 로직 변경에는 대응 테스트 추가/갱신 필수.** 테스트 없는 물리 변경 PR 금지.
5. **PR 설명 필수 섹션** (한국어로 작성):
   - [변경 요약] / [물리 가정과 단순화] / [리뷰 요청 포인트] / [테스트 결과]
6. 구조가 바뀌는 작업(파일 분리, 데이터 모델 변경)은 **구현 전에 계획을 먼저 제시**하고
   승인받은 뒤 진행한다 (plan mode 활용).
7. 소유자 대상 커뮤니케이션(PR 설명, 질문)은 한국어. 커밋 메시지는 영어.

## 4. 기술 제약 (단순함이 사양이다)

- **빌드 도구·프레임워크 도입 금지**: React, 번들러, TypeScript, CSS 프레임워크 전부 X.
- **GitHub Pages에서 정적 파일 그대로 동작**해야 하고, 로컬에서 HTML 더블클릭
  (`file://`)으로도 열려야 한다. 따라서 ES module(`import/export`) 대신
  일반 `<script src>` + 전역 네임스페이스를 쓴다.
- 물리 모듈은 **브라우저/Node 겸용**으로 작성한다 (UMD-lite 패턴):
  ```js
  (function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FabPhysics = factory();
  })(typeof self !== 'undefined' ? self : this, function () { /* 순수 함수들 */ });
  ```
- **테스트는 Node 내장 test runner만 사용** (`node:test`, `node:assert`).
  외부 의존성 0. `node --test tests/`로 실행. package.json 없이도 돌아가야 한다.
- UI 텍스트는 한국어 유지. 기존 다크 테마·레이아웃 유지 (시각 리디자인은 범위 외).

## 5. 현재 코드 상태 (2026-07-04 분석 스냅샷)

### 저장소 구성
- `index.html` — 랜딩 페이지 ("Jinwoo's Virtual Lab", 두 시뮬레이터 링크)
- `Dram_simulator.html` (~370줄) — 1T1C DRAM. 거시(회로) 뷰 ↔ 미시(밴드) 뷰를
  MOSFET 클릭으로 줌 전환하는 이중 레이어 구조. WL/BL 슬라이더(0–3V), Vth=1.0V,
  REFRESH 버튼. requestAnimationFrame 루프에서 `drawCircuit()`/`drawBand()`가
  물리 갱신과 렌더링을 함께 수행.
- `Fab_simulator.html` (~320줄) — 드래그앤드롭 fab 샌드박스. 웨이퍼를 레이어 스택으로,
  각 레이어를 L/C/R 3컬럼 두께로 표현하는 1.5차원 모델. 장비 12종
  (Furnace/PECVD/LPCVD/ALD/Endura/Implanter/DRIE/RIE/Track/Stepper/Asher/
  Wet Bath/SPM). 단면 뷰("Metrology") + 공정 로그.

### 잘 구현된 것 — 보존할 것
- 전위↔전자에너지 부호 처리: 커패시터 충전량 증가 → Source 밴드가 아래로
  (전위↑ = 전자 에너지↓). 이 부호 관계는 절대 깨지 말 것.
- WL–장벽 연속 모델: Vth 아래에서 선형 감소, 이상에서 붕괴. Vth에서 연속.
- Sub-threshold leakage(OFF에서도 서서히 방전) → REFRESH의 존재 이유가 드러남.
- PR 스핀코팅의 planarization(최고 높이 + 60nm 채움).
- 식각 selectivity 정지 로직(다른 재질을 만나면 `break`).
- 마스크 극성 패터닝: dark → center 노출(트렌치/홀), clear → edge 노출(라인/게이트).

## 6. 확인된 물리 갭/버그 (백로그의 근거)

- **G1 [Fab] 열산화가 '증착'으로 구현됨.** `case 'furnace': deposit('SiO2', time*0.5)`
  — 표면 재질과 무관하게 성장하고, Si를 소모하지 않으며, 성장률이 선형 고정.
- **G2 [Fab] Implant 마스킹 버그.** `waferStack.find(l=>l.L>0 && l.mat==='Si').mat = newSi`
  — `mat`이 레이어 전역 속성이라, 한 컬럼만 노출돼도 레이어 전체(마스크로 가린
  컬럼 포함)가 도핑된다. 근본 원인은 데이터 모델(컬럼별 재질 표현 불가).
- **G3 [Fab] 증착 conformality 미구현.** LPCVD의 "Excellent Step Coverage"는
  helper 문구일 뿐, 모든 증착 장비가 동일하게 전 컬럼 균일 증착.
- **G4 [Fab] 식각이 무한 선택비 + 완전 이방성.** wet etch 언더컷 없음,
  over-etch 시 하부막 손실 없음, 테이퍼 개념 없음.
- **G5 [DRAM] Write에 상한 없음.** 셀이 BL 레벨까지 무조건 충전됨. 실제 상한은
  min(V_BL, V_WL − Vth) — WL 승압(VPP)의 존재 이유가 누락.
- **G6 [DRAM] Read가 단순 방전.** BL 프리차지, charge sharing, sense amp 감지,
  restore(재기록)가 없어 "파괴적 읽기"라는 DRAM의 정수가 표현되지 않음.

## 7. 로드맵

### Phase 0 — 검증 가능한 구조 (최우선. 이 단계에서 기능 추가 금지)

1. 물리 로직을 순수 함수 모듈로 분리: `js/fab_physics.js`, `js/dram_physics.js`.
   렌더링·DOM 코드는 HTML에 남기고, 상태 전이 함수만 모듈로 뺀다.
   (예: `oxidize(stack, params)`, `etch(stack, params)`, `stepCharge(state, dt)` —
   입력을 받아 새 상태를 반환하는 순수 함수. Canvas/DOM 접근 금지.)
2. **데이터 모델 재설계 제안**: 컬럼별 독립 재질을 표현할 수 있어야 한다
   (G2 해결의 전제). 후보 — (a) 레이어의 `mat`을 `{L, C, R}` 컬럼별 속성으로,
   (b) 컬럼별 완전 독립 스택 3개. 트레이드오프를 비교한 계획을 먼저 제시하고
   승인 후 구현.
3. `tests/` 디렉토리 + node:test 하네스. **리팩토링 전에 현재 동작의 특성 테스트
   (characterization test)를 먼저 작성**해서, 분리 작업이 기존 동작을 바꾸지
   않았음을 증명한다 (알려진 버그 G1–G6의 현재 동작도 일단 그대로 고정).
4. 완료 기준: 브라우저에서 두 시뮬레이터 동작이 기존과 동일 + `node --test` 전체 통과.

### Phase 1 — Fab 물리 교정 (핵심 우선순위)

- **1-1. 열산화 (G1)**: 노출된 Si/Poly-Si 표면에서만 성장. Si 소모량 =
  0.44 × 성장 산화막 두께 (몰밀도비 2.2×10²²/5.0×10²² ≈ 0.44).
  성장은 Deal-Grove 선형–포물선 거동: 얇을 땐 선형, 두꺼워질수록 느려짐
  (기존 산화막 두께를 초기값으로 반영). dry/wet 구분은 선택 사항.
  - 테스트 예: 산화막 100nm 성장 시 Si 44nm 감소 / Al·PR 위에서는 성장 0 /
    기존 산화막 50nm 위 추가 성장 속도 < 맨 Si 위 성장 속도.
- **1-2. 식각 (G4)**: 재질쌍별 유한 선택비 테이블 도입(기본값을 제안하되 전부
  TODO(REVIEW) 마킹), over-etch 시 하부막이 선택비 비율로 소모.
  wet etch는 마스크 개구부에 인접한 컬럼의 상층 일부를 함께 깎아 언더컷을 근사.
  dry etch 테이퍼각은 L/C/R 모델의 표현 한계를 먼저 검토하고, 무리한 구현보다
  README의 Known Limitations에 기록하는 쪽을 택해도 된다.
- **1-3. 증착 conformality (G3)**: 장비별 step coverage 계수 도입 —
  제안 초기값: ALD 1.0 / LPCVD 0.9 / PECVD 0.6 / PVD(Endura) 0.3 (전부 REVIEW 대상).
  컬럼 간 높이차(단차)가 있을 때 낮은 컬럼(트렌치 바닥)에는 계수 × 두께만 증착.
- **1-4. Implant 마스킹 (G2)**: Phase 0의 새 데이터 모델 위에서 노출 컬럼만 도핑.
  "PR로 가린 컬럼은 도핑되지 않는다" 회귀 테스트 필수.
- **1-5. Metrology 패널 강화**: 공정 스텝마다 이력 로그(스텝 번호, 장비, 파라미터,
  컬럼별 총 두께, step height)를 테이블로 누적. 레시피 모달에 target 입력란(선택)을
  두고 실행 후 **target 대비 편차를 표시**. "측정으로 공정을 확인한다"는 흐름이
  UI에서 자연스럽게 드러나게 한다.

### Phase 2 — DRAM 물리 심화

- **2-1. Write 상한 (G5)**: `charge_max = min(V_BL, V_WL − Vth) / V_scale`.
  WL이 낮으면 '1'이 덜 써지는 현상이 보이게 하고, VPP(워드라인 승압) 개념을
  짧은 툴팁으로 설명.
- **2-2. Read = charge sharing (G6)**: BL 프리차지(VDD/2) 버튼, Cs/C_BL 비율 슬라이더,
  ΔV = (V_cell − VDD/2) · Cs/(Cs + C_BL). ΔV가 감지 한계 이상이면 sense amp가
  감지 후 restore(재기록), 이하면 read fail 표시 — 파괴적 읽기와 restore,
  그리고 셀 커패시턴스 확보가 왜 중요한지가 조작으로 체감되게.
- **2-3. 온도–리텐션**: 온도 슬라이더, leakage를 지수적 온도 의존(정성)으로 스케일,
  현재 조건의 리텐션 시간을 표시.
- **2-4. (선택)** 수직 MOS(게이트–산화막–채널) 밴드 미니뷰 추가 — 현재 lateral
  (Source–Channel–Drain) 뷰만 있어 "게이트가 왜 장벽을 낮추는가"의 수직 물리가 생략됨.

### Phase 3 — 문서화·공개

- `README.md`: 프로젝트 개요, 스크린샷/GIF, 물리 모델 설명(수식 포함),
  **Known Limitations(단순화한 것들을 스스로 명시)**, 로컬 실행법, 테스트 실행법.
- GitHub Pages 활성화 (gh CLI 인증이 되어 있으면 시도, 안 되면 수동 절차를 안내).
- (선택) 영문 README 병기.

## 8. 물리 기준값 — 소유자 승인 전까지 전부 잠정(TODO REVIEW)

| 항목 | 잠정값 | 근거/비고 |
|---|---|---|
| Si 소모비 (열산화) | 0.44 | N(SiO2)=2.2×10²² / N(Si)=5.0×10²² cm⁻³ |
| Vth | 1.0 V | 기존 코드 유지 |
| 전압 스케일 | 0–3 V | 기존 슬라이더 유지 |
| RIE 선택비 (SiO2:Si 등) | 표로 제안 예정 | 구현 시 PR에서 제안 → 승인 |
| Conformality 계수 | ALD 1.0 / LPCVD 0.9 / PECVD 0.6 / PVD 0.3 | 정성 근사 |
| Sense amp 감지 한계 | 구현 시 제안 | Cs/C_BL 기본비 포함 |

## 9. 하지 말 것

- main 직접 푸시.
- 소유자 승인 없이 물리 기준값 확정.
- 프레임워크·빌드 도구 도입.
- "정량적으로 정확한 시뮬레이터"류의 과대 표현 (문서·주석·커밋 모두).
- 계획 승인 없는 기존 파일 삭제·대규모 이동.
- UI 언어의 영어화, 다크 테마 변경.

## 10. 첫 세션에서 할 일 (체크리스트)

1. 이 파일 전체를 숙지한다.
2. 저장소의 현재 상태를 재확인한다 (이 스냅샷 이후 변경이 있을 수 있음).
3. Phase 0 계획을 제시한다: 파일 구조, 데이터 모델 대안 (a)/(b) 비교,
   특성 테스트 목록. **구현은 소유자 승인 후 시작.**
4. 승인되면 `phase0/extract-physics` 브랜치를 만들어 작업하고, 완료 시 PR을 연다.
