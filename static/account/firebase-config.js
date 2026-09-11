// Firebase web config for project upscaler-e9010.
//
// This is NOT a secret. The apiKey here is a public project identifier, not a
// credential — it identifies which project a request belongs to and is visible
// in any browser. Access is controlled by Firebase authorized domains and by
// API key referrer restrictions, not by keeping this file private.
//
// Deliberately minimal: auth needs only these four fields. storageBucket and
// messagingSenderId are omitted because nothing here touches Storage or FCM,
// and measurementId is omitted so Analytics cannot be initialised by accident —
// that would start tracking on the website and needs its own privacy review.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAW1uzPkSWLAULCE1XZIypVmUMZ72N6kp8',
  authDomain: 'upscaler-e9010.firebaseapp.com',
  projectId: 'upscaler-e9010',
  appId: '1:522513119522:web:1d9243038f0f0456844d7b',
};

// Pinned deliberately. The gstatic modules hardcode absolute URLs to each other
// at this exact version, so app and auth must always move together.
export const FIREBASE_SDK_VERSION = '11.6.0';
