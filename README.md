# Tldraw Codebook

[tldraw](https://github.com/tldraw/tldraw) 소스코드를 직접 읽고, SDK의 동작 원리와 구현을 주제별로 정리한 비공식 가이드북입니다.

**읽기:** https://chosungmann.github.io/tldraw-codebook/

- 반응성 엔진(state), 레코드 저장소(store), 데이터 모델(tlschema)부터 Editor, 입력·상태 차트, 렌더링, 도형·바인딩, 동시 편집(sync-core·sync), 부가 패키지까지 17장으로 구성했습니다.
- 기준 커밋: tldraw `main`의 `27b47cbf`(2026-11-04)

> 이 저장소는 tldraw 팀이 만든 공식 문서가 아닙니다. 공식 문서는 [tldraw.dev](https://tldraw.dev)를 참고하세요. 본문에 실린 코드 발췌의 저작권은 tldraw Inc.에 있으며 [tldraw 라이선스](https://github.com/tldraw/tldraw/blob/main/LICENSE.md)를 따릅니다.

## 로컬에서 보기

```bash
npm install
npm run docs:dev
```

## 배포

`main`에 푸시하면 GitHub Actions(`.github/workflows/deploy.yml`)가 VitePress로 사이트를 빌드해 GitHub Pages에 배포합니다. 저장소 Settings → Pages에서 Source를 **GitHub Actions**로 설정해야 합니다.
