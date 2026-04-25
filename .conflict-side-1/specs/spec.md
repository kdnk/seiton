# seiton 仕様書

## 1. 概要

`seiton` は、ローカル開発で同時に走る複数の作業コンテキストを、GitButler のブランチ、tmux セッション、Kitty タブを単位として整理する Electron アプリである。

初期バージョンでは、以下の4要素を前提として扱う。

- GitButler: 作業ブランチとスタックの管理
- tmux: 実際の作業プロセスと pane の管理
- Kitty: GUI ターミナル上のタブ表示とフォーカス制御
- Electron: 管理 UI と外部コマンド実行のホスト

さらに、tmux 内で動作する Codex / Claude からの通知を集約し、UI から該当作業コンテキストへ戻れるようにする。

## 2. 目的

### 2.1 解決したい問題

複数ブランチ・複数エージェントを並行して扱うと、次の問題が起きる。

- どの Kitty タブがどのブランチに対応しているか分からなくなる
- tmux セッションや pane が増え、通知元の作業場所に戻りにくい
- GitButler 上の作業単位と、実際のターミナル作業単位がずれる
- エージェントの完了通知や確認依頼が複数箇所に散らばる

`seiton` は、GitButler の作業ブランチを中心に tmux と Kitty を対応付け、通知から即座に該当 pane へフォーカスできる状態を作る。

### 2.2 成功条件

MVP の成功条件は以下とする。

- GitButler のブランチ一覧から Managed な作業コンテキストを復元できる
- Managed branch ごとに tmux session と Kitty tab を作成できる
- Electron app または GitButler で変更した branch 名を、Sync により tmux session と Kitty tab へ反映できる
- Electron app で変更した Context の並び順を、Sync により Kitty tab の並び順へ反映できる
- tmux pane から送られた通知を `pane_id` 付きで一覧表示できる
- 通知を選択すると、該当 Kitty tab と tmux pane にフォーカスできる
- Unmanaged な tmux session / Kitty tab を破壊・変更しない

## 3. MVP スコープ

### 3.1 対象

- GitButler のブランチ一覧取得
- tmux session / pane の一覧取得
- Kitty tab の一覧取得
- Managed branch の起動
- 手動 Sync による差分 reconcile
- Electron app / GitButler branch rename の検出・反映
- Electron app 上の drag & drop による Context 並び替え
- Registry の並び順から Kitty tab 並び順への反映
- Codex / Claude の hook による通知・状態更新
- 明示的な `notify` コマンドによる手動通知送信
- 通知一覧 UI
- 通知または session 選択からのフォーカス遷移

### 3.2 非対象

MVP では以下を実装しない。

- GitButler stack の高度な可視化
- stdout 監視による自動通知取得
- 自動 Sync
- Codex / Claude 以外の coding agent 対応
- Kitty 以外のターミナル対応
- tmux 以外の terminal multiplexer 対応
- リモート開発環境対応
- 複数 Kitty window をまたいだ完全なタブ管理
- tmux / Kitty 側でユーザーが直接 rename する運用

## 4. 用語定義

| 用語 | 意味 |
| --- | --- |
| Managed | `seiton` が作成・同期・フォーカス対象として扱う作業コンテキスト |
| Unmanaged | ユーザーが自由に使う領域。`seiton` は変更しない |
| Branch | GitButler 上の作業ブランチ |
| Project root | `seiton` が管理対象とする repository / directory の root |
| Session | tmux session |
| Pane | tmux pane |
| Tab | Kitty tab |
| SoT | Source of Truth。状態判断の基準 |
| `pane_id` | tmux が付与する一意な pane 識別子。例: `%12` |
| Registry | `seiton` が保持する Managed context の永続対応表 |

## 5. 基本設計

### 5.1 Source of Truth

MVP では GitButler branch を作業コンテキストの SoT とする。

理由は以下。

- ユーザーが作業単位として意識するのは branch である
- GitButler が branch / stack / uncommitted changes を管理する
- tmux session と Kitty tab は branch に付随する実行環境である

ただし、通知のフォーカス先は `pane_id` を優先する。branch 名や session 名は人間向けの表示名として使い、pane の厳密な特定には使わない。

### 5.2 管理単位

Managed な作業コンテキストは次の関係を持つ。

```text
GitButler branch
  └─ tmux session
       └─ tmux pane(s)
  └─ Kitty tab
       └─ tmux attach
```

MVP では、1 branch に対して 1 tmux session と 1 Kitty tab を対応させる。

### 5.3 Electron アプリ構成

Electron は main process と renderer process に分ける。

```text
Renderer UI
  └─ IPC
       └─ Main process
            ├─ GitButler CLI
            ├─ tmux CLI
            └─ Kitty remote control
```

renderer は shell command を直接実行しない。GitButler / tmux / Kitty へのアクセスは main process に集約する。

main process は Context / Notification の状態を組み立て、renderer へ IPC で渡す。

### 5.4 命名規則

Managed リソースは `seiton__` prefix、project key、branch key を使う。

branch key は GitButler branch 名を URL encode した文字列とする。これにより、`feature/foo` のような branch 名を tmux session 名として安全に扱える。
project key は project root を URL encode した文字列とする。これにより、別 directory の同名 branch が衝突しない。

```text
tmux session: seiton__<project_key>__<branch_key>
Kitty tab:    seiton__<project_key>__<branch_key>
```

例:

```text
branch:       feature/notify-ui
project key:  %2FUsers%2Fkodai%2Fworkspaces%2Fgithub.com%2Fkdnk%2Fseiton
branch key:   feature%2Fnotify-ui
tmux session: seiton__%2FUsers%2Fkodai%2Fworkspaces%2Fgithub.com%2Fkdnk%2Fseiton__feature%2Fnotify-ui
Kitty tab:    seiton__%2FUsers%2Fkodai%2Fworkspaces%2Fgithub.com%2Fkdnk%2Fseiton__feature%2Fnotify-ui
```

`dev:` や prefix なしの tmux session / Kitty tab は Unmanaged として扱う。

## 6. データモデル

### 6.1 Registry

Registry は Electron app の user data directory 配下に保存する。

```text
<appData>/seiton/registry.json
```

Registry は project directory 一覧と Managed context の対応関係を保持し、rename 検出に使う。

Registry は Electron app 全体で1つ持つが、context は `project_root` ごとに分離する。同じ branch 名でも project root が異なれば別 context として扱う。

```json
{
  "projects": [
    {
      "root": "/Users/kodai/workspaces/github.com/kdnk/seiton",
      "name": "seiton",
      "project_key": "%2FUsers%2Fkodai%2Fworkspaces%2Fgithub.com%2Fkdnk%2Fseiton",
      "order": 10,
      "enabled": true,
      "created_at": "2026-04-24T10:00:00+09:00",
      "updated_at": "2026-04-24T10:00:00+09:00"
    }
  ],
  "contexts": [
    {
      "id": "uuid",
      "project_root": "/Users/kodai/workspaces/github.com/kdnk/seiton",
      "branch": "feature/notify-ui",
      "branch_key": "feature%2Fnotify-ui",
      "tmux_session": "seiton__<project_key>__feature%2Fnotify-ui",
      "kitty_tab_title": "seiton__<project_key>__feature%2Fnotify-ui",
      "order": 10,
      "created_at": "2026-04-24T10:00:00+09:00",
      "updated_at": "2026-04-24T10:00:00+09:00"
    }
  ]
}
```

Registry は `seiton` に追加された project と、作成または管理対象として確定した context のみ保存する。Unmanaged な session / tab は保存しない。

### 6.2 Context

```json
{
  "id": "uuid",
  "type": "managed",
  "project_root": "/Users/kodai/workspaces/github.com/kdnk/seiton",
  "branch": "feature/notify-ui",
  "branch_key": "feature%2Fnotify-ui",
  "tmux_session": "seiton__<project_key>__feature%2Fnotify-ui",
  "kitty_tab_title": "seiton__<project_key>__feature%2Fnotify-ui",
  "primary_pane_id": "%12",
  "order": 10,
  "status": "ready"
}
```

### 6.3 Notification

```json
{
  "id": "uuid",
  "pane_id": "%12",
  "tmux_session": "seiton__<project_key>__feature%2Fnotify-ui",
  "branch": "feature/notify-ui",
  "message": "implementation finished",
  "level": "info",
  "created_at": "2026-04-24T10:00:00+09:00",
  "acknowledged": false
}
```

### 6.4 状態値

Context の `status` は以下を持つ。

| status | 意味 |
| --- | --- |
| `ready` | branch / tmux / Kitty が揃っている |
| `missing_tmux` | branch はあるが tmux session がない |
| `missing_kitty` | branch と tmux session はあるが Kitty tab がない |
| `orphan_tmux` | Managed prefix の tmux session があるが branch がない |
| `order_drift` | Registry の並び順と Kitty tab の並び順が一致しない |
| `error` | 起動・同期・フォーカスに失敗した |

## 7. 外部コマンド境界

### 7.1 GitButler

GitButler の状態取得には `but` CLI を使う。

```bash
but status -fv
```

MVP では branch 一覧と現在の作業状態を取得する。Electron app から rename する場合に限り、`seiton` は GitButler branch rename を実行する。branch の作成・削除は行わない。

### 7.2 tmux

session 一覧:

```bash
tmux list-sessions -F '#{session_name}'
```

pane 一覧:

```bash
tmux list-panes -a -F '#{session_name}\t#{window_id}\t#{pane_id}\t#{pane_current_command}'
```

session 作成:

```bash
tmux new-session -d -s "seiton__<project_key>__<branch_key>"
```

pane 特定:

```bash
tmux display-message -p '#{pane_id}'
```

### 7.3 Kitty

Kitty remote control を前提とする。

tab 作成:

```bash
kitty @ launch \
  --type=tab \
  --tab-title "seiton__<project_key>__<branch_key>" \
  sh -c "tmux attach -t 'seiton__<project_key>__<branch_key>'"
```

tab フォーカス:

```bash
kitty @ focus-tab --match "title:seiton__<project_key>__<branch_key>"
```

tab 一覧:

```bash
kitty @ ls
```

tab 並び替え:

Kitty remote control には任意 index へ直接移動する専用 subcommand はない。MVP では tab を focus し、`move_tab_forward` / `move_tab_backward` action を必要回数実行して隣接 swap で並び順を反映する。

```bash
kitty @ focus-tab --match "title:seiton__<project_key>__<branch_key>"
kitty @ action move_tab_forward
kitty @ action move_tab_backward
```

## 8. Sync 設計

### 8.1 方針

Sync は手動トリガーで実行する。

Sync は破壊的操作を行わない。ただし、Registry と GitButler branch 名に基づく tmux session rename と Kitty tab title 更新は、Managed context の正規化として行う。

名前変更の入口は Electron app または GitButler とする。tmux session 名と Kitty tab title は派生状態であり、ユーザーが直接変更する前提にしない。

並び順の入口は Electron app とする。GitButler branch 一覧の順序、tmux session 順、Kitty の現在順は表示・復旧の参考に留め、最終的な Managed Context の順序は Registry の `order` を正とする。

### 8.2 入力

Sync は以下を取得する。

- GitButler branch 一覧
- Project root
- tmux session 一覧
- tmux pane 一覧
- Kitty tab 一覧
- Registry

### 8.3 判定ルール

Managed 判定は prefix で行う。

GitButler branch と Registry context は project root 単位で照合する。現在の Electron app が対象にしている project root と一致しない Registry context は Sync / 表示 / rename / order の対象にしない。

| 対象 | Managed 条件 |
| --- | --- |
| GitButler branch | GitButler が返す branch |
| tmux session | session 名が `seiton__` で始まる |
| Kitty tab | tab title が `seiton__` で始まる |

MVP では tmux metadata は使わない。必要になった場合のみ、将来 `@seiton.managed = true` のような metadata を追加する。

### 8.4 状態マトリクス

| branch | tmux session | Kitty tab | status | action |
| --- | --- | --- | --- | --- |
| あり | あり | あり | `ready` | 何もしない |
| あり | なし | なし | `missing_tmux` | tmux session を作成し、Kitty tab を作成する |
| あり | あり | なし | `missing_kitty` | Kitty tab を作成する |
| あり | なし | あり | `missing_tmux` | tmux session を作成し、Kitty tab は警告表示する |
| なし | あり | あり | `orphan_tmux` | 警告のみ。削除しない |
| なし | あり | なし | `orphan_tmux` | 警告のみ。削除しない |
| なし | なし | あり | Unmanaged | 無視する |
| Registry の branch と GitButler branch が rename 関係 | 旧 session/tab あり | 新 session/tab なし | `rename_pending` | Sync で tmux / Kitty に反映する |
| Registry の branch と GitButler branch が rename 関係 | 新 session/tab が既に存在 | 任意 | `rename_conflict` | UI で確認する |
| Registry order と Kitty tab order が不一致 | tab あり | 任意 | `order_drift` | Sync で Kitty tab を並び替える |

`branch あり / tmux なし / Kitty あり` は、本来 Kitty tab が tmux attach に失敗している可能性がある。MVP では既存 tab を再利用せず、警告を出してユーザー判断に委ねる。

### 8.5 Sync 手順

1. `but status -fv` で branch 一覧を取得する
2. `tmux list-sessions` で session 一覧を取得する
3. `kitty @ ls` で tab 一覧を取得する
4. Registry と branch 一覧を照合し、rename pending / conflict を検出する
5. branch ごとに `seiton__<project_key>__<branch_key>` の session / tab 存在を照合する
6. rename pending は tmux session / Kitty tab / Registry へ反映する
7. rename conflict は UI に表示し、ユーザー判断を待つ
8. 不足している tmux session を作成する
9. 不足している Kitty tab を作成する
10. Registry order と Kitty tab order を比較し、必要なら Kitty tab を並び替える
11. orphan と error を UI に表示する

## 9. Rename 設計

### 9.1 方針

branch rename は MVP から扱う。

名前変更の入口は次の2つとする。

- Electron app 上の rename 操作
- GitButler 上の branch rename

tmux session 名と Kitty tab title は `seiton` が管理する派生状態であり、ユーザーが直接変更する前提にしない。Sync ボタンを押すと、Electron app / GitButler 側の名前が tmux / Kitty に反映される。

Electron app の Registry に残っている pending rename と、現在の GitButler branch 名が衝突する場合は GitButler を優先する。Sync 時点で GitButler が返す branch 名を最終的な正とし、Electron app 側の pending rename は破棄または上書きする。

### 9.2 検出入力

rename 検出は以下を使う。

- Registry に保存された旧 branch / branch key
- 現在の GitButler branch 一覧
- 現在の tmux session 一覧
- 現在の Kitty tab 一覧

GitButler CLI から stable な branch id が取得できる場合は、それを最優先で rename 判定に使う。取得できない場合は Registry と現在の状態から rename pending / conflict を判定する。

### 9.3 Electron app からの rename

Electron app から rename する場合、次の順序で処理する。

1. main process が GitButler branch rename を実行する
2. Registry には旧 branch と新 branch の対応を `rename_pending` として記録する
3. ユーザーが Sync ボタンを押す
4. Sync が tmux session と Kitty tab title を新 branch key へ更新する
5. Registry を新 branch 名で確定する

Electron app は tmux / Kitty だけを rename して GitButler branch 名を変えない操作を提供しない。

Electron app からの rename 実行後、Sync 前に GitButler 側で別名へ変更されていた場合は、GitButler 側の現在名を優先する。Registry に記録された Electron app 由来の `rename_pending` は取り消し、GitButler の現在名に向けた `rename_pending` を再作成する。

### 9.4 GitButler からの rename

GitButler で rename 済みの場合、Sync 時に以下を満たすものを `rename_pending` として扱う。

- Registry に存在する旧 branch が GitButler branch 一覧に存在しない
- 旧 branch key の tmux session または Kitty tab が存在する
- GitButler branch 一覧に Registry 未登録の新 branch が存在する

GitButler から stable branch id が取得できる場合は、同じ id の branch 名変更として確定する。

stable branch id が取得できず、未登録の新 branch が1つだけの場合は `rename_pending` として扱う。未登録の新 branch が複数ある場合は `rename_conflict` として UI で選択を求める。

### 9.5 衝突時の優先順位

rename に関する優先順位は次の通り。

1. GitButler の現在の branch 名
2. Electron app の Registry に記録された `rename_pending`
3. tmux session 名 / Kitty tab title

Electron app と GitButler で rename 先が衝突する場合、Sync は GitButler の現在名を採用する。UI には「GitButler 側の名前を優先して同期した」ことを warning として表示する。

tmux / Kitty の名前が GitButler と衝突する場合も、GitButler を優先して tmux / Kitty を更新する。

### 9.6 Sync 反映処理

Sync が rename を反映する場合、次の順序で処理する。

1. 新 branch 名から新 branch key を作る
2. tmux session を旧 key から新 key へ rename する
3. Kitty tab title を新 key へ変更する
4. Registry の branch / branch_key / tmux_session / kitty_tab_title を更新する
5. Context を `ready` として再評価する

```bash
tmux rename-session -t "seiton__<old_branch_key>" "seiton__<new_branch_key>"
kitty @ set-tab-title "seiton__<new_branch_key>" --match "title:seiton__<old_branch_key>"
```

### 9.7 tmux / Kitty 側 drift の扱い

tmux session 名または Kitty tab title が Registry と一致しない場合は、ユーザーによる直接変更ではなく drift とみなす。

Sync は GitButler branch を最優先の正とし、Registry を補助情報として使う。Managed な tmux session / Kitty tab title が GitButler の現在名と一致しない場合は、正しい名前へ戻す。戻せない場合は warning を表示する。

### 9.8 失敗時挙動

| 失敗 | 扱い |
| --- | --- |
| tmux rename に失敗 | Registry を更新せず、`rename_error` を表示 |
| Kitty title 更新に失敗 | tmux rename 済みとして Registry に記録し、`missing_kitty` 相当の警告を出す |
| 新 branch key の session が既に存在 | 自動反映せず conflict として UI に表示 |
| rename 先候補が複数 | 自動反映せずユーザー選択を待つ |
| Electron app と GitButler の rename 先が衝突 | GitButler を優先し、Electron app 側の pending rename を破棄する |

### 9.9 明示的 rename 解決

UI は rename conflict に対して「この branch として反映」操作を提供する。

これは GitButler 側で rename 済みだが、対応関係の判定が曖昧な場合の手動復旧として使う。

## 10. 起動設計

### 10.1 branch の起動

ユーザーが branch を選択して起動した場合、次の順序で処理する。

1. `seiton__<project_key>__<branch_key>` の tmux session がなければ作成する
2. `seiton__<project_key>__<branch_key>` の Kitty tab がなければ作成する
3. Kitty tab にフォーカスする
4. tmux session / pane にフォーカスする

### 10.2 作業ディレクトリ

MVP では repository root を作業ディレクトリとする。

GitButler が branch ごとに worktree 的な分離を提供する場合でも、`seiton` は GitButler の状態を変更しない。必要な checkout / branch 操作は GitButler 側で行われている前提とする。

## 11. 並び順設計

### 11.1 方針

Electron app の Context 一覧は drag & drop で並び替えられる。

並び順は Registry の `order` に保存する。Sync ボタンを押すと、Registry order を正として Kitty tab の並び順へ反映する。

tmux session の並び順は制御対象にしない。tmux は作業プロセスの保持場所であり、ユーザーが見る並び順は Electron app と Kitty tab を正とする。

### 11.2 Registry order

`order` は数値で保持する。

```json
{
  "branch": "feature/notify-ui",
  "branch_key": "feature%2Fnotify-ui",
  "order": 10
}
```

新規 Context は既存最大 order の後ろに追加する。drag & drop 時は Electron app が対象 Context の order を更新する。

### 11.3 Kitty 反映

Kitty には任意 index へ tab を直接移動する remote command がないため、MVP では隣接 swap で反映する。

処理方針:

1. `kitty @ ls` から Managed tab の現在順を取得する
2. Registry order から期待順を作る
3. 現在順と期待順を比較する
4. 期待位置にない tab を focus する
5. `move_tab_forward` / `move_tab_backward` を必要回数実行する
6. `kitty @ ls` を再取得して確認する

```bash
kitty @ focus-tab --match "title:seiton__<project_key>__<branch_key>"
kitty @ action move_tab_backward
```

### 11.4 制約

MVP では単一 Kitty OS window 内の Managed tab のみ並び替える。

Unmanaged tab をまたぐ並び替えは行わない。Kitty の `move_tab_forward` / `move_tab_backward` は隣接 swap であり、Unmanaged tab をまたぐと Unmanaged tab の位置も変わるためである。

MVP では、Managed tab が同一 OS window 内の連続したブロックにある場合に、そのブロック内の相対順序を Registry order に合わせる。Unmanaged tab が Managed tab の間にある場合は自動並び替えせず、warning を表示する。

複数 Kitty OS window をまたぐ tab 移動は非対象とする。

### 11.5 失敗時挙動

| 失敗 | 扱い |
| --- | --- |
| `move_tab_forward` / `move_tab_backward` が失敗 | `order_drift` として warning 表示 |
| 対象 tab が見つからない | `missing_kitty` として扱う |
| Unmanaged tab が Managed tab の間にある | 自動並び替えせず warning 表示 |
| 複数 OS window に Managed tab が分散 | 自動並び替えせず warning 表示 |

## 12. Agent 通知システム

### 12.1 方針

MVP では Codex と Claude の hook に対応する。

通知・状態管理は `tmux-agent-sidebar` の設計を参考にし、socket を主経路にしない。agent hook が `seiton hook` を呼び、`seiton hook` が tmux pane option を更新する。UI は tmux pane option を定期 polling して状態を表示する。

stdout 監視や Codex / Claude 以外の agent adapter は実装しない。

### 12.2 対応 agent

| agent | 対応 |
| --- | --- |
| Codex | `SessionStart`, `UserPromptSubmit`, `Stop` |
| Claude | `SessionStart`, `UserPromptSubmit`, `Notification`, `Stop`, `StopFailure`, `PostToolUse`, `SessionEnd` |

### 12.3 hook コマンド

Codex / Claude の hook から次の形式で呼び出す。

```bash
seiton hook <agent> <event>
```

例:

```bash
seiton hook codex session-start
seiton hook codex user-prompt-submit
seiton hook codex stop
seiton hook claude notification
seiton hook claude stop-failure
```

`seiton hook` は stdin から agent 固有の JSON payload を読み取り、内部の共通イベントに正規化する。

### 12.4 共通イベント

内部では次のイベントに正規化する。

| event | 意味 |
| --- | --- |
| `session_start` | agent session 開始 |
| `session_end` | agent session 終了 |
| `user_prompt_submit` | ユーザーが prompt を送信 |
| `notification` | agent がユーザー確認を要求 |
| `stop` | agent の turn が正常終了 |
| `stop_failure` | agent の turn が失敗 |
| `activity_log` | tool 実行などの活動ログ |

Codex で未対応のイベントは無視する。未知の agent / event はエラーとして扱う。

### 12.5 tmux pane option

agent の状態は対象 pane の tmux pane option に保存する。

| option | 内容 |
| --- | --- |
| `@seiton_agent` | `codex` または `claude` |
| `@seiton_status` | `running`, `waiting`, `idle`, `error` |
| `@seiton_prompt` | 直近の prompt または要約 |
| `@seiton_attention` | UI で注意表示する理由。例: `notification` |
| `@seiton_wait_reason` | 待機理由。例: `permission`, `stop_failure` |
| `@seiton_started_at` | 現在の task 開始時刻 |
| `@seiton_cwd` | agent の作業ディレクトリ |

UI は `tmux list-panes` で pane option を取得し、Context / Notification 一覧に反映する。

### 12.6 状態遷移

| event | status | attention | 補足 |
| --- | --- | --- | --- |
| `session_start` | `idle` | 空 | agent metadata を初期化 |
| `user_prompt_submit` | `running` | 空 | prompt と開始時刻を保存 |
| `notification` | `waiting` | `notification` | ユーザー対応が必要 |
| `stop` | `idle` | 空 | turn 完了 |
| `stop_failure` | `error` | `notification` | 失敗理由を表示 |
| `session_end` | 空 | 空 | agent metadata を消去 |

### 12.7 Activity log

Claude の `PostToolUse` は `activity_log` として扱う。

MVP では activity log は pane ごとの一時ファイルに追記する。

```text
/tmp/seiton-activity-<pane_id>.log
```

UI は必要に応じてこのファイルを読む。通知一覧の主データは tmux pane option とし、activity log は詳細表示用とする。

### 12.8 手動 notify

agent hook とは別に、手動通知用として次のコマンドを提供する。

```bash
seiton notify "implementation finished"
```

`seiton notify` は現在 pane の `@seiton_status` を `waiting` にし、`@seiton_attention` を `notification` にする。message は `@seiton_prompt` または activity log に保存する。

### 12.9 データフロー

```text
tmux pane
  └─ Codex / Claude hook
       └─ seiton hook <agent> <event>
            └─ tmux pane option 更新
                 └─ UI polling
```

### 12.10 通知保持

MVP では tmux pane option を最新状態の保持場所とする。

通知履歴の永続化は非対象とする。アプリ再起動時に履歴が消えても許容する。

## 13. フォーカス制御

### 13.1 優先順位

フォーカスは次の順序で行う。

1. Kitty tab にフォーカスする
2. tmux session に切り替える
3. tmux pane を選択する

```bash
kitty @ focus-tab --match "title:seiton__<project_key>__<branch_key>"
tmux switch-client -t "seiton__<project_key>__<branch_key>"
tmux select-pane -t "%12"
```

### 13.2 pane_id が有効な場合

通知に `pane_id` があり、現在の tmux に存在する場合は `pane_id` を最優先する。

### 13.3 pane_id が失効している場合

pane が閉じられている場合は、次の順序で fallback する。

1. 同じ tmux session の active pane
2. 同じ branch の Kitty tab
3. UI に `pane no longer exists` と表示

## 14. UI 仕様

### 14.1 必須画面

MVP の UI は Electron renderer として実装し、以下を持つ。

- Context 一覧
- Notification 一覧
- Project root 表示
- Directory 追加ボタン
- 登録済み Directory 一覧と切り替え
- Sync ボタン。GitButler の現在名を優先して tmux / Kitty へ反映する
- Context drag & drop 並び替え
- Start / Focus ボタン
- Rename pending / conflict 表示
- Error / Warning 表示

### 14.2 Context 表示

```text
[ready]         feature/notify-ui
[order_drift]   feature/reorder-tabs
[missing_kitty] feature/sync
[rename]        old-name -> feature/new-name
[conflict]      old-name -> ?
[orphan_tmux]   old-experiment
```

### 14.3 Notification 表示

```text
10:00 feature/notify-ui %12 implementation finished
10:04 feature/sync      %18 needs review
```

通知を選択すると、`pane_id` を使ってフォーカスする。

## 15. エラーハンドリング

### 15.1 基本方針

外部コマンド失敗は握りつぶさない。UI に対象・実行コマンド・要約を表示する。

### 15.2 主な失敗

| 失敗 | 扱い |
| --- | --- |
| `but status -fv` が失敗 | Sync 全体を失敗にする |
| `tmux` が起動していない | tmux 操作を失敗にし、起動案内を表示 |
| tmux session 作成失敗 | Context を `error` にする |
| `kitty @ ls` が失敗 | Kitty remote control 設定エラーとして表示 |
| Kitty tab 作成失敗 | Context を `missing_kitty` のまま警告表示 |
| pane_id が存在しない | fallback して UI に警告表示 |
| rename conflict | GitButler で一意に解決できる場合は GitButler を優先し、それ以外はユーザーに解決を促す |
| Kitty tab 並び替え失敗 | `order_drift` として warning 表示 |

## 16. セキュリティと安全性

MVP ではローカルマシン内でのみ動作する。

- 外部ネットワークには公開しない
- agent 状態は現在ユーザーの tmux pane option にのみ保存する
- shell command 実行は Electron main process に限定する
- `notify` の message は UI 表示時にエスケープする
- Sync は branch / session / tab の削除を行わない
- rename は GitButler の現在 branch 名を最優先の正とし、Sync によって tmux session / Kitty tab title に反映する
- tab order は Registry を正とし、Sync によって Kitty tab の相対順序に反映する

## 17. 将来検討

以下は MVP 後に検討する。

- GitButler stack の視覚化
- tmux metadata による Managed 判定
- 通知の永続化
- Codex / Claude 以外の agent adapter
- stdout / stderr 監視
- 自動 Sync
- 複数 Kitty window 対応
- Unmanaged tab を含めた完全な Kitty tab 並び替え
- worktree / workspace 単位の分離

## 18. 実装順序

推奨する初期実装順序は以下。

1. Electron main / renderer / IPC の最小構成
2. `but status -fv` / `tmux` / `kitty @ ls` の状態取得
3. Registry と Context モデル生成
4. 手動 Sync
5. branch 起動
6. rename pending / conflict 検出と Sync 反映
7. Context drag & drop と Registry order 更新
8. Kitty tab order 同期
9. Kitty / tmux フォーカス
10. `seiton hook` と Codex / Claude adapter
11. tmux pane option からの agent 状態取得
12. 通知一覧 UI
13. `seiton notify`
14. Error / Warning 表示

## 19. コア原則

- 初期実装は `kitty + GitButler + tmux` に特化する
- 作業単位の SoT は GitButler branch とする
- 実行場所の厳密な特定は `pane_id` を使う
- Managed / Unmanaged を prefix で明確に分離する
- Sync は非破壊にする
- rename は最初から扱い、Electron app と GitButler が衝突した場合は GitButler を優先する
- 並び順は Electron app の Registry を正とし、Kitty へ反映する
