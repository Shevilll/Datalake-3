"""
export_mobilefacenet.py — export the recognition model to ONNX (DECISIONS.md D8).

Loads the MIT-licensed MobileFaceNet checkpoint (caojingtian1216/MobileFaceNet, HF),
keeps ONLY the `backbone.*` weights (the 512-d embedding network; the training-time
ArcFace `head` of shape 512x72778 is dropped), and exports a clean
(1,3,112,112) -> (1,512) ONNX that WE own under MIT.

The nn.Module below is a clean reimplementation of the canonical MobileFaceNet
(TreB1eN/InsightFace_Pytorch layout) written to match the checkpoint's state_dict
keys/shapes exactly, so `load_state_dict(strict=True)` validates the architecture.

Usage:
    harness/.venv/bin/python harness/export_mobilefacenet.py --ckpt /tmp/mbf_mit.pt
Output:
    models/recognition.onnx   (fp32)
"""

from __future__ import annotations

import argparse
from pathlib import Path

import torch
import torch.nn as nn

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


# --- building blocks (names chosen to match the checkpoint state_dict) -----------------


class Conv_block(nn.Module):
    def __init__(self, in_c, out_c, kernel, stride, padding, groups=1):
        super().__init__()
        self.conv = nn.Conv2d(in_c, out_c, kernel, stride, padding, groups=groups, bias=False)
        self.bn = nn.BatchNorm2d(out_c)
        self.prelu = nn.PReLU(out_c)

    def forward(self, x):
        return self.prelu(self.bn(self.conv(x)))


class Linear_block(nn.Module):
    def __init__(self, in_c, out_c, kernel, stride, padding, groups=1):
        super().__init__()
        self.conv = nn.Conv2d(in_c, out_c, kernel, stride, padding, groups=groups, bias=False)
        self.bn = nn.BatchNorm2d(out_c)

    def forward(self, x):
        return self.bn(self.conv(x))


class Depth_Wise(nn.Module):
    def __init__(self, in_c, out_c, kernel=(3, 3), stride=(2, 2), padding=(1, 1), groups=1, residual=False):
        super().__init__()
        self.conv = Conv_block(in_c, groups, kernel=(1, 1), stride=(1, 1), padding=(0, 0))
        self.conv_dw = Conv_block(groups, groups, kernel, stride, padding, groups=groups)
        self.project = Linear_block(groups, out_c, kernel=(1, 1), stride=(1, 1), padding=(0, 0))
        self.residual = residual

    def forward(self, x):
        out = self.project(self.conv_dw(self.conv(x)))
        return out + x if self.residual else out


class Residual(nn.Module):
    def __init__(self, c, num_block, groups, kernel=(3, 3), stride=(1, 1), padding=(1, 1)):
        super().__init__()
        self.model = nn.Sequential(
            *[Depth_Wise(c, c, kernel, stride, padding, groups, residual=True) for _ in range(num_block)]
        )

    def forward(self, x):
        return self.model(x)


class MobileFaceNet(nn.Module):
    """Canonical MobileFaceNet: 112x112x3 -> 512-d embedding."""

    def __init__(self, embedding_size=512):
        super().__init__()
        self.conv1 = Conv_block(3, 64, (3, 3), (2, 2), (1, 1))
        self.conv2_dw = Conv_block(64, 64, (3, 3), (1, 1), (1, 1), groups=64)
        self.conv_23 = Depth_Wise(64, 64, (3, 3), (2, 2), (1, 1), groups=128)
        self.conv_3 = Residual(64, num_block=4, groups=128)
        self.conv_34 = Depth_Wise(64, 128, (3, 3), (2, 2), (1, 1), groups=256)
        self.conv_4 = Residual(128, num_block=6, groups=256)
        self.conv_45 = Depth_Wise(128, 128, (3, 3), (2, 2), (1, 1), groups=512)
        self.conv_5 = Residual(128, num_block=2, groups=256)
        self.conv_6_sep = Conv_block(128, 512, (1, 1), (1, 1), (0, 0))
        self.conv_6_dw = Linear_block(512, 512, (7, 7), (1, 1), (0, 0), groups=512)
        self.linear = nn.Linear(512, embedding_size, bias=False)
        self.bn = nn.BatchNorm1d(embedding_size)

    def forward(self, x):
        out = self.conv1(x)
        out = self.conv2_dw(out)
        out = self.conv_23(out)
        out = self.conv_3(out)
        out = self.conv_34(out)
        out = self.conv_4(out)
        out = self.conv_45(out)
        out = self.conv_5(out)
        out = self.conv_6_sep(out)
        out = self.conv_6_dw(out)
        out = torch.flatten(out, 1)
        out = self.linear(out)
        out = self.bn(out)
        return out  # L2-normalization is applied downstream (harness / app)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", type=Path, default=Path("/tmp/mbf_mit.pt"))
    ap.add_argument("--out", type=Path, default=MODELS_DIR / "recognition.onnx")
    ap.add_argument("--opset", type=int, default=17)
    args = ap.parse_args()

    # weights_only=True avoids unpickling arbitrary objects from a 3rd-party file.
    try:
        ck = torch.load(args.ckpt, map_location="cpu", weights_only=True)
    except Exception as e:
        print(f"  (weights_only=True failed: {e}; retrying with safe_globals for OrderedDict)")
        from collections import OrderedDict

        torch.serialization.add_safe_globals([OrderedDict])
        ck = torch.load(args.ckpt, map_location="cpu", weights_only=True)
    sd = ck["state_dict"] if "state_dict" in ck else ck
    backbone = {k[len("backbone."):]: v for k, v in sd.items() if k.startswith("backbone.")}
    print(f"backbone tensors: {len(backbone)} | params: {sum(v.numel() for v in backbone.values()):,}")

    model = MobileFaceNet().eval()
    missing, unexpected = model.load_state_dict(backbone, strict=False)
    if missing or unexpected:
        print("  ! missing:", missing)
        print("  ! unexpected:", unexpected)
        raise SystemExit("state_dict mismatch — architecture does not match checkpoint")
    print("  ✓ load_state_dict strict match — architecture verified")

    dummy = torch.randn(1, 3, 112, 112)
    with torch.no_grad():
        out = model(dummy)
    print(f"  forward OK: output shape {tuple(out.shape)}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        dummy,
        str(args.out),
        input_names=["input"],
        output_names=["embedding"],
        opset_version=args.opset,
        do_constant_folding=True,
        dynamo=False,  # stable legacy exporter; avoids onnxscript dep
    )
    print(f"  exported -> {args.out} ({args.out.stat().st_size/1e6:.2f} MB)")

    # Optional simplify
    try:
        import onnx
        from onnxsim import simplify

        m = onnx.load(str(args.out))
        ms, ok = simplify(m)
        if ok:
            onnx.save(ms, str(args.out))
            print(f"  simplified -> {args.out.stat().st_size/1e6:.2f} MB")
    except Exception as e:  # pragma: no cover
        print(f"  (onnxsim skipped: {e})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
