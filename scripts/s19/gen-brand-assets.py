#!/usr/bin/env python3
"""Derive Portal brand assets from the approved Lumière crest master (ClientDesk branding, approved for Portal use).
Presentation = tight alpha crop (aspect ~0.973, as ClientDesk renders it at 40x42). Run: python3 scripts/s19/gen-brand-assets.py"""
from PIL import Image
import sys
MASTER = sys.argv[1] if len(sys.argv) > 1 else '/home/user/clientdesk/branding/clientdesk-crest-master.png'
src = Image.open(MASTER).convert('RGBA')
crest = src.crop(src.getchannel('A').getbbox())
w, h = crest.size
for H in (96, 192, 480):
    crest.resize((round(w * H / h), H), Image.LANCZOS).save(f'client/src/assets/brand/crest-{H}.webp', quality=92, method=6)
def square(px, bg=None, pad=0.12):
    im = Image.new('RGBA', (px, px), bg or (0, 0, 0, 0))
    H = round(px * (1 - 2 * pad)); W = round(w * H / h)
    c = crest.resize((W, H), Image.LANCZOS)
    im.alpha_composite(c, ((px - W) // 2, (px - H) // 2)); return im
square(32, pad=0.04).save('client/public/favicon-32.png')
square(64, pad=0.04).save('client/public/favicon.png')
square(180, (15, 21, 34, 255), 0.14).convert('RGB').save('client/public/apple-touch-icon.png')
