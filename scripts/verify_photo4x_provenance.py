#!/usr/bin/env python3
"""Match ONNX convolution parameters to the author's licensed safetensors.

No pickle/PyTorch execution. Parses the safetensors header and raw tensor bytes.
Files are explicit local inputs; the script does not contact or message anyone.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path
import numpy as np
import onnx
from onnx import numpy_helper


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--onnx', required=True, type=Path)
    p.add_argument('--safetensors', required=True, type=Path)
    p.add_argument('--card', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    args = p.parse_args()
    data = args.safetensors.read_bytes()
    size = struct.unpack('<Q', data[:8])[0]
    header = json.loads(data[8:8+size])
    tensors = {}
    author_values = {}
    for name, tensor in header.items():
        if name == '__metadata__':
            continue
        left, right = tensor['data_offsets']
        dtype = {'F32': '<f4', 'F16': '<f2'}.get(tensor['dtype'])
        if dtype:
            array = np.frombuffer(data[8+size+left:8+size+right], dtype=dtype).astype('<f4')
            tensors.setdefault((tuple(tensor['shape']), digest(array.tobytes())), []).append(name)
            author_values[name] = (array.size, digest(array.tobytes()))
    graph = onnx.load(args.onnx)
    parameters = {v.name: numpy_helper.to_array(v) for v in graph.graph.initializer}
    fixed_values = {(v.size, digest(v.astype('<f4').tobytes())) for v in parameters.values() if v.dtype.kind == 'f'}
    missing_author_values = [name for name, value in author_values.items() if value not in fixed_values]
    checks = []
    for node in graph.graph.node:
        if node.op_type != 'Conv':
            continue
        for name in node.input[1:]:
            array = parameters[name].astype('<f4')
            matches = tensors.get((array.shape, digest(array.tobytes())), [])
            checks.append({'onnxParameter': name, 'shape': list(array.shape), 'authorTensorMatches': matches, 'matched': bool(matches)})
    card = args.card.read_text()
    report = {'sourceCard': 'https://huggingface.co/Phips/4xNomosWebPhoto_RealPLKSR/blob/49d5da1/README.md',
              'sourceWeights': 'https://huggingface.co/Phips/4xNomosWebPhoto_RealPLKSR/blob/49d5da1/4xNomosWebPhoto_RealPLKSR.safetensors',
              'safetensorsSha256': digest(data), 'cardSha256': digest(args.card.read_bytes()),
              'onnxSha256': digest(args.onnx.read_bytes()), 'explicitLicenseMetadata': 'license: cc-by-4.0' in card.split('---', 2)[1],
              'linksExactRelease': 'https://github.com/Phhofm/models/releases/tag/4xNomosWebPhoto_RealPLKSR' in card,
              'convolutionParameters': len(checks), 'authorParameters': len(author_values), 'missingAuthorParameters': missing_author_values,
              'allMatched': bool(checks) and all(c['matched'] for c in checks) and not missing_author_values, 'checks': checks}
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'checks'}, indent=2))
    if not report['allMatched'] or not report['explicitLicenseMetadata'] or not report['linksExactRelease']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
