// Zucks frame ID: _25490a8b2c.
// 広告タグはdocument.writeを使うため、そのまま別の文書で実行する。
const adDocument = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8"><title>広告</title>
    <style>
      .ad-placeholder {
        position: absolute;
        inset: 0;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 14px;
        border: 1px dashed #354352;
        border-radius: 12px;
        background: #151e29;
        color: #82909f;
        font: 13px system-ui, sans-serif;
        pointer-events: none;
      }
      .ad-placeholder strong { color: #bac6d2; font-size: 18px; font-weight: 500; }
      .ad-placeholder small { font-size: 11px; letter-spacing: 2px; }
      /* 計測用画像では消さず、配信用iframeまたは画像リンクが挿入されたら消す。 */
      body:has(iframe, a > img) .ad-placeholder { display: none; }
    </style>
  </head>
  <body style="margin:0;padding:0">
    <div class="ad-placeholder"><small>ADVERTISEMENT</small><strong>広告配信待ち</strong><span>360 × 540</span></div>
    <script type="text/javascript" src="https://j.zucks.net.zimg.jp/j?f=736747"></script>
  </body>
</html>`;

export function mountAds(): void {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const frame = document.createElement('iframe');
      frame.title = entry.target.getAttribute('aria-label') ?? '広告';
      frame.width = '360';
      frame.height = '540';
      // A separate document lets the original synchronous tag run without
      // blocking game startup or replacing the application's document.
      frame.srcdoc = adDocument;
      entry.target.append(frame);
      observer.unobserve(entry.target);
    }
  });

  document.querySelectorAll('.ad-slot').forEach((slot) => observer.observe(slot));
}
