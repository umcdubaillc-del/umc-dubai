#!/usr/bin/env python3
"""v73-C: one-off download script for the 25 user-provided fleet image URLs.
Each file is saved into site/assets/fleet/<model>/ at a canonical local
filename so build_pages.py + responsive_img can pick it up. Validates each
download by opening with PIL; reports per-file outcome."""
import os, sys, time, pathlib, urllib.request

HERE = pathlib.Path(__file__).resolve().parent
BASE = HERE / "site" / "assets" / "fleet"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

# (model_dir, slot_filename, source_url) — slot_filename's extension reflects
# the source content type; .webp where the source is webp.
JOBS = [
    # S-Class — hero only
    ("s-class", "hero-2025.webp",
     "https://friendscarrental.com/frontend/image/webp/mercedes-s-class-s500-1708352796658.webp"),

    # BMW 7 Series
    ("bmw-7", "hero.webp",
     "https://bmw.scene7.com/is/image/BMW/g70-ice-phev_exterior_highlight_side-view-chrome:3to2?fmt=webp&wid=1119&fit=constrain%2C1"),
    ("bmw-7", "interior.webp",
     "https://bmw.scene7.com/is/image/BMW/g70-ice-phev_interior_fond-entertainment:3to2?fmt=webp&wid=1919&fit=constrain%2C1"),
    ("bmw-7", "detail-1.webp",
     "https://bmw.scene7.com/is/image/BMW/g70-ice-phev_interior_highlight_curved-display:3to2?fmt=webp&wid=1119&fit=constrain%2C1"),
    ("bmw-7", "detail-2.webp",
     "https://bmw.scene7.com/is/image/BMW/g70-ice-phev_dynamics_executive-drive-pro:3to2?fmt=webp&wid=1919&fit=constrain%2C1"),
    ("bmw-7", "detail-3.webp",
     "https://bmw.scene7.com/is/image/BMW/g70-ice-phev_digital_rear-doors-touchscreens:3to2?fmt=webp&wid=1919&fit=constrain%2C1"),
    ("bmw-7", "detail-4.webp",
     "https://bmw.scene7.com/is/image/BMW/g70-ice-phev_digital_bowers-wilkins-sound-system:3to2?fmt=webp&wid=1919&fit=constrain%2C1"),

    # Cadillac Escalade
    ("cadillac-escalade", "hero.jpeg",
     "https://4kwallpapers.com/images/walls/thumbs_2t/3032.jpeg"),
    ("cadillac-escalade", "interior.jpg",
     "https://www.cadillacarabia.com/content/dam/cadillac/middle-east/master/english/index/crossover-suvs/2025-escalade/gallery/all/2025-vehicle-escalade-gallery-interior-seating-mobile.jpg?imwidth=1920"),
    ("cadillac-escalade", "detail-1.jpg",
     "https://www.cadillacarabia.com/content/dam/cadillac/middle-east/master/english/index/crossover-suvs/2025-escalade/gallery/all/2025-vehicle-escalade-gallery-interior-head-rest-speakers-mobile.jpg?imwidth=1920"),
    ("cadillac-escalade", "detail-2.jpg",
     "https://www.cadillacarabia.com/content/dam/cadillac/middle-east/master/english/index/crossover-suvs/2025-escalade/gallery/all/2025-vehicle-escalade-gallery-interior-door-sill-mobile.jpg?imwidth=1920"),
    ("cadillac-escalade", "detail-3.jpg",
     "https://images.netdirector.co.uk/gforces-auto/image/upload/w_411,h_274,q_auto,c_fill,f_auto,fl_lossy/auto-client/df201e5812a97071540c1b2476a7c293/2025_vehicle_escalade_gallery_interior_akg_speakers.jpg"),
    ("cadillac-escalade", "detail-4.jpg",
     "https://images.netdirector.co.uk/gforces-auto/image/upload/w_411,h_274,q_auto,c_fill,f_auto,fl_lossy/auto-client/a74faea4cc17738ccda09ef48fcc0da9/2025_vehicle_escalade_gallery_interior_center_console.jpg"),

    # GMC Yukon
    ("gmc-yukon-xl", "hero.jpg",
     "https://www.gmcarabia.com/content/dam/gmc/middleeast/master/en/index/suvs/2026-yukon/elevation/2026-yukon-elevation-capability.jpg?imwidth=1200"),
    ("gmc-yukon-xl", "interior.jpg",
     "https://www.gmcarabia.com/content/dam/gmc/middleeast/master/en/index/suvs/2026-yukon/elevation/2026-yukon-elevation-premium-seating.jpg?imwidth=1200"),
    ("gmc-yukon-xl", "detail-1.jpg",
     "https://www.gmcarabia.com/content/dam/gmc/middleeast/master/en/index/suvs/2026-yukon/elevation/2026-yukon-elevation-interior-3000x1000.jpg?imwidth=1200"),
    ("gmc-yukon-xl", "detail-2.jpg",
     "https://www.gmcarabia.com/content/dam/gmc/middleeast/master/en/index/suvs/2026-yukon/elevation/2026-yukon-elevation-16-8-diagonal.jpg?imwidth=1200"),
    ("gmc-yukon-xl", "detail-3.jpg",
     "https://www.gmcarabia.com/content/dam/gmc/middleeast/master/en/index/suvs/2026-yukon/elevation/2026-yukon-elevation-11-diagonal-driver.jpg?imwidth=1200"),
    ("gmc-yukon-xl", "detail-4.jpg",
     "https://www.gmcarabia.com/content/dam/gmc/middleeast/master/en/index/suvs/2026-yukon/elevation/2026-yukon-elevation-premium-bose.jpg?imwidth=1200"),

    # Lexus ES
    ("lexus-es", "hero.jpeg",
     "https://dbz-images.dubizzle.com/images/2026/06/18/24c59eae1a584e97a73981304ced335f-.jpeg?impolicy=dpv"),
    ("lexus-es", "interior.png",
     "https://www.lexus.co.id/content/dam/lexus-v3-indonesia/august-2022/es-new/Interior-6-desktop.png"),
    ("lexus-es", "detail-1.webp",
     "https://www.usnews.com/object/image/00000192-bb36-d9a4-a9da-fbb649b40000/2025-lexus-es-350-014.jpg?update-time=1729717749933&size=responsiveGallery&format=webp"),
    ("lexus-es", "detail-2.webp",
     "https://www.usnews.com/object/image/00000192-bb36-d9a4-a9da-fbb64a420000/2025-lexus-es-350-013.jpg?update-time=1729717750075&size=responsiveGallery&format=webp"),
    ("lexus-es", "detail-3.webp",
     "https://www.usnews.com/object/image/00000192-bb36-d9a4-a9da-fbb64a6d0000/2025-lexus-es-350-012.jpg?update-time=1729717750118&size=responsiveGallery&format=webp"),
    ("lexus-es", "detail-4.webp",
     "https://www.usnews.com/object/image/00000192-bb36-d9a4-a9da-fbb6498a0000/2025-lexus-es-350-015.jpg?update-time=1729717749891&size=responsiveGallery&format=webp"),
]

def fetch(url, dest):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.google.com/",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    if not data:
        raise RuntimeError("empty body")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    # Validate with PIL.
    try:
        from PIL import Image
        with Image.open(dest) as im:
            im.verify()
        # Re-open for size.
        with Image.open(dest) as im2:
            w, h = im2.size
    except Exception as e:
        raise RuntimeError(f"PIL rejected: {e}")
    return len(data), w, h

ok, fail = [], []
for model, name, url in JOBS:
    dest = BASE / model / name
    label = f"{model}/{name}"
    try:
        n, w, h = fetch(url, dest)
        ok.append((label, n, w, h))
        print(f"OK  {label:<40} {n//1024:>5} KB  {w}x{h}")
    except Exception as e:
        fail.append((label, str(e), url))
        print(f"ERR {label:<40} {e}")
    time.sleep(0.15)

print()
print(f"=== {len(ok)} succeeded, {len(fail)} failed ===")
if fail:
    for label, err, url in fail:
        print(f"FAILED: {label}\n  url: {url}\n  err: {err}")
sys.exit(1 if fail else 0)
