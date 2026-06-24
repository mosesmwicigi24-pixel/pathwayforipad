#!/usr/bin/env python3
"""Generate Play Store graphics from the app's master icon + brand tokens.

Outputs (graphics/):
  - icon-512.png            512x512 store icon (32-bit PNG, no alpha needed)
  - feature-graphic-1024x500.png   required feature graphic

Run:  python3 make_graphics.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
MOBILE = os.path.abspath(os.path.join(HERE, "..", ".."))
MASTER = os.path.join(MOBILE, "ios/NuruPlace/Images.xcassets/AppIcon.appiconset/AppIcon-1024.png")
FONTS = os.path.join(MOBILE, "src/assets/fonts")
OUT = os.path.join(HERE, "graphics")
os.makedirs(OUT, exist_ok=True)

NAVY = (11, 31, 51)        # #0B1F33
NAVY_DEEP = (0, 19, 47)    # #00132F
GOLD = (200, 155, 60)      # #C89B3C
PAPER = (246, 244, 238)    # #F6F4EE

# ---- 512 store icon (downscale master) --------------------------------------
master = Image.open(MASTER).convert("RGB")
icon512 = master.resize((512, 512), Image.LANCZOS)
icon512.save(os.path.join(OUT, "icon-512.png"))
print("wrote icon-512.png")

# ---- Feature graphic 1024x500 -----------------------------------------------
W, H = 1024, 500
fg = Image.new("RGB", (W, H), NAVY_DEEP)
draw = ImageDraw.Draw(fg)
# Vertical navy gradient for depth.
for y in range(H):
    t = y / H
    r = int(NAVY_DEEP[0] + (NAVY[0] - NAVY_DEEP[0]) * t)
    g = int(NAVY_DEEP[1] + (NAVY[1] - NAVY_DEEP[1]) * t)
    b = int(NAVY_DEEP[2] + (NAVY[2] - NAVY_DEEP[2]) * t)
    draw.line([(0, y), (W, y)], fill=(r, g, b))
# Gold accent rule.
draw.rectangle([72, 250, 72 + 64, 250 + 6], fill=GOLD)

# Rounded app icon on the right.
ic = master.resize((300, 300), Image.LANCZOS)
mask = Image.new("L", (300, 300), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, 300, 300], radius=66, fill=255)
fg.paste(ic, (W - 300 - 80, (H - 300) // 2), mask)

def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)

# Wordmark + tagline (Fraunces serif title, Inter body).
draw.text((72, 150), "Nuru Pathway", font=font("Fraunces-SemiBold.ttf", 78), fill=PAPER)
draw.text((72, 286), "Walk the discipleship journey —", font=font("Inter-Medium.ttf", 30), fill=(210, 218, 228))
draw.text((72, 326), "lessons, prayer, community & giving.", font=font("Inter-Medium.ttf", 30), fill=(210, 218, 228))
draw.text((72, 396), "NURU PLACE", font=font("Inter-SemiBold.ttf", 22), fill=GOLD)
fg.save(os.path.join(OUT, "feature-graphic-1024x500.png"))
print("wrote feature-graphic-1024x500.png")
