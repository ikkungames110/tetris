// Zucks frame ID: _25490a8b2c.
// 配信寸法を確認できるまで、縦型用に300 × 600の表示領域を確保する。
// Keep the provider's tag unchanged: it uses document.write while parsing.
const adDocument = `<!doctype html>
<html lang="ja">
  <head><meta charset="UTF-8"><title>広告</title></head>
  <body style="margin:0;padding:0">
    <script type="text/javascript" src="https://j.zucks.net.zimg.jp/j?f=736747"></script>
  </body>
</html>`;

export function mountAds(): void {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const frame = document.createElement('iframe');
      frame.title = entry.target.getAttribute('aria-label') ?? '広告';
      frame.width = '300';
      frame.height = '600';
      // A separate document lets the original synchronous tag run without
      // blocking game startup or replacing the application's document.
      frame.srcdoc = adDocument;
      entry.target.append(frame);
      observer.unobserve(entry.target);
    }
  });

  document.querySelectorAll('.ad-slot').forEach((slot) => observer.observe(slot));
}
