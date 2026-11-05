# 4장. Editor 해부 — 생성, 매니저, 트랜잭션, 히스토리

`Editor`(`packages/editor/src/lib/editor/Editor.ts`, 약 11,800줄)는 tldraw의 두뇌입니다. 스토어를 소유하고, 도형·바인딩 유틸과 도구 상태 차트를 들고 있으며, 수많은 파생 캐시와 매니저를 통해 "무엇을 그리고 어떻게 반응할지"를 결정합니다. 이 장은 Editor의 뼈대를 다루고, 입력·카메라·도형 같은 세부 주제는 5–10장에서 이어집니다.

## 4.1 Editor는 상태를 갖지 않는다

Editor의 거의 모든 상태는 **스토어의 레코드**입니다. 현재 페이지는 `instance.currentPageId`, 선택은 `instance_page_state.selectedShapeIds`, 줌은 `camera.z`입니다. Editor 메서드의 대부분은 두 가지 중 하나입니다.

- **읽기(파생)**: `getSelectedShapeIds()`, `getShapePageBounds(id)`, `getViewportPageBounds()` 등. 대부분 `@computed`이거나 `createComputedCache` 기반이라 반응형이며 캐시됩니다.

- **쓰기(커맨드)**: `createShapes`, `updateShapes`, `setSelectedShapes`, `setCamera` 등. 결국 `store.put`/`store.remove`로 이어집니다.

예외는 몇 가지뿐입니다. 도구 상태 차트의 현재 경로(StateNode의 Atom), 입력 상태(`InputsManager`), 카메라 옵션 같은 메모리 전용 Atom이 있습니다. 이 설계 덕분에 undo/redo, 저장, 동기화가 모두 "레코드 diff"라는 하나의 메커니즘으로 해결됩니다.

Editor.ts는 주석 헤더로 구역이 나뉘어 있어 지도처럼 쓸 수 있습니다.

| 구역(헤더)                                | 대략 줄 | 내용                                         |
|-------------------------------------------|---------|----------------------------------------------|
| Shape Utils / Binding Utils / Asset Utils | 1403–   | 유틸 조회                                    |
| History                                   | 1555–   | undo/redo, 마크, `run`                       |
| Statechart                                | 1854–   | `isIn`, `setCurrentTool`, `getPath`          |
| Instance State / Page State               | 2006–   | 선택, 편집, 호버, 포커스 그룹                |
| Camera                                    | 3146–   | 카메라, 뷰포트, 좌표 변환, 팔로우            |
| Pages / Assets                            | 4889–   | 페이지·에셋 CRUD                             |
| Shapes                                    | 5354–   | 지오메트리·변환·마스크·히트 테스트·부모 관계 |
| Bindings                                  | 6742–   | 바인딩 조회·CRUD                             |
| Commands                                  | 6981–   | 회전·정렬·복제·그룹·리사이즈·생성·삭제       |
| Styles                                    | 9196–   | 공유 스타일, 다음 도형 스타일                |
| Content                                   | 9427–   | 붙여넣기·외부 콘텐츠·내보내기                |
| Events                                    | 10284–  | `dispatch`, 이벤트 처리 파이프라인           |

## 4.2 생성자: 무엇을 어떤 순서로 조립하나

`new Editor({ store, shapeUtils, bindingUtils, assetUtils, overlayUtils, tools, getContainer, user, initialState, cameraOptions, options, themes, i18n, ... })`의 순서입니다(359–1015행).

1.  **옵션 병합**: `this.options = { ...defaultTldrawOptions, ...options }`. 더블클릭 시간, 드래그 거리, 히트 마진, 페이지당 최대 도형 수 등 수십 개의 상수가 `options.ts`에 있습니다.

2.  **HistoryManager** 생성(4.5절).

3.  **매니저 생성**: SnapManager, SpatialIndexManager, UserPreferencesManager, TextManager, ThemeManager, TickManager, FontManager, InputsManager, PerformanceManager, CollaboratorsManager. 대부분 `dispose`를 `this.disposables`에 등록합니다.

4.  **루트 상태**: `RootState`를 상속해 `initial`을 주입한 `NewRoot`를 만듭니다.

5.  **ShapeUtil 인스턴스화**: `checkShapesAndAddCore`가 group 같은 필수 도형을 더합니다. 각 유틸의 props에서 StyleProp 매핑(`styleProps[type]`)을 모으고, 스타일 ID 충돌을 검사합니다. `handledAssetTypes`로 "이 에셋 타입을 처리하는 도형" 맵도 만듭니다.

6.  **BindingUtil, AssetUtil 인스턴스화**.

7.  **도구 등록**: 각 도구 클래스를 `root.children[Tool.id]`에 인스턴스로 넣습니다.

8.  **ScribbleManager, OverlayManager** 생성 후 오버레이 유틸 등록.

9.  **사이드 이펙트 등록**(4.6절).

10. **파생 인덱스**: `deriveShapeIdsInCurrentPage`, `parentsToChildren`.

11. `store.listen` → `emit('change')`.

12. `run(() => { store.ensureStoreIsUsable(); 편집·호버·지우기 상태 초기화 }, { history: 'ignore' })`.

13. `root.enter(undefined, 'initial')`: 초기 도구(보통 select)로 진입.

14. EdgeScrollManager, FocusManager 생성. 저장된 팔로우 상태는 해제합니다.

15. `on('tick', _flushEventsForTick)`, 다음 애니메이션 프레임에 `TickManager.start()`.

16. 협업 모드가 있으면 `readonly` 신호를 `instance.isReadonly`에 반영하고, 현재 사용자 신호를 `user` 레코드로 동기화합니다.

## 4.3 매니저 목록

| 매니저                 | 역할                                          | 자세히 |
|------------------------|-----------------------------------------------|--------|
| HistoryManager         | undo/redo 스택, 마크, 배치                    | 4.5절  |
| InputsManager          | 포인터 위치·속도, 보조키, 드래그 여부         | 5장    |
| ClickManager           | 더블·트리플·쿼드러플 클릭 판별                | 5장    |
| TickManager            | rAF 루프로 `tick`·`frame` 이벤트 발생         | 5장    |
| FocusManager           | 컨테이너 포커스와 `instance.isFocused` 동기화 | 5장    |
| EdgeScrollManager      | 화면 가장자리 드래그 시 자동 스크롤           | 6장    |
| SpatialIndexManager    | rbush R-tree로 도형 경계 색인, 증분 갱신      | 6장    |
| SnapManager            | 경계·핸들 스냅(BoundsSnaps, HandleSnaps)      | 9장    |
| ScribbleManager        | 레이저·지우개·올가미 선택의 낙서 자취         | 10장   |
| TextManager            | 숨은 DOM으로 텍스트 크기 측정                 | 11장   |
| FontManager            | 도형이 쓰는 폰트 추적·로드                    | 11장   |
| ThemeManager           | 테마 목록과 현재 테마                         | 12장   |
| UserPreferencesManager | 사용자 설정, 시스템 다크모드·모션 감소        | 12장   |
| OverlayManager         | 캔버스 위 오버레이(인디케이터 등) 유틸        | 6장    |
| CollaboratorsManager   | 협업자 presence의 활성·유휴·비활성 판정       | 16장   |
| PerformanceManager     | 상호작용·undo 등 성능 측정 이벤트             | 6장    |

일부 매니저는 `EditorManager` 기반 클래스를 상속해 `addEditorEvent`로 에디터 이벤트 구독과 해제를 일관되게 관리합니다.

## 4.4 run(): 모든 변경의 단위

```ts
run(fn: () => void, opts?: TLEditorRunOptions): this {
  const prev = this._shouldIgnoreShapeLock
  this._shouldIgnoreShapeLock = opts?.ignoreShapeLock ?? prev
  try { this.history.batch(fn, opts) } finally { this._shouldIgnoreShapeLock = prev }
  return this
}
```

`run`은 `HistoryManager.batch`로, `batch`는 1장의 `transact`로 이어집니다. 그래서 `run` 안의 모든 변경은 다음을 보장받습니다.

- **반응 전파는 한 번**: Effect와 React 리렌더가 중간 상태를 보지 않습니다.

- **예외 시 롤백**: 트랜잭션 abort로 Atom들이 원래 값으로 돌아갑니다.

- **히스토리 모드 제어**: `{ history: 'record' | 'record-preserveRedoStack' | 'ignore' }`.

- **잠금 무시**: `{ ignoreShapeLock: true }`면 잠긴 도형도 수정합니다.

`createShapes`, `updateShapes`, `deleteShapes` 등 거의 모든 커맨드가 내부에서 `this.run(...)`을 호출합니다. `run`은 중첩되면 바깥 트랜잭션에 합류합니다.

## 4.5 HistoryManager: undo/redo의 구현

`HistoryManager`(`managers/HistoryManager/HistoryManager.ts`)는 스토어 diff를 가로채 두 개의 불변 연결 리스트 스택(`undos`, `redos`)에 쌓습니다. 스택 엔트리는 두 종류입니다.

- `{ type: 'diff', diff }`: 변경 내용.

- `{ type: 'stop', id }`: 마크(중단점). `editor.markHistoryStoppingPoint(name)`이 `[name]_고유ID` 형식으로 만듭니다.

**기록**: 생성자에서 `store.addHistoryInterceptor((entry, source) => ...)`를 등록합니다. `source === 'user'`인 변경만 받으므로 **원격 변경은 내 undo 스택에 들어가지 않습니다.** 상태에 따라 동작이 다릅니다.

| 상태                                  | 동작                                    |
|---------------------------------------|-----------------------------------------|
| Recording (`history: 'record'`, 기본) | `pendingDiff`에 합치고 redo 스택을 비움 |
| RecordingPreserveRedoStack            | `pendingDiff`에 합치되 redo는 유지      |
| Paused (`history: 'ignore'`)          | 기록하지 않음                           |

**묶기**: 변경은 즉시 스택에 오르지 않고 `pendingDiff`에 계속 합쳐집니다. 다음 마크가 찍힐 때(`_mark`) `flushPendingDiff()`로 하나의 diff 엔트리가 됩니다. 그래서 드래그 한 번에 수백 번의 `updateShapes`가 있어도 undo는 한 번입니다.

**undo** (`_undo`):

1.  상태를 Paused로 바꾸고 `_isReplaying = true`.

2.  `pendingDiff`를 꺼내 반전(`reverseRecordsDiff`)합니다. 비어 있지 않으면 redo에 넣습니다.

3.  pending이 비었다면 스택 위의 연속된 마크들을 먼저 걷어냅니다.

4.  다음 마크를 만날 때까지 diff를 pop하며 반전 diff를 누적(`squashRecordDiffsMutable`)합니다.

5.  `store.applyDiff(diffToUndo, { ignoreEphemeralKeys: true })` 후 `ensureStoreIsUsable()`.

**redo**는 대칭입니다. redo 스택에서 마크를 건너뛰고 다음 마크까지 diff를 합쳐 적용합니다.

인터랙션에서 자주 쓰는 고급 연산이 있습니다.

- `bail()`: redo에 남기지 않는 undo. 취소된 인터랙션을 흔적 없이 되돌릴 때 씁니다.

- `bailToMark(id)`: 특정 마크까지 되돌립니다. 예를 들어 드래그 중 Esc를 누르면 시작 마크로 돌아갑니다.

- `squashToMark(id)`: 마크 이후 diff를 하나로 합칩니다.

- `editor.undo()`/`redo()`는 먼저 `_flushEventsForTick(0)`과 `complete()`를 호출해 진행 중인 인터랙션을 끝낸 뒤 되돌립니다.

**왜 `ignoreEphemeralKeys`인가**: 도형에는 동기화·되돌리기를 하지 않을 임시 키가 있을 수 있고, undo가 이를 과거 값으로 덮어쓰면 안 됩니다. 또한 세션 레코드(선택 등)도 같은 diff에 들어가므로, undo 때 선택 상태도 되돌아갑니다. 필요하면 `history: 'ignore'`로 기록에서 빼냅니다.

## 4.6 사이드 이펙트로 지키는 불변식

Editor 생성자는 2장의 `StoreSideEffects`에 다음 규칙을 등록합니다. 누가 어떤 경로(로컬 커맨드, undo, 원격 동기화)로 스토어를 바꿔도 적용됩니다.

| 레코드              | 시점                              | 하는 일                                                                                                                                                          |
|---------------------|-----------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| shape               | afterCreate                       | 부모가 도형이면 `invalidParents`에 추가                                                                                                                          |
| shape               | afterChange                       | 관련 바인딩의 `onAfterChangeFromShape/ToShape` 호출. 부모가 바뀌면 자손의 바인딩에 `reason: 'ancestry'`로 통보. 다른 페이지로 옮겨지면 다른 페이지 상태에서 제거 |
| shape               | beforeDelete                      | 연결된 바인딩을 `onBeforeIsolate*`/`onBeforeDelete*` 후 삭제                                                                                                     |
| binding             | before/after Create·Change·Delete | 해당 BindingUtil의 훅 호출                                                                                                                                       |
| page                | afterCreate                       | 그 페이지의 camera·instance_page_state 생성                                                                                                                      |
| page                | afterDelete                       | 현재 페이지였으면 다른 페이지로 이동, camera·page state 삭제                                                                                                     |
| instance            | afterChange                       | `currentPageId`가 없는 페이지면 복구                                                                                                                             |
| instance_page_state | afterChange                       | 조상과 자손이 함께 선택되면 자손 제거, 선택의 공통 그룹 조상을 `focusedGroupId`로 설정                                                                           |

`registerOperationCompleteHandler`에서 모아 둔 작업을 한 번에 처리합니다.

1.  삭제된 도형을 모든 페이지 상태의 선택·호버·편집·크롭·힌트·포커스 그룹에서 제거합니다(`cleanupInstancePageState`).

2.  `invalidParents`의 각 부모에 `ShapeUtil.onChildrenChange(parent)`를 호출합니다. 그룹이 자식을 잃으면 스스로 사라지는 동작이 여기서 나옵니다(7장).

3.  변경된 바인딩 타입마다 `BindingUtil.onOperationComplete()`를 호출합니다.

4.  `emit('update')`.

사이드 이펙트로 구현하면 동기화로 들어온 원격 변경에도 같은 규칙이 적용됩니다. 다른 사람이 그룹에서 마지막 도형을 빼도 내 화면의 그룹이 정리됩니다. 다만 핸들러가 만든 변경은 source가 `'user'`로 바뀌므로(2.6절) 서버로 다시 전송됩니다.

## 4.7 도형 CRUD의 실제 동작

**createShapes(partials)**:

1.  읽기 전용이면 무시. `maxShapesPerPage`를 넘으면 경고 후 중단.

2.  **부모 결정**: `parentId`가 없거나 존재하지 않으면 포커스된 그룹(없으면 현재 페이지)을 기본으로 합니다. x·y가 지정되었으면 z-순서 위쪽부터 그 점을 포함하고 `canReceiveNewChildrenOfType`가 true인 도형(예: 프레임)을 찾아 부모로 삼고, 좌표와 회전을 부모 공간으로 변환합니다. 주석에는 "프레임을 만든 뒤 도형을 만들면 자동으로 프레임의 자식이 되는 이유가 여기"라고 적혀 있습니다.

3.  **인덱스**: 지정이 없으면 부모의 가장 높은 인덱스 위로 `getIndexAbove`를 이어 붙입니다.

4.  **props**: `util.getDefaultProps()` 위에 `getStyleForNextShape(style)`로 현재 스타일을 덮고, 마지막으로 partial의 props를 덮습니다. opacity는 `opacityForNextShape`.

5.  `util.onBeforeCreate(shape)` 훅, `getInitialMetaForShape`로 meta 초기화.

6.  `emit('created-shapes')`, `emit('edit')`, `store.put(...)`.

**updateShapes(partials)**: 잠긴 도형(또는 잠긴 조상을 가진 도형)은 `isLocked: false`로 풀어주는 partial이 아니면 걸러냅니다. 그 뒤 `_updateShapes`가 `applyPartialToRecordWithProps`로 partial을 얽게 합치고(props는 한 단계 더 병합), 변화가 없으면 건너뛰며, `util.onBeforeUpdate(prev, next)` 훅을 거쳐 `store.put`합니다.

**deleteShapes(ids)**: 잠금을 거르고 모든 자손을 `visitDescendants`로 모아 `store.remove` 합니다. 바인딩 정리와 선택 해제는 사이드 이펙트가 합니다.

## 4.8 파생 캐시의 계층

Editor의 읽기 메서드는 레코드별 `createComputedCache`(2.8절)로 계층을 이룹니다.

```ts
// 도형 내용(props, meta)이 같으면 재계산 안 함: x/y만 바뀌면 지오메트리 재사용
export function areShapesContentEqual(a, b) { return a.props === b.props && a.meta === b.meta }

getShapeGeometry(shape)      // util.getGeometry(shape) — areRecordsEqual: areShapesContentEqual
getShapeLocalTransform(shape) // Mat.translate(x, y).rotate(rotation)
_getShapePageTransformCache  // 부모 페이지 변환 × 로컬 변환 (재귀)
_getShapePageBoundsCache     // 페이지 변환을 geometry.boundsVertices에 적용 → Box
```

- 도형을 드래그하면 x·y만 바뀌므로 지오메트리는 재사용되고 변환·경계만 다시 계산됩니다.

- 부모를 움직이면 부모의 페이지 변환 Computed가 바뀌고, 자식의 변환이 그것에 의존하므로 자동으로 따라 갱신됩니다.

- 부모가 아직 없는 경우(원격 변경이 순서 없이 도착) 단위 행렬을 씁니다. 주석은 순서를 보존하는 갱신 메커니즘이 없어서라고 설명합니다.

- 지오메트리 캐시는 `context`별로 따로 둡니다. 같은 도형도 용도에 따라 다른 지오메트리를 돌려줄 수 있기 때문입니다. 캐시 안에서 `fonts.trackFontsForShape`를 호출해 폰트 로드 후 재측정하게 합니다.

- 같은 방식의 캐시: 핸들(`getShapeHandles`), 클립 패스, 마스크(`getShapeMask`), 마스크된 페이지 경계.

증분 파생 인덱스(`editor/derivations/`)도 있습니다.

| 파생                | 파일                       | 내용                                        |
|---------------------|----------------------------|---------------------------------------------|
| 현재 페이지 도형 ID | `shapeIdsInCurrentPage.ts` | 조상을 따라 올라가 페이지를 판정, 증분 갱신 |
| 부모→자식           | `parentsToChildren.ts`     | 부모별 자식 ID 목록(인덱스 정렬)            |
| 도형→바인딩         | `bindingsIndex.ts`         | fromId·toId 양쪽에서 바인딩 조회            |
| 보이지 않는 도형    | `notVisibleShapes.ts`      | 뷰포트 밖 도형(컬링, 6장)                   |

## 4.9 이벤트 발행

Editor는 `EventEmitter<TLEventMap>`입니다(`types/emit-types.ts`). 반응형 시그널과 별개로 외부 코드가 받을 수 있는 이벤트입니다.

- 생명주기: `mount`, `unmount`, `dispose`, `crash`

- 데이터: `change`(스토어 diff, 프레임 단위), `update`(오퍼레이션 완료), `created-shapes`, `edited-shapes`, `deleted-shapes`, `edit`

- 루프·입력: `tick`, `frame`, `before-event`, `event`, `resize`

- UI 신호: `select-all-text`, `place-caret`, `stop-camera-animation`, `stop-following`, `max-shapes`

## 4.10 React와의 연결: TldrawEditor

`<TldrawEditor>`(`TldrawEditor.tsx`)가 Editor를 만들고 렌더링합니다.

1.  `store` prop이 없으면 `createTLStore({ shapeUtils, bindingUtils, ... })`로 만듭니다. 이때 `createTLSchemaFromUtils`가 유틸의 props·migrations로 스키마를 만듭니다(3장). `persistenceKey`가 있으면 로컬 동기화 스토어를 씁니다(14장).

2.  `store`가 `TLStoreWithStatus`이면 상태에 따라 나눕니다. `loading`은 로딩 화면, `error`는 throw, `not-synced`·`synced-local`·`synced-remote`일 때 렌더합니다. 동기화 훅 `useSync`가 이 형태를 돌려줍니다(15장).

3.  `TldrawEditorWithReadyStore`가 `useLayoutEffect` 안에서 `new Editor({...})`를 호출합니다. 컨테이너가 DOM에 있어야 하기 때문입니다.

4.  `EditorProvider`로 컨텍스트를 내려주고 `<Canvas>`를 렌더합니다.

5.  `Layout`의 `useOnMount`가 `store.props.onMount(editor)`와 사용자 `onMount(editor)`를 호출합니다. 돌려준 함수는 언마운트 때 실행됩니다.

6.  언마운트 시 `editor.dispose()`가 `disposables`를 모두 실행합니다.

`@tldraw/editor`는 UI가 없는 "코어"이고, `tldraw` 패키지의 `<Tldraw>`는 기본 도형·도구·바인딩·UI를 채워서 `<TldrawEditor>`를 감싼 것입니다(12장).

## 4.11 이 장의 핵심 정리

- Editor는 스토어 레코드 위의 읽기(컴퓨티드)와 쓰기(커맨드)의 집합이며, 독자적 상태는 최소한입니다.

- `run`은 트랜잭션 + 히스토리 배치 + 잠금 제어의 묶음입니다.

- undo는 "사용자 변경 diff를 마크 단위로 묶어 두었다가 반전 적용"입니다. 원격 변경은 기록하지 않습니다.

- 부모–자식, 바인딩, 페이지 상태의 불변식은 사이드 이펙트가 모든 경로에서 지킵니다.

- 지오메트리→페이지 변환→페이지 경계는 레코드별 Computed 캐시 체인이며, 내용과 위치가 분리되어 있어 이동은 가볼습니다.

**다음 장**: 포인터 이벤트가 도구의 동작으로 바뀌는 과정 — 입력, 이벤트, 상태 차트.
