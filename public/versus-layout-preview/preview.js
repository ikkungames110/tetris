const plans = [
  [
    '基本配置',
    '名前と勝利数をSTOCKのすぐ下にまとめ、相手盤面はQUEUE直下へ。視線を短く動かして両者の状況を確認できます。',
  ],
  [
    '中央でスコア確認',
    '自分の情報を左側中央に配置。相手盤面の下端を自分の盤面に揃え、対戦中に見る場所を分けます。',
  ],
  [
    '下側に情報を集約',
    '自分の情報をSTOCKボタンの上に配置。右下の相手盤面と近い高さで、両者の勝利数を比較できます。',
  ],
  [
    '対戦カード',
    '左右の情報を薄い背景で囲みます。自分と相手の名前・勝利数のまとまりが見やすい構成です。',
  ],
  [
    '最小表示',
    'レートや勝利マーカーを省き、名前と勝利数だけを表示。相手盤面も少し小さくして、左右の余白を多く残します。',
  ],
];
const gallery = document.querySelector('#gallery');
gallery.innerHTML = plans
  .map(
    ([title, description], i) => `
<section class="plan plan-${i + 1}" id="plan-${i + 1}" aria-labelledby="title-${i + 1}">
  <h2 id="title-${i + 1}"><span>0${i + 1}</span>${title}</h2><p class="description">${description}</p>
  <div class="frame"><div class="phone">
    <div class="phone-header"><span class="brand">♧ テトクラ</span><span class="header-links">マイページ　設定　ヘルプ</span></div>
    <div class="tabs"><span>エンドレス</span><span>TIME ATTACK</span><b>ランダム対戦</b><span>ルーム対戦</span></div>
    <div class="match-line"><span>ROUND 4 · FIRST TO 3</span><span>01:24</span></div>
    <div class="scene">
      <div class="stock"><span class="label">STOCK</span><canvas class="piece" data-piece="T" width="96" height="56" aria-label="ストック Tミノ"></canvas></div>
      <div class="self-board"><canvas class="board" width="300" height="615" aria-label="自分の盤面"></canvas><small class="signature">↓ FALL / FLOW</small></div>
      <div class="queue"><span class="label">QUEUE</span>${['S', 'Z', 'I', 'J', 'O'].map((p) => `<canvas class="piece" data-piece="${p}" width="96" height="56" aria-label="次のミノ ${p}"></canvas>`).join('')}</div>
      <div class="identity"><span class="you">YOU</span><strong>あおい</strong><div class="wins">2 <small>勝</small></div><div class="dots" aria-label="3本中2本獲得">●●○</div><div class="rate">RATE 1240</div></div>
      <div class="opponent"><span class="label">OPPONENT</span><canvas class="board" data-opponent width="300" height="615" aria-label="相手の盤面"></canvas><div class="opponent-name">そら</div><div class="opponent-score">1 勝</div></div>
      <div class="stock-button">STOCK<small>保管 / 交換</small></div>
    </div>
    <div class="controls" aria-label="操作ボタンの配置見本"><div class="key drop">↓ DROP<small>瞬時に着地</small></div><div class="key">←</div><div class="key">↓</div><div class="key">→</div><div class="key ccw">⟲<small>左回転</small></div><div class="key cw">⟳<small>右回転</small></div></div>
    <div class="ad">広告スペース · 320 × 50</div>
  </div></div>
</section>`,
  )
  .join('');
const shapes = {
  T: [
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  S: [
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
  ],
  Z: [
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
  ],
  I: [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ],
  J: [
    [0, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  O: [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  L: [
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
};
const colors = {
  T: '#a193c1',
  S: '#a7c581',
  Z: '#cd8594',
  I: '#76bbc5',
  J: '#879ece',
  O: '#d3c78d',
  L: '#d0a16f',
};
function block(ctx, x, y, size, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
  ctx.fillStyle = '#ffffff16';
  ctx.fillRect(x + 1, y + 1, size - 2, 2);
}
for (const canvas of document.querySelectorAll('.piece')) {
  const ctx = canvas.getContext('2d'),
    shape = shapes[canvas.dataset.piece];
  const w = Math.max(...shape.map(([x]) => x)) + 1,
    h = Math.max(...shape.map(([, y]) => y)) + 1;
  for (const [x, y] of shape)
    block(
      ctx,
      (96 - w * 24) / 2 + x * 24,
      (56 - h * 24) / 2 + y * 24,
      24,
      colors[canvas.dataset.piece],
    );
}
for (const canvas of document.querySelectorAll('.board')) {
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#8cbeb90b';
  ctx.lineWidth = 1;
  for (let x = 0; x <= 300; x += 30) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 615);
    ctx.stroke();
  }
  for (let y = 15; y <= 615; y += 30) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(300, y);
    ctx.stroke();
  }
  const rows = [
    '..........',
    '..........',
    '..TTT.....',
    '...T..SS..',
    'JJ...SSOO.',
    '.JLLLZZOO.',
    'JJLIZZTTT.',
    'LLLISSSJT.',
  ];
  rows.forEach((row, r) =>
    [...row].forEach((p, c) => {
      if (p !== '.') block(ctx, c * 30, 375 + r * 30, 30, colors[p]);
    }),
  );
  for (const [x, y] of shapes.L) block(ctx, 90 + x * 30, 75 + y * 30, 30, colors.L);
  ctx.strokeStyle = '#d0a16f77';
  for (const [x, y] of shapes.L) ctx.strokeRect(91 + x * 30, 316 + y * 30, 28, 28);
}
function resize() {
  document.documentElement.style.setProperty(
    '--phone-width',
    `${document.querySelector('#width').value}px`,
  );
  for (const frame of document.querySelectorAll('.frame')) {
    const phone = frame.firstElementChild,
      scale = Math.min(1, frame.clientWidth / phone.offsetWidth);
    phone.style.transform = `scale(${scale})`;
    frame.style.height = `${phone.offsetHeight * scale}px`;
  }
}
document.querySelector('#width').addEventListener('change', resize);
document
  .querySelector('#guides')
  .addEventListener('change', (e) => document.body.classList.toggle('guides', e.target.checked));
new ResizeObserver(resize).observe(gallery);
resize();
