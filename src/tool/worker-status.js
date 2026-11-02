// Every message carries the execution identity; progress reflects actual units
// rather than a heartbeat that could keep a stuck inference alive forever.
export function workerReporter(execution = {}, model = 'faces', send = message => self.postMessage(message)) {
  let operation = 'initialize', unit = 0;
  const report = message => {
    if (message.operation) operation = message.operation;
    else if (message.phase === 'download') operation = 'download';
    else if (message.phase === 'initialize') operation = 'initialize';
    send({attemptId: execution.attemptId, backend: execution.backend, requestedThreads: execution.threads || 1,
      model, operation, unit, ...message});
  };
  report.begin = (next, details = {}) => { operation = next; unit++; report({type: 'status', operation, ...details}); };
  report.status = message => report({type: 'status', ...message});
  return report;
}
