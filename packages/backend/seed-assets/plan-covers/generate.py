from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1080, 720
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/Library/Fonts/Georgia.ttf",
    "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
    "/System/Library/Fonts/Times.ttc",
]
SANS = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]
def font(paths, size):
    for p in paths:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, size)
            except Exception: pass
    return ImageFont.load_default()

def lerp(a, b, t): return tuple(int(a[i] + (b[i]-a[i])*t) for i in range(3))

def gradient(top, bottom):
    img = Image.new("RGB", (W, H), top)
    d = ImageDraw.Draw(img)
    for y in range(H):
        d.line([(0, y), (W, y)], fill=lerp(top, bottom, y/H))
    return img

def rings(img, color, alpha=46):
    """Two overlapping circle outlines (YouVersion-ish motif), translucent white."""
    overlay = Image.new("RGBA", (W, H), (0,0,0,0))
    od = ImageDraw.Draw(overlay)
    for cx in (W*0.34, W*0.66):
        for r in (250, 320):
            bbox = [cx-r, H*0.5-r, cx+r, H*0.5+r]
            od.ellipse(bbox, outline=color+(alpha,), width=10)
    img.paste(Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB"), (0,0))

def wrap(draw, text, fnt, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=fnt) <= max_w: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def cover(path, title, kicker, top, bottom):
    img = gradient(top, bottom)
    rings(img, (255,255,255))
    d = ImageDraw.Draw(img)
    kf = font(SANS, 30); tf = font(FONT_CANDIDATES, 92)
    # kicker
    d.text((70, 70), kicker, font=kf, fill=(255,255,255,230))
    d.line([(70, 120), (70+ d.textlength(kicker, font=kf), 120)], fill=(245,199,126), width=4)
    # title, bottom-left, wrapped
    lines = wrap(d, title, tf, W-140)
    lh = 104
    y = H - 90 - lh*len(lines)
    for ln in lines:
        d.text((70, y), ln, font=tf, fill=(255,255,255)); y += lh
    img.save(path, "PNG")
    print("wrote", path)

cover("/tmp/plan-now-saved.png", "Now That You Are Saved", "NURU PATHWAY · FOUNDATIONS", (201,140,46), (122,84,20))
cover("/tmp/plan-grief.png", "Dealing with Grief", "NURU PATHWAY · COMFORT", (49,95,140), (11,31,51))
cover("/tmp/plan-anchored.png", "Anchored: Peace in the Storm", "NURU PATHWAY · FOUNDATIONS", (20,53,89), (8,28,54))
