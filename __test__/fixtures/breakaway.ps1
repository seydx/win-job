param([string]$Node, [string]$Script)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class Breakaway {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize;
    public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute; public int dwFlags;
    public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;
    public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFO si, out PROCESS_INFORMATION pi);

  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr handle);

  // CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW
  public static string Start(string cmd) {
    var si = new STARTUPINFO();
    si.cb = Marshal.SizeOf(si);
    PROCESS_INFORMATION pi;
    if (!CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x01000000 | 0x08000000, IntPtr.Zero, null, ref si, out pi)) {
      return "error " + Marshal.GetLastWin32Error();
    }
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    return "pid " + pi.dwProcessId;
  }
}
'@

[void][Console]::In.ReadLine()
[Console]::Out.WriteLine([Breakaway]::Start("`"$Node`" `"$Script`""))
