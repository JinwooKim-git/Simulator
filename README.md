# Jinwoo's Virtual Lab — 반도체 교육 시뮬레이터

반도체 공정(Virtual Fab)과 소자(1T1C DRAM)의 핵심 개념을 **직접 조작하며 체득**하기 위한
인터랙티브 교육 모델입니다. 순수 HTML/JS/Canvas로 작성되어 빌드 도구 없이 브라우저에서
바로 실행됩니다.

> **이 프로젝트가 아닌 것**: TCAD류 정량 시뮬레이터가 아닙니다. 목표는 정량 예측이 아니라
> **정성적 인과관계와 스케일 감각** — "이 변수를 바꾸면 결과가 어느 방향으로, 대략 어느
> 자릿수로 변하는가"를 손으로 익히는 것입니다. 모든 수치 파라미터는 교과서 대표값 또는
> 교육용 정성 근사이며, 소유자(전공자) 리뷰를 거쳐 확정됩니다.

## 구성

| 파일 | 내용 |
|---|---|
| `index.html` | 랜딩 페이지 |
| `Fab_simulator.html` | **Virtual Fab** — 드래그앤드롭 공정 샌드박스 (장비 12종) |
| `Dram_simulator.html` | 1T1C DRAM — 회로 뷰 ↔ 에너지 밴드 뷰 이중 레이어 |
| `js/fab_physics.js`, `js/dram_physics.js` | 물리 로직 (순수 함수, 브라우저/Node 겸용) |
| `tests/` | node:test 기반 백테스트 (외부 의존성 0) |

## Virtual Fab — 구현된 물리 모델

웨이퍼는 L/C/R 3컬럼 × 레이어 스택(1.5차원)으로 표현됩니다. 각 컬럼은 완전히 독립적인
스택이어서 마스킹·패터닝이 컬럼 단위로 올바르게 동작합니다.

### 열산화 — Deal-Grove 선형–포물선 모델

노출된 Si·Poly-Si·도핑 Si 표면에서만 성장하고, Al·PR·SiO₂ 위에서는 성장하지 않습니다.

$$x_{ox}^2 + A\,x_{ox} = B\,(t + \tau)$$

- 1000 °C 대표 파라미터: Dry O₂ — A = 0.165 µm, B = 0.0117 µm²/h, τ = 0.37 h /
  Wet H₂O — A = 0.226 µm, B = 0.287 µm²/h
- 기존 산화막 x₀는 등가 시간 τ_eq = (x₀² + A·x₀)/B 로 반영 → 두꺼울수록 성장 둔화.
  이력 중복 방지를 위해 τ_eff = max(τ, τ_eq)
- **Si 소모** = 0.44 × 성장 산화막 두께 (몰밀도비 N(SiO₂)/N(Si) = 2.2×10²²/5.0×10²²)
  → 표면은 성장분의 56%만 올라갑니다. 측정 이력에 성장 두께와 표면 상승이 함께 표시됩니다.
- 검증값: dry 60분 ≈ 69 nm, wet 60분 ≈ 435 nm (문헌 차트 범위와 일치)

### 식각 — 유한 선택비 + wet 등방성 언더컷

선택비 S = ER(타깃)/ER(하부막). 타깃 관통 후 잔여 식각량은 하부막을 1/S로 소모합니다.

| 공정 | 선택비 |
|---|---|
| RIE oxide etch (CHF₃계) | SiO₂:Si ≈ 8:1, SiO₂:PR ≈ 4:1 |
| RIE Si/Poly (CF₄/O₂계) | Si:SiO₂ ≈ 2:1 |
| DRIE (Bosch) | Si:SiO₂ ≈ 50:1 |
| 미정의 재질쌍 | 10:1 (기본값) |

wet 식각(BOE/PAN)은 등방성입니다: 노출 개구부에 인접한 마스크 아래 동일 재질 층에
**언더컷 ≈ 식각 깊이(측면:수직 = 1:1)** 가 기록되고 단면 뷰에 notch로 렌더링됩니다.
(두께 회계는 왜곡하지 않고 annotation으로만 표현 — 3컬럼 모델의 한계 존중)

### 증착 — 장비별 step coverage

단차(컬럼 간 높이차)가 있으면 낮은 컬럼(트렌치 바닥)에는 계수 × 명목 두께만 증착됩니다.

| 장비 | 계수 | 근거 |
|---|---|---|
| ALD | 1.0 | 표면 반응 자기제한 — 완전 컨포멀 |
| LPCVD | 0.9 | 표면 반응율속 |
| PECVD | 0.6 | 플라즈마 — 중간 |
| PVD (스퍼터) | 0.3 | 도달 플럭스 지배 — 비컨포멀 |

### 이온주입 — 마스킹과 유한 깊이

노출된 컬럼의 최상층만, 그것이 Si 계열(단결정 또는 poly)일 때만 도핑됩니다.
도핑 깊이 d = min(층 두께, 100 nm) — 층이 더 두꺼우면 상부만 변환되고 분할됩니다
(투영비정 R_p 부근 분포의 계단 근사). 역도핑(n↔p) 가능, 도핑된 poly는
Poly-Si-n/Poly-Si-p로 표시됩니다.

### 공정 순서 열예산 규칙

웨이퍼 위 재료의 최대 허용온도 < 장비 공정온도면 경고합니다 (경고 후 진행).

| 재료 한계 | | 장비 공정온도 | |
|---|---|---|---|
| PR | 130 °C | Furnace | 1000 °C |
| Al | 450 °C | LPCVD | 600 °C |
| | | PECVD | 300 °C |
| | | ALD | 250 °C |

Al을 올린 뒤 Furnace에 넣으면 — 개별 공정이 다 맞아도 **순서가 틀리면 소자가 죽는다**는
공정 통합의 감각을 경고로 전달합니다.

### Metrology

- 매 공정마다 측정 이력 누적: 스텝, 장비, 파라미터, 컬럼별 총두께, step height,
  target 대비 편차 (±5% 판정 색상)
- 단면 뷰에 nm 스케일 바 (auto-scale 보정)

## 1T1C DRAM 시뮬레이터

WL/BL 슬라이더로 쓰기·읽기·누설을 조작하고, MOSFET을 클릭해 에너지 밴드 관점으로
줌인할 수 있습니다. 전위↑ = 전자 에너지↓ 부호 관계와 WL–장벽 연속 모델, sub-threshold
누설(REFRESH의 존재 이유)이 구현되어 있습니다. 물리 갱신은 dt 기반이라 모니터
주사율과 무관하게 동작합니다.

Phase 2(예정)에서 Write 상한 min(V_BL, V_WL−Vth), charge sharing 읽기, refresh
논리, 지수 누설·온도 의존이 추가됩니다.

## Known Limitations (의도된 단순화)

**Fab**
- 증착·식각 속도는 선형 상수. 도즈·에너지·확산 프로파일, 열이력(도판트 재분포), CMP 없음
- 3컬럼 기하 — 연속 프로파일·측벽 테이퍼각 표현 불가 (dry etch 테이퍼는 구현하지 않음)
- dry 산화의 초기 급속 성장 구간은 τ = 0.37 h(등가 산화막 ~23 nm)로 근사 —
  기존 산화막이 23 nm 미만이면 이력이 23 nm 등가로 취급됨
- step coverage는 단차 유무의 이분법 (종횡비 의존 없음 — Phase 4에서 확장 예정)
- 언더컷은 annotation — 두께 회계에는 반영되지 않음
- 열예산은 온도 노출 시간 무시 (순간 노출도 위반), 결정성·응력·계면 상태 없음
- 온도는 1000 °C 고정 (산화), 선택비·coverage 계수는 공정 조건에 따라 크게 달라지는
  일반화 값

**DRAM (Phase 2 이전 상태)**
- Write에 WL 상한 없음 / Read가 단순 방전 (charge sharing·sense amp 없음) /
  Refresh가 무조건 재충전 / 누설이 선형 상수 (온도 의존 없음)
- WL–장벽은 선형 근사 (표면 퍼텐셜 유도 아님), DIBL·바디이펙트 없음

## 실행 방법

빌드·설치 불필요합니다.

- **로컬**: 저장소를 클론(또는 ZIP 다운로드)한 뒤 `index.html`을 브라우저로 열면 됩니다
  (`file://` 더블클릭 지원).
- **GitHub Pages**: 활성화되어 있다면 `https://jinwookim-git.github.io/Simulator/`

## 테스트 실행

Node.js(내장 test runner 지원 버전, ≥ 18)만 있으면 됩니다. 외부 의존성 0.

```bash
node --test "tests/*.test.js"
```

테스트는 2단계 원칙을 따릅니다: Phase 0에서 리팩토링 전 동작을 고정하는 characterization
테스트를 먼저 작성하고, 각 물리 교정 PR에서 해당 테스트를 수치 기대값(허용오차 명시)으로
교체합니다. 교체 자체가 커밋 diff에 남아 "무엇이 왜 바뀌었는지"의 기록이 됩니다.
상세 물리 근거와 백테스트 표는 [PHYSICS_REVIEW.md](PHYSICS_REVIEW.md) 참조.

## GitHub Pages 활성화 (저장소 소유자용)

1. GitHub 저장소 → **Settings** → 왼쪽 메뉴 **Pages**
2. *Build and deployment* → Source: **Deploy from a branch**
3. Branch: **main**, 폴더: **/ (root)** 선택 후 **Save**
4. 1–2분 후 `https://jinwookim-git.github.io/Simulator/` 에서 접속 가능

또는 gh CLI로:

```bash
gh api repos/JinwooKim-git/Simulator/pages -X POST \
  -f "source[branch]=main" -f "source[path]=/"
```

## 문서

- [CLAUDE.md](CLAUDE.md) — 개발 워크플로우·역할 분담·로드맵 (단일 기준 문서)
- [PHYSICS_REVIEW.md](PHYSICS_REVIEW.md) — 물리 검증 노트 (오류 분류, 수식, 백테스트 기대값)
- [PROCESS_CHALLENGES.md](PROCESS_CHALLENGES.md) — Phase 4 공정 난제 확장팩 스펙
