#!/usr/bin/env python3
"""Deploy qinlv-ip-query Worker via wrangler, vault surrogate in memory only."""
import os, subprocess, sys
sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import dynamic_credential_entry
entry = dynamic_credential_entry("custom.cloudflare")
surrogate = entry["surrogate"]
assert surrogate.startswith("hsurr:"), "unexpected surrogate format"
env = dict(os.environ)
env["CLOUDFLARE_API_TOKEN"] = surrogate
env["PATH"] = os.path.expanduser("~/.npm-global/bin") + ":" + env.get("PATH", "")
cmd = ["wrangler", "deploy"]
proc = subprocess.run(cmd, cwd="/home/hatch/workspace/build/website/ip-query",
                      env=env, capture_output=True, text=True, timeout=600)
print("--- wrangler stdout ---")
print(proc.stdout)
print("--- wrangler stderr ---")
print(proc.stderr)
print("exit code:", proc.returncode)
