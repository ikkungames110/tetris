# Cloudflare のアカウント・プレイ記録

公開URL: **[https://tetcla.shianstudio.com/](https://tetcla.shianstudio.com/)**

2026-09-07にPages・API Worker・D1を作成し、公開先でゲスト作成、登録、40LINE記録保存、別ブラウザーからのログインと自己ベスト復元、ログアウトを確認しました。現在の設定ファイルはこの公開先を参照します。別アカウントへ公開する場合は以下の初回公開手順で新しいDB IDを設定してください。

## 構成

```mermaid
flowchart TD
  User[ブラウザー] --> Pages[Cloudflare Pages: Vite の配信物]
  Pages --> Gateway[Pages Functions: /api/*]
  Gateway -->|Service binding: API| Worker[Cloudflare Workers: stack-tetris-api]
  Worker -->|DB binding| D1[Cloudflare D1: stack-tetris]
```

Pages FunctionsはAPI Workerへの転送だけを行います。ブラウザーは同じオリジンの`/api/v1/*`を呼び、Cookieを送ります。API Workerは`workers.dev`とプレビューURLを無効化し、PagesのService binding経由で使います。ルーム対戦・ランダム対戦ともP2Pで通信し、ランダム対戦終了時の勝敗報告だけAPIで照合・保存します。[Cloudflare: Service bindings](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings)

## 動作

- URLへのアクセスでゲストセッションを作成。Cookieが有効な間は同じゲストとして復帰します。
- 「ログイン」内でユーザー名・パスワードによるログインまたは新規登録。パスワードは1〜128文字です。
- ゲストから新規登録すると自己ベストを引き継ぎ、セッションを交換します。既存アカウントへのログインは、そのアカウントの自己ベストを読み込みます。
- マイページに40LINE最速タイムとランダム対戦の対戦数・勝利数・勝率、会員の現在・最高レートを表示。対戦未経験の勝率は「—」、レートは1000です。ゲストの戦績も新規登録時に引き継ぎ、ログインで別ブラウザーから参照できます。
- ランダム対戦は3本先取の決着・退室時の報告を集計。双方が報告すれば先着の勝敗、5秒後も片側だけなら報告者の勝利として確定します。同じユーザー・試合IDを重複計上しません。待機キャンセル・ルーム対戦は含みません。双方が会員の場合だけレートが増減します。[計算式・切断判定・保存の詳細](rating.md)。
- 40LINE画面に自己ベストを表示。クリア時のリプレイをAPIで再生・検証し、より速い場合だけD1を更新します。カウントダウン・一時停止は計測に含めません。
- ゲームオーバー・途中リセット・リプレイ再生では保存しません。ゲーム開始時のユーザーと保存時のセッションが異なる場合も保存しません。
- 40LINEの未送信記録はそのタブのメモリーに保持し、ページを閉じると失われます。ランダム対戦の未送信結果もタブのメモリーに保持します。受信した報告はD1に保存し、片側だけでも5秒後に報告者の勝利として確定します。ページを閉じても毎分の定期処理が確定・保存を再試行します。保存失敗・相手の報告待ちはマイページから再送・確認できます。
- ログアウトすると新しいゲストへ切り替わります。会員の記録はD1に残ります。
- セッションの期限は30日。期限切れセッション・レート制限・30日以上経過してセッションのないゲストを毎時削除します。会員は自動削除しません。

## ローカル実行

```bash
npm ci
npm run db:local
npm run dev:api
```

別ターミナルで`npm run dev`を起動し、`http://localhost:5173`を開きます。Viteが`/api`をローカルWorkerへ転送します。DBは`apps/api/.wrangler/`に保存され、リポジトリには含めません。

Pages FunctionsとService bindingも含めて確認する場合は、APIを起動したまま次を実行し、`http://localhost:8788`を開きます。

```bash
npm run build
npm run dev:cloudflare
```

`npm run check`は型チェック、ゲームのユニットテスト、実際のworkerd/D1エミュレーターによるAPIテスト、ブラウザー用ビルドを行います。`npm run test:e2e`はローカルWorker・D1・PeerServer・Viteを起動してブラウザー操作を検証します。ブラウザーテスト用UIはポート5179、APIはポート8797・一時DBを使い、通常の開発用DBとレート制限から隔離します。テスト用ユーザー名・パスワードは架空の値です。

## 初回公開

Cloudflareの認証とアカウントへのアクセスが必要です。トークンをソースコードや`VITE_*`へ記載しないでください。

```bash
npx wrangler login
npx wrangler d1 create stack-tetris
```

表示された実際のDB IDを使います（`00000000-...`はローカル開発用の仮値です）。Pages名が既に使われている場合は、独自の名前へ変更できます。

```bash
CLOUDFLARE_D1_DATABASE_ID=実際のDB-ID \
CLOUDFLARE_PAGES_PROJECT=自分のPagesプロジェクト名 \
node scripts/configure-cloudflare.mjs
npx wrangler pages project create 自分のPagesプロジェクト名 --production-branch main
npm run check
npx wrangler d1 migrations apply DB --remote --config apps/api/wrangler.jsonc
npm run deploy:api
npm run deploy:pages -- --branch main
```

公開はAPI Worker→Pagesの順です。PagesとWorkerは同じCloudflareアカウントに作成します。PagesのGit連携で自動ビルドする場合も、APIのデプロイとD1マイグレーションを別途実行する必要があります。

Cloudflareを初めて使うアカウントでは、Cron登録時にエラー`10063`になる場合があります。その場合はダッシュボードのWorkers画面で`workers.dev`サブドメインを作成してから再実行します。今回のアカウントでは`ikkungames110.workers.dev`を作成済みです。API自体の`workers.dev`公開は無効のままです。

パスワード処理とリプレイ検証はCPUを使います。Workers FreeのCPU上限は1リクエスト10msで、ローカル開発ではこの上限を再現しません。公開先のプランと実測を確認してください。実装・デプロイ手順は有料プランへの契約変更を行いません。[Cloudflare: CPU制限](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)

## push時の自動公開

本番の自動公開は有効です。`main`へのpushでGitHub ActionsがCloudflareのAPI WorkerとPagesを更新し、`https://tetcla.shianstudio.com/`へ反映します。`CLOUDFLARE_API_TOKEN`と`CLOUDFLARE_ENABLED=true`を含む下記の設定をGitHubに登録済みです。ローカルの`wrangler login`はGitHub Actionsの認証には引き継がれません。

設定の登録だけでは過去にスキップされた実行は再開しません。次の`main`へのpush、またはActionsの「Deploy to Cloudflare」→「Run workflow」で公開します。

GitHubのSettings → Secrets and variables → Actionsに設定します。

| 種類     | 名前                        | 内容                                                                      |
| -------- | --------------------------- | ------------------------------------------------------------------------- |
| Secret   | `CLOUDFLARE_API_TOKEN`      | 対象アカウントのWorkers Scripts・Cloudflare Pages・D1を編集できるトークン |
| Secret   | `CLOUDFLARE_ACCOUNT_ID`     | 対象のCloudflareアカウントID                                              |
| Variable | `CLOUDFLARE_D1_DATABASE_ID` | 作成済みD1のID                                                            |
| Variable | `CLOUDFLARE_PAGES_PROJECT`  | 作成済みPages名。省略時`stack-tetris`                                     |
| Variable | `CLOUDFLARE_WORKER_NAME`    | 任意。省略時`stack-tetris-api`                                            |
| Variable | `CLOUDFLARE_ENABLED`        | 初期リソースと上記設定を準備してから`true`                                |

[Cloudflare公開ワークフロー](../.github/workflows/cloudflare.yml)は検証→設定→D1マイグレーション→Worker→Pagesの順です。未設定時はスキップします。GitHub Pages単体にはAPI・D1がないため、既存のPagesワークフローでは`VITE_ACCOUNTS_ENABLED=false`でアカウント画面を非表示にします。アカウント機能はCloudflare側の公開URLで利用します（既定で有効）。

## ブラウザーからのリクエスト回数

- 初回表示・再読み込み：`POST session` 1回でセッションを復元し、ユーザー情報・40LINE自己ベスト・ランダム戦績・両ランキングをまとめて取得。
- ログイン・新規登録・ログアウト：該当POST各1回。応答にプレイ記録を含め、後続のGETは送らない。ログイン・新規登録ではランキングも取得する。ログアウトでは順位を取得せず、自分の表示を消す。
- 40LINE：取得済みの自己ベストを更新した場合だけ `POST records/40line` 1回。同タイム・遅い記録・保存中の重複は送らない。サーバーでも従来どおりリプレイ検証と最速値の比較を行う。
- ランダム対戦：終了時に `POST records/random` で勝敗報告。相手待ち（202）の場合だけ最大3回の追加確認を行い、その後は手動再送です。同じタブで保存済みの試合は再送しません。ゲーム中の入力・接続確認はP2Pのみで、API WorkerへのWebSocket接続はありません。
- マイページ・設定・ランキングの開閉とタブ切り替え、通常のモード変更、フォーカス復帰：0回。取得済みの状態を共有。
- ボタン割り当て：ブラウザー内保存のため0回。

記録のPOST応答でキャッシュと画面を更新します。通信失敗は自動リトライせず、再保存操作で再試行します。初回の取得失敗や別端末・別タブの変更は、ページ再読み込みで取得します。認証・ログアウト・明示的な再保存など、利用者の操作に必要な通信は残しています。ここでの回数はブラウザーからのアカウントAPIリクエストであり、API内部の認証・検証・DB操作の回数とは異なります。

## API v1

認証情報はCookieだけから取得します。更新APIは同じオリジンの`Origin`を必須とし、JSONのみ受け付けます。レスポンスは`Cache-Control: no-store`です。

| メソッド・パス                | 内容                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/health`          | 死活確認                                                                                                           |
| `POST /api/v1/session`        | セッション復帰／ゲスト作成                                                                                         |
| `GET /api/v1/me`              | 自分のユーザー情報と40LINE自己ベスト                                                                               |
| `POST /api/v1/register`       | `{username, password}`でゲストを会員へ移行                                                                         |
| `POST /api/v1/login`          | `{username, password}`でログイン                                                                                   |
| `POST /api/v1/username`       | `{username}`でログイン中の会員本人のユーザー名を変更（重複は409）。記録・ランキングを返す                          |
| `POST /api/v1/logout`         | 現在のセッションを破棄し新しいゲストを作成                                                                         |
| `POST /api/v1/records/40line` | `{userId, replay}`を検証し自己ベストを更新。`userId`は所有者の指定ではなく、プレイ中のユーザー変更を検出する照合値 |

セッション・ログイン・記録APIの成功時は`{user: {id, kind, username}, best40: {ticks, achievedAt} | null, randomStats: {matches, wins}, rating: {current, peak, matches} | null}`。`rating.matches`はレート対象試合数で、ゲストの`rating`はnullです。時刻はUNIXミリ秒、タイムは60Hzの整数tickです。起動時の`session`と`login`・`register`・`username`の成功応答に`rankings: {sprint, random}`を追加します。各ランキングは`{top: [{rank, name, value, isYou}], mine: {rank, value} | null}`です。40LINEの`value`はtick、ランダム対戦は現在レートです。他人のユーザーIDはランキングに含めません。エラーは`{error: string}`とHTTPステータスを返します。

ランキングの集計対象は、40LINEがゲストを含むクリア記録、ランダム対戦が全会員の現在レート（未対戦は1000）です。同記録は同順位（1・1・3）にします。`0004_rankings.sql`で順位検索用の索引を追加し、上位10人と自分より良い記録の件数をD1の1回のbatchで取得します。ブラウザーからのHTTPリクエスト数は増えませんが、起動・認証時のDB読み取りは増えます。記録更新時・対戦終了時には順位を再計算しません。人数・アクセス数が増えた場合は`rows_read`を計測して定期集計を検討してください。

## DB拡張と実装上の境界

`users`、`sessions`、`personal_bests`、`rate_limits`を分けています。追加項目は`apps/api/migrations/0002_*.sql`以降のマイグレーションで追加し、既存の適用済みSQLを編集しません。新しい記録モードを加える場合は`personal_bests.mode`の制約も更新してください。

パスワードはソルト付きscrypt（N=16384/r=8/p=5）、セッションはランダム32バイトのトークンを使いDBにはSHA-256値だけを保存します。CookieはHttpOnly・SameSite=Strictで、本番HTTPSではSecure＋`__Host-`接頭辞を付けます。ログイン試行はIPとユーザー名のハッシュ単位で制限します。SQLにはバインドパラメーターを使用します。[OWASP: Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt)

現段階ではパスワード再設定・アカウント削除の画面はありません。メール送信サービスも使用していません。記録検証は通常ルールでの完走を確認するもので、自動操作や人間が実際にかけた時間の証明ではありません。

### ランダム対戦のAPI

`GET /api/v1/random/:code`は廃止し、HTTP 410で更新を案内します。DOを起動しません。既存のクラスとbindingは互換性のため残しています。

`POST /api/v1/records/random`は`{ userId, opponentId, matchId, seat, wins }`を受け取り、Cookieで本人を確認して報告をD1に保存します。双方の報告が届けば先着の勝敗で確定し、5秒後も片方だけなら報告者の勝利です。確定後の応答はアカウント状態と`randomResult`、待機中は202と`randomPending: true`です。別の参加者による同じ席の利用などは409です。確定後の異なる勝敗報告には既存の確定結果を返します。`0008_random_decisions.sql`と毎分の確定処理を追加します。詳細は[レーティング](rating.md)を参照してください。

### ユーザー名への移行

`0005_usernames.sql`でメール列をユーザー名へ移行します。既存会員は旧メールの `@` より前が初期ユーザー名になります。重複・長すぎる名前・制御文字を含む名前、および移行用の `player-` で始まる名前は `player-<移行時の連番>` にします。ユーザーID・パスワード・セッション・自己ベスト・戦績・レートは維持します。移行後のDBには旧メールアドレスを残しません。ログイン中の会員はヘッダーで初期ユーザー名を確認でき、マイページで変更できます。ログアウト済みで名前が分からない会員には問い合わせ窓口で対応します。

新規登録と変更は1〜40文字（日本語可）、空白・@・制御文字不可です。前後の空白を除去し、半角英大文字を小文字に統一します。名前変更は本人のセッションで認証し、15分で10回までです。変更時にランキングを更新し、対戦での名前は次の接続から反映します。
