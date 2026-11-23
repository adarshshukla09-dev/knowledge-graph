import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import phash from "sharp-phash";
import phashDistance from "sharp-phash/distance";

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".tiff",
]);

interface ImageEntry {
  filePath: string;
  sha256: string;
  pHash: string;
}

interface DuplicateCluster {
  keep: string;
  duplicates: string[];
}
export interface FindDuplicateOptions {
  maxHammingDistance?: number;
  deleteDuplicates?: boolean;
  moveToFolder?: string | undefined;
}

async function listImageFiles(folderPath: string): Promise<string[]> {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(folderPath, entry.name))
    .filter((filePath) =>
      IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase()),
    )
    .sort((a, b) => a.localeCompare(b));
}

function sha256Buffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function buildClusters(
  filePaths: string[],
  exactDuplicates: string[][],
  nearDuplicatePairs: Array<{ a: string; b: string; distance: number }>,
): DuplicateCluster[] {
  const parent = new Map<string, string>();
  for (const filePath of filePaths) {
    parent.set(filePath, filePath);
  }

  const find = (x: string): string => {
    const p = parent.get(x);
    if (!p || p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };

  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootB, rootA);
    }
  };

  for (const group of exactDuplicates) {
    const first = group[0];
    if (!first) continue;
    for (let i = 1; i < group.length; i++) {
      const item = group[i];
      if (item) union(first, item);
    }
  }

  for (const pair of nearDuplicatePairs) {
    union(pair.a, pair.b);
  }

  const components = new Map<string, string[]>();
  for (const filePath of filePaths) {
    const root = find(filePath);
    const list = components.get(root) ?? [];
    list.push(filePath);
    components.set(root, list);
  }

  const clusters: DuplicateCluster[] = [];
  for (const members of components.values()) {
    if (members.length <= 1) continue;
    members.sort((a, b) => a.localeCompare(b));
    const keep = members[0];
    if (!keep) continue;
    clusters.push({
      keep,
      duplicates: members.slice(1),
    });
  }

  return clusters;
}

export async function findDuplicatePhotos(
  folderPath: string,
  options: FindDuplicateOptions = {},
) {
  const maxHammingDistance = options.maxHammingDistance ?? 5;
  const deleteDuplicates = options.deleteDuplicates ?? false;
  const moveToFolder = options.moveToFolder;

  const startTime = Date.now();
  const resolvedFolder = path.resolve(folderPath);
  console.log(`[findDuplicate] Scanning folder: ${resolvedFolder}`);

  const files = await listImageFiles(resolvedFolder);
  console.log(
    `[findDuplicate] Found ${files.length} image file(s) with supported extensions.`,
  );

  const entries: ImageEntry[] = [];
  let skippedCount = 0;

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    if (!filePath) continue;

    console.log(
      `[findDuplicate] Hashing (${i + 1}/${files.length}): ${path.basename(filePath)}`,
    );
    try {
      const buf = await fs.readFile(filePath);
      const pHash = await phash(buf);
      entries.push({
        filePath,
        sha256: sha256Buffer(buf),
        pHash,
      });
    } catch (err) {
      skippedCount++;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[findDuplicate] Skipped ${path.basename(filePath)}: ${message}`,
      );
    }
  }

  console.log(
    `[findDuplicate] Successfully hashed ${entries.length} image(s) (${skippedCount} skipped). Checking exact duplicates...`,
  );

  const bySha = new Map<string, string[]>();
  for (const item of entries) {
    const group = bySha.get(item.sha256) ?? [];
    group.push(item.filePath);
    bySha.set(item.sha256, group);
  }
  const exactDuplicates = [...bySha.values()].filter(
    (group) => group.length > 1,
  );
  console.log(
    `[findDuplicate] Exact duplicate group(s) found: ${exactDuplicates.length}`,
  );

  console.log(
    `[findDuplicate] Comparing perceptual hashes (maxHammingDistance <= ${maxHammingDistance})...`,
  );
  const nearDuplicatePairs: Array<{ a: string; b: string; distance: number }> =
    [];
  let comparisons = 0;

  for (let i = 0; i < entries.length; i++) {
    const entryA = entries[i];
    if (!entryA) continue;

    for (let j = i + 1; j < entries.length; j++) {
      const entryB = entries[j];
      if (!entryB) continue;
      if (entryA.sha256 === entryB.sha256) continue;

      comparisons++;
      const distance = phashDistance(entryA.pHash, entryB.pHash);
      if (distance <= maxHammingDistance) {
        nearDuplicatePairs.push({
          a: entryA.filePath,
          b: entryB.filePath,
          distance,
        });
      }
    }
  }

  const clusters = buildClusters(
    entries.map((e) => e.filePath),
    exactDuplicates,
    nearDuplicatePairs,
  );
  const filesToRemove = clusters.flatMap((c) => c.duplicates);

  const deletedFiles: string[] = [];
  const movedFiles: Array<{ from: string; to: string }> = [];

  if (filesToRemove.length > 0) {
    if (moveToFolder) {
      const resolvedMoveDir = path.resolve(moveToFolder);
      await fs.mkdir(resolvedMoveDir, { recursive: true });
      console.log(
        `[findDuplicate] Moving ${filesToRemove.length} duplicate file(s) to ${resolvedMoveDir}...`,
      );
      for (const filePath of filesToRemove) {
        const destPath = path.join(resolvedMoveDir, path.basename(filePath));
        await fs.rename(filePath, destPath);
        movedFiles.push({ from: filePath, to: destPath });
        console.log(
          `[findDuplicate] Moved: ${path.basename(filePath)} -> ${destPath}`,
        );
      }
    } else if (deleteDuplicates) {
      console.log(
        `[findDuplicate] Deleting ${filesToRemove.length} duplicate file(s)...`,
      );
      for (const filePath of filesToRemove) {
        await fs.unlink(filePath);
        deletedFiles.push(filePath);
        console.log(`[findDuplicate] Deleted: ${path.basename(filePath)}`);
      }
    } else {
      console.log(
        `[findDuplicate] Dry run: ${filesToRemove.length} duplicate file(s) candidate(s) found across ${clusters.length} group(s). Pass --delete or --move <dir> to modify files.`,
      );
    }
  }

  const elapsedMs = Date.now() - startTime;
  console.log(
    `[findDuplicate] Done in ${elapsedMs}ms (${comparisons} visual comparison(s), ${clusters.length} duplicate group(s), ${deletedFiles.length} deleted, ${movedFiles.length} moved).`,
  );

  return {
    exactDuplicates,
    nearDuplicatePairs,
    clusters,
    deletedFiles,
    movedFiles,
  };
}

// Usage:
// npx tsx src/utlis/findDulipcate.ts <folder-path> [max-distance] [--delete] [--move <dest-folder>]
const isMainModule =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const args = process.argv.slice(2);
  let targetFolder: string | undefined;
  let maxDistance = 5;
  let deleteDuplicates = false;
  let moveToFolder: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === "--delete") {
      deleteDuplicates = true;
    } else if (arg === "--move") {
      const nextArg = args[i + 1];
      if (!nextArg || nextArg.startsWith("--")) {
        console.error("Error: --move requires a destination folder path.");
        process.exit(1);
      }
      moveToFolder = nextArg;
      i++;
    } else if (!arg.startsWith("--") && targetFolder === undefined) {
      targetFolder = arg;
    } else if (!arg.startsWith("--") && !Number.isNaN(Number(arg))) {
      maxDistance = Number(arg);
    } else {
      console.error(`Error: Unknown or invalid argument "${arg}".`);
      process.exit(1);
    }
  }

  if (!targetFolder) {
    console.error(
      "Usage: npx tsx src/utlis/findDulipcate.ts <folder-path> [max-distance] [--delete] [--move <dest-folder>]",
    );
    process.exit(1);
  }

  if (Number.isNaN(maxDistance) || maxDistance < 0) {
    console.error("Error: [max-distance] must be a non-negative number.");
    process.exit(1);
  }

  findDuplicatePhotos(targetFolder, {
    maxHammingDistance: maxDistance,
    deleteDuplicates,
    moveToFolder,
  })
    .then((result) => {
      console.log("\n=== Duplicate Clusters (Kept vs Removed/Candidate) ===");
      console.log(JSON.stringify(result.clusters, null, 2));

      if (result.deletedFiles.length > 0) {
        console.log("\n=== Deleted Files ===");
        console.log(JSON.stringify(result.deletedFiles, null, 2));
      }

      if (result.movedFiles.length > 0) {
        console.log("\n=== Moved Files ===");
        console.log(JSON.stringify(result.movedFiles, null, 2));
      }
    })
    .catch((err) => {
      console.error("[findDuplicate] Fatal error:", err);
      process.exit(1);
    });
}
