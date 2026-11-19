#!/usr/bin/env bash
# One-time setup: Blender as a Python module (bpy), in a local virtual env.
# Needs Python 3.13 (the bpy wheel is built for one Python version) and ~1.5 GB of disk.
# The generated .glb files are committed, so you only need this to CHANGE a model.
set -e
cd "$(dirname "$0")"
python3 -m venv .venv
.venv/bin/pip install bpy==5.3.0
