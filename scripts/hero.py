"""Generate assets/hero.svg: an animated Claude Code session for the README.

Usage: python3 scripts/hero.py <GeistMono-Regular.ttf> <GeistMono-Bold.ttf> assets/hero.svg

Needs fonttools and brotli (pip install fonttools brotli). Geist Mono (OFL) is subset to the
characters used and embedded, so the SVG renders the same everywhere; get it from
https://github.com/vercel/geist-font. Edit scene() below to change the copy. The train data is
an example written in the server's output format.
"""
import base64
import io
import sys
from html import escape

from fontTools import subset
from fontTools.ttLib import TTFont

REGULAR, BOLD, OUT = sys.argv[1], sys.argv[2], sys.argv[3]

BG = "#0a0a0a"
TEXT = "#ffffff"
MUTED = "#a2a2a2"   # white at 62% on BG
FAINT = "#6f6f6f"
CLAUDE = "#d97757"
GREEN = "#4eba65"
AMBER = "#f5b942"

W = 880
PAD_X = 28
BAR_H = 40
TOP = BAR_H + 32          # first baseline
LH = 22                   # line height
FS = 13
CW = FS * 0.6             # monospace advance
LOOP = 20.0               # seconds per loop
TYPE = 0.045              # seconds per typed character
STACK = "'Geist Mono',ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace"


def font_face(path, chars, weight):
    font = TTFont(path)
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = []
    options.name_IDs = []
    subsetter = subset.Subsetter(options)
    subsetter.populate(text="".join(sorted(set(chars))) + " ")
    subsetter.subset(font)
    font.flavor = "woff2"
    buf = io.BytesIO()
    font.save(buf)
    data = base64.b64encode(buf.getvalue()).decode()
    return (
        f"@font-face{{font-family:'Geist Mono';font-weight:{weight};"
        f"src:url(data:font/woff2;base64,{data}) format('woff2')}}"
    )


def pct(t):
    return min(t / LOOP * 100, 93.9)


def visible(name, start, end=None):
    """Hidden until `start`, then shown (until `end`), fading out with the loop."""
    a = pct(start)
    if end is None:
        frames = f"0%,{a:.2f}%{{opacity:0}}{a + 0.06:.2f}%,94%{{opacity:1}}97%,100%{{opacity:0}}"
    else:
        b = pct(end)
        frames = f"0%,{a:.2f}%{{opacity:0}}{a + 0.06:.2f}%,{b:.2f}%{{opacity:1}}{b + 0.06:.2f}%,100%{{opacity:0}}"
    return f"@keyframes {name}{{{frames}}}.{name}{{animation:{name} {LOOP}s infinite}}"


def tspans(runs):
    """Runs are (text, colour) or (text, colour, "b") for bold."""
    out = []
    for text, colour, *bold in runs:
        weight = ' font-weight="700"' if bold else ""
        out.append(f'<tspan fill="{colour}"{weight}>{escape(text)}</tspan>')
    return "".join(out)


class Session:
    """Lines placed on a timeline: each appears at the current time on the next row."""

    def __init__(self):
        self.t, self.row, self.n = 0.6, 0, 0
        self.css, self.defs, self.body, self.runs = [], [], [], []

    def _id(self):
        self.n += 1
        return f"e{self.n}"

    def y(self):
        return TOP + self.row * LH

    def typed(self, prompt, runs, after):
        i, y = self._id(), self.y()
        n = sum(len(s) for s, *_ in runs)
        x0 = PAD_X + sum(len(s) for s, *_ in prompt) * CW
        full = n * CW + 2
        end = self.t + n * TYPE
        self.css.append(visible(i, self.t))
        self.css.append(
            f"@keyframes w{i}{{0%,{pct(self.t):.2f}%{{width:0;animation-timing-function:steps({n},end)}}"
            f"{pct(end):.2f}%,100%{{width:{full:.1f}px}}}}.c{i}{{animation:w{i} {LOOP}s infinite}}"
        )
        self.defs.append(
            f'<clipPath id="k{i}"><rect class="c{i}" x="{x0:.1f}" y="{y - LH + 6}" width="{full:.1f}" height="{LH}"/></clipPath>'
        )
        self.body.append(
            f'<g class="{i}"><text x="{PAD_X}" y="{y}">{tspans(prompt)}</text>'
            f'<text x="{x0:.1f}" y="{y}" clip-path="url(#k{i})">{tspans(runs)}</text></g>'
        )
        self.runs += [prompt, runs]
        self.t = end + after
        self.row += 1

    def line(self, runs, after=0.09):
        i = self._id()
        self.css.append(visible(i, self.t))
        self.body.append(f'<text class="{i}" x="{PAD_X}" y="{self.y()}">{tspans(runs)}</text>')
        self.runs.append(runs)
        self.t += after
        self.row += 1

    def shape(self, svg, start=None, end=None):
        i = self._id()
        self.css.append(visible(i, self.t if start is None else start, end))
        self.body.append(f'<g class="{i}">{svg}</g>')

    def blank(self):
        self.row += 1


def scene():
    s = Session()
    bullet_x = PAD_X + 4
    s.typed([("> ", MUTED)], [("Next train from Warszawa Centralna to Kraków Główny? Any delays?", TEXT)], after=0.6)
    s.blank()

    # Tool call: grey blinking bullet while it runs, green once it is done.
    running = 1.6
    cy = s.y() - 4.5
    s.shape(f'<circle class="run" cx="{bullet_x}" cy="{cy}" r="4" fill="{MUTED}"/>', end=s.t + running)
    s.shape(f'<circle cx="{bullet_x}" cy="{cy}" r="4" fill="{GREEN}"/>', start=s.t + running)
    s.line([("  pkp - search_connections", TEXT, "b"), (" (MCP)", MUTED),
            ('(from: "Warszawa Centralna", to: "Kraków Główny", live: true)', MUTED)], after=running)
    s.line([("  └ ", FAINT), ("Warszawa Centralna → Kraków Główny · Mon 2026-10-12 · 4 of 19 direct trains", MUTED)])
    s.line([("    17:50→20:08 2h18 · ", MUTED), ("+7", AMBER),
            (" · EIP 1505 (IC) · pl.4 → pl.3 · ref 26/150501/2026-10-12", MUTED)])
    s.line([('    18:15→21:02 2h47 · IC 3510 "Mehoffer" (IC) · pl.2 → pl.5 · ref 26/351002/2026-10-12', MUTED)])
    s.line([("    18:50→21:08 2h18 · EIP 1507 (IC) · pl.4 → pl.1 · ref 26/150703/2026-10-12", MUTED)])
    s.line([("    … +1 line", FAINT)], after=0.9)
    s.blank()

    s.shape(f'<circle cx="{bullet_x}" cy="{s.y() - 4.5}" r="4" fill="{TEXT}"/>')
    s.line([("  The next one is ", TEXT), ("EIP 1505 at 17:50", TEXT, "b"), (" from platform 4. It's running ", TEXT),
            ("7 min late", AMBER), (", so expect", TEXT)], after=0.25)
    s.line([("  it around 17:57 and in Kraków at about 20:15. EIP 1507 at 18:50 is just as fast (2h18).", TEXT)],
           after=0.8)
    s.blank()

    # Input box with a blinking cursor.
    y = s.y()
    s.shape(f'<rect x="{PAD_X - 8}" y="{y - 17}" width="{W - 2 * PAD_X + 16}" height="28" rx="6" fill="none" stroke="{FAINT}"/>'
            f'<text x="{PAD_X}" y="{y}" fill="{MUTED}">&gt; </text>'
            f'<rect class="cur" x="{PAD_X + 2 * CW:.1f}" y="{y - FS + 1}" width="{CW:.1f}" height="{FS + 3}" fill="{MUTED}"/>')
    s.row += 1
    assert s.t < LOOP * 0.8, "timeline does not fit the loop"
    return s


s = scene()
H = TOP + (s.row - 1) * LH + 26

TAG, TITLE = "PKP-MCP", "CLAUDE CODE"
tag_w = len(TAG) * 11 * 0.6 + 11 * 0.08 * len(TAG) + 14
bar = (
    f'<g class="bar">'
    f'<rect x="{PAD_X - 8}" y="12" width="{tag_w:.1f}" height="17" fill="{CLAUDE}"/>'
    f'<text x="{PAD_X - 1}" y="24.5" fill="{BG}">{TAG}</text>'
    f'<text x="{PAD_X - 8 + tag_w + 12:.1f}" y="24.5" fill="{FAINT}">{TITLE}</text>'
    f'<text x="{W - PAD_X - 64}" y="24.5" fill="{FAINT}">–   ·   ×</text>'
    f"</g>"
)

regular = "".join(t for runs in s.runs for t, *_ in runs) + TAG + TITLE + "–·×>"
bold = "".join(t for runs in s.runs for t, _, *b in runs if b)
css = [
    font_face(REGULAR, regular, 400),
    font_face(BOLD, bold, 700),
    f"text{{font-family:{STACK};font-size:{FS}px;white-space:pre}}",
    ".bar text{font-size:11px;letter-spacing:.08em}",
    "@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}",
    ".cur{animation:blink 1.1s step-end infinite}",
    ".run{animation:blink .5s step-end infinite}",
    *s.css,
    "@media (prefers-reduced-motion:reduce){[class^=e],[class^=c],.cur,.run{animation:none}.run{display:none}}",
]

label = (
    "Claude Code session. Question: next train from Warszawa Centralna to Kraków Główny, any delays? "
    "Claude calls pkp search_connections with live data and lists direct trains; "
    "EIP 1505 at 17:50 from platform 4 is running 7 minutes late."
)
svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
    f'role="img" aria-label="{escape(label)}">'
    f"<title>{escape(label)}</title>"
    f"<style>{''.join(css)}</style>"
    f"<defs>{''.join(s.defs)}</defs>"
    f'<rect x=".5" y=".5" width="{W - 1}" height="{H - 1}" fill="{BG}" stroke="#ffffff" stroke-opacity=".16"/>'
    f'<path d="M1 {BAR_H}.5H{W - 1}" stroke="#ffffff" stroke-opacity=".08"/>'
    f"{bar}{''.join(s.body)}</svg>\n"
)
open(OUT, "w").write(svg)
print(f"wrote {OUT}: {W}x{H}, {len(svg)} bytes, timeline ends at {s.t:.1f}s of {LOOP}s")
