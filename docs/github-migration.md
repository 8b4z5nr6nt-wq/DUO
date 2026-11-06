# GitHub運用統合・調査と切り替え手順

## 調査結果と保護

開始時: main=58dd40a、アプリv0.2.4、DUOはPrivate、Pagesなし。作業ブランチfeature/github-materials-v030。Git履歴のバックアップは作業環境の `/workspace/DUO-before-v030.bundle`。Git履歴は変更していません。端末の教材・履歴はこの環境から読み出せないため、利用者が既存アプリでJSONバックアップを保存する必要があります。

既存はVite・素のJavaScriptによる静的PWA。実教材ファイルは作業ツリーにありません。19コミットの追跡ファイル名を確認し、教材JSONの履歴は見つかりませんでした。JSONはpackage関連、架空サンプルはcoreとテスト内です。履歴の既知トークン・秘密鍵パターン検査も行いましたが、これは全ての秘密・著作物の不存在を保証する検査ではありません。公開前にPRと履歴を最終確認してください。

データ形式はsentence/word、number、section、en、ja。関連語は従来related文字列配列で、訳と識別子はありませんでした。既存validateItems・validateBackupを拡張し、独立したJSON Schemaと新形式の変換を追加しました。

IndexedDB duo-personal v1 のstate/currentへitems・records・sessions・settingsを分けて保持。DB構造変更なし。識別子はkind:number、復習はkind:number:direction。保存は競合検出付きトランザクション。既存バックアップv1互換。

## 公開先と外部依存

旧サイト（継続利用可）: https://duo-private.6hm8jp7tv6.workers.dev （GitHub mainのpushでCloudflare Workers Buildsが自動配信）。worker/index.jsはGitHub本人限定OAuthと静的配信。joseは認証、wranglerはCloudflareの検証・公開用。学習自体は外部サーバー不要です。

GitHub Pages公開先: https://8b4z5nr6nt-wq.github.io/DUO/ 。workers.devはCloudflare所有のドメインなのでGitHub Pagesの独自ドメインとして引き継げません。両方を残して移行できます。Pagesではログイン不要。Private教材の取得をアプリに実装せず、手動インポートします。旧Workerコード・ログイン機能は削除せず旧環境維持用に残します。完全にGitHubだけへ統一する場合、移行確認後に旧Cloudflare自動配信を停止する別操作が必要です。

Vite baseは既存の./を維持。manifestのstart_url/scopeも相対、画面はhash routing、Service Workerは配信サブディレクトリを基準にします。静的ホストの「最新版を開く」は同一パスの新しいURLへ遷移し、GitHubログインを要求しません。Cloudflareでは従来の/auth/refreshを使います。

## GitHubだけで作業する方法

Codespaces: Code → Codespaces → Create。npm ciは自動実行。ターミナルでnpm run dev、Portsの5173からプレビュー。ポートはPrivateに維持してください。iPadもブラウザから操作可能ですが実機未検証です。Codespaces/Actionsの無料利用枠を超えて課金する設定は追加しません。

ActionsのValidate DUOはPR・手動実行でテスト、ビルド、認証とオフライン・ブラウザ試験を実行。Pages用workflowはmainへのpushで自動実行し、手動再配信にも対応します。distだけを公開し、Privateリポジトリのチェックアウトは行いません。

## 公開済みの状態

ユーザーの承認と設定操作後、PR #1をmainへ反映しました。DUOはPublic、DUO-DataはPrivateです。PagesはGitHub Actionsで配信し、実際の公開URLでHTTP 200、v0.3.0、ブランド表記なし、オフライン起動をChromiumで確認しました。

- アプリ: https://8b4z5nr6nt-wq.github.io/DUO/
- アプリ公開成功: https://github.com/8b4z5nr6nt-wq/DUO/actions/runs/42160014019
- Private検証成功: https://github.com/8b4z5nr6nt-wq/DUO-Data/actions/runs/42160062915
- 教材の置き場所: DUO-Dataのdata/sections/。現在は空のempty.jsonのみです。

## 端末のデータ移行

1. 旧サイトを普段使っているブラウザで開き、「データ」→「JSONバックアップを保存」を押します。問題・回答履歴・復習記録・設定をまとめて保存します。
2. 新しいPagesのURLを同じ端末で開きます。別オリジンなので旧サイトのIndexedDBは自動共有されません。
3. 「データ」→「バックアップを選択」で保存したJSONを選び、「追加統合」→「復元前に確認」→「この内容で復元」を押します。
4. 問題数・履歴・設定を確認します。「オフライン準備完了」後に機内モードで開けることを確認し、ホーム画面へ追加します。
5. 新しい教材はPrivateのDUO-Dataから端末の「ファイル」へ保存し、「教材JSONの手動インポート」で追加・更新します。教材JSONと全データバックアップは別の入力欄です。

端末のデータはこの作業環境から参照できないため、バックアップと復元は利用者による操作が必要です。旧サイト・旧データを削除する必要はありません。ホーム画面のアプリ名は空白用文字に設定しましたが、iOS実機での表示は未確認です。

## 今後の更新

Codespacesで作業ブランチを作り、変更をPRにまとめます。Validate DUOが単体・ブラウザ・認証・PWAの検証を行います。マージ後はDeploy GitHub Pagesがmainで単体テスト・ビルド・Pages相当のオフライン検証を実行してdistだけを公開します。手動再配信もActionsから実行できます。Private教材はこのビルドへ取り込みません。

Cloudflareの既存サイトも維持しています。main更新時のCloudflare自動配信は引き続き動作しますが、Pagesの開発・検証・配信・利用には不要です。Cloudflare側の自動配信停止・サイト廃止はこの変更の対象外です。

## 維持する機能・未確認

双方向学習、手入力、スクリブル・筆跡、4択・カード、語ごとのヒントと速度、時間制限、検索と範囲選択、ランダム・苦手・復習、再挑戦・スキップ・一時停止、表記ゆれとスペル判定、自己採点・3段階評価・差分、履歴・グラフ・セクション集計・目標・お気に入り、バックアップ、オフライン、キーボード、日本語UIは既存コードを維持します。現行UIは緑青のガラス風です。OSのダーク設定では黒基調で表示する対応を追加します。
Safari/iPhone/iPad/Apple Pencil/ホーム画面の実機確認は未確認です。公開Pages上の表示・オフライン起動はChromiumで確認済みです。
