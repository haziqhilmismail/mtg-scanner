import { exportAllImages, exportImage, type ExportPayload } from '../../api.ts';
import { downloadBlob } from '../../utils.ts';

// A labelled photo to render: what the server draws, and the file's name.
export interface ExportJob {
  payload: ExportPayload;
  name: string;
}

// Rendered photos by what they were rendered from, so a post shared again,
// or with one photo changed, renders only what changed. The least recently
// used goes first; a post shares at most KEEP photos at once (see usePostExport).
const rendered = new Map<string, File>();
export const KEEP = 30;
export const jobKey = (job: ExportJob) => `${job.name}\n${JSON.stringify(job.payload)}`;

export const renderedFile = (job: ExportJob): File | null => rendered.get(jobKey(job)) ?? null;

export async function renderFile(job: ExportJob): Promise<File> {
  const key = jobKey(job);
  const hit = rendered.get(key);
  // Moved to the end: the most recently used.
  rendered.delete(key);
  const file = hit ?? new File([await exportImage(job.payload)], job.name, { type: 'image/jpeg' });
  rendered.set(key, file);
  if (rendered.size > KEEP) rendered.delete(rendered.keys().next().value!);
  return file;
}

// One photo downloads as its file; several as one zip of them, since
// browsers hold back or ask about a run of downloads.
export async function downloadFiles(jobs: ExportJob[], zipName: string) {
  if (jobs.length === 1) {
    const file = await renderFile(jobs[0]);
    downloadBlob(file, file.name);
    return;
  }
  downloadBlob(await exportAllImages(jobs.map(j => ({ ...j.payload, filename: j.name }))), zipName);
}
