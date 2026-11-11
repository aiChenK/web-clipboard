import { STORAGE_KEYS } from './config.js';

export function getClientId() {
  let clientId = localStorage.getItem(STORAGE_KEYS.CLIENT_ID);
  if (!clientId) {
    // getRandomValues 在局域网 HTTP 页面中也可用。
    clientId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    localStorage.setItem(STORAGE_KEYS.CLIENT_ID, clientId);
  }
  return clientId;
}
