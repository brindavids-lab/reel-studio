import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const JOBS_DIR = process.env.REEL_JOBS_DIR ? path.resolve(process.env.REEL_JOBS_DIR) : path.join(ROOT, 'jobs');
export const FONTS_DIR = path.join(ROOT, 'fonts');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const STYLES_FILE = path.join(ROOT, 'config', 'styles.json');
export const FONTS_FILE = path.join(ROOT, 'config', 'fonts.json');
