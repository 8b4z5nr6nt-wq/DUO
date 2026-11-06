# DUO-Data（Private専用）
このディレクトリの中身をPrivateの `8b4z5nr6nt-wq/DUO-Data` のルートに配置します。
`data/sections/` にセクションごとのJSONを管理します。empty.jsonは教材を含みません。
仕様はDUOの docs/materials.md と schemas/materials.schema.json を参照してください。
実教材はここだけに置き、DUO側・Issue・公開Actionsログには貼り付けません。
検証workflowはDUOをPublicにし、実装をmainへマージした後に使います。
PrivateデータはPrivate Actionsの実行環境でのみ検証され、アップロードや成果物公開は行いません。
端末ではGitHubのRaw/Downloadからファイルへ保存し、アプリのデータ管理で手動インポートします。
