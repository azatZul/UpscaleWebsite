import assert from 'node:assert/strict';

// Check the values rendered by the real UI, rather than a synthetic download
// percentage. Each model shares one indicator with its engine (90% + 10%).
export function assertDownloadProgress(downloads, expectedTitles) {
  assert.equal(downloads.some(status => status.title === 'loading_engine'), false,
    'the engine must not add a separate download stage or reset the percentage');
  const groups = [];
  for (const status of downloads) {
    if (!expectedTitles.includes(status.title)) continue;
    let group = groups.at(-1);
    if (!group || group.title !== status.title || group.worker !== status.worker) {
      group = {title: status.title, worker: status.worker, statuses: []}; groups.push(group);
    }
    group.statuses.push(status);
  }
  for (const title of expectedTitles) assert.ok(groups.some(group => group.title === title), `missing download: ${title}`);
  for (const {title, statuses} of groups) {
    assert.equal(statuses[0].progress, 0, `${title} must begin at 0%`);
    assert.equal(statuses.at(-1).progress, 1, `${title} must reach 100%, including cached downloads`);
    assert.ok(statuses.some(status => status.progress === .9), `${title} must reserve only 10% for the engine`);
    let previous = 0;
    for (const status of statuses) {
      if (status.progress === undefined) {
        assert.equal(status.hidden, true, 'unknown byte totals must not show an invented percentage');
        continue;
      }
      assert.ok(status.progress >= previous && status.progress <= 1, `${title} must advance monotonically`);
      assert.equal(status.hidden, false);
      assert.ok(Math.abs(status.value - status.progress) < 1e-6);
      assert.equal(status.label, `${Math.round(status.progress * 100)}%`);
      previous = status.progress;
    }
  }
  return groups.map(({title, statuses}) => ({title, start: statuses[0].progress,
    end: statuses.at(-1).progress, samples: statuses.length}));
}

export async function captureDownloadProgress(page) {
  await page.addInitScript(() => {
    window.__downloadStatuses = [];
    let worker = 0;
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); this.downloadWorker = ++worker; }
      set onmessage(callback) {
        super.onmessage = event => {
          callback(event);
          const data = event.data;
          if (data.type !== 'status' || data.operation !== 'download' || !data.title) return;
          const progress = document.getElementById('progress');
          window.__downloadStatuses.push({worker: this.downloadWorker, title: data.title,
            progress: data.progress, receivedBytes: data.receivedBytes,
            hidden: progress.hidden, value: progress.value,
            label: document.getElementById('status-value').textContent});
        };
      }
    };
  });
}
