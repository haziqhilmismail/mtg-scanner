import type { T } from '../i18n/index.ts';

// The photos among some files (HEIC from an iPhone often has no type).
export const photosOf = (files: FileList | File[]) => Array.from(files).filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));

// A post's name made safe for a file name: no characters a file system
// refuses, one line, at most 80 code points (so no emoji is cut in half).
export function fileSafe(name: string): string {
  const safe = name.replace(/\s+/g, ' ').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '');
  return Array.from(safe).slice(0, 80).join('').trim() || 'Post';
}

// "Friday Post - Photo 07.jpg": a labelled photo's file, numbered by its place
// in the post and padded to the width of the photo count, so the files sort
// in post order.
export const photoFileName = (post: string, n: number, count: number, t: T) =>
  t('photo_file', { post: fileSafe(post), n: String(n).padStart(String(count).length, '0') });
