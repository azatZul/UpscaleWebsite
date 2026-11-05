const {chromium}=await import(process.env.USCALE_PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,...(process.env.USCALE_TEST_CHANNEL ? {channel:process.env.USCALE_TEST_CHANNEL} : {})});
const report=[];
const origin=process.env.USCALE_TEST_ORIGIN || 'http://localhost:8787';
for(const config of [{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true},{viewport:{width:1440,height:1000},deviceScaleFactor:1}]){
 const context=await browser.newContext(config),page=await context.newPage(),requests=[],errors=[];
 page.on('request',r=>{if(r.resourceType()==='image')requests.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/');await page.waitForTimeout(1800);
 const idle=[...requests];assert.equal(idle.some(u=>/hero_girls_play|hero_anime/.test(u)),false,'alternate hero images loaded without interest');
 const hero=page.locator('.hero-stage');const before=hero.locator('img.b'),after=hero.locator('img.a-img');
 const first=await after.evaluate(i=>({src:i.currentSrc,srcset:i.srcset,sizes:i.sizes,width:i.getBoundingClientRect().width}));assert.match(first.src,/responsive/);
 const buttons=hero.locator('.cmp-tab');await buttons.nth(1).focus();await page.waitForTimeout(200);await buttons.nth(1).click();
 await page.waitForFunction(()=>document.querySelector('.hero-stage img.a-img').complete);
 const second=await after.evaluate(i=>({src:i.currentSrc,srcset:i.srcset,sizes:i.sizes}));assert.match(second.src,/hero_girls_play_after/);assert.match(await before.getAttribute('srcset'),/hero_girls_play_before/);assert.ok(second.srcset&&!second.srcset.includes('spiderman'));
 await buttons.nth(2).click();await buttons.nth(0).click();assert.match(await after.getAttribute('srcset'),/hero_spiderman_after/);
 assert.deepEqual(errors,[]);report.push({viewport:config.viewport,dpr:config.deviceScaleFactor,idleImages:idle,first,second,errors,passed:true});await context.close();
}
await browser.close();await writeFile('docs/seo-release/images-browser-qa.json',JSON.stringify(report,null,2)+'\n');console.log(report.map(r=>({viewport:r.viewport,passed:r.passed,src:r.first.src})));
