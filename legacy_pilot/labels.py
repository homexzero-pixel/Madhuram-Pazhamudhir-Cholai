"""Code 39 store labels, narrow-to-wide ratio 1:3."""
import html

PATTERNS={'0': 'bsbSBsBsb', '1': 'BsbSbsbsB', '2': 'bsBSbsbsB', '3': 'BsBSbsbsb', '4': 'bsbSBsbsB', '5': 'BsbSBsbsb', '6': 'bsBSBsbsb', '7': 'bsbSbsBsB', '8': 'BsbSbsBsb', '9': 'bsBSbsBsb', 'A': 'BsbsbSbsB', 'B': 'bsBsbSbsB', 'C': 'BsBsbSbsb', 'D': 'bsbsBSbsB', 'E': 'BsbsBSbsb', 'F': 'bsBsBSbsb', 'G': 'bsbsbSBsB', 'H': 'BsbsbSBsb', 'I': 'bsBsbSBsb', 'J': 'bsbsBSBsb', 'K': 'BsbsbsbSB', 'L': 'bsBsbsbSB', 'M': 'BsBsbsbSb', 'N': 'bsbsBsbSB', 'O': 'BsbsBsbSb', 'P': 'bsBsBsbSb', 'Q': 'bsbsbsBSB', 'R': 'BsbsbsBSb', 'S': 'bsBsbsBSb', 'T': 'bsbsBsBSb', 'U': 'BSbsbsbsB', 'V': 'bSBsbsbsB', 'W': 'BSBsbsbsb', 'X': 'bSbsBsbsB', 'Y': 'BSbsBsbsb', 'Z': 'bSBsBsbsb', '-': 'bSbsbsBsB', '.': 'BSbsbsBsb', ' ': 'bSBsbsBsb', '*': 'bSbsBsBsb', '$': 'bSbSbSbsb', '/': 'bSbSbsbSb', '+': 'bSbsbSbSb', '%': 'bsbSbSbSb'}
def label(code,name):
    if not code or '*' in code or any(c not in PATTERNS for c in code):
        raise ValueError('Store label needs an uppercase Code 39 compatible SKU.')
    bars=[];x=12
    for c in '*'+code+'*':
        for pattern in PATTERNS[c]:
            w=3 if pattern.isupper() else 1
            if pattern.lower()=='b':bars.append(f'<rect x="{x}" y="0" width="{w}" height="62"/>')
            x+=w
        x+=1
    width=x+12
    return f'<section><b>{html.escape(name)}</b><br><svg xmlns="http://www.w3.org/2000/svg" width="{width*.33:.2f}mm" height="20.46mm" viewBox="0 0 {width} 62">{"".join(bars)}</svg><br>{html.escape(code)}</section>'
def page(labels):
    return '<!doctype html><meta charset="utf-8"><title>Madhuram counter labels</title><style>body{font:16px system-ui;margin:22px}section{padding:12px 0;break-inside:avoid}b{display:block;margin-bottom:5px}@media print{button{display:none}}</style><button onclick="print()">Print at 100%</button>'+''.join(labels)
