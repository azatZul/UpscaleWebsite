"""A failed device/driver run must not leave an accepted release report."""
import importlib.util
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('check_ios_processing', SCRIPTS / 'check_ios_processing.py')
ios = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ios)
sys.path.remove(str(SCRIPTS))


class IosProcessingReportTests(unittest.TestCase):
    def test_keep_active_race_accepts_completion_but_not_a_live_session_failure(self):
        for terminal in [True, False]:
            with self.subTest(terminal=terminal), tempfile.TemporaryDirectory() as folder:
                output = Path(folder) / 'report.json'
                args = SimpleNamespace(output=str(output), origin='https://test.example', driver='http://driver',
                                       session='session', suite='maximum', width=32, height=24, runs=3,
                                       keep_active=True, timeout=3600)
                clock = [0]
                snapshots = [{'step': 'maximum:processing', 'passed': False, 'runs': [{'passed': True}]},
                             {'step': 'done', 'passed': True, 'runs': [{'passed': True}] * 3}]
                def call(base, path, data):
                    if path == '/element':
                        if data['value'] == '#acceptance-keep-active':
                            raise RuntimeError('element disappeared')
                        return {'element-6066-11e4-a52e-4f735466cecf': 'start'}
                    script = data.get('script', '')
                    if script == 'return window.__iosAcceptance;':
                        return snapshots.pop(0)
                    if "['done','failed']" in script:
                        return terminal
                    if "Boolean(document.getElementById('acceptance-maximum-start'))" in script:
                        return True
                    return None
                with patch.object(ios, 'make_payload', return_value={'html': '<html></html>'}), \
                        patch.object(ios, 'rpc', side_effect=call), patch.object(ios, 'save_screenshot'), \
                        patch.object(ios.time, 'monotonic', side_effect=lambda: clock[0]), \
                        patch.object(ios.time, 'sleep', side_effect=lambda _: clock.__setitem__(0, clock[0] + 31)), \
                        contextlib.redirect_stdout(io.StringIO()):
                    if terminal:
                        self.assertEqual(ios.run(args), 0)
                    else:
                        with self.assertRaisesRegex(RuntimeError, 'element disappeared'):
                            ios.run(args)
                report = json.loads(output.read_text())
                self.assertIs(report['passed'], terminal)
                self.assertEqual(len(report['runs']), 3 if terminal else 1)

    def test_new_run_invalidates_previous_success_before_build_or_device_access(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'report.json'
            output.write_text(json.dumps({'step': 'done', 'passed': True}))
            args = SimpleNamespace(output=str(output))
            with patch.object(ios, 'run_device', side_effect=subprocess.CalledProcessError(1, 'vite')):
                with self.assertRaises(subprocess.CalledProcessError):
                    ios.run(args)
            report = json.loads(output.read_text())
            self.assertEqual(report['step'], 'failed')
            self.assertIs(report['passed'], False)
            self.assertIn('vite', report['driverError'])

    def test_transport_and_artifact_failures_preserve_prior_runs_and_revoke_pass(self):
        for error in [RuntimeError('invalid session id'), OSError('screenshot failed')]:
            with self.subTest(error=error), tempfile.TemporaryDirectory() as folder:
                output = Path(folder) / 'report.json'
                def fail(args, path):
                    path.write_text(json.dumps({'step': 'done', 'passed': True, 'runs': [{'passed': True}],
                                                'bundleSha256': {'processor': 'pinned'}}))
                    raise error
                with patch.object(ios, 'run_device', side_effect=fail):
                    with self.assertRaises(type(error)):
                        ios.run(SimpleNamespace(output=str(output)))
                report = json.loads(output.read_text())
                self.assertIs(report['passed'], False)
                self.assertEqual(report['runs'], [{'passed': True}])
                self.assertEqual(report['bundleSha256'], {'processor': 'pinned'})
                self.assertEqual(report['driverError'], str(error))


if __name__ == '__main__':
    unittest.main()
