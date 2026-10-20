"""Import the avatar library from the Sintonia project into avatars/.

The originals are 256 px lossless WebP with a transparent background (res/drawable-nodpi/avatar_*.webp).
The app shows them at 28-72 CSS px, so 192 px lossy WebP (alpha kept) is plenty sharp at 3x and ~5x lighter.

Usage:  python tools/import_avatars.py "C:/Users/.../Trainig_TatiPortela/app/src/main/res/drawable-nodpi"
"""
import sys
from pathlib import Path

from PIL import Image

SIZE = 192
OUT = Path(__file__).resolve().parent.parent / 'avatars'


def main(src_dir):
    src = Path(src_dir)
    files = sorted(src.glob('avatar_*.webp'))
    if not files:
        sys.exit(f'No avatar_*.webp files in {src}')
    OUT.mkdir(exist_ok=True)
    before = after = 0
    for f in files:
        av_id = f.stem.removeprefix('avatar_')
        im = Image.open(f).convert('RGBA').resize((SIZE, SIZE), Image.LANCZOS)
        dest = OUT / f'{av_id}.webp'
        im.save(dest, 'WEBP', quality=86, alpha_quality=90, method=6)
        before += f.stat().st_size
        after += dest.stat().st_size
    print(f'{len(files)} avatars: {before / 1024:.0f} KB -> {after / 1024:.0f} KB in {OUT}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.')
