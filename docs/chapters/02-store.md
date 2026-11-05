# 2장. 레코드 저장소 — @tldraw/store

`Store`는 반응형 인메모리 레코드 데이터베이스입니다. 도형, 페이지, 카메라, 커서 위치까지 tldraw의 모든 영속·비영속 상태가 여기에 "레코드"로 저장되며, 모든 변경은 `RecordsDiff`로 기록됩니다. undo/redo, 지속성, 동시 편집이 모두 이 diff 하나로 굴러갑니다. 코드는 `packages/store/src/lib`(테스트 제외 약 7,700줄)에 있습니다.

## 2.1 레코드란

```ts
// BaseRecord.ts
export type RecordId<R> = string & { __type__: R }   // 브랜드 타입 ID
export interface BaseRecord<TypeName, Id> {
  readonly id: Id
  readonly typeName: TypeName
}
```

- 레코드는 `id`와 `typeName`을 가진 **불변 평면 JSON 객체**입니다. 개발 모드에서는 `devFreeze`로 깊은 동결을 해 실수로 변경하면 예외가 납니다.

- ID는 `"shape:abc123"`처럼 `typeName:고유부` 형식입니다. `RecordType.createId()`가 만들고 `parseId()`가 뒤를 구합니다.

- JSON이므로 그대로 직렬화해 IndexedDB나 네트워크로 보낼 수 있습니다. 이 단순함이 설계의 출발점입니다.

## 2.2 RecordType: 타입별 팩토리

`createRecordType<R>(typeName, { scope, validator, ephemeralKeys })`는 레코드 타입 객체를 만듭니다(`RecordType.ts`). 주요 기능은 이렇습니다.

- `create(props)`: `createDefaultProperties()`와 합치고 id가 없으면 생성. `withDefaultProperties()`로 기본값을 지정합니다.

- `isInstance`, `isId`, `clone`, `validate(record, recordBefore)`.

- **scope**: `'document' | 'session' | 'presence'`. 레코드의 생애를 결정하는 가장 중요한 속성입니다.

- **ephemeralKeys**: 동기화·저장하지 않을 속성 목록. `applyDiff(..., { ignoreEphemeralKeys: true })`가 이 키들을 건너뜁니다.

| scope    | 의미                                   | tldraw 예                                      |
|----------|----------------------------------------|------------------------------------------------|
| document | 문서에 속하고 저장·동기화됨            | shape, page, binding, asset, document          |
| session  | 이 인스턴스(탭)만의 상태, 동기화 안 함 | instance, camera, instance_page_state, pointer |
| presence | 다른 사용자에게 보내지만 저장하지 않음 | instance_presence                              |

`Store` 생성자는 스키마의 타입들을 이 세 범주로 나눠 `scopedTypes`에 보관하고, `serialize(scope)`·`listen({scope})`가 이를 사용합니다.

## 2.3 저장 구조: AtomMap

스토어의 본체는 `private readonly records: AtomMap<IdOf<R>, R>`입니다(`AtomMap.ts`).

- **레코드마다 Atom 하나**: `store:shape:abc` 같은 이름의 Atom이 레코드 값을 담습니다. 도형 A를 읽는 Computed는 A의 Atom에만 의존하므로 B가 바뀌어도 재계산되지 않습니다.

- **키 집합은 별도 Atom**: `atoms: Atom<ImmutableMap<K, Atom<V>>>`. 레코드가 추가·삭제될 때만 이 Atom이 바뀝니다. 값 갱신은 개별 Atom만 바꿉니다.

- **없는 키 읽기도 추적**: `getAtom(key)`는 키가 없으면 `this.atoms.get()`을 호출해 "키 집합"에 의존성을 겁니다. 나중에 그 ID가 생기면 읽었던 쪽이 다시 계산됩니다.

- **삭제**: 삭제된 레코드의 Atom에는 `UNINITIALIZED`를 넣어, 그 Atom을 붙잡고 있던 Computed가 삭제를 감지하게 합니다.

- `ImmutableMap.ts`(약 1,170줄)은 Immutable.js의 HAMT 맵을 떼어낸 것입니다. 구조 공유 덕분에 키 추가·삭제가 전체 복사 없이 O(log n)입니다.

## 2.4 쓰기 경로: put / remove / update

`put(records)`의 흐름(`Store.ts`)입니다.

1.  `atomic()` 안에서 실행합니다(2.6절).

2.  각 레코드에 대해 기존 값을 추적 없이 읽습니다.

3.  **있으면(갱신)**: `sideEffects.handleBeforeChange(prev, next, source)` → `schema.validateRecord(..., 'updateRecord', prev)` → 결과가 이전과 같은 참조면 건너뜀 → `devFreeze` → Atom 갱신 → `updates[id] = [최초 from, 최신 to]`. 같은 트랜잭션에서 여러 번 바뀌면 from은 유지하고 to만 바뀝니다. 결국 원래대로 돌아오면 항목을 지웁니다.

4.  **없으면(생성)**: `handleBeforeCreate` → `validateRecord(..., 'createRecord')` → `additions[id]`.

5.  변경이 있으면 `updateHistory({added, updated, removed: {}})`.

`remove(ids)`는 `handleBeforeDelete`가 `false`를 돌려주면 그 레코드를 삭제 목록에서 빼고, 나머지를 `records.deleteMany`로 지운 뒤 `removed` diff를 기록합니다. `update(id, updater)`는 읽고 함수를 적용한 뒤 `put`합니다.

## 2.5 히스토리: 모든 변경은 diff로 남는다

```ts
readonly history: Atom<number, RecordsDiff<R>> = atom('history', 0, { historyLength: 1000 })

private updateHistory(changes: RecordsDiff<R>) {
  const version = this.history.__unsafe__getWithoutCapture() + 1
  this.history.set(version, changes)        // 값은 버전 번호, diff는 히스토리 버퍼로
  this.historyAccumulator.add({ changes, source: this.isMergingRemoteChanges ? 'remote' : 'user' }, version)
}
```

`history`는 값이 단순 증가 정수이고, 실제 내용은 1장의 히스토리 버퍼에 diff로 남는 Atom입니다. 이 한 수로 두 종류의 소비자가 모두 만족됩니다.

- **반응형 소비자**: Computed 안에서 `store.history.getDiffSince(lastEpoch)`로 증분을 받습니다(2.7절).

- **리스너**: `store.listen(fn, { source, scope })`. `historyAccumulator`가 diff를 모아 두고, `historyReactor`가 `throttleToNextFrame`으로 **프레임당 한 번** `_flushHistory()`를 호출해 각 리스너에 필터링한 변경을 전달합니다. 리스너가 없으면 앱큘뮬레이터를 즉시 비워 메모리를 아낍니다.

`ChangeSource`는 `'user' | 'remote'`입니다. `mergeRemoteChanges(fn)` 안에서 일어난 변경은 `'remote'`로 표시되며, 동기화 클라이언트는 `listen(..., { source: 'user', scope: 'document' })`로 자기 변경만 서버에 보냅니다(15장). 이것이 에코 루프를 막는 장치입니다.

`RecordsDiff.ts`의 도구들도 자주 나옵니다.

- `squashRecordDiffs(diffs)`: 여러 diff를 하나로 합칩니다. 추가 후 삭제는 사라지고, 갱신 체인은 최초 from과 최종 to만 남습니다.

- `reverseRecordsDiff(diff)`: added↔removed, updated의 \[from,to\]를 뒤집습니다. undo의 핵심입니다.

- `isRecordsDiffEmpty`.

## 2.6 atomic과 사이드 이펙트

`atomic(fn, runCallbacks, isMergingRemoteChanges)`는 `transact()`로 감싼 뒤 `pendingAfterEvents` 맵을 열고 `fn`을 실행합니다. `put`/`remove`는 변경마다 `addDiffForAfterEvent(before, after)`로 레코드별 최초 before와 최신 after를 남깁니다. 바깥 atomic이 끝날 때 `flushAtomicCallbacks`가 이를 처리합니다.

1.  레코드별로 before·after를 비교해 `handleAfterChange` / `handleAfterDelete` / `handleAfterCreate`를 호출합니다.

2.  그 핸들러가 또 스토어를 바꾸면 새 `pendingAfterEvents`가 생기고 루프를 다시 돕니다. 100회를 넘으면 `Maximum store update depth exceeded` 예외가 납니다.

3.  더 이상 남은 이벤트가 없으면 `handleOperationComplete(source)`를 호출합니다.

4.  두 번째 루프부터 source는 `'user'`입니다. 원격 변경에 반응해 로컬 핸들러가 만든 변경은 로컬 변경이라 서버로 올라가야 하기 때문입니다.

`StoreSideEffects` 등록 API는 다음과 같습니다.

| 핸들러                                     | 시점                | 반환값의 힘                                      |
|--------------------------------------------|---------------------|--------------------------------------------------|
| `registerBeforeCreateHandler(type, fn)`    | 검증 전             | 레코드를 바꿔 돌려줄 수 있음                     |
| `registerBeforeChangeHandler`              | 검증 전             | 다음 값을 바꾸거나 `prev`를 돌려줘 변경을 무효화 |
| `registerBeforeDeleteHandler`              | 삭제 직전           | `false`면 삭제 취소                              |
| `registerAfterCreate/Change/DeleteHandler` | atomic 종료 시      | 연쇄 작업(다른 레코드 수정)                      |
| `registerOperationCompleteHandler`         | 연쇄가 모두 끝난 뒤 | 정리 작업                                        |

에디터는 이것으로 수많은 불변식을 지킵니다. 페이지가 삭제되면 그 안의 도형을 지우고, 도형이 삭제되면 연결된 바인딩을 정리하고, 선택 목록에서 빼는 식입니다(4장). `atomic(fn, false)`나 `sideEffects.setIsEnabled(false)`로 핸들러를 일시적으로 끌 수 있습니다.

## 2.7 쿼리와 증분 인덱스

`store.query`(`StoreQueries.ts`)는 반응형 쿼리를 제공하며, 모두 1장의 `getDiffSince`를 이용한 증분 계산입니다.

**filterHistory(typeName)**: 전체 `history`에서 특정 타입의 변경만 걸러낸 Computed입니다. 자기 히스토리 버퍼(길이 100)를 가지며, 해당 타입 변경이 없으면 `lastValue`를 그대로 돌려줘 하위를 깨우지 않습니다.

**index(typeName, path)**: "속성 값 → ID 집합" 맵입니다. 예를 들어 `index('shape', 'parentId')`는 부모별 자식 도형 집합이며, `'meta\\owner'`처럼 중첩 경로도 됩니다.

```ts
// StoreQueries.ts — __uncached_createIndex (요약)
computed('index:' + typeName + ':' + path, (prevValue, lastComputedEpoch) => {
  if (isUninitialized(prevValue)) return fromScratch()
  const history = typeHistory.getDiffSince(lastComputedEpoch)
  if (history === RESET_VALUE) return fromScratch()
  // added/updated/removed를 돌며 값별 IncrementalSetConstructor에 add/remove
  // 바뀐 값의 Set만 새로 만들고 나머지는 이전 Set 참조 재사용
  return withDiff(nextValue, nextDiff)
})
```

`IncrementalSetConstructor`는 이전 Set을 복사하지 않고 추가·삭제를 모았다가, 실제 변화가 있을 때만 새 Set과 `{added, removed}` diff를 만듭니다. 그래서 도형 1만 개 중 하나가 부모를 바꿔도 비용은 O(변경 수)입니다.

그 밖의 쿼리:

- `ids(typeName, () => ({ parentId: { eq: pageId } }))`: `QueryExpression`(`eq`, `neq`, `gt`)을 인덱스 교집합으로 평가하고(`executeQuery.ts`), 이후 변경은 증분 반영합니다.

- `records(typeName, query)`, `record(typeName, query)`: ID 집합에서 레코드를 꺼냅니다.

- `exec(typeName, query)`: 비반응 1회 실행입니다.

## 2.8 계산 캐시: createComputedCache

레코드별 파생값을 캐시하는 표준 도구입니다.

```ts
const boundsCache = store.createComputedCache('bounds', (shape) => computeBounds(shape), {
  areRecordsEqual: (a, b) => a.props === b.props,   // 입력 비교를 좁힘
  areResultsEqual: Box.Equals,                        // 결과가 같으면 하위 전파 차단
})
boundsCache.get(shapeId)
```

내부적으로 `WeakCache<Atom, Signal>`에 레코드 Atom을 키로 Computed를 보관합니다. 레코드가 지워져 Atom이 GC되면 캐시도 사라집니다. 에디터의 지오메트리·페이지 변환·마스크 캐시가 모두 이 방식입니다(4장, 7장).

## 2.9 스냅샷, applyDiff, 변경 추출

- `serialize(scope)`: 기본 scope는 `'document'`입니다. `{[id]: record}` 맵을 돌려줍니다.

- `getStoreSnapshot(scope)`: `{ store, schema: schema.serialize() }`. 스키마 버전을 함께 저장해야 나중에 마이그레이션할 수 있습니다.

- `loadStoreSnapshot(snapshot)`: 마이그레이션 후 기존 레코드를 교체합니다.

- `applyDiff(diff, { runCallbacks, ignoreEphemeralKeys })`: diff를 put/remove로 적용합니다. `ignoreEphemeralKeys`면 현재 레코드의 임시 키 값은 유지합니다.

- `extractingChanges(fn)`: `fn` 동안 일어난 변경을 하나의 diff로 모아 돌려줍니다. 롤백된 버전은 버립니다. 동기화 클라이언트의 리베이스에서 쓰입니다.

- `ensureStoreIsUsable()`: 스키마가 제공하는 무결성 검사기를 실행합니다. 예를 들어 페이지가 하나도 없으면 만들고, 현재 페이지가 없으면 고칩니다. `mergeRemoteChanges`가 끝날 때마다 호출됩니다.

## 2.10 StoreSchema와 마이그레이션

`StoreSchema.create(types, { migrations, onValidationFailure, createIntegrityChecker })`가 레코드 타입들과 마이그레이션 시퀀스를 묶습니다.

**검증**: `validateRecord(store, record, phase, recordBefore)`는 해당 RecordType의 검증기를 호출합니다. 실패하면 `onValidationFailure`가 있을 때 복구된 레코드를 받고, 없으면 예외를 던집니다. `recordBefore`를 넘기는 이유는 3장의 검증기가 바뀌지 않은 하위 객체를 건너뛰는 최적화를 하기 때문입니다.

**마이그레이션 모델**(`migrate.ts`):

- `MigrationSequence`는 `sequenceId`(예: `com.tldraw.shape.geo`)와 순서 있는 `Migration[]`입니다. 각 마이그레이션 ID는 `${sequenceId}/${version}` 형식입니다.

- 마이그레이션의 scope는 세 가지입니다. `record`는 레코드 하나씩 변환하며 `filter`와 `down`을 가질 수 있습니다. `store`는 직렬화된 스토어 전체를 변환합니다. `storage`는 `SynchronousRecordStorage`(get/set/delete)를 받아 제자리에서 고치며, 서버의 SQLite 저장소처럼 전체를 메모리로 올리기 부담스러운 곳에서 씁니다.

- `dependsOn`으로 다른 시퀀스의 마이그레이션에 의존할 수 있고, `sortMigrations`가 위상 정렬합니다.

- `createRecordMigrationSequence({ recordType, sequence })`는 특정 타입에만 적용되는 레코드 마이그레이션을 만드는 편의 함수입니다.

**직렬화된 스키마** (v2):

```json
{ "schemaVersion": 2, "sequences": { "com.tldraw.store": 5, "com.tldraw.shape.geo": 10, "...": 0 } }
```

각 시퀀스의 마지막 버전 번호만 기록합니다(숫자는 예시). `getMigrationsSince(persistedSchema)`는 상대 버전 다음부터의 마이그레이션을 모아 위상 정렬 순서로 돌려줍니다. 다음 경우는 성격이 다릅니다.

- 상대에게 없는 시퀀스: `retroactive`가 true면 처음부터 전부 적용하고, false면 건너뜁니다. 나중에 추가된 커스텀 도형을 고려한 것입니다.

- 상대 버전이 우리 시퀀스에 없음(상대가 더 최신): `Incompatible schema?` 오류입니다. 동기화 서버는 이때 클라이언트에게 새로고침을 요구합니다(16장).

- `migratePersistedRecord(record, schema, 'down')`: 모두 `record` scope이고 `down`이 있을 때만 가능합니다. 서버가 구버전 클라이언트에게 레코드를 내려보낼 때 씁니다.

- 계산 결과는 `WeakMap`으로 캐시됩니다(`migrationCache`).

## 2.11 이 장의 핵심 정리

- 레코드는 불변 JSON이고, 레코드마다 Atom 하나입니다. 키 집합은 별도 Atom이라 세밀한 반응성이 가능합니다.

- 모든 변경은 `RecordsDiff`로 `history` Atom에 남고, 리스너에는 프레임 단위로 묶여 전달됩니다.

- `source`('user'/'remote')와 `scope`('document'/'session'/'presence')가 저장·동기화 필터의 두 축입니다.

- 사이드 이펙트는 before(변형·거부)와 after(연쇄)로 나뉘며 atomic 단위로 실행됩니다.

- 쿼리와 인덱스는 히스토리 diff를 이용해 증분 갱신됩니다.

- 스키마는 시퀀스별 버전을 기록하고, 레코드·스토어·저장소 세 수준의 마이그레이션을 위상 정렬해 적용합니다.

**다음 장**: tldraw가 이 스토어 위에 정의한 구체적인 레코드 타입들 — `@tldraw/tlschema`.
