const fonts = await fetch('./manifest.json').then((response) => {
  if (!response.ok) throw new Error('フォント一覧を読み込めませんでした。');
  return response.json();
});
const grid = document.querySelector('#candidates');
function select(font) {
  document.querySelector('#live-title').style.fontFamily = `"Title-${font.id}"`;
  document.querySelector('#selected-name').textContent = font.name;
  document.querySelector('#try-font').href = `../?title-font=${font.id}`;
  for (const button of grid.querySelectorAll('button'))
    button.setAttribute('aria-pressed', String(button.dataset.font === font.id));
}
for (const [index, font] of fonts.entries()) {
  const card = document.createElement('article');
  card.className = 'card';
  card.innerHTML = `<button type="button" data-font="${font.id}" aria-pressed="false" aria-label="${String(index + 1).padStart(2, '0')} ${font.name}をプレビュー"><span class="card-top"><span class="number">${String(index + 1).padStart(2, '0')}</span><span class="select-state">プレビュー中 ✓</span></span><span class="specimen" style="font-family: 'Title-${font.id}'">テトクラ</span><span class="font-name">${font.name} <small> / ${font.japanese}</small></span><span class="description">${font.description}</span></button><div class="sources"><a href="${font.source}" target="_blank" rel="noopener noreferrer">配布元 ↗</a><a href="${font.license}" target="_blank" rel="noopener noreferrer">OFL 1.1 / ライセンス ↗</a></div>`;
  card.querySelector('button').onclick = () => select(font);
  grid.append(card);
}
select(fonts.find((font) => font.id === 'trainone'));
await document.fonts.ready;
document.body.dataset.fontsReady = 'true';
