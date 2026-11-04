// Largest file (or batch of files) one upload request may carry.
// Vercel rejects request bodies over ~4.5 MB; must match MAX_UPLOAD_BYTES in backend/app/routes/common.py.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = '4 MB';
