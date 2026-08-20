import path from 'path';
import fs from 'fs';
import { app } from 'electron';

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
    };

    this.items.push(item);
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
