#!/usr/bin/env python3
"""Génère les icônes PNG de la PWA sans aucune dépendance (stdlib uniquement).

Dessine un « × » et un « a » blancs sur fond bleu (#2a78d6), coins arrondis
pour les icônes "any", plein cadre pour la maskable.
"""
import os
import struct
import zlib

BLUE = (42, 120, 214)
WHITE = (255, 255, 255)


def write_png(path, size, pixels):
    raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in pixels)

    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


def make_icon(size, rounded):
    radius = size * 0.22 if rounded else 0
    # le « × » occupe le carré central (zone sûre maskable : 80 % du centre)
    cx, cy = size * 0.5, size * 0.5
    half = size * 0.19      # demi-diagonale du ×
    thick = size * 0.055    # demi-épaisseur des barres

    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            # coins arrondis (icônes "any")
            a = 255
            if radius:
                dx = max(radius - x, x - (size - 1 - radius), 0)
                dy = max(radius - y, y - (size - 1 - radius), 0)
                if dx * dx + dy * dy > radius * radius:
                    a = 0
            u, v = x - cx, y - cy
            on_cross = (
                abs(u) <= half + thick
                and abs(v) <= half + thick
                and (abs(u - v) <= thick * 1.4 or abs(u + v) <= thick * 1.4)
            )
            color = WHITE if on_cross else BLUE
            row.append((color[0], color[1], color[2], a))
        rows.append(row)
    return rows


def main():
    out = os.path.join(os.path.dirname(__file__), "..", "icons")
    os.makedirs(out, exist_ok=True)
    write_png(os.path.join(out, "icon-192.png"), 192, make_icon(192, rounded=True))
    write_png(os.path.join(out, "icon-512.png"), 512, make_icon(512, rounded=True))
    write_png(os.path.join(out, "icon-maskable-512.png"), 512, make_icon(512, rounded=False))
    print("icônes générées dans", os.path.abspath(out))


if __name__ == "__main__":
    main()
