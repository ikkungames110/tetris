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

Pages FunctionsはAPI Workerへの転送だけを行います。ブラウザーは同じオリジンの`/api/v1/*`を呼び、Cookieを送ります。API Workerは`workers.dev`とプレビューURLを無効化し、PagesのService binding経由で使います。P2P対戦は引き続きブラウザー間で処理します。[Cloudflare: Service bindings](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings)

## 動作

- URLへのアクセスでゲストセッションを作成。Cookieが有効な間は同じゲストとして復帰します。
- 「ログイン」内でメールアドレス・パスワードによるログインまたは新規登録。パスワードは1〜128文字です。
- ゲストから新規登録すると自己ベストを引き継ぎ、セッションを交換します。既存アカウントへのログインは、そのアカウントの自己ベストを読み込みます。
- マイページに40LINE最速タイムとランダム対戦の対戦数・勝利数・勝率を表示。対戦未経験の勝率は「—」です。戦績も新規登録時に引き継ぎ、ログインで別ブラウザーから参照できます。
- ランダム対戦は2本先取で決着した試合を集計。同じユーザー・試合IDの再送は重複計上しません。途中終了・切断での終了・ルーム対戦は含みません。保存失敗時はマイページから再送できます。
- 40LINE画面に自己ベストを表示。クリア時のリプレイをAPIで再生・検証し、より速い場合だけD1を更新します。カウントダウン・一時停止は計測に含めません。
- ゲームオーバー・途中リセット・リプレイ再生では保存しません。ゲーム開始時のユーザーと保存時のセッションが異なる場合も保存しません。
- 通信エラー時は未保存であることと再保存ボタンを表示。未送信記録はそのタブのメモリーに保持し、ページを閉じると失われます。リプレイは通常どおり手動保存できます。
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

`npm run check`は型チェック、ゲームのユニットテスト、実際のworkerd/D1エミュレーターによるAPIテスト、ブラウザー用ビルドを行います。`npm run test:e2e`はローカルWorker・D1・PeerServer・Viteを起動してブラウザー操作を検証します。ブラウザーテスト用UIはポート5179、APIはポート8797・一時DBを使い、通常の開発用DBとレート制限から隔離します。テスト用メール・パスワードは架空の値です。

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

- 初回表示・再読み込み：`POST session` 1回でセッションを復元し、ユーザー情報・40LINE自己ベスト・ランダム戦績をまとめて取得。
- ログイン・新規登録・ログアウト：該当POST各1回。応答に全記録を含め、後続のGETは送らない。
- 40LINE：取得済みの自己ベストを更新した場合だけ `POST records/40line` 1回。同タイム・遅い記録・保存中の重複は送らない。サーバーでも従来どおりリプレイ検証と最速値の比較を行う。
- ランダム対戦：2本先取の決着時に `POST records/random` 1回。同じタブで保存済みの試合は再送しない。サーバーでも重複を排除。
- マイページ・設定の開閉、モード変更、フォーカス復帰：0回。取得済みの状態を共有。
- ボタン割り当て：ブラウザー内保存のため0回。

記録のPOST応答でキャッシュと画面を更新します。通信失敗は自動リトライせず、再保存操作で再試行します。初回の取得失敗や別端末・別タブの変更は、ページ再読み込みで取得します。認証・ログアウト・明示的な再保存など、利用者の操作に必要な通信は残しています。ここでの回数はブラウザーからのアカウントAPIリクエストであり、API内部の認証・検証・DB操作の回数とは異なります。

## API v1

認証情報はCookieだけから取得します。更新APIは同じオリジンの`Origin`を必須とし、JSONのみ受け付けます。レスポンスは`Cache-Control: no-store`です。

| メソッド・パス                | 内容                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/health`          | 死活確認                                                                                                           |
| `POST /api/v1/session`        | セッション復帰／ゲスト作成                                                                                         |
| `GET /api/v1/me`              | 自分のユーザー情報と40LINE自己ベスト                                                                               |
| `POST /api/v1/register`       | `{email, password}`でゲストを会員へ移行                                                                            |
| `POST /api/v1/login`          | `{email, password}`でログイン                                                                                      |
| `POST /api/v1/logout`         | 現在のセッションを破棄し新しいゲストを作成                                                                         |
| `POST /api/v1/records/40line` | `{userId, replay}`を検証し自己ベストを更新。`userId`は所有者の指定ではなく、プレイ中のユーザー変更を検出する照合値 |

セッション・ログイン・記録APIの成功時は`{user: {id, kind, email}, best40: {ticks, achievedAt} | null, randomStats: {matches, wins}}`。時刻はUNIXミリ秒、タイムは60Hzの整数tickです。エラーは`{error: string}`とHTTPステータス（400/401/403/409/413/415/429/500）を返します。

## DB拡張と実装上の境界

`users`、`sessions`、`personal_bests`、`rate_limits`を分けています。追加項目は`apps/api/migrations/0002_*.sql`以降のマイグレーションで追加し、既存の適用済みSQLを編集しません。新しい記録モードを加える場合は`personal_bests.mode`の制約も更新してください。

パスワードはソルト付きscrypt（N=16384/r=8/p=5）、セッションはランダム32バイトのトークンを使いDBにはSHA-256値だけを保存します。CookieはHttpOnly・SameSite=Strictで、本番HTTPSではSecure＋`__Host-`接頭辞を付けます。ログイン試行はIPとメールアドレスのハッシュ単位で制限します。SQLにはバインドパラメーターを使用します。[OWASP: Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt)

現段階ではメール所有確認・パスワード再設定・アカウント削除の画面・ランキングはありません。メール送信サービスも使用していません。記録検証は通常ルールでの完走を確認するもので、自動操作や人間が実際にかけた時間の証明ではありません。

### ランダム対戦の保存API

`POST /api/v1/records/random` に `{ userId, matchId, seat, wins }` を送信します。`matchId` は対戦ごとのUUID、`seat` は0または1、`wins` は両者のラウンド勝利数です。一方だけが2勝した結果を受け付けます。本人のセッションを確認し、D1の `random_results` に保存します。アカウントAPIの応答には `randomStats: { matches, wins }` が含まれます。既存DBには `0002_random_results.sql` のマイグレーションが必要で、公開ワークフローで自動適用します。

戦績はP2Pのホストが通知した結果を各ブラウザーから保存する方式です。APIは入力形式・本人のセッション・重複を確認しますが、対戦内容や相手の実在をサーバーで証明するものではありません。ランキングや不正対策用の戦績としては利用していません。
