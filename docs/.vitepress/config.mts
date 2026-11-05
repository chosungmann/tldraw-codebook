import { defineConfig } from 'vitepress'

const chapters = (items: [string, string][]) =>
	items.map(([text, slug]) => ({ text, link: `/chapters/${slug}` }))

export default defineConfig({
	lang: 'ko-KR',
	title: 'tldraw 코드북',
	description: 'tldraw 소스코드를 원리부터 구현까지 읽는 비공식 가이드북',
	base: '/tldraw-codebook/',
	cleanUrls: true,
	lastUpdated: true,

	head: [['meta', { name: 'theme-color', content: '#2f80ed' }]],

	markdown: {
		lineNumbers: false,
	},

	themeConfig: {
		nav: [
			{ text: '개요', link: '/' },
			{ text: 'tldraw 저장소', link: 'https://github.com/tldraw/tldraw' },
			{ text: 'tldraw.dev', link: 'https://tldraw.dev' },
		],

		sidebar: [
			{ text: '개요', link: '/' },
			{
				text: '기반: 반응성과 데이터',
				items: chapters([
					['1장 반응성 엔진(state)', '01-state'],
					['2장 레코드 저장소(store)', '02-store'],
					['3장 데이터 모델(tlschema)', '03-tlschema'],
				]),
			},
			{
				text: '에디터 동작',
				items: chapters([
					['4장 Editor 해부', '04-editor'],
					['5장 입력·이벤트·상태 차트', '05-input-events'],
					['6장 좌표·카메라·렌더링', '06-camera-rendering'],
					['7장 도형 시스템(ShapeUtil)', '07-shapes'],
					['8장 바인딩과 화살표', '08-bindings-arrows'],
					['9장 선택·변형·스냅', '09-selection-transform'],
				]),
			},
			{
				text: '기본 제품 층',
				items: chapters([
					['10장 기본 도형과 도구', '10-default-shapes-tools'],
					['11장 텍스트·폰트', '11-text-fonts'],
					['12장 스타일·테마·UI', '12-styles-themes-ui'],
					['13장 에셋·클립보드·내보내기', '13-assets-clipboard-export'],
				]),
			},
			{
				text: '지속성과 동시 편집',
				items: chapters([
					['14장 로컬 지속성·탭 동기화', '14-persistence'],
					['15장 동시 편집 I: 클라이언트', '15-sync-client'],
					['16장 동시 편집 II: 서버', '16-sync-server'],
				]),
			},
			{
				text: '주변',
				items: chapters([['17장 부가 패키지·앱', '17-extras']]),
			},
		],

		socialLinks: [{ icon: 'github', link: 'https://github.com/chosungmann/tldraw-codebook' }],

		outline: { level: [2, 3], label: '이 페이지에서' },
		docFooter: { prev: '이전 장', next: '다음 장' },
		lastUpdated: { text: '마지막 수정' },
		darkModeSwitchLabel: '테마',
		lightModeSwitchTitle: '밝은 테마로',
		darkModeSwitchTitle: '어두운 테마로',
		sidebarMenuLabel: '목차',
		returnToTopLabel: '맨 위로',
		langMenuLabel: '언어',

		search: {
			provider: 'local',
			options: {
				translations: {
					button: { buttonText: '검색', buttonAriaLabel: '검색' },
					modal: {
						displayDetails: '자세히 보기',
						resetButtonTitle: '검색어 지우기',
						backButtonTitle: '닫기',
						noResultsText: '결과가 없습니다',
						footer: {
							selectText: '선택',
							navigateText: '이동',
							closeText: '닫기',
						},
					},
				},
			},
		},

		footer: {
			message: '비공식 학습 자료입니다. tldraw 팀과 관련이 없습니다.',
			copyright: '코드 발췌의 저작권은 tldraw Inc.에 있으며 tldraw 라이선스를 따릅니다.',
		},
	},
})
