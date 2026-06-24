#!/usr/bin/env python3
"""Generate Android launcher icons (legacy square + round + adaptive) from the
TGNM master logo. Source = the iOS 1024 app-icon master.

Run:  python3 android/make_launcher_icons.py
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
MOBILE = os.path.abspath(os.path.join(HERE, ".."))
SRC = os.path.join(MOBILE, "ios/NuruPlace/Images.xcassets/AppIcon.appiconset/AppIcon-1024.png")
RES = os.path.join(HERE, "app/src/main/res")

master = Image.open(SRC).convert("RGB")
# Background colour = the logo's cream backdrop (sampled near a corner).
BG = master.getpixel((12, 12))
BG_HEX = "#%02X%02X%02X" % BG

# Legacy launcher densities (square icon px) + adaptive foreground densities (108dp px).
LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
ADAPTIVE = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}

def circle_mask(size: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse([0, 0, size - 1, size - 1], fill=255)
    return m

for dens, px in LEGACY.items():
    d = os.path.join(RES, f"mipmap-{dens}")
    os.makedirs(d, exist_ok=True)
    sq = master.resize((px, px), Image.LANCZOS)
    sq.save(os.path.join(d, "ic_launcher.png"))
    # Round: circular crop on transparency.
    rnd = sq.convert("RGBA")
    rnd.putalpha(circle_mask(px))
    rnd.save(os.path.join(d, "ic_launcher_round.png"))

# Adaptive foreground: logo at ~66% (inside the 108dp safe zone), centered on transparent.
for dens, px in ADAPTIVE.items():
    d = os.path.join(RES, f"mipmap-{dens}")
    os.makedirs(d, exist_ok=True)
    canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    inner = round(px * 0.66)
    logo = master.resize((inner, inner), Image.LANCZOS).convert("RGBA")
    off = (px - inner) // 2
    canvas.paste(logo, (off, off))
    canvas.save(os.path.join(d, "ic_launcher_foreground.png"))

# Adaptive icon XML (API 26+) + background colour.
anydpi = os.path.join(RES, "mipmap-anydpi-v26")
os.makedirs(anydpi, exist_ok=True)
ADAPTIVE_XML = (
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
    '    <background android:drawable="@color/ic_launcher_background" />\n'
    '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
    '</adaptive-icon>\n'
)
for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
    with open(os.path.join(anydpi, name), "w") as f:
        f.write(ADAPTIVE_XML)

values = os.path.join(RES, "values")
os.makedirs(values, exist_ok=True)
with open(os.path.join(values, "ic_launcher_background.xml"), "w") as f:
    f.write(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        f'    <color name="ic_launcher_background">{BG_HEX}</color>\n</resources>\n'
    )

print("background colour:", BG_HEX)
print("done — legacy + round + adaptive icons written to res/")
