# 在指定屏幕坐标点一下鼠标（物理像素），用于自动化验证界面
import ctypes, sys, time
from ctypes import wintypes

u = ctypes.windll.user32
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass

x, y = int(sys.argv[1]), int(sys.argv[2])

KEY = "番茄四级"
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
        hits.append(hwnd)
    return True

u.EnumWindows(cb, 0)
if hits:
    try:
        # 先提到最前，否则点击会落到遮挡它的窗口上
        u.SetWindowPos(hits[-1], -1, 0, 0, 0, 0, 0x0001 | 0x0002)
        u.SetForegroundWindow(hits[-1])
    except Exception:
        pass
    time.sleep(0.5)

u.SetCursorPos(x, y)
time.sleep(0.1)
u.mouse_event(0x0002, 0, 0, 0, 0)
time.sleep(0.05)
u.mouse_event(0x0004, 0, 0, 0, 0)
print("CLICK", x, y)
