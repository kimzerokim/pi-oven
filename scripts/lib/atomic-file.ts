import { constants, promises as fs } from "node:fs";
import { dirname, basename, join } from "node:path";
import { randomBytes } from "node:crypto";

export interface AtomicFileOptions {
  mode?: number;
  fault?: (point: "after_temp_sync" | "after_rename" | "after_directory_sync") => void | Promise<void>;
}

function temporaryPath(file: string): string {
  const nonce = randomBytes(12).toString("hex");
  return join(dirname(file), `.${basename(file)}.${process.pid}.${nonce}.tmp`);
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(directory, constants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!["EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(code ?? "")) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

export type TextFileSnapshot = { absent: true } | { content: string };

export async function readTextFileSnapshot(file: string): Promise<TextFileSnapshot> {
  try {
    return { content: await fs.readFile(file, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { absent: true };
    throw error;
  }
}

export async function durableRemoveFile(file: string): Promise<void> {
  try {
    await fs.unlink(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await syncDirectory(dirname(file));
}

export async function restoreTextFileSnapshot(
  file: string,
  snapshot: TextFileSnapshot
): Promise<void> {
  if ("absent" in snapshot) {
    await durableRemoveFile(file);
  } else {
    await atomicReplaceFile(file, snapshot.content);
  }
}

/**
 * Durably replace one file on the same filesystem.
 *
 * The temporary name is unique per attempt, the temporary file is fsynced
 * before rename, and the parent directory is fsynced where the platform
 * supports directory handles. Failed attempts remove only their own temp file.
 */
export async function atomicReplaceFile(
  file: string,
  data: string | Uint8Array,
  options: AtomicFileOptions = {}
): Promise<void> {
  const directory = dirname(file);
  await fs.mkdir(directory, { recursive: true });
  const temporary = temporaryPath(file);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;

  try {
    handle = await fs.open(temporary, "wx", options.mode ?? 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await options.fault?.("after_temp_sync");
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, file);
    await options.fault?.("after_rename");
    await syncDirectory(directory);
    await options.fault?.("after_directory_sync");
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Preserve the initiating write/rename failure.
      }
    }
    try {
      await fs.rm(temporary, { force: true });
    } catch {
      // Preserve the initiating failure; the unique temp name is safe to inspect.
    }
    throw error;
  }
}
