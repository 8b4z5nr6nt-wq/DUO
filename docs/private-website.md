# 自分だけが開けるDUOのWeb配信

GitHubリポジトリを非公開のまま、**Cloudflare Workers Static Assets + Cloudflare Access**でHTTPS配信する構成です。独自ドメインを取得しなくても `workers.dev` の本番URLを保護できます。アプリ内のアカウント・同期は作らず、サイトの入口だけで本人確認します。学習データはIndexedDBに保存し、Workerへ送りません。

現時点ではCloudflareのアカウント接続・実配信・Safari実機確認は未実施です。GitHub Pagesを公開するワークフローは削除し、検証だけを行うGitHub Actionsに変更しています。

## 構成と保護範囲

- `worker/index.js` がすべてのリクエストに先に対応します。HTML・JS・CSS・Service Worker・manifest・アイコンも認証対象です。
- `wrangler.jsonc` の `assets.run_worker_first: true` を維持してください。静的ファイルを認証前に直送しません。
- 未設定なら503、未認証・不正なJWT・別のメールアドレスなら403を返します。いずれの場合もファイルを返しません。
- Cloudflare Accessの署名済みアプリケーションJWTを、固定したteam URLの公開鍵で検証します。RS256・発行者・対象アプリ・有効期限・トークンの種類・本人のメールを確認します。任意の認証ヘッダーを付けるだけでは閲覧できません。
- JWT検証で公開鍵を取得できない場合も403にします。認証エラー時にファイルを返す処理はありません。
- `keep_vars: true` により、管理画面で設定した本人認証用の変数を再配信時にも保持します。
- `preview_urls: false` を明示しています。Accessは **All traffic** を選び、Worker全体を保護してください。プレビューだけを保護する設定ではありません。
- 認証画面へのリダイレクト応答をService Workerのキャッシュに保存しません。manifestもログイン済みの認証情報を使って読み込みます。

## Cloudflareの設定手順

Cloudflareの管理画面へのサインイン、Zero Trustの初期設定、GitHub連携の承認は利用者が行います。パスワード、APIトークン、確認コードをチャットやGitHubのファイルに書かないでください。プランや制限はCloudflareの申込画面で確認してください。

1. CloudflareアカウントでZero Trustを有効にし、team名を設定します。
2. **Zero Trust → Integrations → Identity providers**で、メールのワンタイムPINを使う場合は **One-time PIN** を追加します。アカウントによって初期の認証方法が異なります。
3. **Access → Policies**で、**Allow → Include → Emails**に本人のメールアドレス1件だけを指定したポリシーを用意します。メールのドメイン全体やEveryoneを許可しないでください。
4. DUO Workerを作成して、**Workers & Pages → DUO Worker → Access → Protect this Worker behind Access → All traffic**を選び、本人だけのポリシーを適用します。まだAccessがない場合もWorkerのガードが未認証リクエストを拒否します。
5. Accessのアプリケーション詳細で **Application Audience (AUD) Tag** を確認します。
6. DUO Workerの **Settings → Variables and Secrets** に、次の3つを設定します。値はWorker側に置き、`VITE_`変数やフロントエンドコードに入れません。

| 変数                 | 内容                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| `ACCESS_TEAM_URL`    | 設定したteamの `https://＜team名＞.cloudflareaccess.com`。パス・クエリなし |
| `ACCESS_AUD`         | DUOを保護するAccessアプリケーションのAUD Tag                               |
| `ACCESS_OWNER_EMAIL` | 許可した本人のメールアドレス1件                                            |

7. アプリをビルドして、Workerコードと `dist` を一緒に配信します。

CloudflareのGitHub連携を使う場合、非公開のDUOリポジトリだけを連携対象に選び、ビルドコマンドを `npm run build`、配信コマンドを `npx wrangler deploy` にします。Worker名は `wrangler.jsonc` の `duo-private` と管理画面で一致させてください。アカウントの利用権限が必要です。GitHub Pagesや、`dist`だけを別の一般公開サービスへアップロードする操作は行いません。

許可済みの端末でCLIを使う場合は、Cloudflare公式のWranglerログイン手順を完了してから実行します。

```sh
npm ci
npm run build
npm test
npm run cloudflare:check
npx wrangler deploy
```

`cloudflare:check` は配信せず、Workerをローカルでバンドルする確認です。この環境でも実行済みです。実際のデプロイは、利用者のCloudflareアカウントと設定を確認した後に行います。認証設定を削除した場合も、Workerは未認証へアプリのファイルを返しません。

## 配信後の必須確認

1. 新しいプライベートブラウズ画面で、URLを開くとAccessログイン画面が出ることを確認します。本人以外のメールではアプリに進めないことを確認します。
2. 本人でログインし、ホーム・検索・学習・履歴・バックアップを架空データだけで確認します。
3. `/index.html`、`/sw.js`、`/manifest.webmanifest`、`/assets/`のJS/CSS、アイコンも、未ログインの別ブラウザから取得できないことを確認します。
4. `workers.dev`のURLと、設定した別ドメイン・プレビューURLがあれば、それぞれで認証が必要または無効であることを確認します。
5. iPhone・iPadのSafariで「オフライン準備完了」を確認してホーム画面に追加します。ホーム画面起動時にもう一度本人確認を求められることがあります。
6. 機内モードで開き直し、検索・学習・保存した履歴の再読み込みを確認します。初回はオンラインで本人確認とアプリ読み込みが必要です。
7. Accessのセッションが期限切れになった後のオンライン更新、再ログイン、ホーム画面起動を確認します。

Accessはネットワークからの閲覧を制限します。すでに本人の端末に保存したオフラインアプリやIndexedDBを遠隔で削除する機能ではありません。その端末を他の人が操作できる場合はアプリ内のデータも見られるため、端末のロックを使ってください。

## ローカル検証

`npm test`では、学習ロジック6件と、認証設定不足・未認証・偽造署名・別発行者・別アプリ・期限切れ・別メール・サービス用トークンの拒否、本人だけの許可を確認します。

```sh
npm run build
npm test
npm run cloudflare:check
npm run test:pages
```

`test:pages`という既存コマンドは、静的アプリをサブディレクトリで配信した場合のオフライン機能確認用として残しています。GitHub Pagesを実際に公開しません。

Workerをローカル起動して、認証設定がない状態でファイルを返さないことも確認できます。ホームディレクトリが書き込み制限されている環境ではXDG_CONFIG_HOMEを書き込み可能な場所へ指定してください。

```sh
XDG_CONFIG_HOME=/workspace/.cloudflare-config WRANGLER_SEND_METRICS=false npx wrangler dev --local --port 8787 --ip 127.0.0.1
```

ローカルの署名検証試験とCloudflareの実際のログイン・保護設定は別です。実配信のチェックが終わるまで、本人限定サイトの公開完了とは扱いません。

## 公式資料

- [WorkersのCloudflare Access保護](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [workers.devでのアクセス管理](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [静的アセットより先にWorkerを実行](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Access JWTの検証](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [メールのワンタイムPIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
