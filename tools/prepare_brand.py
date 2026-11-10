from pathlib import Path
from PIL import Image, ImageDraw, ImageChops

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "assets" / "branding"
ORIG = BRAND / "original"
ORIG.mkdir(parents=True, exist_ok=True)

# Los originales viven en assets/branding/original/.
SRC_UNI = ORIG / "logo-universidad.jpeg"
SRC_ICON = ORIG / "logo-programa.jpeg"

def trim(im, bg=(247, 247, 247), tol=10, pad=12):
    im = im.convert("RGB")
    bg_im = Image.new("RGB", im.size, bg)
    diff = ImageChops.difference(im, bg_im).convert("L")
    mask = diff.point(lambda v: 255 if v > tol else 0)
    box = mask.getbbox()
    if not box:
        return im
    l, t, r, b = box
    l = max(0, l - pad); t = max(0, t - pad)
    r = min(im.width, r + pad); b = min(im.height, b + pad)
    return im.crop((l, t, r, b))

# University logo: trim only, keep light background (CSS uses multiply on cream)
uni = trim(Image.open(SRC_UNI))
uni.save(BRAND / "logo-universidad.png", optimize=True)
print("universidad", uni.size)

# Program icon: trim, then build variants
icon = trim(Image.open(SRC_ICON), pad=6).convert("RGBA")
icon.save(BRAND / "logo-programa-original-trim.png", optimize=True)
print("icono trim", icon.size)

# Variant A: global light-background removal to alpha
px = icon.load()
a = icon.copy()
ap = a.load()
for y in range(a.height):
    for x in range(a.width):
        r, g, b, _ = ap[x, y]
        d = max(abs(r - 247), abs(g - 247), abs(b - 247))
        if d <= 8:
            alpha = 0
        elif d < 34:
            alpha = int((d - 8) * 255 / 26)
        else:
            alpha = 255
        ap[x, y] = (r, g, b, alpha)
a.save(BRAND / "logo-programa.png", optimize=True)

# Variant B: circular crop of the light-background icon
w, h = icon.size
side = min(w, h)
sq = icon.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))
mask = Image.new("L", (side * 4, side * 4), 0)
ImageDraw.Draw(mask).ellipse((0, 0, side * 4 - 1, side * 4 - 1), fill=255)
mask = mask.resize((side, side), Image.LANCZOS)
circ = Image.new("RGBA", (side, side), (0, 0, 0, 0))
circ.paste(sq, (0, 0), mask)
circ.save(BRAND / "logo-programa-circle.png", optimize=True)

# Inspection composites
dark = Image.new("RGBA", (520, 260), (8, 18, 14, 255))
for i, name in enumerate(["logo-programa.png", "logo-programa-circle.png"]):
    im = Image.open(BRAND / name).convert("RGBA")
    im.thumbnail((200, 200), Image.LANCZOS)
    dark.alpha_composite(im, (30 + i * 250, (260 - im.height) // 2))
dark.save(BRAND / "_inspect_icons.png")

# Favicons on cream circle
def make_favicon(size):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    d.ellipse((0, 0, size - 1, size - 1), fill=(242, 239, 228, 255))
    inner = Image.open(BRAND / "logo-programa.png").convert("RGBA")
    pad = int(size * 0.12)
    inner.thumbnail((size - pad * 2, size - pad * 2), Image.LANCZOS)
    canvas.alpha_composite(inner, ((size - inner.width) // 2, (size - inner.height) // 2))
    return canvas

for s in (32, 180, 512):
    make_favicon(s).save(BRAND / f"favicon-{s}.png", optimize=True)

print("listo")
