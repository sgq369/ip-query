#!/usr/bin/env python3
"""清 Cloudflare 边缘缓存（ip.sungongqin.com 前缀）。

部署后 /ip/ 落地页的 SSR HTML 带 s-maxage=86400，边缘节点会继续
发旧版，必须清一次缓存新版才全网生效。静态资源 s-maxage=3600，
同理一起清。用法：
  PYTHONPATH=/opt/muse/skills/custom-connector-setup/bin python3 tools/purge-cache.py
凭证走保险库 custom.cloudflare 的 surrogate token，内存传、不落盘。
"""
import json
import sys
import urllib.request

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import dynamic_credential_entry

ZONE_ID = "bc797d6a37f02b016f2b2dd9769db652"


def main():
    entry = dynamic_credential_entry("custom.cloudflare")
    token = entry["surrogate"]
    assert token.startswith("hsurr:"), "unexpected surrogate format"
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/zones/{ZONE_ID}/purge_cache",
        data=json.dumps({"prefixes": ["ip.sungongqin.com/"]}).encode(),
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        body = json.load(r)
    print(json.dumps(body, ensure_ascii=False))
    if not body.get("success"):
        raise SystemExit(1)
    print("purged: https://ip.sungongqin.com/ prefix")


if __name__ == "__main__":
    main()
