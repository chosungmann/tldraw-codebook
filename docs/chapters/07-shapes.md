# 7장. 도형 시스템 — ShapeUtil, 지오메트리, 부모·그룹·프레임

도형 레코드(3장)는 데이터일 뿐이고, 도형의 **모든 행동**은 타입별 `ShapeUtil` 클래스(`packages/editor/src/lib/editor/shapes/ShapeUtil.ts`, 약 1,190줄)가 정의합니다. Editor는 도형을 그리거나, 히트 테스트하거나, 리사이즈할 때마다 `editor.getShapeUtil(shape)`을 찾아 물어봅니다. 그중 가장 중요한 답은 `getGeometry()`가 돌려주는 `Geometry2d`입니다. 경계, 히트 테스트, 스냅, 화살표 연결, 브러시 선택, 컬링이 모두 이 지오메트리에서 나옵니다.

## 7.1 최소 커스텀 도형

`apps/examples/src/examples/shapes/tools/custom-shape/CustomShapeExample.tsx`에서 발췌했습니다.

```tsx
declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    'my-custom-shape': { w: number; h: number; text: string }   // 타입 등록(모듈 보강)
  }
}
type ICustomShape = TLShape<'my-custom-shape'>

export class MyShapeUtil extends ShapeUtil<ICustomShape> {
  static override type = 'my-custom-shape'
  static override props: RecordProps<ICustomShape> = { w: T.number, h: T.number, text: T.string }
  getDefaultProps() { return { w: 200, h: 200, text: "I'm a shape!" } }
  getGeometry(shape) { return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true }) }
  override onResize(shape, info) { return resizeBox(shape, info) }
  component(shape) { return <HTMLContainer>{shape.props.text}</HTMLContainer> }
  getIndicatorPath(shape) { const p = new Path2D(); p.rect(0, 0, shape.props.w, shape.props.h); return p }
}
// <Tldraw shapeUtils={[MyShapeUtil]} />
```

여기서 일어나는 일을 앞 장들과 연결하면 이렇습니다.

- `TLGlobalShapePropsMap` 모듈 보강으로 `TLShape` 유니언에 새 타입이 들어가 `editor.createShape({ type: 'my-custom-shape' })`가 타입 검사를 통과합니다.

- `static props`와 `static migrations`는 스토어 스키마로 들어갑니다(3장, 4.10절). props에 `StyleProp`을 넣으면 스타일 패널과 연동됩니다.

- `component`는 도형 좌표계(원점이 도형의 x, y)에서 그립니다. 위치·회전은 바깥 div의 transform이 처리합니다(6장). `HTMLContainer`와 `SVGContainer`는 도형 크기에 맞춘 컨테이너입니다.

- `getIndicatorPath`는 호버·선택 외곽선을 캔버스 오버레이에 그리는 `Path2D`입니다.

## 7.2 ShapeUtil API 지도

**필수(abstract)**: `getDefaultProps`, `getGeometry(shape, opts)`, `component(shape)`, `getIndicatorPath(shape)`.

**능력 질의(can…/hide…/is…)**: 기본값이 있고 재정의해 동작을 바꿉니다.

| 메서드                                                                        | 의미                                                     |
|-------------------------------------------------------------------------------|----------------------------------------------------------|
| `canEdit`, `canEditInReadonly`, `canEditWhileLocked`                          | 더블클릭 편집 모드 진입 가능 여부                        |
| `canResize`, `canResizeChildren`, `isAspectRatioLocked`, `canFlip`, `canCrop` | 변형 가능 범위                                           |
| `canBind({ fromShape, toShape, bindingType })`                                | 바인딩(화살표 연결 등) 허용                              |
| `canSnap`, `canTabTo`, `canScroll`, `canCull`, `canBeLaidOut`                 | 스냅, Tab 이동, 휠 스크롤 가로채기, 컬링, 정렬·분배 참여 |
| `canReceiveNewChildrenOfType`, `canRemoveChildrenOfType`                      | 부모 역할                                                |
| `hideResizeHandles`, `hideRotateHandle`, `hideSelectionBoundsBg/Fg`           | 선택 UI 숨김                                             |
| `isFrameLike`, `providesBackgroundForChildren`, `isExportBoundsContainer`     | 프레임류 동작                                            |

**레코드 훅**: `onBeforeCreate`, `onBeforeUpdate`, `onBeforeDuplicate`, `onChildrenChange`, `onBindingChange`. 생성·갱신 직전에 레코드를 고칠 수 있습니다(4.7절).

**인터랙션 훅**: 반환한 partial을 도구가 `updateShapes`로 적용합니다.

- 리사이즈: `onResizeStart`, `onResize(shape, info)`, `onResizeEnd`, `onResizeCancel`

- 이동: `onTranslateStart`, `onTranslate`, `onTranslateEnd`, `onTranslateCancel`

- 회전: `onRotateStart`, `onRotate`, `onRotateEnd`, `onRotateCancel`

- 핸들: `getHandles`, `onHandleDragStart`, `onHandleDrag`, `onHandleDragEnd`, `onHandleDragCancel`

- 클릭: `onClick`, `onDoubleClick`, `onDoubleClickHandle`, `onDoubleClickEdge`, `onDoubleClickCorner`

- 편집: `onEditStart`, `onEditEnd`. 크롭: `onCrop`

- 드래그 앤 드롭(부모 후보일 때): `onDragShapesIn`, `onDragShapesOver`, `onDragShapesOut`, `onDropShapesOver`

**렌더링·내보내기**: `backgroundComponent`, `getCanvasSvgDefs`, `toSvg(shape, ctx)`, `toBackgroundSvg`, `getClipPath`, `shouldClipChild`, `getFontFaces`, `expandSelectionOutlinePx`, `getInterpolatedProps`(도형 애니메이션용 보간), `getAppOwnedElement`(앱이 소유한 DOM 요소를 도형 안에 살려두기).

**기타**: `getText`, `getAriaDescriptor`(접근성), `getShapeName`, `getBoundsSnapGeometry`, `getHandleSnapGeometry`, `createShapeForAsset`(에셋 타입을 도형으로 변환, `handledAssetTypes`와 짝), `getReferencedUserIds`.

`ShapeUtil.configure({ ...options })`는 `options` 객체를 덮어쓴 새 서브클래스를 만듭니다. 기본 도형을 상속 없이 설정만 바꿀 때 씁니다.

`BaseBoxShapeUtil`은 `props.w/h`를 가진 도형을 위한 편의 클래스입니다. `Rectangle2d` 지오메트리, `resizeBox` 리사이즈, 모서리·중심 핸들 스냅, w/h 보간을 기본으로 제공합니다.

## 7.3 Geometry2d: 도형의 수학적 모델

`Geometry2d`(`primitives/geometry/Geometry2d.ts`)는 **도형 좌표계의 선분 근사**입니다. 하위 클래스가 `getVertices()`와 `nearestPoint(point)`만 구현하면 나머지는 기본 구현이 해결합니다.

| 속성·메서드                                                                        | 의미                                                                                    |
|------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| `isClosed`, `isFilled`                                                             | 닫힌 도형인가, 내부도 히트되는가                                                        |
| `isLabel`, `isEmptyLabel`, `isInternal`, `excludeFromShapeBounds`, `ignore`        | 하위 지오메트리의 역할 표시                                                             |
| `vertices`, `bounds`, `boundsVertices`, `center`, `area`, `length`                 | 지연 계산 후 캐시되는 getter                                                            |
| `hitTestPoint(p, margin, hitInside)`                                               | 닫힌+채움(또는 hitInside)이면 다각형 내부 판정, 아니면 가장 가까운 점까지 거리 ≤ margin |
| `distanceToPoint(p, hitInside)`                                                    | 내부면 음수인 부호 있는 거리                                                            |
| `distanceToLineSegment`, `hitTestLineSegment`                                      | 지우개·올가미 선택의 선분 히트                                                          |
| `intersectLineSegment`, `intersectCircle`, `intersectPolygon`, `intersectPolyline` | 교차점(화살표 끝점 계산 등)                                                             |
| `interpolateAlongEdge(t)`, `uninterpolateAlongEdge(p)`                             | 둘레를 따라가는 매개변수(화살표 라벨 위치 등)                                           |
| `transform(matrix)`                                                                | 변환된 지오메트리(그룹이 자식을 모을 때)                                                |
| `toSimpleSvgPath()`, `ignoreHit(p)`                                                | SVG 경로, 특정 점 히트 거부(이미지의 투명 픽셀 등)                                      |

필터(`Geometry2dFilters`)로 라벨·내부 지오메트리를 포함할지 정합니다. 기본 `vertices`는 라벨을 뺀 것입니다.

**하위 클래스**(`primitives/geometry/`): `Rectangle2d`, `Ellipse2d`, `Circle2d`, `Stadium2d`, `Polygon2d`, `Polyline2d`, `Edge2d`, `Arc2d`, `CubicBezier2d`, `CubicSpline2d`, `Point2d`, `Group2d`. `Group2d`는 여러 지오메트리를 묶습니다. geo 도형은 "본체 + 텍스트 라벨(isLabel)", 화살표는 "선 + 라벨" 같은 식입니다.

곡선은 정확한 해석식이 아니라 정점 근사로 다룹니다. 그래서 모든 기하 연산이 "다각형/폴리라인과 점·선분" 문제로 통일됩니다.

지오메트리는 4.8절의 캐시에 저장되며, props와 meta가 같으면 재사용됩니다. 그러므로 `getGeometry`는 **props에만 의존해야** 합니다. 다른 반응형 값(예: 폰트 측정)을 읽으면 그 값에도 의존성이 잡혀 재계산됩니다.

## 7.4 히트 테스트: getShapeAtPoint

`editor.getShapeAtPoint(point, { margin, hitInside, hitLabels, hitFrameInside, hitLocked, filter, renderingOnly })`의 알고리즘입니다(약 5928행).

1.  **후보 추리기**: R-tree에서 그 점 근처 도형 ID를 얻습니다. 프레임류는 라벨이 경계 밖에 있어 항상 포함합니다.

2.  **위에서부터**: 현재 페이지 도형을 z-순서로 정렬한 목록을 위에서 아래로 돕니다. 잠긴 도형(옵션이 없으면), 숨겨진 도형, 그룹은 건너뜁니다. 그룹은 자식을 통해 선택됩니다.

3.  **마스크**: 프레임에 잘려 보이지 않는 부분이면 건너뜁니다.

4.  **라벨 우선**: 프레임, 노트, 화살표, 채움 없는 geo는 텍스트 라벨 영역을 눌러도 히트입니다.

5.  **프레임**: 테두리 마진 안이면 프레임을, 내부 빈 공간이면 이미 찾은 후보(없으면 `hitFrameInside`일 때만 프레임)를 돌려주고 **탐색을 멈춥니다.** 프레임 뒤의 도형이 비쳐 보여도 클릭이 통과하지 않게 하는 규칙입니다.

6.  **거리 계산**: 경계 상자 포함 검사(broad phase) 후 실제 거리(narrow phase). 폭이나 높이가 1 미만인 직선은 broad phase를 건너뜁니다.

7.  **닫힌 도형**: 채워져 있으면 즉시 히트입니다(위에서부터 순회하므로 아래 도형을 가림). 속이 비었으면 가장자리에 가장 가까운 도형을 기억하고, 가장자리에서 멀면 **면적이 가장 작은** 도형을 후보로 둡니다(큰 빈 사각형 안의 작은 빈 사각형을 고르기 위함).

8.  **열린 도형**(선, 그리기): 마진 안이면 히트입니다.

마진은 줌에 따라 바뀝니다. `getHitTestMargin()`은 `hitTestMargin / zoom`(터치는 `coarseHitTestMargin`)이라 화면상 픽셀 거리가 일정합니다. `getShapesAtPoint`는 모든 히트를, `isPointInShape(shape, point)`는 단일 도형 판정을 돌려줍니다.

## 7.5 부모–자식 관계

- **구조**: `parentId`가 페이지면 최상위 도형, 도형 ID면 그 도형의 자식입니다. 형제 순서는 `index`(분수 인덱스)입니다.

- **조회**: `getSortedChildIdsForParent`(4.8절의 parentsToChildren 인덱스), `getShapeAncestors`, `getShapeParent`, `hasAncestor`, `findCommonAncestor`, `visitDescendants`, `getHighestIndexForParent`.

- **reparentShapes(ids, parentId, insertIndex)**: 각 도형의 페이지 변환에 새 부모의 역변환을 적용해 새 x·y·rotation을 구합니다. 화면상 위치는 그대로이고 부모만 바뀝니다. 삽입 인덱스 사이로 새 분수 인덱스를 만들며 `ignoreShapeLock`으로 실행합니다.

- **z-순서 변경**: `bringToFront`, `bringForward`, `sendBackward`, `sendToBack`은 `utils/reorderShapes.ts`의 `getReorderingShapesChanges`가 형제 사이 새 인덱스를 계산합니다. 옮기는 도형만 레코드가 바뀝니다.

## 7.6 그룹

그룹(`editor/shapes/group/GroupShapeUtil.tsx`)은 자기 props가 거의 없는 "순수 컨테이너"입니다. 코어에 포함되어 항상 등록됩니다.

- **지오메트리**: 자식 지오메트리에 각자의 로컬 변환을 적용해 `Group2d`로 묶습니다. 그래서 그룹의 경계는 자식들의 합입니다. 자식이 없으면 1×1 사각형입니다.

- **자기 정리**: `onChildrenChange`에서 자식이 0개면 스스로 삭제하고, 1개면 그 자식을 자기 자리(부모와 인덱스)로 옮긴 뒤 삭제합니다. 4.6절의 operation-complete 핸들러가 호출합니다.

- **포커스된 그룹**: 그룹 안의 도형을 더블클릭하면 `focusedGroupId`가 설정되고, 그때부터 클릭은 그 그룹의 자식 단위로 선택됩니다. 새 도형도 그 그룹 안에 만들어집니다(4.7절). `popFocusedGroupId()`는 한 단계 밖으로 나갑니다.

- `groupShapes(ids)` / `ungroupShapes(ids)`는 공통 부모를 찾아 그룹을 만들고 `reparentShapes`로 자식을 옮깁니다.

## 7.7 프레임과 클리핑

`BaseFrameLikeShapeUtil`(`editor/shapes/BaseFrameLikeShapeUtil.tsx`)이 프레임류 도형의 공통 동작을 정의합니다.

- `isFrameLike` → true, `providesBackgroundForChildren` → true(6.5절의 배경 레이어).

- `canReceiveNewChildrenOfType` / `canRemoveChildrenOfType` → 잠기지 않았을 때만.

- `getClipPath` → 자기 지오메트리 정점. `shouldClipChild` → 화살표는 자르지 않음.

- `onDragShapesIn`: 드래그로 들어온 도형을 `reparentShapes`로 자식으로 만듭니다. 원래 자기 자식이었다가 다시 들어오면 원래 인덱스를 복원합니다. 자기의 조상을 넣으려는 경우는 막습니다.

- `onDragShapesOut`: 다른 부모 후보 위가 아니면 페이지로 내보냅니다.

**마스크 계산**(`_getShapeMaskCache`): 도형의 모든 조상 중 `getClipPath`를 가진 것의 클립 다각형을 페이지 좌표로 변환해 **모두 교집합**합니다(`intersectPolygonPolygon`). 결과는 세 곳에 쓰입니다.

- 렌더링: 도형 로컬 좌표로 되돌려 CSS `clip-path: polygon(...)`. 교집합이 비면 보이지 않는 다각형을 씁니다.

- 히트 테스트: 마스크 밖이면 무시.

- 페이지 경계: `getShapeMaskedPageBounds`는 잘린 부분을 뺀 경계.

**드래그 중 부모 변경**은 select 도구의 `DragAndDropManager`가 담당합니다. 이동 중 포인터 아래의 부모 후보(`canReceiveNewChildrenOfType`가 true인 도형)를 찾아 `onDragShapesIn/Over/Out`을 호출합니다. 프레임 크기를 바꿔 자식이 가려지면 `utils/reparenting.ts`의 `kickoutOccludedShapes`가 밖으로 내보냅니다.

## 7.8 잠금과 가시성

- `isLocked`인 도형과 그 자손은 `updateShapes`·`deleteShapes`에서 걸러집니다(4.7절). 선택도 기본적으로 되지 않지만 `options.selectLockedShapes`로 허용할 수 있습니다. 프로그램에서 바꾸려면 `editor.run(fn, { ignoreShapeLock: true })`를 씁니다.

- `getShapeVisibility(shape)` Editor 옵션은 `'visible' | 'hidden' | 'inherit'`을 돌려줍니다. 숨겨진 도형은 렌더·히트에서 빠지지만 스토어에는 남습니다. 권한별 도형 숨기기 같은 기능에 씁니다.

## 7.9 이 장의 핵심 정리

- 도형 = 레코드(데이터) + ShapeUtil(행동). 모듈 보강과 `static props/migrations`로 타입·스키마에 합류합니다.

- `getGeometry`가 도형의 수학적 진실입니다. 경계·히트·스냅·교차가 모두 정점 근사 위에서 계산됩니다.

- 히트 테스트는 R-tree 후보 → 위에서부터 → 마스크·라벨·프레임 규칙 → 채움/빈 도형 규칙 순입니다.

- 그룹은 자식에서 지오메트리를 얻고 자식이 1개 이하가 되면 스스로 사라집니다. 프레임은 자식을 자르고 드래그 앤 드롭으로 자식을 받습니다.

- 부모 변경은 항상 페이지 변환을 보존하는 좌표 재계산을 동반합니다.

**다음 장**: 도형과 도형을 잇는 바인딩, 그리고 화살표.
