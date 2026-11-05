# 10장. 기본 도형과 도구

`tldraw` 패키지는 `@tldraw/editor` 위에 기본 도형 12종(그룹은 코어에 있음), 도형 도구 8종, 일반 도구 5종을 올립니다(`defaultShapeUtils.ts`, `defaultShapeTools.ts`, `defaultTools.ts`). 모두 7장의 ShapeUtil과 5장의 StateNode를 그대로 쓰는 "참조 구현"이므로, 커스텀 도형을 만들 때 가장 좋은 교재입니다. 코드는 `packages/tldraw/src/lib/shapes/`와 `tools/`에 있습니다.

## 10.1 한눈에 보기

| 도형      | 핵심 props                                   | 지오메트리                | 눈여겨볼 구현                     |
|-----------|----------------------------------------------|---------------------------|-----------------------------------|
| geo       | geo(20종), w, h, growY, richText, fill, dash | 모양별 다각형·타원 + 라벨 | 텍스트가 넘치면 growY로 자동 확장 |
| draw      | segments(base64 점), isComplete, isPen       | 펜 획 경로                | 필압 기반 획 외곽선(freehand)     |
| highlight | draw와 동일                                  | 획 경로                   | 다른 도형 밑 반투명 레이어        |
| text      | richText, w, autoSize, scale                 | 측정된 텍스트 상자        | 자동 폭 vs 고정 폭                |
| note      | richText, growY, fontSizeAdjustment, scale   | 고정 크기 사각형          | 인접 노트 복제(clone 핸들)        |
| line      | points(사전), spline                         | 선분·큐빅 스플라인        | 점별 분수 인덱스                  |
| arrow     | 8장 참조                                     | 선 + 라벨                 | 바인딩 기반 파생 경로             |
| frame     | w, h, name                                   | 사각형 + 이름 라벨        | 클리핑, 자식 받기(7.7절)          |
| image     | w, h, assetId, crop, flipX/Y, altText        | 사각형                    | 크롭, 투명 픽셀 히트 제외         |
| video     | w, h, assetId, time, playing, autoplay       | 사각형                    | 에셋 해석·재생 상태               |
| embed     | w, h, url                                    | 사각형                    | iframe, 18개 서비스 정의          |
| bookmark  | w, h, url, assetId                           | 사각형                    | URL 메타데이터 카드               |

공통 인프라는 `shapes/shared/`에 있습니다. 캐시 히트가 되기 쉬운 `PathBuilder`(SVG 경로와 지오메트리를 한 번에 만듬), 손그림 느낌의 대시(`getPerfectDashProps`), 채우기 패턴(`PatternFill`), 리치 텍스트 라벨(`RichTextLabel`), 편집 훅(`useEditableRichText`), 크롭(`crop.ts`), 뒤집기(`flip.ts`), props 보간(`interpolate-props.ts`), 테마 기반 표시값(`getDisplayValues`)입니다.

## 10.2 geo: 모양과 라벨

- `GeoShapeGeoStyle`은 스타일 속성입니다. cloud, rectangle, ellipse, triangle, diamond, pentagon, hexagon, octagon, star, rhombus, rhombus-2, oval, trapezoid, 화살표 4종, x-box, check-box, heart의 20개 값이 있습니다. 스타일이므로 도구바에서 모양을 바꾸면 "다음 도형 스타일"로 기억됩니다.

- 경로는 `getGeoShapePath.ts`가 `PathBuilder`로 만듭니다. 구름은 도형 ID를 시드로 한 무작위 호를 써서 같은 도형은 항상 같은 모양입니다. dash가 `draw`면 손그림 흔들림을 넣습니다.

- **growY**: `onBeforeCreate`/`onBeforeUpdate`에서 라벨 텍스트·글꼴·크기가 바뀌면 라벨 높이를 측정해, 도형 h보다 크면 모자란 만큼 `growY`를 늘립니다. 사용자가 정한 h는 그대로 두고 렌더 높이만 `h + growY`로 바뀝니다. 텍스트를 지우면 다시 0입니다.

- 채우기가 없는 geo에 텍스트가 있으면 라벨 영역도 히트 대상입니다(7.4절).

- 도구(`GeoShapeTool`)는 5.7절의 "만들고 select.resizing으로 넘기기" 패턴입니다. 드래그 없이 클릭만 하면 기본 크기로 만듭니다.

## 10.3 draw와 highlight: 펜 획

**입력**(`draw/toolStates/Drawing.ts`):

- 펜·스타일러스는 필압 z를 씁니다. 마우스면 필압을 0.5로 두고 점을 2D(`dim: 2`)로 저장해 데이터를 줄입니다.

- **세그먼트 모드**: 획은 `free`와 `straight` 세그먼트의 배열입니다. Shift를 누르면 직선 세그먼트가 시작되고, 떼면 다시 자유선입니다. 이전 획이 있는 상태에서 Shift+클릭하면 마지막 점에서 이어지는 직선을 더합니다.

- 점이 `maxPointsPerShape`(기본 600)를 넘으면 현재 도형을 `isComplete: true`로 닫고 새 도형을 이어 그립니다. 한 레코드가 너무 커져 동기화·렌더가 느려지는 것을 막기 위함입니다.

- 점은 3장의 `b64Vecs`로 인코딩되어 `segments[].path`에 들어갑니다.

**렌더링**(`shapes/shared/freehand/`): `getStroke(points, options)`는 perfect-freehand 계열 알고리즘입니다. 점들을 수집·평활화하고(`getStrokePoints`), 필압과 속도로 각 점의 반지름을 계산한 뒤, 양쪽 외곽선을 따라 닫힌 다각형(`getStrokeOutlinePoints`)을 만듭니다. 다각형을 채우면 두께가 변하는 획이 됩니다. 완성되지 않은 획은 끝을 닫지 않아 그리는 동안 끝이 가늘어지지 않습니다. dash 스타일이 있으면 외곽선 대신 중심선에 대시를 적용합니다.

**highlight**는 같은 입력 구현을 공유하지만, 혼합 모드와 `underlayOpacity`로 밑에 깔리는 반투명 레이어를 함께 그려 형광펜 느낌을 냅니다.

## 10.4 text

- **autoSize**(기본): 폭이 내용에 맞춰 늘어납니다. 사용자가 좌우 핸들로 폭을 바꾸면 `autoSize: false`가 되어 고정 폭에서 줄바꿈합니다. 모서리 핸들은 `scale`을 바꿉니다.

- 크기는 `getTextSize`가 Editor의 `textMeasure`(숨은 DOM, 11장)로 측정합니다. `onBeforeUpdate`에서 autoSize 텍스트가 바뀌면 새 크기를 구하고, 정렬에 따라 x를 보정해 왼쪽·가운데·오른쪽 기준점을 유지합니다.

- 더블클릭으로 `EditingShape` 상태에 들어가 TipTap 에디터가 열립니다. 편집을 끝냈을 때 비어 있으면 도형을 지웁니다.

- `options.createTextOnCanvasDoubleClick`이 켜져 있으면 빈 캔버스 더블클릭으로 텍스트를 만듭니다.

## 10.5 note: 스티키 노트

- 크기는 고정(기본 200×200 × scale)이고, 텍스트가 넘치면 geo처럼 `growY`로 아래로 길어집니다. 더 넘치면 `fontSizeAdjustment`로 글자를 줄입니다.

- **clone 핸들**: 선택된 노트 네 방향에 + 핸들(`type: 'clone'`)이 있습니다. 누르면 `getNoteShapeForAdjacentPosition`이 인접 위치에 새 노트를 만들거나 이미 있으면 그것을 선택합니다. 노트를 편집하는 중에는 Tab(Shift면 반대 방향, RTL 텍스트면 뒤집힘)이 가로로, Cmd/Ctrl+Enter가 세로로 인접 노트를 만들고 그쪽으로 편집을 이어갑니다. 리스트 항목 안에서는 Tab이 들여쓰기입니다.

- 이동할 때 주변 노트의 인접 위치(pit)에 끌려 들어가는 동작은 9.2절에서 봤습니다.

- `textLastEditedBy`는 마지막 편집자를 기록해 저자 표시(attribution)에 씁니다.

## 10.6 line: 동시 편집을 고려한 점 저장

```ts
interface TLLineShapePoint { id: string; index: IndexKey; x: number; y: number }
points: Record<string, TLLineShapePoint>   // 배열이 아닌 사전
```

점을 배열이 아닌 **ID→점 사전 + 분수 인덱스**로 저장합니다. 두 사람이 같은 선에 동시에 점을 추가해도 배열 인덱스 충돌 없이 두 점이 모두 살아남고, 15장의 객체 단위 diff 패치와도 잘 맞습니다. `spline`은 `'line'`(꺾인 선) 또는 `'cubic'`(부드러운 곡선)입니다. 핸들은 각 점(`vertex`)과 점 사이 중간점(`virtual`, 끌면 새 점 생성)이며, `props` 참조를 키로 한 캐시에 저장됩니다.

## 10.7 frame, image, video, embed, bookmark

- **frame**: `BaseFrameLikeShapeUtil` 기반(7.7절). 이름 라벨은 상단 바깥에 그려지고 더블클릭으로 편집합니다. 내보내기에서는 `isExportBoundsContainer`로 프레임 경계가 내보내기 영역이 됩니다.

- **image**: `assetId`로 에셋 레코드를 참조하고, `useImageOrVideoAsset`가 현재 줌과 DPR에 맞는 URL을 에셋 스토어에서 해석합니다(13장). `crop`은 정규화된 `{ topLeft, bottomRight }`로, 더블클릭하면 select의 Crop 상태에서 편집합니다. 뒤집기는 이미지를 자르지 않고 `flipX`/`flipY`로 표현합니다. 투명 픽셀 클릭은 지오메트리의 `ignoreHit`로 통과시킵니다. GIF는 `playing`으로 재생을 제어합니다.

- **video**: 에셋 해석은 이미지와 같고, 재생 위치·상태를 props에 둡니다.

- **embed**: `defaultEmbedDefinitions.ts`에 tldraw, Figma, Canva, Google Maps, Val Town, CodeSandbox, CodePen, Scratch, YouTube, Google Calendar, Google Slides, GitHub Gist, Replit, Felt, Spotify, Vimeo, Observable, Desmos의 18개 정의가 있습니다. 각 정의는 일반 URL과 임베드 URL 사이 변환 함수, 기본 크기, iframe 권한을 가집니다. 붙여넣은 URL이 매칭되면 북마크 대신 임베드가 됩니다. 카메라 이동·선택 중에는 iframe이 이벤트를 삼키지 않도록 막고, 편집 모드에서만 상호작용을 허용합니다.

- **bookmark**: URL과, 제목·설명·이미지·파비콘을 담은 bookmark 에셋을 참조합니다. 메타데이터는 외부 콘텐츠 핸들러가 가져옵니다(13장).

## 10.8 일반 도구

| 도구   | 자식 상태                                    | 동작                                                                                               |
|--------|----------------------------------------------|----------------------------------------------------------------------------------------------------|
| select | 18개(5.6절)                                  | 선택·변형·편집의 중심                                                                              |
| hand   | idle, pointing, dragging, one_finger_zooming | 드래그로 패닝, 놓으면 관성 슬라이드. 더블·트리플 클릭으로 줌                                       |
| eraser | idle, pointing, erasing                      | 낙서 경로와 닿은 도형을 `setErasingShapes`로 표시(불투명도 0.32), 놓으면 삭제. Esc면 마크로 되돌림 |
| laser  | idle, lasering                               | 사라지는 낙서. 문서를 바꾸지 않고 협업자에게는 presence의 scribbles로 보임                         |
| zoom   | idle, pointing, zoom_brushing, zoom_quick    | 클릭 줌인(Alt 줌아웃), 드래그 영역으로 줌                                                          |

**ScribbleManager**(`editor/managers/ScribbleManager/`)는 낙서의 수명을 관리합니다. 점을 추가하고, tick마다 오래된 점을 줄여 꼬리가 사라지게 하며, 완료 후 페이드아웃합니다. 레이저는 여러 획을 하나의 세션으로 묶어 `laserDelayMs` 동안 유지했다가 `laserFadeoutMs`에 걸쳐 사라집니다. 현재 낙서는 `instance.scribbles`에 있고 presence로 동기화됩니다.

**도구 잠금**: `instance.isToolLocked`가 켜져 있으면 도형을 만든 뒤 select로 돌아가지 않고 같은 도구에 머물러 연속으로 그릴 수 있습니다(`isLockable` 도구만).

## 10.9 이 장의 핵심 정리

- 기본 도형은 모두 ShapeUtil + StateNode 조합이며 커스텀 도형과 다른 특권을 쓰지 않습니다.

- 텍스트가 있는 도형(geo, note, text)은 `onBeforeCreate/Update`에서 측정으로 크기를 자동 조정합니다.

- 펜 획은 압축된 점 + 필압 기반 외곽선 알고리즘이며, 한 도형의 점 수에 상한이 있습니다.

- line의 사전+분수 인덱스 점 구조처럼, 데이터 모양 자체가 동시 편집을 고려해 설계되어 있습니다.

**다음 장**: 텍스트 측정, 리치 텍스트 편집, 폰트.
