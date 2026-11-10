# 截取指定标题的窗口，存成 24 位 BMP（不依赖任何第三方库）
import ctypes, sys, time, struct
from ctypes import wintypes

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass

u = ctypes.windll.user32
g = ctypes.windll.gdi32

# 窗口标题关键字：改名成 FocusCET 之后标题跟着变，所以做成可传参
OUT = sys.argv[1] if len(sys.argv) > 1 else "shot.bmp"
KEY = sys.argv[2] if len(sys.argv) > 2 else "FocusCET"

hits = []

@ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
def cb(hwnd, lp):
    if not u.IsWindowVisible(hwnd):
        return True
    n = u.GetWindowTextLengthW(hwnd)
    if n == 0:
        return True
    buf = ctypes.create_unicode_buffer(n + 1)
    u.GetWindowTextW(hwnd, buf, n + 1)
    if KEY in buf.value:
        hits.append((hwnd, buf.value))
    return True

u.EnumWindows(cb, 0)

if not hits:
    print("NOT-FOUND")
    sys.exit(2)

hwnd, title = hits[-1]
u.ShowWindow(hwnd, 9)              # SW_RESTORE
try:
    u.SetForegroundWindow(hwnd)
except Exception:
    pass
time.sleep(0.6)

r = wintypes.RECT()
u.GetWindowRect(hwnd, ctypes.byref(r))
x, y, w, h = r.left, r.top, r.right - r.left, r.bottom - r.top
print("TITLE", title, "RECT", x, y, w, h)

hdc = u.GetDC(0)
mem = g.CreateCompatibleDC(hdc)
bmp = g.CreateCompatibleBitmap(hdc, w, h)
g.SelectObject(mem, bmp)
g.BitBlt(mem, 0, 0, w, h, hdc, x, y, 0x00CC0020)

class BIH(ctypes.Structure):
    _fields_ = [("biSize", wintypes.DWORD), ("biWidth", ctypes.c_long), ("biHeight", ctypes.c_long),
                ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", ctypes.c_long),
                ("biYPelsPerMeter", ctypes.c_long), ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD)]

bi = BIH()
bi.biSize = ctypes.sizeof(BIH)
bi.biWidth = w
bi.biHeight = -h
bi.biPlanes = 1
bi.biBitCount = 32
bi.biCompression = 0
bi.biSizeImage = w * h * 4

raw = ctypes.create_string_buffer(w * h * 4)
g.GetDIBits(mem, bmp, 0, h, raw, ctypes.byref(bi), 0)
data = raw.raw

# 32 位 BGRA -> 24 位 BGR，行按 4 字节对齐，bottom-up
row = w * 3
pad = (4 - (row % 4)) % 4
out_rows = []
for yy in range(h - 1, -1, -1):
    base = yy * w * 4
    line = bytearray()
    for xx in range(w):
        i = base + xx * 4
        line += data[i:i + 3]
    out_rows.append(bytes(line) + b"\x00" * pad)

pixels = b"".join(out_rows)
size = len(pixels)

header = struct.pack("<2sIHHI", b"BM", 14 + 40 + size, 0, 0, 14 + 40)
info = struct.pack("<IiiHHIIiiII", 40, w, h, 1, 24, 0, size, 2835, 2835, 0, 0)

with open(OUT, "wb") as f:
    f.write(header + info + pixels)

print("SAVED", OUT, w, h)
