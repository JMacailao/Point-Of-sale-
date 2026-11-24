export function ok(res, data, meta, status = 200) {
  const body = { data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

export function created(res, data) {
  return ok(res, data, undefined, 201);
}

export function pagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function pageMeta({ page, pageSize }, total) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Escapes LIKE wildcards in user search input. */
export function likePattern(term) {
  return `%${String(term).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
