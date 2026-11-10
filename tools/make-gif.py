"""Builds docs/media/demo.gif from the frames written by capture-media.cjs.
Usage: python tools/make-gif.py <frameDir> [width]"""
import glob, os, sys
from PIL import Image

src = sys.argv[1]
width = int(sys.argv[2]) if len(sys.argv) > 2 else 800
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'media', 'demo.gif')
files = sorted(glob.glob(os.path.join(src, 'f*.png')))
frames = []
for f in files:
    im = Image.open(f).convert('RGB')
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    frames.append(im.quantize(colors=96, method=Image.MEDIANCUT, dither=Image.NONE))
frames[0].save(out, save_all=True, append_images=frames[1:], duration=110, loop=0, optimize=True, disposal=1)
print(len(frames), 'frames', round(os.path.getsize(out) / 1e6, 2), 'MB')
