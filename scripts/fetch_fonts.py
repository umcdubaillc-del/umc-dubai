#!/usr/bin/env python3
# One-off: self-host the two webfonts the site uses (P-1 performance).
# Marcellus 400 (headings) + Outfit variable 300-500 (UI/body), latin subset.
# Google Fonts serves both under the OFL, which permits self-hosting.
import urllib.request, pathlib

DEST = pathlib.Path(__file__).resolve().parent.parent / "site" / "assets" / "fonts"
DEST.mkdir(parents=True, exist_ok=True)

FILES = {
    "marcellus-400.woff2": "https://fonts.gstatic.com/s/marcellus/v14/wEO_EBrOk8hQLDvIAF81VvoK.woff2",
    "outfit-var.woff2":    "https://fonts.gstatic.com/s/outfit/v15/QGYvz_MVcBeNP4NJtEtq.woff2",
}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

for name, url in FILES.items():
    out = DEST / name
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    data = urllib.request.urlopen(req, timeout=30).read()
    out.write_bytes(data)
    print(f"saved {out.relative_to(DEST.parent.parent)} ({len(data)} bytes)")
