# GitHub運用統合・調査と切り替え手順

## 調査結果と保護

開始時: main=58dd40a、アプリv0.2.4、DUOはPrivate、Pagesなし。作業ブランチfeature/github-materials-v030。Git履歴のバックアップは作業環境の `/workspace/DUO-before-v030.bundle`。Git履歴は変更していません。端末の教材・履歴はこの環境から読み出せないため、利用者が既存アプリでJSONバックアップを保存する必要があります。

既存はVite・素のJavaScriptによる静的PWA。実教材ファイルは作業ツリーにありません。19コミットの追跡ファイル名を確認し、教材JSONの履歴は見つかりませんでした。JSONはpackage関連、架空サンプルはcoreとテスト内です。履歴の既知トークン・秘密鍵パターン検査も行いましたが、これは全ての秘密・著作物の不存在を保証する検査ではありません。公開前にPRと履歴を最終確認してください。

データ形式はsentence/word、number、section、en、ja。関連語は従来related文字列配列で、訳と識別子はありませんでした。既存validateItems・validateBackupを拡張し、独立したJSON Schemaと新形式の変換を追加しました。

IndexedDB duo-personal v1 のstate/currentへitems・records・sessions・settingsを分けて保持。DB構造変更なし。識別子はkind:number、復習はkind:number:direction。保存は競合検出付きトランザクション。既存バックアップv1互換。

## 公開先と外部依存

現行: https://duo-private.6hm8jp7tv6.workers.dev （GitHub mainのpushでCloudflare Workers Buildsが自動配信）。worker/index.jsはGitHub本人限定OAuthと静的配信。joseは認証、wranglerはCloudflareの検証・公開用。学習自体は外部サーバー不要です。

GitHub Pages予定: https://8b4z5nr6nt-wq.github.io/DUO/ 。workers.devはCloudflare所有のドメインなのでGitHub Pagesの独自ドメインとして引き継げません。両方を残して移行できます。Pagesではログイン不要。Private教材の取得をアプリに実装せず、手動インポートします。旧Workerコード・ログイン機能は削除せず旧環境維持用に残します。完全にGitHubだけへ統一する場合、移行確認後に旧Cloudflare自動配信を停止する別操作が必要です。

Vite baseは既存の./を維持。manifestのstart_url/scopeも相対、画面はhash routing、Service Workerは配信サブディレクトリを基準にします。静的ホストの「最新版を開く」は同一パスの新しいURLへ遷移し、GitHubログインを要求しません。Cloudflareでは従来の/auth/refreshを使います。

## GitHubだけで作業する方法

Codespaces: Code → Codespaces → Create。npm ciは自動実行。ターミナルでnpm run dev、Portsの5173からプレビュー。ポートはPrivateに維持してください。iPadもブラウザから操作可能ですが実機未検証です。Codespaces/Actionsの無料利用枠を超えて課金する設定は追加しません。

ActionsのValidate DUOは作業ブランチpush・PR・手動実行でテスト、ビルド、認証とオフライン・ブラウザ試験を実行。Pages用workflowは手動のみ、承認チェックとmainブランチを必須にしました。distだけを公開し、Privateリポジトリのチェックアウトは行いません。

## 承認後に必要な操作

1. 旧アプリの「データ」でJSONバックアップを端末へ保存。問題件数・履歴件数を確認。
2. GitHubでDUO-DataをPrivateとして作成（今回の連携は作成APIが403）。private-data-templateの中身をルートへ配置。実教材はこのPrivate側だけに追加。
3. DUOをPublicへ変更する承認を行い、Settings → General → Danger Zoneから変更。現行リポジトリはまだPrivate。
4. PRを確認・マージする前にCloudflare自動ビルドを停止するか、main更新が旧サイトも更新することを明示承認。旧環境を保持するなら先に自動ビルドを停止。
5. Settings → Pages → SourceをGitHub Actionsに設定（今回の連携はPages APIも403）。必要ならgithub-pages環境へ承認者を設定。
6. レビュー済みPRをmainへマージし、Actions → Deploy Pages after approval → Run workflow → approvedをチェック。
7. Pagesで開き、旧サイトから保存したバックアップを復元。別オリジンなのでIndexedDBは自動共有されません。履歴・設定・お気に入りを確認してからホーム画面に追加。「オフライン準備完了」後に機内モードで確認。
8. 新形式の教材をPrivateからダウンロードして追加・更新。Private検証ActionsはDUO公開・マージ後に使用。

公開設定変更・mainマージ・Pagesへの本番切り替えは事前承認まで行いません。履歴書き換え、サイトデータ削除、教材の自動アップロードは不要です。

## 維持する機能・未確認

双方向学習、手入力、スクリブル・筆跡、4択・カード、語ごとのヒントと速度、時間制限、検索と範囲選択、ランダム・苦手・復習、再挑戦・スキップ・一時停止、表記ゆれとスペル判定、自己採点・3段階評価・差分、履歴・グラフ・セクション集計・目標・お気に入り、バックアップ、オフライン、キーボード、日本語UIは既存コードを維持します。現行UIは緑青のガラス風です。OSのダーク設定では黒基調で表示する対応を追加します。
Safari/iPhone/iPad/Apple Pencil/ホーム画面の実機確認は未確認です。公開Pages上の確認は承認・設定後に実施が必要です。
