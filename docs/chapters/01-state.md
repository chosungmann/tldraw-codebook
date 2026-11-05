# 1장. 반응성 엔진 — @tldraw/state, @tldraw/state-react

tldraw의 모든 상태 변화는 자체 시그널 라이브러리 `@tldraw/state`(옛 이름 signia) 위에서 흐릅니다. 에디터의 선택 영역, 페이지 경계, 컬링 목록, React 리렌더링까지 전부 이 엔진이 "무엇이 바뀌었고 무엇을 다시 계산해야 하는가"를 판단합니다. 코드는 약 2,900줄(`packages/state/src/lib`)로 작지만, 이 장을 이해하면 나머지 모든 장의 성능 특성이 설명됩니다.

## 1.1 왜 직접 만들었나

캔버스 에디터는 수천 개의 레코드와, 그로부터 파생되는 수백 개의 값(도형별 지오메트리, 페이지 좌표 변환 행렬, 화면에 보이는 도형 집합 등)을 가집니다. 요구사항은 세 가지입니다.

- **지연(lazy) 계산**: 아무도 읽지 않는 파생값은 계산하지 않는다.

- **세밀한 무효화**: 도형 하나가 움직이면 그 도형에 의존하는 값만 다시 계산한다.

- **증분(incremental) 계산**: "페이지의 모든 도형 ID 집합" 같은 큰 파생값은 처음부터 다시 만들지 않고 변경분(diff)만 적용한다.

일반적인 시그널 라이브러리는 앞의 두 가지는 제공하지만, 세 번째(값과 함께 diff 히스토리를 보관하고 "epoch X 이후 바뀐 것"을 질의)는 거의 없습니다. 이것이 tldraw가 자체 구현을 쓰는 핵심 이유이며, 2장의 스토어 인덱스와 쿼리가 이 기능에 의존합니다.

## 1.2 핵심 개념 네 가지

| 개념                     | 파일                 | 역할                                                   |
|--------------------------|----------------------|--------------------------------------------------------|
| Atom                     | `Atom.ts`            | 쓰기 가능한 루트 상태. `set`/`update`                  |
| Computed                 | `Computed.ts`        | 다른 시그널에서 파생되는 지연·메모이즈 값              |
| Effect (EffectScheduler) | `EffectScheduler.ts` | 의존 시그널이 바뀌면 부수효과 실행. `react`, `reactor` |
| Transaction              | `transactions.ts`    | 여러 변경을 묶어 한 번만 전파, 롤백 가능               |

여기에 **전역 epoch**라는 정수 시계가 모든 것을 묶습니다.

## 1.3 전역 epoch: 값 비교 대신 시간 비교

`transactions.ts`의 싱글턴 `inst.globalEpoch`는 단조 증가하는 정수입니다. Atom이 실제로 다른 값으로 바뀔 때마다 `advanceGlobalEpoch()`로 1 증가합니다.

- 모든 시그널은 `lastChangedEpoch`(마지막으로 값이 바뀐 시각)를 가집니다.

- 모든 자식(Computed·Effect)은 부모 배열 `parents[]`와 나란히 `parentEpochs[]`를 가지며, 마지막 계산 때 각 부모의 `lastChangedEpoch`를 기록해 둡니다.

- "부모가 바뀌었나?"는 값 비교가 아니라 `parent.lastChangedEpoch !== child.parentEpochs[i]`라는 정수 비교로 끝납니다(`helpers.ts`의 `haveParentsChanged`).

```ts
// packages/state/src/lib/helpers.ts
export function haveParentsChanged(child: Child): boolean {
  for (let i = 0, n = child.parents.length; i < n; i++) {
    const parent = child.parents[i]
    // Computed 부모는 재계산되어야 lastChangedEpoch가 움직이므로 먼저 최신화
    parent.__unsafe__getWithoutCapture(true)
    if (parent.lastChangedEpoch !== child.parentEpochs[i]) return true
  }
  return false
}
```

이 재귀 호출 덕분에 "부모의 부모"까지 필요한 만큼만 끌어와(pull) 최신화합니다.

## 1.4 Atom 구현

`Atom.set`의 순서가 중요합니다(`Atom.ts`).

1.  `isEqual(current, value)`이면 아무것도 하지 않습니다. 기본 동등성은 `===`, `Object.is`, 또는 값에 `equals()` 메서드가 있으면 그것(`helpers.ts`의 `equals`).

2.  히스토리 버퍼가 있으면 diff를 먼저 구합니다. 사용자가 넘긴 diff → `computeDiff` 옵션 → 없으면 `RESET_VALUE`. 주석에 따르면 `computeDiff`는 사용자 코드라서 epoch를 올리기 전에 실행해야, 그 안에서 읽은 Computed가 잘못된 epoch로 "확인됨" 표시되지 않습니다.

3.  `advanceGlobalEpoch()` 후 그 epoch를 한 번만 읽어 히스토리 엔트리와 `lastChangedEpoch`에 같이 씁니다.

4.  `atomDidChange(this, oldValue)`로 전파를 시작합니다(1.7절).

`get()`은 `maybeCaptureParent(this)`를 호출하고 값을 돌려줄 뿐입니다. 의존성 추적은 전부 이 한 줄에서 일어납니다.

## 1.5 의존성 캡처: 캡처 스택

`capture.ts`는 "지금 누가 계산 중인가"를 스택(`CaptureStackFrame` 연결 리스트)으로 관리합니다.

1.  Computed나 Effect가 실행을 시작하면 `startCapturingParents(child)`가 프레임을 push하고 `child.parentSet`을 비웁니다.

2.  실행 중 `signal.get()`이 불릴 때마다 `maybeCaptureParent(p)`가 스택 최상단 자식의 `parents[offset]`에 p를, `parentEpochs[offset]`에 `p.lastChangedEpoch`를 기록하고 offset을 1 올립니다. 같은 부모를 두 번 읽으면 `parentSet.add`가 false를 돌려 무시됩니다.

3.  이전 실행과 같은 위치에 다른 부모가 있었다면 `maybeRemoved`에 적어 둡니다.

4.  `stopCapturingParents()`가 프레임을 pop하면서, offset 이후 남은 옛 부모와 `maybeRemoved` 중 이번에 읽히지 않은 것을 `detach`합니다.

즉 의존성은 **매 실행마다 동적으로** 다시 수집됩니다. `if (a.get()) b.get() else c.get()` 같은 분기에서도 실제로 읽은 것만 의존합니다. `unsafe__withoutCapture(fn)`는 스택을 잠시 null로 만들어 추적 없이 읽게 합니다.

## 1.6 Attach/Detach: 능동적으로 듣는 그래프만 연결한다

부모→자식 방향 링크(`parent.children`)는 **누군가 끝에서 듣고 있을 때만** 연결됩니다.

- Effect가 `attach()`되면 자기 부모들에 자신을 추가하고, 부모가 Computed면 재귀적으로 그 부모들에도 연결합니다(`helpers.ts`의 `attach`).

- 자식이 하나도 없는 Computed는 부모의 `children`에 들어가지 않습니다. 이때는 순수 pull 모드로 동작합니다. 읽힐 때 `haveParentsChanged`로 확인하고, 아무도 안 읽으면 GC 대상이 됩니다.

- `detach`도 재귀적입니다. 마지막 자식이 떨어진 Computed는 자기 부모들에서도 떨어집니다.

이 설계로 메모리 누수 없이 수많은 Computed를 만들 수 있습니다. 에디터가 도형마다 Computed 캐시를 만들어도, 화면에서 사라진 도형의 캐시는 그래프에서 빠집니다.

## 1.7 전파: push로 표시하고 pull로 값을 구한다

`atomDidChange`는 트랜잭션 중이면 최초 값만 기록하고 끝내며, 아니면 `flushChanges([atom])`를 호출합니다.

```ts
// packages/state/src/lib/transactions.ts (요약)
function traverseChild(child: Child) {
  if (child.lastTraversedEpoch === inst.globalEpoch) return
  child.lastTraversedEpoch = inst.globalEpoch
  if ('__isEffectScheduler' in child) traverseReactors.add(child)
  else child.children.visit(traverseChild)
}
function flushChanges(atoms) {
  // ...
  for (const atom of atoms) atom.children.visit(traverseChild)
  for (const r of reactors) r.maybeScheduleEffect()
  // effect가 또 atom을 바꾸면 cleanupReactors로 모아 최대 1000회 반복
}
```

- **Push 단계**: 바뀐 atom에서 자식 방향으로 내려가며 `lastTraversedEpoch`만 찍고, 끝에 있는 Effect를 모읍니다. 값은 계산하지 않습니다.

- **Pull 단계**: 각 Effect의 `maybeScheduleEffect()`가 `haveParentsChanged`를 호출하며 필요한 Computed만 위에서 아래로 재계산합니다. Computed가 재계산되었는데 결과가 `isEqual`로 같으면 `lastChangedEpoch`가 그대로라서 하위 Effect는 실행되지 않습니다.

이 하이브리드 방식은 "글리치"(일부만 갱신된 중간 상태를 Effect가 보는 현상)를 막습니다. 모든 표시가 끝난 뒤 Effect가 일관된 시점의 값을 끌어오기 때문입니다.

Effect 실행 중 또 atom이 바뀌면 `globalIsReacting`이 true이므로 `traverseAtomForCleanup`이 `cleanupReactors`에 모아 두었다가 루프에서 다시 처리합니다. 1000회를 넘기면 `Reaction update depth limit exceeded` 예외를 던집니다.

## 1.8 Computed 구현과 빠른 경로

`__UNSAFE__Computed.__unsafe__getWithoutCapture`가 이 라이브러리의 심장입니다. 다음 중 하나라도 참이면 재계산 없이 캐시를 돌려줍니다.

1.  `lastCheckedEpoch === globalEpoch`: 이번 epoch에 이미 확인함.

2.  능동적으로 듣는 중이고, 트랜잭션 밖이고, `lastTraversedEpoch <= lastCheckedEpoch`: 마지막 확인 이후 push 순회가 이 노드에 도달한 적이 없으니 상류가 안 바뀌었음이 보장됨. 부모를 하나도 확인하지 않는 O(1) 경로입니다.

3.  `!haveParentsChanged(this)`: 부모들의 epoch가 기록과 같음.

그 외에는 캡처를 시작하고 `derive(previousValue, lastCheckedEpoch)`를 호출합니다. 파생 함수가 **이전 값과 마지막 계산 epoch를 인자로 받는다**는 점이 증분 계산의 열쇠입니다. 함수 안에서 `someAtom.getDiffSince(lastComputedEpoch)`로 그 사이의 변경분만 받아 이전 값을 갱신할 수 있습니다.

그 밖의 세부 사항:

- 결과가 `withDiff(value, diff)`이면 그 diff를 히스토리에 넣습니다.

- 예외도 캐시됩니다. `error`에 저장해 두었다가 부모가 바뀌기 전까지 같은 예외를 다시 던집니다.

- 처음 계산 전 상태는 `UNINITIALIZED` 심볼이며 `isUninitialized()`로 확인합니다.

## 1.9 히스토리 버퍼와 diff 질의

`historyLength` 옵션을 준 Atom/Computed는 `HistoryBuffer`라는 고정 크기 링 버퍼에 `[fromEpoch, toEpoch, diff]` 튜플을 쌓습니다.

- `getDiffSince(epoch)`는 버퍼를 최신부터 거꾸로 훑어 `fromEpoch <= epoch < toEpoch`인 엔트리를 찾으면 그 이후 diff 배열을, 버퍼가 끊겼거나 비면 `RESET_VALUE`를 돌려줍니다.

- `RESET_VALUE`를 받은 쪽은 "증분 불가, 전체 재계산하라"는 뜻으로 해석합니다.

- diff로 `RESET_VALUE`나 undefined가 push되면 버퍼가 비워집니다. 연속성이 끊겼기 때문입니다.

스토어의 `history` atom이 이 버퍼(기본 길이 1000)를 써서 `RecordsDiff`를 보관하고, 인덱스·쿼리 Computed가 `getDiffSince`로 증분 갱신합니다(2장).

## 1.10 Effect: EffectScheduler, react, reactor

`EffectScheduler`는 Computed와 같은 `Child` 인터페이스를 구현하지만 값 대신 부수효과를 실행합니다.

- `maybeScheduleEffect()`: 듣는 중이 아니거나 이번 epoch에 이미 반응했으면 무시. 부모가 안 바뀌었으면 `lastReactedEpoch`만 갱신. 바뀌었으면 `scheduleEffect()`.

- `scheduleEffect()`: 옵션 `scheduleEffect(execute)`가 있으면 실행 시점을 위임합니다. tldraw는 이것으로 **다음 애니메이션 프레임으로 미루기**(`useReactor`의 `throttleToNextFrame`)나 **React 리렌더 트리거**(`useStateTracking`)를 구현합니다.

- `execute()`: 실행 중 다시 스케줄되면 `_wasScheduledWhileExecuting` 플래그로 루프를 돌며, 1000회 제한이 있습니다.

- `react(name, fn)`: attach 후 즉시 1회 실행, 해제 함수를 반환.

- `reactor(name, fn)`: `start({force})`/`stop()`으로 수동 제어.

## 1.11 트랜잭션

```ts
transaction((rollback) => {
  a.set(1); b.set(2)
  if (bad) rollback()
})
```

- 트랜잭션 중 `atomDidChange`는 `initialAtomValues`에 **최초 값만** 기록하고 전파하지 않습니다.

- 최상위 커밋 때 바뀐 atom 전체에 대해 `flushChanges`를 **한 번** 호출합니다. 수백 개 도형을 움직여도 Effect는 한 번 실행됩니다.

- 중첩 트랜잭션은 커밋 시 자기 초기값 맵을 부모에 병합합니다.

- `abort()`(예외나 `rollback()`)는 epoch를 올리고 모든 atom을 최초 값으로 되돌리며 히스토리 버퍼를 비웁니다. 되돌린 값으로의 변화도 diff 연속성이 없기 때문입니다.

- `transact(fn)`은 이미 트랜잭션 안이면 그냥 실행하고, 아니면 새로 엽니다. 에디터의 `editor.run()`이 이것을 씁니다.

- `deferAsyncEffects(fn)`은 비동기 함수 동안 Effect 전파를 미루는 실험적 API입니다.

## 1.12 성능을 위한 작은 장치들

- **ArraySet**: 원소가 8개(`ARRAY_SIZE_THRESHOLD`) 이하면 배열, 넘으면 `Set`으로 전환합니다. 대부분의 노드는 부모·자식이 몇 개뿐이므로 배열 선형 탐색이 `Set`보다 빠르고 메모리도 적습니다.

- **singleton**: 모든 내부 클래스와 전역 상태를 `Symbol.for('com.tldraw.state/<key>')`로 `globalThis`에 등록합니다. 번들에 이 패키지가 두 벌 들어가도 epoch와 캡처 스택을 공유하므로 반응성이 깨지지 않습니다.

- **@computed 데코레이터**: 클래스 메서드를 감싸 인스턴스별 Computed를 처음 호출 때 만들고, 열거 불가 심볼 속성에 저장합니다(`makeComputedWrapper`). Editor의 수많은 `getXxx()` 메서드가 이 방식입니다. `getComputedInstance(obj, 'method')`로 Computed 객체 자체를 꺼낼 수 있습니다.

- **whyAmIRunning()**: Effect·Computed 안에서 호출하면 다음 실행 때 어떤 atom 변화 때문에 다시 실행되는지 트리 형태로 콘솔에 출력합니다.

- **localStorageAtom**: 값을 localStorage에 저장하고 `storage` 이벤트로 다른 탭과 동기화하는 Atom입니다. 사용자 설정 저장에 쓰입니다.

## 1.13 React 바인딩 — @tldraw/state-react

React 18의 `useSyncExternalStore`를 이용해 시그널을 React에 연결합니다.

| API                                             | 구현 핵심                                                                                  | 쓰임새                                |
|-------------------------------------------------|--------------------------------------------------------------------------------------------|---------------------------------------|
| `useValue(signal)` / `useValue(name, fn, deps)` | `react()`로 구독하고 snapshot은 `lastChangedEpoch`                                         | 컴포넌트에서 값 하나 읽기             |
| `track(Component)`                              | 컴포넌트를 Proxy로 감싸 `useStateTracking` 안에서 렌더, `memo` 적용                        | 렌더 중 읽은 모든 시그널 자동 추적    |
| `useStateTracking(name, render)`                | `EffectScheduler`의 `scheduleEffect`가 React 업데이트를 트리거, snapshot은 `scheduleCount` | `track`의 기반                        |
| `useReactor`                                    | `scheduleEffect`를 `throttleToNextFrame`로 지정                                            | 프레임당 최대 1회 실행되는 부수효과   |
| `useQuickReactor`                               | 스케줄러 옵션 없이 즉시 실행                                                               | 지연 없이 DOM 갱신(예: CSS 변수 설정) |
| `useAtom`, `useComputed`                        | 컴포넌트 수명 동안 Atom/Computed 생성                                                      | 로컬 반응 상태                        |

`useStateTracking`의 중요한 설계: 렌더 함수는 React 렌더 단계에서 `scheduler.execute()`로 실행되어 의존성을 캡처하지만, **attach는 `useEffect`에서** 합니다. 주석에 따르면 이렇게 해야 React가 언마운트하기 전에 삭제된 데이터로 렌더하려는 "좀비 자식" 문제를 피할 수 있습니다.

## 1.14 이 장의 핵심 정리

- 상태는 Atom, 파생은 Computed, 부수효과는 EffectScheduler. 연결은 `get()` 호출 시 자동입니다.

- 변경 감지는 전역 epoch 정수 비교로 합니다. 값 비교는 Computed 결과가 같은지 볼 때만 합니다.

- 전파는 "push로 표시, pull로 계산"이라 글리치가 없고 안 읽는 값은 계산하지 않습니다.

- 히스토리 버퍼와 `getDiffSince`가 증분 계산을 가능하게 하며, 이것이 스토어 쿼리의 기반입니다.

- 트랜잭션은 전파를 한 번으로 묶고 롤백을 제공합니다. 에디터의 `run()`과 히스토리(undo)가 그 위에 있습니다.

**다음 장**: 이 시그널 위에 레코드 데이터베이스를 올린 `@tldraw/store`.
