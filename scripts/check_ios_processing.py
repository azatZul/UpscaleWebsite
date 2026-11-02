"""Exercise locally built UI/workers in an isolated physical-iPhone Safari tab."""
import argparse
import base64
import hashlib
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from check_ios_png import rpc


INSTALL = r'''
const payload = arguments[0];
window.__iosWorkers = {};
const workerPaths = {};
for (const [group, item] of Object.entries(payload.workers)) {
  const url = URL.createObjectURL(new Blob([item.code], {type:'text/javascript'}));
  window.__iosWorkers[group] = url; workerPaths[item.path] = url;
}
let main = payload.main;
for (const [path, url] of Object.entries(workerPaths)) main = main.split(path).join(url);
const mainUrl = URL.createObjectURL(new Blob([main], {type:'text/javascript'}));
const harnessUrl = URL.createObjectURL(new Blob([payload.harness], {type:'text/javascript'}));
window.__iosAcceptance = {kind:'physical-iphone-processing',step:'initializing-ui',passed:false,
  method:'Physical Safari WebDriver tab; locally built HTML/UI/workers; pinned production models; no deployment',
  createdAt:new Date().toISOString(),environment:{userAgent:navigator.userAgent,platform:navigator.platform,
    maxTouchPoints:navigator.maxTouchPoints,hardwareConcurrency:navigator.hardwareConcurrency,crossOriginIsolated},
  bundleSha256:payload.hashes,keepActive:Boolean(payload.keepActive),matrix:[],errors:[],warnings:[]};
window.__iosAcceptance.executions=[];
const NativeWorker=window.Worker;
window.Worker=class extends NativeWorker {
  constructor(url,...args){
    super(url,...args);
    this.group=Object.entries(window.__iosWorkers).find(([,value])=>value===String(url))?.[0]||'injected-fault';
    this.addEventListener('message',({data})=>{
      if(!this.record)return;
      if(payload.maximum && data.type==='status') {
        Object.assign(window.__iosAcceptance,{operation:data.operation,completed:data.completed,lastProgressAt:new Date().toISOString()});
        this.record.trace ||= [];
        if(this.record.trace.at(-1)?.unit!==data.unit || this.record.trace.at(-1)?.operation!==data.operation)
          this.record.trace.push({operation:data.operation,unit:data.unit,at:new Date().toISOString()});
      }
      if(['done','faces','enhanced','applied'].includes(data.type))
        Object.assign(this.record,{result:data.type,effectiveThreads:data.effectiveThreads,canEdit:data.canEdit});
    });
  }
  postMessage(data,...args){
    this.record={group:this.group,file:data.file?.name,mode:data.mode,backend:data.execution?.backend,
      requestedThreads:data.execution?.threads};
    window.__iosAcceptance.executions.push(this.record);
    return super.postMessage(data,...args);
  }
};
window.addEventListener('error', event => {
  // Safari reports deferred ResizeObserver notifications as an ErrorEvent
  // without a thrown exception. Retain these separately from script failures.
  const deferredResize=!event.error && event.message==='ResizeObserver loop completed with undelivered notifications.';
  window.__iosAcceptance[deferredResize?'warnings':'errors'].push(event.message);
});
window.addEventListener('unhandledrejection', event => window.__iosAcceptance.errors.push(String(event.reason)));
(async()=>{
  await import(mainUrl);
  const harness = await import(harnessUrl);
  if(payload.maximum) await harness.runMaximumAcceptance(payload.maximum);
  else await harness.runAcceptance(new Uint8Array(payload.portrait));
  if(window.__iosAcceptance.errors.length) window.__iosAcceptance.passed=false;
})().catch(error=>Object.assign(window.__iosAcceptance,{step:'failed',passed:false,error:error.stack||String(error)}));
return {started:true,workers:Object.keys(window.__iosWorkers)};
'''


def make_payload(origin):
    root = Path(__file__).resolve().parents[1]
    # Bundle only the acceptance harness. Existing product bundles are read unchanged.
    subprocess.run(['node', '--input-type=module', '-e', '''
import {build} from 'vite';
await build({configFile:false,publicDir:false,build:{outDir:'.web-model-work/ios-acceptance',emptyOutDir:true,
  minify:true,lib:{entry:'scripts/ios_processing_acceptance.js',formats:['es'],fileName:()=> 'acceptance.mjs'}}});
'''], cwd=root, check=True)
    app = root / 'assets/processor/app'
    manifest = json.loads((app / '.vite/manifest.json').read_text())
    main = (app / manifest['src/tool/main.js']['file']).read_text()
    workers = {}
    hashes = {}
    for group, pattern in [('processor', 'processor.worker-*.js'), ('faces', 'face.worker-*.js'), ('composite', 'face-edit.worker-*.js')]:
        paths = list((app / 'assets').glob(pattern))
        if len(paths) != 1:
            raise ValueError(f'Expected one current {group} worker, got {paths}')
        path = paths[0]
        code = path.read_text()
        hashes[group] = hashlib.sha256(code.encode()).hexdigest()
        workers[group] = {'path': '/' + str(path.relative_to(root)),
                          'code': code.replace('/assets/processor/', origin.rstrip('/') + '/assets/processor/')}
    html = (root / 'dist/upscale/index.html').read_text()
    html = re.sub(r'<script\b[^>]*\bsrc=["\'][^"\']+["\'][^>]*>\s*</script>', '', html)
    for name in ['site', 'upscale']:
        html = re.sub(rf'<link\b[^>]*href=["\']/assets/{name}\.css[^"\']*["\'][^>]*>',
                      lambda _: '<style>' + (root / f'assets/{name}.css').read_text() + '</style>', html)
    harness = (root / '.web-model-work/ios-acceptance/acceptance.mjs').read_text()
    hashes.update({name: hashlib.sha256(code.encode()).hexdigest()
                   for name, code in [('main', main), ('html', html), ('harness', harness)]})
    return {'html': html, 'main': main, 'workers': workers, 'hashes': hashes,
            'harness': harness,
            'portrait': list((root / 'static/benchmarks/ios/face/asset_face_preview_original.input.png').read_bytes())}


def save_screenshot(base, output):
    with urllib.request.urlopen(base + '/screenshot', timeout=45) as response:
        screenshot = json.load(response)['value']
    output.write_bytes(base64.b64decode(screenshot))


def run(args):
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({'kind': 'physical-iphone-processing', 'step': 'starting', 'passed': False,
                                  'createdAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, indent=2) + '\n')
    try:
        return run_device(args, output)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        # Also cover startup, keep-active, screenshot and artifact-transfer
        # failures, so an older successful report can never mask a failed run.
        snapshot = json.loads(output.read_text())
        snapshot.update(step='failed', passed=False, driverError=str(error))
        output.write_text(json.dumps(snapshot, indent=2) + '\n')
        raise


def run_device(args, output):
    payload = make_payload(args.origin)
    if args.suite == 'maximum':
        payload['maximum'] = {'width': args.width, 'height': args.height, 'runs': args.runs}
    payload['keepActive'] = args.keep_active
    base = args.driver.rstrip('/') + '/session/' + args.session
    rpc(base, '/url', {'url': args.origin.rstrip('/') + '/upscale/?mode=device&analytics-debug=1'})
    rpc(base, '/execute/sync', {'script': 'document.open();document.write(arguments[0]);document.close();return true;',
                              'args': [payload['html']]})
    print('START', rpc(base, '/execute/sync', {'script': INSTALL, 'args': [payload]}), flush=True)
    last = None
    last_activity = time.monotonic()
    deadline = time.monotonic() + args.timeout
    while time.monotonic() < deadline:
        time.sleep(5)
        result = rpc(base, '/execute/sync', {'script': 'return window.__iosAcceptance;', 'args': []})
        if not isinstance(result, dict) or not result:
            raise RuntimeError('Acceptance page lost; physical-device test did not finish')
        output.write_text(json.dumps(result, indent=2) + '\n')
        current = (result.get('run'), result.get('step'), result.get('operation'), result.get('completed'))
        if current != last:
            print('PROGRESS', current, flush=True)
            last = current
        if result.get('step') in ['done', 'failed']:
            save_screenshot(base, output.with_suffix('.png'))
            if result.get('passed') is True and args.suite != 'maximum':
                for name in ['initial', 'restored']:
                    data = rpc(base, '/execute/async', {'script': '''
const done=arguments[arguments.length-1],reader=new FileReader();
reader.onload=()=>done(reader.result.split(',')[1]);reader.onerror=()=>done(null);
reader.readAsDataURL(window.__iosArtifactBlobs[arguments[0]]);
''', 'args': [name]})
                    if not data:
                        raise RuntimeError(f'Could not retrieve {name} PNG artifact')
                    output.with_name(output.stem + '-' + name + '.png').write_bytes(base64.b64decode(data))
            print('RESULT', json.dumps(result), flush=True)
            return 0 if result.get('step') == 'done' and result.get('passed') is True else 1
        if args.keep_active and time.monotonic() - last_activity >= 30:
            # Safari Automation may deny Wake Lock even after a trusted touch.
            # Touch only the inert harness control, with this test condition
            # recorded. The terminal state removes it, so allow that race.
            try:
                element = rpc(base, '/element', {'using': 'css selector', 'value': '#acceptance-keep-active'})
                rpc(base, '/element/' + element['element-6066-11e4-a52e-4f735466cecf'] + '/click', {})
                rpc(base, '/execute/sync', {'script': "window.__iosAcceptance.events?.push({type:'webdriver-keep-active',at:new Date().toISOString(),hidden:document.hidden,run:window.__iosAcceptance.run});return true;", 'args': []})
            except RuntimeError:
                terminal = rpc(base, '/execute/sync', {'script': "return ['done','failed'].includes(window.__iosAcceptance?.step);", 'args': []})
                if not terminal:
                    raise
            last_activity = time.monotonic()
    raise RuntimeError('Physical-device acceptance timeout')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--driver', default='http://127.0.0.1:4188')
    parser.add_argument('--session', required=True)
    parser.add_argument('--origin', default='https://upscales.app')
    parser.add_argument('--suite', choices=['processing', 'maximum'], default='processing')
    parser.add_argument('--width', type=int, default=4096)
    parser.add_argument('--height', type=int, default=1728)
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--keep-active', action='store_true', help='Touch the inert harness control every 30s when Safari Automation denies Wake Lock')
    parser.add_argument('--timeout', type=int, default=3600)
    parser.add_argument('--output', default='.web-model-work/browser-reports/ios-processing.json')
    args = parser.parse_args()
    if args.keep_active and args.suite != 'maximum':
        parser.error('--keep-active requires --suite maximum')
    try:
        return run(args)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'iPhone processing acceptance failed: {error}', file=sys.stderr, flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
