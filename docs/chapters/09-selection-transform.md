# 9장. 선택·이동·리사이즈·회전·스냅

에디터에서 가장 자주 일어나는 상호작용은 선택한 도형을 변형하는 것입니다. 이 장은 select 도구의 인터랙션 상태들(`packages/tldraw/src/lib/tools/SelectTool/childStates/`)과 Editor의 변형 API, 스냅 시스템을 다룹니다. 모든 인터랙션은 같은 골격을 갖습니다. **진입 시 마크와 스냅샷을 만들고, 매 이동마다 스냅샷에서 다시 계산하며, 완료 시 확정하고, 취소 시 마크로 되돌린다**입니다.

## 9.1 선택 상태

선택은 현재 페이지의 `instance_page_state.selectedShapeIds`입니다(3장).

- 쓰기: `setSelectedShapes(ids)`, `select(...ids)`, `selectAll()`, `selectNone()`, `deselect(...ids)`.

- 읽기: `getSelectedShapeIds()`, `getSelectedShapes()`, `getOnlySelectedShape()`, `getSelectionPageBounds()`(축 정렬), `getSelectionRotation()`(모든 선택 도형의 회전이 같으면 그 값, 아니면 0), `getSelectionRotatedPageBounds()`(회전된 선택 상자).

- 불변식(4.6절 사이드 이펙트): 조상과 자손이 함께 선택되면 자손을 빼고, 선택된 도형들의 공통 그룹 조상을 `focusedGroupId`로 둡니다.

- 호버는 `hoveredShapeId`이며, select의 Idle이 `updateHoveredShapeId`(`selection-logic/`)로 포인터 이동마다 갱신합니다.

**클릭 선택 규칙**(`PointingShape`, `selectOnCanvasPointerUp`):

- 이미 선택된 도형을 눌렀으면 pointer_up까지 선택을 바꾸지 않습니다. 드래그하면 현재 선택 전체를 옮기기 위해서입니다.

- Shift는 선택에 추가·제거합니다.

- 그룹 안 도형을 클릭하면 먼저 가장 바깥 그룹이 선택되고, 다시 클릭하거나 더블클릭하면 한 단계씩 들어갑니다.

**브러시 선택**(`Brushing.ts`): 빈 캔버스에서 드래그하면 사각형 브러시(`instance.brush`)를 그립니다.

1.  R-tree로 브러시 안 후보를 추립니다(`getShapeIdsInsideBounds`).

2.  브러시가 도형 경계를 완전히 감싸면 히트입니다.

3.  **랩 모드**(사용자 설정, Ctrl/Cmd로 반전)에서는 완전히 감싸야만 선택됩니다. 아니면 브러시의 네 변을 도형 공간으로 변환해 `geometry.hitTestLineSegment`로 테두리와 교차하는지 봅니다. 경계 상자가 아니라 실제 지오메트리가 기준입니다.

4.  프레임 마스크 밖 부분은 제외합니다.

**올가미 선택**(`ScribbleBrushing.ts`): Alt+드래그로 자유선을 그리면 그 선에 닿은 도형을 선택합니다. ScribbleManager가 선을 그리고 선분별 히트 테스트를 합니다.

## 9.2 이동: Translating

**진입**(`onEnter`):

1.  생성 중이 아니면 `markHistoryStoppingPoint('translating')`. 생성 중이면 생성 마크를 이어 씁니다.

2.  `getTranslatingSnapshot`: 도형별 시작 페이지 점·회전, 선택 경계, 스냅 포인트, 스티키 노트용 인접 위치 등.

3.  Alt가 눌려 있으면 `startCloning()`으로 복제본을 만들어 그것을 옮깁니다.

4.  `handleStart()` → 각 도형의 `onTranslateStart` 훅.

**매 이동**(`moveShapesToPoint`):

```ts
const delta = Vec.Sub(inputs.getCurrentPagePoint(), inputs.getOriginPagePoint())
if (shiftKey) /* 더 크게 움직인 축만 남김 */
const isSnapping = editor.user.getIsSnapMode() ? !accelKey : accelKey
if (isSnapping && editor.inputs.getPointerVelocity().len() < 0.5) {
  const { nudge } = editor.snaps.shapeBounds.snapTranslateShapes({ dragDelta: delta, ... })
  delta.add(nudge)
} else if (스티키 노트) { /* 인접 노트 자리(pit)에 끌어당김 */ }
// 그리드 모드면 격자에 맞춤 → 각 도형의 (시작 페이지 점 + delta)를 부모 공간으로 변환해 updateShapes
```

- **항상 시작 스냅샷 + 총 이동량**으로 계산합니다. 프레임마다 증분을 더하지 않으므로 오차가 쌓이지 않고, 스냅이 풀리면 정확히 포인터 위치로 돌아갑니다.

- 스냅은 포인터 속도가 느릴 때만 걸립니다. 빠르게 끌 때 스냅에 걸려 덜컥거리지 않게 하려는 것입니다.

- 스냅 모드 사용자 설정과 Ctrl/Cmd는 서로 반전 관계입니다.

- 이동 후 각 도형의 `onTranslate(initial, current)` 훅 결과를 적용합니다.

- `DragAndDropManager`가 포인터 아래 부모 후보를 추적합니다(7.7절).

- 화면 가장자리에서는 `onTick`에서 엣지 스크롤을 수행합니다.

**동시 편집 대응**: 드래그 중에 다른 사용자가 같은 도형을 움직이거나 지울 수 있습니다. `GestureShapeChangeTracker`는 `registerAfterChangeHandler('shape')`로 추적 중인 도형의 변경을 감지하되, 자기 쓰기(`ignoreChanges`로 감싼 것)는 무시합니다. 외부 변경이 감지되면 `foldExternalChangesIntoSnapshot()`이 각 도형의 스냅샷 원점을 "현재 위치 − 지금까지의 이동량"으로 다시 잡습니다. 그래서 낡은 스냅샷이 상대방의 변경을 덮어쓰지 않습니다. 부모가 사라진 도형은 `rescueShapesWithDeletedParents`가 구출합니다. Resizing과 Rotating도 같은 트래커를 씁니다.

**완료**(`complete`): 마지막 갱신 → `dropShapes`(부모 확정) → `onTranslateEnd` → `kickoutOccludedShapes` → `onInteractionEnd`가 있으면 그 도구로, 아니면 idle.

**취소**(Esc): `onTranslateCancel` → `bailToMark(markId)`. 이동 중 만든 모든 변경(복제본 생성 포함)이 흔적 없이 사라집니다.

## 9.3 리사이즈: Resizing과 resizeShape

**Resizing 상태**가 매 이동마다 하는 일(`Resizing.ts`의 `updateShapes`):

1.  Shift 또는 변형 불가능한 도형이 있으면 비율을 고정합니다. 그리드 모드면 포인터를 격자에 맞춥니다.

2.  스냅이 켜져 있으면 `snapResizeShapes`로 포인터를 보정합니다.

3.  **기준점**: 잡은 핸들의 반대편 핸들(Alt면 선택 중심)을 회전된 선택 상자 위에서 구합니다.

4.  **배율**: 기준점에서 시작 포인터까지 벡터와 현재 포인터까지 벡터를 선택 회전만큼 되돌린 뒤 축별로 나눕니다. 음수면 뒤집기입니다.

5.  선택된 각 도형에 `editor.resizeShape(id, scale, { initialShape, initialBounds, initialPageTransform, scaleOrigin, scaleAxisRotation, dragHandle, mode })`를 호출합니다.

**getResizeShapePartial**(`Editor.ts`)의 핵심:

- 도형의 회전이 배율 축과 호환되지 않으면(예: 45° 돌아간 도형을 축 정렬 선택 상자로 키움) `_resizeUnalignedShape`가 균등 배율과 위치 이동으로 근사합니다. 회전된 사각형을 비균등으로 늘리면 평행사변형이 되는데, tldraw 도형은 이를 표현할 수 없기 때문입니다.

- 비율 고정이면 더 큰 축의 배율을 다른 축에 적용합니다(부호 유지).

- 도형이 `onResize`를 구현하면, 새 원점(페이지 좌표를 기준점 중심으로 배율한 뒤 부모 공간으로)과 `{ newPoint, handle, mode, scaleX, scaleY, initialBounds, initialShape }`을 넘겨 props를 계산하게 합니다. 90° 회전된 도형은 x·y 배율을 맞바꿉니다.

- `onResize`가 없거나 `canResize`가 false면 크기는 두고 중심만 이동합니다(예: 대부분의 고정 크기 요소).

- `onResizeStart`/`onResizeEnd`는 `skipStartAndEndCallbacks`가 아니면 호출됩니다.

**resizeBox**(`editor/shapes/shared/resizeBox.ts`)는 w·h 도형의 표준 구현입니다. `w × scaleX`, `h × scaleY`를 최소·최대로 clamp하고, clamp로 줄어든 만큼 잡은 핸들 방향에 따라 위치를 보정하며, 음수 배율이면 뒤집어 반대편으로 넘깁니다. 크기를 바꾸는 대신 `scale` prop을 바꾸는 도형(텍스트·노트 등)을 위한 `resizeScaled`도 있습니다. `mode: 'resize_bounds'`는 요소의 내용 크기를 유지한 채 경계만 바꾸는 리사이즈입니다.

**동적 크기 모드**: 사용자 설정이 켜져 있으면 `getResizeScaleFactor()`가 `1 / zoom`이 되어, 확대한 상태에서 새로 만드는 도형이 화면상 같은 크기로 보이도록 `scale` prop을 조절합니다.

## 9.4 회전: Rotating

- 시작 시 `getRotationSnapshot`: 선택 중심(페이지), 시작 커서 각도, 선택의 초기 회전, 도형별 초기 상태.

- 매 이동: `중심→현재 포인터 각도 − 시작 각도`를 더합니다. Shift면 `snapAngle(r, 24)`로 15° 단위, 터치는 직각 근처5° 안에서 90° 배수로 붙습니다. 완료 시에는 1° 단위로 반올림합니다.

- `applyRotationToSnapshotShapes`(`editor/src/lib/utils/rotation.ts`)가 각 도형을 선택 중심에 대해 회전시키고(위치 공전 + rotation 자전), `onRotate` 훅을 적용합니다.

- `editor.rotateShapesBy(ids, delta)`가 같은 계산을 프로그램에서 쓸 수 있게 합니다.

## 9.5 핸들 드래그

선·화살표·말풍선 꼬리 같은 도형은 `getHandles(shape)`로 핸들(`TLHandle`: id, type `'vertex' | 'virtual' | 'create' | 'clone'`, x, y, index, canSnap)을 노출합니다.

- 핸들은 오버레이(`ShapeHandleOverlayUtil`)로 그려지고 히트됩니다(6.6절).

- PointingHandle → 드래그되면 DraggingHandle. 시작 시 `onHandleDragStart`, 이동마다 `onHandleDrag(shape, { handle, isPrecise, isCreatingShape, initial })`, 끝에 `onHandleDragEnd`, 취소 시 `onHandleDragCancel`.

- `virtual` 핸들(선분 중간점)을 끌면 새 정점이 생깁니다. `clone` 핸들(노트 옆 +)을 누르면 인접 도형을 만듭니다.

- 핸들 스냅은 `HandleSnaps.snapHandle`입니다. 다른 도형의 `getHandleSnapGeometry`(외곽선, 점)에 끌어당깁니다.

- 화살표 끝점 드래그가 바인딩을 만드는 과정은 8.5절에서 다뤘습니다.

## 9.6 스냅 시스템

`SnapManager`(`editor/managers/SnapManager/`)는 두 하위 시스템과 인디케이터 Atom을 갖습니다.

- `getSnapThreshold()` = `options.snapThreshold / zoom`(화면 픽셀 기준으로 일정).

- `getSnappableShapes()`: 선택의 공통 조상 안에서 뷰포트에 보이고, 선택되지 않았고, `canSnap`이 true인 도형. 그룹은 안으로 들어가고, 부모 프레임도 포함합니다.

- `setIndicators`/`clearIndicators`: 스냅선은 `SnapIndicatorOverlayUtil`이 그립니다. 종류는 `points`(정렬선)와 `gaps`(간격) 두 가지입니다.

**BoundsSnaps.snapTranslateShapes**의 알고리즘입니다.

1.  다른 도형들의 스냅 포인트(기본은 경계의 네 모서리와 중심, `getBoundsSnapGeometry`로 변경 가능)와 이동한 선택의 스냅 포인트를 비교해 x·y 각각 임계값 안의 가장 가까운 포인트 스냅을 모읍니다(`collectPointSnaps`).

2.  **간격 스냅**(`collectGapSnaps`): 화면에 보이는 도형 쌍 사이의 간격을 미리 계산해두고(`getVisibleGaps`), 선택을 두 도형 사이 정중앙에 두거나 기존 간격과 같은 간격으로 이어 붙이는 위치를 후보로 넣습니다.

3.  축별 최적 nudge를 골라 적용합니다. Shift로 잠긴 축은 0입니다.

4.  **nudge를 적용한 상태에서 다시 한 번** 수집해, 오차 0으로 맞는 모든 스냅을 인디케이터로 만듭니다. 그래서 한 번에 여러 정렬선이 동시에 표시됩니다.

`snapResizeShapes`는 잡은 핸들에 따라 움직이는 변·모서리만 스냅 대상으로 삼고, 비율 고정·중심 기준 리사이즈를 고려합니다. 스냅 포인트와 간격은 모두 `@computed`이라 드래그 중 매번 다시 만들지 않습니다.

## 9.7 프로그램 변형 커맨드

Editor의 Commands 구역(약 6981–9200행)은 UI 액션이 호출하는 변형들입니다.

| 메서드                                                                          | 동작                                                                                                                                 |
|---------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| `nudgeShapes(ids, offset)`                                                      | 방향키 이동                                                                                                                          |
| `duplicateShapes(ids, offset)`                                                  | 복제. ID 재매핑, 바인딩 복제, `onBeforeDuplicate`. `instance.duplicateProps`가 직전 복제 오프셋을 기억해 반복 복제 시 같은 간격 유지 |
| `rotateShapesBy`, `flipShapes(ids, 'horizontal'|'vertical')`                    | 회전·뒤집기(뒤집기는 음수 배율 리사이즈)                                                                                             |
| `alignShapes`, `distributeShapes`, `stackShapes`, `packShapes`, `stretchShapes` | 정렬·분배·쌓기·채우기·늘리기. `canBeLaidOut`이 false인 도형은 제외                                                                   |
| `bringToFront`, `bringForward`, `sendBackward`, `sendToBack`                    | z-순서                                                                                                                               |
| `groupShapes`, `ungroupShapes`                                                  | 그룹                                                                                                                                 |
| `animateShape(s)`                                                               | `getInterpolatedProps`로 props까지 보간하는 애니메이션                                                                               |

## 9.8 이 장의 핵심 정리

- 모든 변형 인터랙션은 "마크 + 스냅샷 → 스냅샷 기준 재계산 → 확정 또는 bailToMark" 패턴입니다.

- 드래그 중 원격 변경은 변경 트래커가 감지해 스냅샷에 반영합니다.

- 리사이즈는 "기준점에 대한 축별 배율"로 환원되고, 크기 해석은 도형의 `onResize`가 맡습니다.

- 스냅은 화면 기준 임계값, 느린 포인터, 포인트와 간격 두 종류, 두 번의 수집으로 이루어집니다.

**다음 장**: 기본 도형 13종과 도구들의 구현.
