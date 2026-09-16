# sb3git — Scratch (.sb3) 用バージョン管理ツール

Scratch プロジェクト (.sb3) を Git ライクに管理します。  
[parse-sb3-blocks](https://github.com/apple502j/parse-sb3-blocks) でブロックを scratchblocks テキストに変換し、
人間が読めるコミット差分を実現します。

## インストール

```bash
npm install
npm link   # グローバルに sb3git コマンドを登録
```

または直接実行:

```bash
node bin/sb3git.js <command>
```

## 使い方

### 初期化

```bash
sb3git init myproject.sb3
```

`.sb3git/` ディレクトリを作成し、初回コミットを行います。

---

### 状態確認

```bash
sb3git status
```

最新コミットと現在の .sb3 の差分を確認します。

---

### コミット

```bash
sb3git commit -m "ジャンプ機能を追加"
```

変更がある場合のみコミットされます (空コミット防止)。

---

### ログ

```bash
sb3git log          # 最新10件
sb3git log -n 5     # 最新5件
sb3git log --oneline
```

---

### 差分表示 (scratchblocks 形式)

```bash
sb3git diff                    # 作業ファイル vs HEAD
sb3git diff HEAD~2             # HEAD~2 vs HEAD
sb3git diff HEAD~3 HEAD~1      # 特定コミット間
sb3git diff abc1234 def5678    # ハッシュ指定
```

変更されたブロックが `+`/`-` で表示されます:

```
@@@ Sprite1 @@@
  when green flag clicked
-   move (10) steps
+   move (20) steps
    forever
      if <touching [edge v]?> then
        turn right (180) degrees
      end
    end
```

---

### コミットの詳細表示

```bash
sb3git show          # HEAD
sb3git show abc1234  # 特定コミット
```

---

### 復元 (checkout)

```bash
sb3git checkout abc1234   # コミットハッシュ (7文字以上)
sb3git checkout HEAD~3    # 相対指定
sb3git checkout main      # ブランチ名
```

> ⚠️ 作業中の変更は上書きされます。事前に `commit` を忘れずに。

---

### ブランチ

```bash
sb3git branch              # 一覧
sb3git branch feature-v2   # 作成
sb3git branch -d old-test  # 削除
sb3git switch feature-v2   # 切り替え
```

---

### 追跡ファイルの変更

```bash
sb3git track newname.sb3
```

---

## ディレクトリ構造

```
.sb3git/
├── HEAD                    現在のブランチ参照
├── config.json             追跡ファイルパス
├── refs/heads/
│   ├── main
│   └── feature-v2
├── commits/
│   └── <sha1>.json         コミットオブジェクト (project.json 内包)
└── assets/
    └── <md5ext>            コスチューム・サウンド (重複排除)
```

## 差分の対象

| カテゴリ       | 内容                               |
|----------------|------------------------------------|
| ブロック       | scratchblocks テキスト行単位の差分 |
| 変数・リスト   | 追加/削除を表示                    |
| コスチューム   | 追加/削除を表示                    |
| サウンド       | 追加/削除を表示                    |
| スプライト     | 追加/削除を表示                    |

## 依存ライブラリ

| パッケージ         | 用途                        |
|--------------------|-----------------------------|
| parse-sb3-blocks   | ブロック → scratchblocks 変換 |
| jszip              | .sb3 (ZIP) の読み書き        |
| diff               | テキスト行単位差分           |
| chalk              | ターミナル色付き出力         |
| commander          | CLI フレームワーク           |
