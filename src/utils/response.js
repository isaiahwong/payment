export function respond(status = 200, data = {}) {
  const response = {
    success: status < 400,
    body: { ...data },
  };

  return response;
}

export function ok(data = {}) {
  const response = {
    success: true,
    body: { ...data },
  };

  return response;
}
