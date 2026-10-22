/**
 * 应用配置与全局常量
 */

export const PAGE_SIZE = 30;
export const TOP_LOAD_THRESHOLD = 60;
export const ORIGINAL_FETCH_TIMEOUT = 5000;
export const THUMBNAIL_MAX_EDGE = 1200;
export const LARGE_IMAGE_THRESHOLD_BYTES = 3 * 1024 * 1024; // 3MB
export const HD_COMPRESS_MAX_EDGE = 3840;

export const STORAGE_KEYS = {
  PASSWORD: 'web-clipboard-password',
  USER_ID: 'web-clipboard-user-id',
  DURATION_LIMIT: 'web-clipboard-limit-duration',
  LOGIN_TIMESTAMP: 'web-clipboard-login-timestamp',
  SESSION_MINUTES: 'web-clipboard-session-minutes',
  ACTIVE_TAB: 'web-clipboard-active-tab'
};
