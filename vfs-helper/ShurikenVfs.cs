// shuriken-vfs: launches a program inside a usvfs virtual file system (the same library
// Mod Organizer 2 uses), so the game and tools see mods that never touch the game folder.
//
// Copyright (C) 2026 Shuriken contributors. Licensed under the GNU GPL v3 or later
// (it loads usvfs, which is GPL-3.0). See LICENSE in this folder.
//
// Usage: shuriken-vfs.exe <config.txt>
// Config lines:
//   usvfs=<folder containing usvfs_x64.dll>
//   instance=<name>
//   log=<log file>
//   dir|<source>|<destination>|<flags>     (flags: usvfs LINKFLAG_* sum)
//   file|<source>|<destination>|<flags>
//   blacklist=<exe name>                     (never hook this executable)
//   exe=<program>   args=<arguments>   cwd=<working folder>
// Prints "EVENT ..." lines on stdout.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class ShurikenVfs
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
        public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars;
        public int dwYCountChars; public int dwFillAttribute; public int dwFlags; public short wShowWindow;
        public short cbReserved2; public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }

    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibrary(string path);
    [DllImport("kernel32", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
    [DllImport("kernel32", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
    [DllImport("kernel32", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);

    [DllImport("usvfs_x64.dll", CallingConvention = CallingConvention.Cdecl)] static extern IntPtr usvfsCreateParameters();
    [DllImport("usvfs_x64.dll", CallingConvention = CallingConvention.Cdecl)] static extern void usvfsFreeParameters(IntPtr p);
    [DllImport("usvfs_x64.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)] static extern void usvfsSetInstanceName(IntPtr p, string name);
    [DllImport("usvfs_x64.dll", CallingConvention = CallingConvention.Cdecl)] static extern void usvfsSetDebugMode(IntPtr p, bool debug);
    [DllImport("usvfs_x64.dll", CallingConvention = CallingConvention.Cdecl)] static extern void usvfsSetLogLevel(IntPtr p, byte level);
    [DllImport("usvfs_x64.dll", CallingConvention = CallingConvention.Cdecl)] static extern void usvfsSetCrashDumpType(IntPtr p, byte type);
    [DllImport("usvfs_x64.dll", CallingConvention = CallingConvention.Cdecl)] static extern void usvfsSetProcessDelay(IntPtr p, int ms);
    [DllImport("usvfs_x64.dll")] static extern bool usvfsCreateVFS(IntPtr p);
    [DllImport("usvfs_x64.dll")] static extern void usvfsDisconnectVFS();
    [DllImport("usvfs_x64.dll", CharSet = CharSet.Unicode)] static extern bool usvfsVirtualLinkDirectoryStatic(string source, string destination, uint flags);
    [DllImport("usvfs_x64.dll", CharSet = CharSet.Unicode)] static extern bool usvfsVirtualLinkFile(string source, string destination, uint flags);
    [DllImport("usvfs_x64.dll", CharSet = CharSet.Unicode)] static extern void usvfsBlacklistExecutable(string exe);
    [DllImport("usvfs_x64.dll")] static extern bool usvfsGetVFSProcessList(ref UIntPtr count, [Out] uint[] pids);
    [DllImport("usvfs_x64.dll", CharSet = CharSet.Ansi)] static extern bool usvfsGetLogMessages(StringBuilder buffer, UIntPtr size, bool blocking);
    [DllImport("usvfs_x64.dll", CharSet = CharSet.Unicode)]
    static extern bool usvfsCreateProcessHooked(string app, StringBuilder cmdLine, IntPtr procAttr, IntPtr threadAttr, bool inherit,
        uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);

    static StreamWriter log;

    static void Event(string text)
    {
        Console.WriteLine("EVENT " + text);
        Console.Out.Flush();
        if (log != null) { log.WriteLine(DateTime.Now.ToString("HH:mm:ss") + " " + text); log.Flush(); }
    }

    static void DrainUsvfsLog()
    {
        if (log == null) return;
        var sb = new StringBuilder(4096);
        while (usvfsGetLogMessages(sb, (UIntPtr)sb.Capacity, false)) { log.WriteLine("usvfs: " + sb.ToString()); sb.Length = 0; }
        log.Flush();
    }

    static int Main(string[] args)
    {
        if (args.Length < 1) { Console.Error.WriteLine("usage: shuriken-vfs <config.txt>"); return 2; }
        var cfg = new Dictionary<string, string>();
        var links = new List<string[]>();
        var blacklist = new List<string>();
        foreach (var raw in File.ReadAllLines(args[0], Encoding.UTF8))
        {
            var line = raw.TrimEnd('\r');
            if (line.Length == 0 || line.StartsWith("#")) continue;
            if (line.StartsWith("dir|") || line.StartsWith("file|")) { links.Add(line.Split('|')); continue; }
            int eq = line.IndexOf('=');
            if (eq <= 0) continue;
            var key = line.Substring(0, eq);
            var value = line.Substring(eq + 1);
            if (key == "blacklist") blacklist.Add(value); else cfg[key] = value;
        }

        string logPath;
        if (cfg.TryGetValue("log", out logPath)) log = new StreamWriter(logPath, false, Encoding.UTF8);
        string usvfsDir;
        if (!cfg.TryGetValue("usvfs", out usvfsDir) || LoadLibrary(Path.Combine(usvfsDir, "usvfs_x64.dll")) == IntPtr.Zero)
        {
            Event("error usvfs_x64.dll could not be loaded");
            return 3;
        }

        IntPtr p = usvfsCreateParameters();
        string instance;
        usvfsSetInstanceName(p, cfg.TryGetValue("instance", out instance) ? instance : "shuriken");
        usvfsSetDebugMode(p, false);
        usvfsSetLogLevel(p, 2); // Warning
        usvfsSetCrashDumpType(p, 0);
        usvfsSetProcessDelay(p, 0);
        if (!usvfsCreateVFS(p)) { Event("error the virtual file system could not be created"); return 4; }
        usvfsFreeParameters(p);

        int ok = 0, failed = 0;
        foreach (var l in links)
        {
            uint flags = l.Length > 3 ? uint.Parse(l[3]) : 8u;
            bool r = l[0] == "dir" ? usvfsVirtualLinkDirectoryStatic(l[1], l[2], flags) : usvfsVirtualLinkFile(l[1], l[2], flags);
            if (r) ok++; else { failed++; Event("warn link failed " + l[1] + " -> " + l[2]); }
        }
        foreach (var b in blacklist) usvfsBlacklistExecutable(b);
        Event("mapped " + ok + " links (" + failed + " failed)");

        string exe = cfg["exe"];
        string cmdArgs;
        cfg.TryGetValue("args", out cmdArgs);
        string cwd;
        if (!cfg.TryGetValue("cwd", out cwd)) cwd = Path.GetDirectoryName(exe);
        var cmd = new StringBuilder("\"" + exe + "\"" + (string.IsNullOrEmpty(cmdArgs) ? "" : " " + cmdArgs), 32768);
        var si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        PROCESS_INFORMATION pi;
        if (!usvfsCreateProcessHooked(null, cmd, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, cwd, ref si, out pi))
        {
            Event("error could not start " + exe + " (Windows error " + Marshal.GetLastWin32Error() + ")");
            DrainUsvfsLog();
            usvfsDisconnectVFS();
            return 5;
        }
        Event("started pid=" + pi.dwProcessId);

        // Wait for the program, then for anything it launched inside the VFS (e.g. F4SE -> Fallout4.exe).
        WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
        uint exitCode;
        GetExitCodeProcess(pi.hProcess, out exitCode);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        Event("main exited code=" + exitCode);
        var pids = new uint[512];
        while (true)
        {
            UIntPtr count = (UIntPtr)pids.Length;
            if (!usvfsGetVFSProcessList(ref count, pids)) break;
            int running = 0;
            for (int i = 0; i < (int)count; i++) if (pids[i] != (uint)System.Diagnostics.Process.GetCurrentProcess().Id) running++;
            if (running == 0) break;
            DrainUsvfsLog();
            Thread.Sleep(1500);
        }
        DrainUsvfsLog();
        usvfsDisconnectVFS();
        Event("done");
        if (log != null) log.Close();
        return 0;
    }
}
