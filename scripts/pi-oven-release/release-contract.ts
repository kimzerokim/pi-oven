#!/usr/bin/env bun
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

const RELEASE_ROOT_FILES = new Set([
  "bun.lock",
  "bunfig.toml",
  "CHANGELOG.md",
  "CLAUDE.md",
  "LICENSE",
  "package.json",
  "README.md",
  "tsconfig.json",
]);

const RELEASE_ROOT_DIRS = [
  ".claude-plugin/",
  ".omp/extensions/",
  "agents/",
  "commands/",
  "config/",
  "docs/generated/",
  "evals/",
  "scripts/",
  "skills/",
] as const;

export interface ShippedFile {
  path: string;
  sha256: string;
  size: number;
  mode: string;
}

export interface ShippedManifest {
  schemaVersion: 1;
  package: "pi-oven";
  version: string;
  archive: string;
  files: ShippedFile[];
}

export interface SpdxDocument {
  spdxVersion: "SPDX-2.3";
  dataLicense: "CC0-1.0";
  SPDXID: "SPDXRef-DOCUMENT";
  name: string;
  documentNamespace: string;
  creationInfo: {
    created: "1970-01-01T00:00:00Z";
    creators: ["Tool: pi-oven-release-contract"];
  };
  packages: Array<Record<string, unknown>>;
  files: Array<{
    fileName: string;
    SPDXID: string;
    checksums: [{ algorithm: "SHA256"; checksumValue: string }];
    licenseConcluded: "NOASSERTION";
    copyrightText: "NOASSERTION";
  }>;
  relationships: Array<Record<string, string>>;
}

export interface ReleaseArtifacts {
  archivePath: string;
  checksumPath: string;
  manifestPath: string;
  provenancePath: string;
  sbomPath: string;
  archiveSha256: string;
  manifest: ShippedManifest;
  spdx: SpdxDocument;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePath(path: string): string {
  return path.split(sep).join("/").replace(/^\.\//, "");
}

export function selectReleaseFiles(paths: Iterable<string>): string[] {
  return [...paths]
    .map(normalizePath)
    .filter((path) => RELEASE_ROOT_FILES.has(path) || RELEASE_ROOT_DIRS.some((root) => path.startsWith(root)))
    .sort((a, b) => a.localeCompare(b));
}

function walkFiles(root: string, current = root): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) paths.push(...walkFiles(root, absolute));
    else if (entry.isFile()) paths.push(normalizePath(relative(root, absolute)));
  }
  return paths;
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const encoded = value.toString(8).padStart(length - 1, "0").slice(-(length - 1));
  buffer.write(encoded, offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function writeTarPath(header: Buffer, path: string): void {
  if (Buffer.byteLength(path) <= 100) {
    header.write(path, 0, 100, "utf8");
    return;
  }
  const splitAt = path.lastIndexOf("/");
  const prefix = path.slice(0, splitAt);
  const name = path.slice(splitAt + 1);
  if (Buffer.byteLength(prefix) > 155 || Buffer.byteLength(name) > 100) {
    throw new Error(`Release path exceeds ustar limits: ${path}`);
  }
  header.write(name, 0, 100, "utf8");
  header.write(prefix, 345, 155, "utf8");
}

function tarEntry(path: string, content: Buffer, mode: number): Buffer {
  const header = Buffer.alloc(512);
  writeTarPath(header, path);
  writeOctal(header, 100, 8, mode & 0o777);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, content.byteLength);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  header.write("root", 265, 32, "ascii");
  header.write("root", 297, 32, "ascii");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  const padding = Buffer.alloc((512 - (content.byteLength % 512)) % 512);
  return Buffer.concat([header, content, padding]);
}

function makeTar(root: string, prefix: string, files: ShippedFile[]): Buffer {
  return Buffer.concat([
    ...files.map((file) =>
      tarEntry(`${prefix}/${file.path}`, readFileSync(join(root, file.path)), Number.parseInt(file.mode, 8)),
    ),
    Buffer.alloc(1024),
  ]);
}

function writeStableJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function validateReleaseTagContract(tag: string, version: string, marketplaceRef: string): void {
  const expected = `v${version}`;
  if (tag !== expected) {
    throw new Error(`Release tag/version mismatch: tag=${tag}, package.version=${version}`);
  }
  if (marketplaceRef !== expected) {
    throw new Error(`Immutable marketplace ref mismatch: expected ${expected}, got ${marketplaceRef}`);
  }
}

export function readAndValidateReleaseContract(root: string, tag: string): string {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown };
  const plugin = JSON.parse(readFileSync(join(root, ".claude-plugin/plugin.json"), "utf8")) as {
    version?: unknown;
  };
  const marketplace = JSON.parse(
    readFileSync(join(root, ".claude-plugin/marketplace.json"), "utf8"),
  ) as { plugins?: Array<{ version?: unknown; source?: { ref?: unknown } }> };
  const version = pkg.version;
  const pluginVersion = plugin.version;
  const marketVersion = marketplace.plugins?.[0]?.version;
  const ref = marketplace.plugins?.[0]?.source?.ref;
  if (typeof version !== "string" || pluginVersion !== version || marketVersion !== version) {
    throw new Error(
      `Version SoT mismatch: package.json=${String(version)}, plugin.json=${String(pluginVersion)}, marketplace.json=${String(marketVersion)}`,
    );
  }
  if (typeof ref !== "string") throw new Error("marketplace ref must be a string");
  validateReleaseTagContract(tag, version, ref);
  return version;
}

export function buildReleaseArtifacts(options: {
  root: string;
  outDir: string;
  version: string;
  files?: string[];
}): ReleaseArtifacts {
  const root = resolve(options.root);
  const paths = selectReleaseFiles(options.files ?? walkFiles(root));
  if (paths.length === 0) throw new Error("Release allowlist selected no files");

  const archiveName = `pi-oven-v${options.version}.tar.gz`;
  const prefix = `pi-oven-v${options.version}`;
  const files: ShippedFile[] = paths.map((path) => {
    const content = readFileSync(join(root, path));
    const stat = lstatSync(join(root, path));
    return {
      path,
      sha256: sha256(content),
      size: content.byteLength,
      mode: (stat.mode & 0o777).toString(8).padStart(3, "0"),
    };
  });
  const manifest: ShippedManifest = {
    schemaVersion: 1,
    package: "pi-oven",
    version: options.version,
    archive: archiveName,
    files,
  };

  const tar = makeTar(root, prefix, files);
  const archive = gzipSync(tar, { level: 9, mtime: 0 } as Parameters<typeof gzipSync>[1]);
  const archiveSha256 = sha256(archive);
  const spdx: SpdxDocument = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `pi-oven-v${options.version}`,
    documentNamespace: `https://github.com/kimzerokim/pi-oven/releases/tag/v${options.version}#${archiveSha256}`,
    creationInfo: {
      created: "1970-01-01T00:00:00Z",
      creators: ["Tool: pi-oven-release-contract"],
    },
    packages: [
      {
        name: "pi-oven",
        SPDXID: "SPDXRef-Package-pi-oven",
        versionInfo: options.version,
        downloadLocation: "NOASSERTION",
        filesAnalyzed: true,
        licenseConcluded: "NOASSERTION",
        licenseDeclared: "NOASSERTION",
        copyrightText: "NOASSERTION",
      },
    ],
    files: files.map((file, index) => ({
      fileName: file.path,
      SPDXID: `SPDXRef-File-${index + 1}`,
      checksums: [{ algorithm: "SHA256", checksumValue: file.sha256 }],
      licenseConcluded: "NOASSERTION",
      copyrightText: "NOASSERTION",
    })),
    relationships: files.map((_file, index) => ({
      spdxElementId: "SPDXRef-Package-pi-oven",
      relationshipType: "CONTAINS",
      relatedSpdxElement: `SPDXRef-File-${index + 1}`,
    })),
  };

  mkdirSync(options.outDir, { recursive: true });
  const archivePath = join(options.outDir, archiveName);
  const checksumPath = `${archivePath}.sha256`;
  const manifestPath = join(options.outDir, `pi-oven-v${options.version}.manifest.json`);
  const provenancePath = join(options.outDir, `pi-oven-v${options.version}.provenance.json`);
  const sbomPath = join(options.outDir, `pi-oven-v${options.version}.spdx.json`);
  writeFileSync(archivePath, archive);
  writeFileSync(checksumPath, `${archiveSha256}  ${basename(archivePath)}\n`, "utf8");
  writeStableJson(manifestPath, manifest);
  writeStableJson(provenancePath, {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: archiveName, digest: { sha256: archiveSha256 } }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: { buildType: "https://github.com/kimzerokim/pi-oven/release-contract/v1" },
      runDetails: { builder: { id: "https://github.com/kimzerokim/pi-oven/.github/workflows/release.yml" } },
    },
  });
  writeStableJson(sbomPath, spdx);

  return {
    archivePath,
    checksumPath,
    manifestPath,
    provenancePath,
    sbomPath,
    archiveSha256,
    manifest,
    spdx,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      tag: { type: "string" },
      "out-dir": { type: "string", default: "dist/release" },
      "check-only": { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values.tag) throw new Error("--tag vX.Y.Z is required");
  const version = readAndValidateReleaseContract(process.cwd(), values.tag);
  if (values["check-only"]) {
    process.stdout.write(`${JSON.stringify({ valid: true, version, tag: values.tag })}\n`);
    return;
  }
  const result = buildReleaseArtifacts({
    root: process.cwd(),
    outDir: resolve(values["out-dir"]),
    version,
  });
  process.stdout.write(
    `${JSON.stringify({ version, tag: values.tag, archive: result.archivePath, sha256: result.archiveSha256 })}\n`,
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
