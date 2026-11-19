"""Barcode drawing for store labels (Code 128-B) and practice / scale labels (EAN-13), as inline SVG."""
from .scale import ean13_check_digit

_C128 = [
    "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212",
    "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
    "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321", "232121", "111323", "131123", "131321",
    "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
    "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
    "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
    "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", "111242", "121142", "121241", "114212",
    "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
    "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
]


def code128_widths(text):
    if any(ord(c) < 32 or ord(c) > 126 for c in text):
        raise ValueError("Code 128-B supports printable ASCII only.")
    codes = [104] + [ord(c) - 32 for c in text]
    check = (codes[0] + sum(i * c for i, c in enumerate(codes[1:], 1))) % 103
    pattern = "".join(_C128[c] for c in codes + [check]) + _C128[106]
    return [int(w) for w in pattern]


_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"]
_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"]
_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"]
_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]


def ean13_bits(code):
    if len(code) == 12:
        code += str(ean13_check_digit(code))
    if len(code) != 13 or not code.isdigit() or ean13_check_digit(code[:12]) != int(code[12]):
        raise ValueError("Not a valid EAN-13.")
    first, left, right = int(code[0]), code[1:7], code[7:]
    bits = "101"
    for d, p in zip(left, _PARITY[first]):
        bits += (_L if p == "L" else _G)[int(d)]
    bits += "01010"
    for d in right:
        bits += _R[int(d)]
    return bits + "101", code


def svg_code128(text, height=50):
    widths = code128_widths(text)
    x, rects, bar = 10, [], True
    for w in widths:
        if bar:
            rects.append(f'<rect x="{x}" y="0" width="{w}" height="{height}"/>')
        x += w
        bar = not bar
    total = x + 10
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total} {height + 14}" preserveAspectRatio="none" role="img" aria-label="{text}">'
            f'<rect width="100%" height="100%" fill="#fff"/>{"".join(rects)}'
            f'<text x="{total / 2}" y="{height + 12}" font-size="11" text-anchor="middle" font-family="monospace">{text}</text></svg>')


def svg_ean13(code, height=50):
    bits, code = ean13_bits(code)
    rects = [f'<rect x="{10 + i}" y="0" width="1" height="{height}"/>' for i, b in enumerate(bits) if b == "1"]
    total = len(bits) + 20
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total} {height + 14}" preserveAspectRatio="none" role="img" aria-label="{code}">'
            f'<rect width="100%" height="100%" fill="#fff"/>{"".join(rects)}'
            f'<text x="{total / 2}" y="{height + 12}" font-size="10" text-anchor="middle" font-family="monospace">{code}</text></svg>')


def svg_any(code):
    if code.isdigit() and len(code) == 13:
        try:
            return svg_ean13(code)
        except ValueError:
            pass
    return svg_code128(code)
