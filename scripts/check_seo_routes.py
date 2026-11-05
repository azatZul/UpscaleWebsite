#!/usr/bin/env python3
"""Exercise asset-first and Worker-first routing against Wrangler or a deployed site."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import urllib.error
import urllib.request
from urllib.parse import urljoin, urlparse


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--origin', default='http://localhost:8787')
    parser.add_argument('--noindex', action='store_true')
    parser.add_argument('--output')
    args = parser.parse_args()
    cases=[]
    for prefix in ['', '/es', '/fr', '/de', '/ja', '/zh', '/ru']:
        for method in ['GET','HEAD']:
            for navigation in [False,True]:
                for suffix in ['', '/', '/index.html']:
                    cases.append((f'{prefix}/free-upscale{suffix}?utm_source=test&mode=restore',method,navigation,301,f'{prefix}/upscale/?utm_source=test&mode=restore'))
        for path in [prefix+'/',prefix+'/guides/',prefix+'/upscale/']:
            cases.append((path,'GET',True,200,None))
        cases.append((prefix+'/index.html?mode=device','GET',True,301,prefix+'/?mode=device'))
    for path in ['/free-upscale-xyz','/ru/free-upscale-xyz','/free-upscale/extra','/ru/extra/free-upscale/','/xx/free-upscale/','/upscale/foo','/ru/upscale/foo']:
        for method in ['GET','HEAD']:
            for nav in [False,True]: cases.append((path,method,nav,404,None))
    cases.append(('/api/seo-missing','GET',False,401,None))
    def check(case):
        path,method,nav,status,location=case
        headers={'User-Agent':'Mozilla/5.0'}
        if nav: headers['Sec-Fetch-Mode']='navigate'
        try:
            opener=urllib.request.build_opener(NoRedirect)
            try:r=opener.open(urllib.request.Request(args.origin+path,method=method,headers=headers),timeout=30)
            except urllib.error.HTTPError as error:r=error
            data=r.read()
            result={'path':path,'method':method,'navigation':nav,'status':r.status,'location':r.headers.get('Location'),'bytes':len(data),'headers':dict(r.headers),'errors':[]}
            errors=result['errors']
            if r.status!=status:errors.append(f'Expected status {status}')
            if location and urljoin(args.origin+'/',r.headers.get('Location',''))!=args.origin+location:errors.append(f'Expected Location {location}')
            if args.noindex and r.status not in [301,302,307,308] and 'noindex' not in r.headers.get('X-Robots-Tag',''):errors.append('Missing staging noindex header')
            if status==404 and method=='GET':
                html=data.decode()
                if 'error-comparison' not in html:errors.append('Missing custom HTML error body')
                if '/assets/marketing/' in html:errors.append('Analytics on error page')
                if '/upscale/' in path and r.headers.get('Cross-Origin-Embedder-Policy')!='require-corp':errors.append('COEP missing')
            return result
        except Exception as error:return {'path':path,'errors':[str(error)]}
    with ThreadPoolExecutor(max_workers=5) as pool:results=list(pool.map(check,cases))
    if args.output:Path(args.output).write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
    failures=[r for r in results if r['errors']]
    print(f'{len(results)-len(failures)}/{len(results)} routing checks passed at {args.origin}')
    for result in failures:print(result)
    raise SystemExit(bool(failures))


if __name__=='__main__':main()
