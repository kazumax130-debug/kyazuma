const recent: string[] = [];

/** Web version: WAV bytes become a Blob URL instead of a file. */
export function writeLoopFile(wav: Uint8Array): string {
  const url = URL.createObjectURL(new Blob([wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }));
  recent.push(url);
  while (recent.length > 2) URL.revokeObjectURL(recent.shift()!);
  return url;
}
