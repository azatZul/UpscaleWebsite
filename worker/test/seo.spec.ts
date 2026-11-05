import {exports} from 'cloudflare:workers';
import {describe,expect,it} from 'vitest';
const fetchWorker=(path:string,init?:RequestInit)=>exports.default.fetch(new Request('https://example.com'+path,init));

describe('static SEO routing',()=>{
  for(const prefix of ['', '/es','/fr','/de','/ja','/zh','/ru']) {
    for(const headers of [undefined,{'Sec-Fetch-Mode':'navigate'}]) {
      it(`preserves legacy navigation and locale ${prefix} ${JSON.stringify(headers)}`,async()=>{
        for(const method of ['GET','HEAD']) for(const suffix of ['', '/', '/index.html']) {
          const response=await fetchWorker(`${prefix}/free-upscale${suffix}?utm_source=test&mode=restore`,{method,headers,redirect:'manual'});
          expect(response.status).toBe(301);
          expect(response.headers.get('Location')).toBe(`${prefix}/upscale/?utm_source=test&mode=restore`);
        }
      });
    }
  }
  it('returns full error pages through the assets binding, including isolated routes',async()=>{
    for(const path of ['/free-upscale-xyz','/ru/free-upscale-xyz','/free-upscale/extra','/ru/extra/free-upscale/','/xx/free-upscale/','/upscale/foo','/ru/upscale/foo']) {
      for(const headers of [undefined,{'Sec-Fetch-Mode':'navigate'}]) {
        const response=await fetchWorker(path,{headers,redirect:'manual'});
        expect(response.status,path).toBe(404);
        expect(response.headers.get('Location')).toBeNull();
        const html=await response.text();
        expect(html).toContain('error-comparison');
        expect(html).toContain('noindex,follow');
        expect(html).not.toContain('/assets/marketing/');
        expect(html).toContain(path.startsWith('/ru/')?'Страница потерялась.':'Page lost.');
      }
    }
  });
  it('canonicalizes explicit public indexes without loops and preserves query',async()=>{
    for(const path of ['/index.html','/ru/index.html','/guides/index.html','/ru/upscale/index.html']) {
      const response=await fetchWorker(path+'?mode=device',{redirect:'manual'});
      expect(response.status,path).toBe(301);
      const location=response.headers.get('Location')!;
      expect(location).toContain('?mode=device');
      const destination=await fetchWorker(location,{redirect:'manual'});
      expect(destination.status,location).toBe(200);
      await destination.body?.cancel();
    }
  });
});
