import type { Lang, MessageKey } from './types';

const ko = {
  app_name: 'World Shaker',
  'common.cancel': '취소',
  'common.continue': '계속',
  'common.confirm': '확인',
  'common.back': '뒤로',
  'quota.tomorrow': '내일 다시 만나요',
  'conversation.failure_overlay.restart': '다시 시작',
  'conversation.failure_overlay.close': '닫기',
  'badge.verified_human': '인증된 인간',
} as const satisfies Record<MessageKey, string>;

const en = {
  app_name: 'World Shaker',
  'common.cancel': 'Cancel',
  'common.continue': 'Continue',
  'common.confirm': 'Confirm',
  'common.back': 'Back',
  'quota.tomorrow': 'Come back tomorrow',
  'conversation.failure_overlay.restart': 'Restart',
  'conversation.failure_overlay.close': 'Close',
  'badge.verified_human': 'Verified Human',
} as const satisfies Record<MessageKey, string>;

export const messages = { ko, en } as const satisfies Record<Lang, Record<MessageKey, string>>;

export type Messages = typeof messages;
