'use strict';

/**
 * 正答率（%）を整数で返す。progressService / rankingService に散在していた
 * `Math.round((correct / total) * 100)` を集約し、丸め方針を一箇所に固定する。
 * total が 0 以下のときは whenEmpty を返す（呼び出し側により 0 または null）。
 * @param {number} correct
 * @param {number} total
 * @param {number|null} [whenEmpty=0]
 * @returns {number|null}
 */
function percentRate(correct, total, whenEmpty = 0) {
  return total > 0 ? Math.round((correct / total) * 100) : whenEmpty;
}

module.exports = { percentRate };
