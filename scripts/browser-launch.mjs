// Общий запуск Chromium для проверок. Пакет playwright ждёт браузер своей
// сборки, а рядом может стоять другой: обычный запуск тогда падает на
// «Executable doesn't exist», хотя usable-браузер есть. CHROMIUM_PATH
// позволяет указать уже стоящий; playwright-core даёт тот же API без
// загрузчика браузеров — в окружениях, где полного пакета нет.
export async function launchBrowser() {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch {
    try { ({ chromium } = await import('playwright-core')); }
    catch { throw Error('Нужен playwright: npm i -D playwright && npx playwright install chromium'); }
  }
  return chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}
