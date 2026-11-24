import { badRequest } from '../utils/errors.js';

function format(error) {
  return error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
}

/** Validates and replaces req.body / req.query with the parsed result. */
export function validate(schema, source = 'body') {
  return function validateMiddleware(req, _res, next) {
    const result = schema.safeParse(source === 'body' ? req.body ?? {} : req[source]);
    if (!result.success) {
      const details = format(result.error);
      throw badRequest(details[0] ? `${details[0].field ? `${details[0].field}: ` : ''}${details[0].message}` : 'Invalid request', details);
    }
    if (source === 'query') req.validQuery = result.data;
    else req[source] = result.data;
    next();
  };
}
