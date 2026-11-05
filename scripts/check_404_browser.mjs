const {chromium}=await import(process.env.USCALE_PLAYWRIGHT_MODULE || 'playwright');
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,...(process.env.USCALE_TEST_CHANNEL ? {channel:process.env.USCALE_TEST_CHANNEL} : {})});
const origin=process.env.USCALE_TEST_ORIGIN || 'http://localhost:8787';
const results=[];
for(const options of [{name:'dark',colorScheme:'dark'},{name:'mobile-reduced',colorScheme:'light',reducedMotion:'reduce',viewport:{width:390,height:844},isMobile:true,hasTouch:true},{name:'no-js',javaScriptEnabled:false,colorScheme:'light'}]){
 const {name,...config}=options;const context=await browser.newContext(config);const page=await context.newPage();const external=[],errors=[],bad=[];
 page.on('request',r=>{if(new URL(r.url()).origin!==origin)external.push(r.url());});page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.request().resourceType()!=='document'&&r.status()!==200)bad.push([r.status(),r.url()]);});
 const response=await page.goto(origin+'/ru/upscale/foo');assert.equal(response.status(),404);assert.equal(response.headers()['cross-origin-embedder-policy'],'require-corp');
 const slider=page.locator('#clarity');
 if(name==='no-js'){assert.equal(await slider.isDisabled(),true);assert.equal(await page.locator('.error-stores a').count(),3);}
 else if(name==='mobile-reduced'){assert.equal(await slider.inputValue(),'50');await page.waitForTimeout(2200);assert.equal(await slider.inputValue(),'50');await slider.tap({position:{x:180,y:40}});assert.notEqual(await slider.inputValue(),'50');}
 else{await slider.focus();await slider.press('End');assert.equal(await slider.inputValue(),'100');await page.waitForTimeout(2200);assert.equal(await slider.inputValue(),'100');await slider.press('Home');assert.equal(await slider.inputValue(),'0');}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);
 results.push({name,status:response.status(),external,errors,bad,passed:true});await context.close();
}
await browser.close();await writeFile('docs/seo-release/404-browser-qa.json',JSON.stringify(results,null,2)+'\n');console.log(results);
