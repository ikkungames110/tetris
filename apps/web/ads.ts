// 広告枠を有効にする。
export const ADS_ENABLED = true;

const desktopAd = {
  scriptSrc: 'https://j.zucks.net.zimg.jp/j?f=736747',
  width: 160,
  height: 600,
};
const mobileAd = {
  elementId: 'im-79fdebb4d3e248a6a9efc2b27ba13d85',
  mid: 596133,
  asid: 1943447,
  width: 320,
  height: 50,
};

// このオブジェクトの値は、広告管理画面から発行されたタグをそのまま転記している。
const bottomBannerAd = {
  elementId: 'im-9905c2e5068d48b9a7071994203e52b6',
  mid: 596128,
  asid: 1945489,
  width: 728,
  height: 90,
};
// 広告スクリプトは枠ごとに独立したiframe内で実行する。
const adDocument = (ad: typeof bottomBannerAd | typeof desktopAd) => `<!doctype html>
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
    ${
      'scriptSrc' in ad
        ? `<script type="text/javascript" src="${ad.scriptSrc}"></script>`
        : `<div id="${ad.elementId}">
      <script async src="https://imp-adedge.i-mobile.co.jp/script/v1/spot.js?20220104"></script>
      <script>(window.adsbyimobile=window.adsbyimobile||[]).push({pid:85394,mid:${ad.mid},asid:${ad.asid},type:"banner",display:"inline",elementid:"${ad.elementId}"})</script>
    </div>`
    }
  </body>
</html>`;

export function mountAds(mobileLayout: MediaQueryList): void {
  if (!ADS_ENABLED) return;
  const slots = [...document.querySelectorAll<HTMLElement>('.ad-slot')];
  const isActive = (slot: HTMLElement) => (slot.dataset.ad === 'mobile') === mobileLayout.matches;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const slot = entry.target as HTMLElement;
      if (!entry.isIntersecting || !isActive(slot) || slot.childElementCount) continue;
      const ad =
        slot.dataset.ad === 'mobile'
          ? mobileAd
          : slot.dataset.ad === 'bottom'
            ? bottomBannerAd
            : desktopAd;
      const frame = document.createElement('iframe');
      frame.title = entry.target.getAttribute('aria-label') ?? '広告';
      frame.width = String(ad.width);
      frame.height = String(ad.height);
      entry.target.append(frame);
      // 親ページのURLを引き継ぎ、配信リクエストにabout:srcdocを渡さない。
      const frameDocument = frame.contentDocument!;
      frameDocument.open();
      frameDocument.write(adDocument(ad));
      frameDocument.close();
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
