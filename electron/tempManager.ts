import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type { CropSpec } from './crop';

export type ImageOrigin = 'capture' | 'pdf' | 'image';

export interface PageSize {
  width: number;
  height: number;
}

export interface ScreenshotItem {
  id: string;
  name: string;
  indexNumber: number;
  filePath: string;
  dataUrl?: string;
  width: number;
  height: number;
  timestamp: number;
  sizeBytes: number;
  crop: CropSpec | null;
  origin: ImageOrigin;
  pageSize?: PageSize;
}

export interface NewImageInput {
  buffer: Buffer;
  width: number;
  height: number;
  name: string;
  origin: ImageOrigin;
  pageSize?: PageSize;
}

class TempManager {
  private sessionDir: string = '';
  private items: ScreenshotItem[] = [];
  private nextIndex: number = 1;

  public init(): void {
    const tempBase = app.getPath('temp');
    this.sessionDir = path.join(tempBase, `screenshot-tool-${Date.now()}`);
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  public getSessionDir(): string {
    return this.sessionDir;
  }

  public getItems(): ScreenshotItem[] {
    return [...this.items];
  }

  public addScreenshot(buffer: Buffer, width: number, height: number): ScreenshotItem {
    const indexNumber = this.nextIndex++;
    const formattedName = `${String(indexNumber).padStart(4, '0')}.png`;
    const filePath = path.join(this.sessionDir, formattedName);

    fs.writeFileSync(filePath, buffer);
    const stats = fs.statSync(filePath);
    const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;

    const item: ScreenshotItem = {
      id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: formattedName,
      indexNumber,
      filePath,
      dataUrl,
      width,
      height,
      timestamp: Date.now(),
      sizeBytes: stats.size,
      crop: null,
      origin: 'capture',
    };

    this.items.push(item);
    return item;
  }

  public insertImages(inputs: NewImageInput[], afterId: string | null): ScreenshotItem[] {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new Error('No slides to insert.');
    }

    let insertAt = this.items.length;
    if (afterId !== null) {
      const targetIndex = this.items.findIndex(item => item.id === afterId);
      if (targetIndex === -1) throw new Error('The selected slide no longer exists.');
      insertAt = targetIndex + 1;
    }

    const prepared: ScreenshotItem[] = [];
    try {
      for (const input of inputs) {
        if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
          throw new Error('An inserted slide has no image data.');
        }
        if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width <= 0 || input.height <= 0) {
          throw new Error('An inserted slide has invalid dimensions.');
        }
        if (input.pageSize && (
          !Number.isFinite(input.pageSize.width) || !Number.isFinite(input.pageSize.height) ||
          input.pageSize.width <= 0 || input.pageSize.height <= 0
        )) {
          throw new Error('An inserted slide has an invalid page size.');
        }

        const indexNumber = this.nextIndex++;
        const formattedName = `${String(indexNumber).padStart(4, '0')}.png`;
        const filePath = path.join(this.sessionDir, formattedName);

        fs.writeFileSync(filePath, input.buffer);
        const stats = fs.statSync(filePath);

        prepared.push({
          id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: this.uniqueName(input.name, prepared),
          indexNumber,
          filePath,
          dataUrl: `data:image/png;base64,${input.buffer.toString('base64')}`,
          width: input.width,
          height: input.height,
          timestamp: Date.now(),
          sizeBytes: stats.size,
          crop: null,
          origin: input.origin,
          ...(input.pageSize ? { pageSize: { ...input.pageSize } } : {}),
        });
      }
    } catch (error) {
      for (const item of prepared) {
        try {
          fs.unlinkSync(item.filePath);
        } catch {}
      }
      throw error;
    }

    this.items.splice(insertAt, 0, ...prepared);
    return prepared;
  }

  private uniqueName(desired: string, pending: ScreenshotItem[] = []): string {
    const used = new Set([...this.items, ...pending].map(item => item.name));
    const clean = desired.trim() || 'slide.png';
    if (!used.has(clean)) return clean;
    const extension = path.extname(clean);
    const base = extension ? clean.slice(0, -extension.length) : clean;
    for (let suffix = 2; suffix < 100000; suffix++) {
      const candidate = `${base} (${suffix})${extension}`;
      if (!used.has(candidate)) return candidate;
    }
    return `${base} (${Date.now()})${extension}`;
  }

  public setCrop(id: string, crop: CropSpec | null): ScreenshotItem | null {
    const index = this.items.findIndex(item => item.id === id);
    if (index === -1) return null;
    const item = {
      ...this.items[index],
      crop: crop === null ? null : { ...crop, rect: { ...crop.rect } },
    };
    this.items[index] = item;
    return item;
  }

  public removeLast(): ScreenshotItem | null {
    if (this.items.length === 0) return null;
    const item = this.items.pop()!;
    if (fs.existsSync(item.filePath)) {
      try {
        fs.unlinkSync(item.filePath);
      } catch (err) {
        console.error('Error deleting temp screenshot file:', err);
      }
    }
    return item;
  }

  public removeById(id: string): boolean {
    const idx = this.items.findIndex(item => item.id === id);
    if (idx === -1) return false;

    const item = this.items[idx];
    if (fs.existsSync(item.filePath)) {
      try {
        fs.unlinkSync(item.filePath);
      } catch (err) {
        console.error('Error deleting file:', err);
      }
    }

    this.items.splice(idx, 1);
    return true;
  }

  public reorder(orderedIds: string[]): ScreenshotItem[] {
    const itemMap = new Map(this.items.map(item => [item.id, item]));
    const reordered: ScreenshotItem[] = [];

    for (const id of orderedIds) {
      const item = itemMap.get(id);
      if (item) {
        reordered.push(item);
      }
    }

    // Append any missing items if any
    for (const item of this.items) {
      if (!reordered.some(i => i.id === item.id)) {
        reordered.push(item);
      }
    }

    this.items = reordered;
    return [...this.items];
  }

  public clearAll(): void {
    for (const item of this.items) {
      if (fs.existsSync(item.filePath)) {
        try {
          fs.unlinkSync(item.filePath);
        } catch (err) {
          console.error('Error deleting file:', err);
        }
      }
    }
    this.items = [];
    this.nextIndex = 1;
  }

  public cleanUpSession(): void {
    this.clearAll();
    if (this.sessionDir && fs.existsSync(this.sessionDir)) {
      try {
        fs.rmSync(this.sessionDir, { recursive: true, force: true });
      } catch (err) {
        console.error('Error removing session directory:', err);
      }
    }
  }
}

export const tempManager = new TempManager();
