// 桌宠服务端半边：主动搭话的「随机截屏」能力。浏览器拿不到桌面画面，只有服务端能抓屏；
// 抓屏走 PowerShell（System.Drawing CopyFromScreen，Windows 自带，无第三方依赖），
// 缩到长边 1280 内存 JPEG（质量 55）再回 base64，控制进对话的体积。
// 只暴露一个 POST /api/pet/screenshot；不落盘、不发网络，图片只随对话发给用户自己配的 AI 供应商。

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** 抓屏命令（PowerShell，UTF-16LE base64 编码后用 -EncodedCommand 执行，绕开引号转义地狱） */
const PS_SCRIPT = [
    "Add-Type -AssemblyName System.Drawing",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
    "$src = New-Object System.Drawing.Bitmap($b.Width, $b.Height)",
    "$g = [System.Drawing.Graphics]::FromImage($src)",
    "$g.CopyFromScreen(0, 0, 0, 0, $src.Size)",
    "$g.Dispose()",
    "$scale = [Math]::Min(1, 1280 / [Math]::Max($src.Width, $src.Height))",
    "$w = [Math]::Max(1, [int]($src.Width * $scale))",
    "$h = [Math]::Max(1, [int]($src.Height * $scale))",
    "$dst = New-Object System.Drawing.Bitmap($w, $h)",
    "$g2 = [System.Drawing.Graphics]::FromImage($dst)",
    "$g2.DrawImage($src, 0, 0, $w, $h)",
    "$g2.Dispose(); $src.Dispose()",
    "$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }",
    "$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)",
    "$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]55)",
    "$ms = New-Object System.IO.MemoryStream",
    "$dst.Save($ms, $codec, $ep)",
    "$dst.Dispose(); $ep.Dispose()",
    "[Convert]::ToBase64String($ms.ToArray())",
].join('; ');

export function register(ctx) {
    let inflight = null;   // 截屏是重操作（起 PowerShell 进程），并发请求合并成同一次

    async function captureScreen() {
        // -EncodedCommand 吃 UTF-16LE 的 base64，绕开 PowerShell 引号/编码坑
        const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
        const { stdout } = await run('powershell.exe',
            ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
            { timeout: 15000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
        const b64 = String(stdout || '').trim();
        if (!b64) throw new Error('截屏输出为空');
        return 'data:image/jpeg;base64,' + b64;
    }

    ctx.route('POST', '/api/pet/screenshot', async (req, res) => {
        try {
            if (!inflight) {
                inflight = captureScreen().finally(() => { inflight = null; });
            }
            const image = await inflight;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, image }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, message: String((err && err.message) || err) }));
        }
    });

    ctx.log('桌宠截屏接口就绪（POST /api/pet/screenshot）');
}
