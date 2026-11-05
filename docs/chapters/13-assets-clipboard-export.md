# 13장. 에셋·외부 콘텐츠·클립보드·내보내기

이 장은 캔버스 밖과 데이터를 주고받는 경계를 다룹니다. 파일·URL·텍스트가 들어오면 도형과 에셋으로 바뀌고(외부 콘텐츠), 도형은 클립보드와 SVG·PNG로 나갑니다. 두 방향 모두 "레코드와 바이너리를 분리한다"는 원칙을 따릅니다.

## 13.1 에셋 레코드와 에셋 스토어

이미지·비디오 파일 자체는 스토어에 넣지 않습니다. 스토어에는 `asset:…` 레코드(이름, 크기, MIME 타입, 애니메이션 여부, `src` URL)만 두고, 도형은 `assetId`로 이를 참조합니다. 바이너리를 어디에 둔지는 앱이 `TLAssetStore`로 정합니다(`tlschema/src/TLStore.ts`).

```ts
interface TLAssetStore {
  upload(asset, file, abortSignal?): Promise<{ src: string; meta?: JsonObject }>  // 파일 저장 → URL
  resolve?(asset, ctx: TLAssetContext): Promise<string | null> | string | null   // 표시할 URL 결정
  remove?(assetIds): Promise<void>
}
interface TLAssetContext {
  screenScale; steppedScreenScale; dpr; networkEffectiveType; shouldResolveToOriginal
}
```

- 기본 스토어(`inlineBase64AssetStore`, `createTLStore.ts`)는 파일을 data URL로 바꿔 레코드에 넣습니다. 로컬 전용이면 간단하지만, 동기화 환경에서는 레코드가 커져서 서버 업로드가 필요합니다(16장의 템플릿).

- **resolve**는 렌더링할 때마다 현재 줌(`steppedScreenScale`은 계단화된 배율), DPR, 네트워크 상태를 받습니다. 서버가 이미지 리사이즈를 지원하면 줌아웃 상태에서 작은 이미지를 받을 수 있습니다. 내보내기는 `shouldResolveToOriginal`로 원본을 요청합니다.

- Editor API: `uploadAsset(asset, file)`, `resolveAssetUrl(assetId, { screenScale, ... })`, `createAssets`, `updateAssets`, `deleteAssets`, `getAsset`.

- 도형 쪽에서는 `useImageOrVideoAsset`이 반응형으로 URL을 해석하고, 줌이 크게 바뀔 때만 다시 요청합니다.

**AssetUtil**(`editor/assets/AssetUtil.ts`)은 에셋 타입별 행동입니다. `static type/props/migrations`, `getDefaultProps`, `getSupportedMimeTypes`, `acceptsMimeType`, `getAssetFromFile(file, id)`을 가집니다. 기본은 `ImageAssetUtil`(크기·애니메이션 감지), `VideoAssetUtil`, `BookmarkAssetUtil`입니다. 어떤 도형이 어떤 에셋을 만들지는 `ShapeUtil.handledAssetTypes`와 `createShapeForAsset`이 연결합니다(7.2절).

## 13.2 외부 콘텐츠 파이프라인

드래그 앤 드롭, 붙여넣기, 파일 선택, 임베드 대화상자는 모두 `editor.putExternalContent(content)` 하나로 모입니다. Editor는 `content.type`에 등록된 핸들러를 부릅니다.

| 등록 API                         | 타입           | 기본 핸들러가 하는 일                                                       |
|----------------------------------|----------------|-----------------------------------------------------------------------------|
| `registerExternalAssetHandler`   | `file`         | 파일 검사 → SVG 살균 → AssetUtil로 에셋 정보 → `uploadAsset` → 에셋 레코드  |
| 〃                               | `url`          | URL을 가져와 og:image·og:title·og:description·파비콘을 파싱한 bookmark 에셋 |
| `registerExternalContentHandler` | `files`        | 여러 파일 드롭. 임시 미리보기 후 비동기 업로드                              |
| 〃                               | `file-replace` | 기존 이미지 도형의 파일 교체                                                |
| 〃                               | `text`         | 평문·HTML을 텍스트 도형으로(줄 수·RTL 고려)                                 |
| 〃                               | `url`          | 임베드 정의에 맞으면 embed, 아니면 bookmark                                 |
| 〃                               | `svg-text`     | SVG 문자열을 이미지 파일로 만들어 처리                                      |
| 〃                               | `embed`        | 임베드 도형 생성                                                            |
| 〃                               | `tldraw`       | tldraw 클립보드 내용을 `putContentOntoCurrentPage`로                        |
| 〃                               | `excalidraw`   | Excalidraw 데이터를 tldraw 도형으로 변환                                    |

**파일 드롭 흐름**(`defaultHandleExternalFileContent`):

1.  `maxFilesAtOnce` 초과면 토스트 후 중단. 위치는 드롭 지점, 없으면 Shift 시 포인터 아니면 뷰포트 중심.

2.  파일마다 MIME·크기(`DEFAULT_MAX_ASSET_SIZE` 10MB, 이미지 최대 변 5000px) 검사, SVG는 `maybeSanitizeSvgFile`로 스크립트 등 위험 요소 제거.

3.  `getAssetInfo`로 에셋 레코드 초안을 만들고, 이미지면 `createTemporaryAssetPreview(assetId, file)`로 로컬 object URL을 임시로 등록합니다.

4.  **도형을 먼저 만듭니다**(`createShapesForAssets`). 사용자는 업로드를 기다리지 않고 즉시 이미지를 봅니다.

5.  백그라운드에서 `getAssetForExternalContent({ type: 'file' })` → 업로드가 끝나면 `updateAssets`로 진짜 `src`를 채웁니다. 실패하면 에셋을 지우고 토스트를 띄웁니다. 임시 미리보기는 `temporaryAssetPreviewLifetimeMs` 뒤 정리됩니다.

동기화 환경에서는 4번의 도형이 먼저 다른 사람에게 가고, 그들은 `src`가 채워질 때까지 자리만 봅니다. 업로드한 본인만 로컬 미리보기를 봅니다.

## 13.3 클립보드

**복사**(`ui/hooks/useClipboardEvents.ts`의 `handleNativeOrMenuCopy`):

1.  `editor.getContentFromCurrentPage(selectedIds)`가 `TLContent`를 만듭니다. 선택 도형과 모든 자손, 그들 사이의 바인딩, 참조 에셋, `rootShapeIds`, 그리고 **스키마**가 들어갑니다. 루트 도형은 페이지 좌표로 바꿔 두어 부모 없이도 제자리를 알 수 있게 합니다.

2.  `resolveAssetsInContent`로 에셋 URL을 해석합니다. `options.onBeforeCopyToClipboard`로 앱이 내용을 바꾸거나 막을 수 있습니다.

3.  `{ type: 'application/tldraw', kind: 'content', version: 3, data: { assets, otherCompressed } }`를 만듭니다. 도형·바인딩은 lz-string으로 압축하고 에셋은 평문입니다.

4.  `text/html`에는 `<div data-tldraw>{JSON}</div>`, `text/plain`에는 도형들의 `getText()`를 이어 씁니다. 다른 앱에 붙여넣으면 텍스트가, tldraw에 붙여넣으면 도형이 들어갑니다.

**붙여넣기**(`handleClipboardThings`)는 클립보드 항목을 우선순위로 해석합니다. 파일, tldraw HTML 주석(현재 v3, 예전 LZ 전체 압축 형식도 지원), Excalidraw JSON, URL, HTML(iframe이면 임베드), 평문 순입니다. 결과는 모두 `putExternalContent`로 갑니다. `options.onBeforePasteFromClipboard`와 `onClipboardPasteRaw`로 가로챌 수 있습니다.

**putContentOntoCurrentPage(content, { point, select, preservePosition, preserveIds })**(`Editor.ts` 약 9758행):

1.  `content.schema`로 **마이그레이션**합니다(`migrateStoreSnapshot`). 구버전 tldraw에서 복사한 내용도 붙여넣을 수 있는 이유입니다.

2.  `preserveIds`가 아니면 모든 도형·바인딩 ID를 새로 만들고 참조(parentId, fromId/toId)를 다시 잇습니다.

3.  붙여넣을 부모를 정합니다. 포인터 아래 도형이 모든 루트 도형을 받을 수 있으면(프레임) 그 안으로, 아니면 현재 선택의 공통 부모 후보로 갑니다.

4.  인덱스를 새 부모의 맨 위로 맞추고, 위치를 point(또는 원래 위치)에 맞춘 뒤, 없는 에셋을 만들고 도형·바인딩을 만듭니다.

## 13.4 내보내기: SVG

`editor.getSvgElement(ids, opts)` / `getSvgString` / `toImage` / `toImageDataUrl`이 공개 API입니다. 파이프라인은 이렇습니다.

1.  **getSvgJsx**(`editor/src/lib/exports/getSvgJsx.tsx`): 내보낼 도형을 렌더 순서로 모으고, 경계를 계산합니다. 프레임처럼 `isExportBoundsContainer`인 도형 하나만 내보내면 그 경계를, 아니면 전체 경계에 padding을 더합니다. 옵션은 `scale`, `pixelRatio`, `background`, `padding`, `darkMode`, `bounds` 등입니다.

2.  도형마다 `util.toSvg(shape, ctx)`/`toBackgroundSvg`가 있으면 그 SVG를 씁니다. 없으면 <strong>`ForeignObjectShape`</strong>가 도형의 일반 `component`를 `<foreignObject>` 안에 페이지 변환·클립 패스·불투명도를 적용해 넣습니다. 커스텀 도형은 `toSvg` 없이도 내보내집니다.

3.  **SvgExportContext**(`ctx`): `isDarkMode`, `scale`, `pixelRatio`, `addExportDef`(공유 defs 등록), `waitUntil(promise)`(비동기 준비를 기다리게 함), `resolveAssetUrl`(내보내기 크기에 맞는 에셋 URL) 등을 줍니다.

4.  **exportToSvg**: 컨테이너 안에 보이지 않는(`opacity: 0`, `inert`) div를 만들고, 별도 React root로 JSX를 `flushSync` 렌더합니다. `ExportDelay`에 등록된 모든 promise가 끝날 때까지 기다립니다(`maxExportDelayMs` 한도).

5.  **applyChangesToForeignObjects**: foreignObject 안의 HTML은 외부 CSS에 의존하므로 그대로는 다른 곳에서 깨집니다. `StyleEmbedder`가 각 요소의 computed style을 읽어 기본값과 다른 것만 인라인하고(빈 iframe으로 태그별 기본 스타일을 쟽니다), `embedMedia`가 이미지를 data URL로 바꾸며, `FontEmbedder`가 쓰인 @font-face를 찾아 폰트 파일까지 data URL로 넣습니다. 결과는 독립적인(self-contained) SVG입니다.

## 13.5 내보내기: PNG·JPEG·WebP

`toImage(ids, { format, scale, pixelRatio, quality })` → SVG 문자열 → `getSvgAsImage`(`exports/getSvgAsImage.ts`):

- SVG를 **data URL**로 만들어 `<img>`에 싣고 캔버스에 `drawImage`합니다. 주석에 따르면 Chrome에서는 foreignObject가 있는 SVG를 blob URL로 쓰면 캔버스가 오염(tainted)되는 버그가 있어서입니다.

- Safari는 SVG 폰트 로드 전에 `onload`가 불리므로 250ms를 기다립니다.

- 브라우저 캔버스 최대 크기(`utils/browserCanvasMaxSize.ts`)를 넘지 않게 해상도를 줄이고, `trimSvgToContent`로 여백을 다듬습니다.

- PNG에는 `PngHelpers.setPhysChunk`로 pHYs 청크(물리 해상도)를 기록해, 고해상도로 내보낸 이미지를 다시 붙여넣을 때 원래 크기로 놓이게 합니다. 붙여넣기가 일반 `image/png`보다 `web image/png+tldraw`를 선호하는 것도 이 메타데이터가 보존되기 때문입니다.

- `options.exportProvider`로 내보내기 렌더링 환경을 감쌀 수 있고, `<TldrawImage>` 컴포넌트는 스냅샷을 정적 이미지로 렌더합니다.

## 13.6 이 장의 핵심 정리

- 에셋은 레코드(메타데이터 + src)와 바이너리(앱의 TLAssetStore)로 나뉘며, 표시 URL은 줌·DPR에 따라 동적으로 해석됩니다.

- 모든 유입은 `putExternalContent` → 타입별 핸들러이며, 도형을 먼저 만들고 업로드는 나중에 채웁니다.

- 클립보드 내용에는 스키마가 포함되어 붙여넣기 때 마이그레이션됩니다.

- SVG 내보내기는 `toSvg` 또는 foreignObject + 스타일·폰트·이미지 인라인이고, 비트맵은 그 SVG를 캔버스에 그린 것입니다.

**다음 장**: 로컬 지속성과 탭 간 동기화.
