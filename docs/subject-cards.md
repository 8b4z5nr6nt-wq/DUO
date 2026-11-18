# 国語・歴史総合のカード教材

科目選択で「国」または「歴」を開き、「JSONを取り込む」からファイルを選びます。貼り付けもできます。内容を確認して登録し、科目のホームからカード学習を始めます。取り込み画面の「JSONのひな形」から入力用のファイルを保存できます。

国語は `subject` を `ja` にします。各カードの `deck` は現代文単語なら `modern`、古文単語なら `classical` です。

```json
{
  "format": "subject-cards",
  "version": 1,
  "subject": "ja",
  "cards": [
    { "deck": "modern", "number": 1, "question": "現代文の見出し語", "answer": "意味を入力" },
    { "deck": "classical", "number": 1, "question": "古文の見出し語", "answer": "意味を入力" }
  ]
}
```

歴史総合は `subject` を `history` にします。`deck` は省略できます。

```json
{
  "format": "subject-cards",
  "version": 1,
  "subject": "history",
  "cards": [
    { "number": 1, "question": "出来事についての問い", "answer": "答えを入力" }
  ]
}
```

`number` は1以上の整数、`question` と `answer` は空欄にできません。分類と番号が両方同じカードは更新され、評価は引き継がれます。1ファイル10MB、1科目10,000枚まで取り込めます。

カードをめくり、ボタンか左右スワイプで評価します。右は「覚えた」、左は「覚えていない」です。評価と教材は科目別に端末へ保存されます。オフライン準備完了後は通信なしで使えます。取り込んだ元のJSONは保管しておくと、別の端末でも教材を登録できます。
