const desktopAd = { frameId: '_25490a8b2c', tag: '736747', width: 360, height: 540 };
const mobileAd = { frameId: '_5d0b9ea247', tag: '736752', width: 320, height: 50 };
// 広告タグはdocument.writeを使うため、そのまま別の文書で実行する。
const adDocument = (ad: typeof desktopAd) => `<!doctype html>
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
        gap: ${ad.height <= 100 ? '4' : '14'}px;
        border: 1px dashed #354352;
        border-radius: 12px;
        background: #151e29;
        color: #82909f;
        font: 13px system-ui, sans-serif;
        pointer-events: none;
      }
      .ad-placeholder strong { color: #bac6d2; font-size: 18px; font-weight: 500; }
      .ad-placeholder small { font-size: 11px; letter-spacing: 2px; }
      ${ad.height <= 100 ? '.ad-placeholder small, .ad-placeholder span { display: none; } .ad-placeholder strong { font-size: 12px; }' : ''}
      /* 計測用画像では消さず、配信用iframeまたは画像リンクが挿入されたら消す。 */
      body:has(iframe, a > img) .ad-placeholder { display: none; }
    </style>
  </head>
  <body style="margin:0;padding:0">
    <div class="ad-placeholder"><small>ADVERTISEMENT</small><strong>広告配信待ち</strong><span>${ad.width} × ${ad.height}</span></div>
    <script type="text/javascript" src="https://j.zucks.net.zimg.jp/j?f=${ad.tag}"></script>
  </body>
</html>`;

export function mountAds(mobileLayout: MediaQueryList): void {
  const slots = [...document.querySelectorAll<HTMLElement>('.ad-slot')];
  const isActive = (slot: HTMLElement) => (slot.dataset.ad === 'mobile') === mobileLayout.matches;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const slot = entry.target as HTMLElement;
      if (!entry.isIntersecting || !isActive(slot) || slot.childElementCount) continue;
      const ad = slot.dataset.ad === 'mobile' ? mobileAd : desktopAd;
      const frame = document.createElement('iframe');
      frame.title = entry.target.getAttribute('aria-label') ?? '広告';
      frame.width = String(ad.width);
      frame.height = String(ad.height);
      frame.dataset.frameId = ad.frameId;
      // A separate document lets the original synchronous tag run without
      // blocking game startup or replacing the application's document.
      frame.srcdoc = adDocument(ad);
      entry.target.append(frame);
      observer.unobserve(entry.target);
    }
  });

  const update = () => {
    observer.disconnect();
    for (const slot of slots) {
      if (!isActive(slot)) slot.replaceChildren();
      else if (!slot.childElementCount) observer.observe(slot);
    }
  };
  mobileLayout.addEventListener('change', update);
  update();
}
