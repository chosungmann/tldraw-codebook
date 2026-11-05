# 8장. 바인딩과 화살표

바인딩은 **두 도형 사이의 관계를 독립된 레코드로** 표현하는 장치입니다. 화살표가 사각형에 "붙어 있다"는 사실은 화살표 레코드도 사각형 레코드도 아닌 `binding:…` 레코드에 저장됩니다. 그래서 사각형을 움직여도 화살표 레코드는 바뀌지 않고, 화살표의 모양은 렌더링 시점에 바인딩에서 다시 계산됩니다. 동시 편집에서 두 사람이 각각 화살표와 사각형을 움직여도 충돌이 없는 이유입니다.

## 8.1 바인딩 레코드와 수명

```ts
interface TLBaseBinding<Type, Props> {
  id: TLBindingId; typeName: 'binding'
  type: Type            // 'arrow' | 커스텀
  fromId: TLShapeId     // 관계를 소유하는 쪽 (화살표)
  toId: TLShapeId       // 대상 (사각형)
  props: Props; meta: JsonObject
}
```

- Editor API: `createBinding(s)`, `updateBinding(s)`, `deleteBinding(s)`, `getBinding`, `getBindingsFromShape(shape, type)`, `getBindingsToShape(shape, type)`, `getBindingsInvolvingShape(shape, type?)`, `canBindShapes({ fromShape, toShape, binding })`.

- 조회는 4.8절의 `bindingsIndex`(도형 ID → 바인딩 목록) 파생 인덱스를 씁니다.

- `canBindShapes`는 양쪽 `ShapeUtil.canBind({ fromShape, toShape, bindingType })`가 모두 true여야 합니다.

- **도형 삭제 시 자동 정리**: 4.6절의 `shape.beforeDelete` 사이드 이펙트가 연결된 바인딩을 지웁니다. 지우기 전에 `onBeforeIsolate*`와 `onBeforeDelete*` 훅을 불러 상대 도형이 "홀로 남게 되는" 상황을 처리하게 합니다.

## 8.2 BindingUtil 훅

`BindingUtil`(`packages/editor/src/lib/editor/bindings/BindingUtil.ts`)은 바인딩 타입의 행동을 정의합니다. ShapeUtil처럼 `static type`, `static props`, `static migrations`, `getDefaultProps()`를 가집니다.

| 훅                                                    | 호출 시점                                   |
|-------------------------------------------------------|---------------------------------------------|
| `onBeforeCreate` / `onAfterCreate`                    | 바인딩 생성 전후                            |
| `onBeforeChange` / `onAfterChange`                    | 바인딩 갱신 전후                            |
| `onBeforeDelete` / `onAfterDelete`                    | 바인딩 삭제 전후                            |
| `onAfterChangeFromShape`                              | fromId 도형이 바뀜. \`reason: 'self'        |
| `onAfterChangeToShape`                                | toId 도형이 바뀜(조상 변경 포함)            |
| `onBeforeDeleteFromShape` / `onBeforeDeleteToShape`   | 한쪽 도형 삭제 직전                         |
| `onBeforeIsolateFromShape` / `onBeforeIsolateToShape` | 상대 도형이 사라져 이쪽이 고립되기 직전     |
| `onOperationComplete`                                 | 이 타입의 바인딩이 관련된 오퍼레이션이 끝남 |

`reason: 'ancestry'`는 도형 자체가 아니라 그 조상(예: 도형이 들어 있는 프레임)이 옮겨졌을 때입니다. 자식 도형의 레코드는 그대로지만 페이지 위치가 바뀌었으므로 바인딩도 알아야 합니다.

커스텀 바인딩의 예로는 "스티커가 붙은 도형을 따라다니기", "레이아웃 컨테이너의 자식 정렬" 같은 것이 있습니다. `onAfterChangeToShape`에서 from 도형을 `updateShape`로 옮기는 식입니다.

## 8.3 화살표 레코드: 무엇을 저장하나

화살표 도형 props(`tlschema/src/shapes/TLArrowShape.ts`):

- `kind`: `'arc'`(직선·곡선) 또는 `'elbow'`(직각 꺾임)

- `start`, `end`: 화살표 로컬 좌표의 끝점. **바인딩되지 않은 끝에만 의미가 있습니다.**

- `bend`: 곡률(중점에서 수직 방향 거리, 부호로 방향), `elbowMidPoint`: 직각 화살표의 중간 선분 위치

- `arrowheadStart`, `arrowheadEnd`, `richText`(라벨), `labelPosition`(0~1), 스타일들, `scale`

바인딩 props(`tlschema/src/bindings/TLArrowBinding.ts`):

- `terminal`: `'start' | 'end'` — 화살표의 어느 끝인가

- `normalizedAnchor`: 대상 도형 경계 상자 안의 정규화 좌표(0~1). (0.5, 0.5)이면 중심

- `isPrecise`: 앵커를 그대로 쓸지, 중심을 향할지

- `isExact`: 도형 테두리에서 멈추지 않고 앵커 점까지 정확히 갈지

- `snap`: 직각 화살표의 스냅 방식

화살표가 저장하는 것은 "어느 도형의 어느 상대 위치"뿐이고, 실제 좌표는 저장하지 않습니다. 대상 도형을 키워도 앵커가 비율이므로 화살표가 자연스럽게 따라갑니다.

## 8.4 화살표 모양 계산: getArrowInfo

화살표의 실제 경로는 `packages/tldraw/src/lib/shapes/arrow/`의 계산 함수들이 파생합니다.

1.  **getArrowBindings**(`shared.ts`): 화살표의 start/end 바인딩을 찾습니다. 모듈 수준 `createComputedCache`로 추적되며, `areRecordsEqual: a.id === b.id`라서 화살표 레코드가 바뀌어도 바인딩이 같으면 재계산하지 않습니다.

2.  **getArrowTerminalInArrowSpace**: 대상 도형의 지오메트리 경계에서 `point + normalizedAnchor × size`를 구하고, 대상의 페이지 변환 → 화살표의 역 페이지 변환을 적용해 화살표 공간으로 가져옵니다. 정밀하지 않은 바인딩은 앵커를 (0.5, 0.5)로 봅니다. 두 끝이 같은 도형이거나 한 도형이 다른 도형을 포함하면 강제로 앵커를 씁니다.

3.  **getArrowInfo**(`getArrowInfo.ts`): `kind`에 따라 `getStraightArrowInfo`, `getCurvedArrowInfo`, `getElbowArrowInfo` 중 하나로 갈립니다. 결과는 start·end의 `handle`(사용자가 잡는 점), `point`(실제 그리는 끝점), 화살촉, 길이, 곡선이면 원호 정보, 직각이면 경로 점 목록을 담습니다. 이 역시 캐시됩니다.

**직선 화살표**(`straight-arrow.ts`)의 핵심:

- 앵커 점을 향하는 선분과 대상 도형 지오메트리의 **교차점**을 구해 화살촉 위치로 씁니다. 그래서 화살표는 중심을 겨냥하면서 테두리에서 멈춥니다. `isExact`면 교차 대신 앵커 점에서 멈춥니다.

- 대상이 프레임 등에 잘려 있으면 끝점을 마스크 경계로 제한합니다(`clampArrowTerminalToMask`).

- 테두리에서 `BOUND_ARROW_OFFSET`과 선 굵기만큼 띄웁니다. 너무 짧아지면 `MIN_ARROW_LENGTH`를 보장합니다.

**곡선 화살표**(`curved-arrow.ts`)는 start, end, 그리고 중점에서 `bend`만큼 떨어진 점을 지나는 원호를 만들고, 원과 대상 도형의 교차점으로 끝을 자릅니다. 중간 핸들을 끌면 `onArcMidpointHandleDrag`가 핸들을 수직이등분선에 투영해 새 `bend`를 구합니다.

**직각 화살표**(`elbow/`)는 두 도형의 경계 상자와 각 변(top/right/bottom/left)을 후보로 두고, `routeArrowWithAutoEdgePicking`이 출발·도착 변 조합별 경로를 `ElbowArrowRouteBuilder`로 만들어 가장 좋은 것을 고릅니다. 경로를 만들 수 없으면 직선 화살표 정보로 대체합니다.

화살표 `getGeometry`는 이 정보로 선(Edge2d/Arc2d/Polyline2d)과 라벨 사각형(isLabel)을 `Group2d`로 묶습니다. 라벨 위치는 `labelPosition`을 경로 위 매개변수로 써서 `interpolateAlongEdge`로 구합니다.

## 8.5 바인딩을 만드는 순간: 끝점 드래그

화살표를 그리거나 끝 핸들을 끌면 `ArrowShapeUtil.onTerminalHandleDrag`가 호출됩니다.

1.  `updateArrowTargetState`(`arrowTargetState.ts`)가 포인터 아래 바인딩 가능한 도형을 찾습니다. Ctrl을 누르면 대상을 무시합니다(`shouldIgnoreTargets`).

2.  **정밀 모드 판정**: 새 대상으로 옮겨갈 때 포인터 속도가 0.5 미만이면(천천히 움직이면) precise가 됩니다. 빠르게 지나치면 중심을 향합니다. 반대쪽 끝이 같은 도형에 precise로 붙어 있으면 이쪽도 precise입니다.

3.  **exact**: Alt를 누르면 `shouldBeExact`가 true가 되어 테두리 교차 없이 그 점에 정확히 붙습니다.

4.  precise이고 닫힌 도형이면 중심에 가까울 때 중심으로 스냅합니다.

5.  `createOrUpdateArrowBinding(editor, arrow, target, props)`가 같은 terminal의 기존 바인딩을 갱신하거나 새로 만듭니다. 중복이 있으면 지웁니다. 대상이 없으면 `removeArrowBinding`으로 끊고 `start`/`end` props에 좌표를 적습니다.

6.  대상 후보는 오버레이(`ArrowBindingHintOverlayUtil`)가 강조 표시합니다.

## 8.6 ArrowBindingUtil: 관계를 유지하는 규칙

`packages/tldraw/src/lib/bindings/arrow/ArrowBindingUtil.ts`의 훅들입니다.

- `onAfterCreate`, `onAfterChange`, `onAfterChangeFromShape`(화살표가 부모·순서를 바꿨거나 조상이 바뀌었을 때) → `arrowDidUpdate`: 대상 도형이 없거나 다른 페이지에 있으면 그 끝을 끊고(`updateArrowTerminal({ unbind: true })`) 화살표를 적절한 부모로 옮깁니다.

- `onAfterChangeToShape`: 대상 도형이 바뀌면 화살표의 부모를 다시 정합니다. geo 도형의 모양(사각형→타원 등)이 바뀌어 precise 앵커가 도형 밖으로 나가면 가장 가까운 점으로 앵커를 옮깁니다. 단, undo 재생 중에는 하지 않습니다.

- `onBeforeIsolateFromShape`: 대상 도형이 삭제되기 직전에 현재 화살표 끝의 실제 위치를 `start`/`end` props에 굳혀 둡니다. 대상이 사라져도 화살표가 그 자리에 남습니다.

**부모 재설정(reparentArrow)**: 두 끝이 모두 붙어 있으면 두 도형의 공통 프레임 조상(없으면 공통 조상, 그것도 없으면 페이지)을 부모로 삼습니다. 한 끝만 붙어 있으면 그 도형과 같은 부모일 때만 유지하고, 아니면 페이지로 올립니다. 그다음 화살표가 두 도형보다 위에 그려지도록 인덱스를 조정합니다. 프레임이 화살표를 자르지 않는 이유(7.7절의 `shouldClipChild`)와 이어집니다.

## 8.7 왜 화살표 좌표를 저장하지 않는가

대상 도형이 움직일 때마다 화살표 레코드를 갱신하는 설계라면 세 가지 문제가 생깁니다.

- **동시 편집 충돌**: A가 사각형을, B가 화살표 라벨을 동시에 바꾸면 화살표 레코드가 두 번 쓰여 마지막 쓰기만 살아남습니다. 지금은 A는 사각형만, B는 화살표만 씁니다.

- **undo 복잡도**: 사각형 이동을 되돌릴 때 화살표도 같이 되돌려야 합니다. 지금은 화살표가 파생값이라 자동입니다.

- **변경량**: 도형 하나에 화살표 10개가 붙어 있으면 드래그 한 프레임에 11개 레코드를 쓰고 동기화해야 합니다.

대가는 계산이지만, Computed 캐시 덕분에 관련 도형이 바뀔 때만 재계산됩니다. 공간 인덱스가 바인딩 변경 시 양 끝 도형을 다시 넣는 것(6.7절)도 이 때문입니다. 화살표의 경계는 레코드가 아니라 바인딩된 도형에 따라 바뀝니다.

## 8.8 이 장의 핵심 정리

- 도형 간 관계는 fromId·toId를 가진 별도 binding 레코드입니다. 도형이 삭제되면 사이드 이펙트가 자동으로 정리합니다.

- BindingUtil 훅은 바인딩 자체의 수명과 양 끝 도형의 변화(자기·조상·삭제·고립)에 반응합니다.

- 화살표는 끝점 좌표 대신 "대상 + 정규화 앵커 + 정밀/정확 플래그"를 저장하고, 모양은 캐시된 파생값입니다.

- 직선·곡선·직각 세 가지 경로 계산기가 있으며 모두 대상 지오메트리와의 교차로 끝을 정합니다.

- 화살표의 부모는 양 끝 도형의 공통 조상으로 자동 조정됩니다.

**다음 장**: 선택된 도형을 옮기고, 크기를 바꾸고, 돌리고, 스냅하는 과정.
