"""prepare-photos.py: make the web copies of the paper's photos.

Masters live in media/photos/ (full size, as received, renamed so each says
what it shows). The site serves smaller copies from public/photos/, which the
build publishes as /photos/...: <name>-600.jpg for phones and small spots,
<name>-1200.jpg for wide screens. Run it after adding or replacing a master:

    python3 tools/prepare-photos.py

Only Pillow is needed. Existing web copies are overwritten."""

from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
MASTERS = ROOT / "media" / "photos"
WEB = ROOT / "public" / "photos"
WIDTHS = (600, 1200)


def flat_rgb(im):
    """Photos arrive as PNG screenshots with an alpha channel; print them on white."""
    im = ImageOps.exif_transpose(im)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        back = Image.new("RGB", im.size, "white")
        back.paste(im, mask=im.split()[-1])
        return back
    return im.convert("RGB")


def main():
    WEB.mkdir(parents=True, exist_ok=True)
    for master in sorted(MASTERS.glob("*.jpg")):
        im = flat_rgb(Image.open(master))
        for w in WIDTHS:
            copy = im.copy()
            if copy.width > w:
                copy = copy.resize((w, round(copy.height * w / copy.width)), Image.LANCZOS)
            out = WEB / f"{master.stem}-{w}.jpg"
            copy.save(out, "JPEG", quality=80, optimize=True, progressive=True)
            print(f"{out.relative_to(ROOT)}  {copy.width}x{copy.height}  {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
