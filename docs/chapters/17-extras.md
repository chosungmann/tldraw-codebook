# 17장. 부가 패키지와 저장소 안의 앱

앞의 장들은 SDK의 뼈대(state → store → tlschema → editor → tldraw, sync-core → sync)를 다뤘습니다. 이 장은 그 위에 얹힌 부가 패키지와, 저장소에 함께 들어 있는 앱·템플릿을 둘러봅니다. 대부분은 새로운 원리를 도입하기보다 앞서 배운 장치 — 커스텀 레코드, 사이드 이펙트, 도구(StateNode), 외부 콘텐츠 핸들러, 서버 권한 함수 — 를 조합한 사례라서, "실제 기능을 SDK 위에 어떻게 쌓는가"의 참고 구현으로 읽으면 좋습니다.

## 17.1 패키지 지도

| 패키지                       | 규모(테스트 제외) | 역할                                                                         |
|------------------------------|-------------------|------------------------------------------------------------------------------|
| `@tldraw/commenting`         | 약 8,800줄        | 댓글 UI 컴포넌트 + 캔버스 레이어(도구, 핀, 사이드바, 클러스터링)             |
| `@tldraw/sync-collaboration` | 약 370줄          | 댓글 레코드의 서버 측 쓰기 권한(`createCommentAuthorizers`)                  |
| `@tldraw/collaboration`      | 13줄              | 협업 기능 우산 패키지. 현재는 commenting 재수출만                            |
| `@tldraw/mentions`           | 약 500줄          | `@`-멘션 TipTap 노드와 피커                                                  |
| `@tldraw/mermaid`            | 약 3,600줄        | Mermaid 텍스트 → 편집 가능한 tldraw 도형                                     |
| `@tldraw/collections`        | 약 2,100줄        | 저장해 두고 다른 캔버스에 놓는 도형 모음. **미출시(private)**                |
| `@tldraw/driver`             | 약 740줄          | 에디터를 코드로 조작하는 명령형 API(스크립트·테스트)                         |
| `@tldraw/tldraw`             | 9줄               | `tldraw` 전체 재수출(네임스페이스 버전)                                      |
| `create-tldraw`              | 약 930줄          | `npm create tldraw` CLI. 템플릿 선택 후 내려받기                             |
| `@tldraw/assets`             | —                 | 아이콘·폰트·번역 파일과 import 헬퍼(`imports`, `imports.vite`, `selfHosted`) |
| `@tldraw/dotcom-shared`      | 약 3,000줄        | tldraw.com 클라이언트·워커 공용 코드(Zero 스키마, mutator, 역할)             |
| `@tldraw/worker-shared`      | 약 970줄          | Cloudflare 워커 공용 코드(북마크 unfurl, 업로드, Sentry, origin 검사)        |

## 17.2 댓글 I: 데이터 모델

댓글은 tlschema에 정의되어 있지만 **기본 스키마에는 들어 있지 않은 옵트인 커스텀 레코드**입니다(`tlschema/src/records/TLComment.ts`). 클라이언트와 서버가 똑같이 `createTLSchema({ records: commentSchemaRecords })`로 등록해야 하고, 하나라도 빠지면 16장의 스키마 호환 검사에서 걸립니다.

```ts
interface TLCommentThread {   // typeName 'comment-thread'
  pageId; anchor: TLCommentAnchor; createdBy; createdAt
  resolved: { at; by } | null; isDeleted: boolean; meta
}
interface TLComment {         // typeName 'comment'
  threadId; pageId; authorId; createdAt; editedAt | null
  body: TLRichText; isDeleted: boolean; meta
}
interface TLCommentReaction { // typeName 'comment-reaction'
  commentId; threadId; pageId; userId; emoji; createdAt; meta
}
type TLCommentAnchor =
  | { type: 'shape'; shapeId; x; y; isPrecise }   // 도형 기준 정규화 좌표
  | { type: 'point'; x; y }                         // 페이지 좌표
  | { type: 'region'; x; y; w; h; pinX?; pinY? }    // 영역
  | { type: 'page' }
```

- 모두 `document` 스코프입니다. 그래서 로컬 저장과 동기화에 그대로 실리고, 서버에서는 16.9의 **객체 레인**(`objectTypes`)으로 지정해 문서 쓰기 권한과 분리합니다.

- 댓글과 스레드는 **소프트 삭제**(`isDeleted`)입니다. 다른 사람의 화면에서 열려 있는 스레드가 갑자기 사라지지 않게 하고, 서버 권한 검사를 "플래그 변경"이라는 update 하나로 단순화합니다. `pageId`는 스레드에서 댓글·반응으로 비정규화해 두어 페이지별 조회를 싸게 합니다.

- 마이그레이션은 타입마다 `com.tldraw.<type>` 시퀀스(`retroactive: true`)이고, 스레드는 앵커 형식이 바뀜 때마다 `up`/`down`을 모두 갖췄습니다(예: shape 앵커에 `x/y/isPrecise` 추가, region 앵커에 `pinX/pinY` 추가). 16.4에서 본 대로 `down`이 있어야 옛 클라이언트가 같은 룸에 남을 수 있습니다.

## 17.3 댓글 II: 캔버스 레이어 (`@tldraw/commenting`)

패키지는 두 층입니다. `src/ui`는 tldraw와 무관한 순수 React 표현 컴포넌트(카드, 컴포저, 스레드, 핀, 반응, 이모지 피커)이고, `src/canvas`가 에디터에 묶인 층(도구, 레코드 훅, 오버레이, 사이드바)입니다. 최소 구성은 이렇습니다(`apps/examples/src/misc/develop.tsx`).

```tsx
const schema = createTLSchema({ records: commentSchemaRecords })
const tools = [CommentTool.configure({ enableRegions: true })]
const components = {
  InFrontOfTheCanvas: () => <CanvasComments currentUserId={userId} resolveAuthor={resolveAuthor} />,
}
<Tldraw schema={schema} tools={tools} overrides={[commentToolOverrides]} components={components} />
```

- **데이터 접근**은 2장의 증분 쿼리를 그대로 씁니다. `getCommentThreads(editor)`는 `editor.store.query.records('comment-thread').get()`이고, `getLiveCommentThreads`는 삭제되지 않았고 살아 있는 댓글이 하나라도 있는 스레드만 걸러냅니다. 모두 반응형이라 `useValue`로 읽으면 원격 댓글이 오는 즉시 화면이 갱신됩니다.

- **도구**: `CommentTool`은 StateNode입니다(5장). 누르면 포인터 위치에 컴포저가 열려 놓을 때까지 따라다니고, 도형 위에서 놓으면 shape 앵커, 빈 곳이면 point 앵커, 드래그하면(옵션) region 앵커가 됩니다. 게시 전 상태는 내부 atom(`pendingComment`)으로 도구와 오버레이가 공유합니다. `CommentTool.configure(options)`는 옵션을 얽어 쌓는 방식이라 여러 번 불러도 앞서 준 컴포넌트 슬롯이 유지됩니다.

- **되돌리기에서 제외**: 댓글 변경은 `commitCommentMutation`을 거쳐 `editor.run(fn, { history })`로 쓰이고, 기본 `history`는 `'ignore'`입니다. 댓글을 되돌리기 스택에 올리면 내가 도형을 되돌리는 Cmd+Z가 다른 사람이 보고 있는 댓글을 지울 수 있기 때문입니다(옵션 문서가 이를 멀티플레이어 함정으로 명시). 핀을 끌어 옮기는 것만 `dragHistory`로 따로 고를 수 있고, 삭제는 항상 `'ignore'`입니다. `editor.run`의 history 옵션은 중첩되면 안쪽이 바깥을 덮어쓰므로, 모드가 다른 커밋이 중첩되면 조용히 틀리는 대신 예외를 던집니다.

- **앵커 수명**(`registerCommentAnchorLifecycle`): 4장의 사이드 이펙트 활용 사례입니다. `beforeDelete('shape')`에서 그 도형에 붙은 스레드의 현재 핀 위치를 저장해 두고, `operationComplete`에서 도형이 정말 사라졌으면 스레드를 그 자리의 point 앵커로 바꿉니다. 같은 도형이 되돌리기로 돌아오면 다시 shape 앵커로 복구합니다. 판단을 `afterCreate`가 아니라 `operationComplete`까지 미루는 이유는 한 연산 안에서 자식이 부모보다 먼저 만들어질 수 있기 때문이고, `source === 'remote'`인 변경은 무시합니다 — 보정은 도형을 지운 클라이언트 한 곳에서만 일어나야 하니까요.

- **클러스터링**(`src/clustering`): 핀이 많으면 줌아웃 시 가까운 핀을 배지 하나로 합칩니다. 핀 사이의 유클리드 최소 신장 트리(`mstEdges`)를 바탕으로 "어느 줌에서 무엇이 합쳐지는가"의 병합 이벤트 표를 미리 계산하고(`computeClusterTable`), 카메라 줌이 바뀔 때는 표 위의 커서만 앞뒤로 움직입니다(`ClusterRuntime.onCamera`). 병합과 분할의 줌 임계값 사이에 히스테리시스 대역을 두어 경계 근처에서 깜빡이지 않게 하고, 도형을 드래그하는 동안(`select.translating` 등)에는 표를 매 프레임 다시 만들지 않도록 별도 경로를 탑니다.

- **호스트 연동 지점**은 `CommentingContext`입니다: `currentUserId`, `resolveAuthor(id)`, `onPostComment`, 읽음 표시(`isCommentUnread`/`onCommentsRead`), 멘션 후보(`getMentionSuggestions`), 스레드 링크(`getThreadHref`). 사용자 목록과 알림은 호스트의 몹이고, 패키지는 레코드와 UI만 책임집니다.

- **라이선스 게이트**: `useCommentingEnabled()`는 라이선스 매니저의 `commenting` 기능 플래그를 읽습니다(17.10).

## 17.4 댓글 III: 서버 권한 (`@tldraw/sync-collaboration`)

클라이언트는 믿을 수 없으므로 "누가 썼는가"는 서버가 정해야 합니다. `createCommentAuthorizers({ getUserId, canComment?, canModifyComment? })`는 16.9의 `TLRecordAuthorizers` 맵을 돌려줍니다.

| 레코드             | create                                                                                       | update                                                                                                                           | delete                   |
|--------------------|----------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------|--------------------------|
| `comment`          | `authorId`를 세션 사용자로 **스탬핑**. 사용자 없으면 거부. `isDeleted: true`로 태어나면 거부 | `authorId`·`threadId`·`createdAt` 불변. 내용 수정·삭제 플래그는 `canModifyComment`(기본: 작성자만). 한 번 삭제되면 되살리기 불가 | 항상 거부(소프트 삭제만) |
| `comment-thread`   | `createdBy` 스탬핑. 남의 이름으로 된 `resolved`는 거부                                       | 해결/재개는 누구나, 단 `resolved.by`는 자기 자신. 삭제 플래그는 `canModifyComment`                                               | 항상 거부                |
| `comment-reaction` | id가 `createCommentReactionId(commentId, userId, emoji)`와 일치해야 함                       | 대상·이모지 변경 불가                                                                                                            | 허용(하드 삭제)          |

반응 id를 결정적으로 만드는 것이 영리한 지점입니다. "사용자당 댓글당 이모지당 하나"가 저장소의 기본 키 유일성으로 보장되므로, 두 탭에서 동시에 눌러도 중복 반응이 생기지 않고 토글은 put/remove 하나가 됩니다. 기본 `canComment`는 `!session.isReadonly`이므로, "보기 전용이지만 댓글 가능"을 하려면 tldraw.com처럼 `objectAccess`와 함께 이 함수를 바꿔 줍니다. 16.9에서 본 대로 tldraw.com은 이 맵에 note 도형의 작성자 속성 검사(`shape`)를 더해 씁니다.

`@tldraw/collaboration`은 이 기능들을 한 이름으로 묶을 우산 패키지입니다. 지금은 `export * from '@tldraw/commenting'`뿐이고, 주석에 따르면 앞으로 다른 협업 패키지도 재수출할 예정입니다. 라이선스 플래그도 `FEAT_COLLABORATION`이 하위 기능(`FEAT_COMMENTING`)을 모두 포함하는 구조입니다.

## 17.5 멘션 (`@tldraw/mentions`)

댓글 컴포저와 도형 리치 텍스트가 같은 `@` 경험을 갖도록 뽑아 낸 작은 패키지입니다. `createMentionExtension({ resolveName, suggestion })`은 TipTap Mention 노드를 설정하는데, 문서에는 멤버 **id만** 저장하고 표시 이름은 렌더링 때 `resolveName(id)`으로 구합니다. 사람이 이름을 바꿔도 오래된 이름이 문서에 겨지 않습니다. 편집 경로는 `suggestion`(피커), 읽기 전용 렌더 경로는 `resolveName`만 넘기고 노드 스키마는 같습니다. 캔버스 위에서는 피커를 카메라 이동에 맞춰 다시 배치합니다. 멤버 목록(roster)은 호스트가 리졸버 함수로 공급합니다.

## 17.6 Mermaid 변환 (`@tldraw/mermaid`)

`createMermaidDiagram(editor, text, options)`는 Mermaid 문법을 정적 SVG가 아닌 **편집 가능한 geo 도형·화살표·그룹**으로 바꿉니다. 파이프라인은 레이아웃을 직접 구현하지 않고 Mermaid에게 빌리는 방식입니다.

1.  `mermaid`를 **동적 import**합니다. 크고 ESM 전용인 의존성이라 패키지를 import만 해도 끌려오지 않도록 하기 위함입니다.

2.  글꼴 크기를 1.4배(`FONT_INFLATE`) 키워 초기화합니다. tldraw의 손글씨 폰트가 Mermaid 기본 폰트보다 넓어서, 그대로 두면 노드가 작게 잡혀 레이블이 깨집니다. 다이어그램 안의 `%%{init}%%`이 이를 되돌리지 못하게 `secure`에 `fontSize`를 넣습니다.

3.  `mermaid.parse` → 화면 밖 div에 `mermaid.render`로 실제 SVG를 마운트해 **레이아웃 좌표**를 얻고(`getBBox`가 동작하려면 라이브 DOM이어야 함), `getDiagramFromText`의 DB(정점·간선·서브그래프·클래스)로 **의미**를 얻습니다.

4.  두 정보를 합쳐 중간 표현인 **blueprint**(노드, 간선, 그룹, 선)를 만듭니다. 지원 종류는 flowchart, state, sequence, mindmap입니다.

5.  `renderBlueprint`가 도형을 만들고, 간선을 바인딩된 화살표로 잇고(8장), 서브그래프와 전체를 `editor.groupShapes`로 묶습니다. 노드마다 어떤 도형을 만들지는 렌더 스펙으로 바꿀 수 있어 커스텀 ShapeUtil로도 그릴 수 있습니다.

지원하지 않는 종류는 `onUnsupportedDiagram(svg)` 콜백으로 SVG를 넘깁니다. tldraw.com의 `SneakyMermaidHandler`는 13장의 `registerExternalContentHandler('text', …)`로 붙여넣기를 가로채서, 텍스트가 Mermaid처럼 보이면 변환하고 아니면 `defaultHandleExternalTextContent`로 넘기며, 미지원 종류는 `putExternalContent({ type: 'svg-text' })`로 SVG 이미지를 넣습니다.

## 17.7 컬렉션 (`@tldraw/collections`, 미출시)

캔버스에서 고른 도형을 이름 붙인 모음에 저장하고 다른 캔버스에 끌어다 놓는 기능입니다. `private` 패키지라 npm에 나가지 않고 tldraw.com이 기능 플래그 뒤에서 먼저 씁니다. 구조는 단순합니다.

- 저장: `editor.getContentFromCurrentPage(ids)`(13장 복사와 같은 `TLContent`) + `editor.toImage(ids, { format: 'png' })` 썸네일 → `source.addItem`.

- 배치: `editor.putContentOntoCurrentPage(content, { point })` — 붙여넣기 경로 그대로라 id 재발급·에셋·스키마 마이그레이션이 따라옵니다.

- 저장소는 `CollectionSource` 인터페이스(목록·항목 CRUD + `can(action)` 권한 질의)로 추상화되고, 패키지는 `InMemoryCollectionSource`만 제공합니다. 저장 항목에는 `formatVersion`을 붙여 후일의 형식 변경에 대비합니다.

## 17.8 Driver (`@tldraw/driver`)

`new Driver(editor)`는 사용자의 입력을 흉내 내는 명령형 래퍼입니다(`pointerDown/Move/Up`, `click`, `doubleClick`, `keyPress`, `wheel`, `pinchStart/To/End`, `copy/cut/paste`, `translateSelection`, `rotateSelection`, `resizeSelection` 등, 모두 체이닝). 구현은 공개 API만 씁니다.

```ts
pointerMove(x, y, options, modifiers) {
  this.editor.dispatch({ ...this.getPointerEventInfo(x, y, options, modifiers), name: 'pointer_move' })
  this.forceTick()                       // editor.emit('tick', 16)
  return this
}
```

5장에서 본 대로 `dispatch`는 이벤트를 큐에 넣고 다음 tick에 처리하므로, Driver는 매 입력 뒤 tick을 강제로 발생시켜 동기적으로 진행되게 합니다. `translateSelection(dx, dy)`는 선택 중심에서 pointerDown 후 10단계로 나눠 움직이므로, `editor.updateShapes`로 좌표를 바꾸는 것과 달리 스냅·바인딩·부모 변경 같은 실제 상호작용 로직(9장)을 그대로 타게 됩니다. 테스트용 `TestEditor`와 같은 발상을 공개 패키지로 낸 것이라 자동화·REPL·AI 에이전트 실험에 쓰입니다.

## 17.9 라이선스와 워터마크

별도 패키지는 아니지만(`editor/src/lib/license`) 부가 기능의 게이트이므로 여기서 다룹니다.

- **키 형식**: `tldraw-<…>/<base64 데이터>.<base64 서명>`. `LicenseManager`는 내장 공개키로 `crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' })`를 불러 서명을 확인하고, 데이터 배열 `[id, hosts, flags, expiryDate]`를 꺼냅니다. 서버 호출 없이 브라우저에서 검증합니다.

- **플래그**(비트마스크): 연간/영구, 내부용, 워터마크, 평가판, 네이티브, `FEAT_COLLABORATION`, `FEAT_COMMENTING`, `TRACKED`. 연간 라이선스는 만료 후 30일 유예, 영구 라이선스는 빌드에 박힌 게시일(`publishDates`)로 "지원 버전까지"를 판단합니다.

- **개발 환경**: localhost, 루프백 IP, `*.localhost`는 개발로 보고 모든 기능을 켭니다. tldraw 자체 도메인(`tldraw.com`, `tldraw.dev` 등)은 키 없이 워터마크가 있는 라이선스를 받습니다.

- **기능 플래그**는 `featureFlags` atom이고 프로덕션에서는 검증 전까지 꺼져 있습니다(fail closed). `useLicenseFeatureFlag`가 이 atom을 읽으므로 검증이 끝나는 순간 댓글 UI가 반응형으로 나타납니다.

- 라이선스가 없거나 워터마크 라이선스인 프로덕션 배포에는 `Watermark` 컴포넌트가 표시되고, 일부 유형은 CDN의 추적용 이미지를 한 번 요청합니다(실패해도 무시).

## 17.10 배포 보조 장치

- **중복 설치 감지**: 모든 패키지의 `index.ts` 끝에는 `registerTldrawLibraryVersion(name, version, modules)`가 있습니다. 전역에 등록 목록을 모았다가 100ms 뒤 한 번 검사해, 같은 라이브러리의 버전이 섞이거나 두 벌 로드되면 경고합니다. signals 인스턴스가 둘이면 반응성이 조용히 깨지므로(1장의 전역 epoch가 둘이 됨) 반드시 필요한 장치입니다. Next.js 개발 모드의 Fast Refresh 재실행은 예외 처리합니다.

- `@tldraw/tldraw`는 `export * from 'tldraw'`뿐인 네임스페이스 별칭 패키지입니다.

- `create-tldraw`는 `@clack/prompts` 기반 CLI로, 자동 생성된 목록(`templates.ts`)에서 템플릿을 고르면 해당 스타터 킷 저장소를 내려받습니다.

- `@tldraw/assets`는 아이콘·폰트·번역을 담고, 번들러별 import 헬퍼(`imports.vite`)와 셀프 호스팅 헬퍼를 제공합니다. 기본값은 CDN에서 받습니다.

## 17.11 저장소 안의 앱

| 경로                                 | 내용                                                                                                                                                                       |
|--------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `apps/examples`                      | SDK 예제 모음(Vite). 기능별 수백 개의 예제와 e2e 테스트. 코드를 읽을 때 가장 좋은 출발점                                                                                   |
| `apps/docs`                          | tldraw.dev 문서 사이트(Next.js). API 레퍼런스는 api-extractor 결과에서 생성                                                                                                |
| `apps/dotcom/client`                 | tldraw.com 프런트엔드. Clerk 인증, 파일·그룹·댓글 메타데이터는 Rocicorp Zero로 동기화(`dotcom-shared/tlaSchema.ts`), 캔버스는 `useSync`                                    |
| `apps/dotcom/sync-worker`            | tldraw.com의 룸 서버(`TLFileDurableObject`), 권한, 버전 기록, 댓글 Postgres 동기화                                                                                         |
| `apps/dotcom/*-worker`, `zero-cache` | 에셋 업로드, 이미지 리사이즈, 사용자 콘텐츠 도메인 워커와 Zero 캐시 서버                                                                                                   |
| `apps/bemo-worker`                   | `useSyncDemo`가 붙는 데모 멀티플레이어 서버(Durable Object + `TLSocketRoom`)                                                                                               |
| `apps/vscode`                        | VS Code 확장. `.tldr` 파일을 커스텀 에디터(웹뷰)로 엶니다                                                                                                                  |
| `apps/mcp-app`                       | MCP 앱. Cloudflare DO 서버가 `search`(에디터 API 명세 검색)·`exec`(위젯의 살아 있는 에디터에서 JS 실행) 도구를 노출하고, 위젯은 MCP 호스트 iframe 안에서 tldraw를 띄웁니다 |
| `apps/analytics*`                    | 분석 동의·수집 클라이언트와 워커                                                                                                                                           |

## 17.12 템플릿과 스타터 킷

| 템플릿                                                                | 보여 주는 것                                                     |
|-----------------------------------------------------------------------|------------------------------------------------------------------|
| `vite`, `nextjs`, `vue`                                               | 프레임워크별 최소 설치. Vue는 React 루트를 직접 만들어 마운트    |
| `sync-cloudflare`, `simple-server-example`, `socketio-server-example` | 동시 편집 서버(16.10)                                            |
| `agent`                                                               | 캔버스를 조작하는 AI 에이전트                                    |
| `chat`, `branching-chat`                                              | 캔버스를 입력으로 쓰는 AI 채팅, 노드 기반 대화 트리              |
| `workflow`, `image-pipeline`                                          | 포트가 있는 노드 그래프 편집기(워크플로, 이미지 생성 파이프라인) |
| `shader`                                                              | 캔버스 상호작용에 반응하는 WebGL 배경                            |

**agent 스타터 킷**은 이 코드북의 개념이 가장 많이 모인 곳입니다.

- 프롬프트는 `PromptPartUtil`들이 조립합니다(선택 도형, 사용자 뷰포트, 에이전트 뷰포트의 스크린샷, 뷰포트 밖 도형 요약, 최근 사용자 행동, 채팅 기록, 캔버스 린트 등). ShapeUtil처럼 타입별 유틸 클래스를 등록하는 패턴입니다.

- 모델의 도구 호출은 `AgentActionUtil`(create, update, delete, move, align, pen, think, message, review 등)이 `sanitizeAction` → `applyAction`으로 에디터에 적용하고, `getResult`가 그 사이의 `RecordsDiff`를 "Created …, Updated …" 같은 문장으로 모델에 돌려줍니다.

- 흥미로운 점은 **스트리밍 중인 미완성 액션도 즉시 적용**한다는 것입니다. 액션이 완성되지 않았으면 적용으로 생긴 diff를 기억해 두었다가, 다음 조각이 오면 `reverseRecordsDiff`로 되돌린 뒤 더 긴 액션을 다시 적용합니다(`TldrawAgent.ts`). 15장 클라이언트 리베이스와 같은 "되돌리고 다시 쌓기" 발상이며, 2장의 `RecordsDiff`가 역산 가능하기에 성립합니다.

## 17.13 이 장의 핵심 정리

- 댓글은 "옵트인 커스텀 레코드 + 반응형 쿼리 + StateNode 도구 + 사이드 이펙트 + 서버 객체 레인·권한 함수"의 조합입니다. 새 협업 기능을 만들 때 그대로 따라 할 수 있는 참고 구현입니다.

- 댓글은 되돌리기에서 제외되고(기본 `'ignore'`), 소프트 삭제되며, 작성자 신원은 서버가 스탬핑합니다. 반응은 결정적 id로 중복을 구조적으로 막습니다.

- Mermaid는 레이아웃을 Mermaid에게 맡기고 결과 좌표를 읽어 네이티브 도형을 만듭니다. 컬렉션은 복사/붙여넣기 파이프라인을 재사용합니다.

- Driver는 dispatch + 강제 tick으로 실제 상호작용 경로를 재현합니다.

- 라이선스는 브라우저의 ECDSA 검증과 반응형 기능 플래그로 부가 기능을 열고 닫습니다.

여기까지가 저장소에 구현된 주제의 전부입니다. 다시 전체 그림을 보려면 개요 탭의 아키텍처 도표와 목차로 돌아가세요.
