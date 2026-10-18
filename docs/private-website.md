# 住所・支払い情報を追加登録しない、本人限定のDUO

現在の方法は **Cloudflare Workers Free + GitHubログイン**です。住所・カード・超過課金への同意が必要になったCloudflare Zero Trust / Accessの申込みは使いません。GitHubリポジトリは非公開のままです。

すでに作成した `duo-private` Workerと、既存のGitHubアカウントを使います。サイトの入口で本人を確認し、許可したGitHubの数値IDと一致する人だけへHTML・JS・CSS・manifest・アイコン・Service Workerを返します。学習問題・回答・履歴はIndexedDBに保存し、CloudflareやGitHubへ送信しません。

## 無料で利用するための条件

- Cloudflareの **Workers & Pages → Plans / Usage** で、Workersの契約が **Free** であることを確認します。Zero TrustのFreeとは別です。有料プランには変更しません。
- Workers Freeには1日10万リクエスト、CPU時間10msなどの上限があります。上限に達した場合はエラーで止まり、Freeのままで利用上限を超える追加料金を支払う契約には進みません。
- このアプリは `assets.run_worker_first: true` を維持します。Cloudflare公式仕様では、無料枠を超えると429を返し、認証を飛ばして静的ファイルを一般公開しません。
- Freeの申込みや既存アカウントで別の請求登録画面が出たら、そのまま進まず確認してください。既存の有料契約・別サービスの料金まで、このコードで無効にすることはできません。
- これは第三者の無料枠を利用する方法です。将来の料金・利用規約の変更を永久に保証するものではありません。現在の契約・上限は管理画面と公式資料で確認します。

## 初回設定

### 1. WorkerのURLを確認

Cloudflareの画面から、WorkerのURLは `https://duo-private.6hm8jp7tv6.workers.dev` と確認済みです。独自ドメイン購入は不要です。このURLを `APP_ORIGIN` としてコードに設定しています。

Workerは、認証設定が未完了なら503を返し、学習画面やファイルを表示しません。Zero Trustの請求先住所フォームは送信しません。以前のAccess保護を有効にしていた場合は、新しいGitHubログインの検証後にその保護を解除します。

### 2. GitHubにDUO専用のOAuth Appを登録

[GitHubの新規OAuth App登録](https://github.com/settings/applications/new)を、DUOの所有者アカウントで開きます。GitHub公式のOAuth App登録項目はアプリ名・ホームページURL・説明・コールバックURLで、住所やカード情報は入力しません。

| 項目                       | 入力内容                                                   |
| -------------------------- | ---------------------------------------------------------- |
| Application name           | `DUO personal login`                                       |
| Homepage URL               | `https://duo-private.6hm8jp7tv6.workers.dev`               |
| Application description    | 任意。空欄で構いません                                     |
| Authorization callback URL | `https://duo-private.6hm8jp7tv6.workers.dev/auth/callback` |

Device Flowを有効にする必要はありません。`Register application` 後の **Client ID** を確認し、**Generate a new client secret** でSecretを作成します。過去に他の権限を与えたOAuth Appを流用せず、DUO専用に作成してください。

OAuth Appの登録名やホームページURLなどは公開される情報です。学習画面・リポジトリ・個人の学習データが公開されるわけではありません。

### 3. CloudflareのWorkerに設定

**duo-private → Settings → Variables and Secrets** に設定します。

| 名前                   | 種類             | 値                           |
| ---------------------- | ---------------- | ---------------------------- |
| `GITHUB_CLIENT_ID`     | Text             | 手順2のClient ID             |
| `GITHUB_CLIENT_SECRET` | Secret（暗号化） | 手順2で生成したClient Secret |

配信URLの `APP_ORIGIN` と本人の数値ID `GITHUB_OWNER_ID` は `wrangler.jsonc` に設定済みです。この2つを管理画面へ追加する必要はありません。配信URLを変更する場合は、コードとOAuth AppのURL設定を両方更新してください。ユーザー名の変更や他人の表示名に依存して許可しません。個別のメールアドレス登録も不要です。

Client Secret・パスワード・確認コードはチャット、README、GitHubのコードに書かないでください。SecretはCloudflareの設定画面へ直接入力します。

古い `ACCESS_TEAM_URL` / `ACCESS_AUD` / `ACCESS_OWNER_EMAIL` がある場合、新しい配信処理では使用しません。`keep_vars: true` で設定は再配信時にも保持されます。

### 4. 配信・本人確認

CloudflareのGitHub連携で非公開DUOの `main` を使い、ビルドコマンド `npm run build`、配信コマンド `npx wrangler deploy` で再配信します。Worker名は `duo-private` です。この方法で新しく有料プランを選ぶ必要はありません。

サイトを開くと「GitHubでログイン」が表示されます。GitHubにログインし、専用OAuth Appを承認します。リポジトリやメールを読む権限は要求しません。公開プロフィールの数値IDだけで本人を確認し、一致したらDUOを表示します。他のGitHubアカウントではログイン完了せず、学習ファイルを返しません。

## 安全性と保存内容

- OAuthのstateとPKCE（S256）を使い、別ブラウザの認証結果を取り込まないようにします。認証途中のCookieは10分で期限切れです。
- GitHubのトークン交換はWorkerからHTTPSで行います。Client Secretをブラウザへ配信しません。GitHubのアクセストークンは本人のプロフィール取得時だけに使い、その後保存しません。
- アプリ自身が作るログインCookieは `__Host-` / HttpOnly / Secure / SameSite=Lax、署名・用途・発行者・配信URL・本人ID・期限を検証します。オンラインのログイン期間は7日です。Secret変更で既存セッションを無効にできます。
- `/auth/*` はService Workerでキャッシュせず、ログイン・コールバック・ログアウトを常にネットワークへ送ります。認証ページをオフラインのアプリとして保存しません。
- 公開鍵取得やZero Trustの支払い契約は不要です。KV・R2・D1などの追加ストレージも使いません。
- 認証設定不足、偽造Cookie、本人以外、GitHubの認証障害は、いずれも学習ファイルを返さず終了します。

## iPhone・iPadとオフライン

Safariで本人ログインし、「オフライン準備完了」を確認してからホーム画面に追加します。ホーム画面アプリのCookie・保存領域はOSによりSafariタブと分かれることがあり、もう一度GitHubログインが必要な場合があります。

一度保存したアプリは、通信を切っても検索・学習・履歴保存ができます。認証はネットワーク配信への入口であり、保存済みのオフラインアプリやIndexedDBを遠隔で削除・ロックする仕組みではありません。ログアウトやGitHubでの承認取り消しだけでは、端末に保存済みのアプリ・データを消しません。オンラインセッションも発行済みの7日期限までは有効なため、即時に全セッションを無効にする場合はSecretを変更します。

## 検証

GitHub Actionsは手動実行のみです。コード更新による自動のActions実行を止め、ローカルの検証コマンドで確認できるようにしています。

```sh
npm ci
npm test
npm run build
npm run cloudflare:check
npm run test:pages
npm run test:private
```

- 学習ロジック6件と、認証フロー9件の単体テスト。GitHubの応答は架空のものに置き換え、本人のみ許可・state・PKCE・最小権限・期限・偽造・他人・外部障害・CSRFを確認します。
- `cloudflare:check` は配信せず、Workerをローカルでビルドします。
- `test:pages` はサブディレクトリでのPWA検証で、Web公開はしません。
- `test:private` は実際のローカルWorkers実行環境を一時HTTPSで起動し、未認証の全ファイルを拒否すること、試験用の署名済み本人Cookieでアプリを開けること、オフラインの検索・学習・履歴保存、認証URLをキャッシュしないことをChromiumで確認します。TLSは一時生成した試験証明書を限定して信頼し、外部通信の検証を無効にしません。

実際のGitHubログイン往復、CloudflareのFree契約・配信URL、Safari実機での認証とホーム画面起動は、利用者のアカウント設定後の確認が必要です。それらが終わるまで、本人限定サイトの利用開始完了とは扱いません。

## 公式資料

- [Workers料金・Freeプラン](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workersの上限](https://developers.cloudflare.com/workers/platform/limits/#daily-requests)
- [静的アセットの無料枠超過時の動作](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [GitHub OAuth App登録](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
- [GitHub OAuthとPKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [GitHub OAuthの最小権限](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
