'use strict';

/**
 * SSE レスポンスを初期化し、切断に強い send 関数を返す (D-14)。
 * クライアント切断後の res.write は例外を投げるため try/catch で握りつぶす。
 * （従来 routes/api.js の send は未保護で、切断時にハンドラがクラッシュし得た）
 * SSE エンドポイントで共通のヘッダ設定もここに集約する。
 *
 * 注: error イベントのデータ形状（api.js は { message }）は各呼び出し側が渡す。
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
