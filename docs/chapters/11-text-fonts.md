# 11장. 텍스트 — 측정, 리치 텍스트 편집, 폰트

캔버스 에디터에서 텍스트는 까다로운 영역입니다. 도형 크기를 정하려면 텍스트를 측정해야 하고, 측정은 폰트가 로드되어야 정확하며, 편집은 캔버스가 아닌 진짜 브라우저 텍스트 입력 기능을 써야 합니다. tldraw는 숨은 DOM으로 측정하고, TipTap(ProseMirror)으로 편집하며, FontFace API로 폰트를 추적합니다.

## 11.1 데이터: TLRichText

텍스트·노트·geo·화살표 라벨은 `richText` prop에 TipTap JSON 문서를 저장합니다.

```json
{ "type": "doc", "content": [
  { "type": "paragraph", "content": [ { "type": "text", "text": "Hello " },
    { "type": "text", "marks": [{ "type": "bold" }], "text": "world" } ] } ] }
```

- 검증기(`tlschema/src/misc/TLRichText.ts`)는 `{ type, content? }` 구조만 확인하고 내부는 JSON 값으로 허용합니다. 그래서 TipTap 확장을 바꿔도 스키마 마이그레이션이 필요 없습니다.

- `toRichText(text)`은 평문을 줄 단위 문단으로 바꿉니다. `renderPlaintextFromRichText(editor, richText)`는 검색·접근성·빈 텍스트 판정에 씁니다.

- 기본 TipTap 확장(`packages/tldraw/src/lib/utils/text/tiptap.ts`의 `getTipTapDefaultExtensions`): StarterKit(인용·코드 블록·구분선 제외, 링크 자동 인식), Highlight, Typography, 리터럴 타이핑, 선택 감싸기, Shift+Enter를 Enter처럼 처리하는 확장, 자동 텍스트 방향(`direction: 'auto'`).

- `Editor`의 `textOptions.tipTapConfig`로 확장을 바꿀 수 있고, `addFontsFromNode`로 커스텀 노드가 쓰는 폰트를 알려줄 수 있습니다.

## 11.2 보기와 편집의 분리

`RichTextLabel`(`shapes/shared/RichTextLabel.tsx`)은 두 모드를 오갑니다.

- **편집 중이 아닐 때**: `renderHtmlFromRichText(editor, richText)`로 TipTap의 `generateHTML`을 호출해 HTML 문자열을 만들고 `dangerouslySetInnerHTML`로 넣습니다. 결과는 `richText` 객체를 키로 `WeakCache`에 저장되므로, 같은 레코드는 다시 변환하지 않습니다. 화면의 수백 개 라벨에 TipTap 에디터 인스턴스를 만들지 않기 위한 설계입니다.

- **편집 중일 때**: `RichTextArea`가 TipTap `Editor`를 만듭니다(`autofocus`, `editable: isEditing`). `onUpdate`에서 `getJSON()`을 얻어 `handleChange({ richText })`가 `editor.updateShape({ props: { richText } })`를 호출합니다. 키 입력마다 레코드가 갱신되므로 협업자는 입력하는 내용을 실시간으로 봅니다.

- `editor.setRichTextEditor(textEditor)`로 현재 TipTap 인스턴스를 등록해, 리치 텍스트 툴바(`DefaultRichTextToolbar`)가 굵게·링크·목록 명령을 내릴 수 있게 합니다.

- 편집 진입 시점의 커서 위치: Editor가 `select-all-text` 또는 `place-caret` 이벤트를 발행하면 RichTextArea가 받아 전체 선택이나 클릭 위치 커서를 적용합니다.

편집 상태 자체는 select 도구의 `EditingShape` 상태와 `instance_page_state.editingShapeId`입니다. `editor.setEditingShape(id)`가 `canEdit`을 확인하고 `onEditStart`를, 끝낼 때 `onEditEnd`를 부릅니다. 텍스트 도형은 `onEditEnd`에서 비어 있으면 스스로를 지웁니다. 편집 중에는 `inputs.isEditing`이 true라 단축키가 텍스트 입력을 가로채지 않습니다.

## 11.3 텍스트 측정: TextManager

`TextManager`(`editor/managers/TextManager/TextManager.ts`)는 컨테이너 안에 보이지 않는 측정용 div 풀을 두고 실제 브라우저 레이아웃으로 크기를 쟽니다.

| 메서드                            | 용도                                                                                              |
|-----------------------------------|---------------------------------------------------------------------------------------------------|
| `measureText(text, opts)`         | 평문 측정                                                                                         |
| `measureHtml(html, opts)`         | 리치 텍스트 HTML 측정(`renderHtmlFromRichTextForMeasurement`가 만든 `<div class="tl-rich-text">`) |
| `measureHtmlBatch(requests)`      | 여러 개를 풀의 div에 한꺼번에 넣고 한 번의 레이아웃으로 측정                                      |
| `measureTextSpans(text, opts)`    | 줄바꿈·말줄임을 고려해 줄별 텍스트와 상자를 돌려줌(SVG 내보내기용)                                |
| `measureElementTextNodeSpans(el)` | DOM `Range`로 글자별 상자를 재서 같은 줄의 글자를 묶음                                            |

`TLMeasureTextOpts`는 글꼴(family, size, weight, style), 줄 높이, `maxWidth`/`minWidth`, padding, 추가 CSS를 받고, `{ x, y, w, h, scrollWidth }`를 돌려줍니다. 측정 요소에 남은 스타일은 `resetElementStyles`로 지워 서로 간섭하지 않게 합니다.

측정 결과는 도형의 지오메트리·`onBeforeUpdate`에서 쓰이며(10장의 text autoSize, geo/note growY), 도형별 캐시(`WeakCache`에 props를 키로)로 중복 측정을 피합니다.

## 11.4 폰트: FontManager

폰트가 로드되기 전에 측정하면 대체 폰트 크기가 나오므로, 로드 후 다시 측정해야 합니다. `FontManager`(`editor/managers/FontManager/FontManager.ts`)가 이를 조율합니다.

1.  **어떤 폰트가 필요한가**: `ShapeUtil.getFontFaces(shape)`가 `TLFontFace` 목록(family, src URL, weight, style 등)을 돌려줍니다. 리치 텍스트는 노드를 순회하며 굵게·기울임·코드 마크에 따라 필요한 페이스를 모읍니다(`RichTextFontVisitor`). 결과는 도형별 Computed 캐시입니다.

2.  **로드**: `requestFonts(fonts)` / `ensureFontIsLoaded(font)`가 브라우저 `FontFace`를 만들어 `document.fonts`에 추가하고 load합니다. 폰트별 상태(`loading | ready | error`)는 `AtomMap`에 있어 반응형입니다. 폰트 URL은 `fontAssetUrls` 옵션으로 바꿀 수 있습니다(자체 호스팅).

3.  **다시 측정**: 지오메트리 캐시가 `trackFontsForShape`로 폰트 상태에 의존하므로(4.8절), 폰트가 ready가 되면 그 도형의 지오메트리가 자동으로 재계산됩니다. 공간 인덱스는 폰트 로드 epoch가 바뀌면 통째로 다시 만듭니다(6.7절).

4.  **초기 렌더**: `loadRequiredFontsForCurrentPage(limit)`은 현재 페이지 도형들의 폰트를 미리 로드합니다. `options.maxFontsToLoadBeforeRender`개까지는 로드를 기다렸다가 캔버스를 그려 처음 화면에서 텍스트가 출렁이지 않게 합니다.

5.  **내보내기**: SVG/PNG 내보내기는 폰트를 data URL로 임베드해야 다른 환경에서도 같게 보입니다(13장의 `FontEmbedder`).

기본 글꼴(손글씨 draw, sans, serif, mono)의 실제 파일과 CSS 변수는 테마가 정합니다(`TLTheme`의 fonts, 12장). `tlschema`의 `registerFontsFromThemes`가 테마의 글꼴을 `DefaultFontStyle` 값 목록에 등록합니다.

## 11.5 SVG로 내보낼 때의 텍스트

일반 렌더는 HTML이지만 내보내기는 SVG입니다. 두 가지 방식이 있습니다.

- **리치 텍스트**: `RichTextSVG`가 `<foreignObject>` 안에 HTML을 넣고 스타일을 인라인합니다.

- **줄 단위 스팬**: `measureTextSpans`/`measureElementTextNodeSpans`로 줄마다 위치를 구해 `createTextJsxFromSpans`가 `<text>`/`<tspan>`을 만듭니다. 프레임 이름처럼 말줄임이 필요한 곳에 씁니다.

## 11.6 이 장의 핵심 정리

- 텍스트는 TipTap JSON으로 저장되고, 편집 중인 도형 하나만 실제 에디터를 띄웁니다. 나머지는 캐시된 HTML입니다.

- 편집 내용은 키 입력마다 레코드로 기록되어 동기화·undo에 그대로 합류합니다.

- 크기는 숨은 DOM 풀로 측정하고, 폰트 로드 상태가 반응형이라 로드 후 자동으로 재측정됩니다.

**다음 장**: 스타일·테마와 UI 레이어.
