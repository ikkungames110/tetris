# 「テトクラ」タイトルフォント候補

比較ページ: 開発サーバーの `/font-preview/index.html`。10種類とも「テトクラ」の実フォントを表示し、同じ色・サイズで比較できる。カード選択で上部の実寸ヘッダープレビューを更新し、「ゲーム画面で試す」で `?title-font=<id>` のヘッダーに適用する。通常URLのヘッダーはユーザー選択の07「Train One」を採用した。他の候補はURL単位で試用できる。

2026-09-09にGoogle Fonts配布版と各書体のOFL原文を確認。全10種類はSIL Open Font License 1.1で、商用サイトのタイトルに使用できる。配布・埋め込み時の著作権表示とライセンス原文を比較ページの `licenses/` に同梱している。フォント単体の販売等の条件は各原文を参照。

| 番号 | 書体・公式配布元                                                     | 見た目の方向                 | ライセンス                                                                               |
| ---- | -------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------- |
| 01   | [Dela Gothic One](https://fonts.google.com/specimen/Dela+Gothic+One) | 極太・ぎゅっと詰まった重量感 | [OFL原文](https://raw.githubusercontent.com/google/fonts/main/ofl/delagothicone/OFL.txt) |
| 02   | [DotGothic16](https://fonts.google.com/specimen/DotGothic16)         | ピクセル・レトロなゲーム画面 | [OFL原文](https://raw.githubusercontent.com/google/fonts/main/ofl/dotgothic16/OFL.txt)   |
| 03   | [Rampart One](https://fonts.google.com/specimen/Rampart+One)         | 立体・輪郭と影の遊び心       | [OFL原文](https://raw.githubusercontent.com/google/fonts/main/ofl/rampartone/OFL.txt)    |
| 04   | [Reggae One](https://fonts.google.com/specimen/Reggae+One)           | 鋭いエッジ・勢いのある見出し | [OFL原文](https://raw.githubusercontent.com/google/fonts/main/ofl/reggaeone/OFL.txt)     |
| 05   | [RocknRoll One](https://fonts.google.com/specimen/RocknRoll+One)     | 跳ねる曲線・ポップなリズム   | [OFL原文](https://raw.githubusercontent.com/google/fonts/main/ofl/rocknrollone/OFL.txt)  |
| 06   | [Stick](https://fonts.google.com/specimen/Stick)                     | 細い直線・幾何学的な軽さ     | [OFL原文](https://raw.githubusercontent.com/google/fonts/main/ofl/stick/OFL.txt)         |
| 07   | [Train One](https://fonts.google.com/specimen/Train+One)             | 二重線・レトロフューチャー   | [OFL原文](https://raw.githubusercontent.com/google/fonts/main/ofl/trainone/OFL.txt)      |
| 08   | [Hachi Maru Pop](https://fonts.google.com/specimen/Hachi+Maru+Pop)   | 丸文字・手書きの懐かしさ     | [OFL原文](https://raw.githubusercontent.com/google/fonts/main/ofl/hachimarupop/OFL.txt)  |
| 09   | [Potta One](https://fonts.google.com/specimen/Potta+One)             | ぽってり太い・柔らかな表情   | [OFL原文](https://raw.githubusercontent.com/google/fonts/main/ofl/pottaone/OFL.txt)      |
| 10   | [Yuji Boku](https://fonts.google.com/specimen/Yuji+Boku)             | 筆文字・墨のかすれと抑揚     | [OFL原文](https://raw.githubusercontent.com/google/fonts/main/ofl/yujiboku/OFL.txt)      |

採用書体は07「Train One」。二重線の輪郭を持つ書体で、「テトクラ」の4文字に適用する。

Google FontsのCSS APIの`text=テトクラ`で配布される4文字のファイルをそのまま保存した。比較ページは外部フォントサーバーに接続しない。ダウンロードURL・元の書体名・配布元・同梱ライセンスの対応は `public/font-preview/manifest.json` に記録している。全10ファイルの合計は約22 KB。選択したヘッダーも「テトクラ」にだけ適用し、英字サブタイトルやゲーム内UIの文字は従来の書体を使う。
