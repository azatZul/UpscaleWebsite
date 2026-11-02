import contextlib
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('check_ios_png', Path(__file__).parents[1] / 'scripts/check_ios_png.py')
ios = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ios)


class IosPngTests(unittest.TestCase):
    def test_successful_rpc_returns_test_error_unchanged(self):
        result = {'state': 'failed', 'error': 'Model failed', 'runs': [{'passed': True}]}
        with patch.object(ios.urllib.request, 'urlopen', return_value=io.StringIO(json.dumps({'value': result}))):
            self.assertEqual(ios.rpc('http://driver', '/execute/sync', {}), result)

    def test_http_and_malformed_protocol_errors(self):
        failure = urllib.error.HTTPError('http://driver', 500, 'failed', {},
                                         io.BytesIO(b'{"value":{"error":"javascript error"}}'))
        with patch.object(ios.urllib.request, 'urlopen', side_effect=failure):
            with self.assertRaisesRegex(RuntimeError, 'WebDriver HTTP 500.*javascript error'):
                ios.rpc('http://driver', '/execute/sync', {})
        with patch.object(ios.urllib.request, 'urlopen', return_value=io.StringIO('{}')):
            with self.assertRaisesRegex(RuntimeError, 'missing value'):
                ios.rpc('http://driver', '/execute/sync', {})

    def run_fixture(self, folder, replies):
        args = SimpleNamespace(driver='http://driver', session='test', width=32, height=24, runs=3,
                               output=str(Path(folder) / 'report.json'))
        with contextlib.redirect_stdout(io.StringIO()), patch('time.sleep'):
            return ios.run_test(args, 'worker-code', call=unittest.mock.Mock(side_effect=replies), sleep=lambda _: None)

    def test_failure_saved_with_previous_runs_and_nonzero_exit(self):
        prior = {'state': 'tile', 'runs': [{'passed': True}], 'completed': 2}
        final = {'state': 'failed', 'runs': [{'passed': True}], 'error': 'Inference failed'}
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(self.run_fixture(folder, [{'started': True}, prior, final]), 1)
            saved = json.loads((Path(folder) / 'report.json').read_text())
            self.assertEqual(saved['state'], 'failed')
            self.assertEqual(saved['error'], final['error'])
            self.assertEqual(saved['runs'], prior['runs'])
            self.assertEqual(saved['workerSha256'], hashlib.sha256(b'worker-code').hexdigest())

    def test_only_done_and_passed_exits_successfully(self):
        for state, passed, expected in [('done', True, 0), ('done', False, 1), ('done', None, 1), ('failed', True, 1)]:
            with self.subTest(state=state, passed=passed), tempfile.TemporaryDirectory() as folder:
                self.assertEqual(self.run_fixture(folder, [{}, {'state': state, 'passed': passed}]), expected)

    def test_transport_failure_marks_report_failed_and_keeps_completed_runs(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(urllib.error.URLError, 'offline'):
                self.run_fixture(folder, [{}, {'state': 'tile', 'runs': [{'passed': True}]}, urllib.error.URLError('offline')])
            saved = json.loads((Path(folder) / 'report.json').read_text())
            self.assertEqual(saved['state'], 'failed')
            self.assertIs(saved['passed'], False)
            self.assertIn('offline', saved['driverError'])
            self.assertEqual(saved['runs'], [{'passed': True}])
            self.assertEqual(saved['workerSha256'], hashlib.sha256(b'worker-code').hexdigest())

    def test_startup_failure_revokes_previous_success_before_first_rpc(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'report.json'
            output.write_text(json.dumps({'state': 'done', 'passed': True, 'runs': [{'passed': True}] * 3}))
            args = SimpleNamespace(driver='http://driver', session='test', width=32, height=24,
                                   runs=3, output=str(output))
            def fail(*_):
                starting = json.loads(output.read_text())
                self.assertIs(starting['passed'], False)
                self.assertEqual(starting['runs'], [])
                raise RuntimeError('WebDriver HTTP 404: invalid session id')
            with self.assertRaisesRegex(RuntimeError, 'invalid session id'):
                ios.run_test(args, 'worker-code', call=fail)
            saved = json.loads(output.read_text())
            self.assertEqual(saved['state'], 'failed')
            self.assertIs(saved['passed'], False)
            self.assertEqual(saved['runs'], [])
            self.assertIn('invalid session id', saved['driverError'])

    def test_missing_worker_revokes_previous_success_and_returns_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'report.json'
            output.write_text(json.dumps({'state': 'done', 'passed': True}))
            with patch.object(ios.glob, 'glob', return_value=[]), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(ios.main(['--session', 'fake', '--output', str(output)]), 1)
            saved = json.loads(output.read_text())
            self.assertEqual(saved['state'], 'failed')
            self.assertIs(saved['passed'], False)

    def test_lost_page_and_timeout_save_failure_without_losing_prior_runs(self):
        prior = {'state': 'tile', 'runs': [{'passed': True}]}
        for replies, message in [([{}, prior, None], 'Test page lost'),
                                 ([{}] + [prior.copy() for _ in range(300)], 'Overall test timeout')]:
            with self.subTest(message=message), tempfile.TemporaryDirectory() as folder:
                with self.assertRaisesRegex(RuntimeError, message):
                    self.run_fixture(folder, replies)
                saved = json.loads((Path(folder) / 'report.json').read_text())
                self.assertEqual(saved['state'], 'failed')
                self.assertIs(saved['passed'], False)
                self.assertEqual(saved['runs'], [{'passed': True}])
                self.assertIn(message, saved['driverError'])

    def test_main_returns_failure_and_diagnostic_for_transport_error(self):
        with patch.object(ios.glob, 'glob', return_value=['worker.js']), patch.object(ios.Path, 'read_text', return_value='code'), \
                patch.object(ios, 'run_test', side_effect=urllib.error.URLError('offline')), contextlib.redirect_stderr(io.StringIO()) as diagnostic:
            self.assertEqual(ios.main(['--session', 'fake']), 1)
            self.assertIn('offline', diagnostic.getvalue())


if __name__ == '__main__':
    unittest.main()
