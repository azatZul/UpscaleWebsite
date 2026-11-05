"""Run with the isolated scripts/photo4x-requirements.txt environment."""
import importlib.util
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

# Model conversion is a lab tool; the deploy gate's interpreter does not carry
# its numpy/onnx stack, so the suite is skipped there instead of failing import.
try:
    import numpy as np
    import onnx
    from onnx import helper, TensorProto
    spec = importlib.util.spec_from_file_location('photo4x_prepare', Path(__file__).parents[1] / 'scripts/prepare_photo4x_models.py')
    prepare = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(prepare)
except ModuleNotFoundError as missing:  # pragma: no cover - environment dependent
    raise unittest.SkipTest(f"photo4x model tests need scripts/photo4x-requirements.txt: {missing}")


class SoftplusTests(unittest.TestCase):
    def test_stable_gpu_decomposition_matches_original_at_extremes_and_zero(self):
        source = helper.make_model(helper.make_graph(
            [helper.make_node('Softplus', ['x'], ['y'])], 'softplus',
            [helper.make_tensor_value_info('x', TensorProto.FLOAT, [1, 1, 1, 11])],
            [helper.make_tensor_value_info('y', TensorProto.FLOAT, [1, 1, 1, 11])]),
            opset_imports=[helper.make_opsetid('', 17)])
        source.ir_version = 8
        converted, count = prepare.webgpu_softplus(source)
        onnx.checker.check_model(converted, full_check=True)
        x = np.array([-10000, -100, -20, -1, -1e-6, 0, 1e-6, 1, 20, 100, 10000], dtype=np.float32).reshape(1, 1, 1, -1)
        expected = prepare.session(source).run(None, {'x': x})[0]
        actual = prepare.session(converted).run(None, {'x': x})[0]
        self.assertEqual(count, 1)
        self.assertNotIn('Softplus', [n.op_type for n in converted.graph.node])
        self.assertTrue(np.isfinite(actual).all())
        np.testing.assert_allclose(actual, expected, atol=1e-6, rtol=1e-6)
        self.assertEqual(len({n.name for n in converted.graph.node}), len(converted.graph.node))
        self.assertTrue(all(n.name.startswith('__uscale_softplus_') for n in converted.graph.node))

    def test_other_graphs_are_unchanged_and_source_is_not_mutated(self):
        model = helper.make_model(helper.make_graph([helper.make_node('Relu', ['x'], ['y'])], 'identity',
            [helper.make_tensor_value_info('x', TensorProto.FLOAT, [1])],
            [helper.make_tensor_value_info('y', TensorProto.FLOAT, [1])]), opset_imports=[helper.make_opsetid('', 17)])
        before = model.SerializeToString()
        converted, count = prepare.webgpu_softplus(model)
        self.assertEqual(count, 0)
        self.assertEqual(converted.SerializeToString(), before)
        self.assertEqual(model.SerializeToString(), before)


class VerificationInputTests(unittest.TestCase):
    def test_photo_sample_uses_a_tracked_fixture_without_private_lab_inputs(self):
        with TemporaryDirectory() as directory, patch.object(prepare, 'ROOT', Path(directory)):
            # PHOTO_SAMPLE is an absolute repository path, independent of --work or cwd.
            first = prepare.photo_sample(256)
            second = prepare.photo_sample(256)
        self.assertEqual(first.shape, (1, 3, 256, 256))
        self.assertEqual(first.dtype, np.float32)
        self.assertTrue(np.isfinite(first).all())
        self.assertGreaterEqual(first.min(), 0)
        self.assertLessEqual(first.max(), 1)
        self.assertGreater(float(first.std()), .05)
        np.testing.assert_array_equal(first, second)


if __name__ == '__main__':
    unittest.main()
