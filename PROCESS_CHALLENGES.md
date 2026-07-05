# PROCESS_CHALLENGES.md — 공정 난제 확장팩 (Challenge Pack)

CLAUDE.md·PHYSICS_REVIEW.md의 확장 문서다. 실제 양산에서 마주치는 공정 난제
(bowing, notching, RIE lag, mask budget, gap-fill void 등)를 시뮬레이터에
구현하기 위한 스펙이며, **Phase 1(Fab 물리 교정) 완료 후 Phase 4로 착수**한다.
의존: 1.4 유한 선택비 식각 엔진, undercut annotation 패턴, 그리고 본 문서의 C0.

- 모든 계수는 정성 스케일이며 소유자 승인 전까지 `REVIEW`.
- 목표는 수치 재현이 아니라 **"무엇이 왜 생기고, 어떤 노브가 어느 방향으로
  움직이는가"의 인과를 조작으로 체득**시키는 것이다.

## 설계 원칙 — 3컬럼 모델을 깨지 않는다

L/C/R 두께 배열은 **재료 회계(material accounting)**의 단일 기준으로 유지한다.
bowing·notching·void 같은 형상 현상은 두께 배열을 건드리지 않고, feature에 붙는
**profile annotation**(수치 메타데이터)으로 기록하고 → 단면 뷰에서 렌더링하고 →
Metrology에서 수치로 보고한다. PHYSICS_REVIEW 1.4에서 wet 언더컷을 처리한 것과
동일한 패턴이다. (같은 이유로, 두께 회계를 왜곡하는 방식의 구현은 금지.)

---

## C0 [전제] Feature/CD 추상화 — 난제 구현의 공통 기반

**문제** — 현재 모델에는 개구부의 '폭'이라는 개념이 없다. L/C/R은 두께만 갖는다.
bowing·ARDE·void는 전부 **종횡비 AR = 깊이/폭**의 함수이므로 폭이 필요하다.

**구현**
- Stepper 모달에 **CD (nm)** 입력 추가 (기본 100nm, `REVIEW`).
  리소그래피가 CD를 정의한다 — 실제와 같은 책임 구조.
- Develop 시 opening feature 객체 생성:
  `{ region, W_cd, depth: 0, annotations: { undercut, bow, notch, void, cdTop } }`
- 이후 식각이 `depth`를 갱신하고, 각 난제 모듈이 `annotations`를 채운다.
- AR = depth / W_cd. Metrology에 CD_top과 AR 상시 표기.

**백테스트 T19** — CD=100 입력, develop 후 feature 생성 확인. oxide 300nm 관통
시 AR = 3.0 보고.

---

## C1 Bowing — charging 유발 측벽 팽창 (HAR 절연막 식각) ★

**물리 사슬** (정성, 플라즈마 공정 문헌의 표준 내용)
1. 전자는 등방적·저에너지라 마스크와 홀 상부 측벽에 주로 대전(음).
2. 이온은 시스(sheath)에서 가속돼 이방적으로 바닥에 도달(양).
3. 절연막 내부에 **차등 대전** → 홀 내부 전위 분포 왜곡.
4. 후속 이온의 궤적이 중간 깊이에서 측벽 쪽으로 굴절 → 측면 식각.
5. 결과: **중간이 배부른(bowed) 프로파일** — CD_bow > CD_top.

악화 인자: AR↑(깊을수록), 연속(continuous) 플라즈마.
완화 인자: **펄스 플라즈마**(off 구간에 전하 소산·중화), 측벽 패시베이션 화학.

**모델**
- 발동 조건: dry etch 대상이 절연막(SiO₂/SiN/HfO₂/Al₂O₃) & AR > AR₀.
- bow_nm = k_b · W_cd · f_charge · max(0, AR − AR₀)
- 최대 bow 위치 z_bow = 0.4 · depth (`REVIEW`, 문헌상 30–60% 깊이)
- 잠정값 `REVIEW`: AR₀ = 3, k_b = 0.03,
  f_charge = 1.0 (continuous) / 0.3 (pulsed)
- **RIE/DRIE 모달에 Plasma mode 토글 [Continuous | Pulsed] 추가.**

**Metrology** — CD_top, CD_bow = CD_top + 2·bow, bow ratio = CD_bow/CD_top.
target 입력 시 pass/fail. 단면 뷰: 개구부 측벽을 z_bow 중심의 곡선으로 렌더.

**백테스트**
- T20: AR = 2 (< AR₀) → bow = 0
- T21: AR = 10, continuous vs pulsed → bow 비 ≈ 1 : 0.3
- T22: AR 6 → 8 → 10에서 bow 단조 증가

**교육 포인트** — 3D NAND 채널홀류 HAR 절연막 식각의 대표 난제. 적층수가 올라갈수록
AR이 커지고, bowing 제어가 곧 수율이라는 인과가 노브 조작으로 체감된다.

---

## C2 Notching — 절연막 착지 시 과식각 발치 파임

**물리** — 도전막(poly-Si/Si/Al)을 식각해 절연막(SiO₂ 등)에 착지하면, 착지 후
over-etch 동안 절연막 표면이 대전되고 바닥 부근에서 이온이 측면으로 굴절 →
**계면 발치에 측면 notch**가 파인다. over-etch 시간에 비례해 성장하며,
펄스 플라즈마로 완화된다. SOI처럼 매몰 절연막 위 구조에서 악명 높다.

**모델**
- 발동 조건: dry etch & 식각막 ∈ 도전체 {Si, Poly-Si, Si-n, Si-p, Al}
  & 착지막 ∈ 절연체 {SiO₂, SiN, HfO₂, Al₂O₃}.
- notch_nm = k_n · OE(%) · f_charge. 잠정 k_n = 0.4 nm/% (`REVIEW`).
- OE(%)는 C3의 EPD 설정과 연동: EPD면 설정값(기본 10%), timed면 초과 시간 전부.
- 단면 뷰: 발치 양쪽에 삼각 notch 렌더. Metrology에 notch 깊이(nm) 보고.

**백테스트**
- T23: 절연막→절연막, 도전막→도전막 조합에서는 notch = 0 (조건성)
- T24: EPD 10% vs timed(+50% 과식각) → notch 비 ≈ 1 : 5
- (C1의 T21과 동일 로직으로 pulsed 저감 확인)

---

## C3 EPD (Endpoint Detection) vs Timed Etch — C2의 전제이자 그 자체로 교육 항목

**물리** — 식각이 계면에 도달하면 플라즈마 발광 조성이 바뀌고(OES), 이를 감지해
정지한 뒤 설정된 over-etch만 추가한다. over-etch 최소화 = notching·하부 손실
최소화. 시간만 믿는 timed etch와의 대비가 양산 공정 제어의 기본기다.

**모델** — RIE/DRIE 모달에 토글 [Timed | EPD + OE%(기본 10)].
EPD 모드는 타깃 관통 시점을 검출해 로그에 "EPD triggered @ t=…"를 남기고
OE%만 추가 진행. Timed는 입력 시간을 그대로 수행.

**백테스트 T25** — EPD+10%로 oxide 200nm/Si 착지: 하부 Si 손실 =
0.10 × 200 / S(SiO₂:Si=8) = 2.5nm 정확 재현 (PHYSICS_REVIEW T8의 정밀판).

---

## C4 ARDE (RIE lag) — 깊어질수록 느려지는 식각

**물리** — AR이 커질수록 라디칼·이온의 홀 바닥 도달이 어려워져 순간 식각률이
감소한다. HAR 식각의 시간–깊이 관계가 비선형이 되는 이유.

**모델** — dD/dt = ER₀ / (1 + c_A · D/W_cd). 잠정 c_A = 0.15 (`REVIEW`).
c_A = 0이면 기존 선형 모델로 정확히 회귀(하위 호환).

**백테스트 T26** — 동일 조건에서 전반 50% 깊이 소요시간 < 후반 50% 소요시간.
c_A=0 설정 시 기존 테스트(T8 등) 전부 통과.

---

## C5 Mask Budget — PR 잔량과 CD 붕괴 (1.4의 자연 확장)

**물리** — 선택비가 유한하므로 식각 중 PR도 소모된다. PR이 고갈되면 상부막이
전면 침식되고 개구부 CD가 커진다(blow-up). "이 식각을 버틸 마스크 두께인가"를
미리 계산하는 것이 마스크 예산 개념.

**모델** — 매 dry etch에서 PR_remaining = PR₀ − t·ER_target/S(target:PR) 갱신.
0 도달 시: 잔여 시간 동안 최상부 노출막 전면 식각 + 경고 배너
"MASK BUDGET EXCEEDED" + feature의 cdTop 증가 annotation.

**백테스트 T27** — 필요 PR의 절반만 코팅 후 식각 → 경고 발생, 상부막 손실량이
계산치와 일치, CD_top 증가 기록.

---

## C6 Gap-fill Void/Seam — 비컨포멀 증착의 매립 실패

**물리** — step coverage가 낮은 증착(PVD/PECVD)이 개구부를 채울 때 상단
overhang이 먼저 닫혀(pinch-off) 내부에 void/seam이 남는다. ALD·W-CVD 같은
컨포멀/보텀업 공정이 존재하는 이유.

**모델** — feature에 증착 시: coverage < 0.7 & AR > 1.5 & 증착 두께 ≥ 0.4·W_cd
→ void 생성, 크기 ∝ (1 − coverage) · W_cd (`REVIEW`).
단면 뷰에 렌즈형 void 렌더, Metrology에 "VOID detected".

**백테스트 T28** — AR 2 개구부를 PVD(coverage 0.3)로 매립 → void 발생 /
동일 조건 ALD(1.0) → void 없음.

---

## C7 (선택) Uniformity & SPC-lite

**물리** — 장비 내 중심–가장자리 불균일은 규격·SPC 관리의 대상. "한 번의 성공"이
아니라 "매번 규격 안"이 양산이라는 감각.

**모델** — 장비별 **결정론적** 컬럼 계수(예: PECVD [0.97, 1.00, 1.03],
RIE [1.03, 1.00, 0.97], `REVIEW`)를 토글 ON 시 적용. Metrology에
uniformity% = (max−min)/(2·mean)와 최근 10회 run-to-run 차트.
난수 금지 — 테스트 재현성을 위해 반드시 결정론적으로.

**백테스트 T29** — 계수 적용 시 컬럼별 두께가 기대값과 정확히 일치.

---

## C8 (선택, DRAM) Row Hammer 미니 데모

이웃 워드라인의 반복 활성화가 피해 셀 전하를 교란하는 현상. 1셀 모델에
"Aggressor WL 토글" 버튼을 추가하고 1회당 ΔQ = 0.5% (`REVIEW`) 감소.
2.3의 refresh 논리와 결합하면 "임계 붕괴 전에 refresh가 도는가"라는
메모리 신뢰성 시나리오가 완성된다.

**백테스트 T30** — Aggressor N회 → charge 감소량 = 0.5N% 정확.

---

## 시나리오(미션) 모드 — 난제를 '조작으로 체득'시키는 장치

난제 구현이 끝나면 채점형 미션을 얹을 수 있다. 예:

> **Mission: HAR Contact** — SiO₂ 1µm에 CD 100nm 홀을 뚫어라.
> 성공 조건: 관통 & bow ratio ≤ 1.10 & notch ≤ 3nm & 하부 Si 손실 ≤ 2nm
> 사용 가능 노브: Plasma mode, EPD/OE%, 시간, (마스크 두께)

사용자는 continuous로 뚫으면 bow에서 실패하고, timed로 하면 notch·Si 손실에서
실패하며, pulsed + EPD 조합에 도달해야 통과한다 — 완화 기술의 존재 이유가
시행착오로 학습된다. 미션 정의는 JSON으로 분리해 추가가 쉽게.

---

## 우선순위와 의존 관계

| 순서 | 항목 | 난이도 | 의존 | 비고 |
|---|---|---|---|---|
| 1 | C0 Feature/CD | 중 | Phase 0 모델 | 전부의 전제 |
| 2 | C3 EPD | 하 | 1.4 | C2의 전제 |
| 3 | C1 Bowing | 중 | C0, plasma 토글 | 하이라이트 |
| 4 | C2 Notching | 하 | C0, C3 | |
| 5 | C5 Mask budget | 하 | 1.4 | 거의 공짜 |
| 6 | C4 ARDE | 하 | C0 | |
| 7 | C6 Void | 중 | C0, 1.3 | |
| 8 | C7/C8 | 하 | — | 선택 |
| 9 | 미션 모드 | 중 | C1–C6 | 마무리 |

## 근거 수준 주석

전자 shading에 의한 차등 대전이 bowing·notching을 유발하고 펄스 플라즈마가
이를 완화한다는 인과는 플라즈마 식각 문헌의 표준 내용이다(정성).
다만 본 문서의 모든 수식 형태와 계수(k_b, k_n, c_A, f_charge, 임계값)는
교육용으로 고안한 임의 스케일이며 정량적 근거가 없다 — **README와 UI 어디에서도
이 수치들이 실측 기반인 것처럼 표현하지 않는다.** 소유자 리뷰에서 방향성
(어느 노브가 어느 쪽으로)과 자릿수의 타당성만 승인 대상으로 한다.
