# 統合テスト手順

openclaw-compatible-channels 機能の手動テスト手順です。

## 前提条件

1. 依存関係をインストール済み：`npm install`  
2. API Key を設定済み（設定画面）  
3. アプリ起動済み：`npm run dev`

## テストシナリオ

### シナリオ 1: スケジュールタスク完了がチャットに通知される

**目的：** スケジュールタスク完了後、通知がチャットに表示されることを確認する。

**手順：**

1. アプリを起動する。  
   ```bash
   npm run dev
   ```

2. ブラウザの開発者ツールで Console を開く。

3. WebSocket 接続を確認する。  
   ```
   期待ログ例：[WebSocket] 接続成功
   ```

4. スケジュールタスクを作成する（cron ツールなど）。  
   ```typescript
   const result = cronManager.createTask('*/1 * * * *', '現在時刻を出力'); // 毎分
   console.log(result);
   ```

5. 実行を待つ（1 分以内）。

6. チャットに通知が出ることを確認する。  
   ```
   期待：
   - タスク完了通知メッセージ
   - タスク ID、状態、所要時間などの情報を含む
   ```

**期待結果：**

- WebSocket 接続成功  
- タスク実行完了  
- チャットに通知表示  
- 通知に必要な情報が含まれる  

---

### シナリオ 2: バックグラウンドタスク完了がチャットに通知される

**目的：** スケジュール以外のバックグラウンドタスク完了でもチャットに通知されることを確認する。

**手順：**

1. チャットにタスクを入力する。  
   ```
   Hello World プログラムを生成して
   ```

2. 送信し、実行完了を待つ。

3. チャットにタスク完了通知が出ることを確認する。

**期待結果：**

- タスク実行完了  
- チャットに通知  
- 通知に結果が含まれる  

---

### シナリオ 3: チャットからエンジンへコマンド送信

**目的：** チャットから送ったコマンドがエンジン側で受信されることを確認する。

**手順：**

1. 開発者ツールの Console を開く。

2. テストコマンドを送る。  
   ```javascript
   window.wsClient.sendCommand('test-command', { param: 'value' });
   ```

3. サーバーログでコマンド受信を確認する。

**期待結果：**

- コマンド送信成功  
- サーバがコマンドを受信  
- EventBridge で command イベントが発火  

---

### シナリオ 4: WebSocket の自動再接続

**目的：** WebSocket 切断後に自動再接続することを確認する。

**手順：**

1. アプリを起動し、WebSocket 接続成功を確認する。

2. バックエンドを停止する（切断のシミュレーション）。  
   ```bash
   # アプリを停止
   ```

3. ブラウザの Console を観察する。  
   ```
   期待：[WebSocket] 接続が閉じた
   期待：[WebSocket] N 秒後に M 回目の再接続を試行
   ```

4. バックエンドを再起動する。

5. 自動再接続成功を確認する。  
   ```
   期待：[WebSocket] 接続成功
   ```

**期待結果：**

- 切断を検知  
- 自動で再接続を試行  
- 再接続に成功  

---

### シナリオ 5: 複数クライアント接続

**目的：** 複数のブラウザタブが同時に接続できることを確認する。

**手順：**

1. 最初のタブでアプリを開く。

2. 2 つ目のタブでもアプリを開く。

3. いずれかのタブでタスク完了を発火する。

4. 両タブで通知を受信することを確認する。

**期待結果：**

- 両クライアントが接続成功  
- 両方とも通知を受信  
- サーバログにクライアント 2 接続が表示  

---

### シナリオ 6: OpenClaw Feishu プラグイン統合（Feishu 資格情報が必要）

**目的：** Feishu プラグインがメッセージの送受信できることを確認する。

**前提：**

- OpenClaw Feishu プラグインをインストール済み  
- Feishu の appId / appSecret を設定済み  

**手順：**

1. Feishu プラグインを読み込む。  
   ```typescript
   import { createOpenClawAdapter } from './channels/openclaw-adapter/adapter';
   import feishuPlugin from '@openclaw/feishu-plugin';
   
   const adapter = createOpenClawAdapter(feishuPlugin, 'feishu');
   channelRegistry.register(adapter);
   await adapter.setup.initialize();
   ```

2. Feishu の資格情報を設定する。  
   ```typescript
   adapter.config.set('appId', 'your-app-id');
   adapter.config.set('appSecret', 'your-app-secret');
   ```

3. タスク完了を発火する。

4. Feishu に通知メッセージが届くことを確認する。

5. Feishu からメッセージを送る。

6. アプリ側でメッセージを受信することを確認する。

**期待結果：**

- Feishu プラグインの読み込み成功  
- タスク通知が Feishu に届く  
- Feishu のメッセージがアプリに転送される  

---

## 単体テスト

```bash
npm test
```

カバー範囲の例：

- EventBridge の送受信と購読  
- WebUIChannelPlugin の基本機能  
- 設定管理  
- 状態チェック  

---

## トラブルシューティング

### WebSocket 接続失敗

**症状：** ブラウザ Console に接続エラー。

**確認：**

1. バックエンドが起動しているか  
2. ポート 8080 が占有されていないか  
3. ファイアウォールが接続を妨げていないか  

**対処：**

```bash
# ポート占有の確認
lsof -i :8080

# 必要ならポート変更
# config/channels.json などで port を変更
```

### タスク通知が表示されない

**症状：** タスクは完了したがチャットに通知がない。

**確認：**

1. WebSocket が接続されているか  
2. EventBridge が正しく呼ばれているか  
3. ブラウザ Console にエラーがないか  

**対処：**

```javascript
console.log(window.wsClient.isConnected()); // true であること

// 手動テスト
eventBridge.notifyTaskComplete('test', { result: 'test' });
```

### Feishu プラグインの読み込み失敗

**症状：** プラグイン初期化でエラー。

**確認：**

1. プラグインが正しくインストールされているか  
2. 設定が揃っているか  
3. Feishu API へネットワーク到達があるか  

**対処：**

```bash
npm install @openclaw/feishu-plugin

# 設定確認
adapter.config.validate(); // true を期待
```

---

## パフォーマンステスト

### メッセージスループット

WebSocket が処理できるメッセージ数の目安：

```javascript
for (let i = 0; i < 1000; i++) {
  eventBridge.notifyTaskComplete(`task-${i}`, { result: i });
}

// 観察：
// - すべて届くか
// - 遅延はないか
// - メモリ使用
```

### 接続の安定性

長時間稼働テスト：

```bash
# アプリを 24 時間起動し続ける
# 観察：
# - WebSocket が維持されるか
# - ハートビートが正常か
# - メモリリークがないか
```

---

## リリース前チェックリスト

- [ ] EventBridge の単体テスト合格  
- [ ] WebUIChannelPlugin の単体テスト合格  
- [ ] スケジュールタスク通知がチャットに届く  
- [ ] バックグラウンドタスク通知がチャットに届く  
- [ ] チャットからエンジンへコマンド送信  
- [ ] WebSocket 自動再接続  
- [ ] 複数クライアント接続  
- [ ] Feishu プラグイン統合（利用する場合）  
- [ ] パフォーマンステスト合格  
- [ ] 長時間安定性テスト合格  

---

## 自動化テスト（将来）

例として、E2E のスケッチ：

```typescript
describe('E2E', () => {
  it('スケジュール完了後にチャットへ通知される', async () => {
    // 1. アプリ起動
    // 2. スケジュール作成
    // 3. 実行待ち
    // 4. WebSocket で通知を検証
    // 5. チャット表示を検証
  });
});
```
