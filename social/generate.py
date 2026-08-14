#!/usr/bin/env python3
"""
Generates a branded square (1080x1080) Instagram/social post listing this
week's curated concerts. Matches the site's own visual identity (colors,
serif/sans pairing) rather than inventing a new look.

Usage:
    python3 social/generate.py

Input: EVENTS below — update this list by hand each week to match whatever
is currently live on 8concert.com (можна пізніше підключити сюди прямий
Airtable-фетч, як у build.js, якщо знадобиться автоматизація).

Output: social/output/afisha-<date>.png
"""
import datetime
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
FONTS = HERE / "fonts"
OUT = HERE / "output"
OUT.mkdir(exist_ok=True)

# Brand palette — copied from src/styles.css :root
CREAM = "#FAF7F2"
DARK = "#1C1612"
BROWN = "#8B6F5E"
WARM = "#C4956A"
MUTED = "#A89890"
LINE = "#E8E0D8"

W = H = 1080

def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)

F_SERIF_ITALIC = "DejaVuSerif-Italic.ttf"
F_SERIF = "DejaVuSerif.ttf"
F_SANS_BLACK = "Lato-Black.ttf"
F_SANS_BOLD = "Lato-Bold.ttf"
F_SANS = "Lato-Regular.ttf"

# This week's curated 8 (mirrors what's live on 8concert.com — update by hand
# on each run; real dates rather than "Сьогодні"/"Завтра" since the image
# will be viewed after the fact, not just on the day it's made).
EVENTS = [
    {"title": "Michael Jackson у симфонічному звучанні", "date": "14 серпня", "venue": "River Mall"},
    {"title": "Танго для парижанки", "date": "14 серпня", "venue": "Київська троянда"},
    {"title": "Imagine Dragons & Coldplay", "date": "15 серпня", "venue": "Дах ЦУМ"},
    {"title": "Great Summer Classic", "date": "16 серпня", "venue": "UNIT.City"},
    {"title": "Дорослий джаз в «Київській Троянді»", "date": "16 серпня", "venue": "Київська троянда"},
    {"title": "Музика вільних", "date": "22 серпня", "venue": "Андріївська церква"},
    {"title": "Морріконе та Бадаламенті на терасі", "date": "22 серпня", "venue": "Toronto-Kyiv Complex"},
    {"title": "Джаз на терасі", "date": "23 серпня", "venue": "Toronto-Kyiv Complex"},
]


def truncate(draw, text, fnt, max_width):
    if draw.textlength(text, font=fnt) <= max_width:
        return text
    ell = "…"
    lo, hi = 0, len(text)
    while lo < hi:
        mid = (lo + hi) // 2
        candidate = text[:mid].rstrip() + ell
        if draw.textlength(candidate, font=fnt) <= max_width:
            lo = mid + 1
        else:
            hi = mid
    return text[: max(lo - 1, 1)].rstrip() + ell


def main():
    img = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(img)

    margin = 72

    # --- header: small label + logo mark, same wording style as the site ---
    d.text((margin, 64), "РЕДАКЦІЙНА ДОБІРКА", font=font(F_SANS_BOLD, 15), fill=MUTED)
    d.line([(margin, 64 + 26), (margin + 30, 64 + 26)], fill=WARM, width=2)

    logo_y = 100
    d.text((margin, logo_y), "8", font=font(F_SANS_BLACK, 30), fill=DARK)
    w8 = d.textlength("8", font=font(F_SANS_BLACK, 30))
    d.text((margin + w8, logo_y), "CONCERT", font=font(F_SANS_BLACK, 30), fill=WARM)

    # --- headline ---
    headline_y = 168
    d.text((margin, headline_y), "8 концертів Києва", font=font(F_SERIF_ITALIC, 64), fill=DARK)
    d.text((margin, headline_y + 74), "цього тижня", font=font(F_SERIF_ITALIC, 64), fill=DARK)

    # --- event list ---
    list_top = 372
    row_h = 76
    num_w = 76
    date_w = 150
    content_right = W - margin

    f_num = font(F_SERIF_ITALIC, 30)
    f_title = font(F_SANS_BOLD, 24)
    f_venue = font(F_SANS, 16)
    f_date = font(F_SANS_BOLD, 16)

    for i, ev in enumerate(EVENTS):
        y = list_top + i * row_h
        if i > 0:
            d.line([(margin, y), (content_right, y)], fill=LINE, width=1)

        row_center = y + row_h / 2

        num_str = f"{i + 1:02d}"
        d.text((margin, row_center - 20), num_str, font=f_num, fill=LINE)

        text_x = margin + num_w
        title_max_w = content_right - text_x - date_w

        title = truncate(d, ev["title"], f_title, title_max_w)
        d.text((text_x, row_center - 24), title, font=f_title, fill=DARK)

        venue_line = f"— {ev['venue']}"
        venue_line = truncate(d, venue_line, f_venue, title_max_w)
        d.text((text_x, row_center + 4), venue_line, font=f_venue, fill=BROWN)

        date_str = ev["date"]
        dw = d.textlength(date_str, font=f_date)
        d.text((content_right - dw, row_center - 9), date_str, font=f_date, fill=WARM)

    # --- footer bar ---
    footer_h = 96
    footer_top = H - footer_h
    d.rectangle([(0, footer_top), (W, H)], fill=DARK)
    footer_text = "Повна афіша та квитки → 8concert.com"
    f_footer = font(F_SANS_BOLD, 22)
    tw = d.textlength(footer_text, font=f_footer)
    d.text(((W - tw) / 2, footer_top + (footer_h - 22) / 2 - 4), footer_text, font=f_footer, fill=CREAM)

    out_path = OUT / f"afisha-{datetime.date.today().isoformat()}.png"
    img.save(out_path)
    print(f"Saved {out_path}")


if __name__ == "__main__":
    main()
