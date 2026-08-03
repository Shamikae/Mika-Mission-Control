// lib/hyperframes/hyperframesErrors.js
// Maps the fixed set of error codes thrown by hyperframesSecurity /
// hyperframesRunner into honest HTTP status codes for API routes.

const STATUS_BY_CODE = {
  invalid_id: 400,
  not_found: 404,
  symlink_rejected: 403,
  not_a_directory: 400,
  traversal_rejected: 403,
  invalid_path: 400,
  no_output: 409,
  render_in_progress: 409,
};

export function statusForError(err) {
  return STATUS_BY_CODE[err?.code] || 500;
}
