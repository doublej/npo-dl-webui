// Standardized JSON response helpers
export function sendOk(res, data = {}, statusCode = 200) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify({ success: true, data }));
}

export function sendFail(res, message, statusCode = 400, extra = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify({ success: false, error: message, ...extra }));
}

