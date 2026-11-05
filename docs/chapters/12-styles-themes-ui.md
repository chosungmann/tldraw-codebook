# 12장. 스타일·테마와 UI 레이어

`@tldraw/editor`는 UI가 없는 코어이고, 우리가 보는 도구바·메뉴·스타일 패널은 모두 `tldraw` 패키지의 React UI입니다. UI는 Editor를 읽고(`useValue`) Editor 메서드를 호출할 뿐 별도 상태를 거의 갖지 않으며, 액션·도구·컴포넌트·번역 네 축으로 교체할 수 있습니다. 이 장은 스타일·테마 시스템과 UI 아키텍처를 다룹니다.

## 12.1 `<Tldraw>`가 조립하는 것

`packages/tldraw/src/lib/Tldraw.tsx`의 흐름입니다.

1.  **기본값 병합**: 사용자의 `shapeUtils`, `bindingUtils`, `assetUtils`, `overlayUtils`, `tools`를 기본 목록과 합칩니다. `mergeArraysAndReplaceDefaults('type' | 'id', ...)`는 같은 타입·ID면 사용자 것으로 **교체**합니다. 내장 geo를 상속한 클래스를 넣으면 기본 geo가 대체됩니다.

2.  **텍스트 옵션**: TipTap 기본 확장과 폰트 방문자를 기본으로 넣습니다(11장).

3.  프로바이더 스택: `AssetUrlsProvider` → `TldrawUiTranslationProvider` → `<TldrawEditor initialState="select">`(4.10절) → `<TldrawUi>`.

4.  `InsideOfEditorAndUiContext`가 마운트 시 `registerDefaultSideEffects(editor)`, 기본·테마 폰트 요청, `registerDefaultExternalContentHandlers`(13장), 그리고 사용자 `onMount`를 실행합니다.

`registerDefaultSideEffects`(`defaultSideEffects.ts`)는 UI 수준 규칙을 더합니다. 임베드 URL이 바뀌면 비율 재계산, 카메라가 멈추면 호버 도형 갱신, `croppingShapeId`가 설정되면 `select.crop` 상태로 전환하는 식입니다. "레코드가 바뀌면 도구 상태를 맞춘다"는 방향의 동기화입니다. undo나 원격 변경으로 크롭 상태가 바뀌어도 도구가 따라갑니다.

## 12.2 스타일 시스템

3장의 `StyleProp`이 에디터에서 어떻게 쓰이는지입니다.

- Editor 생성 시 도형 타입별 `styleProps[type]: Map<StyleProp, propKey>`를 만듭니다(4.2절).

- **getSharedStyles()**: select 도구에서 선택이 있으면 선택 도형(그룹은 자식까지)의 스타일을 모아 값이 같으면 `{ type: 'shared', value }`, 다르면 `{ type: 'mixed' }`입니다. 그 외에는 현재 도구의 `shapeType`이 쓰는 스타일을 "다음 도형 스타일"로 돌려줍니다. 스타일 패널은 이 값만 보고 그립니다.

- **setStyleForSelectedShapes(style, value)**: 선택 도형 중 그 스타일을 가진 것들의 해당 prop을 바꿉니다. 화살표의 `color`와 geo의 `color`는 같은 `DefaultColorStyle`이라 한 번에 바뀝니다.

- **setStyleForNextShapes(style, value)**: `instance.stylesForNextShape`에 기록합니다. 스타일 패널은 보통 두 메서드를 함께 호출합니다.

- 불투명도는 스타일이 아닌 레코드 필드라 별도 API(`getSharedOpacity`, `setOpacityForSelectedShapes`, `opacityForNextShape`)입니다.

- 스타일 패널은 `useRelevantStyles()`로 보여줄 스타일을 고릅니다.

## 12.3 테마

색의 실제 값은 레코드에 없고 테마에 있습니다. 레코드에는 `'blue'` 같은 이름만 저장되므로, 같은 문서가 라이트·다크 모드에서 다르게 보입니다.

```ts
interface TLTheme {
  id: TLThemeId; fontSize: number; lineHeight: number; strokeWidth: number
  fonts: TLThemeFonts                       // draw / sans / serif / mono
  colors: { light: TLThemeColors; dark: TLThemeColors }
}
// 각 색: solid, semi, pattern, fill, linedFill, frame*·note*·highlight(sRGB/P3) 변형
```

- `ThemeManager`(`editor/managers/ThemeManager/`)는 테마 목록과 현재 테마 ID를 Atom으로 들고, 사용자 `colorScheme`(`'light' | 'dark' | 'system'`)과 합쳐 현재 색 팔레트를 결정합니다. API: `getThemes`, `getCurrentTheme`, `setCurrentTheme`, `updateTheme(s)`.

- 테마는 `<Tldraw themes={...} initialTheme="...">`로 넣습니다. `registerColorsFromThemes`가 테마에 있는 색 이름을 `DefaultColorStyle`의 허용값에 추가하고, 테마에서 빠진 색은 제거합니다(3장의 `EnumStyleProp.addValues/removeValues`).

- 도형은 `getDisplayValues`(또는 `editor.getCurrentTheme()`)로 색·굵기·글꼴 크기를 구합니다. 이 값은 렌더 중 반응형으로 읽히므로 테마가 바뀌면 모든 도형이 다시 그려집니다.

- UI 색은 CSS 변수(`--tl-color-*`)이며, 컨테이너의 `tl-theme__light`/`tl-theme__dark` 클래스로 전환합니다. 미리 어두운 테마를 적용해 로딩 중 깜박임을 막는 코드가 `TldrawEditorWithLoadingStore`에 있습니다.

## 12.4 UI 컨텍스트 스택

`TldrawUiContextProvider`(`ui/context/TldrawUiContextProvider.tsx`)의 중첩 순서입니다.

1.  AssetUrlsProvider — 아이콘·폰트·번역 파일 URL

2.  TldrawUiTranslationProvider — 번역

3.  TldrawUiTooltipProvider

4.  TldrawUiEventsProvider — UI 이벤트(분석용) 콜백 `onUiEvent`

5.  TldrawUiToastsProvider, TldrawUiDialogsProvider

6.  BreakPointProvider — 컨테이너 폭 기반 반응형 레이아웃(`PORTRAIT_BREAKPOINTS = [0, 389, 436, 476, 580, 640, 840, 1023]`)

7.  TldrawUiComponentsProvider — 교체 가능한 컴포넌트

8.  ActionsProvider → ToolsProvider — 액션·도구 정의(overrides 적용)

## 12.5 액션과 도구 정의

**액션**(`ui/context/actions.tsx`)은 메뉴·단축키·빠른 실행에서 공유하는 명령 단위입니다.

```ts
interface TLUiActionItem {
  id: string                  // 'undo', 'group', 'export-as-png', 'zoom-in' ...
  label?: string | {...}      // 번역 키
  icon?: string | ReactElement
  kbd?: string                // 'cmd+z,ctrl+z' 처럼 쉼표로 대안 나열(약식 $ = Cmd/Ctrl, ? = Alt)
  readonlyOk?: boolean        // 읽기 전용에서도 허용
  isRequiredA11yAction?: boolean
  onSelect(source): void | Promise<void>
}
```

대부분의 `onSelect`는 `editor.markHistoryStoppingPoint()` 후 Editor 메서드 하나를 호출하고 `trackEvent`로 UI 이벤트를 남깁니다. **도구 정의**(`useTools.tsx`)는 도구바 버튼용으로, 주로 `editor.setCurrentTool(id)`을 부릅니다. geo 세부 도구(사각형·타원 등)는 geo 스타일을 바꾸고 geo 도구로 전환하는 정의입니다.

**overrides**: <span v-pre>`<Tldraw overrides={{ actions(editor, actions, helpers) {...}, tools(...), translations: {...} }}>`</span>로 기본 정의를 받아 수정된 객체를 돌려줍니다. 단축키 변경, 액션 교체·추가, 커스텀 도구 등록을 모두 이것으로 합니다.

**단축키**(`ui/hooks/useKeyboardShortcuts.ts`): hotkeys-js에서 가져온 파서로 액션·도구의 `kbd`를 등록합니다. `areShortcutsDisabled(editor)`(편집 중, 메뉴·대화상자 열림, 포커스 없음 등)이면 무시하지만 접근성 필수 액션은 예외입니다. 읽기 전용에서는 `readonlyOk` 도구만 등록합니다.

## 12.6 컴포넌트 교체

`components` prop은 두 층입니다.

- **에디터 컴포넌트**(`TLEditorComponents`): Canvas, Background, Grid, SvgDefs, ShapeWrapper, ShapeErrorFallback, OnTheCanvas, InFrontOfTheCanvas, LoadingScreen, ErrorFallback 등. 캔버스 자체의 구성 요소입니다(6.5절).

- **UI 컴포넌트**(`TLUiComponents`): ContextMenu, ActionsMenu, HelpMenu, ZoomMenu, MainMenu, Minimap, StylePanel, PageMenu, NavigationPanel, Toolbar, RichTextToolbar, ImageToolbar, VideoToolbar, KeyboardShortcutsDialog, QuickActions, HelperButtons, DebugPanel, DebugMenu, MenuPanel, TopPanel, SharePanel, CursorChatBubble, Dialogs, Toasts, FollowingIndicator, PeopleMenu 계열.

값을 `null`로 주면 숨기고, 컴포넌트를 주면 교체합니다. 기본 컴포넌트(`DefaultToolbar`, `DefaultMainMenu` 등)와 메뉴 항목 블록(`menu-items.tsx`), UI 원시 컴포넌트(`ui/components/primitives/`)를 내보내므로, 일부만 바꾼 메뉴를 조합할 수 있습니다. 미니맵은 캔버스에 도형 경계와 오버레이의 `renderMinimap`을 그립니다.

## 12.7 다국어와 접근성

- **번역**: 저장소 루트 `assets/translations/`에 53개 JSON이 있습니다. `TldrawUiTranslationProvider`가 사용자 `locale`에 맞는 파일을 불러오고, 없는 키는 영어로 대체합니다. `useTranslation()`이 키를 문자열로 바꿉니다. RTL 언어면 `dir`이 바뀌며, 노트 탭 방향 같은 동작도 따라갑니다. Editor 코어에도 최소한의 `TLI18nAdapter`(`config/TLI18n.ts`)가 있어 도형의 기본 이름 등에 씁니다.

- **접근성**: `ui/context/a11y.tsx`의 `announce(msg)`가 aria-live 영역으로 선택 변경 등을 읽어줍니다. `ShapeUtil.getAriaDescriptor`와 `getText`가 도형 설명을 제공합니다. Tab·방향키로 도형 사이를 이동하는 `selectAdjacentShape`, 접근성 메뉴, 모션 감소(애니메이션 속도 0, 6장) 설정이 있습니다.

## 12.8 사용자 설정

`UserPreferencesManager`는 `TLUserPreferences`(id, name, color, locale, colorScheme, animationSpeed, isSnapMode, isWrapMode, isDynamicSizeMode, isPasteAtCursorMode, inputMode, 줌 방향 반전 등)를 관리합니다. 기본은 1장의 `localStorageAtom` 기반 저장이며 탭 간 동기화됩니다(`config/TLUserPreferences.ts`). 앱은 `user` prop에 시그널을 넘겨 서버 계정과 연동할 수 있습니다. 시스템 다크 모드·모션 감소는 `matchMedia`로 감지합니다.

## 12.9 이 장의 핵심 정리

- `<Tldraw>`는 기본 유틸·도구를 병합(같은 ID면 교체)해 `<TldrawEditor>`를 만들고, 그 위에 UI를 얹습니다.

- 스타일은 StyleProp 역매핑으로 도형 종류를 넘어 공유·일괄 변경되고, 색 값은 테마가 해석합니다.

- UI는 액션·도구·컴포넌트·번역을 overrides로 바꿀 수 있는 얕은 층이며, 모든 동작은 Editor API 호출입니다.

**다음 장**: 에셋, 외부 콘텐츠, 클립보드, 내보내기.
