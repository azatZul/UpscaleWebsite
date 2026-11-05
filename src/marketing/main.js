import {createAnalytics, storedConsent, webIdentity, forgetIdentity, AMPLITUDE_KEY, CONSENT_EVENT} from '../tool/analytics-core.js';

export function pageContext(pathname, locale) {
  const path = pathname.replace(/^\/(es|fr|de|ja|zh|ru)(?=\/|$)/, '') || '/';
  return {platform:'web',environment:'production',locale,page_path:pathname,
    page_type:path==='/'?'home':path.startsWith('/guides/')?'guide':path.startsWith('/gallery')?'gallery':path.includes('compare')?'compare':'other'};
}

export function installMarketing({document,location,storage,load=()=>import('@amplitude/analytics-browser')}={}) {
  // The tool owns its events. Unknown hosts never download or initialize the SDK.
  if(location.hostname!=='upscales.app' || /(?:^|\/)upscale(?:\/|$)/.test(location.pathname)) return;
  let allowed=storedConsent(storage)===true;
  let client, analytics, loading;
  let pending=[];
  const context=pageContext(location.pathname,document.documentElement.lang);
  function connect() {
    if(!allowed || analytics || loading) return;
    loading=load().then(module=>{
      client=module;
      if(!allowed) return;
      client.init(AMPLITUDE_KEY,webIdentity(storage),{identityStorage:'localStorage',autocapture:false,fetchRemoteConfig:false,transport:'beacon'});
      analytics=createAnalytics({client,consent:true,context,forget:()=>forgetIdentity(storage)});
      const held=pending;pending=[];
      held.forEach(properties=>analytics.trackEvent('tap',properties));
    }).catch(()=>{pending=[];}).finally(()=>{loading=undefined;});
  }
  const consent=event=>{
    allowed=Boolean(event.detail?.analytics);
    if(!allowed) {pending=[];analytics?.setConsent(false);forgetIdentity(storage);}
    else {analytics?.setConsent(true);connect();}
  };
  document.addEventListener(CONSENT_EVENT,consent);
  const click=event=>{
    const link=event.target.closest?.('a[data-cta]');
    const stores={appstore:'app_store',macappstore:'mac_app_store',googleplay:'google_play'};
    if(!link || !stores[link.dataset.cta] || !allowed) return;
    const properties={...context,element:link.dataset.cta,screen:context.page_type,store:stores[link.dataset.cta],
      placement:link.closest('.hero')?'hero':link.closest('footer')?'footer':link.closest('.inline-cta')?'inline':'other'};
    if(analytics) {analytics.trackEvent('tap',properties);analytics.flush();}
    else {if(pending.length<20) pending.push(properties);connect();}
  };
  document.addEventListener('click',click);
  document.defaultView?.addEventListener('pagehide',()=>analytics?.flush());
  connect();
}

if(typeof document!=='undefined') {
  let storage;try {storage=localStorage;}catch{}
  installMarketing({document,location,storage});
}
