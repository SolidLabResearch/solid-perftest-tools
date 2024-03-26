import { readdir } from "node:fs/promises";
import path from "path";
import fs from "fs/promises";
import { PathLike } from "node:fs";

interface FileInfo {
  name: string;
  fullPath: string;
  pathFromBase: string;
}
interface DirInfo {
  name: string;
  fullPath: string;
  pathFromBase: string;
}

interface DirListing {
  dirPath: string;
  files: FileInfo[];
  dirs: DirInfo[];
}

export function localPathToUrlPath(localPath: string): string {
  return localPath
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
}

export async function makeDirListing(
  dirPath: string,
  recursive: boolean
): Promise<DirListing> {
  const res: DirListing = { dirPath, files: [], dirs: [] };
  const dirsToProcess = [dirPath];
  while (dirsToProcess.length > 0) {
    const curDir: string = <string>dirsToProcess.shift();
    const dirEnts = await readdir(curDir, { withFileTypes: true });
    for (const dirEnt of dirEnts) {
      const fullPath = path.join(curDir, dirEnt.name);
      console.assert(
        fullPath.startsWith(dirPath),
        `makeDirListing fullPath dirPath mismatch`,
        fullPath,
        dirPath
      );
      const pathFromBase = fullPath.substring(dirPath.length + 1);
      if (dirEnt.isDirectory()) {
        res.dirs.push({
          name: dirEnt.name,
          fullPath,
          pathFromBase,
        });

        if (recursive) {
          dirsToProcess.push(fullPath);
        }
      } else {
        res.files.push({
          name: dirEnt.name,
          fullPath,
          pathFromBase,
        });
      }
    }
  }
  return res;
}

export async function fileExists(path: PathLike): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function dirExists(path: PathLike): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory();
  } catch {
    return false;
  }
}
