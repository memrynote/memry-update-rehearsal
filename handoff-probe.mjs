import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.join(process.env.RUNNER_TEMP, 'probe')
fs.rmSync(root, { recursive: true, force: true })
const install = path.join(root, 'Programs', 'Memrynote')
fs.mkdirSync(install, { recursive: true })
fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
const sys = path.join(process.env.SystemRoot, 'System32')
fs.copyFileSync(path.join(sys, 'ping.exe'), path.join(install, 'Memrynote.exe'))
fs.copyFileSync(path.join(sys, 'whoami.exe'), path.join(install, 'Uninstall MemryNote.exe'))
const setup = path.join(root, 'Setup.exe')
fs.copyFileSync(path.join(sys, 'whoami.exe'), setup)
const velo = path.join(process.env.LocalAppData, 'MemryNote', 'current', 'Memrynote.exe')
fs.mkdirSync(path.dirname(velo), { recursive: true })
fs.copyFileSync(path.join(sys, 'whoami.exe'), velo)

const app = spawn(path.join(install, 'Memrynote.exe'), ['-n', '12', '127.0.0.1'], { stdio: 'ignore', windowsHide: true })
console.log('variant', process.env.VARIANT ?? 'baseline', 'app pid', app.pid)

const { renderInstallerHandoffScript } = await import(
  pathToFileURL('memry/apps/desktop/src/main/installer-handoff-script.ts').href
)
const plan = {
  appPid: app.pid,
  appExeName: 'Memrynote.exe',
  installDir: install,
  uninstallerPath: path.join(install, 'Uninstall MemryNote.exe'),
  workDir: path.join(root, 'work'),
  setupExePath: setup,
  setupLogPath: path.join(root, 'logs', 'setup.log'),
  handoffLogPath: path.join(root, 'handoff.log'),
  nsisInstallerPath: null
}
const variant = process.env.VARIANT ?? 'baseline'
let script = renderInstallerHandoffScript(plan)
const tl = 'tasklist /FI "PID eq %APP_PID%" /FI "IMAGENAME eq %APP_EXE%" /NH 2>nul | find /I "%APP_EXE%" >nul'
if (!script.includes(tl)) throw new Error('tasklist line not found')
if (variant === 'file') {
  script = script.replace(tl, 'tasklist /FI "PID eq %APP_PID%" /FI "IMAGENAME eq %APP_EXE%" /NH >"%HANDOFF_LOG%.tl" 2>nul\r\nfind /I "%APP_EXE%" "%HANDOFF_LOG%.tl" >nul')
}
if (variant === 'powershell') {
  script = script.replace(tl, 'powershell -NoProfile -NonInteractive -Command "Wait-Process -Id %APP_PID% -Timeout 120 -ErrorAction SilentlyContinue" >nul 2>&1\r\nset "WAITED=1"').replace(/if not errorlevel 1 \(\r\n  ping -n 2 127.0.0.1 >nul\r\n  goto wait_for_exit\r\n\)/, 'rem ps waited')
}
const scriptPath = path.join(root, 'handoff.cmd')
fs.writeFileSync(scriptPath, script)
const detached = variant !== 'nondetached'
const child = spawn('cmd.exe', ['/c', scriptPath], { detached, stdio: 'ignore', windowsHide: true })
child.unref()
if (process.env.EXIT_NOW) { console.log('parent exits now'); process.exit(0) }
const started = Date.now()
const done = () => fs.existsSync(plan.handoffLogPath) && fs.readFileSync(plan.handoffLogPath, 'utf8').includes('handoff done')
while (Date.now() - started < 90_000 && !done()) await new Promise((r) => setTimeout(r, 1000))
if (!done()) { const { execFileSync } = await import('node:child_process'); console.log(execFileSync('powershell.exe', ['-NoProfile','-Command', 'Get-CimInstance Win32_Process | ? { $_.Name -match "cmd|find|tasklist|Memrynote|ping" } | % { "$($_.ProcessId) ppid=$($_.ParentProcessId) $($_.Name) $($_.CommandLine)" }']).toString()) }
console.log(done() ? `OK after ${Date.now() - started} ms` : 'HUNG')
console.log(fs.existsSync(plan.handoffLogPath) ? fs.readFileSync(plan.handoffLogPath, 'utf8') : '(no log)')
process.exit(done() ? 0 : 1)
