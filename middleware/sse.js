'use strict';

/**
 * SSE レスポンスを初期化し、切断に強い send 関数を返す (D-14)。
 * クライアント切断後の res.write は例外を投げるため try/catch で握りつぶす。
 * （従来 routes/api.js の send は未保護で、切断時にハンドラがクラッシュし得た）
 * routes/api.js と routes/api-adventure.js で重複していたヘッダ設定も集約する。
 *
 * 注: error イベントのデータ形状（api.js は { message }, api-adventure.js は { error }）は
 * 各呼び出し側が渡す。フィールド名の統一は受信側 view の JS 変更を伴うため別途対応。
 * @param {import('express').Response} res
 * @returns {{ send: (event: string, data: any) => void }}
 */
function initSse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch { /* client disconnected */ }
  };

  return { send };
}

module.exports = { initSse };
