# サイト情報・権利表記の運用メモ

更新：2026-09-08

## 今回の範囲

- テトクラは独立開発・非公式であり、Tetris Holding、The Tetris Companyとの提携・協賛・承認関係がないと明記。
- 「模倣ではない」「侵害ではない」「訴えられない」という法的な結論は記載していない。表記は出所の混同を避けるためのもので、ゲームの表現・デザイン・商標の適法性を確定するものではない。
- BGMはフリー音源、効果音・ボイスはAI生成という運営者の説明を反映。フリー音源をパブリックドメインと断定したり、第三者への再配布を一括許諾したりしていない。
- 規約はこのサービス向けに作成し、他サービスの規約本文を転載していない。一切の責任を免除する条項は設けず、適用法令による利用者の権利を留保。
- 現在のCookie・localStorage・sessionStorage、アカウント・40LINE・ランダム戦績、広告・P2P通信・メール窓口をプライバシーに説明。
- 氏名・住所を推測して公開しない。運営者情報の照会と開示・訂正・削除等をメールで受け付ける旨を記載。実際に請求が届いた場合は本人確認と法令に沿った対応が必要。

## 継続して行うこと

利用規約や非公式表記だけで、権利問題がなくなるわけではない。ゲームの見た目や素材が既存作品に似ている場合など、個別の判断が必要な点は知的財産を扱う専門家に確認する。素材の入手元・その時点の利用条件・生成サービスの条件は運営側で保存する。

アカウント削除や運営者情報の照会を受けたときはメール窓口で対応する。解析・広告事業者の追加、課金、データの追加取得や保存期間の変更時には本文を更新する。現在は有料販売・有料契約を提供していないため、架空の販売条件や事業者住所を作って特定商取引法表記を追加することはしていない。

## 本文と生成物

- `legal/index.html`：公開ページと設定内で共用する本文。専用ページはJavaScriptなしでも読める。
- `public/legal/third-party.txt`：PeerJS・推移的依存関係・wsのライセンス原文。`npm run build` の前に生成。
- `index.html`：検索用メタデータ、構造化データ、静的なサイト情報リンク。
- `public/robots.txt` / `public/sitemap.xml`：クロール案内。正式公開先は `https://tetcla.shianstudio.com/`。GitHub Pagesの重複ページも同じcanonicalを参照。

## 参照資料

- [Tetris公式サイト](https://tetris.com/)：Tetris Holdingの商標・外観に関する権利表記を確認。非公式と明記することと、権利侵害の有無は別の問題。
- [個人情報保護委員会・通則編](https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/)：利用目的、公表等、開示等の請求、安全管理の説明。
- [消費者庁・消費者契約法の解説](https://www.caa.go.jp/about_us/about/caa_pamphlet/jp_2026_004.html)：事業者の責任を全部免除する条項の扱い。
- [i-mobileプライバシー](https://www.i-mobile.co.jp/privacy.html)、[オプトアウト](https://www.i-mobile.co.jp/optout.html)：広告の外部送信に関する利用者向けの確認先。
- [Google Search Central・検索の仕組み](https://developers.google.com/search/docs/fundamentals/how-search-works)、[サイト名](https://developers.google.com/search/docs/appearance/site-names)：クロール可能な本文、title、説明、canonical、WebSiteデータを整備。順位・インデックス登録は保証されない。
