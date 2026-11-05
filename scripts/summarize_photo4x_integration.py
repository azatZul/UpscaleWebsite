#!/usr/bin/env python3
"""Summarize real local acceptance without publishing private images/reports."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.web-model-work/photo4x'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def report(path):
    data = json.loads(path.read_text())
    if data.get('passed') is not True:
        raise RuntimeError(f'Acceptance did not pass: {path.relative_to(ROOT)}')
    return data


def summarize(path, key='cases'):
    data = report(path)
    fields = ['name', 'mode', 'passed', 'model', 'wallMs', 'warmupMs', 'calibrationMs',
              'profileReused', 'forecast', 'upscaleExportMs', 'mime', 'dimensions', 'faceCount', 'canEdit']
    return {'passed': True, 'rawReport': str(path.relative_to(ROOT)), 'rawSha256': sha(path),
            'createdAt': data.get('createdAt'), 'cases': [{k: c[k] for k in fields if k in c} for c in data.get(key, [])]}


def main():
    full = WORK / 'results/integration/report.json'
    raw = report(full)
    release = raw['release']
    reviewed = np.array(Image.open(WORK / 'results/gpu-fp16-five/nomos-realplksr-256-fp16-o32.png').convert('RGBA')).astype(np.int16)
    cold = np.array(Image.open(WORK / 'results/integration/cold.png').convert('RGBA')).astype(np.int16)
    returning = np.array(Image.open(WORK / 'results/integration/next-day.png').convert('RGBA')).astype(np.int16)
    alpha = np.array(Image.open(WORK / 'results/tiny-cache/transparent.png'))[:, :, 3].astype(float)
    source = np.floor(np.arange(65) * 255 / 64 + .5)
    x = np.clip((np.arange(260) + .5) / 4 - .5, 0, 64)
    expected = np.floor(np.interp(x, np.arange(65), source) + .5)
    parity = {'reviewedGraphMaxChannelError': int(abs(reviewed - cold).max()),
              'returnVisitMaxChannelError': int(abs(cold - returning).max()),
              'transparentMaxAlphaError': float(abs(alpha - expected).max())}
    if any(parity.values()):
        raise RuntimeError(f'Image parity changed: {parity}')

    # package_production excludes .assetsignore from the payload count, and its
    # upload ignore rule also covers Finder metadata created after validation.
    files = [p for p in (ROOT / '.deploy-dist').rglob('*') if p.is_file() and p.name not in {'.assetsignore', '.DS_Store'}]
    weights = ROOT / '.deploy-dist' / release['winner']['url'].lstrip('/')
    if sha(weights) != release['winner']['sha256']:
        raise RuntimeError('Packaged model differs from reviewed graph')
    manifest = json.loads((WORK / 'manifest.json').read_text())
    disallowed = {m['sha256'] for m in manifest['models']} - {release['winner']['sha256']}
    private = {sha(WORK / 'inputs' / name) for name in ['girls_blured.jpg', 'parrot.png', 'eiffel_bw.png']}
    disallowed |= private
    leaked = [str(p.relative_to(ROOT / '.deploy-dist')) for p in files if sha(p) in disallowed]
    if leaked:
        raise RuntimeError(f'Unapproved artifact in package: {leaked}')
    sources = ['src/tool/photo4x-release.js', 'src/tool/photo4x-policy.js', 'src/tool/photo4x-calibration.js',
               'src/tool/processor.worker.js', 'src/tool/runtime.js', 'src/tool/attempt-controller.js',
               'src/tool/main.js', 'scripts/prepare_tool_assets.mjs', 'build/build.py']
    result = {'schemaVersion': 1, 'createdAt': datetime.now(timezone.utc).isoformat(), 'passed': True,
              'deployed': False, 'modelSha256': release['winner']['sha256'], 'release': release,
              'physicalDevice': {'chip': 'Apple M4 Pro', 'unifiedMemoryGiB': 48, 'macOS': '26.7',
                                 'browser': raw['browser'], 'hardwareWebGPU': True, 'unsafeGpuFlags': False,
                                 'vram': None, 'vramReason': 'Not reliably exposed by browser APIs'},
              'integration': summarize(full), 'tinyCache': summarize(WORK / 'results/tiny-cache/report.json'),
              'ui': summarize(WORK / 'results/integration-ui/report.json'), 'recovery': summarize(WORK / 'recovery.json', 'checks'),
              'productRegressions': summarize(WORK / 'results/product-regressions-integration.json'),
              'imageParity': parity,
              'automatedChecks': {'nodeToolTestsPassed': 121, 'modelConversionTestsPassed': 2, 'localizationTestsPassed': 27},
              'packaging': {'files': len(files), 'bytes': sum(p.stat().st_size for p in files),
                            'selectedGraphHashVerified': True, 'privateOrUnapprovedArtifacts': leaked,
                            'licensePagePresent': (ROOT / '.deploy-dist/licenses/index.html').is_file()},
              'safari': {'enabled': False, 'passed': False, 'status': 'inconclusive-environment', 'version': '27.0',
                         'webdriver': 'Session creation timed out after temporary user-authorized Remote Automation',
                         'nativeHarness': 'Actual Safari local tab did not deliver a JSON acceptance report',
                         'temporaryPreferencesRestored': {'remoteAutomation': False, 'showDeveloperFeatures': False}},
              'unmeasuredPhysicalDevices': ['M1 / 8 GB', 'Windows / NVIDIA', 'Windows / AMD', 'Windows / Intel iGPU'],
              'unmeasuredDevicePolicy': 'Desktop Chrome/Edge require local validation, never admission by hardware name',
              'productSourceSha256': {p: sha(ROOT / p) for p in sources}}
    destination = ROOT / 'benchmarks/browser/photo4x-integration.json'
    destination.write_text(json.dumps(result, indent=2) + '\n')
    print(f'Wrote {destination.relative_to(ROOT)}; {len(files)} packaged files; image parity exact')


if __name__ == '__main__':
    main()
