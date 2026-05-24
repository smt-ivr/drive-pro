export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    }
  });
}

export function errorResponse(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    }
  });
}

export function handleCors() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }
  });
}

// מחולל מזהה אקראי למניעת חסימות Rate Limit של גוגל
export function generateUserKey() {
  return `user_${Math.random().toString(36).substring(2)}_${Date.now()}`;
}
