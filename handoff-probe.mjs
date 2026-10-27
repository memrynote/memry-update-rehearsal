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
const setup = path.join(root, 'Setup.cmd')
fs.writeFileSync(setup, '@echo off\r\nmkdir "%LocalAppData%\\MemryNote\\current" 2>nul\r\ncopy /y "%SystemRoot%\\System32\\whoami.exe" "%LocalAppData%\\MemryNote\\current\\Memrynote.exe" >nul\r\n')

const app = spawn(path.join(install, 'Memrynote.exe'), ['-n', '12', '127.0.0.1'], { stdio: 'ignore', windowsHide: true })
console.log('app pid', app.pid)

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
const scriptPath = path.join(root, 'handoff.cmd')
fs.writeFileSync(scriptPath, renderInstallerHandoffScript(plan))
const child = spawn('cmd.exe', ['/c', scriptPath], { detached: true, stdio: 'ignore', windowsHide: true })
child.unref()
const started = Date.now()
const done = () => fs.existsSync(plan.handoffLogPath) && fs.readFileSync(plan.handoffLogPath, 'utf8').includes('handoff done')
while (Date.now() - started < 90_000 && !done()) await new Promise((r) => setTimeout(r, 1000))
console.log(done() ? `OK after ${Date.now() - started} ms` : 'HUNG')
console.log(fs.existsSync(plan.handoffLogPath) ? fs.readFileSync(plan.handoffLogPath, 'utf8') : '(no log)')
process.exit(done() ? 0 : 1)
