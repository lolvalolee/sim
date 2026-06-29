// Єдина формула маржі сесії: order_progress − order_charges
const db = require('../db');

function computeSessionProfit(sessionId) {
  const profitData = db.prepare(`
    SELECT
      SUM(COALESCE(client_freight,0)) AS revenue,
      SUM(COALESCE(carrier_freight,0)) AS carrier_paid,
      SUM(COALESCE(simple_paid_by_student,0)) AS simples_self,
      SUM(COALESCE(simple_paid_by_client,0)) AS simples_client
    FROM order_progress WHERE session_id=?
  `).get(sessionId);

  const charges = db.prepare(`
    SELECT COALESCE(SUM(amount),0) AS total FROM order_charges WHERE session_id=?
  `).get(sessionId);

  const revenue = profitData?.revenue || 0;
  const carrier_paid = profitData?.carrier_paid || 0;
  const simples_self = profitData?.simples_self || 0;
  const simples_client = profitData?.simples_client || 0;
  const charges_total = charges?.total || 0;
  const net = revenue - carrier_paid - simples_self - charges_total;

  return { revenue, carrier_paid, simples_self, simples_client, charges_total, net };
}

function recomputeAndStore(sessionId) {
  const p = computeSessionProfit(sessionId);
  db.prepare('UPDATE sessions SET profit=? WHERE id=?').run(p.net, sessionId);
  return p;
}

module.exports = { computeSessionProfit, recomputeAndStore };
