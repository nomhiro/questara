'use strict';

// cookie `theme` を読み、res.locals.theme に正規化して載せる。
// 値は 'light' | 'dark' | null（未設定）。null のときはクライアント側で
// prefers-color-scheme に従う（views/partials/head.ejs の FOUC スクリプト）。
function themeMiddleware(req, res, next) {
  const t = req.cookies && req.cookies.theme;
  res.locals.theme = (t === 'dark' || t === 'light') ? t : null;
  next();
}

module.exports = { themeMiddleware };
