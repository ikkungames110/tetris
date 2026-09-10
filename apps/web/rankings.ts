import type { Rankings } from '../../packages/protocol/account';
import { timeLabel } from './render';

export const rankingsHTML = `
  <dialog id="ranking-dialog" aria-labelledby="ranking-title">
    <div class="dialog-heading"><h2 id="ranking-title">全国ランキング</h2><button id="ranking-close" class="icon-button" aria-label="ランキングを閉じる">✕</button></div>
    <div class="ranking-tabs" role="tablist" aria-label="ランキング種別">
      <button id="ranking-sprint-tab" role="tab" aria-selected="true" aria-controls="ranking-sprint">40LINE</button>
      <button id="ranking-random-tab" role="tab" aria-selected="false" aria-controls="ranking-random" tabindex="-1">ランダム対戦</button>
    </div>
    <p id="ranking-status" class="small muted" role="status">ランキングを読み込み中…</p>
    ${(['sprint', 'random'] as const)
      .map(
        (mode) => `
      <section id="ranking-${mode}" role="tabpanel" aria-labelledby="ranking-${mode}-tab" tabindex="0" ${mode === 'random' ? 'hidden' : ''}>
        <div id="ranking-${mode}-mine" class="ranking-mine"></div>
        <table class="ranking-table"><thead><tr><th scope="col">順位</th><th scope="col">プレイヤー</th><th scope="col">${mode === 'sprint' ? 'タイム' : 'レート'}</th></tr></thead><tbody id="ranking-${mode}-rows"></tbody></table>
        <p id="ranking-${mode}-empty" class="small muted" hidden>まだ記録がありません。</p>
        <p class="ranking-note small muted">${mode === 'sprint' ? 'クリア記録のあるプレイヤーが対象です。' : '会員プレイヤーの現在レートが対象です。初期レートは1000です。'}同じ記録は同順位です。</p>
      </section>`,
      )
      .join('')}
    <p class="ranking-note small muted">サイトを開いたとき・ログイン時に取得した順位です。最新の順位はページを再読み込みすると反映されます。</p>
  </dialog>`;

const $ = (id: string) => document.getElementById(id)!;
export function renderRankings(data: Rankings | null, member: boolean, status: string): void {
  $('ranking-status').textContent = status;
  for (const mode of ['sprint', 'random'] as const) {
    const ranking = data?.[mode];
    const format = (value: number) => (mode === 'sprint' ? timeLabel(value, true) : String(value));
    $(`ranking-${mode}-mine`).textContent = ranking?.mine
      ? `あなたの順位　${ranking.mine.rank}位　${format(ranking.mine.value)}`
      : !data
        ? 'あなたの順位　—'
        : mode === 'random' && !member
          ? 'ログインすると自分のレート順位を確認できます。'
          : 'あなたの順位　記録なし（取得時点）';
    const body = $(`ranking-${mode}-rows`);
    body.replaceChildren();
    for (const entry of ranking?.top ?? []) {
      const row = document.createElement('tr');
      row.classList.toggle('is-you', entry.isYou);
      for (const text of [
        `${entry.rank}`,
        `${entry.name}${entry.isYou ? '（あなた）' : ''}`,
        format(entry.value),
      ]) {
        const cell = document.createElement('td');
        cell.textContent = text;
        row.append(cell);
      }
      body.append(row);
    }
    $(`ranking-${mode}-empty`).hidden = !ranking || ranking.top.length > 0;
  }
}

export function setupRankingTabs(): void {
  const tabs = Array.from(document.querySelectorAll<HTMLElement>('.ranking-tabs [role="tab"]'));
  const select = (tab: HTMLElement) => {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      $(item.getAttribute('aria-controls')!).hidden = !selected;
    }
  };
  for (const tab of tabs) {
    tab.onclick = () => select(tab);
    tab.onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? tabs[0]
          : event.key === 'End'
            ? tabs.at(-1)!
            : tabs[1 - tabs.indexOf(tab)];
      select(next);
      next.focus();
    };
  }
}
