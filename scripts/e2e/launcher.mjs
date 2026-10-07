// The app runs yt-dlp as an executable. On Linux and macOS the fake (a Python script with a
// shebang) is executable as is; Windows needs a real .exe, so build a tiny launcher that runs
// `python <dir>/fake-ytdlp <args>` with the C# compiler that ships with Windows.

import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = `
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

class Launcher {
  static string Quote(string a) {
    if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\\t', '"' }) < 0) return a;
    var sb = new StringBuilder("\\"");
    int slashes = 0;
    foreach (char c in a) {
      if (c == '\\\\') { slashes++; continue; }
      if (c == '"') { sb.Append('\\\\', slashes * 2 + 1); sb.Append('"'); slashes = 0; continue; }
      sb.Append('\\\\', slashes); slashes = 0; sb.Append(c);
    }
    sb.Append('\\\\', slashes * 2);
    sb.Append('"');
    return sb.ToString();
  }

  static int Main(string[] args) {
    string script = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "fake-ytdlp");
    var line = new StringBuilder(Quote(script));
    foreach (var a in args) { line.Append(' '); line.Append(Quote(a)); }
    var psi = new ProcessStartInfo(Environment.GetEnvironmentVariable("FAKE_PYTHON") ?? "python", line.ToString());
    psi.UseShellExecute = false;
    var p = Process.Start(psi);
    p.WaitForExit();
    return p.ExitCode;
  }
}
`

/** Path to run the fake yt-dlp with: the script itself, or (Windows) a launcher .exe next to it. */
export function fakeYtdlpCommand(scriptPath, workDir) {
  if (process.platform !== 'win32') return scriptPath
  const csc = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  if (!existsSync(csc)) throw new Error('csc.exe not found; it is needed to build the fake yt-dlp launcher on Windows')
  const source = join(workDir, 'launcher.cs')
  const exe = join(workDir, 'fake-ytdlp.exe')
  writeFileSync(source, SOURCE)
  execFileSync(csc, ['/nologo', '/out:' + exe, source], { stdio: 'pipe' })
  return exe
}
