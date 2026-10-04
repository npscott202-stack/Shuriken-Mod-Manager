// Shuriken input helper: focuses a game window, sends real keyboard scancodes and mouse input
// (games using DirectInput ignore plain virtual-key messages), and captures the window.
// Used by playtest mode. MIT licensed, part of Shuriken.
//
// Usage: shuriken-input.exe <command> [args] ; <command> [args] ; ...
//   find <exe>                      prints: window <hwnd> <pid> <x> <y> <w> <h> <foreground 0/1>
//   focus <exe>                     brings the window to the front
//   tap <key> | down <key> | up <key> | hold <key> <ms>
//   text <characters...>            types text (rest of the command)
//   move <dx> <dy> [steps]          relative mouse movement (camera)
//   center <exe>                    puts the cursor in the middle of the window
//   click [left|right]
//   wait <ms>
//   shot <exe> <file.jpg> [maxWidth]
//   close <exe>
// Keys: a single character, a name (esc, enter, tab, space, tilde, lshift, lctrl, lalt, f1-f12,
// up, down, left, right, pgup, pgdn, home, end, del, backspace), or a hex scancode (0x29).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;

class ShurikenInput
{
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }

    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern short VkKeyScan(char c);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    const uint KEYEVENTF_EXTENDEDKEY = 0x1, KEYEVENTF_KEYUP = 0x2, KEYEVENTF_SCANCODE = 0x8;
    const uint MOUSEEVENTF_MOVE = 0x1, LEFTDOWN = 0x2, LEFTUP = 0x4, RIGHTDOWN = 0x8, RIGHTUP = 0x10;

    static readonly Dictionary<string, int> Named = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
    {
        {"esc",0x01},{"escape",0x01},{"backspace",0x0E},{"tab",0x0F},{"enter",0x1C},{"return",0x1C},{"lctrl",0x1D},{"ctrl",0x1D},
        {"lshift",0x2A},{"shift",0x2A},{"rshift",0x36},{"lalt",0x38},{"alt",0x38},{"space",0x39},{"capslock",0x3A},
        {"tilde",0x29},{"console",0x29},{"grave",0x29},
        {"f1",0x3B},{"f2",0x3C},{"f3",0x3D},{"f4",0x3E},{"f5",0x3F},{"f6",0x40},{"f7",0x41},{"f8",0x42},{"f9",0x43},{"f10",0x44},{"f11",0x57},{"f12",0x58},
        {"home",0xE047},{"up",0xE048},{"pgup",0xE049},{"left",0xE04B},{"right",0xE04D},{"end",0xE04F},{"down",0xE050},{"pgdn",0xE051},{"insert",0xE052},{"del",0xE053},{"delete",0xE053}
    };

    static int Main(string[] argv)
    {
        try { SetProcessDPIAware(); } catch { }
        string all = string.Join(" ", argv);
        try
        {
            foreach (string raw in SplitCommands(all))
            {
                string cmd = raw.Trim();
                if (cmd.Length == 0) continue;
                Run(cmd);
            }
            return 0;
        }
        catch (Exception e)
        {
            Console.WriteLine("error " + e.Message);
            return 2;
        }
    }

    // Commands are separated by ';' (a ';' inside text can be written as \;).
    static IEnumerable<string> SplitCommands(string s)
    {
        var cur = new System.Text.StringBuilder();
        for (int i = 0; i < s.Length; i++)
        {
            if (s[i] == '\\' && i + 1 < s.Length && s[i + 1] == ';') { cur.Append(';'); i++; continue; }
            if (s[i] == ';') { yield return cur.ToString(); cur.Clear(); continue; }
            cur.Append(s[i]);
        }
        yield return cur.ToString();
    }

    static List<string> Words(string s)
    {
        var list = new List<string>();
        var cur = new System.Text.StringBuilder();
        bool q = false;
        foreach (char c in s)
        {
            if (c == '"') { q = !q; continue; }
            if (c == ' ' && !q) { if (cur.Length > 0) { list.Add(cur.ToString()); cur.Clear(); } continue; }
            cur.Append(c);
        }
        if (cur.Length > 0) list.Add(cur.ToString());
        return list;
    }

    static void Run(string cmd)
    {
        int sp = cmd.IndexOf(' ');
        string verb = (sp < 0 ? cmd : cmd.Substring(0, sp)).ToLowerInvariant();
        string rest = sp < 0 ? "" : cmd.Substring(sp + 1);
        var w = Words(rest);
        switch (verb)
        {
            case "find": { IntPtr h; int pid; h = Window(w[0], out pid); Report(h, pid); break; }
            case "focus": Focus(w[0]); break;
            case "tap": Key(w[0], true); Thread.Sleep(40); Key(w[0], false); Thread.Sleep(40); break;
            case "down": Key(w[0], true); break;
            case "up": Key(w[0], false); break;
            case "hold": Key(w[0], true); Thread.Sleep(int.Parse(w[1])); Key(w[0], false); break;
            case "text": TypeText(rest); break;
            case "move": Move(int.Parse(w[0]), int.Parse(w[1]), w.Count > 2 ? int.Parse(w[2]) : 10); break;
            case "center": Center(w[0]); break;
            case "click": Click(w.Count > 0 && w[0] == "right"); break;
            case "wait": Thread.Sleep(int.Parse(w[0])); break;
            case "shot": Shot(w[0], w[1], w.Count > 2 ? int.Parse(w[2]) : 1280); break;
            case "close": { int pid; IntPtr h = Window(w[0], out pid); if (h != IntPtr.Zero) PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); Console.WriteLine("closed"); break; }
            default: throw new Exception("unknown command " + verb);
        }
    }

    static IntPtr Window(string exe, out int pid)
    {
        string name = exe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? exe.Substring(0, exe.Length - 4) : exe;
        foreach (var p in Process.GetProcessesByName(name))
        {
            if (p.MainWindowHandle != IntPtr.Zero) { pid = p.Id; return p.MainWindowHandle; }
        }
        pid = 0;
        return IntPtr.Zero;
    }

    static RECT ScreenRect(IntPtr h)
    {
        RECT r;
        GetClientRect(h, out r);
        POINT p = new POINT();
        ClientToScreen(h, ref p);
        return new RECT { Left = p.X, Top = p.Y, Right = p.X + r.Right, Bottom = p.Y + r.Bottom };
    }

    static void Report(IntPtr h, int pid)
    {
        if (h == IntPtr.Zero) { Console.WriteLine("nowindow"); return; }
        RECT r = ScreenRect(h);
        Console.WriteLine("window " + h.ToInt64() + " " + pid + " " + r.Left + " " + r.Top + " " + (r.Right - r.Left) + " " + (r.Bottom - r.Top) + " " + (GetForegroundWindow() == h ? 1 : 0));
    }

    static void Focus(string exe)
    {
        int pid;
        IntPtr h = Window(exe, out pid);
        if (h == IntPtr.Zero) throw new Exception("game window not found");
        if (IsIconic(h)) ShowWindow(h, 9);
        for (int i = 0; i < 5 && GetForegroundWindow() != h; i++)
        {
            // Windows only lets the process that last had input change the foreground; a tap of
            // Alt counts as input, so the call succeeds.
            SendKey(0x38, false, false); SendKey(0x38, false, true);
            SetForegroundWindow(h);
            Thread.Sleep(150);
        }
        Console.WriteLine(GetForegroundWindow() == h ? "focused" : "focus-failed");
    }

    static int ScanOf(string key, out bool shift)
    {
        shift = false;
        int code;
        if (Named.TryGetValue(key, out code)) return code;
        if (key.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) return Convert.ToInt32(key.Substring(2), 16);
        if (key.Length == 1)
        {
            short vk = VkKeyScan(key[0]);
            if (vk == -1) throw new Exception("cannot type " + key);
            shift = (vk & 0x100) != 0;
            return (int)MapVirtualKey((uint)(vk & 0xFF), 0);
        }
        throw new Exception("unknown key " + key);
    }

    static void Key(string key, bool down)
    {
        bool shift;
        int sc = ScanOf(key, out shift);
        SendKey(sc & 0xFF, (sc & 0xE000) == 0xE000, !down);
    }

    static void SendKey(int scan, bool extended, bool up)
    {
        var inp = new INPUT { type = 1 };
        inp.u.ki = new KEYBDINPUT { wScan = (ushort)scan, dwFlags = KEYEVENTF_SCANCODE | (extended ? KEYEVENTF_EXTENDEDKEY : 0) | (up ? KEYEVENTF_KEYUP : 0) };
        SendInput(1, new[] { inp }, Marshal.SizeOf(typeof(INPUT)));
    }

    static void TypeText(string text)
    {
        foreach (char c in text)
        {
            bool shift;
            int sc = ScanOf(c.ToString(), out shift);
            if (shift) SendKey(0x2A, false, false);
            SendKey(sc, false, false);
            Thread.Sleep(12);
            SendKey(sc, false, true);
            if (shift) SendKey(0x2A, false, true);
            Thread.Sleep(12);
        }
    }

    static void Move(int dx, int dy, int steps)
    {
        steps = Math.Max(1, steps);
        int sx = 0, sy = 0;
        for (int i = 1; i <= steps; i++)
        {
            int tx = dx * i / steps, ty = dy * i / steps;
            var inp = new INPUT { type = 0 };
            inp.u.mi = new MOUSEINPUT { dx = tx - sx, dy = ty - sy, dwFlags = MOUSEEVENTF_MOVE };
            SendInput(1, new[] { inp }, Marshal.SizeOf(typeof(INPUT)));
            sx = tx; sy = ty;
            Thread.Sleep(8);
        }
    }

    static void Center(string exe)
    {
        int pid;
        IntPtr h = Window(exe, out pid);
        if (h == IntPtr.Zero) throw new Exception("game window not found");
        RECT r = ScreenRect(h);
        SetCursorPos((r.Left + r.Right) / 2, (r.Top + r.Bottom) / 2);
    }

    static void Click(bool right)
    {
        var a = new INPUT { type = 0 };
        a.u.mi = new MOUSEINPUT { dwFlags = right ? RIGHTDOWN : LEFTDOWN };
        var b = new INPUT { type = 0 };
        b.u.mi = new MOUSEINPUT { dwFlags = right ? RIGHTUP : LEFTUP };
        SendInput(1, new[] { a }, Marshal.SizeOf(typeof(INPUT)));
        Thread.Sleep(60);
        SendInput(1, new[] { b }, Marshal.SizeOf(typeof(INPUT)));
    }

    static void Shot(string exe, string file, int maxWidth)
    {
        int pid;
        IntPtr h = Window(exe, out pid);
        if (h == IntPtr.Zero) throw new Exception("game window not found");
        RECT r = ScreenRect(h);
        int w = r.Right - r.Left, ht = r.Bottom - r.Top;
        if (w <= 0 || ht <= 0) throw new Exception("game window is minimized");
        using (var bmp = new Bitmap(w, ht))
        {
            using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(r.Left, r.Top, 0, 0, new Size(w, ht));
            Bitmap outBmp = bmp;
            if (w > maxWidth)
            {
                outBmp = new Bitmap(maxWidth, ht * maxWidth / w);
                using (var g2 = Graphics.FromImage(outBmp)) { g2.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear; g2.DrawImage(bmp, 0, 0, outBmp.Width, outBmp.Height); }
            }
            var enc = ImageCodecInfo.GetImageEncoders().First(c => c.MimeType == "image/jpeg");
            var ps = new EncoderParameters(1);
            ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 82L);
            outBmp.Save(file, enc, ps);
            Console.WriteLine("shot " + outBmp.Width + "x" + outBmp.Height + " foreground=" + (GetForegroundWindow() == h ? 1 : 0));
            if (outBmp != bmp) outBmp.Dispose();
        }
    }
}
