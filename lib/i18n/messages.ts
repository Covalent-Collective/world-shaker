import type { Lang, MessageKey } from './types';

const ko = {
  app_name: 'World Shaker',
  'common.cancel': '취소',
  'common.continue': '계속',
  'common.confirm': '확인',
  'common.back': '뒤로',
  // TODO(copy-review): proposed: '오늘은 여기까지예요' — reason: '내일 다시 만나요' frames quota exhaustion as a farewell invitation; proposed is calmer (해요체) and states the day's end without implying the user must return
  'quota.tomorrow': '내일 다시 만나요',
  'conversation.preparing': '대화를 준비 중입니다...',
  'conversation.complete': '대화 완료',
  // TODO(copy-review): proposed: '다시 시도하기' — reason: '다시 시작' implies resetting the whole flow; '다시 시도하기' signals a retry of the failed step, which is more accurate and less alarming
  'conversation.failure_overlay.restart': '다시 시작',
  // TODO(copy-review): proposed: '괜찮아요' — reason: '닫기' is a cold UI label; for a failure overlay, a softer acknowledgment ('It's okay / dismiss') better fits the quiet-protector register
  'conversation.failure_overlay.close': '닫기',
  // TODO(copy-review): proposed: '인증된 사람' — reason: '인간' (human) can read as clinical or robotic; '사람' (person) is warmer and less sci-fi, better matching the quiet-protector tone
  'badge.verified_human': '인증된 인간',
  // TODO(copy-review): proposed: 'World Shaker를 시작하며' — reason: '소개' (introduction/introducing) reads like a product tour label; '시작하며' frames the intro as a personal beginning rather than a feature walkthrough
  'intro.title': 'World Shaker 소개',
  'intro.skip': '건너뛰기',
  'verify.title': '인간 인증',
  'verify.subtitle': 'World ID로 본인이 인간임을 증명하세요',
  'verify.cta': 'World ID로 인증하기',
  'verify.error_toast': '인증에 실패했습니다. 다시 시도해 주세요.',
  'interview.placeholder': '편하게 이야기해 주세요…',
  'interview.next': '다음',
  'interview.complete': '완료',
  'interview.skeleton.q1': '요즘 가장 자주 웃게 되는 순간은 언제인가요?',
  'interview.skeleton.q2': '최근에 당신을 놀라게 한 일이 있다면 무엇이었나요?',
  'interview.skeleton.q3': '요즘 마음 한구석에서 정리 중인 일이 있다면요?',
  'interview.skeleton.q4': '하루 중 혼자만의 시간을 어떻게 보내세요?',
  'interview.skeleton.q5': '최근에 누군가에게 고마웠던 순간이 있다면 들려주세요.',
  'interview.skeleton.q6': '앞으로 한 달 안에 꼭 해보고 싶은 작은 일이 있다면요?',
  // TODO(copy-review): proposed: '서로가 닿았어요' — reason: '연결됐어요' (connected) is a technical-sounding metaphor; '닿았어요' (reached/touched) is softer and more emotionally resonant without gamification
  'success.title': '서로가 연결됐어요',
  // TODO(copy-review): proposed: '대화 열기' — reason: '대화 시작하기' is accurate but feels like a CTA button label; '대화 열기' is shorter, action-first, and avoids the start/begin framing that implies a task
  'success.starter_label': '대화 시작하기',
  'success.world_chat_cta': 'World Chat에서 만나기',
  'match.why_click_label': '왜 끌렸을까',
  'match.watch_out_label': '조심할 점',
  'match.toggle_full': '전문 보기',
  'match.toggle_highlights': '하이라이트로',
  'match.like': '좋아요',
  'match.skip': '건너뛰기',
  // TODO(copy-review): proposed: '오늘의 만남' — reason: '산책' (stroll/walk) is the product metaphor but may not land in all contexts; '만남' (encounter/meeting) is direct and warm; keep '산책' only if the stroll metaphor is reinforced visually
  'stroll.title': '오늘의 산책',
  'stroll.quota_remaining': '오늘 {remaining}회 남았어요',
  // TODO(copy-review): proposed: '내일 {time}에 다시 이어요' — reason: '다시 만나요' borrows reunion framing; '다시 이어요' (pick back up) is quieter and avoids over-promising an emotional encounter
  'stroll.tomorrow_at': '내일 {time}에 다시 만나요',
  // TODO(copy-review): proposed: '오늘은 모두 만났어요' — reason: '마감되었어요' (closed/deadline-passed) uses closure language borrowed from deadlines; '모두 만났어요' is kinder and states the positive (you've met everyone available today)
  'stroll.streaming_paused': '오늘은 산책이 모두 마감되었어요',
  'stroll.empty': '지금은 만날 사람이 없어요',
  // TODO(copy-review): proposed: '탭하면 시작돼요' — reason: '탭해서 만나기' is directional instruction; '탭하면 시작돼요' is gentler, explains the outcome rather than commanding the action
  'stroll.tap_to_start': '탭해서 만나기',
  'safety.report': '신고하기',
  'safety.cancel': '취소',
  'safety.report_reason.harassment': '괴롭힘',
  'safety.report_reason.hateful': '혐오 발언',
  'safety.report_reason.catfish': '사칭',
  'safety.report_reason.underage': '미성년자',
  'safety.report_reason.nsfw': '성적 콘텐츠',
  'safety.report_reason.spam': '스팸',
  'safety.report_reason.other': '기타',
  'safety.detail_placeholder': '추가로 알려주실 내용 (선택)',
  'safety.hide_and_report': '숨기고 신고하기',
  'home.preparing.label': '한 막의 시작',
  'home.preparing.title': '당신의 클론이\n무대로 향합니다',
  'home.preparing.body': '잠시만요. 곧 첫 만남의 막이 오릅니다.',
  'encounter.titlecard.label': 'Encounter № 1',
  'encounter.titlecard.subtitle': '낯선 두 사람,\n같은 빛 아래.',
  'encounter.header': 'World Shaker · 첫 만남',
  'encounter.scenelabel': '하나의 테이블',
  'encounter.fin': '— 막을 내립니다 —',
  'encounter.abandoned': '대화가 잠시 멈췄습니다.',
} as const satisfies Record<MessageKey, string>;

const en = {
  app_name: 'World Shaker',
  'common.cancel': 'Cancel',
  'common.continue': 'Continue',
  'common.confirm': 'Confirm',
  'common.back': 'Back',
  // TODO(copy-review): proposed: 'That's all for today' — reason: 'Come back tomorrow' is a friendly push but carries a mild imperative; 'That's all for today' is quieter, states the limit without directing the user to return
  'quota.tomorrow': 'Come back tomorrow',
  'conversation.preparing': 'Preparing the conversation...',
  'conversation.complete': 'Conversation complete',
  // TODO(copy-review): proposed: 'Try again' — reason: 'Restart' implies the full flow resets; 'Try again' is softer, lower-stakes, and matches what the action actually does (retry the failed step)
  'conversation.failure_overlay.restart': 'Restart',
  // TODO(copy-review): proposed: 'Dismiss' — reason: 'Close' is neutral but clinical; 'Dismiss' is equally concise while signalling the user is in control of removing the overlay
  'conversation.failure_overlay.close': 'Close',
  // TODO(copy-review): proposed: 'Verified person' — reason: 'Verified Human' is technically accurate but carries a sci-fi / robotic register; 'Verified person' is warmer and less clinical
  'badge.verified_human': 'Verified Human',
  // TODO(copy-review): proposed: 'Getting started' — reason: 'Introducing World Shaker' reads like a marketing headline; 'Getting started' is quieter, action-oriented, and less self-promotional
  'intro.title': 'Introducing World Shaker',
  'intro.skip': 'Skip',
  'verify.title': 'Verify Your Humanity',
  'verify.subtitle': 'Prove you are human with World ID',
  'verify.cta': 'Verify with World ID',
  'verify.error_toast': 'Verification failed. Please try again.',
  'interview.placeholder': 'Take your time — speak freely.',
  'interview.next': 'Next',
  'interview.complete': 'Done',
  'interview.skeleton.q1': 'What makes you laugh these days?',
  'interview.skeleton.q2': 'What is the last thing that genuinely surprised you?',
  'interview.skeleton.q3': 'Is there something you are quietly working through right now?',
  'interview.skeleton.q4': 'How do you usually spend time alone?',
  'interview.skeleton.q5': 'Tell me about a moment recently when someone made you grateful.',
  'interview.skeleton.q6': 'What is one small thing you want to try in the next month?',
  // TODO(copy-review): proposed: 'You found each other' — reason: 'You matched each other' borrows dating-app gamification framing ('match' implies a game result); 'You found each other' is more human, less transactional
  'success.title': 'You matched each other',
  // TODO(copy-review): proposed: 'Open conversation' — reason: 'Start the conversation' is directional and imperative; 'Open conversation' is shorter, action-oriented, and avoids the instructional register
  'success.starter_label': 'Start the conversation',
  'success.world_chat_cta': 'Meet on World Chat',
  'match.why_click_label': 'Why it clicked',
  'match.watch_out_label': 'Watch out for',
  'match.toggle_full': 'Full transcript',
  'match.toggle_highlights': 'Back to highlights',
  'match.like': 'Like',
  'match.skip': 'Skip',
  // TODO(copy-review): proposed: "Today's encounters" — reason: "Today's stroll" uses the product metaphor; 'encounters' is more evocative of genuine meeting without borrowing a leisurely-walk frame that may not translate across cultures
  'stroll.title': "Today's stroll",
  'stroll.quota_remaining': '{remaining} left today',
  // TODO(copy-review): proposed: 'Back tomorrow at {time}' — reason: 'See you again tomorrow at {time}' is warm but slightly over-promises a personal reunion; 'Back tomorrow at {time}' states the fact plainly without anthropomorphising the service
  'stroll.tomorrow_at': 'See you again tomorrow at {time}',
  // TODO(copy-review): proposed: "You've met everyone available today" — reason: "Today's stroll is fully closed" uses 'closed' (deadline/shop-closure framing); the proposed alternative is positive and informational
  'stroll.streaming_paused': "Today's stroll is fully closed",
  'stroll.empty': 'No one to meet right now',
  // TODO(copy-review): proposed: 'Tap to begin' — reason: 'Tap to start' is fine but 'begin' is slightly softer and less mechanical; borderline — keep if team prefers 'start' for consistency with other labels
  'stroll.tap_to_start': 'Tap to start',
  'safety.report': 'Report',
  'safety.cancel': 'Cancel',
  'safety.report_reason.harassment': 'Harassment',
  'safety.report_reason.hateful': 'Hate speech',
  'safety.report_reason.catfish': 'Catfishing',
  'safety.report_reason.underage': 'Underage',
  'safety.report_reason.nsfw': 'NSFW',
  'safety.report_reason.spam': 'Spam',
  'safety.report_reason.other': 'Other',
  'safety.detail_placeholder': 'Anything else? (optional)',
  'safety.hide_and_report': 'Hide and report',
  'home.preparing.label': 'A scene in waiting',
  'home.preparing.title': 'Your clone is\nstepping onto the stage',
  'home.preparing.body': 'A moment more. The first encounter is about to begin.',
  'encounter.titlecard.label': 'Encounter № 1',
  'encounter.titlecard.subtitle': 'Two strangers,\nunder the same light.',
  'encounter.header': 'World Shaker · First Encounter',
  'encounter.scenelabel': 'One Table',
  'encounter.fin': '— curtain —',
  'encounter.abandoned': 'The conversation paused.',
} as const satisfies Record<MessageKey, string>;

export const messages = { ko, en } as const satisfies Record<Lang, Record<MessageKey, string>>;

export type Messages = typeof messages;
