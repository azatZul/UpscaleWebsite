import {runBenchmark} from './benchmark.js';
import {decodeFile, processPhoto} from './image_pipeline.js';
import {configureRuntime, hardwareSummary} from './runtime.js';

configureRuntime();

const elements = {
  modes: [...document.querySelectorAll('[data-mode]')],
  dropZone: document.querySelector('#drop-zone'),
  input: document.querySelector('#photo-input'),
  selected: document.querySelector('#selected-photo'),
  sourceThumb: document.querySelector('#source-thumb'),
  sourceName: document.querySelector('#source-name'),
  sourceSize: document.querySelector('#source-size'),
  changePhoto: document.querySelector('#change-photo'),
  backend: document.querySelector('#backend'),
  process: document.querySelector('#process-button'),
  processLabel: document.querySelector('#process-button span'),
  status: document.querySelector('#status'),
  statusTitle: document.querySelector('#status-title'),
  statusValue: document.querySelector('#status-value'),
  statusProgress: document.querySelector('#status-progress'),
  statusDetail: document.querySelector('#status-detail'),
  results: document.querySelector('#results'),
  resultImage: document.querySelector('#result-image'),
  resultSummary: document.querySelector('#result-summary'),
  download: document.querySelector('#download-result'),
  processAnother: document.querySelector('#process-another'),
  runFacts: document.querySelector('#run-facts'),
  benchmarkPanel: document.querySelector('#benchmark-panel'),
  benchmarkUpscale: document.querySelector('#benchmark-upscale'),
  benchmarkFace: document.querySelector('#benchmark-face'),
  benchmarkOutput: document.querySelector('#benchmark-output'),
};

let mode = 'upscale';
let source;
let sourcePreviewUrl;
let resultUrl;

function formatBytes(bytes) {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function formatDuration(milliseconds) {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds > 10_000 ? 1 : 2)} s`;
}

function setMode(nextMode) {
  mode = nextMode;
  for (const button of elements.modes) {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  }
  if (source) elements.processLabel.textContent = mode === 'face' ? 'Enhance faces and upscale 2×' : 'Upscale this photo 2×';
}

function setStatus({progress = 0, title, detail = ''}) {
  elements.status.hidden = false;
  elements.statusTitle.textContent = title;
  elements.statusValue.textContent = `${Math.round(progress * 100)}%`;
  elements.statusProgress.style.width = `${Math.max(0, Math.min(100, progress * 100))}%`;
  elements.statusDetail.textContent = detail;
}

function showError(error) {
  console.error(error);
  setStatus({progress: 0, title: 'Could not finish this photo', detail: error?.message || String(error)});
  elements.statusValue.textContent = '';
}

async function chooseFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  source?.bitmap?.close?.();
  if (sourcePreviewUrl) URL.revokeObjectURL(sourcePreviewUrl);
  source = await decodeFile(file);
  source.file = file;
  sourcePreviewUrl = URL.createObjectURL(file);
  elements.sourceThumb.src = sourcePreviewUrl;
  elements.sourceName.textContent = file.name;
  elements.sourceSize.textContent = `${source.width} × ${source.height} · ${formatBytes(file.size)}`;
  elements.dropZone.hidden = true;
  elements.selected.hidden = false;
  elements.process.disabled = false;
  elements.processLabel.textContent = mode === 'face' ? 'Enhance faces and upscale 2×' : 'Upscale this photo 2×';
  elements.status.hidden = true;
}

function resetSelection() {
  elements.input.value = '';
  elements.dropZone.hidden = false;
  elements.selected.hidden = true;
  elements.process.disabled = true;
  elements.processLabel.textContent = 'Choose a photo to begin';
  elements.status.hidden = true;
  elements.input.click();
}

function showRunFacts(result) {
  const facts = [
    ['Total time', formatDuration(result.totalMs)],
    ['Model work', formatDuration(result.inferenceMs)],
    ['Hardware', result.backend === 'webgpu' ? 'GPU' : 'CPU'],
    ['Work pieces', `${result.tileCount} tiles${result.faceCount ? ` + ${result.faceCount} face${result.faceCount === 1 ? '' : 's'}` : ''}`],
  ];
  elements.runFacts.replaceChildren(...facts.map(([term, value]) => {
    const wrapper = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = term;
    dd.textContent = value;
    wrapper.append(dt, dd);
    return wrapper;
  }));
}

async function processCurrentPhoto() {
  if (!source) return;
  elements.process.disabled = true;
  elements.results.hidden = true;
  try {
    const result = await processPhoto(source, mode, elements.backend.value, setStatus);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(result.blob);
    elements.resultImage.src = resultUrl;
    elements.download.href = resultUrl;
    const baseName = source.file.name.replace(/\.[^.]+$/, '') || 'photo';
    elements.download.download = `${baseName}-uscale.jpg`;
    elements.resultSummary.textContent = `${source.width} × ${source.height} became ${result.width} × ${result.height}. ${result.faceCount ? `${result.faceCount} face${result.faceCount === 1 ? ' was' : 's were'} enhanced. ` : ''}Everything ran in this browser.`;
    showRunFacts(result);
    elements.results.hidden = false;
    elements.results.scrollIntoView({behavior: 'smooth', block: 'start'});
  } catch (error) {
    showError(error);
  } finally {
    elements.process.disabled = false;
  }
}

for (const button of elements.modes) button.addEventListener('click', () => setMode(button.dataset.mode));
elements.input.addEventListener('change', () => chooseFile(elements.input.files?.[0]).catch(showError));
elements.changePhoto.addEventListener('click', resetSelection);
elements.process.addEventListener('click', processCurrentPhoto);
elements.processAnother.addEventListener('click', () => {
  elements.results.hidden = true;
  resetSelection();
  document.querySelector('#tool-card').scrollIntoView({behavior: 'smooth', block: 'center'});
});

for (const eventName of ['dragenter', 'dragover']) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add('dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove('dragging');
  });
}
elements.dropZone.addEventListener('drop', (event) => chooseFile(event.dataTransfer?.files?.[0]).catch(showError));

async function displayBenchmark(kind, backend = elements.backend.value, runs = 1) {
  elements.benchmarkOutput.textContent = 'Starting…';
  elements.benchmarkUpscale.disabled = true;
  elements.benchmarkFace.disabled = true;
  try {
    const report = await runBenchmark(kind, backend, {
      runs,
      onProgress: (message) => { elements.benchmarkOutput.textContent = message; },
    });
    elements.benchmarkOutput.textContent = JSON.stringify(report, null, 2);
    window.__lastBenchmarkReport = report;
    return report;
  } catch (error) {
    elements.benchmarkOutput.textContent = `FAILED\n${error?.stack || error}`;
    throw error;
  } finally {
    elements.benchmarkUpscale.disabled = false;
    elements.benchmarkFace.disabled = false;
  }
}

window.runUScaleBenchmark = displayBenchmark;
window.uscaleHardware = hardwareSummary();

if (new URLSearchParams(location.search).has('benchmark')) {
  elements.benchmarkPanel.hidden = false;
  elements.benchmarkOutput.textContent = JSON.stringify({hardware: hardwareSummary()}, null, 2);
}
elements.benchmarkUpscale.addEventListener('click', () => displayBenchmark('upscale').catch(console.error));
elements.benchmarkFace.addEventListener('click', () => displayBenchmark('face').catch(console.error));
