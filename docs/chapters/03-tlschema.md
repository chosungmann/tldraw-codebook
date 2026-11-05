# 3장. 데이터 모델 — @tldraw/tlschema, @tldraw/validate

`@tldraw/tlschema`는 2장의 범용 스토어 위에 tldraw 문서가 무엇으로 이루어지는지를 정의합니다. 레코드 타입 11종(커스텀 타입 별도), 기본 도형 13종, 스타일, 마이그레이션, 무결성 규칙이 여기 있습니다. 에디터를 읽기 전에 "어떤 레코드가 어떤 필드를 갖는가"를 먼저 알아야 모든 동작이 레코드 조작으로 보이기 시작합니다.

## 3.1 createTLSchema: 모든 것의 조립점

`createTLSchema({ shapes, bindings, assets, user, records, migrations })`(`createTLSchema.ts`)가 하는 일입니다.

1.  모든 도형의 props에서 `StyleProp`을 찾아 ID별로 모읍니다. 같은 ID의 서로 다른 인스턴스가 있으면 예외입니다.

2.  `createShapeRecordType(shapes)`: `T.union('type', …)`으로 도형 타입별 검증기를 묶은 `shape` 레코드 타입을 만듭니다. 기본값은 x=0, y=0, rotation=0, isLocked=false, opacity=1, meta={}입니다.

3.  바인딩·에셋도 같은 방식으로 만듭니다.

4.  `createInstanceRecordType(stylesById)`: `instance.stylesForNextShape`가 모든 스타일을 검증할 수 있도록 스타일 목록을 넘깁니다.

5.  커스텀 레코드 타입(`records`)을 추가합니다. 내장 이름과 겹치면 예외입니다.

6.  모든 마이그레이션 시퀀스를 모아 `StoreSchema.create(..., { onValidationFailure, createIntegrityChecker })`를 호출합니다.

커스텀 도형을 추가하면 에디터가 ShapeUtil의 `props`와 `migrations`를 읽어 이 함수에 넘깁니다(4장). 그래서 커스텀 도형도 기본 도형과 완전히 같은 검증·마이그레이션 경로를 탑니다.

## 3.2 레코드 타입 전체 지도

| typeName            | scope    | ID 형식                        | 담는 것                                                                                     |
|---------------------|----------|--------------------------------|---------------------------------------------------------------------------------------------|
| document            | document | `document:document` (단일)     | 문서 이름, `gridSize`                                                                       |
| page                | document | `page:…`                       | 이름, `index`(페이지 순서)                                                                  |
| shape               | document | `shape:…`                      | 위치·회전·부모·순서·props                                                                   |
| binding             | document | `binding:…`                    | 두 도형 사이 관계(화살표 연결 등)                                                           |
| asset               | document | `asset:…`                      | 이미지·비디오·북마크 메타데이터와 src                                                       |
| user                | document | `user:…`                       | 이름, 색, 이미지 URL                                                                        |
| instance            | session  | `instance:instance` (단일)     | 현재 페이지, 다음 도형 스타일, 브러시, 커서, 도구 잠금, 포커스·펜·그리드 모드, 화면 크기 등 |
| instance_page_state | session  | `instance_page_state:<pageId>` | 페이지별 선택·호버·편집·크롭·지우기·힌트 도형, 포커스된 그룹                                |
| camera              | session  | `camera:<pageId>`              | 페이지별 x, y, z(줌)                                                                        |
| pointer             | session  | `pointer:pointer` (단일)       | 페이지 좌표의 포인터 위치                                                                   |
| instance_presence   | presence | `instance_presence:…`          | 다른 사용자에게 보낼 커서·선택·카메라·채팅                                                  |

설계에서 읽어야 할 점이 있습니다.

- **선택 상태는 문서가 아니라 세션입니다.** `selectedShapeIds`는 `instance_page_state`에 있어 저장·동기화되지 않습니다. 다른 사람에게는 presence로만 전달됩니다.

- **카메라와 페이지 상태는 페이지별입니다.** ID에 페이지 ID가 들어가므로 페이지를 오가도 각 페이지의 뷰가 보존됩니다.

- **단일 레코드**: `TLDOCUMENT_ID`, `TLINSTANCE_ID`, `TLPOINTER_ID`는 고정 ID입니다.

- 대부분의 레코드가 `meta: JsonObject`를 가집니다. 앱이 임의 데이터를 붙이는 공식 통로입니다.

- `instance.cameraState`('idle' \| 'moving')는 카메라가 움직이는 동안 렌더링 품질을 낮추는 데 쓰입니다(6장).

## 3.3 도형 레코드

```ts
// shapes/TLBaseShape.ts
export interface TLBaseShape<Type extends string, Props extends object> {
  readonly id: TLShapeId
  readonly typeName: 'shape'
  type: Type            // 'geo' | 'arrow' | ... | 커스텀
  x: number; y: number  // 부모 좌표계 기준 위치
  rotation: number      // 라디안, 부모 기준
  index: IndexKey       // 형제 사이 z-순서 (분수 인덱스)
  parentId: TLParentId  // 'page:…' 또는 'shape:…'
  isLocked: boolean
  opacity: TLOpacityType
  props: Props          // 도형별 데이터
  meta: JsonObject
}
```

- **좌표는 부모 기준입니다.** 그룹이나 프레임 안의 도형은 부모의 로컬 좌표를 갖습니다. 페이지 좌표는 에디터가 부모 체인의 변환 행렬을 곱해 계산합니다(6장).

- **크기는 공통 필드가 아닙니다.** `w`, `h`는 도형별 props입니다. 크기가 없는 도형(선, 화살표)도 있기 때문입니다. 경계는 항상 지오메트리에서 구합니다.

- `parentIdValidator`는 `page:` 또는 `shape:`로 시작하는지만 검사합니다. 실제 부모 존재 여부는 에디터의 사이드 이펙트가 보장합니다.

기본 도형 13종(`defaultShapeSchemas`): arrow, bookmark, draw, embed, frame, geo, group, highlight, image, line, note, text, video. 기본 바인딩은 arrow 하나, 기본 에셋은 image·video·bookmark입니다. 각 도형의 props는 `shapes/TL*Shape.ts`에 있고 10장에서 다룹니다.

## 3.4 분수 인덱스(Fractional Indexing)

도형의 z-순서와 페이지 순서는 정수가 아니라 **사전식으로 정렬되는 문자열 키**(`IndexKey`, 예: `a1`, `a1V`, `a2`)입니다. 두 키 사이에는 항상 새 키를 만들 수 있으므로, 도형 하나를 맨 앞으로 가져와도 다른 도형의 레코드를 건드리지 않습니다. 동시 편집에서 충돌이 줄어드는 핵심 이유입니다.

- 구현: `packages/utils/src/lib/fractionalIndexing.ts`. `fractional-indexing`과 `jittered-fractional-indexing` 패키지를 base-62 전용으로 다듬어 내장한 것입니다.

- **지터(jitter)**: `JITTER_BITS = 16`만큼 무작위 이분할을 더해, 두 클라이언트가 같은 틈에 동시에 삽입해도 같은 키가 나올 확률을 낮춥니다. 주석에 따르면 10명이 같은 위치에 동시 삽입해도 충돌률이 약 0.1% 미만입니다.

- API(`reordering.ts`): `getIndexBetween`, `getIndexAbove`, `getIndexBelow`, `getIndicesBetween`, `getIndices`, `sortByIndex`, `validateIndexKey`.

## 3.5 스타일: StyleProp

색, 채우기, 선 모양, 크기, 글꼴 같은 "여러 도형이 공유하는 속성"은 `StyleProp`입니다(`styles/StyleProp.ts`).

```ts
export const DefaultColorStyle = StyleProp.defineEnum('tldraw:color', {
  defaultValue: 'black', values: defaultColorNames,
})
// 도형 props 정의에서 검증기 자리에 그대로 넣는다
export const drawShapeProps = { color: DefaultColorStyle, fill: DefaultFillStyle, ... }
```

- `StyleProp`은 검증기(`T.Validatable`)를 구현하므로 props 정의에 직접 들어갑니다. `getShapePropKeysByStyle(props)`가 props를 훑어 "이 도형은 어느 키에 어떤 스타일을 쓰는가"를 역추적합니다.

- 이 역추적 덕분에 에디터는 선택된 서로 다른 종류의 도형들에서 공통 스타일을 모아 스타일 패널에 보여주고, 한 번에 바꿀 수 있습니다(12장).

- `instance.stylesForNextShape`는 스타일 ID를 키로 다음에 만들 도형의 스타일을 기억합니다.

- `EnumStyleProp`은 `addValues`/`removeValues`로 런타임에 값 목록을 바꿀 수 있습니다. 테마에 색을 추가·제거할 때 씁니다(`TLColorStyle.ts`).

- 기본 스타일 파일: `TLColorStyle`, `TLDashStyle`, `TLFillStyle`, `TLFontStyle`, `TLFontFace`, `TLSizeStyle`, `TLTextAlignStyle`, `TLHorizontalAlignStyle`, `TLVerticalAlignStyle`. 색의 실제 값은 `TLTheme.ts`의 테마 정의가 결정합니다.

## 3.6 특수 데이터 포맷

**리치 텍스트**(`misc/TLRichText.ts`): 텍스트·노트·도형 라벨은 일반 문자열이 아니라 TipTap/ProseMirror JSON(`{ type: 'doc', content: [...] }`)입니다. `toRichText(text)`가 평문을 변환합니다(11장).

**펜 획 압축**(`misc/b64Vecs.ts`): draw·highlight 도형은 점이 수천 개일 수 있어 JSON 배열로 두면 저장·동기화 비용이 큽니다. 그래서 `segments[].path`에 점들을 base64 문자열로 담습니다.

- 첫 점은 Float32, 이후 점은 이전 점과의 차이(delta)를 Float16으로 인코딩합니다.

- `dim`이 2면 (x, y)만, 3이면 필압 z까지 담습니다. 2D 경로를 디코딩할 때 필압은 0.5로 채웁니다.

- 디코딩 핫패스를 위해 base64 역조회 테이블, 2의 거듭제곱, Float16 가수부 테이블을 모두 미리 계산해 둡니다.

## 3.7 검증 라이브러리: @tldraw/validate

`T` 네임스페이스(`packages/validate/src/lib/validation.ts`, 파일 하나)는 zod와 비슷한 런타임 검증기입니다. 다만 에디터에 맞춘 두 가지 특징이 있습니다.

**첫째, 값을 변환하지 않습니다.** `Validator.validate`는 개발 모드에서 입력과 출력이 같은 참조인지 확인합니다. 검증은 통과/실패만 하고, 변환이 필요하면 `refine`을 씁니다.

**둘째, "알려진 좋은 버전" 기반 증분 검증입니다.** `validateUsingKnownGoodVersion(prev, next)`는 이미 검증된 이전 값과 비교해 바뀐 부분만 검사합니다.

```ts
// ObjectValidator의 증분 경로 (요약)
for (const key of configKeys) {
  const prev = knownGood[key], next = newValue[key]
  if (Object.is(prev, next)) continue            // 같은 참조면 검사 생략
  const checked = validator.validateUsingKnownGoodVersion?.(prev, next) ?? validator.validate(next)
  if (!Object.is(checked, prev)) isDifferent = true
}
if (!isDifferent) return knownGoodValue           // 내용이 같으면 이전 참조를 반환
```

마지막 줄이 중요합니다. 내용이 똑같은 새 객체로 `put`하면 검증기가 이전 참조를 돌려주고, 스토어는 `validated === initialValue`를 보고 변경을 건너뜁니다(2장 2.4절). 그래서 드래그 중 변화 없는 업데이트가 diff도, 재렌더도 만들지 않습니다. 배열·dict·union 검증기도 같은 증분 경로를 갖습니다.

제공되는 검증기입니다.

- 원시값: `string`, `number`, `positiveNumber`, `nonZeroNumber`, `unitInterval`, `integer`, `positiveInteger`, `boolean`, `bigint`, `literal`, `literalEnum`, `setEnum`

- 구조: `object`, `arrayOf`, `dict`, `jsonValue`, `jsonDict`, `union(판별키, {...})`, `numberUnion`, `model(name, v)`, `or`

- 수식어: `.optional()`, `.nullable()`, `.refine()`, `.check()`

- 도메인: `indexKey`, `linkUrl`, `srcUrl`, `httpUrl`(URL은 허용 프로토콜을 검사합니다)

`ValidationError`는 실패한 경로를 붙여(`rethrowPrefixed`) `shape.props.color` 같은 위치를 알려줍니다.

## 3.8 마이그레이션 구성

- 레코드 타입별 시퀀스: `com.tldraw.store`, `com.tldraw.shape`, `com.tldraw.instance` 등.

- 도형·바인딩·에셋의 하위 타입별 props 시퀀스: `com.tldraw.shape.geo`, `com.tldraw.binding.arrow`처럼 `com.tldraw.<typeName>.<subType>` 형식입니다(`processPropsMigrations`). 이 시퀀스는 `retroactive: true`라서 저장된 스키마에 없던 커스텀 도형도 전체 마이그레이션을 받습니다.

- 커스텀 도형은 `createShapePropsMigrationIds`와 `createShapePropsMigrationSequence`로 만듭니다. 예전 방식(`migrators` 버전 맵)도 자동 변환됩니다.

- `store-migrations.ts`는 `store` scope 마이그레이션입니다. 스토어 단위로 레코드를 정리하는 변환이 여기 모입니다.

## 3.9 무결성 검사와 검증 실패 처리

`TLStore.ts`의 `createIntegrityChecker`는 스토어가 항상 "사용 가능한" 상태가 되도록 고칩니다. 하나를 고칠 때마다 재귀 호출로 처음부터 다시 검사합니다.

1.  document·pointer 레코드가 없으면 만듭니다.

2.  페이지가 하나도 없으면 기본 페이지를 만듭니다.

3.  instance가 없거나 `currentPageId`가 없는 페이지를 가리키면 첫 페이지로 고칩니다.

4.  페이지마다 `instance_page_state`와 `camera`가 없으면 만듭니다.

5.  페이지 상태가 가리키는 크롭·포커스 그룹·호버·선택 도형이 사라졌으면 지웁니다.

동기화로 다른 사람이 내가 선택한 도형을 지우거나 페이지를 없애도 화면이 깨지지 않는 이유가 이것입니다(`mergeRemoteChanges` 끝에서 호출). `onValidationFailure`는 검증 실패 시 레코드와 단계 정보를 담은 오류를 만듭니다.

## 3.10 Presence 파생

`createPresenceStateDerivation($user)`는 로컬 세션 레코드(instance, 현재 페이지의 page state·camera, pointer)와 사용자 정보를 읽어 `instance_presence` 레코드를 만드는 Computed를 돌려줍니다. 동기화 클라이언트는 이 Computed가 바뀔 때마다 presence를 서버로 보냅니다(15장). `getUserPresence` 옵션으로 보낼 내용을 바꿀 수 있습니다.

## 3.11 그 밖의 레코드

- **커스텀 레코드**(`TLCustomRecord.ts`): `createTLSchema({ records: { myType: { scope, validator, migrations } } })`로 앱 고유 레코드를 스토어에 넣어 같은 저장·동기화를 받습니다.

- **댓글**(`TLComment.ts`): `comment-thread` 등 댓글용 커스텀 레코드 정의입니다. 앵커는 shape / point / region / page 네 종류입니다. `@tldraw/commenting` 패키지가 사용합니다(17장).

## 3.12 이 장의 핵심 정리

- 문서(document scope)는 document·page·shape·binding·asset·user입니다. 선택·카메라·포인터는 세션 상태입니다.

- 도형은 부모 기준 좌표와 분수 인덱스를 갖고, 크기는 props에 있습니다.

- 스타일은 검증기이자 식별자이므로 도형 종류를 넘어 공통 스타일을 다룹니다.

- 검증은 이전 값 기반 증분 방식이며, 내용이 같으면 이전 참조를 돌려줘 무의미한 변경을 없앱니다.

- 무결성 검사기가 현재 페이지, 페이지별 카메라·상태, 끊긴 참조를 항상 복구합니다.

**다음 장**: 이 레코드들을 다루는 중심 객체 `Editor`.
