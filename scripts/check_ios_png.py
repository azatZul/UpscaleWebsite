import argparse
import glob
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def rpc(base, path, data, timeout=45):
    req = urllib.request.Request(base + path, data=json.dumps(data).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            envelope = json.load(response)
    except urllib.error.HTTPError as error:
        with error:
            detail = error.read().decode('utf-8', errors='replace')
        raise RuntimeError(f'WebDriver HTTP {error.code}: {detail}') from error
    # W3C protocol errors use a non-2xx HTTP status. A successful execute
    # response may itself contain the test's error, and must be saved intact.
    if not isinstance(envelope, dict) or 'value' not in envelope:
        raise RuntimeError('Malformed WebDriver response: missing value')
    return envelope['value']


SCRIPT = '''
const code=arguments[0];
window.__pngMax={state:'starting',createdAt:new Date().toISOString(),runs:[],events:[],width:arguments[1],height:arguments[2],requestedRuns:arguments[3],environment:{userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,crossOriginIsolated}};
const recordEvent=type=>window.__pngMax.events.push({type,at:new Date().toISOString(),hidden:document.hidden,run:window.__pngMax.run,completed:window.__pngMax.completed});
document.addEventListener('visibilitychange',()=>recordEvent('visibilitychange'));
window.addEventListener('pagehide',()=>recordEvent('pagehide'));
(async()=>{
 let lock;try{lock=await navigator.wakeLock.request('screen');window.__pngMax.wakeLockGranted=true;lock.addEventListener('release',()=>recordEvent('wake-lock-released'));}catch(error){window.__pngMax.wakeLockGranted=false;window.__pngMax.wakeLockError=String(error);}
 try{
  for(let run=0;run<window.__pngMax.requestedRuns;run++){
   const state=window.__pngMax;state.run=run+1;state.state='generating-source';state.completed=0;state.elapsedMs=0;recordEvent('run-start');
   const width=state.width,height=state.height,canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');
   let seed=0xc0de;
   for(let y=0;y<height;y+=128){
    const rows=Math.min(128,height-y),pixels=ctx.createImageData(width,rows);
    for(let row=0;row<rows;row++)for(let x=0;x<width;x++){
     const p=(row*width+x)*4;
     seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
     pixels.data[p]=seed&255;pixels.data[p+1]=(seed>>>8)&255;pixels.data[p+2]=(seed>>>16)&255;
     pixels.data[p+3]=32+(13*x+37*(y+row))%224;
    }
    ctx.putImageData(pixels,0,y);await new Promise(r=>setTimeout(r,0));
   }
   const blob=await canvas.convertToBlob({type:'image/png'});canvas.width=canvas.height=1;
   const file=new File([blob],'png-limit-noise.png',{type:'image/png'}),started=performance.now();
   state.sourceBytes=blob.size;
   const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'})),worker=new Worker(url);URL.revokeObjectURL(url);
   const trace=[];
   const result=await new Promise((resolve,reject)=>{
    let lastUnit,lastOperation;
    const timer=setTimeout(()=>{worker.terminate();reject(Error('Full run timeout'));},900000);
    worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(Error(e.message));};
    worker.onmessage=async({data})=>{
     if(data.type==='status'){
      state.state=data.operation;state.completed=data.completed;state.elapsedMs=performance.now()-started;state.hidden=document.hidden;state.lastProgressAt=new Date().toISOString();
      if(lastUnit!==data.unit||lastOperation!==data.operation){trace.push({operation:data.operation,unit:data.unit,ms:performance.now()-started});lastUnit=data.unit;lastOperation=data.operation;}
      document.title='PNG test '+(run+1)+'/3 · '+data.operation+' '+(data.completed||'');
     }
     if(data.type==='error'){clearTimeout(timer);worker.terminate();reject(Error(JSON.stringify(data)));}
     if(data.type==='done'){
      clearTimeout(timer);worker.terminate();state.state='decode-result';
      try{
       const bitmap=await createImageBitmap(data.blob),out=new OffscreenCanvas(1,1),c=out.getContext('2d');
       let alphaError=0;
       const src=(x,y)=>32+(13*x+37*y)%224;
       for(let sample=0;sample<64;sample++){
        const x=(sample*7919)%(width*2),y=(sample*1237)%(height*2);
        c.clearRect(0,0,1,1);c.drawImage(bitmap,x,y,1,1,0,0,1,1);
        const a=c.getImageData(0,0,1,1).data[3];
        const sx=Math.max(0,Math.min(width-1,(x+.5)/2-.5)),sy=Math.max(0,Math.min(height-1,(y+.5)/2-.5));
        const x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0,x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1);
        const expected=Math.round((src(x0,y0)*(1-fx)+src(x1,y0)*fx)*(1-fy)+(src(x0,y1)*(1-fx)+src(x1,y1)*fx)*fy);
        alphaError=Math.max(alphaError,Math.abs(a-expected));
       }
       const dimensions=[bitmap.width,bitmap.height];bitmap.close();out.width=out.height=1;
       resolve({passed:alphaError<=1&&data.blob.type==='image/png'&&dimensions[0]===width*2&&dimensions[1]===height*2,
        alphaError,dimensions,sourceBytes:file.size,outputBytes:data.blob.size,totalMs:data.totalMs,fullMs:performance.now()-started,
        canEdit:data.canEdit,trace,plan:data.plan});
      }catch(error){reject(error);}
     }
    };
    worker.postMessage({type:'prepare',file,modelKind:'drawing',scale:2,environment:{userAgent:navigator.userAgent,platform:navigator.platform,maxTouchPoints:navigator.maxTouchPoints,hardwareConcurrency:navigator.hardwareConcurrency},execution:{backend:'webgpu',threads:1,attemptId:'ios-max-'+run}});
   });
   state.runs.push(result);if(!result.passed)throw Error('PNG maximum verification failed');
  }
  window.__pngMax.state='done';window.__pngMax.passed=true;
 }finally{await lock?.release();}
})().catch(error=>{window.__pngMax.state='failed';window.__pngMax.passed=false;window.__pngMax.error=String(error);});
return {started:true,width:window.__pngMax.width,height:window.__pngMax.height};
'''


def run_test(args, code=None, call=rpc, sleep=time.sleep):
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    result = {'state': 'starting', 'passed': False, 'runs': [],
              'createdAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    # Revoke any previous success before loading the worker or contacting Safari.
    output.write_text(json.dumps(result, indent=2) + '\n')
    try:
        if code is None:
            code = Path(glob.glob('assets/processor/app/assets/processor.worker-*.js')[0]).read_text()
            code = code.replace('/assets/processor/', args.origin.rstrip('/') + '/assets/processor/')
        worker_sha256 = hashlib.sha256(code.encode()).hexdigest()
        result['workerSha256'] = worker_sha256
        base = args.driver.rstrip('/') + '/session/' + args.session
        print('START', call(base, '/execute/sync', {
            'script': SCRIPT, 'args': [code, args.width, args.height, args.runs]}), flush=True)
        last = None
        for _ in range(max(210, args.runs * 100)):
            sleep(10)
            snapshot = call(base, '/execute/sync', {'script': 'return window.__pngMax;', 'args': []})
            if not isinstance(snapshot, dict) or not snapshot:
                raise RuntimeError('Test page lost (possible tab termination)')
            result = snapshot
            current = (result.get('run'), result.get('state'), result.get('completed'))
            if current != last:
                print('PROGRESS', current, round(result.get('elapsedMs', 0) / 1000), flush=True)
                last = current
            result['workerSha256'] = worker_sha256
            output.write_text(json.dumps(result, indent=2) + '\n')
            if result.get('state') in ['done', 'failed']:
                print('RESULT', {k: v for k, v in result.items() if k != 'runs'}, flush=True)
                print('RUNS', [{k: v for k, v in r.items() if k != 'trace'}
                               for r in result.get('runs', [])], flush=True)
                return 0 if result.get('state') == 'done' and result.get('passed') is True else 1
        raise RuntimeError('Overall test timeout')
    except (OSError, RuntimeError, ValueError, IndexError) as error:
        # Keep completed runs and diagnostics, but never leave a stale pass.
        result.update(state='failed', passed=False, driverError=str(error))
        output.write_text(json.dumps(result, indent=2) + '\n')
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description='Run a built product worker on a physical iPhone through an existing Safari WebDriver session. No deployment is performed.')
    parser.add_argument('--driver', default='http://127.0.0.1:4188')
    parser.add_argument('--session', required=True, help='WebDriver session ID; the selected test tab must be on the target origin')
    parser.add_argument('--origin', default='https://upscales.app')
    parser.add_argument('--width', type=int, default=4096)
    parser.add_argument('--height', type=int, default=1728)
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--output', default='.web-model-work/browser-reports/ios-png-max.json')
    args = parser.parse_args(argv)
    try:
        return run_test(args)
    except (OSError, RuntimeError, ValueError, IndexError) as error:
        print(f'iPhone PNG check failed: {error}', file=sys.stderr, flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
