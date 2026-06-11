import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Managed data directory: db + content-addressed originals + avatars + quarantine. */
export class Storage {
  readonly dataDir: string;
  readonly originalsDir: string;
  readonly avatarsDir: string;
  readonly quarantineDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.originalsDir = path.join(dataDir, 'originals');
    this.avatarsDir = path.join(dataDir, 'avatars');
    this.quarantineDir = path.join(dataDir, 'quarantine');
    for (const dir of [this.originalsDir, this.avatarsDir, this.quarantineDir]) {
      mkdirSync(dir, { recursive: true });
    }
  }

  get dbPath(): string {
    return path.join(this.dataDir, 'chartreuse.db');
  }

  /** Stores original bytes content-addressed; idempotent. Returns the path. */
  storeOriginal(fileHash: string, ext: 'png' | 'json', bytes: Buffer): string {
    const dest = path.join(this.originalsDir, `${fileHash}.${ext}`);
    if (!existsSync(dest)) writeFileSync(dest, bytes);
    return dest;
  }

  originalPath(fileHash: string, ext: 'png' | 'json'): string {
    return path.join(this.originalsDir, `${fileHash}.${ext}`);
  }

  /** The character's card PNG doubles as its avatar. */
  storeAvatar(characterId: number, pngBytes: Buffer): string {
    const dest = this.avatarPath(characterId);
    writeFileSync(dest, pngBytes);
    return dest;
  }

  avatarPath(characterId: number): string {
    return path.join(this.avatarsDir, `${characterId}.png`);
  }

  removeAvatar(characterId: number): void {
    rmSync(this.avatarPath(characterId), { force: true });
  }

  /** Copies a malformed file into quarantine; returns the quarantine path. */
  quarantine(sourcePath: string): string {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(
      this.quarantineDir,
      `${ts}_${path.basename(sourcePath)}`,
    );
    copyFileSync(sourcePath, dest);
    return dest;
  }
}
