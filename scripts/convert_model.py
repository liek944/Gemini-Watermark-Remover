#!/usr/bin/env python3
"""
Convert LaMa ONNX model from FP32 to FP16 (memory-efficient).

Directly converts weight initializers to FP16 using numpy,
avoiding the O(n²) overhead of onnxconverter_common on large models.

Usage:
    python3 scripts/convert_model.py

Requires: pip install onnx numpy
"""

import os
import sys
import numpy as np
import onnx
from onnx import numpy_helper, TensorProto


def get_size_mb(path):
    return os.path.getsize(path) / (1024 * 1024)


# Ops whose weight tensors should stay FP32 to preserve numerical stability
KEEP_FP32_OPS = {
    "BatchNormalization",
    "InstanceNormalization",
    "LayerNormalization",
    "GroupNormalization",
}


def get_protected_initializer_names(graph):
    """Find initializer names used by ops that must stay FP32."""
    protected = set()
    for node in graph.node:
        if node.op_type in KEEP_FP32_OPS:
            for inp_name in node.input:
                protected.add(inp_name)
    return protected


def convert_fp16(input_path, output_path):
    """Convert FP32 ONNX model weights to FP16 in-place."""
    print(f"Loading model from: {input_path}")
    model = onnx.load(input_path)
    graph = model.graph

    print(f"  Nodes: {len(graph.node)}, Initializers: {len(graph.initializer)}")

    # Find which initializers to protect (normalization layers)
    protected = get_protected_initializer_names(graph)
    print(f"  Protected initializers (kept FP32): {len(protected)}")

    converted = 0
    skipped = 0
    total = len(graph.initializer)

    for i, initializer in enumerate(graph.initializer):
        if (i + 1) % 50 == 0 or i == total - 1:
            print(f"  Progress: {i + 1}/{total} initializers processed "
                  f"({converted} converted, {skipped} skipped)")

        # Only convert FP32 tensors
        if initializer.data_type != TensorProto.FLOAT:
            skipped += 1
            continue

        # Skip protected initializers
        if initializer.name in protected:
            skipped += 1
            continue

        # Skip small tensors (scalars, bias-like) — not worth converting
        size = 1
        for d in initializer.dims:
            size *= d
        if size <= 16:
            skipped += 1
            continue

        # Convert to FP16
        arr = numpy_helper.to_array(initializer).astype(np.float16)
        new_tensor = numpy_helper.from_array(arr, name=initializer.name)
        graph.initializer[i].CopyFrom(new_tensor)
        converted += 1

    print(f"\n  Converted {converted} initializers to FP16, skipped {skipped}")

    # Update internal value_info dtype for converted tensors
    # (inputs/outputs stay FP32 — runtime handles casting)

    print(f"Saving to: {output_path}")
    onnx.save(model, output_path)
    print(f"  Done.")

    return output_path


def verify_model(model_path):
    """Quick structural verification."""
    print(f"  Loading for verification...")
    model = onnx.load(model_path)

    # Count dtypes
    fp16_count = sum(1 for init in model.graph.initializer
                     if init.data_type == TensorProto.FLOAT16)
    fp32_count = sum(1 for init in model.graph.initializer
                     if init.data_type == TensorProto.FLOAT)
    total = len(model.graph.initializer)

    print(f"  Initializers: {total} total, {fp16_count} FP16, {fp32_count} FP32, "
          f"{total - fp16_count - fp32_count} other")

    for inp in model.graph.input:
        shape = [d.dim_value for d in inp.type.tensor_type.shape.dim]
        dtype = inp.type.tensor_type.elem_type
        print(f"  Input:  {inp.name} shape={shape} dtype={dtype}")
    for out in model.graph.output:
        shape = [d.dim_value for d in out.type.tensor_type.shape.dim]
        dtype = out.type.tensor_type.elem_type
        print(f"  Output: {out.name} shape={shape} dtype={dtype}")

    print(f"  ✓ Model saved successfully")
    return True


def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    assets_dir = os.path.join(base_dir, "src", "assets")

    fp32_path = os.path.join(assets_dir, "lama_fp32.onnx")
    fp16_path = os.path.join(assets_dir, "lama_fp16.onnx")

    if not os.path.exists(fp32_path):
        print(f"ERROR: Source model not found: {fp32_path}")
        sys.exit(1)

    fp32_size = get_size_mb(fp32_path)
    print(f"Source: {fp32_path} ({fp32_size:.1f} MB)")
    print("=" * 60)

    # Convert
    print("\n[1/2] Converting FP32 → FP16")
    convert_fp16(fp32_path, fp16_path)
    fp16_size = get_size_mb(fp16_path)
    print(f"  Size: {fp16_size:.1f} MB ({fp16_size / fp32_size * 100:.0f}% of original)")

    # Verify
    print("\n[2/2] Verifying FP16 model")
    verify_model(fp16_path)

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print(f"  FP32 (original): {fp32_size:>8.1f} MB")
    print(f"  FP16 (new):      {fp16_size:>8.1f} MB")
    reduction = (1 - fp16_size / fp32_size) * 100
    print(f"  Reduction:       {reduction:.0f}%")
    print(f"\nOutput: {fp16_path}")


if __name__ == "__main__":
    main()
