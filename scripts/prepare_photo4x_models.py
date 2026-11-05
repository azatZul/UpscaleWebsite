#!/usr/bin/env python3
"""Prepare local-only Nomos experiments. Never copies weights into site assets.

python -m venv .web-model-work/photo4x/venv
.web-model-work/photo4x/venv/bin/pip install -r scripts/photo4x-requirements.txt
.web-model-work/photo4x/venv/bin/python scripts/prepare_photo4x_models.py
"""
import argparse
import hashlib
import importlib.metadata
import json
import platform
import urllib.request
from collections import Counter
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnxsim import simplify
from onnx import helper, numpy_helper

ROOT = Path(__file__).resolve().parents[1]
PHOTO_SAMPLE = ROOT / 'resources/before_after/film_negative_after.jpg'
SOURCES = {
    "nomos-esrgan": "https://github.com/Phhofm/models/releases/download/4xNomosWebPhoto_esrgan/4xNomosWebPhoto_esrgan_fp32_opset17.onnx",
    "nomos-realplksr": "https://github.com/Phhofm/models/releases/download/4xNomosWebPhoto_RealPLKSR/4xNomosWebPhoto_RealPLKSR_fp32_opset17.onnx",
    # Apache 2.0, 2x; the author's ONNX has a fixed 256x256 input.
    "public2x-realplksr": "https://github.com/Phhofm/models/releases/download/2xPublic_realplksr_dysample_layernorm_real/2xPublic_realplksr_dysample_layernorm_real_fp32_op17.onnx",
    # CC BY-NC-SA 4.0 (limitlesslab): local evaluation only; publication needs the author's permission.
    "safmn2x-purescale": "https://github.com/limitlesslab/AI-upscaling-models/releases/download/PureScale2/2x_SAFMN_PureScale.onnx",
}
SOURCE_HASHES = {
    "nomos-esrgan": "e29f473727ee0e32416d3a2d2642568e0159e2608d67236193772fced8696121",
    "nomos-realplksr": "146669e66cd3b22a4b97b0cf83f9bb2bcf20cd4ffd51fe76f91b95a4a8002df6",
    "public2x-realplksr": "4c5c658893c927af11238d4aa767a7cb0bfcae773b98a7da3a6c486efa024f5f",
    "safmn2x-purescale": "c83bd787f5efcb0c1f4a30841348a7199456801dd61a72003fd3031d725152ef",
}
# Same weights as the parent, with a 2x2 box downscale folded into the tail.
DERIVED = {"nomos-realplksr-2x": "nomos-realplksr"}
SCALES = {"public2x-realplksr": 2, "nomos-realplksr-2x": 2, "safmn2x-purescale": 2}


def fingerprint(path):
    return {"bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def inspect(model):
    def dimensions(value):
        return [d.dim_value if d.HasField("dim_value") else d.dim_param for d in value.type.tensor_type.shape.dim]
    tensors = []
    for value in list(model.graph.value_info) + list(model.graph.output):
        shape = dimensions(value)
        if shape and all(isinstance(d, int) and d > 0 for d in shape):
            itemsize = np.dtype(helper.tensor_dtype_to_np_dtype(value.type.tensor_type.elem_type)).itemsize
            tensors.append({"name": value.name, "shape": shape, "bytes": int(np.prod(shape)) * itemsize})
    return {"opsets": {o.domain: o.version for o in model.opset_import},
            "inputs": {v.name: dimensions(v) for v in model.graph.input},
            "outputs": {v.name: dimensions(v) for v in model.graph.output},
            "operators": dict(Counter(n.op_type for n in model.graph.node)),
            "largestTensors": sorted(tensors, key=lambda v: v["bytes"], reverse=True)[:12]}


def session(model):
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    return ort.InferenceSession(model.SerializeToString(), options, providers=["CPUExecutionProvider"])


def webgpu_softplus(model):
    """Stable softplus(x) = max(x,0) + log(1 + exp(-abs(x))).

    ORT Web 1.23.2 falls back to CPU for Softplus, copying large feature maps.
    Each primitive here has a WebGPU kernel. Validate the whole model afterwards.
    """
    graph = onnx.load_from_string(model.SerializeToString())
    nodes, count = [], 0
    one = '__uscale_softplus_one'
    for node in graph.graph.node:
        if node.op_type != 'Softplus':
            nodes.append(node)
            continue
        stem = f'__uscale_softplus_{count}'
        x = node.input[0]
        for op, inputs, output in [
            ('Abs', [x], stem + '_abs'), ('Neg', [stem + '_abs'], stem + '_negative'),
            ('Exp', [stem + '_negative'], stem + '_exp'), ('Add', [stem + '_exp', one], stem + '_plus_one'),
            ('Log', [stem + '_plus_one'], stem + '_log'), ('Relu', [x], stem + '_positive'),
            ('Add', [stem + '_positive', stem + '_log'], node.output[0]),
        ]:
            nodes.append(helper.make_node(op, inputs, [output], name=f'{stem}_{len(nodes)}_{op}_webgpu'))
        count += 1
    if count:
        graph.graph.ClearField('node')
        graph.graph.node.extend(nodes)
        graph.graph.initializer.extend([numpy_helper.from_array(np.array(1, dtype=np.float32), one)])
    return graph, count


def fold_2x(model):
    """4x tail Conv(48) + repeat(x, 16) -> DepthToSpace(4) becomes Conv(12) + repeat(x, 4) -> DepthToSpace(2).

    Everything between the last Conv and Clip is linear, so averaging each 2x2
    block of the 4x output equals averaging the matching Conv output channels.
    Only Clip moves before the average; verification measures that difference.
    """
    graph = onnx.load_from_string(model.SerializeToString())
    nodes = list(graph.graph.node)
    producers = {output: node for node in nodes for output in node.output}
    weights = {tensor.name: tensor for tensor in graph.graph.initializer}
    shuffle = next(n for n in nodes if n.op_type == 'DepthToSpace')
    attributes = {a.name: helper.get_attribute_value(a) for a in shuffle.attribute}
    if attributes.get('blocksize') != 4 or attributes.get('mode', b'DCR') != b'CRD':
        raise ValueError(f"Unexpected 4x tail: {attributes}")
    add = producers[shuffle.input[0]]
    conv = next(producers[name] for name in add.input if name in producers and producers[name].op_type == 'Conv')
    weight, bias = (numpy_helper.to_array(weights[name]) for name in conv.input[1:3])
    channels = weight.shape[0] // 16
    # CRD channel c*16 + i*4 + j is output pixel (4h+i, 4w+j); split i=2a+p, j=2b+q and average p, q.
    weight = weight.reshape(channels, 2, 2, 2, 2, *weight.shape[1:]).mean(axis=(2, 4)).reshape(channels * 4, *weight.shape[1:])
    bias = bias.reshape(channels, 2, 2, 2, 2).mean(axis=(2, 4)).reshape(channels * 4)
    repeat = np.zeros((channels * 4, channels, 1, 1), dtype=np.float32)
    for c in range(channels):
        repeat[c * 4:(c + 1) * 4, c] = 1
    stem = '__uscale_fold2x'
    graph.graph.initializer.extend([numpy_helper.from_array(weight.astype(np.float32), stem + '_weight'),
        numpy_helper.from_array(bias.astype(np.float32), stem + '_bias'), numpy_helper.from_array(repeat, stem + '_repeat')])
    tail = [helper.make_node('Conv', [conv.input[0], stem + '_weight', stem + '_bias'], [stem + '_features'], name=stem + '_conv'),
            helper.make_node('Conv', [graph.graph.input[0].name, stem + '_repeat'], [stem + '_residual'], name=stem + '_repeat'),
            helper.make_node('Add', [stem + '_features', stem + '_residual'], [stem + '_sum'], name=stem + '_add'),
            helper.make_node('DepthToSpace', [stem + '_sum'], [shuffle.output[0]], name=stem + '_shuffle', blocksize=2, mode='CRD')]
    tail[0].attribute.extend(conv.attribute)
    at = nodes.index(shuffle)
    nodes = nodes[:at] + tail + nodes[at + 1:]
    # Keep only nodes that still reach an output; the old Tile/Reshape residual drops out.
    needed, kept = {o.name for o in graph.graph.output}, []
    for node in reversed(nodes):
        if any(output in needed for output in node.output):
            kept.append(node)
            needed.update(node.input)
    graph.graph.ClearField('node')
    graph.graph.node.extend(reversed(kept))
    used = {name for node in kept for name in node.input}
    initializers = [t for t in graph.graph.initializer if t.name in used]
    graph.graph.ClearField('initializer')
    graph.graph.initializer.extend(initializers)
    graph.graph.ClearField('value_info')
    for output in graph.graph.output:
        output.type.tensor_type.ClearField('shape')
    return onnx.shape_inference.infer_shapes(graph, strict_mode=True)


def compact_gathers(model):
    """GatherElements with a constant index that varies only along its axis is an exact Gather.

    Fixed-shape folding expands SAFMN's pooling indices to full feature maps
    (tens of MB of int64); a 1-D Gather index keeps the download near the weights.
    """
    graph = onnx.load_from_string(model.SerializeToString())
    weights = {tensor.name: tensor for tensor in graph.graph.initializer}
    shapes = {v.name: [d.dim_value for d in v.type.tensor_type.shape.dim]
              for v in list(graph.graph.value_info) + list(graph.graph.input)}
    nodes, count = [], 0
    for node in graph.graph.node:
        index = numpy_helper.to_array(weights[node.input[1]]) if node.op_type == 'GatherElements' and node.input[1] in weights else None
        if index is not None:
            axis = next((helper.get_attribute_value(a) for a in node.attribute if a.name == 'axis'), 0) % index.ndim
            line = index[tuple(slice(None) if d == axis else 0 for d in range(index.ndim))]
            data = shapes.get(node.input[0])
            shape = [1] * index.ndim
            shape[axis] = -1
            if data and all(data[d] == index.shape[d] for d in range(index.ndim) if d != axis) and \
                    np.array_equal(index, np.broadcast_to(line.reshape(shape), index.shape)):
                name = f'__uscale_gather_{count}'
                graph.graph.initializer.append(numpy_helper.from_array(line.astype(np.int64), name))
                nodes.append(helper.make_node('Gather', [node.input[0], name], list(node.output), name=name + '_node', axis=axis))
                count += 1
                continue
        nodes.append(node)
    if count:
        graph.graph.ClearField('node')
        graph.graph.node.extend(nodes)
        used = {name for node in nodes for name in node.input}
        initializers = [t for t in graph.graph.initializer if t.name in used]
        graph.graph.ClearField('initializer')
        graph.graph.initializer.extend(initializers)
    return graph, count


def integral_average_pools(model):
    """Integral-image adaptive average pooling with uniform k x k bins is AveragePool(k, stride k).

    SAFMN's export computes each pool level as CumSum -> zero pad -> Gather(end) - Gather(start)
    -> / k, once per spatial axis. ORT Web 1.23.2 has no WebGPU CumSum, and FP16
    integral sums lose precision. ORT Web registers pooling only for NHWC, which the
    product's disabled graph optimization never produces, so the pool is an exact
    depthwise Conv with 1/k^2 weights instead.
    """
    graph = onnx.load_from_string(model.SerializeToString())
    nodes = list(graph.graph.node)
    weights = {t.name: numpy_helper.to_array(t) for t in graph.graph.initializer}
    channels = {v.name: v.type.tensor_type.shape.dim[1].dim_value for v in list(graph.graph.value_info) + list(graph.graph.input)}
    producers = {o: n for n in nodes for o in n.output}
    consumers = {}
    for node in nodes:
        for name in node.input:
            consumers.setdefault(name, []).append(node)

    def attribute(node, name):
        return next((helper.get_attribute_value(a) for a in node.attribute if a.name == name), None)

    def axis_pool(cumsum, axis):
        # Returns (input, k, division node) when this CumSum is one uniform pooling axis.
        if cumsum.op_type != 'CumSum' or attribute(cumsum, 'exclusive') or attribute(cumsum, 'reverse') or \
                int(weights.get(cumsum.input[1], -1)) != axis:
            return None
        pads = [c for c in consumers.get(cumsum.output[0], []) if c.op_type == 'Concat']
        if len(pads) != 1 or attribute(pads[0], 'axis') != axis or not np.all(weights.get(pads[0].input[0], 1) == 0):
            return None
        gathers = consumers.get(pads[0].output[0], [])
        subs = {c.name: c for g in gathers for c in consumers.get(g.output[0], []) if c.op_type == 'Sub'}
        if len(gathers) != 2 or any(g.op_type != 'Gather' or attribute(g, 'axis') != axis for g in gathers) or len(subs) != 1:
            return None
        sub = next(iter(subs.values()))
        end, start = (weights.get(producers[name].input[1]) for name in sub.input)
        divisions = consumers.get(sub.output[0], [])
        if end is None or start is None or len(divisions) != 1 or divisions[0].op_type != 'Div':
            return None
        k = int(end[0] - start[0])
        divisor = weights.get(divisions[0].input[1])
        if k < 1 or divisor is None or not np.all(divisor == k) or not np.array_equal(start, np.arange(len(start)) * k) or \
                not np.array_equal(end, start + k):
            return None
        return cumsum.input[0], k, divisions[0]

    replaced, count = {}, 0
    for node in nodes:
        first = axis_pool(node, 2)
        if not first:
            continue
        follow = [c for c in consumers.get(first[2].output[0], [])]
        second = axis_pool(follow[0], 3) if len(follow) == 1 else None
        if not second or second[1] != first[1]:
            continue
        k, c = first[1], channels.get(first[0])
        if not c:
            continue
        name = f'__uscale_avgpool_{count}'
        graph.graph.initializer.append(numpy_helper.from_array(np.full((c, 1, k, k), 1 / (k * k), dtype=np.float32), name + '_weight'))
        replaced[second[2].name] = helper.make_node('Conv', [first[0], name + '_weight'], list(second[2].output), name=name,
                                                    group=c, kernel_shape=[k, k], strides=[k, k])
        count += 1
    if not count:
        return graph, 0
    nodes = [replaced.get(n.name, n) for n in nodes]
    needed, kept = {o.name for o in graph.graph.output}, []
    for node in reversed(nodes):
        if any(output in needed for output in node.output):
            kept.append(node)
            needed.update(node.input)
    graph.graph.ClearField('node')
    graph.graph.node.extend(reversed(kept))
    used = {name for node in kept for name in node.input}
    initializers = [t for t in graph.graph.initializer if t.name in used]
    graph.graph.ClearField('initializer')
    graph.graph.initializer.extend(initializers)
    graph.graph.ClearField('value_info')
    return onnx.shape_inference.infer_shapes(graph, strict_mode=True), count


def photo_sample(size):
    # A real photograph: random noise drives RealPLKSR far outside [0,1], where Clip order matters most.
    # This tracked fixture makes release preparation independent of private lab inputs.
    from PIL import Image, ImageOps
    with Image.open(PHOTO_SAMPLE) as source:
        image = ImageOps.fit(source.convert('RGB'), (size, size), method=Image.Resampling.LANCZOS)
    return (np.asarray(image, dtype=np.float32) / 255).transpose(2, 0, 1)[None].copy()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", type=Path, default=ROOT / ".web-model-work/photo4x")
    parser.add_argument("--sizes", default="256,128,320")
    parser.add_argument("--fp16", action="store_true")
    parser.add_argument("--models", default=",".join([*SOURCES, *DERIVED]))
    parser.add_argument("--webgpu-softplus", action="store_true")
    args = parser.parse_args()
    args.work = args.work.resolve()
    originals, prepared = args.work / "originals", args.work / "models"
    originals.mkdir(parents=True, exist_ok=True)
    prepared.mkdir(parents=True, exist_ok=True)
    manifest = {"schemaVersion": 1, "python": platform.python_version(),
                "tools": {k: importlib.metadata.version(k) for k in ["onnx", "onnxruntime", "onnxsim", "numpy", "onnxconverter-common"]},
                "license": {"claimed": "CC-BY-4.0", "publicationApproved": False,
                            "reason": "Upstream GitHub release says CC-BY-0.4; retain explicit author confirmation before publication."},
                "models": []}
    previous = args.work / 'manifest.json'
    if previous.exists():
        manifest['models'] = [m for m in json.loads(previous.read_text())['models'] if m['id'] not in args.models.split(',')]
    for model_id in args.models.split(","):
        source_id = DERIVED.get(model_id, model_id)
        scale = SCALES.get(model_id, 4)
        source_url = SOURCES[source_id]
        source = originals / f"{source_id}.onnx"
        if not source.exists():
            temporary = source.with_suffix(".part")
            urllib.request.urlretrieve(source_url, temporary)
            temporary.replace(source)
        if fingerprint(source)["sha256"] != SOURCE_HASHES[source_id]:
            raise ValueError(f"Upstream weights changed for {source_id}; review provenance before updating the pin")
        original = onnx.load(source)
        onnx.checker.check_model(original, full_check=True)
        source_info = {"url": source_url, **fingerprint(source), "graph": inspect(original)}
        portable, softplus_count = webgpu_softplus(original) if args.webgpu_softplus else (original, 0)
        for size in map(int, args.sizes.split(",")):
            print(f"Preparing {model_id} {size}", flush=True)
            fixed, valid = simplify(portable, overwrite_input_shapes={original.graph.input[0].name: [1, 3, size, size]}, check_n=0)
            if not valid:
                raise ValueError("Simplifier rejected graph")
            fixed = onnx.shape_inference.infer_shapes(fixed, strict_mode=True)
            fixed, gather_count = compact_gathers(fixed)
            fixed, pool_count = integral_average_pools(fixed)
            onnx.checker.check_model(fixed, full_check=True)
            parent = None
            if model_id in DERIVED:
                parent, fixed = fixed, fold_2x(fixed)
                onnx.checker.check_model(fixed, full_check=True)
            verification = None
            # Deterministic source-vs-fixed reference; no dynamic-shape compile
            # cost enters the browser measurements. Run only once per model.
            if size == 256:
                sample = np.random.default_rng(20261102).random((1, 3, size, size), dtype=np.float32)
                if parent is None:
                    before = session(original).run(None, {original.graph.input[0].name: sample})[0]
                    after = session(fixed).run(None, {fixed.graph.input[0].name: sample})[0]
                    difference = np.abs(before - after)
                    verification = {"maxAbsoluteError": float(difference.max()), "meanAbsoluteError": float(difference.mean()),
                                    "rtol": 0.001, "atol": 0.0001,
                                    "passed": bool(np.allclose(before, after, rtol=.001, atol=.0001))}
                    if not verification["passed"]:
                        raise ValueError(f"Fixed graph differs from original: {verification}")
                else:
                    # Exact target: the parent's clipped 4x output averaged over 2x2 blocks.
                    verification = {"reference": "parent 4x output, AveragePool 2x2 after Clip", "samples": {}}
                    for label, values in [("random", sample), ("photo", photo_sample(size))]:
                        pooled = session(original).run(None, {original.graph.input[0].name: values})[0]
                        pooled = pooled.reshape(1, 3, size * 2, 2, size * 2, 2).mean(axis=(3, 5))
                        folded = session(fixed).run(None, {fixed.graph.input[0].name: values})[0]
                        difference = np.abs(pooled - folded)
                        verification["samples"][label] = {"maxAbsoluteError": float(difference.max()),
                            "meanAbsoluteError": float(difference.mean()), "maxError255": float(difference.max() * 255),
                            "pixelsOver1of255": float(np.mean(difference.max(axis=1) > 1 / 255))}
                    photo = verification["samples"]["photo"]
                    verification["passed"] = photo["meanAbsoluteError"] < 1e-4 and photo["maxError255"] < 8
                    if not verification["passed"]:
                        raise ValueError(f"Folded 2x graph differs from pooled 4x: {verification}")
            for precision in (["fp32", "fp16"] if args.fp16 else ["fp32"]):
                graph = fixed
                if precision == "fp16":
                    fp16_verification = None
                    from onnxconverter_common.float16 import convert_float_to_float16
                    graph = convert_float_to_float16(onnx.load_from_string(fixed.SerializeToString()), keep_io_types=True,
                        node_block_list=[n.name for n in fixed.graph.node if n.name.startswith('__uscale_softplus_')])
                    onnx.checker.check_model(graph, full_check=True)
                    if size == 256:
                        # CPU check of the FP16 conversion itself; GPU arithmetic is verified in the browser.
                        values = photo_sample(size)
                        full = session(fixed).run(None, {fixed.graph.input[0].name: values})[0]
                        half = session(graph).run(None, {graph.graph.input[0].name: values})[0]
                        difference = np.abs(full - half) * 255
                        fp16_verification = {"input": str(PHOTO_SAMPLE.relative_to(ROOT)),
                                             "inputSha256": fingerprint(PHOTO_SAMPLE)['sha256'], "size": size,
                                             "inputTransform": "center crop resized with Lanczos",
                                             "mean255": float(difference.mean()),
                                             "max255": float(difference.max()), "finite": bool(np.isfinite(half).all())}
                        print(f"FP16 vs FP32 {model_id}: {fp16_verification}", flush=True)
                filename = f"{model_id}-{size}-{precision}{'-gpu' if softplus_count else ''}.onnx"
                target = prepared / filename
                onnx.save(graph, target)
                graph_info = inspect(graph)
                largest_tensor = max((v["bytes"] for v in graph_info["largestTensors"]), default=0)
                entry = {"id": model_id, "revision": fingerprint(target)["sha256"], "url": f"/photo4x/models/{filename}",
                         "precision": precision, "tileSize": size, "scale": scale, "inputType": "float32", "outputType": "float32",
                         "source": source_info, **fingerprint(target), "graph": graph_info,
                         "verification": verification if precision == 'fp32' else None,
                         "fp32ConversionVerification": verification,
                         "fp16Verification": fp16_verification if precision == 'fp16' else None,
                         **({"derivedFrom": source_id} if model_id in DERIVED else {}),
                         "transforms": {"fixedShape": True, "webgpuSoftplusNodes": softplus_count, "compactGatherNodes": gather_count, "integralAveragePools": pool_count,
                                        **({"fold2x": "2x2 box average folded into the final Conv; Clip after average"} if model_id in DERIVED else {}),
                                        "softplusPrecision": "fp32" if softplus_count else None},
                         "requires": {"features": ["shader-f16"] if precision == "fp16" else [],
                                      # ORT Web 1.23.2 has no WebGPU GridSample (DySample); it must run on CPU.
                                      "gpuOnly": bool(args.webgpu_softplus) and "GridSample" not in graph_info["operators"],
                                      "limits": {"maxBufferSize": largest_tensor, "maxStorageBufferBindingSize": largest_tensor}}}
                manifest["models"].append(entry)
                (args.work / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
                print(f"Saved {filename}: {target.stat().st_size} bytes", flush=True)


if __name__ == "__main__":
    main()
