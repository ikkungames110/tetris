const gallery = document.querySelector('#gallery');
const viewer = document.querySelector('#viewer');
let active = 0;

function show(index) {
  active = (index + window.endcards.length) % window.endcards.length;
  const card = window.endcards[active];
  document.querySelector('#viewer-title').textContent = `${card.id} / ${card.name}`;
  const image = document.querySelector('#full-image');
  image.src = card.image;
  image.alt = `テトクラ エンドカード ${card.id}「${card.name}」`;
  document.querySelector('#position').textContent = `${active + 1} / ${window.endcards.length}`;
  const download = document.querySelector('#download');
  download.href = card.image;
  download.download = card.image.split('/').pop();
  if (!viewer.open) viewer.showModal();
}

window.endcards.forEach((card, index) => {
  const article = document.createElement('article');
  const preview = document.createElement('button');
  preview.className = 'preview';
  preview.setAttribute('aria-label', `${card.id}「${card.name}」を拡大`);
  const image = document.createElement('img');
  image.src = card.thumbnail;
  image.alt = `テトクラ エンドカード ${card.id}「${card.name}」`;
  image.width = 960;
  image.height = 540;
  image.loading = index < 2 ? 'eager' : 'lazy';
  preview.append(image);
  preview.addEventListener('click', () => show(index));
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const copy = document.createElement('div');
  const title = document.createElement('h2');
  const number = document.createElement('span');
  number.className = 'number';
  number.textContent = card.id;
  title.append(number, card.name);
  const description = document.createElement('p');
  description.textContent = card.description;
  copy.append(title, description);
  const download = document.createElement('a');
  download.className = 'download';
  download.href = card.image;
  download.download = card.image.split('/').pop();
  download.textContent = 'PNGを保存 ↓';
  download.setAttribute('aria-label', `${card.id}「${card.name}」のPNGを保存`);
  meta.append(copy, download);
  article.append(preview, meta);
  gallery.append(article);
});

document.querySelector('#close').addEventListener('click', () => viewer.close());
document.querySelector('#previous').addEventListener('click', () => show(active - 1));
document.querySelector('#next').addEventListener('click', () => show(active + 1));
viewer.addEventListener('click', (event) => {
  if (event.target !== viewer) return;
  const bounds = viewer.getBoundingClientRect();
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    viewer.close();
});
viewer.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    show(active + (event.key === 'ArrowRight' ? 1 : -1));
  }
});
