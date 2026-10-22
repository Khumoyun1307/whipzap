// Screen capture helper for manual end-to-end checks. Runs as a separate Electron app:
//   electron test/helpers/screenshot.cjs <outDir> <triggerFile>
// It waits for <triggerFile> to appear, captures the primary display ~350 ms later via
// desktopCapturer (which, unlike GDI screenshots, includes DirectComposition windows such as the
// WhipZap overlay), writes <outDir>/<trigger contents>.png, deletes the trigger, and repeats.
// Create a file named "<triggerFile>.quit" to stop it.
const { app, desktopCapturer, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const [outDir, triggerFile] = process.argv.slice(2);
if (!outDir || !triggerFile) {
  console.error('usage: electron screenshot.cjs <outDir> <triggerFile>');
  app.exit(2);
}

async function capture(name) {
  const { width, height } = screen.getPrimaryDisplay().size;
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
  const png = sources[0]?.thumbnail?.resize({ width: Math.round(width / 2) }).toPNG();
  if (png) fs.writeFileSync(path.join(outDir, `${name}.png`), png);
  console.log(`captured ${name} (${png?.length ?? 0} bytes)`);
}

app.whenReady().then(() => {
  fs.mkdirSync(outDir, { recursive: true });
  console.log('screenshot helper ready');
  const timer = setInterval(async () => {
    if (fs.existsSync(`${triggerFile}.quit`)) {
      clearInterval(timer);
      try {
        fs.unlinkSync(`${triggerFile}.quit`);
      } catch {}
      app.exit(0);
      return;
    }
    if (!fs.existsSync(triggerFile)) return;
    const name = fs.readFileSync(triggerFile, 'utf8').trim() || `shot-${Date.now()}`;
    try {
      fs.unlinkSync(triggerFile);
    } catch {}
    await new Promise((r) => setTimeout(r, 350));
    await capture(name);
  }, 50);
});
