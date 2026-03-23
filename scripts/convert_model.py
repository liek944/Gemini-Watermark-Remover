#!/usr/bin/env python3
"""
Convert LaMa ONNX model from FP32 to FP16.

Uses onnxconverter_common.float16 to properly convert the full graph
(initializers, Cast nodes, type info) — not just raw weight data.

Usage:
    python3 scripts/convert_model.py

Requires: pip install onnx onnxconverter-common numpy
"""

import os
import sys
import time
import threading
import onnx
from onnx import TensorProto


def get_size_mb(path):
    return os.path.getsize(path) / (1024 * 1024)




def progress_spinner(stop_event, step_name):
    """Background thread that prints elapsed time while a step is running."""
    start = time.time()
    while not stop_event.is_set():
        elapsed = time.time() - start
        mins, secs = divmod(int(elapsed), 60)
        print(f"\r  ⏳ {step_name}... {mins:02d}:{secs:02d} elapsed", end="", flush=True)
        stop_event.wait(timeout=2.0)
    elapsed = time.time() - start
    mins, secs = divmod(int(elapsed), 60)
    print(f"\r  ✓ {step_name} — completed in {mins:02d}:{secs:02d}       ")


def run_with_progress(step_name, fn):
    """Run fn() while showing a live elapsed-time counter."""
    stop = threading.Event()
    spinner = threading.Thread(target=progress_spinner, args=(stop, step_name), daemon=True)
    spinner.start()
    try:
        result = fn()
    finally:
        stop.set()
        spinner.join()
    return result


def fix_cast_nodes(model):
    """Fix Cast nodes whose output type doesn't match value_info.

    onnxconverter_common sometimes inserts Cast nodes with the wrong
    output dtype in complex subgraphs (especially FFC/FFT blocks).
    This aligns each Cast node's 'to' attribute with the graph's
    authoritative value_info type declarations.
    """
    graph = model.graph

    # Build map: tensor_name -> expected element type from value_info
    type_map = {}
    for vi in list(graph.value_info) + list(graph.input) + list(graph.output):
        if vi.type.tensor_type.elem_type:
            type_map[vi.name] = vi.type.tensor_type.elem_type

    fixed = 0
    for node in graph.node:
        if node.op_type != "Cast":
            continue
        output_name = node.output[0]
        expected = type_map.get(output_name)
        if expected is None:
            continue
        # Read current 'to' attribute
        for attr in node.attribute:
            if attr.name == "to" and attr.i != expected:
                attr.i = expected
                fixed += 1
                break

    return model, fixed


def convert_fp16(input_path, output_path):
    """Convert FP32 ONNX model to FP16 using onnxconverter_common."""
    from onnxconverter_common import float16

    # Step 1: Load
    print("[1/4] Loading model...")
    model = run_with_progress("Loading", lambda: onnx.load(input_path))

    graph = model.graph
    print(f"       Nodes: {len(graph.node)}, Initializers: {len(graph.initializer)}")

    # Step 2: Convert
    print("[2/4] Converting FP32 → FP16 (this is the slow step)...")
    model_fp16 = run_with_progress(
        "Converting",
        lambda: float16.convert_float_to_float16(
            model,
            keep_io_types=True,
            min_positive_val=1e-7,
            max_finite_val=1e4,
        ),
    )

    # Step 3: Fix broken Cast nodes in FFC/FFT subgraphs
    print("[3/4] Fixing Cast node type mismatches...")
    model_fp16, fixed_count = fix_cast_nodes(model_fp16)
    print(f"       Fixed {fixed_count} Cast nodes")

    # Step 4: Save
    print(f"[4/4] Saving to: {output_path}")
    run_with_progress("Saving", lambda: onnx.save(model_fp16, output_path))

    return output_path


def verify_model(model_path):
    """Verify the converted model by creating an inference session."""
    print("  Loading model for verification...")
    model = onnx.load(model_path)

    # Count dtypes
    fp16_count = sum(
        1 for init in model.graph.initializer if init.data_type == TensorProto.FLOAT16
    )
    fp32_count = sum(
        1 for init in model.graph.initializer if init.data_type == TensorProto.FLOAT
    )
    total = len(model.graph.initializer)

    print(
        f"  Initializers: {total} total, {fp16_count} FP16, {fp32_count} FP32, "
        f"{total - fp16_count - fp32_count} other"
    )

    for inp in model.graph.input:
        shape = [d.dim_value for d in inp.type.tensor_type.shape.dim]
        dtype = inp.type.tensor_type.elem_type
        dtype_name = "FLOAT" if dtype == 1 else "FLOAT16" if dtype == 10 else str(dtype)
        print(f"  Input:  {inp.name} shape={shape} dtype={dtype_name}")
    for out in model.graph.output:
        shape = [d.dim_value for d in out.type.tensor_type.shape.dim]
        dtype = out.type.tensor_type.elem_type
        dtype_name = "FLOAT" if dtype == 1 else "FLOAT16" if dtype == 10 else str(dtype)
        print(f"  Output: {out.name} shape={shape} dtype={dtype_name}")

    # Try creating an inference session to catch type errors
    try:
        import onnxruntime as ort

        print("  Creating inference session (catches type mismatches)...")
        session = ort.InferenceSession(
            model_path, providers=["CPUExecutionProvider"]
        )
        print(f"  ✓ Session created successfully — no type errors")
        del session
    except ImportError:
        print("  ⚠ onnxruntime not installed — skipping session test")
    except Exception as e:
        print(f"  ✗ Session creation FAILED: {e}")
        return False

    print(f"  ✓ Model verified")
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
    print()
    convert_fp16(fp32_path, fp16_path)
    fp16_size = get_size_mb(fp16_path)
    print(f"  Size: {fp16_size:.1f} MB ({fp16_size / fp32_size * 100:.0f}% of original)")

    # Verify
    print()
    print("Verifying FP16 model...")
    success = verify_model(fp16_path)

    # Summary
    print()
    print("=" * 60)
    print("SUMMARY")
    print(f"  FP32 (original): {fp32_size:>8.1f} MB")
    print(f"  FP16 (new):      {fp16_size:>8.1f} MB")
    reduction = (1 - fp16_size / fp32_size) * 100
    print(f"  Reduction:       {reduction:.0f}%")
    print(f"\nOutput: {fp16_path}")

    if not success:
        print("\n⚠ WARNING: Model verification failed! Check errors above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
