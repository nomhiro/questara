'use strict';

/**
 * async ルートハンドラのラッパー (D-13)。
 * Express 4 は async ハンドラが reject しても自動では next(err) しないため、
 * 例外がエラーハンドラ (app.js) に届かずレスポンスが返らないことがある。
 * このラッパーで reject を確実に next() へ流す。レスポンス形式は変えない。
 * @param {(req, res, next) => Promise<any>} fn
 * @returns {(req, res, next) => void}
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
