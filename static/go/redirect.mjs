import { APP_STORE_URL, detectPlatform, playStoreURL } from './links.mjs';

const platform = detectPlatform(navigator);
const fallback = document.getElementById('fallback');
const appStoreLink = document.getElementById('app-store');
const playStoreLink = document.getElementById('play-store');
const googlePlay = playStoreURL(location.search);
appStoreLink.href = APP_STORE_URL;
playStoreLink.href = googlePlay;

if (platform === 'other') {
  // Desktop and unknown devices get plain store links, with no automatic guess.
  fallback.hidden = false;
} else {
  const isIOS = platform === 'ios';
  const destination = isIOS ? APP_STORE_URL : googlePlay;
  appStoreLink.parentElement.hidden = !isIOS;
  playStoreLink.parentElement.hidden = isIOS;
  document.getElementById('message').textContent = 'If the store did not open, use the link below.';
  // Keep mobile visitors on a blank redirect page. Show a plain fallback only
  // when a browser blocks the navigation. No clipboard, storage or iOS payload.
  const timer = setTimeout(() => { fallback.hidden = false; }, 1500);
  window.addEventListener('pagehide', () => clearTimeout(timer), { once: true });
  location.replace(destination);
}
